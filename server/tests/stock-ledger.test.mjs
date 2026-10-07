import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reflowLedgerRows,
  isStockCheckAbsoluteRow,
  parseStockCheckReferenceId,
  isStockCheckReferenceFor,
  isStockCheckReferenceNewerThanDate,
  bangkokDateStartToUtc,
  bangkokDateRangeToUtc,
  buildBangkokDateRangeSql
} from '../src/utils/stock-ledger.js';

const sale = (id, quantity) => ({ id, transaction_type: 'sale', reference_type: 'recipe_sale', quantity, balance_after: 0 });
const receive = (id, quantity) => ({ id, transaction_type: 'receive', reference_type: 'order', quantity, balance_after: 0 });
// รายการนับสต็อก: balance_after = ยอดนับ (ที่ apply ตั้งไว้) quantity = ส่วนต่างตอน apply
const check = (id, counted, quantity = 0) => ({ id, transaction_type: 'adjustment', reference_type: 'stock_check', quantity, balance_after: counted });

// INV-01
test('INV-01 reflow: ledger ปกติสะสมยอดตามลำดับ', () => {
  const { rows, balance, lastTransactionId } = reflowLedgerRows([receive(1, 10), sale(2, -3), sale(3, -2)]);
  assert.deepEqual(rows.map((r) => r.balance_after), [10, 7, 5]);
  assert.deepEqual(rows.map((r) => r.balance_before), [0, 10, 7]);
  assert.equal(balance, 5);
  assert.equal(lastTransactionId, 3);
});

test('INV-01 reflow: stock_check เป็นยอดสัมบูรณ์ ขายย้อนหลังก่อนเวลานับไม่ถูกนับซ้ำ', () => {
  // ก่อนมีรายการแทรก: รับ 10, นับได้ 8 (ส่วนต่าง -2), ขายหลังนับ -1 → คงเหลือ 7
  const before = reflowLedgerRows([receive(1, 10), check(2, 8, -2), sale(3, -1)]);
  assert.equal(before.balance, 7);

  // ขายตามสูตรย้อนหลัง 4 หน่วยแทรกก่อนเวลานับ (id สูงสุดแต่ created_at เก่ากว่า)
  // ledger ตามเวลา: รับ 10, ขายย้อนหลัง -4, นับ 8 (ส่วนต่างเดิม -2 แต่ต้องกลายเป็น +2), ขายหลังนับ -1
  const after = reflowLedgerRows([receive(1, 10), sale(9, -4), check(2, 8, -2), sale(3, -1)]);
  assert.equal(after.rows[2].balance_before, 6);
  assert.equal(after.rows[2].balance_after, 8, 'ยอดหลังนับต้องเท่ายอดนับ');
  assert.equal(after.rows[2].quantity, 2, 'quantity ของรายการนับถูกคำนวณใหม่จากยอดสัมบูรณ์');
  assert.equal(after.balance, 7, 'ยอดปัจจุบันต้องไม่เปลี่ยนจากรายการที่แทรกก่อนเวลานับ');
});

test('INV-01 reflow: รายการแทรกก่อนเวลานับแล้วลบออก (ลบยอดขาย) ไม่เปลี่ยนยอดหลังนับ', () => {
  const withSale = reflowLedgerRows([receive(1, 10), sale(9, -4), check(2, 8, 2), sale(3, -1)]);
  const withoutSale = reflowLedgerRows([receive(1, 10), check(2, 8, 2), sale(3, -1)]);
  assert.equal(withSale.balance, withoutSale.balance);
  assert.equal(withoutSale.rows[1].quantity, -2);
});

test('INV-01 reflow: นับหลายครั้งในสินค้าเดียว ครั้งสุดท้ายตามเวลาชนะ', () => {
  const { rows, balance } = reflowLedgerRows([receive(1, 10), check(2, 8), check(3, 12), sale(4, -2)]);
  assert.deepEqual(rows.map((r) => r.balance_after), [10, 8, 12, 10]);
  assert.equal(rows[2].quantity, 4);
  assert.equal(balance, 10);
});

test('INV-01 reflow: รายการ apply ซ้ำ (reapply) ยังเป็นยอดสัมบูรณ์', () => {
  const reapply = { ...check(3, 9), reference_id: '2026-10-05:77:reapply:1' };
  const { rows } = reflowLedgerRows([receive(1, 10), check(2, 8), reapply]);
  assert.deepEqual(rows.map((r) => r.balance_after), [10, 8, 9]);
  assert.equal(rows[2].quantity, 1);
});

test('INV-01 reflow: adjustment ชนิดอื่น (เช่น แปรรูป) ยังเป็นส่วนต่าง ไม่ใช่ยอดสัมบูรณ์', () => {
  const production = { id: 2, transaction_type: 'adjustment', reference_type: 'production_transform', quantity: -3, balance_after: 7 };
  assert.equal(isStockCheckAbsoluteRow(production), false);
  const { rows } = reflowLedgerRows([receive(1, 10), production, sale(3, -1)]);
  assert.deepEqual(rows.map((r) => r.balance_after), [10, 7, 6]);
});

test('INV-01 reflow: ไม่มี balance_after ที่ใช้ได้ ให้ถือเป็นส่วนต่างปกติ และปัดเศษ float', () => {
  assert.equal(isStockCheckAbsoluteRow({ reference_type: 'stock_check', transaction_type: 'adjustment', balance_after: null }), false);
  const { balance } = reflowLedgerRows([receive(1, 0.1), receive(2, 0.2)]);
  assert.equal(balance, 0.3);
  assert.deepEqual(reflowLedgerRows([]).rows, []);
  assert.equal(reflowLedgerRows([]).lastTransactionId, null);
});

