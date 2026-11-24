// แก้บั๊กสต็อกก่อนเริ่มใช้จริง (ตรวจ 13 พ.ย. 2569): A5 ยอดตั้งต้นสัมบูรณ์, A6 แผนกตัดขายคงที่ + กันตัดซ้ำ, A7 เวลานับ
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAbsoluteLedgerRow,
  reflowLedgerRows,
  resolveStockCheckCountedAtUtc,
  stockCheckCountedAtSql
} from '../src/utils/stock-ledger.js';
import {
  buildRecipeSaleReferenceIds,
  pickSaleDepartment,
  recipeSaleKeyWithoutDepartment,
  recipeSaleReferencePrefixes
} from '../src/utils/recipe-sale-sync.js';
import { buildResetLabel, planResetPairs, resolveResetAt } from '../src/utils/stock-reset.js';

const sale = (id, quantity) => ({ id, transaction_type: 'sale', reference_type: 'recipe_sale', quantity, balance_after: 0 });
const initial = (id, target, quantity) => ({ id, transaction_type: 'initial', reference_type: 'manual', quantity, balance_after: target });

test('A5: ยอดตั้งต้นเป็นยอดสัมบูรณ์ — ขายย้อนเวลาแทรกก่อนเวลาตั้ง ไม่ทำให้ยอดหลังตั้งเพี้ยน', () => {
  // 14:00 ตั้งยอด 10 (เดิม 0) แล้วขายหลังตั้ง -1 → 9
  const before = reflowLedgerRows([initial(1, 10, 10), sale(3, -1)]);
  assert.equal(before.balance, 9);
  // ซิงค์กลางคืนแทรกบิล 12:00 (-2) ก่อนแถวตั้งยอด → ยอดหลังตั้งยังเป็น 10 → คงเหลือ 9 เหมือนเดิม
  const after = reflowLedgerRows([sale(2, -2), initial(1, 10, 10), sale(3, -1)]);
  assert.deepEqual(after.rows.map((r) => r.balance_after), [-2, 10, 9]);
  assert.equal(after.rows[1].quantity, 12, 'ส่วนต่างของแถวตั้งยอดถูกคำนวณใหม่');
  assert.equal(after.balance, 9);
  assert.equal(isAbsoluteLedgerRow(initial(1, 0, -3)), true);
  assert.equal(isAbsoluteLedgerRow({ transaction_type: 'adjustment', reference_type: 'production_transform', balance_after: 5 }), false);
});

test('A6: แผนกที่ตัดขาย = แผนกที่ผูก (นับ apply) ก่อน — แผนก id น้อยกว่าที่เริ่มนับทีหลังไม่แย่ง', () => {
  assert.equal(pickSaleDepartment([{ department_id: 12, first_check_id: 500 }]), 12);
  // แผนก 5 เริ่มนับทีหลัง (first_check_id มากกว่า) → ยังตัดแผนก 12 เดิม
  assert.equal(pickSaleDepartment([{ department_id: 12, first_check_id: 500 }, { department_id: 5, first_check_id: 900 }]), 12);
  assert.equal(pickSaleDepartment([{ department_id: 30, first_check_id: 7 }, { department_id: 29, first_check_id: 7 }]), 29);
  assert.equal(pickSaleDepartment([]), null);
});

test('A6: บิลเดียวกันที่ตัดจากอีกแผนกแล้ว นับว่าตัดแล้ว (กันตัดซ้ำเมื่อแผนกเปลี่ยน)', () => {
  const bill = {
    sale_date: '2026-11-09', sale_datetime_local: '2026-11-09 12:34:56', branch_id: 1, product_id: 77, sale_doc_no: 'POS-1/23'
  };
  const fromDept12 = buildRecipeSaleReferenceIds({ ...bill, department_id: 12 });
  const fromDept5 = buildRecipeSaleReferenceIds({ ...bill, department_id: 5 });
  // รูปแบบเดิมไม่เปลี่ยน (ตรงกับแถวที่ตัดไปแล้วใน Production)
  assert.equal(fromDept12.reference_id, 'recipe-sale-bill:2026-11-09:20261109123456:branch1:dept12:product77:docPOS-123');
  assert.equal(fromDept12.legacy_reference_id, 'recipe-sale:2026-11-09:branch1:dept12:product77');
  assert.notEqual(fromDept12.reference_id, fromDept5.reference_id);
  assert.equal(recipeSaleKeyWithoutDepartment(fromDept12.reference_id), recipeSaleKeyWithoutDepartment(fromDept5.reference_id));
  assert.equal(recipeSaleKeyWithoutDepartment(fromDept12.legacy_reference_id), recipeSaleKeyWithoutDepartment(fromDept5.legacy_reference_id));
  // สินค้าอื่น/บิลอื่นยังต่างกัน
  const otherProduct = buildRecipeSaleReferenceIds({ ...bill, department_id: 12, product_id: 78 });
  assert.notEqual(recipeSaleKeyWithoutDepartment(otherProduct.reference_id), recipeSaleKeyWithoutDepartment(fromDept12.reference_id));
  assert.deepEqual(recipeSaleReferencePrefixes('2026-11-09'), ['recipe-sale-bill:2026-11-09:%', 'recipe-sale:2026-11-09:%']);
});

