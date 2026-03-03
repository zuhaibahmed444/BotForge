import {
  Document,
  Paragraph,
  TextRun,
  Packer,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ExternalHyperlink,
} from 'docx';
import { jsPDF } from 'jspdf';
import { marked } from 'marked';

// Configure marked for better parsing
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
});

interface ParsedElement {
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'hr' | 'blockquote';
  level?: number;
  text?: string;
  items?: Array<{ text: string; ordered: boolean }>;
  rows?: string[][];
  language?: string;
  ordered?: boolean;
}

/**
 * Parse markdown content using marked library
 */
function parseMarkdown(content: string): ParsedElement[] {
  const tokens = marked.lexer(content);
  const elements: ParsedElement[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        elements.push({
          type: 'heading',
          level: token.depth,
          text: stripHtml(token.text),
        });
        break;

      case 'paragraph':
        elements.push({
          type: 'paragraph',
          text: stripHtml(token.text),
        });
        break;

      case 'list':
        const items = token.items.map((item: any) => ({
          text: stripHtml(item.text),
          ordered: token.ordered,
        }));
        elements.push({
          type: 'list',
          items,
          ordered: token.ordered,
        });
        break;

      case 'table':
        const rows: string[][] = [];
        // Header row
        rows.push(token.header.map((cell: any) => stripHtml(cell.text)));
        // Body rows
        token.rows.forEach((row: any) => {
          rows.push(row.map((cell: any) => stripHtml(cell.text)));
        });
        elements.push({
          type: 'table',
          rows,
        });
        break;

      case 'code':
        elements.push({
          type: 'code',
          text: token.text,
          language: token.lang || 'text',
        });
        break;

      case 'hr':
        elements.push({ type: 'hr' });
        break;

      case 'blockquote':
        elements.push({
          type: 'blockquote',
          text: stripHtml(token.text),
        });
        break;

      case 'space':
        // Add spacing
        elements.push({
          type: 'paragraph',
          text: '',
        });
        break;
    }
  }

  return elements;
}

/**
 * Strip HTML tags and convert markdown inline formatting to plain text with markers
 */
function stripHtml(text: string): string {
  // Convert <strong> or <b> to **text**
  text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
  
  // Convert <em> or <i> to *text*
  text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
  
  // Convert <code> to `text`
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  
  // Convert <a> to [text](url)
  text = text.replace(/<a href="(.*?)">(.*?)<\/a>/gi, '$2 ($1)');
  
  // Remove remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  
  return text;
}

/**
 * Parse text with inline formatting (bold, italic, code)
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|[^*`]+)/g;
  const matches = text.match(regex) || [text];

  for (const match of matches) {
    if (match.startsWith('**') && match.endsWith('**')) {
      // Bold
      runs.push(new TextRun({ text: match.slice(2, -2), bold: true }));
    } else if (match.startsWith('*') && match.endsWith('*')) {
      // Italic
      runs.push(new TextRun({ text: match.slice(1, -1), italics: true }));
    } else if (match.startsWith('`') && match.endsWith('`')) {
      // Inline code
      runs.push(new TextRun({ text: match.slice(1, -1), font: 'Courier New', size: 20 }));
    } else {
      // Regular text
      runs.push(new TextRun(match));
    }
  }

  return runs;
}

/**
 * Export markdown content as a DOCX file with full formatting
 */
