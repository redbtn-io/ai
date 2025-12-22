/**
 * @file Document Parser Interface & Factory
 * @description Main entry point for parsing documents of various types
 */

import { PDFParser } from './pdfParser';
import { DocxParser } from './docxParser';
import { TextParser } from './textParser';
import { MarkdownParser } from './markdownParser';
import { ImageParser } from './imageParser';
import { CsvParser } from './csvParser';
import { ExcelParser } from './excelParser';

// --- Types ---

export interface ParsedDocument {
  /** Extracted text content */
  content: string;
  /** Document metadata */
  metadata: {
    title?: string;
    author?: string;
    createdAt?: Date;
    modifiedAt?: Date;
    pageCount?: number;
    wordCount: number;
    charCount: number;
    language?: string;
    /** Source file info */
    source: {
      filename: string;
      mimeType: string;
      fileSize: number;
    };
    /** Format-specific metadata */
    extra?: Record<string, unknown>;
  };
  /** Individual sections/pages if available */
  sections?: Array<{
    index: number;
    title?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ParseOptions {
  /** Extract images and run OCR */
  extractImages?: boolean;
  /** Include page/section boundaries */
  preserveStructure?: boolean;
  /** Max pages to process (for PDFs) */
  maxPages?: number;
  /** OCR language hint */
  ocrLanguage?: string;
  /** Custom metadata to include */
  customMetadata?: Record<string, unknown>;
}

export interface IParser {
  parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument>;
  supportsMimeType(mimeType: string): boolean;
  supportsExtension(ext: string): boolean;
}

// --- MIME Type Mappings ---

const MIME_TYPE_MAP: Record<string, string> = {
  // PDF
  'application/pdf': 'pdf',
  // Word Documents
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  // Text
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  // Images
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // CSV
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/comma-separated-values': 'csv',
  // Excel
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
};

const EXTENSION_MAP: Record<string, string> = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.png': 'png',
  '.webp': 'webp',
  '.gif': 'gif',
  // CSV
  '.csv': 'csv',
  // Excel
  '.xlsx': 'xlsx',
  '.xls': 'xls',
};

// --- Document Parser Factory ---

export class DocumentParser {
  private static parsers: Map<string, IParser> = new Map();
  private static initialized = false;

  /**
   * Initialize all parsers
   */
  private static init(): void {
    if (this.initialized) return;

    // Register parsers
    const pdfParser = new PDFParser();
    const docxParser = new DocxParser();
    const textParser = new TextParser();
    const markdownParser = new MarkdownParser();
    const imageParser = new ImageParser();
    const csvParser = new CsvParser();
    const excelParser = new ExcelParser();

    this.parsers.set('pdf', pdfParser);
    this.parsers.set('doc', docxParser); // DOC uses same parser with different handling
    this.parsers.set('docx', docxParser);
    this.parsers.set('txt', textParser);
    this.parsers.set('md', markdownParser);
    this.parsers.set('jpg', imageParser);
    this.parsers.set('png', imageParser);
    this.parsers.set('webp', imageParser);
    this.parsers.set('gif', imageParser);
    this.parsers.set('csv', csvParser);
    this.parsers.set('xlsx', excelParser);
    this.parsers.set('xls', excelParser);

    this.initialized = true;
  }

  /**
   * Get the parser type from a MIME type
   */
  static getTypeFromMimeType(mimeType: string): string | null {
    return MIME_TYPE_MAP[mimeType.toLowerCase()] || null;
  }

  /**
   * Get the parser type from a file extension
   */
  static getTypeFromExtension(filename: string): string | null {
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (!ext) return null;
    return EXTENSION_MAP[ext] || null;
  }

  /**
   * Check if a file type is supported
   */
  static isSupported(filenameOrMimeType: string): boolean {
    return !!(
      this.getTypeFromMimeType(filenameOrMimeType) ||
      this.getTypeFromExtension(filenameOrMimeType)
    );
  }

  /**
   * Get list of supported MIME types
   */
  static getSupportedMimeTypes(): string[] {
    return Object.keys(MIME_TYPE_MAP);
  }

  /**
   * Get list of supported extensions
   */
  static getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_MAP);
  }

  /**
   * Parse a document from a Buffer
   */
  static async parse(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: ParseOptions
  ): Promise<ParsedDocument> {
    this.init();

    // Determine parser type
    let parserType = mimeType ? this.getTypeFromMimeType(mimeType) : null;
    if (!parserType) {
      parserType = this.getTypeFromExtension(filename);
    }

    if (!parserType) {
      throw new Error(`Unsupported file type: ${filename} (${mimeType || 'unknown MIME type'})`);
    }

    const parser = this.parsers.get(parserType);
    if (!parser) {
      throw new Error(`No parser available for type: ${parserType}`);
    }

    // Parse the document
    const result = await parser.parse(buffer, filename, options);

    // Add source info if not present
    if (!result.metadata.source) {
      result.metadata.source = {
        filename,
        mimeType: mimeType || 'application/octet-stream',
        fileSize: buffer.length,
      };
    }

    return result;
  }

  /**
   * Parse a document from a file path
   */
  static async parseFile(
    filePath: string,
    options?: ParseOptions
  ): Promise<ParsedDocument> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const buffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    
    return this.parse(buffer, filename, undefined, options);
  }

  /**
   * Parse a document from a URL
   */
  static async parseUrl(
    url: string,
    options?: ParseOptions
  ): Promise<ParsedDocument> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type')?.split(';')[0];
    
    // Extract filename from URL or content-disposition
    const contentDisposition = response.headers.get('content-disposition');
    let filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1];
    if (!filename) {
      const urlPath = new URL(url).pathname;
      filename = urlPath.split('/').pop() || 'document';
    }

    return this.parse(buffer, filename, mimeType || undefined, options);
  }
}
