/**
 * @file PDF Parser
 * @description Parse PDF documents to extract text content
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class PDFParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  supportsExtension(ext: string): boolean {
    return ext.toLowerCase() === '.pdf';
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    // Dynamically import pdf-parse to avoid bundling issues
    let pdfParse: (buffer: Buffer, options?: { max?: number }) => Promise<{
      text: string;
      numpages: number;
      info: Record<string, unknown>;
    }>;
    try {
      const module = await import('pdf-parse');
      pdfParse = module.default || module;
    } catch {
      throw new Error('pdf-parse not installed. Run: npm install pdf-parse');
    }

    const data = await pdfParse(buffer, {
      max: options?.maxPages || 0, // 0 = all pages
    });

    const content = data.text.trim();
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Extract sections by page if preserveStructure is enabled
    let sections: ParsedDocument['sections'];
    if (options?.preserveStructure) {
      // pdf-parse doesn't give per-page text easily, so we split by form feeds or estimate
      const pageTexts = content.split(/\f|\x0C/);
      sections = pageTexts.map((text: string, index: number) => ({
        index: index + 1,
        title: `Page ${index + 1}`,
        content: text.trim(),
      })).filter((s: { content: string }) => s.content.length > 0);
    }

    const info = data.info || {};

    return {
      content,
      metadata: {
        title: typeof info.Title === 'string' ? info.Title : undefined,
        author: typeof info.Author === 'string' ? info.Author : undefined,
        createdAt: typeof info.CreationDate === 'string' ? this.parseDate(info.CreationDate) : undefined,
        modifiedAt: typeof info.ModDate === 'string' ? this.parseDate(info.ModDate) : undefined,
        pageCount: data.numpages,
        wordCount,
        charCount: content.length,
        source: {
          filename,
          mimeType: 'application/pdf',
          fileSize: buffer.length,
        },
        extra: {
          pdfVersion: info.PDFFormatVersion,
          producer: info.Producer,
          creator: info.Creator,
        },
      },
      sections,
    };
  }

  private parseDate(pdfDate: string): Date | undefined {
    // PDF dates are in format: D:YYYYMMDDHHmmss+HH'mm'
    const match = pdfDate.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (match) {
      const [, year, month, day, hour = '00', min = '00', sec = '00'] = match;
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);
    }
    return undefined;
  }
}
