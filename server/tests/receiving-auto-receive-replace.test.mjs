import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, makePngDataUrl, deltaActor as user } from './helpers/receiving-fake-db.mjs';

const date = '2026-10-20';
const afterCutoff = new Date('2026-10-20T16:30:00Z');
const AUTO = 'รับอัตโนมัติวันถัดไป (ไม่มีผู้กดรับสินค้า)';

async function draft(h, { uuid, qty, items = [50], products = [7] }) {
  const created = await h.invoke('createDocument', { user, body: { client_uuid: uuid, delivery_date: date,
    kind: 'bill', product_group_id: 3, order_item_ids: items } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = String(created.body.data.id);
  const lines = items.map((order_item_id, index) => ({ id: created.body.data.lines[index]?.id, line_no: index + 1,
    product_id: products[index], order_item_id, bill_text: `SYNTHETIC ${products[index]}`,
    quantity_received: String(qty[index] ?? qty), quantity_billed: String(qty[index] ?? qty), unit_price: '10.00' }));
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines } });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  const signed = await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
  return id;
}
async function setup() {
  const h = await createReceivingHarness({ testDate: date });
  for (const row of h.state.orderItems) { row.order_date = '2026-10-19'; row.skip_receiving_required = 1; }
  return h;
}
const item = (h, id) => h.state.orderItems.find(row => row.id === id);
// Order item 50 is product 7 in department 10; other auto-received items touch other balances.
const stock = h => Number(h.state.inventoryBalances.get('7:10').quantity);
const quantities = h => [...h.state.inventoryBalances.entries()].map(([key, row]) => [key, Number(row.quantity)]);
const auto = h => h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: afterCutoff });
const confirm = (h, id) => h.invoke('confirmDocument', { user, params: { id } });

for (const [counted, label] of [[7, 'short'], [12, 'over']]) {
  test(`auto-received 10 then draft counted ${counted} (${label}) replaces instead of adding`, async () => {
    const h = await setup();
    const id = await draft(h, { uuid: `replace-${counted}`, qty: counted });
    const before = stock(h);
    await auto(h);
    assert.equal(item(h, 50).received_quantity, 10);
    assert.equal(stock(h), before + 10);
    const res = await confirm(h, id);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(Number(item(h, 50).received_quantity), counted, 'replaced, not 10 + counted');
    assert.equal(item(h, 50).is_received, true);
    assert.equal(stock(h), before + counted, 'inventory net equals the counted quantity only');
    assert.ok(!item(h, 50).receive_notes.includes(AUTO), 'auto note replaced');
    assert.match(item(h, 50).receive_notes, new RegExp(`รับสินค้าตามเอกสาร #${id}`));
    const audit = h.state.audits.find(a => a.action === 'replace_auto_receive' && a.document_id === Number(id));
    assert.ok(audit, 'audit entry written');
    assert.equal(audit.details.previous_auto_quantity, 10);
    assert.equal(audit.details.counted_quantity, counted);
    assert.equal(audit.details.inventory_delta, counted - 10);
    assert.equal(Number(h.state.lines.find(l => l.document_id === Number(id)).replaced_auto_receive_quantity), 10);
  });
}

test('confirm then void restores the exact auto-received state and inventory; second confirm and void are idempotent', async () => {
  const h = await setup();
  const id = await draft(h, { uuid: 'replace-void', qty: 7 });
  await auto(h);
  const snapshot = structuredClone({ oi: item(h, 50), stock: stock(h), balances: quantities(h) });
  assert.equal((await confirm(h, id)).statusCode, 200);
  const txAfterConfirm = h.state.inventoryTransactions.length;
  const retry = await confirm(h, id);
  assert.equal(retry.statusCode, 409, 'confirm retry rejected without a second application');
  assert.equal(h.state.inventoryTransactions.length, txAfterConfirm);
  assert.equal(Number(item(h, 50).received_quantity), 7);
  const voided = await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'ทดสอบย้อนยอดรับอัตโนมัติ' } });
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  const oi = item(h, 50);
  assert.equal(Number(oi.received_quantity), 10);
  assert.equal(oi.is_received, true);
  assert.equal(oi.receive_notes, snapshot.oi.receive_notes);
  assert.ok(oi.receive_notes.startsWith(AUTO));
  assert.equal(oi.received_by_user_id, snapshot.oi.received_by_user_id);
  assert.equal(stock(h), snapshot.stock, 'inventory back to the auto-received level');
  assert.deepEqual(quantities(h), snapshot.balances, 'every balance back to the auto-received level');
  const txAfterVoid = h.state.inventoryTransactions.length;
  const again = await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'ซ้ำ' } });
  assert.notEqual(again.statusCode, 200);
  assert.equal(h.state.inventoryTransactions.length, txAfterVoid);
  assert.equal(Number(item(h, 50).received_quantity), 10);
});

