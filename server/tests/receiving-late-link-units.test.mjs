import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { setCustomOcrProvider, resetOcrRateLimit } from '../src/services/receiving-ocr.service.js';
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });

// Bug hunt 2026-10-24: staff receive an unmatched line in the bill's unit (2 ลัง); linking it to a product counted
// in กก. used to post 2 กก. Accounting now gives the quantity in the product's unit.
const accounting = { id: 50, role: 'accounting', name: 'บัญชี', branch_id: 1, department_id: 10 };
const bill = () => ({ doc_kind: 'bill', total: '1.00', confidence: .99, lines: [
  { bill_text: 'หลอดใหญ่', quantity_billed: '10', unit_text: 'กก.', unit_price: '0.05', amount: '0.50', confidence: .99 },
  { bill_text: 'สามชั้นแพ็คลัง', quantity_billed: '2', unit_text: 'ลัง', unit_price: '0.25', amount: '0.50', confidence: .9 } ] });

async function confirmedWithBoxLine() {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20', serializeTransactions: true });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'late-units', kind: 'bill', delivery_date: h.today, supplier_master_id: 8, order_item_ids: [] } });
  const params = { id: created.body.data.id };
  await h.invoke('saveCount', { user, params, body: { client_uuid: 'late-units', lines: [{ product_id: 8, counted_quantity: '10.00', unit_text: 'กก.' }] } });
  await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  h.state.aliases.push({ id: 1, supplier_key: 'sm:8', bill_text: 'หลอดใหญ่', normalized_bill_text: 'หลอดใหญ่', normalized_unit_text: 'กก.', product_id: 8, unit_id: 2, unit_multiplier: 1, confirm_count: 2 });
  setCustomOcrProvider(async () => bill());
  const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  const box = read.body.data.lines.find(r => !r.product_id); const known = read.body.data.lines.find(r => r.product_id === 8);
  await h.invoke('updateDocument', { user, params, body: { lines: [{ id: known.id, review_decision: 'accept' }, { id: box.id, quantity_received: '2.00', review_decision: 'receive_unmatched' }] } });
  await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  return { h, params, box };
}

test('linking a box line to a product counted in กก. needs the กก. quantity and posts that', async () => {
  const { h, params, box } = await confirmedWithBoxLine();
  const stock7 = () => Number(h.state.inventoryBalances.get('7:10')?.quantity ?? 0);
  const before = stock7();
  await assert.rejects(h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: box.id, body: { product_id: 7 } }),
    e => e.code === 'VALIDATION_FAILED' && /บิลเป็น ลัง แต่สินค้านี้นับเป็น กก\./.test(e.message));
  assert.equal(stock7(), before, 'a refused link posts nothing');
  await assert.rejects(h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: box.id, body: { product_id: 7, quantity_received: '0' } }), e => e.code === 'VALIDATION_FAILED');
  const linked = await h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: box.id, body: { product_id: 7, quantity_received: '20', remember_alias: true } });
  assert.equal(linked.quantity, 20); assert.equal(linked.unit, 'กก.');
  assert.equal(stock7(), before + 20, 'stock in the product unit');
  const line = h.state.lines.find(l => l.id === box.id);
  assert.equal(Number(line.quantity_received), 20); assert.equal(Number(line.quantity_billed), 20); assert.equal(line.unit_text, 'กก.');
  assert.equal(Number(line.base_unit_price), 0.025, 'the bill amount spread over the product unit');
  assert.equal(Number(line.unit_price), 0.025, 'price per กก., so received value stays 20 × 0.025 = 0.50');
  assert.equal(line.counted_quantity, null, 'no count on this line (received for now)') ;
  const alias = h.state.aliases.find(a => a.bill_text === 'สามชั้นแพ็คลัง');
  assert.equal(alias.product_id, 7); assert.equal(Number(alias.unit_multiplier), 10, '1 ลัง = 10 กก. learned as a whole pack');
  const audit = h.state.audits.find(a => a.action === 'link_product');
  assert.deepEqual(audit.details.converted, { from: { quantity: 2, unit: 'ลัง', counted: null }, to: { quantity: 20, unit: 'กก.' }, factor: 10 });
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'ทดสอบหน่วย' } })).statusCode, 200);
  assert.equal(stock7(), before, 'void takes back exactly what was posted');
});

test('units compare by id or by name, kilogram spellings alike', async () => {
  const { sameLinkUnit } = (await createReceivingHarness({})).lateLink;
  assert.equal(sameLinkUnit({ unit_id: 2, unit_text: 'ลัง' }, { unit_id: 2, unit_name: 'กก.' }), true);
  assert.equal(sameLinkUnit({ unit_text: 'กิโลกรัม' }, { unit_id: 2, unit_name: 'กก.' }), true);
  assert.equal(sameLinkUnit({ unit_text: 'ลัง' }, { unit_id: 2, unit_name: 'กก.' }), false);
  assert.equal(sameLinkUnit({ unit_text: '' }, { unit_id: 2, unit_name: 'กก.' }), false, 'an unknown bill unit asks for the quantity');
});
