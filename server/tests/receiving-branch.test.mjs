import test from 'node:test';
import vm from 'node:vm';
import { read } from './helpers/receiving-fake-db.mjs';
import assert from 'node:assert/strict';
import { allocateBranchQuantity, canReceiveBranch, initialBranchAmounts } from '../src/models/receiving-branch-policy.js';
import { createReceivingHarness, makePngDataUrl, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
const user = { id: 12, name: 'หัวหน้า', role: 'user', branch_id: 1, department_id: 10 };
const store = { ...user, id: 13, department_id: 30 };
const outsider = { ...user, id: 14, branch_id: 2, department_id: 20 };
async function setup(options = {}) {
  const h = await createReceivingHarness({ testDate: '2026-10-18', ...options });
  const first = h.state.orderItems.find(row => row.id === 50);
  Object.assign(first, { quantity: 6, order_date: h.today });
  h.state.orderItems.push({ ...structuredClone(first), id: 60, order_id: 3, quantity: 4,
    department_id: 30, department_name: 'สโตร์', received_quantity: null });
  h.state.orderItems.forEach(row => { row.order_date = h.today; });
  const create = (extra = {}, actor = user) => h.invoke('createDocument', { user: actor, body: {
    client_uuid: 'branch-1', delivery_date: h.today, scope: 'branch', product_group_id: 3,
    order_item_ids: [50, 60], ...extra } });
  const result = await create();
  assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  const id = result.body.data.id;
  const update = quantity => h.invoke('updateDocument', { user: store, params: { id }, body: {
    lines: [{ id: result.body.data.lines[0].id, quantity_received: quantity, unit_price: '100', amount: null }] } });
  const sign = () => h.invoke('addSignature', { user: store, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  return { h, create, id, result, update, sign };
}

test('branch allocator: legacy ordered proportions, equal split, deterministic exact hundredths', () => {
  assert.equal(canReceiveBranch(user), true); assert.equal(canReceiveBranch({}), false);
  for (const [total, expected] of [['5', ['3.00', '2.00']], ['15', ['9.00', '6.00']], ['0.30', ['0.18', '0.12']]]) {
    assert.deepEqual(allocateBranchQuantity(total, [{ order_item_id: 50, quantity: 6 }, { order_item_id: 60, quantity: 4 }]), expected);
  }
  assert.deepEqual(allocateBranchQuantity('0.01', [{ id: 2, quantity: 1 }, { id: 1, quantity: 1 }]), ['0.00', '0.01']);
  assert.deepEqual(allocateBranchQuantity('0.03', [{ id: 1, quantity: 0 }, { id: 2, quantity: 0 }]), ['0.02', '0.01']);
  assert.throws(() => allocateBranchQuantity('-1', [{ id: 1, quantity: 1 }]));
});

test('branch expected: one shop/product combines every department, keeps breakdown; department scope isolated', async () => {
  const { h } = await setup();
  const res = await h.invoke('getExpected', { user, query: { date: h.today, scope: 'branch' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const groups = res.body.data.filter(group => group.supplier_key === 'pg:3');
  assert.equal(groups.length, 1);
  const product = groups[0].items.find(item => item.product_id === 7);
  assert.equal(product.quantity_ordered, '10.00'); assert.deepEqual([...product.order_item_ids], [50,60]);
  assert.deepEqual(product.departments.map(row => row.department_id), [10,30]);
  const mine = await h.invoke('getExpected', { user, query: { date: h.today } });
  assert.equal(mine.body.data.some(group => group.department_id === 30), false);
  assert.equal((await h.invoke('getExpected', { user, query: { scope: 'branch', branch_id: 2 } })).statusCode, 403);
  assert.equal((await h.invoke('getExpected', { user, query: { scope: 'invalid' } })).statusCode, 422);
});

for (const [label, qty, expected] of [['short', '5', [3,2]], ['exact', '10', [6,4]], ['over', '15', [9,6]], ['tiny', '0.01', [0.01,0]]]) {
  test(`branch ${label}: aggregate draft → split → confirm per-department inventory → void exact deltas`, async () => {
    const { h, id, result, update, sign } = await setup();
    assert.equal(result.body.data.scope, 'branch'); assert.equal(result.body.data.lines.length, 1);
    assert.equal(result.body.data.lines[0].quantity_received, '10'); assert.equal(h.state.lines.length, 2);
    const patched = await update(qty); assert.equal(patched.statusCode, 200, JSON.stringify(patched.body));
    assert.deepEqual(patched.body.data.lines[0].departments.map(part => Number(part.quantity_received)), expected);
    assert.equal((await sign()).statusCode, 200);
    const confirmed = await h.invoke('confirmDocument', { user: store, params: { id } });
    assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
    assert.equal(Number(h.state.orderItems.find(row => row.id === 50).received_quantity), expected[0]);
    assert.equal(Number(h.state.orderItems.find(row => row.id === 60).received_quantity), expected[1]);
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5 + expected[0]);
    assert.equal(h.state.inventoryBalances.get('7:30')?.quantity || 0, expected[1]);
    assert.equal(h.state.aliasEvents.length, 1, 'aggregate receipt learns alias only once');
    assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 409);
    const voided = await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'ผิดบิล' } });
    assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
    assert.equal(h.state.inventoryBalances.get('7:10').quantity, 5);
    assert.equal(h.state.inventoryBalances.get('7:30')?.quantity || 0, 0);
    assert.equal(Number(h.state.orderItems.find(row => row.id === 50).received_quantity), 0);
    assert.equal(Number(h.state.orderItems.find(row => row.id === 60).received_quantity), 0);
    assert.equal((await h.invoke('voidDocument', { user, params: { id }, body: { reason: 'ซ้ำ' } })).statusCode, 409);
  });
}

test('branch partial history: default remaining, receipt adds to existing; later department bill survives branch void', async () => {
  const { h, id, update, sign } = await setup();
  h.state.orderItems.find(row => row.id === 50).received_quantity = 2;
  h.state.inventoryBalances.get('7:10').quantity = 7;
  await update('5'); await sign();
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  const later = await h.invoke('createDocument', { user, body: { client_uuid: 'later-department', delivery_date: h.today, order_item_ids: [50] } });
  const laterId = later.body.data.id;
  await h.invoke('updateDocument', { user, params: { id: laterId }, body: { lines: [{ id: later.body.data.lines[0].id, quantity_received: '1', unit_price: '200' }] } });
  await h.invoke('addSignature', { user, params: { id: laterId }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal((await h.invoke('confirmDocument', { user, params: { id: laterId } })).statusCode, 200);
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'ยกเลิกใบแรก' } })).statusCode, 200);
  assert.equal(h.state.orderItems.find(row => row.id === 50).received_quantity, 3);
  assert.equal(h.state.orderItems.find(row => row.id === 50).actual_price, 200);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 8);
  assert.equal(h.state.inventoryBalances.get('7:30').quantity, 0);
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id: laterId }, body: { reason: 'ยกเลิกใบหลัง' } })).statusCode, 200);
  assert.equal(h.state.orderItems.find(row => row.id === 50).received_quantity, 2);
});