// INV-04
test('INV-04 parse reference_id ทั้ง 3 รูปแบบ', () => {
  assert.deepEqual(parseStockCheckReferenceId('2026-10-05:369'), { date: '2026-10-05', stockCheckId: 369, kind: 'current' });
  assert.deepEqual(parseStockCheckReferenceId('2026-10-05:369:2026-10-05 10:00:00'), { date: '2026-10-05', stockCheckId: 369, kind: 'legacy' });
  assert.deepEqual(parseStockCheckReferenceId('2026-10-05:369:reapply:1760000000000'), { date: '2026-10-05', stockCheckId: 369, kind: 'reapply' });
  assert.equal(parseStockCheckReferenceId('PRD-123'), null);
  assert.equal(parseStockCheckReferenceId(null), null);
});

test('INV-04 is_applied: ตรงทั้งรูปแบบใหม่ เก่า และ reapply แต่ไม่ตรง id อื่น', () => {
  assert.equal(isStockCheckReferenceFor('2026-10-05:369', '2026-10-05', 369), true);
  assert.equal(isStockCheckReferenceFor('2026-10-05:369:20261005100000', '2026-10-05', 369), true);
  assert.equal(isStockCheckReferenceFor('2026-10-05:369:reapply:1', '2026-10-05', 369), true);
  assert.equal(isStockCheckReferenceFor('2026-10-05:3690', '2026-10-05', 369), false);
  assert.equal(isStockCheckReferenceFor('2026-10-05:36', '2026-10-05', 369), false);
  assert.equal(isStockCheckReferenceFor('2026-10-06:369', '2026-10-05', 369), false);
});

test('INV-04 has_newer_applied: เทียบกับวันถัดไป รายการวันเดียวกันไม่ใช่ "ใหม่กว่า"', () => {
  // บั๊กเดิม: '2026-02-23:369' > '2026-02-23:' เป็นจริง
  assert.equal(isStockCheckReferenceNewerThanDate('2026-02-23:369', '2026-02-23'), false);
  assert.equal(isStockCheckReferenceNewerThanDate('2026-02-23:369:reapply:1', '2026-02-23'), false);
  assert.equal(isStockCheckReferenceNewerThanDate('2026-02-22:12', '2026-02-23'), false);
  assert.equal(isStockCheckReferenceNewerThanDate('2026-02-24:5', '2026-02-23'), true);
  assert.equal(isStockCheckReferenceNewerThanDate('2026-03-01:5', '2026-02-28'), true);
  assert.equal(isStockCheckReferenceNewerThanDate('2027-01-01:5', '2026-12-31'), true);
});

// INV-05
test('INV-05 เที่ยงคืนเวลาไทยคือ 17:00 UTC ของวันก่อนหน้า', () => {
  assert.equal(bangkokDateStartToUtc('2026-10-07'), '2026-10-06 17:00:00');
  assert.equal(bangkokDateStartToUtc('2026-01-01'), '2025-12-31 17:00:00');
  assert.equal(bangkokDateStartToUtc('bad'), null);
});

test('INV-05 ช่วงวันที่ไทยเป็นช่วงครึ่งเปิดบน created_at (UTC)', () => {
  assert.deepEqual(bangkokDateRangeToUtc('2026-10-07'), {
    startUtc: '2026-10-06 17:00:00',
    endUtcExclusive: '2026-10-07 17:00:00'
  });
  assert.deepEqual(bangkokDateRangeToUtc('2026-10-07', '2026-10-09'), {
    startUtc: '2026-10-06 17:00:00',
    endUtcExclusive: '2026-10-09 17:00:00'
  });
  assert.deepEqual(bangkokDateRangeToUtc('2026-12-31', '2026-12-31').endUtcExclusive, '2026-12-31 17:00:00');
});

test('INV-05 รายการ 00:00-07:00 ICT (17:00-24:00 UTC วันก่อน) ตกวันไทยที่ถูกต้อง', () => {
  const { startUtc, endUtcExclusive } = bangkokDateRangeToUtc('2026-10-07');
  const inRange = (utc) => utc >= startUtc && utc < endUtcExclusive;
  assert.equal(inRange('2026-10-06 17:00:00'), true); // 00:00 ICT ของวันที่ 7
  assert.equal(inRange('2026-10-06 23:59:59'), true); // 06:59 ICT ของวันที่ 7 (เดิมตกวันที่ 6)
  assert.equal(inRange('2026-10-06 16:59:59'), false); // 23:59 ICT ของวันที่ 6
  assert.equal(inRange('2026-10-07 16:59:59'), true); // 23:59 ICT ของวันที่ 7
  assert.equal(inRange('2026-10-07 17:00:00'), false);
});

test('INV-05 ค่าวันที่ผิดรูปแบบถูกปฏิเสธด้วย 400 และ SQL fragment ใช้ placeholder', () => {
  assert.throws(() => bangkokDateRangeToUtc('2026-10-07; DROP'), { statusCode: 400 });
  assert.throws(() => bangkokDateRangeToUtc('2026-10-07', 'x'), { statusCode: 400 });
  const fragment = buildBangkokDateRangeSql('it.created_at', '2026-10-07');
  assert.equal(fragment.sql, 'it.created_at >= ? AND it.created_at < ?');
  assert.deepEqual(fragment.params, ['2026-10-06 17:00:00', '2026-10-07 17:00:00']);
});
