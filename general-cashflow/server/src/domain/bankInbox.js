import AdmZip from 'adm-zip';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseStatementFile } from './statements.js';
import { roundMoney } from './money.js';

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.pdf']);
const MAX_ARCHIVE_ENTRIES = 20;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export const deriveKtcSettlementComparison = ({ cashierAmount, bankAmount, maxFeeRate = 0.1 }) => {
  const grossAmount = roundMoney(cashierAmount);
  const actualAmount = roundMoney(bankAmount);
  const inferredFeeAmount = roundMoney(grossAmount - actualAmount);
  const feeRate = grossAmount > 0 ? inferredFeeAmount / grossAmount : 1;
  const canInferFee = grossAmount > 0
    && actualAmount > 0
    && inferredFeeAmount >= 0
    && feeRate <= maxFeeRate;

  return {
    grossAmount,
    actualAmount,
    feeAmount: canInferFee ? inferredFeeAmount : 0,
    expectedNetAmount: canInferFee ? actualAmount : grossAmount,
    settlementSource: canInferFee ? 'BANK_SETTLEMENT' : 'BANK_STATEMENT',
    settlementStatus: canInferFee ? 'MATCHED_AUTO' : 'EXCEPTION',
    settlementVarianceAmount: canInferFee ? 0 : roundMoney(actualAmount - grossAmount),
    canInferFee
  };
};

const KTC_RECALCULABLE_SOURCES = new Set(['BANK_STATEMENT', 'BANK_SETTLEMENT']);

export const deriveKtcSettlementAfterCashierEdit = ({
  channelCode,
  cashierAmount,
  statementAmount,
  settlementSource,
  settlementBatchKey
}) => {
  if (String(channelCode || '').toUpperCase() !== 'CREDIT_CARD_KTC') return null;
  if (settlementBatchKey) return null;
  if (!KTC_RECALCULABLE_SOURCES.has(String(settlementSource || '').toUpperCase())) return null;

  const actualAmount = roundMoney(statementAmount);
  if (actualAmount <= 0) return null;
  return deriveKtcSettlementComparison({ cashierAmount, bankAmount: actualAmount });
};

const safeEntryName = (name) => {
  const normalized = path.posix.normalize(String(name || '').replaceAll('\\', '/'));
  return !normalized.startsWith('../') && normalized !== '..' && !path.posix.isAbsolute(normalized);
};

