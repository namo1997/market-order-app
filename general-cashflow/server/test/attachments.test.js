import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { createReadableEvidenceDocument, findPdfEvidenceFocusPage, processAttachmentAsDocument } from '../src/domain/attachments.js';

const buildEvidencePdf = () => new Promise((resolve, reject) => {
  const chunks = [];
  const document = new PDFDocument({ margin: 36 });
  document.on('data', (chunk) => chunks.push(chunk));
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.on('error', reject);
  document.text('26/08/2026 Single credit 5,500.00');
  document.addPage();
  document.text('27/08/2026 Single credit 10,141.34');
  document.addPage();
  document.text('28/08/2026 Single credit 1,042.00');
  document.end();
});

test('processAttachmentAsDocument converts an image upload to a PDF document', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cashflow-attachment-'));
  const imagePath = path.join(tempDir, 'receipt.png');
  await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: '#ffffff'
    }
  })
    .png()
    .toFile(imagePath);
  const stat = await fsp.stat(imagePath);

  const result = await processAttachmentAsDocument({
    path: imagePath,
    originalname: 'receipt.png',
    mimetype: 'image/png',
    size: stat.size
  });

  assert.equal(result.documentMimeType, 'application/pdf');
  assert.equal(result.documentStatus, 'document_pdf');
  assert.ok(result.documentSizeBytes > 0);

  const header = await fsp.readFile(result.documentPath, { encoding: 'utf8', flag: 'r' });
  assert.equal(header.slice(0, 4), '%PDF');
});

test('createReadableEvidenceDocument turns a bank CSV into an in-app HTML table', () => {
  const document = createReadableEvidenceDocument({
    fileName: 'PROMPTPAY_20260803.csv',
    mimeType: 'application/octet-stream',
    fileData: Buffer.from('วันที่|จำนวนเงิน|รายการ\n2026-08-03|500.00|Thai QR Payment', 'utf8')
  });

  assert.equal(document.mimeType, 'text/html; charset=utf-8');
  const html = document.fileData.toString('utf8');
  assert.match(html, /Thai QR Payment/);
  assert.match(html, /500\.00/);
  assert.doesNotMatch(html, /ยอดรวม QR กรุงศรี/);
  assert.match(html, /<table>/);
});

test('createReadableEvidenceDocument shows the Krungsri total from Transaction amount', () => {
  const document = createReadableEvidenceDocument({
    fileName: 'PROMPTPAY_20260803.csv',
    fileData: Buffer.from([
      'Merchant ID|Transaction amount|Net Transaction amount',
      '070000010053466|578.00|577.00',
      '070000010053466|422.50|421.50'
    ].join('\n'), 'utf8')
  });

  assert.match(document.fileData.toString('utf8'), /ยอดรวม QR กรุงศรี<\/span><strong>1,000\.50 บาท/);
});

test('findPdfEvidenceFocusPage locates the page containing the selected date and amount', async () => {
  const fileData = await buildEvidencePdf();
  const page = await findPdfEvidenceFocusPage({
    fileData,
    date: '2026-08-27',
    amount: 10141.34
  });
  assert.equal(page, 2);
});
