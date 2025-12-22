/**
 * Type declarations for document parsing libraries without types
 */

declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
    getHeaders(): { getText(): string } | undefined;
    getFooters(): { getText(): string } | undefined;
    getAnnotations(): { getText(): string } | undefined;
  }

  class WordExtractor {
    extract(input: Buffer | string): Promise<WordDocument>;
  }

  export default WordExtractor;
}

declare module 'pdf-parse' {
  interface PDFInfo {
    Title?: string;
    Author?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
    PDFFormatVersion?: string;
    [key: string]: unknown;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata: unknown;
    text: string;
    version: string;
  }

  interface PDFOptions {
    max?: number;
    version?: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;
  export = pdfParse;
}
