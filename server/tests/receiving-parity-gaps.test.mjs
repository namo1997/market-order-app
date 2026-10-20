import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createReceivingHarness, makePngDataUrl, deltaActor as user, settlementRows } from './helpers/receiving-fake-db.mjs';
import { groupQueue, withReceiptSummary } from '../src/models/receiving-queue-policy.js';
import { documentNotificationPayload, receivingNotificationText } from '../src/services/receiving-notify-policy.js';
import { createPushDispatcher } from '../src/services/receiving-push.js';

const date = '2026-10-20';
const afterCutoff = new Date('2026-10-20T16:30:00Z');
const beforeCutoff = new Date('2026-10-20T16:29:59Z');
const turn = () => new Promise(resolve => setImmediate(resolve));
async function ready(h, { uuid = 'parity-manual', group = 3, products = [7, 9], linked = false, billed = false } = {}) {
  const created = await h.invoke('createDocument', { user, body: { client_uuid: uuid,
    delivery_date: date, kind: billed ? 'bill' : 'manual_receipt', product_group_id: group,
    ...(linked ? { order_item_ids: [50, 51] } : {}) } });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = String(created.body.data.id);
  const changes = products.map((product_id, index) => ({ id: created.body.data.lines[index]?.id,
    line_no: index + 1, product_id, order_item_id: linked ? [50, 51][index] : null,
    bill_text: `SYNTHETIC ${product_id}`, quantity_received: String(index ? 2 : 6),
    ...(billed ? { quantity_billed: String(index ? 3 : 8) } : {}), unit_price: '10.00', remember_alias: true }));
  const updated = await h.invoke('updateDocument', { user, params: { id }, body: { lines: changes } });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
  const signed = await h.invoke('addSignature', { user, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
  return id;
}
function autoFixtures(h) {
  for (const row of h.state.orderItems) {
    row.order_date = '2026-10-19'; row.skip_receiving_required = 1;
  }
  h.state.orderItems.find(row => row.id === 51).skip_receiving_required = 0;
  h.state.orderItems.find(row => row.id === 52).allow_pending_carryover = true;
}

test('parity #1: server-wide auto receipt uses Bangkok cutoff, all branches, NULL system actor and repeat/race dedupe', async () => {
  const h = await createReceivingHarness({ testDate: date, serializeTransactions: true });
  autoFixtures(h);
  const run = now => h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now });
  assert.equal((await run(beforeCutoff)).updated, 0);
  const results = await Promise.all([run(afterCutoff), run(afterCutoff)]);
  assert.equal(results.reduce((n, row) => n + row.updated, 0), 2, 'receives branch 1 and 2 exactly once');
  assert.equal(h.state.orderItems.find(row => row.id === 50).received_quantity, 10);
  assert.equal(h.state.orderItems.find(row => row.id === 99).received_quantity, 6);
  assert.equal(h.state.orderItems.find(row => row.id === 50).received_by_user_id, null);
  assert.equal(h.state.orderItems.find(row => row.id === 51).received_quantity, null, 'required group untouched');
  assert.equal(h.state.orderItems.find(row => row.id === 52).received_quantity, null, 'carryover untouched');
  const transactions = h.state.inventoryTransactions.length;
  assert.equal((await run(afterCutoff)).updated, 0);
  assert.equal(h.state.inventoryTransactions.length, transactions);
});

test('parity #1: startup before cutoff catches prior elapsed day; auto receipt rolls back every item on failure', async () => {
  let fail = true, writes = 0;
  const h = await createReceivingHarness({ testDate: date, queryHook(q) {
    if (q.startsWith('INSERT INTO inventory_transactions') && ++writes === 2 && fail) throw Error('SYNTHETIC transaction failure');
  } });
  autoFixtures(h);
  for (const row of h.state.orderItems) row.order_date = '2026-10-18';
  const original = settlementRows(h.state);
  await assert.rejects(h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: beforeCutoff }), /SYNTHETIC/);
  assert.deepEqual(settlementRows(h.state), original);
  fail = false;
  assert.equal((await h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: beforeCutoff })).updated, 2);
  assert.equal((await h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: beforeCutoff })).updated, 0);
});

