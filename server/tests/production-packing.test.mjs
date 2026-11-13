// จัดของตามใบสั่ง: รวมใบสั่งต่อสาขา/สินค้า และผลสแกน ok / เกิน / ซ้ำ / ไม่มีในใบสั่ง
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustPackedManually,
  buildBranchLines,
  getBranchPacking,
  scanStickerForBranch
} from '../src/models/production-packing.model.js';
import { scopedGroupIds } from '../src/controllers/production-packing.controller.js';

const ORDER_ITEMS = [
  { branch_id: 1, branch_name: 'สาขาคันคลอง', department_name: 'ครัวร้อน', product_id: 176, product_name: 'น้ำส้มตำลาว', unit_abbr: 'ก.ล.', quantity: '1.00' },
  { branch_id: 1, branch_name: 'สาขาคันคลอง', department_name: 'ครัวตำ', product_id: 176, product_name: 'น้ำส้มตำลาว', unit_abbr: 'ก.ล.', quantity: '1.00' },
  { branch_id: 1, branch_name: 'สาขาคันคลอง', department_name: 'ครัวร้อน', product_id: 146, product_name: 'หน่อไม้ซุป', unit_abbr: 'ถุง', quantity: '10.00' },
  { branch_id: 3, branch_name: 'สาขาสันกำแพง', department_name: 'ครัว', product_id: 1053, product_name: 'เนื้อไทวากิว', unit_abbr: 'ชุด', quantity: '15' },
  { branch_id: 9, branch_name: 'สาขาส่วนกลาง', department_name: 'ออฟฟิศ', product_id: 176, product_name: 'น้ำส้มตำลาว', unit_abbr: 'ก.ล.', quantity: '4' }
];

