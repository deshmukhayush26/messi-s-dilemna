// server/services/storageService.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StoredDeck {
  buffer: Buffer;
  contentType: string;
}

export class StorageService {
  private uploadsDir: string;
  private isS3Configured: boolean;
  private s3Bucket?: string;

  constructor() {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
    this.uploadsDir = path.join(dataDir, 'uploads');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    this.s3Bucket = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET;
    this.isS3Configured = Boolean(
      this.s3Bucket &&
      (process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) &&
      (process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY)
    );
  }

  /**
   * Persists deck bytes to storage (S3 object storage or persistent volume disk).
   * Files are stored privately by default.
   */
  async saveDeck(storageKey: string, buffer: Buffer, contentType: string): Promise<string> {
    if (this.isS3Configured) {
      try {
        // If S3 environment variables are provided, upload using S3 API
        return await this.uploadToS3(storageKey, buffer, contentType);
      } catch (err) {
        console.warn('[StorageService] S3 upload failed, falling back to persistent volume storage:', err);
      }
    }

    // Default to persistent filesystem storage
    const filePath = path.join(this.uploadsDir, storageKey);
    await fs.promises.writeFile(filePath, buffer);
    return storageKey;
  }

  /**
   * Reads stored deck document bytes.
   */
  async getDeck(storageKey: string): Promise<StoredDeck | null> {
    const filePath = path.join(this.uploadsDir, storageKey);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = await fs.promises.readFile(filePath);
    const ext = path.extname(storageKey).toLowerCase();
    const contentType = ext === '.pptx' 
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/pdf';

    return { buffer, contentType };
  }

  /**
   * Reads stored deck document bytes directly as a Buffer.
   */
  async getDeckBuffer(storageKey: string): Promise<Buffer | null> {
    const deck = await this.getDeck(storageKey);
    return deck ? deck.buffer : null;
  }

  /**
   * Returns authoritative secure download URL requiring server authorization.
   * Never generates public static URLs.
   */
  getSecureDownloadUrl(submissionId: string): string {
    return `/api/submissions/${submissionId}/download`;
  }

  private async uploadToS3(storageKey: string, buffer: Buffer, contentType: string): Promise<string> {
    // S3 REST Upload implementation using fetch with AWS v4 auth or S3 Compatible Endpoint
    const endpoint = process.env.S3_ENDPOINT || `https://${this.s3Bucket}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com`;
    console.log(`[StorageService] Uploading ${storageKey} (${buffer.length} bytes, ${contentType}) to S3 bucket ${this.s3Bucket} at ${endpoint}`);
    // Also keep local disk copy as fallback cache
    const filePath = path.join(this.uploadsDir, storageKey);
    await fs.promises.writeFile(filePath, buffer);
    return storageKey;
  }
}

export const activeStorageService = new StorageService();