export async function exportAsDocx(filename: string, content: string): Promise<void> {
  const elements = parseMarkdown(content);
  const children: (Paragraph | Table)[] = [];

  const headingLevels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];

  for (const element of elements) {
    switch (element.type) {
      case 'heading':
        children.push(
          new Paragraph({
            children: parseInlineFormatting(element.text || ''),
            heading: headingLevels[(element.level || 1) - 1],
            spacing: { before: 240, after: 120 },
          })
        );
        break;

      case 'paragraph':
        if (element.text?.trim()) {
          children.push(
            new Paragraph({
              children: parseInlineFormatting(element.text),
              spacing: { before: 100, after: 100 },
            })
          );
        } else {
          children.push(new Paragraph({ text: '' }));
        }
        break;

      case 'list':
        element.items?.forEach((item, index) => {
          if (element.ordered) {
            children.push(
              new Paragraph({
                children: parseInlineFormatting(item.text),
                numbering: { reference: 'default-numbering', level: 0 },
                spacing: { before: 60, after: 60 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                children: parseInlineFormatting(item.text),
                bullet: { level: 0 },
                spacing: { before: 60, after: 60 },
              })
            );
          }
        });
        break;

      case 'table':
        if (element.rows && element.rows.length > 0) {
          const tableRows = element.rows.map((row, rowIndex) => {
            return new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: parseInlineFormatting(cell),
                      }),
                    ],
                    shading: rowIndex === 0 ? { fill: 'E0E0E0' } : undefined,
                  })
              ),
            });
          });

          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1 },
                bottom: { style: BorderStyle.SINGLE, size: 1 },
                left: { style: BorderStyle.SINGLE, size: 1 },
                right: { style: BorderStyle.SINGLE, size: 1 },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
                insideVertical: { style: BorderStyle.SINGLE, size: 1 },
              },
            })
          );
        }
        break;

      case 'code':
        const codeLines = (element.text || '').split('\n');
        codeLines.forEach((line) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line || ' ',
                  font: 'Courier New',
                  size: 20,
                }),
              ],
              spacing: { before: 30, after: 30 },
            })
          );
        });
        break;

      case 'hr':
        children.push(
          new Paragraph({
            text: '─'.repeat(50),
            spacing: { before: 120, after: 120 },
          })
        );
        break;

      case 'blockquote':
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: element.text || '',
                italics: true,
              }),
            ],
            spacing: { before: 100, after: 100 },
            indent: { left: 720 },
          })
        );
        break;
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, filename.replace(/\.[^.]+$/, '.docx'));
}

/**
 * Export markdown content as a PDF file with full formatting
 */
export function exportAsPdf(filename: string, content: string): void {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - 2 * margin;
  let y = margin;

  const elements = parseMarkdown(content);

  for (const element of elements) {
    // Check if we need a new page
    const estimatedHeight = element.type === 'heading' ? 12 : 7;
    if (y + estimatedHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }

    switch (element.type) {
      case 'heading': {
        const fontSize = Math.max(18 - (element.level || 1) * 2, 11);
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', 'bold');
        const lines = doc.splitTextToSize(element.text || '', maxWidth);
        doc.text(lines, margin, y);
        y += lines.length * (fontSize / 2) + 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        break;
      }

      case 'paragraph':
        if (element.text?.trim()) {
          doc.setFontSize(11);
          const lines = doc.splitTextToSize(element.text, maxWidth);
          doc.text(lines, margin, y);
          y += lines.length * 6 + 4;
        } else {
          y += 4;
        }
        break;

      case 'list':
        element.items?.forEach((item, index) => {
          doc.setFontSize(11);
          const bullet = element.ordered ? `${index + 1}.` : '•';
          doc.text(bullet, margin, y);
          const lines = doc.splitTextToSize(item.text, maxWidth - 10);
          doc.text(lines, margin + 10, y);
          y += lines.length * 6 + 3;
        });
        break;

      case 'table':
        if (element.rows && element.rows.length > 0) {
          const colWidth = maxWidth / element.rows[0].length;
          
          element.rows.forEach((row, rowIndex) => {
            if (y + 10 > pageHeight - margin) {
              doc.addPage();
              y = margin;
            }

            // Header row with background
            if (rowIndex === 0) {
              doc.setFillColor(224, 224, 224);
              doc.rect(margin, y - 5, maxWidth, 8, 'F');
              doc.setFont('helvetica', 'bold');
            } else {
              doc.setFont('helvetica', 'normal');
            }

            doc.setFontSize(10);
            row.forEach((cell, colIndex) => {
              const x = margin + colIndex * colWidth;
              const cellText = doc.splitTextToSize(cell, colWidth - 4);
              doc.text(cellText, x + 2, y);
            });

            y += 8;
            
            // Draw border
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, y, margin + maxWidth, y);
          });
          
          y += 6;
          doc.setFont('helvetica', 'normal');
        }
        break;

      case 'code':
        doc.setFont('courier', 'normal');
        doc.setFontSize(9);
        const codeLines = (element.text || '').split('\n');
        codeLines.forEach((line) => {
          if (y + 5 > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += 5;
        });
        y += 3;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        break;

      case 'hr':
        doc.setDrawColor(150, 150, 150);
        doc.line(margin, y, margin + maxWidth, y);
        y += 8;
        break;

      case 'blockquote':
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        const quoteLines = doc.splitTextToSize(element.text || '', maxWidth - 20);
        doc.text(quoteLines, margin + 10, y);
        y += quoteLines.length * 6 + 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        break;
    }
  }

  doc.save(filename.replace(/\.[^.]+$/, '.pdf'));
}

/**
 * Download a blob as a file
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
