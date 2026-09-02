import assert from 'node:assert/strict';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  decryptPdfBuffer,
  deriveKtcSettlementAfterCashierEdit,
  deriveKtcSettlementComparison,
  parseBankReportZip
} from '../src/domain/bankInbox.js';

test('KTC records an oversized bank deposit as actual money with a visible exception', () => {
  const result = deriveKtcSettlementComparison({ cashierAmount: 18148, bankAmount: 26438.10 });

  assert.equal(result.actualAmount, 26438.10);
  assert.equal(result.feeAmount, 0);
  assert.equal(result.expectedNetAmount, 18148);
  assert.equal(result.settlementVarianceAmount, 8290.10);
  assert.equal(result.settlementSource, 'BANK_STATEMENT');
  assert.equal(result.settlementStatus, 'EXCEPTION');
  assert.equal(result.canInferFee, false);
});

test('KTC infers a normal fee only when the bank deposit is plausibly below cashier sales', () => {
  const result = deriveKtcSettlementComparison({ cashierAmount: 24606, bankAmount: 23990.09 });

  assert.equal(result.feeAmount, 615.91);
  assert.equal(result.expectedNetAmount, 23990.09);
  assert.equal(result.settlementVarianceAmount, 0);
  assert.equal(result.settlementStatus, 'MATCHED_AUTO');
  assert.equal(result.canInferFee, true);
});

test('KTC cashier correction recalculates fee from the preserved bank deposit', () => {
  const result = deriveKtcSettlementAfterCashierEdit({
    channelCode: 'CREDIT_CARD_KTC',
    cashierAmount: 10421,
    statementAmount: 10141.34,
    settlementSource: 'BANK_STATEMENT'
  });

  assert.equal(result.grossAmount, 10421);
  assert.equal(result.feeAmount, 279.66);
  assert.equal(result.expectedNetAmount, 10141.34);
  assert.equal(result.actualAmount, 10141.34);
  assert.equal(result.settlementVarianceAmount, 0);
  assert.equal(result.settlementStatus, 'MATCHED_AUTO');
});

test('KTC cashier correction does not rewrite grouped or manually entered settlements', () => {
  const base = {
    channelCode: 'CREDIT_CARD_KTC',
    cashierAmount: 10421,
    statementAmount: 10141.34,
    settlementSource: 'BANK_STATEMENT'
  };

  assert.equal(deriveKtcSettlementAfterCashierEdit({ ...base, settlementBatchKey: 'KTC-two-day-batch' }), null);
  assert.equal(deriveKtcSettlementAfterCashierEdit({ ...base, settlementSource: 'MANUAL' }), null);
  assert.equal(deriveKtcSettlementAfterCashierEdit({ ...base, channelCode: 'CREDIT_CARD_SCB' }), null);
});

test('KTC cashier correction keeps an oversized deposit visible as an exception', () => {
  const result = deriveKtcSettlementAfterCashierEdit({
    channelCode: 'CREDIT_CARD_KTC',
    cashierAmount: 9000,
    statementAmount: 10141.34,
    settlementSource: 'BANK_STATEMENT'
  });

  assert.equal(result.feeAmount, 0);
  assert.equal(result.expectedNetAmount, 9000);
  assert.equal(result.actualAmount, 10141.34);
  assert.equal(result.settlementVarianceAmount, 1141.34);
  assert.equal(result.settlementStatus, 'EXCEPTION');
});

test('decryptPdfBuffer uses the configured server-side password process and returns an openable copy', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cashflow-qpdf-test-'));
  const qpdfStub = path.join(tempDir, 'qpdf-stub');
  try {
    await fs.writeFile(qpdfStub, '#!/bin/sh\ncp "$3" "$4"\n');
    await fs.chmod(qpdfStub, 0o755);
    const source = Buffer.from('%PDF-openable-evidence');
    const result = await decryptPdfBuffer({
      buffer: source,
      password: 'server-only-password',
      qpdfPath: qpdfStub
    });

    assert.deepEqual(result, source);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('decryptPdfBuffer leaves a PDF unchanged when no bank password is configured', async () => {
  const source = Buffer.from('%PDF-no-password');
  const result = await decryptPdfBuffer({ buffer: source, password: '', qpdfPath: '/not-needed' });
  assert.strictEqual(result, source);
});

test('parseBankReportZip reads CSV statements within a ZIP archive', async () => {
  const zip = new AdmZip();
  zip.addFile('daily-report.csv', Buffer.from([
    'วันที่,รายการ,เลขที่อ้างอิง,ยอดเงิน',
    '2026-07-19,รับชำระ QR,KR001,"1,250.50"'
  ].join('\n'), 'utf8'));

  const result = await parseBankReportZip({
    buffer: zip.toBuffer(),
    originalName: 'krungsri.zip'
  });

  assert.equal(result.fileCount, 1);
  assert.equal(result.transactionCount, 1);
  assert.equal(result.totalAmount, 1250.5);
  assert.equal(result.transactions[0].sourceFileName, 'daily-report.csv');
  assert.equal(result.transactions[0].amount, 1250.5);
});

test('parseBankReportZip reads Krungsri pipe-delimited payment reports and excludes summary totals', async () => {
  const zip = new AdmZip();
  zip.addFile('PROMPTPAY_20260719.csv', Buffer.from([
    'Merchant ID|Transaction ID|Transaction amount|Service Fee|Net Transaction amount|QR type|Transaction paid time',
    '070000010053466|2607190001|578.00|0.00|578.00|Static|2026-07-19 12:19:28'
  ].join('\n'), 'utf8'));
  zip.addFile('SUMMARY_20260719.csv', Buffer.from([
    'PAYMENT CHANNEL|TOTAL NBR|TOTAL TRANSACTION AMOUNT',
    'PROMPTPAY|1|578.00'
  ].join('\n'), 'utf8'));

  const result = await parseBankReportZip({ buffer: zip.toBuffer(), originalName: 'krungsri.zip' });

  assert.equal(result.fileCount, 1);
  assert.equal(result.transactionCount, 1);
  assert.equal(result.totalAmount, 578);
  assert.equal(result.profiles[0].profile.code, 'KRUNGSRI_BIZ_MUNG_MEE');
  assert.equal(result.transactions[0].transactionDate, '2026-07-19');
});