test('parity #1: optional (skip flag) groups stay in the queue for both scopes, flagged and never overdue; required groups unchanged', async () => {
  const h = await createReceivingHarness({ testDate: date, saveQueueFollowup: async () => assert.fail('optional group must not create followup') });
  for (const row of h.state.orderItems) { row.skip_receiving_required = 1; row.order_date = '2026-10-19'; }
  for (const query of [{ date }, { date, scope: 'branch' }]) {
    const optional = (await h.invoke('getExpected', { user, query })).body.data;
    assert.ok(optional.length > 0, `optional groups listed for ${JSON.stringify(query)}`);
    for (const group of optional) {
      assert.equal(group.receiving_optional, true);
      assert.notEqual(group.status, 'overdue', 'optional groups are never nagged as overdue');
      assert.ok(group.items.every(item => item.due_status !== 'overdue' && item.quantity_ordered === undefined && item.received_quantity === undefined), 'blind count kept');
    }
  }
  for (const row of h.state.orderItems) row.skip_receiving_required = 0;
  const required = await createReceivingHarness({ testDate: date });
  for (const row of required.state.orderItems) { row.skip_receiving_required = 0; row.order_date = '2026-10-19'; }
  for (const query of [{ date }, { date, scope: 'branch' }]) {
    const groups = (await required.invoke('getExpected', { user, query })).body.data;
    assert.ok(groups.length > 0);
    assert.ok(groups.every(group => group.receiving_optional === false && group.status === 'overdue'));
  }
  const row = { branch_id: 1, department_id: 10, product_group_id: 3, product_id: 7, order_item_id: 50,
    quantity_ordered: '10', received_quantity: '2', order_date: '2026-10-19', skip_receiving_required: '1', has_confirmed_receipt: 1 };
  const [queued] = groupQueue([row], date);
  assert.equal(queued.receiving_optional, true); assert.equal(queued.status, 'due_today'); assert.equal(queued.items[0].due_status, 'due_today');
  assert.equal(groupQueue([{ ...row, skip_receiving_required: 0 }], date)[0].status, 'overdue');
  assert.equal(groupQueue([{ ...row, skip_receiving_required: true }], '2026-10-19')[0].receiving_optional, true);
  assert.equal(groupQueue([{ ...row, skip_receiving_required: undefined }], date)[0].receiving_optional, false);
  const summarized = withReceiptSummary([], [row]);
  assert.equal(summarized.length, 1); assert.equal(summarized[0].receiving_optional, true);
  assert.deepEqual(summarized[0].receipt_summary, { short: 1, over: 0, received_items: 1 });
  assert.equal(withReceiptSummary([], [{ ...row, skip_receiving_required: 0 }])[0].receiving_optional, undefined);
  const merged = withReceiptSummary(groupQueue([row], date), [row]);
  assert.equal(merged.length, 1); assert.equal(merged[0].receipt_summary.short, 1);
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT f.id,f.branch_id')) {
      assert.match(sql, /skip_receiving_required/); return [[{ id: 1, token: 'SYNTHETIC', token_hash: 'SYNTHETIC', user_id: 7 }]];
    }
    if (sql.startsWith('SELECT f.id FROM')) {
      assert.match(sql, /skip_receiving_required/); return [[]]; // Flag changed after discovery.
    }
    return [{ affectedRows: 1 }];
  } };
  await createPushDispatcher({ db, fcm: { configured: () => true, send: () => assert.fail('skip group cannot push') } }).tick();
  assert.ok(calls.some(sql => sql.startsWith('SELECT f.id FROM')));
});

