/**
 * @file Excel Parser
 * @description Parse Excel (XLSX/XLS) files to extract tabular data as text
 */

import type { IParser, ParsedDocument, ParseOptions } from './documentParser';

export class ExcelParser implements IParser {
  supportsMimeType(mimeType: string): boolean {
    return [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/vnd.ms-excel', // xls
    ].includes(mimeType);
  }

  supportsExtension(ext: string): boolean {
    return ['.xlsx', '.xls'].includes(ext.toLowerCase());
  }

  async parse(buffer: Buffer, filename: string, options?: ParseOptions): Promise<ParsedDocument> {
    // Dynamically import xlsx to avoid bundling issues
    let XLSX: typeof import('xlsx');
    try {
      XLSX = await import('xlsx');
    } catch {
      throw new Error('xlsx not installed. Run: npm install xlsx');
    }

    // Parse workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const allContent: string[] = [];
    const sheetSummaries: Array<{ name: string; rows: number; cols: number }> = [];
    let totalRows = 0;
    let totalCols = 0;

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      
      // Convert to JSON array
      const data: string[][] = XLSX.utils.sheet_to_json(sheet, { 
        header: 1,
        defval: '',
      }) as string[][];
      
      if (data.length === 0) continue;

      const rows = data.filter(row => row.some(cell => cell !== ''));
      if (rows.length === 0) continue;

      const colCount = Math.max(...rows.map(r => r.length));
      
      sheetSummaries.push({
        name: sheetName,
        rows: rows.length,
        cols: colCount,
      });
      
      totalRows += rows.length;
      totalCols = Math.max(totalCols, colCount);

      // Add sheet content
      allContent.push(`## Sheet: ${sheetName}\n`);
      
      // Convert to tab-separated text
      for (const row of rows) {
        const cells = row.map(cell => 
          cell === null || cell === undefined ? '' : String(cell)
        );
        allContent.push(cells.join('\t'));
      }
      
      allContent.push(''); // Empty line between sheets
    }

    const content = allContent.join('\n').trim();
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    return {
      content,
      metadata: {
        wordCount,
        charCount: content.length,
        source: {
          filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileSize: buffer.length,
        },
        extra: {
          sheetCount: workbook.SheetNames.length,
          sheetNames: workbook.SheetNames,
          sheets: sheetSummaries,
          totalRows,
          totalColumns: totalCols,
        },
      },
    };
  }
}