test('an item with a real confirmed receipt keeps accumulating (no replacement)', async () => {
  const h = await setup();
  const first = await draft(h, { uuid: 'real-first', qty: 6 });
  assert.equal((await confirm(h, first)).statusCode, 200);
  assert.equal(Number(item(h, 50).received_quantity), 6);
  const second = await draft(h, { uuid: 'real-second', qty: 3 });
  assert.equal((await confirm(h, second)).statusCode, 200);
  assert.equal(Number(item(h, 50).received_quantity), 9, 'accumulates');
  assert.ok(!h.state.audits.some(a => a.action === 'replace_auto_receive'));
  // Auto note present but another confirmed document exists: still accumulates.
  item(h, 50).receive_notes = `${AUTO}\n${item(h, 50).receive_notes}`;
  const third = await draft(h, { uuid: 'real-third', qty: 1 });
  assert.equal((await confirm(h, third)).statusCode, 200);
  assert.equal(Number(item(h, 50).received_quantity), 10);
  assert.ok(!h.state.audits.some(a => a.action === 'replace_auto_receive'));
});

test('required groups are untouched by auto-receive and confirm accumulates on their manual state', async () => {
  const h = await setup();
  item(h, 50).skip_receiving_required = 0;
  const id = await draft(h, { uuid: 'required', qty: 4 });
  await auto(h);
  assert.equal(item(h, 50).received_quantity, null, 'required group not auto-received');
  assert.equal((await confirm(h, id)).statusCode, 200);
  assert.equal(Number(item(h, 50).received_quantity), 4);
  assert.ok(!h.state.audits.some(a => a.action === 'replace_auto_receive'));
  // Prior non-auto received state (e.g. staff keyed 5 before) still adds up.
  const h2 = await setup();
  Object.assign(item(h2, 50), { received_quantity: 5, is_received: true, receive_notes: 'นับเอง' });
  const id2 = await draft(h2, { uuid: 'manual-prior', qty: 2 });
  assert.equal((await confirm(h2, id2)).statusCode, 200);
  assert.equal(Number(item(h2, 50).received_quantity), 7);
});

test('replacement keeps other notes and a failure mid-confirm rolls the auto state back untouched', async () => {
  const h = await setup();
  const id = await draft(h, { uuid: 'replace-notes', qty: 7 });
  await auto(h);
  item(h, 50).receive_notes = `${item(h, 50).receive_notes}\nฝากของไว้ที่ห้องเย็น`;
  const before = structuredClone(item(h, 50));
  h.state.failOnConfirmAudit = true;
  const failed = await confirm(h, id);
  assert.equal(failed.statusCode, 500);
  h.state.failOnConfirmAudit = false;
  assert.deepEqual(item(h, 50), before, 'rolled back');
  assert.equal((await confirm(h, id)).statusCode, 200);
  assert.equal(item(h, 50).receive_notes.split('\n')[0], 'ฝากของไว้ที่ห้องเย็น');
  assert.ok(!item(h, 50).receive_notes.includes(AUTO));
  const voided = await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'ทดสอบ' } });
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  assert.equal(item(h, 50).receive_notes, before.receive_notes);
  assert.equal(Number(item(h, 50).received_quantity), 10);
});
