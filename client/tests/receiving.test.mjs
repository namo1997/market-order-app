import test from 'node:test';
import assert from 'node:assert/strict';
import { WARNING_TEXT, warningText, scaledInteger, decimalString, lineAmount, sumLines,
  ensurePending, readPending, clearPending, documentBody, bangkokDate, canVoid, errorText,
} from '../src/pages/receiving/receiving-utils.js';
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES, validateSource, resizeDimensions, validateCompressed,
  compressWithEncoder, compressImage, assignPageNumbers } from '../src/pages/receiving/image-utils.js';

test('image: source limit is checked before decoding; reject unsupported formats', () => {
  assert.throws(() => validateSource({ size: MAX_SOURCE_BYTES + 1, type: 'image/jpeg' }));
  assert.throws(() => validateSource({ size: 0, type: 'image/jpeg' }));
  assert.throws(() => validateSource({ size: 100, type: 'image/svg+xml' }));
  assert.throws(() => validateSource({ size: 100, type: 'image/heic' }));
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validateSource({ size: 100, type }));
});
test('image: maintain portrait/landscape ratio, no enlargement, reject pixel bomb', () => {
  assert.deepEqual(resizeDimensions(4000, 3000), { width: 2400, height: 1800 });
  assert.deepEqual(resizeDimensions(3000, 4000), { width: 1800, height: 2400 });
  assert.deepEqual(resizeDimensions(320, 240), { width: 320, height: 240 });
  assert.throws(() => resizeDimensions(0, 300));
  assert.throws(() => resizeDimensions(100000, 100000));
});
test('image: output boundary <=3MB, reject null/empty/oversized output', () => {
  assert.equal(validateCompressed({ size: MAX_IMAGE_BYTES }).size, MAX_IMAGE_BYTES);
  assert.throws(() => validateCompressed({ size: MAX_IMAGE_BYTES + 1 }));
  assert.throws(() => validateCompressed({ size: 0 }));
  assert.throws(() => validateCompressed(null));
});
test('image: encoder reduces quality and resolution until actual bytes fit', async () => {
  const calls = [];
  const result = await compressWithEncoder(async (scale, quality) => {
    calls.push([scale, quality]);
    return { size: scale < 1 ? MAX_IMAGE_BYTES : MAX_IMAGE_BYTES + 1 };
  });
  assert.equal(result.size, MAX_IMAGE_BYTES);
  assert.deepEqual(calls, [[1, .86], [1, .72], [1, .55], [.8, .86]]);
});
test('image: encoder failures stop after bounded attempts', async () => {
  let calls = 0;
  await assert.rejects(compressWithEncoder(async () => { calls++; return { size: MAX_IMAGE_BYTES + 1 }; }));
  assert.equal(calls, 12);
  await assert.rejects(compressWithEncoder(async () => null));
});
test('image: spoofed MIME rejected before browser decode', async () => {
  const fake = { size: 5, type: 'image/jpeg', slice: () => new Blob(['hello']) };
  await assert.rejects(compressImage(fake), /ไม่ใช่รูป/);
});
test('upload: partial failure and lost response retry identical page numbers without overwriting other pages', () => {
  const first = assignPageNumbers([{ page_no: 1 }], [{ key: 'a' }, { key: 'b' }]);
  assert.deepEqual(first.map((page) => page.pageNo), [2, 3]);
  const failed = first.map((page) => ({ ...page, state: 'failed' }));
  assert.deepEqual(assignPageNumbers([{ page_no: 1 }, { page_no: 2 }], failed).map((page) => page.pageNo), [2, 3]);
  assert.deepEqual(assignPageNumbers([{ page_no: 1 }, { page_no: 2 }], [failed[1], { key: 'c' }]).map((page) => page.pageNo), [3, 4]);
  assert.throws(() => assignPageNumbers([{ page_no: 10 }], [{ key: 'over' }]), /10/);
});
test('warnings: all contract codes have distinct Thai messages, unknown safe fallback', () => {
  assert.equal(Object.keys(WARNING_TEXT).length, 8);
  assert.equal(new Set(Object.values(WARNING_TEXT)).size, 8);
  for (const code of ['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH', 'PRICE_CHANGE', 'QTY_SHORT', 'QTY_OVER', 'UNMATCHED_LINE', 'DUPLICATE_BILL', 'LOW_CONFIDENCE']) {
    assert.match(warningText(code), /[ก-๙]/);
    assert.equal(warningText({ code, message: '<script>bad</script>' }), warningText(code));
  }
  assert.match(warningText('UNKNOWN'), /ตรวจสอบ/);
});
test('money: 0.1 + 0.2 is exactly 30 satang; commas and half-up are consistent', () => {
  assert.equal(sumLines([{ amount: '0.1' }, { amount: '0.2' }]), 30n);
  assert.equal(scaledInteger('1,234.565'), 123457n);
  assert.equal(decimalString(scaledInteger('1.005')), '1.01');
  assert.equal(decimalString(scaledInteger('0.004')), '0.00');
  assert.equal(decimalString(-1n), '-0.01');
  for (const value of ['-1', 'NaN', 'Infinity', '1e9', '<script>', '']) assert.throws(() => scaledInteger(value));
});
test('money: fractional quantities and six decimal prices rounded once per line', () => {
  assert.equal(lineAmount({ quantity_billed: '1.25', unit_price: '2.50' }), 313n);
  assert.equal(lineAmount({ quantity_billed: '3', unit_price: '0.335000' }), 101n);
  assert.equal(lineAmount({ quantity_received: '0.3', unit_price: '0.1' }), 3n);
  assert.equal(lineAmount({ quantity_billed: '', quantity_received: '2', unit_price: '1' }), 200n);
  assert.equal(lineAmount({ amount: '7.00', quantity_billed: '2', unit_price: '2' }), 700n);
  assert.equal(sumLines([{ quantity_billed: '1.25', unit_price: '2.50' }, { amount: '0.2' }]), 333n);
});
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const draft = { kind: 'bill', delivery_date: '2026-10-15', order_item_ids: [42] };
test('UUID: repeat click and reload retain original UUID and frozen create payload', () => {
  const storage = memoryStorage();
  let generated = 0;
  const uuid = () => `uuid-${++generated}`;
  const first = ensurePending('user-1', draft, null, storage, uuid);
  const retry = ensurePending('user-1', { ...draft, order_item_ids: [99] }, first.payload, storage, uuid);
  const reload = ensurePending('user-1', { ...draft, kind: 'manual_receipt' }, null, storage, uuid);
  assert.deepEqual(retry.payload, first.payload);
  assert.deepEqual(reload.payload, first.payload);
  assert.equal(generated, 1);
  assert.equal(first.persisted, true);
  clearPending('user-1', storage);
  assert.equal(readPending('user-1', storage), null);
  assert.notEqual(ensurePending('user-1', draft, null, storage, uuid).payload.client_uuid, first.payload.client_uuid);
});
test('UUID: storage denied/corrupt is safe and current in-memory payload remains stable', () => {
  const storage = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
  const first = ensurePending('key', draft, null, storage, () => 'original');
  assert.equal(first.persisted, false);
  assert.equal(ensurePending('key', draft, first.payload, storage, () => 'wrong').payload.client_uuid, 'original');
  assert.doesNotThrow(() => clearPending('key', storage));
  assert.equal(readPending('key', { getItem: () => '{bad' }), null);
});
test('document: serialize only contract fields and preserve IDs/deleted IDs and optional values', () => {
  const result = documentBody({ subtotal: '', total: '0.3', lines: [{ id: 5, _key: 'local', quantity_billed: '0.3', quantity_received: '0.2', unit_price: '1', amount: null, product_id: 7, order_item_id: 42 }] }, [9]);
  assert.equal(result.total, '0.30');
  assert.equal(result.subtotal, null);
  assert.deepEqual(result.deleted_line_ids, [9]);
  assert.equal(result.lines[0].id, 5);
  assert.equal(result.lines[0].amount, '0.30');
  assert.equal(result.lines[0].order_item_id, 42);
  assert.equal('_key' in result.lines[0], false);
  assert.throws(() => documentBody({ lines: [{ quantity_received: '-1' }] }));
  const changedProduct = documentBody({ lines: [{ quantity_received: '1', unit_multiplier: 1 }] });
  assert.equal(changedProduct.lines[0].unit_multiplier, 1);
  assert.equal('unit_multiplier' in result.lines[0], false);
});
test('date and void: Bangkok midnight, owner same day, admin and terminal state', () => {
  assert.equal(bangkokDate(new Date('2026-10-15T17:00:00Z')), '2026-10-16');
  const doc = { status: 'confirmed', receiver_user_id: 1, confirmed_at: '2026-10-15T16:59:00Z' };
  assert.equal(canVoid(doc, { id: 1 }, new Date('2026-10-15T16:59:30Z')), true);
  assert.equal(canVoid(doc, { id: 2 }, new Date('2026-10-15T16:59:30Z')), false);
  assert.equal(canVoid(doc, { id: 1 }, new Date('2026-10-15T17:00:00Z')), false);
  assert.equal(canVoid(doc, { id: 2, role: 'admin' }, new Date('2026-10-15T17:00:00Z')), true);
  assert.equal(canVoid({ ...doc, status: 'void' }, { role: 'admin' }), false);
});
test('errors: OCR and conflict/network are Thai and never expose raw server errors', () => {
  for (const [status, code] of [[429, 'RATE_LIMITED'], [503, 'OCR_UNAVAILABLE'], [409, 'NOT_DRAFT'], [403, 'FORBIDDEN'], [422, 'VALIDATION_FAILED'], [404, 'NOT_FOUND']]) {
    const result = errorText({ response: { status, data: { code, message: 'SQL SECRET STACK' } } });
    assert.match(result, /[ก-๙]/);
    assert.doesNotMatch(result, /SQL|SECRET|STACK/);
  }
  assert.match(errorText({}), /การเชื่อมต่อ/);
});
