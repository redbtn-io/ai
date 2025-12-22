/**
 * @file Markdown Parser
 * @description Parse Markdown files with structure preservation
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class MarkdownParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return ['text/markdown', 'text/x-markdown'].includes(mimeType);
  }

  supportsExtension(ext: string): boolean {
    return ['.md', '.markdown'].includes(ext.toLowerCase());
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    const rawContent = buffer.toString('utf8').trim();
    
    // Extract title from first H1 or frontmatter
    const title = this.extractTitle(rawContent);
    
    // Remove frontmatter for content
    const contentWithoutFrontmatter = this.removeFrontmatter(rawContent);
    
    // Convert to plain text (strip markdown syntax)
    const plainContent = this.stripMarkdown(contentWithoutFrontmatter);
    const wordCount = plainContent.split(/\s+/).filter(w => w.length > 0).length;

    // Extract sections by headers if preserveStructure is enabled
    let sections: ParsedDocument['sections'];
    if (options?.preserveStructure) {
      sections = this.extractSections(contentWithoutFrontmatter);
    }

    // Parse frontmatter for metadata
    const frontmatter = this.parseFrontmatter(rawContent);

    return {
      content: plainContent,
      metadata: {
        title: title || frontmatter?.title,
        author: frontmatter?.author,
        wordCount,
        charCount: plainContent.length,
        source: {
          filename,
          mimeType: 'text/markdown',
          fileSize: buffer.length,
        },
        extra: {
          frontmatter,
          rawMarkdown: rawContent,
        },
      },
      sections,
    };
  }

  private extractTitle(content: string): string | undefined {
    // Check for H1 header
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // Check for underline-style H1
    const underlineMatch = content.match(/^(.+)\n=+\s*$/m);
    if (underlineMatch) return underlineMatch[1].trim();

    return undefined;
  }

  private removeFrontmatter(content: string): string {
    // Remove YAML frontmatter (between ---  lines)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (frontmatterMatch) {
      return content.slice(frontmatterMatch[0].length).trim();
    }
    return content;
  }

  private parseFrontmatter(content: string): Record<string, string> | undefined {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) return undefined;

    const yaml = frontmatterMatch[1];
    const result: Record<string, string> = {};

    // Simple YAML parsing for common fields
    const lines = yaml.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        result[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private stripMarkdown(content: string): string {
    return content
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      // Remove headers markers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      // Remove blockquotes
      .replace(/^>\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Clean up extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractSections(content: string): ParsedDocument['sections'] {
    const sections: ParsedDocument['sections'] = [];
    
    // Split by headers
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    let lastIndex = 0;
    let lastTitle = 'Introduction';
    let sectionIndex = 0;

    let match;
    while ((match = headerRegex.exec(content)) !== null) {
      // Get content before this header
      const sectionContent = content.slice(lastIndex, match.index).trim();
      if (sectionContent) {
        sections.push({
          index: sectionIndex++,
          title: lastTitle,
          content: this.stripMarkdown(sectionContent),
          metadata: { level: lastTitle === 'Introduction' ? 0 : (lastTitle.match(/^#+/) || [''])[0].length },
        });
      }

      lastIndex = match.index + match[0].length;
      lastTitle = match[2];
    }

    // Get remaining content
    const remainingContent = content.slice(lastIndex).trim();
    if (remainingContent) {
      sections.push({
        index: sectionIndex,
        title: lastTitle,
        content: this.stripMarkdown(remainingContent),
      });
    }

    return sections.filter(s => s.content.length > 0);
  }
}