// Banking portals often put a password on the PDF inside an otherwise ordinary
// ZIP. Read it with the server-only password, then save an openable evidence PDF
// so the reviewer is never prompted for that password in their browser.
export const decryptPdfBuffer = async ({ buffer, password, qpdfPath = process.env.CASHFLOW_QPDF_PATH || 'qpdf' }) => {
  if (!password) return buffer;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashflow-unlock-'));
  const inputPath = path.join(tempDir, 'source.pdf');
  const outputPath = path.join(tempDir, 'openable.pdf');
  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync(qpdfPath, [`--password=${password}`, '--decrypt', inputPath, outputPath], {
      maxBuffer: 2 * 1024 * 1024
    });
    const decrypted = await fs.readFile(outputPath);
    if (decrypted.length === 0) throw new Error('qpdf returned an empty PDF');
    return decrypted;
  } catch (cause) {
    const error = new Error('ไม่สามารถปลดรหัส PDF เพื่อเปิดในระบบได้ กรุณาตรวจรหัสเอกสารที่ตั้งค่าไว้');
    error.statusCode = 422;
    error.cause = cause;
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const parseKrungsriZeroSummary = ({ fileData, fileName, originalName }) => {
  const fail = () => {
    const error = new Error('รายงานสรุปกรุงศรีไม่มีรายละเอียด และยังยืนยันรายงานศูนย์รายการจากต้นฉบับไม่ได้');
    error.statusCode = 422;
    throw error;
  };
  const name = String(originalName || '').match(/^(\d{15})_from_(20\d{6})_to_\2\.zip$/i);
  if (!name || fileName.toUpperCase() !== `SUMMARY_${name[2]}.CSV`) return fail();
  const reportDate = `${name[2].slice(0, 4)}-${name[2].slice(4, 6)}-${name[2].slice(6, 8)}`;
  const date = new Date(`${reportDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== reportDate) return fail();
  const lines = fileData.toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = 'PAYMENT CHANNEL|TOTAL NBR|TOTAL TRANSACTION AMOUNT|TOTAL SERVICE FEE AMOUNT|TOTAL NET TRANSACTION AMOUNT';
  if (lines[0] !== 'ALL TRANSACTION SUMMARY' || lines[1] !== `MERCHANT ID|${name[1]}`
    || !/^MERCHANT NAME\|\S/.test(lines[2] || '') || lines[3] !== header) return fail();
  const channels = ['ALIPAY', 'WECHAT', 'PROMPTPAY', 'VISA', 'MASTERCARD', 'GRAND TOTAL'];
  const rows = lines.slice(4).map(line => line.split('|').map(cell => cell.trim()));
  if (rows.length !== channels.length || new Set(rows.map(row => row[0])).size !== channels.length
    || rows.some(row => row.length !== 5 || !channels.includes(row[0]) || !/^0+$/.test(row[1])
      || row.slice(2).some(value => !/^0+(?:\.0{1,2})?$/.test(value)))) return fail();
  return { merchantId: name[1], reportDate, explicitZeroActivity: true };
};

export const krungsriInboxStatus = ({ reviewRequired = false, linkedCount, pendingCount }) => reviewRequired
  ? 'PENDING_REVIEW' : pendingCount === 0 ? 'AUTO_LINKED' : linkedCount > 0 ? 'PARTIAL_REVIEW' : 'PENDING_REVIEW';

export const parseBankReportZip = async ({ buffer, originalName, password = '', allowKrungsriZeroSummary = false }) => {
  let archive;
  try {
    archive = new AdmZip(buffer);
  } catch {
    const error = new Error('ไฟล์ที่ส่งมาไม่ใช่ ZIP ที่อ่านได้');
    error.statusCode = 400;
    throw error;
  }

  const entries = archive.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    const error = new Error('ZIP ต้องมีไฟล์ข้อมูล 1-20 ไฟล์');
    error.statusCode = 400;
    throw error;
  }

  const parsedFiles = [];
  let extractedBytes = 0;
  for (const entry of entries) {
    if (!safeEntryName(entry.entryName)) {
      const error = new Error('พบชื่อไฟล์ ZIP ที่ไม่ปลอดภัย');
      error.statusCode = 400;
      throw error;
    }
    const fileName = path.posix.basename(entry.entryName);
    const extension = path.extname(fileName).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
    // Krungsri's summary repeats totals from the detailed payment files. Importing
    // it would double-count transactions that the auditor is meant to reconcile.
    if (/^summary[_-]/i.test(fileName)) continue;
    let fileBuffer;
    try {
      fileBuffer = password ? entry.getData(password) : entry.getData();
    } catch (error) {
      if (/password/i.test(String(error.message || error))) {
        const passwordError = new Error('ไฟล์ ZIP ถูกเข้ารหัส แต่ยังไม่มีรหัสที่ใช้งานได้สำหรับธนาคารนี้');
        passwordError.statusCode = 422;
        throw passwordError;
      }
      throw error;
    }
    extractedBytes += fileBuffer.length;
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      const error = new Error('ข้อมูลหลังแตก ZIP มีขนาดเกินกำหนด');
      error.statusCode = 413;
      throw error;
    }
    const readableFileBuffer = extension === '.pdf'
      ? await decryptPdfBuffer({ buffer: fileBuffer, password })
      : fileBuffer;
    const parsed = await parseStatementFile({
      buffer: readableFileBuffer,
      originalName: fileName,
      mimeType: extension === '.pdf' ? 'application/pdf' : undefined,
      password: ''
    });
    parsedFiles.push({
      fileName,
      profile: parsed.profile,
      rows: parsed.rows,
      mimeType: extension === '.pdf' ? 'application/pdf' : 'application/octet-stream',
      fileData: readableFileBuffer
    });
  }

  if (parsedFiles.length === 0) {
    // A zero-activity report is still evidence. Only the Krungsri inbox route opts
    // in, and only a complete, explicit zero summary may take this path. It never
    // creates money transactions or an automatic receipt match.
    const entry = entries[0];
    if (allowKrungsriZeroSummary && entries.length === 1 && /^SUMMARY_\d{8}\.csv$/i.test(entry.entryName)) {
      const fileData = entry.getData();
      if (fileData.length > MAX_EXTRACTED_BYTES) {
        const error = new Error('ข้อมูลหลังแตก ZIP มีขนาดเกินกำหนด'); error.statusCode = 413; throw error;
      }
      const emptySummary = parseKrungsriZeroSummary({ fileData, fileName: entry.entryName, originalName });
      return { fileCount: 1, transactionCount: 0, totalAmount: 0, transactions: [], reviewRequired: true, emptySummary,
        profiles: [{ fileName: entry.entryName, profile: { code: 'KRUNGSRI_ZERO_ACTIVITY_SUMMARY', label: 'Krungsri explicit zero-activity summary' }, rowCount: 0 }],
        files: [{ fileName: entry.entryName, mimeType: 'text/csv', fileData }] };
    }
    const error = new Error(`ไม่พบ CSV, Excel หรือ PDF ที่อ่านได้ใน ${originalName || 'ZIP'}`);
    error.statusCode = 400;
    throw error;
  }

  const transactions = parsedFiles.flatMap((file) => file.rows.map((row) => ({
    ...row,
    merchantId: String(
      row.rawPayload?.['Merchant ID'] || row.rawPayload?.merchant_id || row.rawPayload?.merchantId || ''
    ).trim(),
    sourceFileName: file.fileName,
    uniqueHash: crypto.createHash('sha256')
      .update(`${file.fileName}|${row.uniqueHash}`)
      .digest('hex')
  })));
  return {
    fileCount: parsedFiles.length,
    transactionCount: transactions.length,
    totalAmount: roundMoney(transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    profiles: parsedFiles.map(({ fileName, profile, rows }) => ({ fileName, profile, rowCount: rows.length })),
    files: parsedFiles.map(({ fileName, mimeType, fileData }) => ({ fileName, mimeType, fileData })),
    transactions
  };
};

export const parseBankReportFile = async ({ buffer, originalName, password = '' }) => {
  if (/\.zip$/i.test(String(originalName || ''))) {
    return parseBankReportZip({ buffer, originalName, password });
  }
  if (!/\.pdf$/i.test(String(originalName || ''))) {
    const error = new Error('รองรับเฉพาะไฟล์ ZIP หรือ PDF จากธนาคาร');
    error.statusCode = 400;
    throw error;
  }

  const fileData = await decryptPdfBuffer({ buffer, password });
  const parsed = await parseStatementFile({
    buffer: fileData,
    originalName,
    mimeType: 'application/pdf',
    password: ''
  });
  const transactions = parsed.rows.map((row) => ({
    ...row,
    merchantId: String(
      row.rawPayload?.['Merchant ID'] || row.rawPayload?.merchant_id || row.rawPayload?.merchantId || ''
    ).trim(),
    sourceFileName: originalName,
    uniqueHash: crypto.createHash('sha256')
      .update(`${originalName}|${row.uniqueHash}`)
      .digest('hex')
  }));
  return {
    fileCount: 1,
    transactionCount: transactions.length,
    totalAmount: roundMoney(transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    profiles: [{ fileName: originalName, profile: parsed.profile, rowCount: parsed.rows.length }],
    files: [{ fileName: originalName, mimeType: 'application/pdf', fileData }],
    transactions
  };
};