test('auto-receive never overwrites a confirmed short receipt (ordered 10, received 6) and a second short line', async () => {
  const autoSql = [];
  const h = await createReceivingHarness({ testDate: date, queryHook(q) { if (q.startsWith('SELECT oi.id AS order_item_id, oi.quantity, o.order_date')) autoSql.push(q); } });
  for (const row of h.state.orderItems) { row.skip_receiving_required = 1; row.order_date = '2026-10-19'; }
  const id = await ready(h, { linked: true, products: [7, 8], uuid: 'short-vs-auto' });
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  const first = h.state.orderItems.find(row => row.id === 50);
  assert.equal(first.received_quantity, 6);
  await h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: afterCutoff });
  assert.equal(first.received_quantity, 6, 'short receipt survives the auto job');
  assert.equal(h.state.orderItems.find(row => row.id === 51).received_quantity, 2, 'second short line survives too');
  // Even if a legacy flag left is_received false, a confirmed document line protects the order item.
  first.is_received = false;
  await h.orderModel.autoReceivePendingItemsForNextDay({ date, scope: 'all', now: afterCutoff });
  assert.equal(first.received_quantity, 6);
  assert.ok(autoSql.length >= 2 && autoSql.every(q => /receiving_document_lines rdl_done[\s\S]*rd_done\.status = 'confirmed'/.test(q)), 'SQL excludes confirmed lines');
  // Documented limit: an untouched order (no confirmed line) is still settled automatically.
  assert.equal(h.state.orderItems.find(row => row.id === 99).received_quantity, 6);
});

test('parity #2: frozen order cumulative and bill base-unit comparisons include zero receipts and no-bill orders', () => {
  const lines = [{ order_item_id: 50, product_name: 'หมู', quantity_received: '0', quantity_billed: '2', unit_multiplier: '3' },
    { order_item_id: 51, product_name: 'ผัก', quantity_received: '0.2', quantity_billed: null }];
  const scoped = new Map([[50, { quantity: '10', received_quantity: '2' }], [51, { quantity: '0.3', received_quantity: '0.1' }]]);
  const payload = documentNotificationPayload({ id: 1 }, lines, scoped);
  assert.equal(payload.sections[0].items[0].received_quantity, '2');
  assert.equal(payload.sections[0].items[1].received_quantity, '0.3');
  assert.equal(payload.sections[1].items[0].quantity, '6');
  const text = receivingNotificationText(payload, { branchName: 'สาขา', departmentName: 'ครัว' }, afterCutoff);
  assert.match(text, /ใบสั่ง \(ยอดรับสะสม\)/); assert.match(text, /บิล \(ใบรับนี้\)/);
  assert.match(text, /หมู \(ขาด\) -8/); assert.match(text, /หมู \(ขาด\) -6/);
  assert.doesNotMatch(text, /ผัก \(ขาด\)/);
  const noBill = documentNotificationPayload({ id: 2 }, [lines[1]], scoped);
  assert.equal(noBill.sections.length, 1);
  assert.match(receivingNotificationText(noBill, { branchName: 'สาขา', departmentName: 'ครัว' }, afterCutoff), /ครบทุกรายการ/);
});

test('parity #2: after-commit notification is nonblocking, deduped on repeat/race/failed provider; rollback queues nothing', async () => {
  let release, calls = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const h = await createReceivingHarness({ testDate: date, serializeTransactions: true, sendReceivingNotification: async ({ payload }) => {
    assert.equal(h.state.documents[0].status, 'confirmed');
    assert.equal(h.state.notifications[0].state, 'claimed');
    assert.equal(payload.sections.length, 2); calls++;
    await blocked; throw Error('SYNTHETIC ambiguous provider timeout');
  } });
  const id = await ready(h, { linked: true, products: [7, 8], billed: true });
  const result = await h.invoke('confirmDocument', { user, params: { id } });
  assert.equal(result.statusCode, 200);
  await turn(); assert.equal(calls, 1, 'confirm returned while provider still blocked');
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 409);
  await Promise.all([h.notification.dispatchReceivingNotification(h.pool, id), h.notification.dispatchPendingReceivingNotifications(h.pool)]);
  assert.equal(calls, 1); release(); await turn();
  await h.notification.dispatchPendingReceivingNotifications(h.pool);
  assert.equal(calls, 1, 'provider timeout never duplicates the attempt');

  const failed = await createReceivingHarness({ testDate: date, sendReceivingNotification: () => assert.fail('no send on rollback'),
    queryHook(q) { if (q.startsWith('INSERT INTO receiving_document_notifications')) throw Error('SYNTHETIC outbox failure'); } });
  const badId = await ready(failed, { linked: true, products: [7, 8] });
  const before = settlementRows(failed.state);
  assert.equal((await failed.invoke('confirmDocument', { user, params: { id: badId } })).statusCode, 500);
  assert.deepEqual(settlementRows(failed.state), before);
  assert.equal(failed.state.notifications.length, 0);
});