test('branch access: same branch departments share all document operations; foreign branch denied including binary/signatures/OCR', async () => {
  const { h, id, create } = await setup();
  assert.equal((await create({}, store)).statusCode, 200);
  assert.equal((await h.invoke('getDocumentById', { user: store, params: { id } })).statusCode, 200);
  assert.equal((await h.invoke('listDocuments', { user: store, query: { scope: 'branch' } })).body.data.length, 1);
  assert.equal((await h.invoke('listDocuments', { user: store })).body.data.length, 0);
  const image = await h.invoke('uploadImage', { user: store, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  assert.equal(image.statusCode, 201);
  assert.equal((await h.invoke('getImageBinary', { user: store, params: { id, imageId: image.body.data.image_id } })).statusCode, 200);
  for (const handler of ['getDocumentById','updateDocument','confirmDocument','runOcr','getImageBinary','getSignatureBinary','voidDocument','uploadImage','addSignature']) {
    const res = await h.invoke(handler, { user: outsider, params: { id, imageId: image.body.data.image_id, role: 'receiver' },
      body: { reason: 'test', role: 'receiver', page_no: 2, image_data_url: handler === 'uploadImage' ? makeJpegDataUrl() : makePngDataUrl() } });
    assert.equal(res.statusCode, 403, `${handler}: ${JSON.stringify(res.body)}`);
  }
  assert.equal((await h.invoke('getDocumentById', { user: store, params: { id: 999 } })).statusCode, 404);
  assert.equal((await create({ client_uuid: 'bad-cross', order_item_ids: [50, 99] })).statusCode, 403);
  assert.equal((await create({ client_uuid: 'bad-empty', order_item_ids: [] })).statusCode, 422);
  assert.equal((await create({ client_uuid: 'branch-1', scope: 'department' })).statusCode, 409);
});

test('branch update refuses relinking, duplicate/foreign anchors, excess/negative quantities and multi-shop create', async () => {
  const { h, id, result, create, update } = await setup();
  const anchor = result.body.data.lines[0];
  for (const body of [ { lines: [{ id: anchor.id, product_id: 8 }] }, { lines: [{ id: anchor.id, order_item_id: 51 }] },
    { lines: [{ id: 999, quantity_received: '1' }] }, { lines: [{ id: anchor.id }, { id: anchor.id }] },
    { lines: [{ product_id: 7, quantity_received: '1' }] }, { deleted_line_ids: [999] }, { lines: [null] }, { lines: {} }, { deleted_line_ids: '1' } ]) {
    assert.equal((await h.invoke('updateDocument', { user, params: { id }, body })).statusCode, 422);
  }
  assert.equal((await update('-1')).statusCode, 422);
  assert.equal((await update('100000000')).statusCode, 422);
  assert.equal((await create({ client_uuid: 'two-shops', order_item_ids: [50, 52] })).statusCode, 422);
});

test('branch confirm/void rollback includes both departments, snapshots, inventory and alias', async () => {
  const { h, id, update, sign } = await setup(); await update('5'); await sign();
  const snapshot = () => structuredClone({ documents: h.state.documents, lines: h.state.lines, orderItems: h.state.orderItems,
    balances: [...h.state.inventoryBalances], tx: h.state.inventoryTransactions, aliases: h.state.aliases, events: h.state.aliasEvents });
  const before = snapshot(); h.state.failOnConfirmStep = true;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 500);
  assert.deepEqual(snapshot(), before); h.state.failOnConfirmStep = false;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  const confirmed = snapshot(); h.state.failOnVoidStep = true;
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'test' } })).statusCode, 500);
  assert.deepEqual(snapshot(), confirmed);
});


