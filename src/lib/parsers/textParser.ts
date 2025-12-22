/**
 * @file Text Parser
 * @description Parse plain text files
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class TextParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return mimeType === 'text/plain';
  }

  supportsExtension(ext: string): boolean {
    return ext.toLowerCase() === '.txt';
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    // Detect encoding and convert to string
    const content = this.decodeBuffer(buffer).trim();
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Extract sections by double newlines if preserveStructure is enabled
    let sections: ParsedDocument['sections'];
    if (options?.preserveStructure) {
      const paragraphs = content.split(/\n\n+/);
      sections = paragraphs.map((text, index) => ({
        index: index + 1,
        content: text.trim(),
      })).filter(s => s.content.length > 0);
    }

    return {
      content,
      metadata: {
        wordCount,
        charCount: content.length,
        source: {
          filename,
          mimeType: 'text/plain',
          fileSize: buffer.length,
        },
      },
      sections,
    };
  }

  private decodeBuffer(buffer: Buffer): string {
    // Check for BOM markers
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      // UTF-8 with BOM
      return buffer.slice(3).toString('utf8');
    }
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      // UTF-16 BE
      return buffer.slice(2).toString('utf16le').split('').reverse().join('');
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      // UTF-16 LE
      return buffer.slice(2).toString('utf16le');
    }

    // Default to UTF-8
    return buffer.toString('utf8');
  }
}