test('parity #2: pending notification survives interrupted dispatch and cron replicas claim once', async () => {
  let sendCount = 0;
  const h = await createReceivingHarness({ testDate: date, queryHook(q) {
    if (q.startsWith('UPDATE receiving_document_notifications SET state')) throw Error('SYNTHETIC disconnected worker');
  } });
  const id = await ready(h);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  await turn(); assert.equal(h.state.notifications[0].state, 'pending');
  const state = h.state.notifications;
  const db = { async query(sql, args) {
    if (sql.startsWith('UPDATE')) { const row = state.find(r => r.document_id === Number(args[0]) && r.state === 'pending');
      if(row) row.state='claimed'; return [{ affectedRows: row ? 1 : 0 }]; }
    return [sql.startsWith('SELECT payload_json') ? state.filter(row=>row.document_id===Number(args[0])) : state.filter(row=>row.state==='pending')];
  } };
  await Promise.all([1, 2].map(() => h.notification.dispatchPendingReceivingNotifications(db, async () => { sendCount++; })));
  assert.equal(sendCount, 1);
});

test('parity #3: unlinked receipt creates report order/items/mirrors, real inventory and independent repeat-safe void', async () => {
  const h = await createReceivingHarness({ testDate: date, serializeTransactions: true });
  const id = await ready(h);
  const results = await Promise.all([1, 2].map(() => h.invoke('confirmDocument', { user, params: { id } })));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(h.state.orders.length, 1); assert.equal(h.state.orders[0].order_number, `RC-${id}`);
  assert.equal(h.state.mirrors.length, 2);
  const lines = h.state.lines.filter(line => line.document_id === Number(id));
  assert.ok(lines.every(line => line.order_item_id));
  for (const line of lines) {
    const oi = h.state.orderItems.find(oi => oi.id === line.order_item_id);
    assert.equal(oi.received_quantity, Number(line.quantity_received));
    assert.equal(oi.quantity, Number(line.quantity_received));
    assert.equal(oi.actual_price, 10);
    assert.equal(oi.is_received, true);
    assert.equal(h.state.mirrors.find(m => m.receiving_order_item_id === oi.id).department_id, 10);
  }
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
  assert.equal(h.state.inventoryBalances.has('9:10'), false, 'non-countable creates reporting rows without stock');
  assert.ok(h.state.inventoryTransactions.every(tx => tx.reference_type === 'order_receiving'));
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'SYNTHETIC void' } })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
  assert.ok(h.state.mirrors.every(m => !m.is_active));
  assert.equal(h.state.orders[0].status, 'cancelled');
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'again' } })).statusCode, 409);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
});

test('parity #3: unlinked internal receipt and void use real legacy transfer in/out', async () => {
  const h = await createReceivingHarness({ testDate: date });
  const id = await ready(h, { group: 4, products: [10] });
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('10:30').quantity, 14);
  assert.equal(h.state.inventoryBalances.get('10:10').quantity, 8);
  assert.deepEqual(h.state.inventoryTransactions.map(tx => tx.transaction_type).sort(), ['transfer_in', 'transfer_out']);
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'SYNTHETIC reverse transfer' } })).statusCode, 200);
  assert.equal(h.state.inventoryBalances.get('10:30').quantity, 20);
  assert.equal(h.state.inventoryBalances.get('10:10').quantity, 2);
});

for (const step of ['mirror', 'inventory', 'alias', 'outbox']) test(`parity #3: failure at ${step} rolls back order/item/link/mirror/inventory/alias/outbox then retry creates one order`, async () => {
  let fail = true;
  const h = await createReceivingHarness({ testDate: date, queryHook(q) {
    const matches = step === 'mirror' ? q.startsWith('INSERT INTO purchase_walk_manual_items')
      : step === 'inventory' ? q.startsWith('INSERT INTO inventory_transactions')
        : step === 'alias' ? q.includes('INTO supplier_product_aliases') : q.startsWith('INSERT INTO receiving_document_notifications');
    if (fail && matches) throw Error(`SYNTHETIC ${step} failure`);
  } });
  const id = await ready(h, { uuid: `parity-rollback-${step}` });
  const before = settlementRows(h.state);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 500);
  assert.deepEqual(settlementRows(h.state), before);
  assert.equal(h.state.orders.length, 0); assert.equal(h.state.mirrors.length, 0); assert.equal(h.state.notifications.length, 0);
  fail = false;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  assert.equal(h.state.orders.length, 1); assert.equal(h.state.mirrors.length, 2);
});

