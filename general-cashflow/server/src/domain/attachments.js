import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { parse as parseCsv } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

const IMAGE_MIME_PATTERN = /^image\//i;

const isPdf = (file) =>
  String(file?.mimetype || '').toLowerCase() === 'application/pdf' ||
  String(file?.originalname || '').toLowerCase().endsWith('.pdf');

const isImage = (file) => IMAGE_MIME_PATTERN.test(String(file?.mimetype || ''));

const documentPathFor = (filePath) => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.document.pdf`);
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const csvDelimiter = (text) => {
  const sample = String(text || '').split(/\r?\n/).slice(0, 8).join('\n');
  const candidates = [',', '|', '\t', ';'];
  return candidates.reduce((best, candidate) => (
    sample.split(candidate).length > sample.split(best).length ? candidate : best
  ), ',');
};

const csvRowsForDocument = (buffer) => {
  const text = Buffer.from(buffer || '').toString('utf8').replace(/^\uFEFF/, '');
  try {
    return parseCsv(text, {
      bom: true,
      delimiter: csvDelimiter(text),
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch {
    return text.split(/\r?\n/).filter(Boolean).map((line) => [line]);
  }
};

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const parseMoneyCell = (value) => {
  const number = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
};

const krungsriEvidenceTotal = (rows) => {
  const headers = rows[0] || [];
  const amountColumn = headers.findIndex((header) => normalizeHeader(header) === 'transaction amount');
  if (amountColumn === -1) return null;
  return rows.slice(1).reduce((sum, row) => sum + parseMoneyCell(row[amountColumn]), 0);
};

const formatMoney = (amount) => Number(amount || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const evidenceDateCandidates = (value) => {
  const isoDate = String(value || '').slice(0, 10);
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, month, day] = match;
  return [isoDate, `${day}/${month}/${year}`, `${day}-${month}-${year}`, `${day}/${month}/${year.slice(-2)}`, `${day}-${month}-${year.slice(-2)}`];
};

const evidenceMoneyValues = (text) => [...String(text || '').matchAll(/(?:^|[^\d])(-?\d[\d,]*\.\d{2})(?!\d)/g)]
  .map((match) => Number(match[1].replaceAll(',', '')))
  .filter(Number.isFinite);

const evidenceTextHasAmount = (text, amount) => evidenceMoneyValues(text)
  .some((value) => Math.abs(Math.abs(value) - Math.abs(Number(amount))) < 0.005);

const evidenceTextHasDate = (text, date) => evidenceDateCandidates(date)
  .some((candidate) => String(text || '').includes(candidate));

export const findPdfEvidenceFocusPage = async ({ fileData, date, amount, password = '' }) => {
  if (!fileData?.length || !date || !Number.isFinite(Number(amount))) return null;
  const parser = new PDFParse({ data: Buffer.from(fileData), password: password || undefined });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const exact = pages.find((page) => evidenceTextHasDate(page.text, date) && evidenceTextHasAmount(page.text, amount));
    if (exact) return Number(exact.num);

    const amountMatches = pages.filter((page) => evidenceTextHasAmount(page.text, amount));
    if (amountMatches.length === 1) return Number(amountMatches[0].num);

    const dateMatches = pages.filter((page) => evidenceTextHasDate(page.text, date));
    return dateMatches.length === 1 ? Number(dateMatches[0].num) : null;
  } finally {
    await parser.destroy();
  }
};

// Bank CSV exports are useful evidence but browsers normally download them.
// Store a companion HTML table so the reviewer can read it inside the receipt.
export const createReadableEvidenceDocument = ({ fileName, mimeType, fileData }) => {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const isCsv = extension === '.csv' || /^text\/csv/i.test(String(mimeType || ''));
  if (!isCsv || !fileData?.length) return null;

  const rows = csvRowsForDocument(fileData).slice(0, 1200);
  const total = krungsriEvidenceTotal(rows);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ''));
  const header = normalizedRows[0] || [];
  const body = normalizedRows.slice(1);
  const table = `<table><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const truncated = rows.length >= 1200 ? '<p class="notice">แสดง 1,200 แถวแรก โปรดเปิดไฟล์ต้นฉบับหากต้องการตรวจข้อมูลทั้งหมด</p>' : '';
  const totalSummary = total === null ? '' : `<section class="total"><span>ยอดรวม QR กรุงศรี</span><strong>${formatMoney(total)} บาท</strong></section>`;
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(fileName)}</title><style>body{font-family:Arial,Tahoma,sans-serif;margin:24px;color:#172033;background:#fff}h1{font-size:20px;margin:0 0 6px}p{margin:0 0 18px;color:#526071}.total{display:flex;align-items:baseline;justify-content:space-between;gap:20px;padding:15px 18px;margin:0 0 18px;background:#edf8f2;border:1px solid #9dceb1;color:#125d38}.total span{font-size:14px;font-weight:700}.total strong{font-size:23px}.table-wrap{overflow:auto;border:1px solid #d9dee7}table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}th,td{padding:9px 11px;border-bottom:1px solid #e6e9ef;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#f3f6fa;color:#27364b}.notice{padding:10px 12px;background:#fff4d6;color:#765900}</style></head><body><h1>หลักฐานรายการธนาคาร</h1><p>${escapeHtml(fileName)}</p>${totalSummary}${truncated}<div class="table-wrap">${table}</div></body></html>`;
  return {
    mimeType: 'text/html; charset=utf-8',
    fileData: Buffer.from(html, 'utf8')
  };
};

const writePdfWithImage = ({ imageBuffer, outputPath }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      size: 'A4',
      info: {
        Title: 'Cashflow Attachment',
        Creator: 'General Cashflow'
      }
    });
    const stream = fs.createWriteStream(outputPath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);
    doc.addPage({ size: 'A4', margin: 0 });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 28;
    doc.rect(0, 0, pageWidth, pageHeight).fill('#ffffff');
    doc.image(imageBuffer, margin, margin, {
      fit: [pageWidth - margin * 2, pageHeight - margin * 2],
      align: 'center',
      valign: 'center'
    });
    doc.end();
  });

export const processAttachmentAsDocument = async (file) => {
  if (isPdf(file)) {
    return {
      documentPath: file.path,
      documentMimeType: 'application/pdf',
      documentSizeBytes: file.size,
      documentStatus: 'original_pdf',
      documentError: null
    };
  }

  if (!isImage(file)) {
    return {
      documentPath: null,
      documentMimeType: null,
      documentSizeBytes: null,
      documentStatus: 'original_only',
      documentError: null
    };
  }

  const outputPath = documentPathFor(file.path);
  try {
    const documentImage = await sharp(file.path)
      .rotate()
      .resize({ width: 1800, height: 2400, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalise()
      .sharpen({ sigma: 0.8 })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    await writePdfWithImage({ imageBuffer: documentImage, outputPath });
    const stat = await fsp.stat(outputPath);
    return {
      documentPath: outputPath,
      documentMimeType: 'application/pdf',
      documentSizeBytes: stat.size,
      documentStatus: 'document_pdf',
      documentError: null
    };
  } catch (error) {
    return {
      documentPath: null,
      documentMimeType: null,
      documentSizeBytes: null,
      documentStatus: 'failed',
      documentError: error.message
    };
  }
};
