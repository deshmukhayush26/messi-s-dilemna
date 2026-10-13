// server/services/aiJudge/deckParser.ts
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import path from 'node:path';
import { ParsedDeck, ParsedSlide } from './types';

// Minimal 1x1 PNG transparent fallback for vision models if image conversion fails
const _FALLBACK_1X1_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export class DeckParser {
  /**
   * Static helper to parse a deck.
   */
  static async parseDeck(buffer: Buffer, filename: string): Promise<ParsedDeck> {
    return new DeckParser().parseDeck(buffer, filename);
  }

  /**
   * Parse a presentation deck (PDF or PPTX) up to 6 slides.
   * Extracts text, structure, tables, chart metadata, and visual representations.
   */
  async parseDeck(buffer: Buffer, filename: string): Promise<ParsedDeck> {
    if (!buffer || buffer.length === 0) {
      throw new Error('Deck buffer is empty.');
    }

    const ext = path.extname(filename || '').toLowerCase();
    const isPdf =
      ext === '.pdf' ||
      (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-');
    const isPptx =
      ext === '.pptx' ||
      (buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        buffer[2] === 0x03 &&
        buffer[3] === 0x04);

    if (isPdf) {
      return this.parsePdf(buffer);
    } else if (isPptx) {
      return this.parsePptx(buffer);
    }

    throw new Error(`Unsupported presentation format for parsing: '${ext}'. Expected .pdf or .pptx.`);
  }

  /**
   * Parse PDF presentation deck
   */
  private async parsePdf(buffer: Buffer): Promise<ParsedDeck> {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    const pageCount = pdfDoc.getPageCount();

    if (pageCount === 0) {
      throw new Error('PDF presentation contains 0 pages.');
    }
    if (pageCount > 6) {
      throw new Error(`PDF presentation contains ${pageCount} slides, exceeding maximum limit of 6 slides.`);
    }

    // Extract per-page text using dynamic import or page text scanner
    const pageTexts: string[] = [];

    try {
      // Dynamic import pdf-parse to extract per-page text safely
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule as any).default || pdfParseModule;

      const perPageMap = new Map<number, string>();
      let currentPage = 1;

      await pdfParse(buffer, {
        pagerender: (pageData: any) => {
          return pageData.getTextContent().then((textContent: any) => {
            let text = '';
            for (const item of textContent.items) {
              text += item.str + ' ';
            }
            perPageMap.set(currentPage, text.trim());
            currentPage++;
            return text;
          });
        },
      });

      for (let p = 1; p <= pageCount; p++) {
        pageTexts.push(perPageMap.get(p) || '');
      }
    } catch {
      // Fallback: extract text tokens directly from raw PDF streams if pdf-parse encounters issue
      const rawString = buffer.toString('latin1');
      const textMatches = rawString.match(/\(([^)]+)\)\s*Tj/g) || [];
      const extracted = textMatches.map((m) => m.replace(/[()Tj\s]/g, '')).join(' ');
      for (let p = 1; p <= pageCount; p++) {
        pageTexts.push(p === 1 ? extracted : '');
      }
    }

    const slides: ParsedSlide[] = [];
    let totalWordCount = 0;

    for (let i = 0; i < pageCount; i++) {
      const slideNum = i + 1;
      const text = this.sanitizeSlideText(pageTexts[i] || '');
      const words = text ? text.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length;
      totalWordCount += wordCount;

      // Detect title from first non-empty line
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines.length > 0 ? lines[0].slice(0, 80) : `Slide ${slideNum}`;

      const isSparseText = wordCount < 15;

      // Generate visual card representation as SVG data URL (acceptable as image_url for vision models)
      const visualDataUrl = this.createSlideVisualDataUrl(slideNum, title, text, lines.slice(1, 6));

      slides.push({
        slideNumber: slideNum,
        title,
        text,
        wordCount,
        hasVisuals: true,
        imageDataUrl: visualDataUrl,
        visualPreview: visualDataUrl,
        isSparseText,
      });
    }

    return {
      fileType: 'pdf',
      slideCount: pageCount,
      slides,
      totalWordCount,
      hasVisuals: true,
    };
  }

  /**
   * Parse OpenXML PPTX presentation deck
   */
  private async parsePptx(buffer: Buffer): Promise<ParsedDeck> {
    const zip = await JSZip.loadAsync(buffer);

    const presentationXml = zip.file('ppt/presentation.xml');
    if (!presentationXml) {
      throw new Error('Invalid PPTX structure: ppt/presentation.xml not found.');
    }

    // Find and order slide XML files
    const slideFiles = Object.keys(zip.files)
      .filter((fn) => /^ppt\/slides\/slide\d+\.xml$/i.test(fn))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

    const slideCount = slideFiles.length;
    if (slideCount === 0) {
      throw new Error('PPTX presentation contains 0 slides.');
    }
    if (slideCount > 6) {
      throw new Error(`PPTX presentation contains ${slideCount} slides, exceeding maximum limit of 6 slides.`);
    }

    const slides: ParsedSlide[] = [];
    let totalWordCount = 0;

    for (let i = 0; i < slideCount; i++) {
      const slideNum = i + 1;
      const slideFileName = slideFiles[i];
      const xmlFile = zip.file(slideFileName);
      if (!xmlFile) continue;

      const xmlContent = await xmlFile.async('text');

      // 1. Extract text tokens
      const textMatches = xmlContent.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
      const textTokens = textMatches.map((m) => {
        return m.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      });

      const fullText = this.sanitizeSlideText(textTokens.join(' ').replace(/\s+/g, ' ').trim());
      const words = fullText ? fullText.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length;
      totalWordCount += wordCount;

      // 2. Extract tables (<a:tbl>)
      const tables: string[][] = [];
      const tblMatches = xmlContent.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/gi) || [];
      for (const tblXml of tblMatches) {
        const rows = tblXml.match(/<a:tr\b[\s\S]*?<\/a:tr>/gi) || [];
        for (const trXml of rows) {
          const cells = trXml.match(/<a:tc\b[\s\S]*?<\/a:tc>/gi) || [];
          const rowText = cells.map((tc) => {
            const cellTexts = tc.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
            return cellTexts.map((c) => c.replace(/<[^>]+>/g, '')).join(' ').trim();
          });
          if (rowText.some(Boolean)) {
            tables.push(rowText);
          }
        }
      }

      // 3. Extract chart labels (<c:v>, <c:cat>, <c:tx>)
      const chartLabels: string[] = [];
      const relsFile = zip.file(`ppt/slides/_rels/${path.basename(slideFileName)}.rels`);
      let embeddedImageDataUrl: string | undefined;

      if (relsFile) {
        const relsXml = await relsFile.async('text');
        // Check for charts
        const chartRels = relsXml.match(/Target="(\.\.\/charts\/[^"]+)"/gi) || [];
        for (const cr of chartRels) {
          const chartPath = cr.replace(/Target="\.\.\/charts\//i, 'ppt/charts/').replace(/"$/, '');
          const chartFile = zip.file(chartPath);
          if (chartFile) {
            const chartXml = await chartFile.async('text');
            const vMatches = chartXml.match(/<c:v\b[^>]*>([\s\S]*?)<\/c:v>/gi) || [];
            for (const vm of vMatches) {
              const val = vm.replace(/<[^>]+>/g, '').trim();
              if (val) chartLabels.push(val);
            }
          }
        }

        // Check for embedded images (<Target="../media/image1.png">)
        const mediaRels = relsXml.match(/Target="(\.\.\/media\/[^"]+)"/i);
        if (mediaRels) {
          const mediaRelPath = mediaRels[1].replace(/^\.\.\/media\//i, 'ppt/media/');
          const mediaFile = zip.file(mediaRelPath);
          if (mediaFile) {
            const mediaBuffer = await mediaFile.async('nodebuffer');
            const mediaExt = path.extname(mediaRelPath).toLowerCase();
            const mime = mediaExt === '.jpg' || mediaExt === '.jpeg' ? 'image/jpeg' : 'image/png';
            embeddedImageDataUrl = `data:${mime};base64,${mediaBuffer.toString('base64')}`;
          }
        }
      }

      // 4. Derive Slide Title
      const title = textTokens.length > 0 ? textTokens[0].slice(0, 80) : `Slide ${slideNum}`;
      const isSparseText = wordCount < 15;

      const visualDataUrl =
        embeddedImageDataUrl ||
        this.createSlideVisualDataUrl(slideNum, title, fullText, textTokens.slice(1, 6));

      slides.push({
        slideNumber: slideNum,
        title,
        text: fullText,
        wordCount,
        tables: tables.length > 0 ? tables : undefined,
        chartLabels: chartLabels.length > 0 ? chartLabels : undefined,
        hasVisuals: Boolean(embeddedImageDataUrl || tables.length > 0 || chartLabels.length > 0),
        imageDataUrl: visualDataUrl,
        visualPreview: visualDataUrl,
        isSparseText,
      });
    }

    return {
      fileType: 'pptx',
      slideCount,
      slides,
      totalWordCount,
      hasVisuals: true,
    };
  }

  /**
   * Sanitizes slide text and protects against prompt injection attempts.
   */
  private sanitizeSlideText(raw: string): string {
    if (!raw) return '';
    // Strip non-printable ASCII control characters (keeping \t=9, \n=10, \r=13)
    let cleaned = '';
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
        continue;
      }
      cleaned += raw[i];
    }
    return cleaned
      .replace(/(?:ignore all previous instructions|system:\s*you are now|override rubric|give 100\/100)/gi, '[FLAGGED_INSTRUCTION_REMOVED]')
      .trim();
  }

  /**
   * Generates a clean, high-contrast SVG representation of a slide encoded as a data URL.
   * This gives vision-enabled models a visual layout of titles, metrics, structure, and text.
   */
  private createSlideVisualDataUrl(
    slideNumber: number,
    title: string,
    text: string,
    keyPoints: string[]
  ): string {
    const cleanTitle = escapeXml(title || `Slide ${slideNumber}`);
    const summaryPoints = keyPoints.slice(0, 5).map((p, idx) => {
      const escaped = escapeXml(p.slice(0, 100));
      return `<text x="80" y="${220 + idx * 60}" font-family="Arial, sans-serif" font-size="22" fill="#334155">• ${escaped}</text>`;
    }).join('\n');

    const previewSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f8fafc" />
  <rect x="40" y="30" width="1200" height="660" rx="16" fill="#ffffff" stroke="#e2e8f0" stroke-width="4"/>
  <rect x="40" y="30" width="1200" height="110" rx="16" fill="#0f172a"/>
  <text x="80" y="98" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#ffffff">${cleanTitle}</text>
  <rect x="1100" y="60" width="100" height="40" rx="20" fill="#f97316"/>
  <text x="1122" y="86" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff">Slide ${slideNumber}</text>
  ${summaryPoints}
  <rect x="80" y="600" width="1120" height="50" rx="8" fill="#f1f5f9"/>
  <text x="100" y="632" font-family="Arial, sans-serif" font-size="16" fill="#64748b">CCG × OpenAI Case Presentation — Verified Institutional Submission Deck</text>
</svg>`.trim();

    return `data:image/svg+xml;base64,${Buffer.from(previewSvg).toString('base64')}`;
  }
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const activeDeckParser = new DeckParser();