test('parity #2: shared service routes LINE/Discord via mocked transports only and hides provider errors', async () => {
  const context = vm.createContext({ console: { warn() {} }, Date });
  const actual = await import('../src/services/receiving-notify-policy.js');
  const mod = new vm.SourceTextModule(await readFile(new URL('../src/services/receiving-notify.js', import.meta.url), 'utf8'), { context });
  await mod.link(specifier => {
    const forbidden = () => assert.fail('real integration must never be called');
    const exports = specifier.endsWith('receiving-notify-policy.js') ? actual : specifier.endsWith('order-notification-options.js') ? { getNotificationOptions: forbidden }
      : specifier.endsWith('/line.js') ? { sendLineOrderNotification: forbidden }
        : specifier.endsWith('/discord.js') ? { sendDiscordTextNotification: forbidden } : { getBranchDepartmentInfo: forbidden };
    return new vm.SyntheticModule(Object.keys(exports), function () { for(const [key,value] of Object.entries(exports)) this.setExport(key,value); }, { context });
  });
  await mod.evaluate();
  const calls = [];
  for (const provider of ['line', 'discord']) {
    await mod.namespace.sendReceivingSavedNotification({ items: [{ product_name: 'หมู', quantity: 10, received_quantity: 8 }],
      location: { branchName: 'สาขา', departmentName: 'ครัว' } }, {
      options: async () => ({ provider, receivingWebhookUrl: 'SYNTHETIC', groups: [] }),
      line: async (_, options) => { calls.push(options.title); }, discord: async ({ message }) => { calls.push(message); }
    });
  }
  assert.equal(calls.length, 2); assert.ok(calls.every(text => text.includes('หมู (ขาด) -2')));
});

test('parity #3: admin no-order receipt reports in target department, never in admin department; missing owner rejects atomically', async () => {
  const h = await createReceivingHarness({ testDate: date });
  const admin = { ...user, role: 'admin' };
  const created = await h.invoke('createDocument', { user: admin, body: { client_uuid: 'parity-admin-target',
    delivery_date: date, kind: 'manual_receipt', supplier_name_text: 'SYNTHETIC vic', branch_id: 2, department_id: 20 } });
  assert.equal(created.statusCode, 201);
  const id = String(created.body.data.id);
  assert.equal((await h.invoke('updateDocument', { user: admin, params: { id }, body: { lines: [{
    product_id: 7, bill_text: 'SYNTHETIC', quantity_received: '1', unit_price: '10', line_no: 1
  }] } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user: admin, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  h.state.users = h.state.users.filter(owner => owner.department_id !== 20);
  assert.equal((await h.invoke('confirmDocument', { user: admin, params: { id } })).statusCode, 422);
  assert.equal(h.state.orders.length, 0);
  h.state.users.push({ id: 22, department_id: 20, is_active: true });
  assert.equal((await h.invoke('confirmDocument', { user: admin, params: { id } })).statusCode, 200);
  assert.equal(h.state.orders[0].user_id, 22);
  assert.equal(h.state.orderItems.at(-1).department_id, 20);
  assert.equal(h.state.mirrors[0].department_id, 20);
  assert.equal(h.state.inventoryBalances.get('7:20').quantity, 1);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
});

test('parity #3: void failure rolls back generated order/mirror/stock and later receipts survive originating void', async () => {
  let fail = false;
  const h = await createReceivingHarness({ testDate: date, queryHook(q) {
    if (fail && q.startsWith('UPDATE purchase_walk_manual_items m JOIN')) throw Error('SYNTHETIC void failure');
  } });
  const id = await ready(h, { products: [7] });
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  const item = h.state.lines[0].order_item_id;
  const second = await h.invoke('createDocument', { user, body: { client_uuid: 'parity-successor',
    delivery_date: date, kind: 'bill', order_item_ids: [item] } });
  assert.equal(second.statusCode, 201);
  const nextId = String(second.body.data.id);
  assert.equal((await h.invoke('updateDocument', { user, params: { id: nextId }, body: { lines: [{
    id: second.body.data.lines[0].id, quantity_received: '2', unit_price: '12', product_id: 7, order_item_id: item
  }] } })).statusCode, 200);
  assert.equal((await h.invoke('addSignature', { user, params: { id: nextId }, body: { role: 'receiver', image_data_url: makePngDataUrl() } })).statusCode, 200);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id: nextId } })).statusCode, 200);
  await turn();
  fail = true;
  const before = settlementRows(h.state), mirrors = structuredClone(h.state.mirrors);
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'SYNTHETIC' } })).statusCode, 500);
  assert.deepEqual(settlementRows(h.state), before); assert.deepEqual(h.state.mirrors, mirrors);
  fail = false;
  assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'SYNTHETIC' } })).statusCode, 200);
  assert.equal(h.state.orderItems.find(oi=>oi.id===item).received_quantity, 2);
  assert.equal(h.state.orders[0].status, 'confirmed'); assert.equal(h.state.mirrors[0].is_active, true);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 7);
  assert.equal((await h.invoke('voidDocument', { user, params: { id: nextId }, body: { reason: 'SYNTHETIC' } })).statusCode, 200);
  assert.equal(h.state.orders[0].status, 'cancelled'); assert.equal(h.state.mirrors[0].is_active, false);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
});

