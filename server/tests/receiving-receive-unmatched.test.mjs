import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makeJpegDataUrl, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { setCustomOcrProvider, resetOcrRateLimit } from '../src/services/receiving-ocr.service.js';
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });

// Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": a bill line whose product is not in the catalogue is received for now
// (receive_unmatched, no stock); accounting links the product later and only then is it posted like confirm does.
const accounting = { id: 50, role: 'accounting', name: 'บัญชี', branch_id: 1, department_id: 10 };
const bill = () => ({ doc_kind: 'bill', total: '0.70', confidence: .99, lines: [
  { bill_text: 'หลอดใหญ่', quantity_billed: '10', unit_text: 'กก.', unit_price: '0.05', amount: '0.50', confidence: .99 },
  { bill_text: 'ของใหม่ไม่มีในระบบ', quantity_billed: '4', unit_text: 'กก.', unit_price: '0.05', amount: '0.20', confidence: .9 } ] });

async function receivedForNow() {
  const h = await createReceivingHarness({ prepareCount: false, testDate: '2026-10-20', serializeTransactions: true });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'later-1', kind: 'bill', delivery_date: h.today, supplier_master_id: 8, order_item_ids: [] } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const params = { id: created.body.data.id };
  assert.equal((await h.invoke('saveCount', { user, params, body: { client_uuid: 'later-1', lines: [{ product_id: 8, counted_quantity: '10.00', unit_text: 'กก.' }] } })).statusCode, 200);
  assert.equal((await h.invoke('uploadImage', { user, params, body: { page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  h.state.aliases.push({ id: 1, supplier_key: 'sm:8', bill_text: 'หลอดใหญ่', normalized_bill_text: 'หลอดใหญ่', normalized_unit_text: 'กก.', product_id: 8, unit_id: 2, unit_multiplier: 1, confirm_count: 2 });
  setCustomOcrProvider(async () => bill());
  const read = await h.invoke('runOcr', { user, params }); assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  const rows = read.body.data.lines; const unknown = rows.find(r => !r.product_id); const known = rows.find(r => r.product_id === 8);
  assert.ok(unknown && known);
  return { h, params, unknown, known };
}

test('a line with no product can be received for now; confirm posts nothing for it', async () => {
  const { h, params, unknown, known } = await receivedForNow();
  const stockBefore = structuredClone([...h.state.inventoryBalances.entries()]);
  // Without a decision the receipt still refuses an unmatched line.
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: known.id, review_decision: 'accept' },
    { id: unknown.id, quantity_received: '4.00', review_decision: 'receive_unmatched' }] } })).statusCode, 200);
  assert.equal(h.state.lines.find(l => l.id === unknown.id).review_decision, 'receive_unmatched');
  assert.equal((await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  const confirmed = await h.invoke('confirmDocument', { user, params });
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const waiting = h.state.lines.find(l => l.id === unknown.id);
  assert.equal(waiting.product_id, null); assert.equal(waiting.order_item_id ?? null, null);
  const after = new Map(h.state.inventoryBalances);
  assert.ok(![...after.keys()].some(key => !new Map(stockBefore).has(key) && !key.startsWith('8:')), 'only the known product moved stock');
});

test('receive_unmatched is refused for a line that has a product or no quantity', async () => {
  const { h, params, unknown, known } = await receivedForNow();
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: known.id, review_decision: 'receive_unmatched' }] } })).statusCode, 422);
  assert.equal((await h.invoke('updateDocument', { user, params, body: { lines: [{ id: unknown.id, quantity_received: '0', review_decision: 'receive_unmatched' }] } })).statusCode, 422);
});

test('accounting links the product later: order item, stock and alias follow; second link and staff are refused; void undoes it', async () => {
  const { h, params, unknown, known } = await receivedForNow();
  await h.invoke('updateDocument', { user, params, body: { lines: [{ id: known.id, review_decision: 'accept' }, { id: unknown.id, quantity_received: '4.00', review_decision: 'receive_unmatched' }] } });
  await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  const stock7 = () => Number(h.state.inventoryBalances.get('7:10')?.quantity ?? 0);
  const before = stock7();
  await assert.rejects(h.lateLink.linkReceivedLineProduct({ user, documentId: params.id, lineId: unknown.id, body: { product_id: 7 } }), e => e.code === 'FORBIDDEN');
  const linked = await h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: unknown.id, body: { product_id: 7, remember_alias: true } });
  assert.equal(linked.product_id, 7); assert.ok(linked.order_item_id);
  const line = h.state.lines.find(l => l.id === unknown.id);
  assert.equal(line.product_id, 7); assert.equal(line.order_item_id, linked.order_item_id);
  assert.equal(stock7(), before + 4, 'stock posted at link time');
  assert.equal(h.state.orders.filter(o => o.order_number === `RC-${params.id}`).length, 1, 'one receipt order');
  assert.equal(h.state.aliases.find(a => a.bill_text === 'ของใหม่ไม่มีในระบบ')?.product_id, 7);
  assert.ok(h.state.audits.some(a => a.action === 'link_product' && a.document_id === params.id));
  await assert.rejects(h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: unknown.id, body: { product_id: 7 } }), e => e.code === 'NOT_DRAFT');
  assert.equal((await h.invoke('voidDocument', { user, params, body: { reason: 'ทดสอบรับไปก่อน' } })).statusCode, 200);
  assert.equal(stock7(), before, 'void takes the late-linked stock back');
});

test('a draft cannot be linked late', async () => {
  const { h, params, unknown } = await receivedForNow();
  await assert.rejects(h.lateLink.linkReceivedLineProduct({ user: accounting, documentId: params.id, lineId: unknown.id, body: { product_id: 7 } }), e => e.code === 'NOT_DRAFT');
});
