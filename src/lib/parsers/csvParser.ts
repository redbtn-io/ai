/**
 * @file CSV Parser
 * @description Parse CSV files to extract tabular data as text
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class CsvParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return ['text/csv', 'application/csv', 'text/comma-separated-values'].includes(mimeType);
  }

  supportsExtension(ext: string): boolean {
    return ['.csv'].includes(ext.toLowerCase());
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    const rawContent = buffer.toString('utf8');
    
    // Parse CSV
    const rows = this.parseCSV(rawContent);
    
    if (rows.length === 0) {
      return {
        content: '',
        metadata: {
          wordCount: 0,
          charCount: 0,
          source: {
            filename,
            mimeType: 'text/csv',
            fileSize: buffer.length,
          },
        },
      };
    }

    // Get headers (first row)
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Convert to readable text format
    let textContent = `# ${filename}\n\n`;
    textContent += `**Columns:** ${headers.join(', ')}\n`;
    textContent += `**Rows:** ${dataRows.length}\n\n`;
    
    // Add data as markdown table (first 100 rows for preview)
    const previewRows = dataRows.slice(0, 100);
    
    if (previewRows.length > 0) {
      // Table header
      textContent += '| ' + headers.join(' | ') + ' |\n';
      textContent += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
      
      // Table rows
      for (const row of previewRows) {
        // Pad row to match header count
        while (row.length < headers.length) row.push('');
        textContent += '| ' + row.map(cell => cell.replace(/\|/g, '\\|')).join(' | ') + ' |\n';
      }
      
      if (dataRows.length > 100) {
        textContent += `\n*... and ${dataRows.length - 100} more rows*\n`;
      }
    }

    // Also create a plain text version for vector search
    const plainText = rows.map(row => row.join('\t')).join('\n');
    const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      content: plainText,
      metadata: {
        wordCount,
        charCount: plainText.length,
        source: {
          filename,
          mimeType: 'text/csv',
          fileSize: buffer.length,
        },
        extra: {
          rowCount: dataRows.length,
          columnCount: headers.length,
          headers,
          markdownPreview: textContent,
        },
      },
    };
  }

  private parseCSV(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];
      
      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // Escaped quote
            currentCell += '"';
            i++;
          } else {
            // End of quoted field
            inQuotes = false;
          }
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
          if (char === '\r') i++; // Skip \n in \r\n
        } else if (char !== '\r') {
          currentCell += char;
        }
      }
    }
    
    // Handle last row
    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
    }
    
    return rows;
  }
}
