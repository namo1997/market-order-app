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

test('quantity per sticker matches how many stickers were printed', () => {
  assert.equal(getStickerCopies(3), 3);
  assert.equal(getQuantityPerSticker(3), 1);
  assert.equal(getStickerCopies(2.5), 1);
  assert.equal(getQuantityPerSticker(2.5), 2.5);
  assert.equal(getStickerCopies(400), 200);
  assert.equal(getQuantityPerSticker(400), 2);
});

const fakeDb = (rows) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
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

test('lookup reports invalid and missing codes without guessing', async () => {
  const empty = fakeDb([]);
  assert.equal((await findTransformSticker('abc', { db: empty })).status, 'invalid');
  assert.equal(empty.calls.length, 0);
  assert.equal((await findTransformSticker('009999990001', { db: empty })).status, 'not_found');
});