test('parity #1: scheduled job starts without opening a menu, skips overlapping ticks and drains notifications despite auto failure', async () => {
  let intervalTick, starts = 0, drains = 0, unblock;
  const block = new Promise(resolve => { unblock=resolve; });
  const context = vm.createContext({ Date, console: { warn() {} },
    setInterval(fn, ms) { assert.equal(ms, 60000); intervalTick=fn; return { unref() {} }; }, clearInterval() {} });
  const mod = new vm.SourceTextModule(await readFile(new URL('../src/cron/receiving-auto-job.js', import.meta.url), 'utf8'), { context });
  await mod.link(specifier => {
    const exports = specifier.endsWith('database.js') ? { default: {} }
      : specifier.endsWith('order.model.js') ? { autoReceivePendingItemsForNextDay: async args => {
        starts++; assert.equal(args.scope, 'all'); assert.ok(args.now instanceof Date); await block; throw Error('SYNTHETIC');
      } } : specifier.endsWith('bangkok-date.js') ? { toBangkokDateKey: () => date }
        : { ensureReceivingNotificationTable: async () => {}, dispatchPendingReceivingNotifications: async () => { drains++; } };
    return new vm.SyntheticModule(Object.keys(exports), function () { for(const [key,value] of Object.entries(exports))this.setExport(key,value); }, {context});
  });
  await mod.evaluate(); const stop=mod.namespace.initReceivingAutoJob();
  assert.equal(starts,1); await intervalTick(); assert.equal(starts,1);
  unblock(); await turn(); assert.equal(drains,1);
  await intervalTick(); assert.equal(starts,2); assert.equal(drains,2); stop();
});

test('parity #3: missing product group rejects whole receipt instead of silently omitting purchase-walk mirror', async () => {
  const h = await createReceivingHarness({ testDate: date });
  const id = await ready(h, { products: [7] });
  h.state.documents[0].product_group_id=null;
  h.state.products.find(product=>product.id===7).product_group_id=null;
  const before=settlementRows(h.state);
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode,422);
  assert.deepEqual(settlementRows(h.state),before);
  assert.equal(h.state.orders.length,0);assert.equal(h.state.mirrors.length,0);
});

