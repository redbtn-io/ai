/**
 * @file DOCX Parser
 * @description Parse Word documents (.doc, .docx) to extract text content
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class DocxParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ].includes(mimeType);
  }

  supportsExtension(ext: string): boolean {
    return ['.doc', '.docx'].includes(ext.toLowerCase());
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    const isDocx = filename.toLowerCase().endsWith('.docx');
    
    if (isDocx) {
      return this.parseDocx(buffer, filename, options);
    } else {
      return this.parseDoc(buffer, filename, options);
    }
  }

  private async parseDocx(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    // Dynamically import mammoth
    let mammoth: typeof import('mammoth');
    try {
      mammoth = await import('mammoth');
    } catch {
      throw new Error('mammoth not installed. Run: npm install mammoth');
    }

    const result = await mammoth.extractRawText({ buffer });
    const content = result.value.trim();
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Extract sections by paragraphs if preserveStructure is enabled
    let sections: ParsedDocument['sections'];
    if (options?.preserveStructure) {
      const paragraphs = content.split(/\n\n+/);
      sections = paragraphs.map((text: string, index: number) => ({
        index: index + 1,
        content: text.trim(),
      })).filter((s: { content: string }) => s.content.length > 0);
    }

    return {
      content,
      metadata: {
        wordCount,
        charCount: content.length,
        source: {
          filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fileSize: buffer.length,
        },
        extra: {
          warnings: result.messages.filter(m => m.type === 'warning').map(m => m.message),
        },
      },
      sections,
    };
  }

  private async parseDoc(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    // For .doc files, we use word-extractor
    interface WordDocument {
      getBody(): string;
      getHeaders(): { getText(): string } | undefined;
      getFooters(): { getText(): string } | undefined;
      getAnnotations(): { getText(): string } | undefined;
    }

    interface WordExtractorClass {
      new (): { extract(input: Buffer): Promise<WordDocument> };
    }

    let WordExtractor: WordExtractorClass;
    try {
      const module = await import('word-extractor');
      WordExtractor = module.default || module;
    } catch {
      throw new Error('word-extractor not installed. Run: npm install word-extractor');
    }

    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const content = doc.getBody().trim();
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Extract sections
    let sections: ParsedDocument['sections'];
    if (options?.preserveStructure) {
      const paragraphs = content.split(/\n\n+/);
      sections = paragraphs.map((text: string, index: number) => ({
        index: index + 1,
        content: text.trim(),
      })).filter((s: { content: string }) => s.content.length > 0);
    }

    return {
      content,
      metadata: {
        wordCount,
        charCount: content.length,
        source: {
          filename,
          mimeType: 'application/msword',
          fileSize: buffer.length,
        },
        extra: {
          headers: doc.getHeaders()?.getText?.() || undefined,
          footers: doc.getFooters()?.getText?.() || undefined,
          annotations: doc.getAnnotations()?.getText?.() || undefined,
        },
      },
      sections,
    };
  }
}
