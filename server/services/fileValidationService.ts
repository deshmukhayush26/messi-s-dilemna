// server/services/fileValidationService.ts
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import path from 'node:path';

export interface FileValidationResult {
  valid: boolean;
  slideCount: number;
  fileType: 'pdf' | 'pptx';
  error?: string;
}

export class FileValidationService {
  /**
   * Inspects and validates presentation documents (PDF / PPTX)
   * Extracts exact slide/page counts without arbitrary file-size constraints.
   */
  async validateDeck(
    buffer: Buffer,
    originalFilename: string,
    options: { maxSlides?: number; minSlides?: number; enforceMin?: boolean } = {}
  ): Promise<FileValidationResult> {
    const maxSlides = options.maxSlides ?? 6;
    const minSlides = options.minSlides ?? 5;
    const enforceMin = options.enforceMin ?? false;

    if (!buffer || buffer.length === 0) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pdf',
        error: 'Uploaded file is empty.',
      };
    }

    const ext = path.extname(originalFilename || '').toLowerCase();

    // 1. Detect file type by extension and magic bytes
    if (ext === '.pdf') {
      return this.validatePdf(buffer, maxSlides, minSlides, enforceMin);
    } else if (ext === '.pptx') {
      return this.validatePptx(buffer, maxSlides, minSlides, enforceMin);
    } else if (ext === '.ppt') {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pptx',
        error: 'Legacy binary .ppt format is unsupported. Please save your presentation as modern .pptx or .pdf format.',
      };
    }

    // Inspect magic bytes if extension is ambiguous
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return this.validatePdf(buffer, maxSlides, minSlides, enforceMin);
    }
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      return this.validatePptx(buffer, maxSlides, minSlides, enforceMin);
    }

    return {
      valid: false,
      slideCount: 0,
      fileType: 'pdf',
      error: `Unsupported file type '${ext || 'unknown'}'. Please upload a PDF (.pdf) or PowerPoint (.pptx) file.`,
    };
  }

  async validatePresentationFile(
    buffer: Buffer,
    originalFilename: string,
    options: { maxSlides?: number; minSlides?: number; enforceMin?: boolean } = {}
  ): Promise<FileValidationResult> {
    return this.validateDeck(buffer, originalFilename, options);
  }

  private async validatePdf(
    buffer: Buffer,
    maxSlides: number,
    minSlides: number,
    enforceMin: boolean
  ): Promise<FileValidationResult> {
    // Magic bytes check for PDF
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pdf',
        error: 'File extension is .pdf but document does not contain a valid PDF signature.',
      };
    }

    let pageCount = 0;
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
      pageCount = pdfDoc.getPageCount();
    } catch (err: any) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('encrypt') || msg.includes('password')) {
        return {
          valid: false,
          slideCount: 0,
          fileType: 'pdf',
          error: 'The PDF file is encrypted or password-protected. Please remove password protection before submitting.',
        };
      }
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pdf',
        error: `Malformed or unreadable PDF: ${err.message || 'File structure corrupted.'}`,
      };
    }

    if (pageCount === 0) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pdf',
        error: 'The PDF presentation contains 0 pages.',
      };
    }

    // Enforce 6 slides max
    if (pageCount > maxSlides) {
      return {
        valid: false,
        slideCount: pageCount,
        fileType: 'pdf',
        error: `Presentation contains ${pageCount} slides, exceeds the maximum limit of ${maxSlides} slides. Target is 5–6 slides.`,
      };
    }

    if (enforceMin && pageCount < minSlides) {
      return {
        valid: false,
        slideCount: pageCount,
        fileType: 'pdf',
        error: `Presentation contains ${pageCount} slides. Requires a minimum ${minSlides} slides (target 5–6 slides).`,
      };
    }

    return {
      valid: true,
      slideCount: pageCount,
      fileType: 'pdf',
    };
  }

  private async validatePptx(
    buffer: Buffer,
    maxSlides: number,
    minSlides: number,
    enforceMin: boolean
  ): Promise<FileValidationResult> {
    // Check ZIP magic bytes (PK\x03\x04)
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pptx',
        error: 'File extension is .pptx but file is not a valid ZIP/OpenXML archive.',
      };
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err: any) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pptx',
        error: `Corrupt or malformed PPTX archive: ${err.message || 'Unable to decompress.'}`,
      };
    }

    // Verify presentation.xml exists
    const presentationXml = zip.file('ppt/presentation.xml');
    if (!presentationXml) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pptx',
        error: 'Invalid PPTX presentation structure (ppt/presentation.xml is missing).',
      };
    }

    // Count actual slide files: ppt/slides/slide{number}.xml
    // This specifically excludes:
    // - ppt/slideMasters/
    // - ppt/slideLayouts/
    // - ppt/notesSlides/
    // - ppt/media/
    const slideFiles = Object.keys(zip.files).filter((fileName) => {
      return /^ppt\/slides\/slide\d+\.xml$/i.test(fileName);
    });

    let slideCount = slideFiles.length;

    // Cross-verify with presentation.xml slide list if available
    try {
      const xmlContent = await presentationXml.async('text');
      const matches = xmlContent.match(/<p:sldId\b[^>]*>/gi);
      if (matches && matches.length > 0) {
        // Use the authoritative manifest count
        slideCount = matches.length;
      }
    } catch {
      // Fallback to slideFiles.length
    }

    if (slideCount === 0) {
      return {
        valid: false,
        slideCount: 0,
        fileType: 'pptx',
        error: 'No presentation slides were found in the uploaded PPTX file.',
      };
    }

    // Enforce 6 slides max
    if (slideCount > maxSlides) {
      return {
        valid: false,
        slideCount,
        fileType: 'pptx',
        error: `Presentation contains ${slideCount} slides, exceeds the maximum limit of ${maxSlides} slides. Target is 5–6 slides.`,
      };
    }

    if (enforceMin && slideCount < minSlides) {
      return {
        valid: false,
        slideCount,
        fileType: 'pptx',
        error: `Presentation contains ${slideCount} slides. Requires a minimum ${minSlides} slides (target 5–6 slides).`,
      };
    }

    return {
      valid: true,
      slideCount,
      fileType: 'pptx',
    };
  }
}

export const activeFileValidationService = new FileValidationService();