test('parity #1: legacy receiving GET retains its response and cannot trigger auto receiving', async () => {
  const context=vm.createContext({console:{log(){},error(){}},Date});
  const source=await readFile(new URL('../src/controllers/orders.controller.js',import.meta.url),'utf8');
  const mod=new vm.SourceTextModule(source,{context});
  let reads=0;
  const row={order_item_id:50,product_name:'SYNTHETIC',received_quantity:null};
  await mod.link(specifier=>{
    const forbidden=()=>assert.fail('GET must not invoke a writer or provider');
    const exports=specifier.endsWith('/order.model.js')?{getReceivingItemsByUser:async args=>{
      assert.equal(args.userId,12);assert.equal(args.date,date);reads++;return [row];
    },autoReceivePendingItemsForNextDay:forbidden}
    :specifier.endsWith('/order-notification-options.js')?{getNotificationOptions:forbidden}
    :specifier.endsWith('/receiving-notify.js')?{sendReceivingSavedNotification:forbidden}
    :specifier.endsWith('/line.js')?{sendLineOrderNotification:forbidden}
    :specifier.endsWith('/discord.js')?{sendDiscordOrderNotification:forbidden}
    :specifier.endsWith('/direct-order.js')?{sendDirectOrderAfterCutoff:forbidden}
    :specifier.endsWith('/product-group.js')?{withProductGroupAliases:value=>value}
    :specifier.endsWith('/other-suppliers-notification.js')?{isDiscordWebhookUrl:forbidden,parseGroupCodes:forbidden,pickItemsByGroupIds:forbidden}:{};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context});
  });
  await mod.evaluate();let response;
  await mod.namespace.getReceivingItems({user,query:{date}}, {json(body){response=body;}}, error=>{throw error;});
  assert.equal(reads,1);assert.equal(response.success,true);assert.equal(response.count,1);assert.equal(response.data[0],row);
});

test('parity #3: existing accounting-export reads generated mirror once under legacy purchase/price gates and excludes voided receipt', async () => {
  const h=await createReceivingHarness({testDate:date});const id=await ready(h,{products:[7]});
  assert.equal((await h.invoke('confirmDocument',{user,params:{id}})).statusCode,200);
  const context=vm.createContext({Date});
  const mod=new vm.SourceTextModule(await readFile(new URL('../src/models/accounting-export.model.js',import.meta.url),'utf8'),{context});
  const db={async query(sql){
    if(sql.includes('FROM order_items oi')) {
      assert.match(sql,/COALESCE\(oi.is_purchased, false\) = true/);
      return [[]]; // Receiving does not silently mark an order as purchased.
    }
    assert.match(sql,/FROM purchase_walk_manual_items mi/);
    assert.match(sql,/mi.is_active = true/);assert.match(sql,/COALESCE\(mi.is_purchased, false\) = true/);
    assert.match(sql,/mi.actual_price > 0/);
    return [h.state.mirrors.filter(m=>m.is_active&&m.is_purchased&&m.actual_price>0).map(m=>({
      external_id:`manual-item:${m.id}`,external_ref:`market-order:purchase-walk:manual-item:${m.id}`,
      source:'manual_item',purchase_date:m.order_date,order_item_id:m.receiving_order_item_id,manual_item_id:m.id,
      product_id:m.base_product_id,product_name:m.product_name,branch_id:m.branch_id,department_id:m.department_id,
      product_group_id:m.product_group_id,actual_quantity:m.actual_quantity,actual_price:m.actual_price,
      received_quantity:h.state.orderItems.find(oi=>oi.id===m.receiving_order_item_id).received_quantity
    }))];
  }};
  await mod.link(specifier=>{
    const exports=specifier.endsWith('database.js')?{default:db}:specifier.endsWith('/order.model.js')?
      {ensureOrderItemSourceGroupColumn:async()=>{},ensureOrderReceivingColumns:async()=>{}}:{ensurePurchaseWalkManualTable:async()=>{}};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});
  });await mod.evaluate();
  const read=()=>mod.namespace.getPurchaseWalkForAccountingExport({from:date,to:date,groupAsDocuments:false});
  assert.equal((await read()).summary.line_count,0,'same legacy gate: purchase approval and known price required');
  Object.assign(h.state.mirrors[0],{is_purchased:true,actual_price:10});
  const result=await read();assert.equal(result.summary.line_count,1);assert.equal(result.summary.total_amount,60);
  assert.equal(result.lines[0].order_item_id,h.state.lines[0].order_item_id);
  assert.equal(result.lines[0].received_quantity,6);
  assert.equal((await h.invoke('voidDocument',{user,params:{id},body:{reason:'SYNTHETIC'}})).statusCode,200);
  assert.equal((await read()).summary.line_count,0);
});