test('A7: เวลานับ = เวลากรอกครั้งแรก บีบให้อยู่ในวันที่นับ (เวลาไทย)', () => {
  // กรอก 08:15 ไทย (01:15 UTC) วันเดียวกัน → ใช้เวลานั้น
  assert.equal(resolveStockCheckCountedAtUtc('2026-11-14', '2026-11-14 01:15:00'), '2026-11-14 01:15:00');
  // กรอก 06:30 ไทย (23:30 UTC วันก่อน) ยังเป็นวันที่นับ
  assert.equal(resolveStockCheckCountedAtUtc('2026-11-14', '2026-11-13 23:30:00'), '2026-11-13 23:30:00');
  // กรอกย้อนหลัง 2 วัน → 23:59:59 ไทยของวันที่นับ
  assert.equal(resolveStockCheckCountedAtUtc('2026-11-14', '2026-11-16 03:00:00'), '2026-11-14 16:59:59');
  // กรอกล่วงหน้า → 00:00 ไทยของวันที่นับ
  assert.equal(resolveStockCheckCountedAtUtc('2026-11-14', '2026-11-12 10:00:00'), '2026-11-13 17:00:00');
  assert.equal(resolveStockCheckCountedAtUtc('2026-11-14', null), '2026-11-14 16:59:59');
  assert.throws(() => resolveStockCheckCountedAtUtc('14/11/2026', '2026-11-14 01:15:00'), /YYYY-MM-DD/);
  const sql = stockCheckCountedAtSql('sc2');
  assert.match(sql, /sc2\.created_at/);
  assert.doesNotMatch(sql, /updated_at/);
});

test('เริ่มใช้สต็อก: ตั้งยอดเป็น 0 — แถวรีเซ็ตเป็นยอดสัมบูรณ์ ขายย้อนเวลาก่อนรีเซ็ตไม่กระทบ', () => {
  const reset = { id: 5, transaction_type: 'initial', reference_type: 'stock_reset', quantity: -40, balance_after: 0 };
  const receive = { id: 6, transaction_type: 'receive', reference_type: 'order_receiving', quantity: 12, balance_after: 0 };
  // ยอดเดิม 40 → รีเซ็ต 0 → รับ 12 = 12
  assert.equal(reflowLedgerRows([{ ...sale(1, 40), transaction_type: 'receive' }, reset, receive]).balance, 12);
  // ซิงค์ขายคืนนั้นแทรกบิลก่อนเวลารีเซ็ต → ยังเป็น 12
  assert.equal(reflowLedgerRows([{ ...sale(1, 40), transaction_type: 'receive' }, sale(2, -7), reset, receive]).balance, 12);
});

test('เริ่มใช้สต็อก: เวลา/label/รายการคู่ที่จะรีเซ็ต', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(resolveResetAt(undefined, now), '2026-11-13 10:00:00');
  assert.equal(resolveResetAt('2026-11-13 09:30:00', now), '2026-11-13 09:30:00');
  assert.throws(() => resolveResetAt('2026-11-14 00:00:00', now), /อนาคต/);
  assert.throws(() => resolveResetAt('13/11/2026', now), /YYYY-MM-DD/);
  assert.equal(buildResetLabel('2026-11-13 10:00:00'), 'go-live-zero:20261113100000');
  const pairs = planResetPairs({
    ledgerPairs: [{ product_id: 9, department_id: 2 }, { product_id: 3, department_id: 2 }, { product_id: 1, department_id: 1 }],
    balanceRows: [{ product_id: 7, department_id: 1, quantity: '5.00' }, { product_id: 8, department_id: 1, quantity: '0.00' }],
    donePairs: [{ product_id: 1, department_id: 1 }]
  });
  // ยอดค้างที่ไม่มีประวัติก็รีเซ็ต, ยอด 0 ที่ไม่มีประวัติข้าม, คู่ที่ทำแล้วข้าม, เรียงแผนกแล้วสินค้า
  assert.deepEqual(pairs.map((p) => [p.departmentId, p.productId]), [[1, 7], [2, 3], [2, 9]]);
});