test('branch idempotency: concurrent same UUID creates one receipt across departments', async () => {
  const { h, create } = await setup();
  h.state.delayBeforeDocInsertMs = 10;
  const results = await Promise.all([create({ client_uuid: 'concurrent-branch' }, user), create({ client_uuid: 'concurrent-branch' }, store)]);
  assert.deepEqual(results.map(res => res.statusCode).sort(), [200,201]);
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  assert.equal(h.state.documents.filter(doc => doc.client_uuid === 'concurrent-branch').length, 1);
});

test('branch admin chooses other branch without department; invalid department and foreign order rejected', async () => {
  const { h, create } = await setup();
  const admin = { ...user, role: 'admin' };
  const res = await create({ client_uuid: 'branch-two', branch_id: 2, order_item_ids: [99] }, admin);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.branch_id, 2); assert.equal(res.body.data.department_id, 20);
  assert.equal(res.body.data.lines[0].departments[0].department_id, 20);
  assert.equal((await create({ client_uuid: 'bad-dept', branch_id: 2, department_id: 10, order_item_ids: [99] }, admin)).statusCode, 422);
  assert.equal((await create({ client_uuid: 'foreign-order', branch_id: 2, order_item_ids: [50] }, admin)).statusCode, 403);
});

test('branch saved department ownership must remain valid at confirm and void', async () => {
  const { h, id, sign } = await setup(); await sign();
  const row = h.state.orderItems.find(item => item.id === 60); row.department_id = 10;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 422);
  h.state.orderItems.find(item => item.id === 60).department_id = 30;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  h.state.orderItems.find(item => item.id === 60).department_id = 10;
  const before = structuredClone([...h.state.inventoryBalances]);
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'test' } })).statusCode, 409);
  assert.deepEqual([...h.state.inventoryBalances], before);
});


