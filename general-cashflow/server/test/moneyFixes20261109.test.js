import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  classifyRowsForChannel,
  directChannelConfirmHashes,
  evaluateCardSettlement,
  repeatStatementRowAction,
  statementTransactionHash
} from '../src/domain/reconciliation.js';
import { disambiguateRepeatedRowHashes, parseStatementFile } from '../src/domain/statements.js';
import { KBANK_CARD_FEE_RATE, kbankCardSettles, matchDepositsToSales } from '../src/domain/overviewStatement.js';

test('card shortfall within a normal fee settles; a large shortfall is missing money, not a fee', () => {
  assert.deepEqual(
    evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 9750 }),
    { status: 'MATCHED_AUTO', feeAmount: 250, expectedNetAmount: 9750, exceptionCategory: null, exceptionNote: null, settled: true }
  );
  const partial = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 2000 });
  assert.equal(partial.status, 'EXCEPTION');
  assert.equal(partial.feeAmount, 0, 'the missing 8,000 must never become a card fee');
  assert.equal(partial.expectedNetAmount, 10000);
  assert.match(partial.exceptionNote, /^ยอดเข้ายังไม่ครบ ขาด 8000\.00 บาท/);
  assert.equal(partial.settled, false);
});

test('card sale with no deposit yet waits for money instead of booking the whole sale as fee', () => {
  const waiting = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 0 });
  assert.equal(waiting.status, 'READY_FOR_STATEMENT');
  assert.equal(waiting.feeAmount, 0);
  assert.equal(waiting.settled, false);
  assert.equal(evaluateCardSettlement({ cashierAmount: 0, receivedAmount: 0 }).status, 'MATCHED_AUTO');
});

test('split card transfers settle once every part is summed', () => {
  const firstPart = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 6000 });
  assert.equal(firstPart.status, 'EXCEPTION');
  const bothParts = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 6000 + 3760 });
  assert.equal(bothParts.status, 'MATCHED_AUTO');
  assert.equal(bothParts.feeAmount, 240);
});

test('more money than the card sale is an exception, never a negative fee', () => {
  const over = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: 10400 });
  assert.equal(over.status, 'EXCEPTION');
  assert.equal(over.feeAmount, 0);
  assert.match(over.exceptionNote, /^เงินเข้ามากกว่ายอดรูด/);
  assert.equal(evaluateCardSettlement({ cashierAmount: 0, receivedAmount: 500 }).exceptionNote,
    'มียอดเงินจริงจาก statement แต่ยังไม่มียอดรูดที่แคชเชียร์ส่ง');
});

test('KBank card evaluation uses the same fee ceiling as the overview pairing rule', () => {
  const line = { cashier_amount: 10000 };
  for (const received of [9700, 9650, 9649.99, 9600]) {
    const settled = evaluateCardSettlement({ cashierAmount: 10000, receivedAmount: received, maxFeeRate: KBANK_CARD_FEE_RATE.max }).settled;
    const shortfallRate = (10000 - received) / 10000;
    assert.equal(settled, shortfallRate <= KBANK_CARD_FEE_RATE.max, String(received));
    if (shortfallRate >= KBANK_CARD_FEE_RATE.min) assert.equal(settled, kbankCardSettles(received, line), String(received));
  }
});

test('KBank card deposits pair split and late money to the right sale day', () => {
  const lines = [
    { id: 1, sale_date: '2026-10-01', cashier_amount: 10000 },
    { id: 2, sale_date: '2026-10-02', cashier_amount: 8000 },
    { id: 3, sale_date: '2026-10-03', cashier_amount: 5000 },
    { id: 4, sale_date: '2026-10-04', cashier_amount: 3000 }
  ];
  const deposits = [
    // 1 Oct sale paid late on 2 Oct, alongside 2 Oct's own sale
    { row_index: 0, date: '2026-10-02', amount: 9750 },
    { row_index: 1, date: '2026-10-02', amount: 7800 },
    // 3 Oct sale paid in two parts on the same day
    { row_index: 2, date: '2026-10-03', amount: 3000 },
    { row_index: 3, date: '2026-10-03', amount: 1880 },
    // 4 Oct cashier typo: same-day money stays on that day so the variance shows
    { row_index: 4, date: '2026-10-04', amount: 1000 }
  ];
  const allocation = matchDepositsToSales(deposits, lines, kbankCardSettles, { sameDayFallback: true });
  assert.deepEqual([...allocation].map(([row, line]) => [row, line.id]).sort((a, b) => a[0] - b[0]),
    [[0, 1], [1, 2], [2, 3], [3, 3], [4, 4]]);
  assert.equal(evaluateCardSettlement({ cashierAmount: 5000, receivedAmount: 4880, maxFeeRate: KBANK_CARD_FEE_RATE.max }).status, 'MATCHED_AUTO');
  assert.equal(evaluateCardSettlement({ cashierAmount: 3000, receivedAmount: 1000, maxFeeRate: KBANK_CARD_FEE_RATE.max }).status, 'EXCEPTION');
});

