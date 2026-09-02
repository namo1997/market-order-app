import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  kasikornPdfIncomingAmount,
  parseKrungthaiHistoricalTextRows,
  parseScbMonthlyCardPdf,
  parseStatementBuffer,
  parseStatementFile
} from '../src/domain/statements.js';

test('parseScbMonthlyCardPdf keeps only SCB EDC deposits from a monthly PDF', async (t) => {
  const filePath = '/Users/surachart/Downloads/HISTSTMT_RPT2608171147331982_26081711474210001.PDF';
  if (!fs.existsSync(filePath)) {
    t.skip('local SCB monthly PDF sample is not available');
    return;
  }
  const result = await parseScbMonthlyCardPdf({ buffer: fs.readFileSync(filePath) });
  assert.equal(result.accountNumber, '4070578401');
  assert.equal(result.from, '2026-07-01');
  assert.equal(result.to, '2026-07-31');
  assert.equal(result.rows.length, 29);
  assert.equal(result.rows[0].transactionDate, '2026-07-01');
  assert.equal(result.rows[0].amount, 6225.35);
  assert.ok(result.rows.every((row) => /CREDIT CARD DIVISION|EDC/i.test(row.description)));
});

test('Kasikorn PDF QR amount ignores a carried balance at a page break', () => {
  const text = [
    'รับเงินจากการขายด้วย Thai QR Payment 59,108.60 398,000.43',
    'EDC/K SHOP/MYQR จาก KB000001927650'
  ].join(' ');
  assert.equal(kasikornPdfIncomingAmount(text), 59108.6);
});

test('Kasikorn PDF Alipay/WeChat amount ignores the following account balance', () => {
  const text = [
    'รับเงินจากการขายด้วย Alipay/ 770.58 611,800.51',
    'โอนเข้า/หักบัญชีอัตโนมัติ จาก 401016008919001 SOLAO WeChat'
  ].join(' ');
  assert.equal(kasikornPdfIncomingAmount(text), 770.58);
});

test('Kasikorn PDF Grab amount ignores a carried balance at a page break', () => {
  const text = [
    '16-07-26 04:37 ตู้เติมเงิน / โมบาย แอปพลิเคชัน /เงินโอน 35,434.68',
    'จาก X3812 บจก. แกร็บแท็กซี่ ++ รับโอนเงิน 4,059.32',
    'หน้าที่ 7/12 16-07-26 35,434.68 ยอดยกมา'
  ].join(' ');
  assert.equal(kasikornPdfIncomingAmount(text), 4059.32);
});

test('Kasikorn PDF card settlement ignores a carried balance at a page break', () => {
  const text = [
    '18-07-26 23:59 โอนเข้า/หักบัญชีอัตโนมัติ 448,851.98',
    'จาก 401016008901001 SOLAO รับเงินจากการขาย เต็มจำนวน/ ผ่อนชำระ/คะแนนสะสม 17,789.24',
    'หน้าที่ 3/4 18-07-26 448,851.98 ยอดยกมา'
  ].join(' ');
  assert.equal(kasikornPdfIncomingAmount(text), 17789.24);
});

test('parseStatementBuffer reads CSV statement rows with Thai headers', async () => {
  const csv = [
    'วันที่,รายการ,เลขที่อ้างอิง,ยอดเงิน',
    '2026-07-06,QR KPLUS,ABC001,"1,250.50"',
    '2026-07-06,GRAB settlement,ABC002,300'
  ].join('\n');
  const rows = await parseStatementBuffer({
    buffer: Buffer.from(csv, 'utf8'),
    originalName: 'statement.csv',
    mimeType: 'text/csv'
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].transactionDate, '2026-07-06');
  assert.equal(rows[0].description, 'QR KPLUS');
  assert.equal(rows[0].referenceNo, 'ABC001');
  assert.equal(rows[0].amount, 1250.5);
  assert.equal(rows[0].uniqueHash.length, 64);
});

