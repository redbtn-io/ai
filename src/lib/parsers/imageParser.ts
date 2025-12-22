/**
 * @file Image Parser (Vision AI)
 * @description Extract text and descriptions from images using Ollama vision models
 * Uses local LLaVA or similar vision model for fast, free OCR
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class ImageParser implements IParser {
  private ollamaUrl: string;
  private visionModel: string;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.visionModel = process.env.OLLAMA_VISION_MODEL || 'llava:7b';
  }

  supportsMimeType(mimeType: string): boolean {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType);
  }

  supportsExtension(ext: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.toLowerCase());
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '.png';
    const mimeType = this.getMimeType(ext);

    // Try to extract text using vision model
    let extractedText = '';
    let visionAvailable = false;

    try {
      extractedText = await this.extractTextWithVision(buffer);
      visionAvailable = true;
    } catch (error) {
      console.warn('[ImageParser] Vision model not available, storing image without text extraction:', error);
      extractedText = `[Image: ${filename}]\n\nThis image could not be processed for text extraction. The original file is stored and viewable.`;
    }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      content: extractedText,
      metadata: {
        wordCount,
        charCount: extractedText.length,
        source: {
          filename,
          mimeType,
          fileSize: buffer.length,
        },
        extra: {
          isImage: true,
          visionProcessed: visionAvailable,
          visionModel: visionAvailable ? this.visionModel : undefined,
          dimensions: await this.getImageDimensions(buffer),
        },
      },
    };
  }

  private async extractTextWithVision(buffer: Buffer): Promise<string> {
    // Convert buffer to base64
    const base64Image = buffer.toString('base64');

    // Call Ollama vision model
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.visionModel,
        prompt: `Analyze this image and extract ALL text content you can see. 
If it's a document, transcribe all readable text preserving structure (headers, paragraphs, lists).
If it's a diagram or chart, describe the data and any labels.
If it's a photo with text (signs, labels, etc), extract that text.
If there's no text, provide a detailed description of what's in the image.

Be thorough - this text will be used for search indexing.`,
        images: [base64Image],
        stream: false,
        options: {
          temperature: 0.1, // Low temp for accurate transcription
          num_predict: 2000, // Allow long responses for documents
        },
      }),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama vision API error: ${response.status}`);
    }

    const result = await response.json();
    return result.response?.trim() || '';
  }

  private getMimeType(ext: string): string {
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    return map[ext] || 'image/png';
  }

  private async getImageDimensions(buffer: Buffer): Promise<{ width?: number; height?: number }> {
    try {
      // PNG: width at bytes 16-19, height at bytes 20-23 (big endian)
      if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
      
      // JPEG: more complex, skip for now
      return {};
    } catch {
      return {};
    }
  }
}
