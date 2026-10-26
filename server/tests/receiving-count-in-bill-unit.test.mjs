import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
import * as ocr from '../src/services/receiving-ocr.service.js';

// Owner 2026-10-26 "ทำตามแนวทางที่เสนอ" (Thai Namthip bills print "โคคาโคลา กระป๋อง325มล. 1x24 · 4 ลัง"; the
// product counts cans): a bill row with a known pack is counted in the printed unit and stored in counting units.
async function readBeforeCount(lines) {
  const h = await createReceivingHarness({ prepareCount: false });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'count-in-bill-unit', delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  const doc = created.body.data, params = { id: String(doc.id) };
  h.state.aliases.push({ id: 91, supplier_key: 'pg:3', bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', normalized_bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24',
    normalized_unit_text: 'ลัง', product_id: 7, unit_id: 2, unit_multiplier: 24, confirm_count: 3 });
  await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  ocr.setCustomOcrProvider(async () => ({ doc_date: h.today, total: 1500.92, subtotal: 1500.92, confidence: 1, lines }));
  try { const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200, JSON.stringify(read.body)); return { h, doc, params, blind: read.body.data }; }
  finally { ocr.setCustomOcrProvider(null); }
}

test('a known pack is counted in the bill unit: the blind view shows ลัง and 24, never the bill numbers', async () => {
  const { h, doc, params, blind } = await readBeforeCount([
    { bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', quantity_billed: 4, unit_text: 'ลัง', unit_price: 325.23, amount: 1300.92 },
    { bill_text: 'ผักชีฝรั่งพิเศษ', quantity_billed: 2, unit_text: 'กก.', unit_price: 100, amount: 200 }]);
  assert.equal(blind.blind, true);
  const cans = blind.lines.find(line => line.product_id === 7);
  assert.ok(cans, 'the bill row landed on the ordered cans');
  assert.deepEqual({ ...cans.count_unit }, { unit: 'ลัง', size: 24 });
  for (const key of ['quantity_billed', 'quantity_received', 'unit_price', 'amount', 'bill_read']) assert.equal(key in cans, false, key);
  assert.equal(blind.lines.filter(line => line.count_unit).length, 1, 'only the pack row');
  const counted = await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid,
    lines: blind.lines.map(line => ({ id: line.id, counted_quantity: line.id === cans.id ? '96' : '0' })) } });
  assert.equal(counted.statusCode, 200, JSON.stringify(counted.body));
  const revealed = counted.body.data.lines.find(line => line.id === cans.id);
  assert.equal(Number(revealed.counted_quantity), 96); assert.equal(Number(revealed.quantity_billed), 96);
  assert.deepEqual({ ...revealed.count_unit }, { unit: 'ลัง', size: 24 });
});

test('a bill row in the counting unit gets no count unit', async () => {
  const { blind } = await readBeforeCount([{ bill_text: 'ผักชีฝรั่งพิเศษ', quantity_billed: 2, unit_text: 'กก.', unit_price: 100, amount: 200 }]);
  assert.equal(blind.lines.some(line => line.count_unit), false);
});