test('parseKrungthaiHistoricalTextRows reads KTC net deposits from historical statements', () => {
  const rows = parseKrungthaiHistoricalTextRows([
    'ยอดคงเหลือยกมา 138,960.68',
    '01/08/2026 23:01 SD Single credit to 4970282439 0.00 140,756.32 - 1,795.64',
    'ยอดยกไป 140,756.32'
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Krungthai Transaction Date'], '2026-08-01');
  assert.equal(rows[0]['Krungthai Credit Amount'], '1,795.64');
});

test('duplicate statement rows produce the same stable hash', async () => {
  const csv = [
    'date,description,reference,amount',
    '2026-07-06,KPLUS,ABC001,100',
    '2026-07-06,KPLUS,ABC001,100'
  ].join('\n');
  const rows = await parseStatementBuffer({
    buffer: Buffer.from(csv, 'utf8'),
    originalName: 'statement.csv',
    mimeType: 'text/csv'
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uniqueHash, rows[1].uniqueHash);
});

test('parseStatementBuffer reads Kasikorn recent transaction CSV with metadata rows', async () => {
  const csv = [
    '"Account number : 0308663108"',
    '"From Date : 02/07/2026"',
    '"To Date : 02/07/2026"',
    '"Transaction Date","Transaction","Withdrawal (Baht)","Deposit (Baht)","Account/PromptPay or Biller","Channel"',
    '"2026-07-02 23:15:13","รับเงินจากการขายด้วย Thai QR Payment","","48,844.80","บัญชีต่างธนาคาร/อื่นๆ","EDC/K SHOP/MYQR"',
    '"2026-07-02 20:24:06","โอนเงิน","-1,883.20","","บัญชีต่างธนาคาร/อื่นๆ","K BIZ"',
    '"2026-07-02 20:09:26","โอนเงิน","-2,663.70","","บัญชีธนาคารกสิกรไทย","K BIZ"',
    '"2026-07-02 18:25:19","ชำระเงิน","-23,690.13","","บัญชีต่างธนาคาร/อื่นๆ","K BIZ"',
    '"2026-07-02 03:46:51","รับโอนเงิน","","7,373.93","บัญชีต่างธนาคาร/อื่นๆ","ตู้เติมเงิน / โมบาย แอปพลิเคชัน /เงินโอน"',
    '"2026-07-02 01:32:22","รับโอนเงิน","","6,119.13","บัญชีต่างธนาคาร/อื่นๆ","ตู้เติมเงิน / โมบาย แอปพลิเคชัน /เงินโอน"'
  ].join('\n');

  const rows = await parseStatementBuffer({
    buffer: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    originalName: 'recent_transaction_20260711_121311.csv',
    mimeType: 'text/csv'
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].transactionDate, '2026-07-02');
  assert.equal(rows[0].description, 'รับเงินจากการขายด้วย Thai QR Payment | EDC/K SHOP/MYQR');
  assert.equal(rows[0].referenceNo, 'บัญชีต่างธนาคาร/อื่นๆ');
  assert.equal(rows[0].amount, 48844.8);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 62337.86);
});

test('parseStatementFile reads KBank deposit statement CSV metadata and incoming rows', async () => {
  const csv = [
    'รายการเดินบัญชีเงินฝากออมทรัพย์ (มีรายละเอียด),,,,,,,,,,,,',
    ',ชื่อบัญชี,บจก. โซลาว,,,,,เลขที่อ้างอิง,,,,26090118450316680189,',
    ',,,,,,,เลขที่บัญชีเงินฝาก,,,,176-3-14786-6,',
    ',วันที่,เวลา/ วันที่มีผล,รายการ,ถอนเงิน,,ฝากเงิน,,ยอดคงเหลือ,,ช่องทาง,,รายละเอียด',
    ',01-08-26,23:16,รับเงินจากการขายด้วย Thai QR Payment,,,"51,679.80",,"402,837.60",,EDC/K SHOP/MYQR,,จาก KB000001927650 โซลาว',
    ',01-08-26,23:59,รับเงินจากการขาย เต็มจำนวน/ผ่อนชำระ/คะแนนสะสม,,,"15,243.76",,"418,081.36",,โอนเข้า/หักบัญชีอัตโนมัติ,,จาก 401016008901001 SOLAO',
    ',01-08-26,18:00,โอนเงิน,"1,000.00",,,,"417,081.36",,K BIZ,,ปลายทาง'
  ].join('\n');

  const statement = await parseStatementFile({
    buffer: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    originalName: 'kbank-deposit-statement.csv',
    mimeType: 'text/csv'
  });

  assert.equal(statement.profile.code, 'KASIKORN_DEPOSIT_STATEMENT');
  assert.equal(statement.metadata.accountNumber, '1763147866');
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[0].transactionDate, '2026-08-01');
  assert.equal(statement.rows[0].amount, 51679.8);
  assert.match(statement.rows[0].description, /KB000001927650/);
  assert.equal(statement.rows[1].amount, 15243.76);
  assert.match(statement.rows[1].description, /401016008901001/);
});

test('parseStatementBuffer reads SCB historical statement CSV and preserves the EDC description', async () => {
  const csv = [
    'Account Number,Account Name,Account Type,Currency Code,Branch Code,Date,Time,Tr Code,Tr Description,Channel,Cheque No.,Withdrawal,Deposit,Outstanding Balance,Description',
    '4070578401,บริษัท โซลาว จำกัด,ออมทรัพย์,THB,5033,01/07/2026,03:43,X1,ฝากถอนเงินโอนไม่ใช้สมุด,ATS,,,6225.35,9029.61,CREDIT CARD DIVISION(EDC)',
    '4070578401,บริษัท โซลาว จำกัด,ออมทรัพย์,THB,5033,01/07/2026,15:21,X1,ฝากถอนเงินโอนไม่ใช้สมุด,ENET,,,9000.00,18029.61,รับโอนจากลูกค้า'
  ].join('\n');
  const statement = await parseStatementFile({ buffer: Buffer.from(csv), originalName: 'scb-history.csv', mimeType: 'text/csv' });

  assert.equal(statement.profile.code, 'SCB_HISTORICAL_STATEMENT');
  assert.equal(statement.rows.length, 2);
  assert.equal(statement.rows[0].transactionDate, '2026-07-01');
  assert.equal(statement.rows[0].description, 'CREDIT CARD DIVISION(EDC) | ATS');
  assert.equal(statement.rows[0].amount, 6225.35);
});

test('parseStatementFile reads Kasikorn PDF statement rows when sample files are available', async (t) => {
  const filePath = '/Users/surachart/Downloads/ยอดเงินเข้า/e03dbbf9-b9b7-4081-b089-cb23e0fe458d.pdf';
  if (!fs.existsSync(filePath)) {
    t.skip('local Kasikorn PDF sample is not available');
    return;
  }

  const statement = await parseStatementFile({
    buffer: fs.readFileSync(filePath),
    originalName: 'kbank-statement.pdf',
    mimeType: 'application/pdf'
  });

  assert.equal(statement.rows.length, 50);
  assert.equal(statement.rows[0].transactionDate, '2026-07-01');
  assert.equal(statement.rows[0].amount, 7845.91);
  assert.ok(statement.rows.some((row) => row.description.includes('EDC/K SHOP/MYQR') && row.amount === 44718.1));
});

test('parseStatementFile reads the July Kasikorn statement across a page break when available', async (t) => {
  const filePath = '/Users/surachart/Downloads/dd99bf06-e0ee-497a-baab-a0236e726213.pdf';
  if (!fs.existsSync(filePath)) {
    t.skip('local July Kasikorn PDF sample is not available');
    return;
  }

  const statement = await parseStatementFile({
    buffer: fs.readFileSync(filePath),
    originalName: 'kbank-july-statement.pdf',
    mimeType: 'application/pdf'
  });
  const qrRows = statement.rows.filter((row) => row.description.includes('EDC/K SHOP/MYQR'));

  assert.equal(qrRows.length, 31);
  assert.equal(qrRows.reduce((sum, row) => Math.round((sum + row.amount) * 100) / 100, 0), 995157.8);
  assert.ok(qrRows.some((row) => row.transactionDate === '2026-07-26' && row.amount === 59108.6));
  const alipayWeChatRows = statement.rows.filter((row) => row.description.includes('ALIPAY_WECHAT'));
  assert.equal(alipayWeChatRows.length, 1);
  assert.equal(alipayWeChatRows[0].transactionDate, '2026-07-30');
  assert.equal(alipayWeChatRows[0].amount, 770.58);
  const cardRows = statement.rows.filter((row) =>
    /รับเงินจากการขาย\s+เต็มจำนวน\s*\/\s*ผ่อนชำระ\s*\/\s*คะแนนสะสม/.test(row.description)
  );
  assert.equal(cardRows.length, 28);
  assert.equal(cardRows.reduce((sum, row) => Math.round((sum + row.amount) * 100) / 100, 0), 316633.23);
  assert.ok(cardRows.some((row) => row.transactionDate === '2026-07-18' && row.amount === 17789.24));
});

test('parseStatementFile keeps every July Grab transfer amount across page breaks', async (t) => {
  const filePath = '/Users/surachart/Downloads/dad4c1d8-402a-4c76-909a-4ac92e017202.pdf';
  if (!fs.existsSync(filePath)) {
    t.skip('local Kanklong July statement sample is not available');
    return;
  }
  const statement = await parseStatementFile({
    buffer: fs.readFileSync(filePath),
    originalName: 'kbank-kanklong-july.pdf',
    mimeType: 'application/pdf'
  });
  const grabRows = statement.rows.filter((row) => row.description.includes('| GRAB'));

  assert.equal(grabRows.length, 61);
  assert.equal(grabRows.reduce((sum, row) => Math.round((sum + row.amount) * 100) / 100, 0), 367478.4);
  assert.ok(grabRows.some((row) => row.transactionDate === '2026-07-16' && row.amount === 4059.32));
  assert.ok(grabRows.some((row) => row.transactionDate === '2026-07-22' && row.amount === 5023.83));
});

test('training fixtures identify Kasikorn and SCB statement patterns without real account data', async () => {
  const kasikorn = await parseStatementFile({
    buffer: fs.readFileSync(new URL('../fixtures/statement-training/kasikorn-recent-transaction.csv', import.meta.url)),
    originalName: 'kasikorn-recent-transaction.csv',
    mimeType: 'text/csv'
  });
  const scb = await parseStatementFile({
    buffer: fs.readFileSync(new URL('../fixtures/statement-training/scb-incoming-transaction.csv', import.meta.url)),
    originalName: 'scb-incoming-transaction.csv',
    mimeType: 'text/csv'
  });

  assert.equal(kasikorn.profile.code, 'KASIKORN_RECENT_TRANSACTION');
  assert.equal(kasikorn.rows.length, 3);
  assert.equal(scb.profile.code, 'SCB_INCOMING_REPORT');
  assert.equal(scb.rows.length, 3);
  assert.equal(scb.rows[0].amount, 15250);
  assert.equal(scb.rows[0].description, 'SCB PromptPay QR Collection | PromptPay');
});