test('direct-channel confirm links only the sale day rows the preview selected', () => {
  const qrChannel = { kind: 'qr', mappings: ['Thai QR Payment'] };
  const rows = ['2026-08-05', '2026-08-06', '2026-08-07'].map((date, index) => ({
    uniqueHash: `h${index + 1}`, transactionDate: date, description: 'รับเงินจากการขายด้วย Thai QR Payment', amount: [40000, 38000, 41000][index]
  }));
  const preview = classifyRowsForChannel({ rows, channel: qrChannel, receiptDate: '2026-08-05', expectedNetAmount: 40000 });
  const confirmed = directChannelConfirmHashes(preview.rows, '2026-08-05');
  assert.deepEqual([...confirmed], preview.defaultHashes);
  assert.deepEqual([...confirmed], ['h1']);
});

test('statement row key matches the value MySQL kept in CHAR(64)', () => {
  const sha = 'a'.repeat(64);
  const key = statementTransactionHash(1234, sha);
  assert.equal(key.length, 64);
  assert.equal(key, `1234-${sha}`.slice(0, 64));
  assert.equal(statementTransactionHash(7, 'short'), '7-short');
});

test('repeat confirm links or unlinks only within this line and never moves money from another line', () => {
  assert.equal(repeatStatementRowAction({ existingLineId: null, lineId: 5, selected: true }), 'link');
  assert.equal(repeatStatementRowAction({ existingLineId: 5, lineId: 5, selected: true }), 'link');
  assert.equal(repeatStatementRowAction({ existingLineId: 9, lineId: 5, selected: true }), 'linked_elsewhere');
  assert.equal(repeatStatementRowAction({ existingLineId: '5', lineId: 5, selected: false }), 'unlink');
  assert.equal(repeatStatementRowAction({ existingLineId: 9, lineId: 5, selected: false }), 'keep');
  assert.equal(repeatStatementRowAction({ existingLineId: null, lineId: 5, selected: false }), 'keep');
});

test('two identical deposits in one file get distinct keys while the first keeps its stored key', () => {
  const rows = [
    { uniqueHash: 'same', amount: 500 },
    { uniqueHash: 'other', amount: 120 },
    { uniqueHash: 'same', amount: 500 },
    { uniqueHash: 'same', amount: 500 }
  ];
  const result = disambiguateRepeatedRowHashes(rows);
  assert.equal(result[0].uniqueHash, 'same');
  assert.equal(result[1].uniqueHash, 'other');
  assert.equal(new Set(result.map((row) => row.uniqueHash)).size, 4);
  assert.deepEqual(disambiguateRepeatedRowHashes(rows), result, 'keys are stable on re-import of the same file');
});

test('separate same-amount transfers without a reference keep distinct keys; a repeated reference stays one transaction', async () => {
  const kbankCsv = [
    ',วันที่,เวลา/ วันที่มีผล,รายการ,ถอนเงิน,,ฝากเงิน,,ยอดคงเหลือ,,ช่องทาง,,รายละเอียด',
    ',01-08-26,10:00,รับโอนเงิน,,,"500.00",,"1,500.00",,โมบาย,,จาก X1111 นาย ทดสอบ',
    ',01-08-26,19:00,รับโอนเงิน,,,"500.00",,"2,000.00",,โมบาย,,จาก X1111 นาย ทดสอบ'
  ].join('\n');
  const transfers = await parseStatementFile({ buffer: Buffer.from(kbankCsv), originalName: 'synthetic.csv', mimeType: 'text/csv' });
  assert.equal(transfers.rows.length, 2);
  assert.equal(new Set(transfers.rows.map((row) => row.uniqueHash)).size, 2);
  assert.equal('hasTransactionReference' in transfers.rows[0], false);

  const referencedCsv = ['date,description,reference,amount', '2026-07-06,KPLUS,ABC001,100', '2026-07-06,KPLUS,ABC001,100'].join('\n');
  const listedTwice = await parseStatementFile({ buffer: Buffer.from(referencedCsv), originalName: 'synthetic.csv', mimeType: 'text/csv' });
  assert.equal(listedTwice.rows[0].uniqueHash, listedTwice.rows[1].uniqueHash);
});

test('server routes use the shared money rules (source guard)', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const db = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
  assert.match(server, /selectedHashes = directChannelConfirmHashes\(parsedRows, line\.receipt_date\)/);
  assert.doesNotMatch(server, /selectedHashes = classifiedHashes/);
  assert.doesNotMatch(server, /`\$\{line\.receipt_id\}-\$\{row\.uniqueHash\}`/, 'confirm must use the stored 64-char key');
  assert.doesNotMatch(server, /roundMoney\(Math\.max\(gross - (matchedAmount|Number\(row\.amount\)), 0\)\)/, 'no route may book any shortfall as fee');
  assert.match(server, /matchDepositsToSales\(depositRows, saleLines, kbankCardSettles, \{ sameDayFallback: true \}\)/);
  assert.match(server, /if \(newRows\.length === 0 && movedRowCount === 0\) continue;/);
  assert.match(db, /WHERE dr\.status <> 'CLOSED' AND rlr\.settlement_batch_key IS NULL/);
});
