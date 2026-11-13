// สติกเกอร์แปรรูป: รหัส 12 หลัก (id รายการ 8 + ลำดับดวง 4) และ API ค้นสติกเกอร์ในหน้าเบิก
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeTransformStickerCode,
  encodeTransformStickerCode,
  getQuantityPerSticker,
  getStickerCopies
} from '../src/utils/transform-sticker-code.js';
import { findTransformSticker } from '../src/models/transform-sticker.model.js';

test('sticker code round-trips transaction id and sequence', () => {
  assert.equal(encodeTransformStickerCode(146290, 2), '001462900002');
  assert.deepEqual(decodeTransformStickerCode('001462900002'), { code: '001462900002', transactionId: 146290, sequence: 2 });
  // เครื่องยิงบางรุ่นใส่ช่องว่าง/ขึ้นบรรทัด
  assert.deepEqual(decodeTransformStickerCode(' 0014 6290 0002\n'), { code: '001462900002', transactionId: 146290, sequence: 2 });
  assert.equal(decodeTransformStickerCode('12345'), null);
  assert.equal(decodeTransformStickerCode('000000000001'), null);
  assert.equal(decodeTransformStickerCode('001462900000'), null);
  assert.equal(encodeTransformStickerCode(0, 1), null);
  assert.equal(encodeTransformStickerCode(100_000_000, 1), null);
});

test('pack size: one sticker per pack, last sticker carries the remainder', () => {
  // ไก่ย่าง 12 ตัว ถุงละ 5 → 3 ดวง: 5, 5, 2
  assert.equal(getStickerCopies(12, 5), 3);
  assert.deepEqual([1, 2, 3].map((seq) => getQuantityPerSticker(12, 5, seq)), [5, 5, 2]);
  assert.equal(getStickerCopies(100, 5), 20);
  assert.equal(getQuantityPerSticker(100, 5, 20), 5);
  assert.equal(getStickerCopies(2.5, 1), 3);
  assert.equal(getQuantityPerSticker(2.5, 1, 3), 0.5);
});

test('quantity per sticker matches how many stickers were printed', () => {
  assert.equal(getStickerCopies(3), 3);
  assert.equal(getQuantityPerSticker(3), 1);
  assert.equal(getStickerCopies(2.5), 1);
  assert.equal(getQuantityPerSticker(2.5), 2.5);
  assert.equal(getStickerCopies(400), 200);
  assert.equal(getQuantityPerSticker(400), 2);
});

const fakeDb = (rows, packs = []) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      if (/product_pack_sizes/.test(sql)) {
        if (/CREATE TABLE/.test(sql)) return [[]];
        return [packs.filter((pack) => pack.product_id === params?.[0])];
      }
      calls.push({ sql, params });
      return [rows];
    }
  };
};

test('lookup only accepts transform output rows and returns per-sticker quantity', async () => {
  const db = fakeDb([{
    id: 146290, reference_id: 'PRD-1', product_id: 176, department_id: 20, quantity: '3.00',
    created_at: new Date('2026-11-09T03:55:08Z'), product_name: 'น้ำส้มตำลาว 10 ลิตร', product_code: 'PT0052',
    unit_name: 'แกลลอน', unit_abbr: 'ก.ล.', department_name: 'แผนกครัว'
  }]);
  const result = await findTransformSticker('001462900002', { db });
  assert.equal(result.status, 'ok');
  assert.equal(result.sticker.product_id, 176);
  assert.equal(result.sticker.quantity_per_sticker, 1);
  assert.equal(result.sticker.copies, 3);
  assert.equal(result.sticker.sequence_valid, true);
  assert.deepEqual(db.calls[0].params, [146290]);
  assert.match(db.calls[0].sql, /reference_type = 'production_transform'/);
  assert.match(db.calls[0].sql, /it\.quantity > 0/);
});

test('lookup uses the product pack size for the per-sticker quantity', async () => {
  const row = {
    id: 150000, reference_id: 'PRD-2', product_id: 204, department_id: 20, quantity: '12.00',
    created_at: new Date('2026-11-09T03:55:08Z'), product_name: 'ไก่บ้านหมักย่าง', product_code: 'PT0036',
    unit_name: 'ตัว', unit_abbr: 'ตัว', department_name: 'แผนกครัว'
  };
  const db = fakeDb([row], [{ product_id: 204, pack_size: '5.000', pack_unit_label: 'ถุง' }]);
  const first = await findTransformSticker('001500000001', { db });
  assert.equal(first.sticker.quantity_per_sticker, 5);
  assert.equal(first.sticker.copies, 3);
  assert.equal(first.sticker.pack_size, 5);
  const last = await findTransformSticker('001500000003', { db });
  assert.equal(last.sticker.quantity_per_sticker, 2);
});

test('lookup reports invalid and missing codes without guessing', async () => {
  const empty = fakeDb([]);
  assert.equal((await findTransformSticker('abc', { db: empty })).status, 'invalid');
  assert.equal(empty.calls.length, 0);
  assert.equal((await findTransformSticker('009999990001', { db: empty })).status, 'not_found');
});
