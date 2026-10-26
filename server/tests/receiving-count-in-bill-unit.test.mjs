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

// Owner 2026-10-26 "ทำให้อ่าน 1x24 บนบิลเดาขนาดแพ็คเองด้วย".
test('only "1x<n>" printed on the row is a pack; bag sizes and same-unit rows are not', async () => {
  const { printedPackSize, printedPack } = await import('../src/services/receiving-ocr-matcher.js');
  for (const [text, size] of [['โคคาโคลา กระป๋อง325มล. 1x24', 24], ['LH CAN325(1x24,6x4)NS', 24], ['น้ำดื่ม 1*12', 12], ['ไข่ 1 x 30', 30], ['ซอส 1×6', 6],
    ['ถุงร้อน 6x14', null], ['ถุงหิ้ว 8*16', null], ['21x24', null], ['1x1', null], ['ข้าว 15กก', null], ['1.5x2', null]]) assert.equal(printedPackSize(text), size, text);
  assert.equal(printedPack('โค้ก 1x24', 'ลัง', 'กระป๋อง'), 24);
  assert.equal(printedPack('โค้ก 1x24', 'ลัง', 'ลัง'), null, 'counted in ลัง already');
  assert.equal(printedPack('โค้ก 1x24', '', 'กระป๋อง'), null, 'no printed unit');
});

test('an alias without a taught pack takes the printed 1x24 when the units differ', async () => {
  const { matchOcrLinesToCatalog } = await import('../src/services/receiving-ocr-matcher.js');
  const [line] = matchOcrLinesToCatalog({ supplierKey: 'pg:9',
    ocrLines: [{ line_no: 1, bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', quantity_billed: 4, unit_text: 'ลัง', unit_price: 325.23, amount: 1300.92, confidence: 0.99 }],
    aliases: [{ supplier_key: 'pg:9', bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', normalized_bill_text: 'โคคาโคลา กระป๋อง325มล. 1x24', normalized_unit_text: 'กระป๋อง',
      product_id: 34, product_name: 'โค้กกระป๋อง', product_unit_name: 'กระป๋อง', product_unit_id: 7, unit_id: 7, unit_multiplier: 1, confirm_count: 2, is_active: 1 }] });
  assert.equal(line.product_id, 34); assert.equal(line.unit_multiplier, 24); assert.equal(Number(line.quantity_received), 96); assert.equal(line.unit_text, 'กระป๋อง');
});

test('picking the product for an unmatched 1x24 line restates the count once and audits the original', async () => {
  const { h, doc, params, blind } = await readBeforeCount([{ bill_text: 'สไปรท์ กระป๋อง325มล. 1x24', quantity_billed: 2, unit_text: 'ลัง', unit_price: 325.23, amount: 650.46 }]);
  const row = blind.lines.find(line => line.bill_name === 'สไปรท์ กระป๋อง325มล. 1x24');
  assert.ok(row && !row.product_id && !row.count_unit);
  const counted = await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: blind.lines.map(line => ({ id: line.id, counted_quantity: line.id === row.id ? '2' : '0' })) } });
  assert.equal(counted.statusCode, 200, JSON.stringify(counted.body));
  const put = body => h.invoke('updateDocument', { user, params, body });
  const lines = [{ id: row.id, product_id: 8, product_name: 'ผักกาดขาว', unit_text: 'กก.', quantity_billed: '48', quantity_received: '48', unit_price: '13.55125', count_unit: { unit: 'ลัง', size: 24 } }];
  assert.equal((await put({ lines })).statusCode, 200);
  const stored = h.state.lines.find(line => line.id === row.id);
  assert.equal(Number(stored.counted_quantity), 48); assert.equal(stored.count_unit_text, 'ลัง'); assert.equal(Number(stored.count_unit_size), 24);
  const audit = h.state.audits.find(a => a.action === 'pack_from_bill');
  assert.deepEqual({ ...audit.details.from }, { counted: 2, unit: 'ลัง' }); assert.equal(audit.details.size, 24);
  assert.equal((await put({ lines })).statusCode, 200);
  assert.equal(Number(h.state.lines.find(line => line.id === row.id).counted_quantity), 48, 'a second save never multiplies again');
  assert.equal((await put({ lines: [{ ...lines[0], count_unit: { unit: "ลัง", size: 1 } }] })).statusCode, 422);
});

// Pilot 2026-10-26: 325.23 per ลัง / 24 = 13.55125 per can came back as 13.55 and the next save stored it (−18 satang).
test('a per-unit price keeps 6 decimals through the API so a later save cannot round it', async () => {
  const { formatUnitPrice } = await import('../src/services/receiving-ocr.service.js');
  assert.equal(formatUnitPrice('13.551250'), '13.55125'); assert.equal(formatUnitPrice('150.000000'), '150.00');
  assert.equal(formatUnitPrice('0.025'), '0.025'); assert.equal(formatUnitPrice(null), null);
  const { h, doc, params, blind } = await readBeforeCount([{ bill_text: 'สไปรท์ กระป๋อง325มล. 1x24', quantity_billed: 1, unit_text: 'ลัง', unit_price: 325.23, amount: 325.23 }]);
  const row = blind.lines.find(line => line.bill_name);
  await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: blind.lines.map(line => ({ id: line.id, counted_quantity: line.id === row.id ? '1' : '0' })) } });
  const saved = await h.invoke('updateDocument', { user, params, body: { lines: [{ id: row.id, product_id: 8, unit_text: 'กก.', quantity_billed: '24', quantity_received: '24', unit_price: '13.55125', count_unit: { unit: 'ลัง', size: 24 } }] } });
  const line = saved.body.data.lines.find(item => item.id === row.id);
  assert.equal(line.unit_price, '13.55125');
});