test('branch expected includes completed sibling allocation weights without hiding pending department', async () => {
  const { h, create } = await setup();
  h.state.orderItems.find(row => row.id === 50).received_quantity = 10;
  const expected = await h.invoke('getExpected', { user, query: { date: h.today, scope: 'branch' } });
  const product = expected.body.data.find(group => group.supplier_key === 'pg:3').items.find(row => row.product_id === 7);
  assert.deepEqual([...product.order_item_ids], [50,60]);
  assert.equal(product.quantity_ordered, '10.00'); assert.equal(product.received_quantity, '10.00');
  assert.equal(product.remaining_quantity, '4.00');
  const res = await create({ client_uuid: 'remaining-default' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.lines[0].departments.map(part => Number(part.quantity_received)), [0,4]);
  const patched = await h.invoke('updateDocument', { user, params: { id: res.body.data.id }, body: {
    lines: [{ id: res.body.data.lines[0].id, quantity_received: '5' }] } });
  assert.deepEqual(patched.body.data.lines[0].departments.map(part => Number(part.quantity_received)), [3,2]);
});


test('branch schema upgrade is additive and idempotent, with branch/scope/date index', async () => {
  const fields = new Set(), indexes = new Set(), statements = [];
  const db = { query: async (sql, params = []) => {
    statements.push(sql);
    if (sql.startsWith('SHOW COLUMNS')) {
      if (params[0] === 'match_source') return [[{ Type: "enum('order','ai')" }]];
      if (fields.has(params[0])) return [[{ Type: 'decimal(12,6)' }]];
      return [[]];
    }
    if (sql.startsWith('SHOW INDEX')) return [indexes.has(params[0]) ? [{ Key_name: params[0] }] : []];
    const add = sql.match(/ADD COLUMN (\w+)/); if (add) fields.add(add[1]);
    const index = sql.match(/ADD INDEX (\w+)/); if (index) indexes.add(index[1]);
    return [{ affectedRows: 1 }];
  } };
  const context = vm.createContext({});
  const schema = new vm.SourceTextModule(await read('../src/models/receiving-documents-schema.js'), { context });
  await schema.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', db); }, { context }));
  await schema.evaluate();
  await schema.namespace.ensureReceivingDocumentsTables(db, { force: true });
  const first = statements.filter(sql => sql.startsWith('ALTER')).length;
  await schema.namespace.ensureReceivingDocumentsTables(db, { force: true });
  assert.equal(statements.filter(sql => sql.startsWith('ALTER')).length, first);
  for (const field of ['receiving_scope','branch_weight','branch_department_id','branch_department_name']) assert.ok(fields.has(field));
  assert.ok(indexes.has('idx_receiving_documents_branch_scope_date'));
  assert.equal(statements.some(sql => /ALTER TABLE (order_items|inventory_)/.test(sql)), false);
});

test('branch monetary split rounds aggregate once and assigns no money to zero-quantity department', async () => {
  const { h, id, result } = await setup();
  for (const [quantity, price, amount] of [['0.02', '0.5', '0.01'], ['0.01', '0.5', '0.01'], ['0.30', '0.1', '0.03']]) {
    const response = await h.invoke('updateDocument', { user, params: { id }, body: {
      lines: [{ id: result.body.data.lines[0].id, quantity_received: quantity, unit_price: price, amount: null }] } });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(Number(response.body.data.lines[0].amount), Number(amount));
    assert.equal(h.state.lines.reduce((total, line) => total + Math.round(Number(line.amount) * 100), 0), Math.round(Number(amount) * 100));
    for (const line of h.state.lines) if (Number(line.quantity_received) === 0) assert.equal(Number(line.amount), 0);
  }
});

test('branch draft monetary totals round once even before the first edit', () => {
  const amounts = initialBranchAmounts([
    { order_item_id: 50, product_id: 7, quantity_ordered: '0.01', received_quantity: 0, requested_price: '0.5' },
    { order_item_id: 60, product_id: 7, quantity_ordered: '0.01', received_quantity: 0, requested_price: '0.5' },
  ]);
  assert.deepEqual([...amounts], [[50, '0.01'], [60, '0.00']]);
});

test('branch same-branch users still cannot access foreign department-only documents', async () => {
  const { h } = await setup();
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'private-department', delivery_date: h.today, order_item_ids: [50] } });
  assert.equal(created.statusCode, 201);
  assert.equal((await h.invoke('getDocumentById', { user: store, params: { id: created.body.data.id } })).statusCode, 403);
});

