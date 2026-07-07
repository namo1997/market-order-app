import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStatementBuffer } from '../src/domain/statements.js';

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