// DB ปลอม: เก็บแถว production_packing_scans ใน memory ตาม SQL ที่ model ใช้
const fakeDb = () => {
  const scans = [];
  let nextId = 1;
  return {
    scans,
    query: async (sql, params = []) => {
      if (/CREATE TABLE/.test(sql)) return [[]];
      if (/FROM production_packing_status/.test(sql)) return [[]];
      if (/WHERE s\.sticker_code = \?/.test(sql)) {
        const row = scans.find((scan) => scan.sticker_code === params[0]);
        return [row ? [{ pack_date: row.pack_date, branch_id: row.branch_id, branch_name: `สาขา#${row.branch_id}` }] : []];
      }
      if (/FROM production_packing_scans/.test(sql) && /SELECT/.test(sql)) {
        const [date, branchId] = params;
        return [scans.filter((scan) => scan.pack_date === date && (branchId === undefined || scan.branch_id === branchId))];
      }
      if (/INSERT INTO production_packing_scans/.test(sql)) {
        const manual = /'manual'/.test(sql);
        const [packDate, branchId, productId, quantity] = params;
        if (!manual && scans.some((scan) => scan.sticker_code === params[4])) {
          throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        }
        scans.push({
          id: nextId++, pack_date: packDate, branch_id: branchId, product_id: productId, quantity,
          source: manual ? 'manual' : 'scan', sticker_code: manual ? null : params[4], created_at: new Date()
        });
        return [{ insertId: nextId - 1 }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
};

const getOrderItems = async (date, statuses, groupIds) => {
  assert.equal(date, '2026-11-10');
  assert.deepEqual(statuses, []);
  assert.deepEqual(groupIds, [8]);
  return ORDER_ITEMS;
};

const sticker = (code, productId, quantityPerSticker = 1) => async (value) => {
  if (!/^\d{12}$/.test(String(value))) return { status: 'invalid' };
  if (String(value) !== code) return { status: 'not_found' };
  return {
    status: 'ok',
    sticker: { code, transaction_id: Number(code.slice(0, 8)), product_id: productId, product_name: `#${productId}`, quantity_per_sticker: quantityPerSticker }
  };
};

const base = { date: '2026-11-10', groupIds: [8], getOrderItems, userId: 23 };

test('order lines are summed per branch and product like the delivery note; head office hidden', () => {
  const branches = buildBranchLines(ORDER_ITEMS);
  assert.deepEqual(branches.map((b) => b.branch_name), ['สาขาคันคลอง', 'สาขาสันกำแพง']);
  const kk = branches[0];
  // เรียงตามชื่อแบบไทย: น (น้ำส้ม) มาก่อน ห (หน่อไม้)
  assert.deepEqual(kk.lines.map((l) => [l.product_id, l.ordered]), [[176, 2], [146, 10]]);
  assert.deepEqual(kk.lines.find((l) => l.product_id === 176).departments, ['ครัวร้อน', 'ครัวตำ']);
});

test('scan outcomes: ok until ordered, then over; same sticker twice is duplicate', async () => {
  const db = fakeDb();
  const first = await scanStickerForBranch({ ...base, db, branchId: 1, code: '001462900001', findSticker: sticker('001462900001', 176) });
  assert.equal(first.status, 'ok');
  assert.equal(first.line.packed, 1);
  const second = await scanStickerForBranch({ ...base, db, branchId: 1, code: '001462900002', findSticker: sticker('001462900002', 176) });
  assert.equal(second.status, 'ok');
  assert.equal(second.line.packed, 2);
  const third = await scanStickerForBranch({ ...base, db, branchId: 1, code: '001462900003', findSticker: sticker('001462900003', 176) });
  assert.equal(third.status, 'over');
  assert.equal(db.scans.length, 2, 'over must not be recorded');
  const again = await scanStickerForBranch({ ...base, db, branchId: 3, code: '001462900001', findSticker: sticker('001462900001', 176) });
  assert.equal(again.status, 'duplicate');
  assert.equal(again.packed_to, 'สาขา#1');
});

test('scan outcomes: product not on this branch order, unknown and invalid codes', async () => {
  const db = fakeDb();
  const wrongBranch = await scanStickerForBranch({ ...base, db, branchId: 3, code: '001462900001', findSticker: sticker('001462900001', 176) });
  assert.equal(wrongBranch.status, 'not_in_order');
  const unknown = await scanStickerForBranch({ ...base, db, branchId: 1, code: '009999990001', findSticker: sticker('001462900001', 176) });
  assert.equal(unknown.status, 'not_found');
  const invalid = await scanStickerForBranch({ ...base, db, branchId: 1, code: '12', findSticker: sticker('001462900001', 176) });
  assert.equal(invalid.status, 'invalid');
  assert.equal(db.scans.length, 0);
});

test('manual +/- may exceed the order but never goes below zero', async () => {
  const db = fakeDb();
  assert.equal((await adjustPackedManually({ ...base, db, branchId: 1, productId: 146, delta: 12 })).line.packed, 12);
  assert.equal((await adjustPackedManually({ ...base, db, branchId: 1, productId: 146, delta: -20 })).status, 'below_zero');
  assert.equal((await adjustPackedManually({ ...base, db, branchId: 1, productId: 999, delta: 1 })).status, 'not_in_order');
  const branch = await getBranchPacking({ ...base, db, branchId: 1 });
  const line = branch.lines.find((l) => l.product_id === 146);
  assert.equal(line.packed, 12);
  // ครบบรรทัดนับเฉพาะที่ไม่เกินที่สั่งในยอดรวม
  assert.equal(branch.packed_total, 10);
  assert.equal(branch.complete_lines, 1);
  assert.equal(branch.entries[0].source, 'manual');
});

test('no product groups means no orders (never fall back to every group)', async () => {
  const db = fakeDb();
  const calls = [];
  const branch = await getBranchPacking({ ...base, db, branchId: 1, groupIds: [], getOrderItems: async (...args) => { calls.push(args); return ORDER_ITEMS; } });
  assert.equal(branch, null);
  assert.equal(calls.length, 0);
  assert.deepEqual(scopedGroupIds({ role: 'user', allowed_product_group_ids: [] }), []);
  assert.deepEqual(scopedGroupIds({ role: 'user', allowed_product_group_ids: ['10'] }), [10]);
  assert.deepEqual(scopedGroupIds({ role: 'admin' }), [8]);
});