test('branch final-step failure rolls back both departments and alias after all their changes', async () => {
  let failStatus;
  let reached = 0;
  const { h, id, update, sign } = await setup({ queryHook(sql, params, state) {
    if (!failStatus || !sql.startsWith(`UPDATE receiving_documents SET status = '${failStatus}'`)) return;
    reached++;
    if (failStatus === 'confirmed') {
      assert.deepEqual([50,60].map(id => state.orderItems.find(row => row.id === id).received_quantity), [3,2]);
      assert.equal(state.inventoryBalances.get('7:10').quantity, 8);
      assert.equal(state.inventoryBalances.get('7:30').quantity, 2);
      assert.equal(state.aliasEvents.length, 1);
    } else {
      assert.equal(state.inventoryBalances.get('7:10').quantity, 5);
      assert.equal(state.inventoryBalances.get('7:30').quantity, 0);
    }
    throw new Error('Synthetic final transaction failure');
  } });
  await update('5'); await sign();
  const snapshot = () => structuredClone({ documents: h.state.documents, lines: h.state.lines, orderItems: h.state.orderItems,
    balances: [...h.state.inventoryBalances], tx: h.state.inventoryTransactions, aliases: h.state.aliases, events: h.state.aliasEvents, audits: h.state.audits });
  const draft = snapshot(); failStatus = 'confirmed';
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 500);
  assert.deepEqual(snapshot(), draft); assert.equal(reached, 1);
  failStatus = null;
  assert.equal((await h.invoke('confirmDocument', { user, params: { id } })).statusCode, 200);
  const confirmed = snapshot(); failStatus = 'void';
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params: { id }, body: { reason: 'test' } })).statusCode, 500);
  assert.deepEqual(snapshot(), confirmed); assert.equal(reached, 2);
});

test('branch concurrent confirm under transactional lock applies stock exactly once', async () => {
  const { h, id, sign } = await setup({ serializeTransactions: true }); await sign();
  const results = await Promise.all([user,store].map(actor => h.invoke('confirmDocument', { user: actor, params: { id } })));
  assert.deepEqual(results.map(response => response.statusCode).sort(), [200,409]);
  assert.equal(h.state.inventoryBalances.get('7:10').quantity, 11);
  assert.equal(h.state.inventoryBalances.get('7:30').quantity, 4);
  assert.equal(h.state.aliasEvents.length, 1);
  const settlement = await read('../src/models/receiving-documents-settlement.js');
  assert.match(settlement, /FROM receiving_documents rd\s+WHERE rd.id = \?\s+FOR UPDATE/);
});
