import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOcrLinesToCatalog } from '../src/services/receiving-ocr-matcher.js';
import { createReceivingHarness, makePngDataUrl, deltaActor as user } from './helpers/receiving-fake-db.mjs';

async function receipt(h, { items = [50], lines, kind = 'bill', uuid = 'stock-integration' } = {}) {
  const created = await h.invoke('createDocument', { user, body: { client_uuid: uuid, delivery_date: h.today, kind, product_group_id: 3, order_item_ids: items } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = String(created.body.data.id);
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines: lines.map((line, i) => ({ id: created.body.data.lines[i]?.id, line_no: i + 1, bill_text: 'SYNTHETIC STOCK', unit_price: '1', ...line })) } });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  assert.equal((await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  return id;
}
const confirm = (h, id) => h.invoke('confirmDocument', { user, params: { id } });
const stock = (h, key = '7:10') => Number(h.state.inventoryBalances.get(key)?.quantity || 0);

test('base-unit quantity with pack multiplier is booked once; void reverses exactly and preserves foreign locations', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  const matched = matchOcrLinesToCatalog({ ocrLines: [{ line_no: 1, bill_text: 'SYNTHETIC PACK', quantity_billed: 2, unit_text: 'แพ็ก', unit_price: 12 }],
    supplierKey: 'pg:3', aliases: [{ supplier_key: 'pg:3', bill_text: 'SYNTHETIC PACK', product_id: 7, unit_multiplier: 12 }],
    products: [{ id: 7, name: 'หมูสามชั้น', unit_id: 2 }], expectedItems: [{ product_id: 7, order_item_id: 50, quantity_ordered: 10 }], units: [] });
  assert.equal(matched[0].quantity_received, 24, 'mock OCR alias converts bill packs to base units');
  const id = await receipt(h, { lines: [{ ...matched[0], quantity_received: String(matched[0].quantity_received), match: { source: 'manual', confidence: 1 } }] });
  assert.equal((await confirm(h, id)).statusCode, 200);
  assert.equal(stock(h), 29, '2 packs x 12 were converted to 24 base units before confirm, never 288');
  assert.equal(stock(h, '7:20'), 0);
  const tx = h.state.inventoryTransactions.find(t => t.product_id === 7);
  assert.equal(tx.quantity, 24);
  assert.equal(tx.department_id, 10);
  assert.equal(tx.notes, `รับสินค้าตามเอกสาร #${id}`);
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'synthetic reversal' } })).statusCode, 200);
  assert.equal(stock(h), 5);
});

test('unlinked stock product and manual receipt create readable real product movements and void exactly', async () => {
  for (const kind of ['bill', 'manual_receipt']) {
    const h = await createReceivingHarness({ testDate: '2026-10-20' });
    const id = await receipt(h, { kind, items: [], lines: [{ product_id: 7, quantity_received: '0.30', quantity_billed: '0.30' }] });
    assert.equal((await confirm(h, id)).statusCode, 200);
    assert.equal(stock(h), 5.3);
    const line = h.state.lines.find(l => l.document_id === Number(id));
    assert.ok(line.order_item_id, 'manual purchase is linked durably to the original product');
    const movement = h.state.inventoryTransactions.at(-1);
    assert.equal(movement.product_id, 7);
    assert.equal(movement.notes, `รับสินค้าตามเอกสาร #${id}`);
    assert.equal(h.state.orderItems.find(i => i.id === Number(line.order_item_id)).product_name, 'หมูสามชั้น');
    assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'synthetic void' } })).statusCode, 200);
    assert.equal(stock(h), 5);
  }
});

test('short repeated receipts keep exact decimals; each movement identifies only its own document', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  h.state.orderItems.find(i => i.id === 50).allow_pending_carryover = true;
  const ids = [];
  for (const [i, qty] of ['0.10', '0.20', '0.30'].entries()) {
    const id = await receipt(h, { uuid: `stock-repeat-${i}`, lines: [{ product_id: 7, order_item_id: 50, quantity_received: qty }] });
    ids.push(id);
    assert.equal((await confirm(h, id)).statusCode, 200);
    assert.equal(h.state.inventoryTransactions.at(-1).notes, `รับสินค้าตามเอกสาร #${id}`);
  }
  assert.deepEqual(h.state.inventoryTransactions.map(tx => tx.quantity), [0.1, 0.2, 0.3], 'movement quantities have no floating point subtraction residue');
  assert.equal(stock(h), 5.6);
  assert.equal(Number(h.state.orderItems.find(i => i.id === 50).received_quantity), 0.6);
  for (const id of [ids[1], ids[0], ids[2]]) assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'synthetic partial void' } })).statusCode, 200);
  assert.equal(stock(h), 5);
});

test('void refuses a receipt with a physical supplier return before touching orders or stock', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  const id = await receipt(h, { lines: [{ product_id: 7, order_item_id: 50, quantity_received: '2' }] });
  assert.equal((await confirm(h, id)).statusCode, 200);
  h.state.stockReturns.push({ issue_id: 1, document_id: Number(id) });
  const before = structuredClone(h.state.inventoryTransactions);
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'must reconcile first' } })).statusCode, 409);
  assert.equal(stock(h), 7);
  assert.deepEqual(h.state.inventoryTransactions, before);
});


test('first balance row is locked through upsert; two separate receipts cannot lose the first stock increase', async () => {
  const calls = [];
  const h = await createReceivingHarness({ testDate: '2026-10-20', serializeTransactions: true,
    queryHook: (sql, args) => { if (sql.includes('inventory_balance')) calls.push({ sql, args }); } });
  h.state.inventoryBalances.delete('7:10');
  const a = await receipt(h, { uuid: 'first-stock-row-1', lines: [{ product_id: 7, order_item_id: 50, quantity_received: '0.10' }] });
  const b = await receipt(h, { uuid: 'first-stock-row-2', lines: [{ product_id: 7, order_item_id: 50, quantity_received: '0.20' }] });
  const results = await Promise.all([confirm(h, a), confirm(h, b)]);
  assert.deepEqual(results.map(r => r.statusCode), [200, 200]);
  assert.equal(stock(h), 0.3);
  assert.deepEqual(h.state.inventoryTransactions.map(tx => tx.quantity), [0.1, 0.2]);
  for (let i = 0; i < calls.length; i++) if (calls[i].sql.startsWith('SELECT quantity')) {
    assert.match(calls[i - 1].sql, /ON DUPLICATE KEY UPDATE product_id = product_id$/);
    assert.deepEqual(calls[i - 1].args, calls[i].args);
  }
});
