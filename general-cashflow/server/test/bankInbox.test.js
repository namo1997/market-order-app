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
  krungsriInboxStatus,
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
  const optIn = await parseBankReportZip({ buffer: zip.toBuffer(), originalName: 'krungsri.zip', allowKrungsriZeroSummary: true });
  assert.equal(optIn.totalAmount, 578); assert.equal(optIn.transactionCount, 1);
  assert.equal(optIn.reviewRequired, undefined);
});

const zeroSummaryName = '070000000000001_from_20261017_to_20261017.zip';
const zeroSummaryLines = [
  'ALL TRANSACTION SUMMARY', 'MERCHANT ID|070000000000001', 'MERCHANT NAME|Fixture Company',
  'PAYMENT CHANNEL|TOTAL NBR|TOTAL TRANSACTION AMOUNT|TOTAL SERVICE FEE AMOUNT|TOTAL NET TRANSACTION AMOUNT',
  ...['ALIPAY', 'WECHAT', 'PROMPTPAY', 'VISA', 'MASTERCARD', 'GRAND TOTAL'].map(name => `${name}|0|0.00|0.00|0.00`)
];
const summaryZip = (lines = zeroSummaryLines, filename = 'SUMMARY_20261017.csv') => {
  const zip = new AdmZip(); zip.addFile(filename, Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8')); return zip.toBuffer();
};

test('explicit Krungsri zero summary preserves original bytes with no money transactions and requires review', async () => {
  const buffer = summaryZip();
  const result = await parseBankReportZip({ buffer, originalName: zeroSummaryName, allowKrungsriZeroSummary: true });
  assert.equal(result.transactionCount, 0); assert.deepEqual(result.transactions, []); assert.equal(result.totalAmount, 0);
  assert.deepEqual(result.emptySummary, { merchantId: '070000000000001', reportDate: '2026-10-17', explicitZeroActivity: true });
  assert.equal(result.reviewRequired, true); assert.equal(result.fileCount, 1);
  assert.deepEqual(result.files[0].fileData, new AdmZip(buffer).getEntries()[0].getData());
  assert.equal(krungsriInboxStatus({ reviewRequired: result.reviewRequired, linkedCount: 0, pendingCount: 0 }), 'PENDING_REVIEW');
});

test('summary-only support is opt-in and never accepts missing or contradictory zero evidence', async t => {
  await assert.rejects(parseBankReportZip({ buffer: summaryZip(), originalName: zeroSummaryName }), { statusCode: 400 });
  const cases = [
    ['positive transaction', lines => lines.map(l => l === 'VISA|0|0.00|0.00|0.00' ? 'VISA|1|100.00|0.00|100.00' : l)],
    ['missing count', lines => lines.map(l => l === 'ALIPAY|0|0.00|0.00|0.00' ? 'ALIPAY||0.00|0.00|0.00' : l)],
    ['missing amount', lines => lines.map(l => l === 'WECHAT|0|0.00|0.00|0.00' ? 'WECHAT|0||0.00|0.00' : l)],
    ['missing grand total', lines => lines.slice(0, -1)],
    ['duplicate channel', lines => lines.map(l => l.startsWith('VISA|') ? 'WECHAT|0|0.00|0.00|0.00' : l)],
    ['unknown channel', lines => lines.map(l => l.startsWith('VISA|') ? 'UNKNOWN|0|0.00|0.00|0.00' : l)],
    ['mismatched merchant', lines => lines.map(l => l.startsWith('MERCHANT ID|') ? 'MERCHANT ID|070000000000002' : l)],
    ['wrong document title', lines => ['UNKNOWN REPORT', ...lines.slice(1)]]
  ];
  for (const [name, edit] of cases) await t.test(name, async () => {
    await assert.rejects(parseBankReportZip({ buffer: summaryZip(edit([...zeroSummaryLines])), originalName: zeroSummaryName, allowKrungsriZeroSummary: true }), { statusCode: 422 });
  });
  await assert.rejects(parseBankReportZip({ buffer: summaryZip(), originalName: zeroSummaryName.replace(/to_20261017/, 'to_20261018'), allowKrungsriZeroSummary: true }), { statusCode: 422 });
  await assert.rejects(parseBankReportZip({ buffer: summaryZip(zeroSummaryLines, 'SUMMARY_20261018.csv'), originalName: zeroSummaryName, allowKrungsriZeroSummary: true }), { statusCode: 422 });
  await assert.rejects(parseBankReportZip({ buffer: summaryZip(zeroSummaryLines, 'SUMMARY_20260230.csv'), originalName: zeroSummaryName.replaceAll('20261017', '20260230'), allowKrungsriZeroSummary: true }), { statusCode: 422 });
});

test('normal Krungsri matching statuses remain unchanged', () => {
  assert.equal(krungsriInboxStatus({ linkedCount: 2, pendingCount: 0 }), 'AUTO_LINKED');
  assert.equal(krungsriInboxStatus({ linkedCount: 1, pendingCount: 1 }), 'PARTIAL_REVIEW');
  assert.equal(krungsriInboxStatus({ linkedCount: 0, pendingCount: 1 }), 'PENDING_REVIEW');
});
