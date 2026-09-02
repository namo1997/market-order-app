import test from 'node:test';
import assert from 'node:assert/strict';
import { createKrungsriCombinedEvidence } from '../src/krungsriEvidence.js';

const receipt = { receipt_id: 74, line_id: 757, receipt_date: '2026-08-08', branch_name: 'สาขาคันคลอง' };
const row = (id, file, amount, fee = 0) => ({
  statement_transaction_id: id, receipt_line_id: 757, transaction_date: '2026-08-08',
  inbox_import_id: 10, archive_name: 'bank-20260808.zip', source_file_name: `${file}_20260808.csv`,
  amount, raw_payload: {
    'Transaction paid time': '2026-08-08 19:29:40', 'Transaction ID': `REF-${id}`,
    'Merchant ID': 'test-merchant', 'Transaction amount': String(amount),
    'Service Fee': String(fee), 'Net Transaction amount': (amount - fee).toFixed(2)
  }
});
const bankRows = () => [row(1, 'ALIPAY', 939, 16.9), row(2, 'ALIPAY', 1081, 19.46),
  ...[1000, 2000, 3000, 1000, 1000, 1288].map((amount, index) => row(index + 3, 'PROMPTPAY', amount))];

test('Krungsri evidence combines all files into one document without losing fees or detail rows', () => {
  const document = createKrungsriCombinedEvidence({ receipt, rows: bankRows() });
  assert.equal(document.total, 11308);
  assert.equal(document.fee, 36.36);
  assert.equal(document.net, 11271.64);
  assert.equal(document.fileCount, 2);
  assert.equal(document.rowCount, 8);
  const html = document.fileData.toString();
  assert.match(html, /2,020\.00 \+ 9,288\.00 = 11,308\.00 บาท/);
  assert.match(html, /11,271\.64 บาท/);
  for (let id = 1; id <= 8; id++) assert.match(html, new RegExp(`REF-${id}<`));
  assert.match(html, /ALIPAY_20260808\.csv/);
  assert.match(html, /PROMPTPAY_20260808\.csv/);
  assert.match(html, /สาขาคันคลอง · 2026-08-08/);
});

test('Krungsri evidence includes PromptPay fees as well as Alipay fees', () => {
  const rows = [row(1, 'ALIPAY', 939, 16.9), row(2, 'ALIPAY', 1081, 19.46),
    ...[[348, 1.22], [1056, 3.7], [1149, 4.02], [1061, 3.71], [1026, 3.59], [4648, 16.27]]
      .map(([amount, fee], index) => row(index + 3, 'PROMPTPAY', amount, fee))];
  const document = createKrungsriCombinedEvidence({ receipt, rows });
  assert.equal(document.total, 11308);
  assert.equal(document.fee, 68.87);
  assert.equal(document.net, 11239.13);
  assert.equal(document.rowCount, 8);
  assert.match(document.fileData.toString(), /68\.87 บาท/);
  assert.match(document.fileData.toString(), /11,239\.13 บาท/);
});

test('Krungsri evidence excludes other dates, branches, summary repeats and duplicate joins', () => {
  const rows = bankRows();
  rows.push(rows[0], { ...row(9, 'PROMPTPAY', 9000), receipt_line_id: 999 },
    { ...row(10, 'PROMPTPAY', 9000), transaction_date: '2026-08-09' }, row(11, 'SUMMARY', 11308));
  const document = createKrungsriCombinedEvidence({ receipt, rows });
  assert.equal(document.total, 11308);
  assert.equal(document.rowCount, 8);
  assert.doesNotMatch(document.fileData.toString(), /REF-(9|10|11)</);
});

test('Krungsri evidence keeps unknown fees and net blank instead of making up a zero', () => {
  const input = row(1, 'PROMPTPAY', 100);
  input.raw_payload = JSON.stringify({ 'Transaction amount': '100.00' });
  const document = createKrungsriCombinedEvidence({ receipt, rows: [input] });
  assert.equal(document.total, 100);
  assert.equal(document.fee, null);
  assert.equal(document.net, null);
  assert.match(document.fileData.toString(), /ค่าธรรมเนียมตามรายงาน<\/span><strong>-<\/strong>/);
});

test('Krungsri evidence is deterministic and escapes bank-provided content', () => {
  const rows = bankRows();
  rows[0].archive_name = '<script>alert(1)</script>';
  rows[0].raw_payload['Transaction ID'] = '<img onerror="bad">';
  const document = createKrungsriCombinedEvidence({ receipt, rows });
  assert.deepEqual(document.fileData, createKrungsriCombinedEvidence({ receipt, rows: [...rows].reverse() }).fileData);
  assert.doesNotMatch(document.fileData.toString(), /<script>|<img /);
  assert.match(document.fileData.toString(), /&lt;img onerror=&quot;bad&quot;&gt;/);
});

test('Krungsri evidence does not truncate high-volume daily reports', () => {
  const rows = Array.from({ length: 1201 }, (_, index) => row(index + 1, 'PROMPTPAY', 1));
  const document = createKrungsriCombinedEvidence({ receipt, rows });
  assert.equal(document.total, 1201);
  assert.equal(document.rowCount, 1201);
  assert.match(document.fileData.toString(), /REF-1201</);
});

test('Krungsri evidence refuses malformed money and does not generate empty proof', () => {
  assert.equal(createKrungsriCombinedEvidence({ receipt, rows: [] }), null);
  assert.throws(() => createKrungsriCombinedEvidence({ receipt, rows: [{ ...row(1, 'PROMPTPAY', 1), amount: 'invalid' }] }));
});
