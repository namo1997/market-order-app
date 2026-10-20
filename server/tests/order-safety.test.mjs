import { lockBalanceRow } from '../src/models/inventory-balance-lock.js';
import * as receivingGroupSql from '../src/models/receiving-group-sql.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as orderInput from '../src/utils/order-input.js';

// Run the actual modules with isolated SQL/notification dependencies. No env,
// database or network is loaded, and unrecognized SQL fails the test.
async function load(path, dependencies, extra = {}) {
  const context = vm.createContext({ console: { log() {}, error() {} }, Date, ...extra });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const values = dependencies(specifier);
    if (!values) throw new Error(`Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

const row = (overrides = {}) => ({
  id: 50, product_id: 7, source_product_group_id: 3, quantity: 5,
  requested_price: 10, notes: '', received_quantity: null, received_at: null,
  actual_price: null, actual_quantity: null, is_purchased: 0, ...overrides
});
const payload = (overrides = {}) => ({ product_id: 7, source_product_group_id: 3, quantity: 5, requested_price: 10, notes: 'New note', ...overrides });

async function orderHarness(items = [row()], extra = {}) {
  const state = { items: structuredClone(items), balance: 5, nextId: 100, transactions: [], numbers: [], deleted: false };
  const queries = [];
  let saved;
  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    queries.push(q);
    if (q.startsWith('SHOW COLUMNS')) return [[{ Field: 'exists' }]];
    if (q.includes('FROM order_status_settings')) return [[{ is_open: true }]];
    if (q.startsWith('SELECT status, order_date')) return [[{ status: 'submitted', order_date: '2026-10-02', user_id: 1 }]];
    if (q.startsWith('SELECT * FROM order_items')) return [structuredClone(state.items)];
    if (q.startsWith('SELECT b.id AS branch_id')) return [[{ branch_id: 1, department_id: 1 }]];
    if (q.startsWith('INSERT INTO orders ')) { state.numbers.push(params[0]); return [{ insertId: 1 }]; }
    if (q.startsWith('INSERT INTO order_items ')) {
      for (const [, product_id, source_product_group_id, quantity, requested_price, notes] of params[0]) {
        state.items.push(row({ id: ++state.nextId, product_id, source_product_group_id, quantity, requested_price, notes }));
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE order_items SET quantity =')) {
      const [quantity, requested_price, notes, source_product_group_id, id] = params;
      Object.assign(state.items.find(item => item.id === id), { quantity, requested_price, notes, source_product_group_id });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('DELETE FROM order_items WHERE id =')) { state.items = state.items.filter(item => item.id !== params[0]); return [{ affectedRows: 1 }]; }
    if (q.startsWith('DELETE FROM orders')) { state.deleted = true; state.items = []; return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE orders SET total_amount')) { state.total = params[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith('SELECT oi.id FROM order_items')) return [state.items.map(item => ({ id: item.id }))];
    if (q.startsWith('SELECT oi.id AS order_item_id')) return [[{
      ...state.items.find(item => item.id === params[0]), order_item_id: params[0], department_id: 1,
      product_group_id: 3, is_internal_group: 0, is_countable: 1, allow_pending_carryover: 0
    }]];
    if (q.startsWith('UPDATE order_items SET received_quantity')) {
      state.items.find(item => item.id === params.at(-1)).received_quantity = params[0];
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT quantity FROM inventory_balance')) return [[{ quantity: state.balance }]];
    if (q.startsWith('INSERT INTO inventory_transactions')) { state.transactions.push(params); return [{ insertId: 101 }]; }
    if (q.startsWith('INSERT INTO inventory_balance')) { state.balance = params[2]; return [{ affectedRows: 1 }]; }
    throw new Error(`Unmocked SQL: ${q}`);
  }
  const connection = {
    query, beginTransaction: async () => { saved = structuredClone(state); },
    commit: async () => {}, rollback: async () => Object.assign(state, saved), release() {}
  };
  const noop = async () => {};
  const model = await load('../src/models/order.model.js', specifier => {
    if (specifier.endsWith('/receiving-group-sql.js')) return receivingGroupSql;
    if (specifier === 'node:crypto') return { randomUUID };
    if (specifier.endsWith('/order-input.js')) return orderInput;
    if (specifier.endsWith('/database.js')) return { default: { query, getConnection: async () => connection } };
    if (specifier.endsWith('/inventory.model.js')) return { ensureInventoryTables: noop, lockBalanceRow };
    if (specifier.endsWith('/supplier.model.js')) return {
      ensureSupplierColumns: noop, ensureProductGroupWithdrawSourceTable: noop, ensureSupplierScopeTable: noop,
      getMappedSourceDepartmentByProductGroup: async () => null
    };
    if (specifier.endsWith('/withdraw-source-mapping.model.js')) return { ensureWithdrawSourceMappingTable: noop };
  }, extra);
  return { model, state, queries };
}

test('note/price edit keeps receiving and purchasing facts; receiving again does not double stock', async () => {
  const original = row({ received_quantity: 5, received_at: '2026-10-02 09:00:00', actual_price: 9, actual_quantity: 5, is_purchased: 1 });
  const h = await orderHarness([original]);
  await h.model.updateOrder(1, { items: [payload({ requested_price: 12 })] });
  assert.equal(h.state.items[0].id, original.id);
  for (const field of ['received_quantity', 'received_at', 'actual_price', 'actual_quantity', 'is_purchased']) {
    assert.equal(h.state.items[0][field], original[field]);
  }
  assert.equal(h.state.items[0].notes, 'New note');
  assert.equal(h.state.total, 60);
  await h.model.updateReceivingItems([{ order_item_id: 50, received_quantity: 5 }], 1, { userId: 1 });
  assert.equal(h.state.balance, 5);
  assert.equal(h.state.transactions.length, 0);
  assert.ok(h.queries.some(q => q.startsWith('SELECT * FROM order_items') && q.endsWith('FOR UPDATE')));
});

test('legacy received rows retain NULL source group on note edit', async () => {
  const h = await orderHarness([row({ received_quantity: 5, source_product_group_id: null })]);
  await h.model.updateOrder(1, { items: [payload()] });
  assert.equal(h.state.items[0].source_product_group_id, null);
  assert.equal(h.state.items[0].id, 50);
});

for (const activity of [{ received_quantity: 5 }, { received_quantity: 0 }, { is_purchased: 1 }, { actual_quantity: 2 }, { actual_price: 0 }]) {
  test(`received/purchased rows cannot be removed, replaced or resized: ${JSON.stringify(activity)}`, async () => {
    for (const items of [[], [payload({ product_id: 8 })], [payload({ quantity: 6 })], [payload({ source_product_group_id: 4 })]]) {
      const h = await orderHarness([row(activity)]);
      await assert.rejects(h.model.updateOrder(1, { items }, { isAdmin: true }), { statusCode: 400 });
      assert.equal(h.state.items[0].id, 50);
      assert.equal(h.state.balance, 5);
      assert.equal(h.state.items.length, 1);
    }
    const h = await orderHarness([row(activity)]);
    await assert.rejects(h.model.deleteOrder(1), { statusCode: 400 });
    assert.equal(h.state.deleted, false);
  });
}

test('unprocessed rows can be edited, added, removed, and empty orders deleted by admin', async () => {
  const h = await orderHarness([row(), row({ id: 51, product_id: 8 })]);
  await h.model.updateOrder(1, { items: [payload({ quantity: 3 }), payload({ product_id: 9 })] });
  assert.equal(h.state.items[0].id, 50);
  assert.equal(h.state.items[0].quantity, 3);
  assert.deepEqual(h.state.items.map(item => item.product_id), [7, 9]);
  await h.model.updateOrder(1, { items: [] }, { isAdmin: true });
  assert.equal(h.state.deleted, true);
  const h2 = await orderHarness();
  await h2.model.deleteOrder(1);
  assert.equal(h2.state.deleted, true);
});

test('same product in different groups retains each row identity', async () => {
  const h = await orderHarness([row(), row({ id: 51, source_product_group_id: 4, received_quantity: 5 })]);
  await h.model.updateOrder(1, { items: [payload({ source_product_group_id: 4 }), payload()] });
  assert.equal(h.state.items.find(item => item.id === 51).source_product_group_id, 4);
  assert.equal(h.state.items.find(item => item.id === 51).received_quantity, 5);
});

for (const invalid of [undefined, null, {}, [], [null], [payload({ quantity: -5 })], [payload({ quantity: 0 })], [payload({ quantity: 0.001 })], [payload({ quantity: 'abc' })], [payload({ quantity: Infinity })], [payload({ quantity: true })], [payload({ requested_price: -1 })], [payload({ requested_price: 'abc' })], [payload({ product_id: 1.5 })], [payload({ quantity: 99999999, requested_price: 99999999 })]]) {
  test(`create/update reject invalid order input before SQL: ${JSON.stringify(invalid)}`, async () => {
    const h = await orderHarness();
    await assert.rejects(h.model.createOrder({ user_id: 1, order_date: '2026-10-02', items: invalid }), { statusCode: 400 });
    await assert.rejects(h.model.updateOrder(1, { items: invalid }), { statusCode: 400 });
    assert.equal(h.queries.length, 0);
  });
}

test('valid decimal strings and free items remain supported', async () => {
  const h = await orderHarness([]);
  const result = await h.model.createOrder({ user_id: 1, order_date: '2026-10-02', items: [payload({ quantity: '2.5', requested_price: '10.2' }), payload({ product_id: 8, requested_price: 0 })] });
  assert.equal(result.total_amount, 25.5);
});

test('order numbers remain distinct at the same millisecond and after 16m40s', async () => {
  let now = Date.parse('2026-10-02T12:00:00.123+07:00');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const h = await orderHarness([], { Date: Clock });
  for (let i = 0; i < 50; i++) {
    if (i === 25) now += 1000000;
    await h.model.createOrder({ user_id: 1, order_date: '2026-10-02', items: [payload()] });
  }
  assert.equal(new Set(h.state.numbers).size, 50);
  assert.ok(h.state.numbers.every(number => number.length <= 50));
  const source = await readFile(new URL('../../client/src/pages/inventory/StockMovements.jsx', import.meta.url), 'utf8');
  const expression = source.match(/const orderMatch = (notes\.match\([^;]+\));/)[1];
  for (const number of [h.state.numbers[0], 'ORD-20261002-200123']) {
    const parsed = vm.runInNewContext(expression, { notes: `รับสินค้าจาก ${number} เรียบร้อย` });
    assert.equal(parsed[0], number, 'stock movement references must display the entire old/new order number');
  }
});

async function poHarness() {
  const writes = [], reads = [];
  const po = { id: 99, branch_id: 2, department_id: 20, status: 'draft' };
  const controller = await load('../src/controllers/purchase-order.controller.js', specifier => {
    if (specifier.endsWith('/purchase-order.model.js')) return {
      getPurchaseOrders: async filters => { reads.push(filters); return []; },
      getPurchaseOrderById: async () => po,
      createPurchaseOrder: async args => { writes.push(['create', args]); return po; },
      receivePurchaseOrder: async args => { writes.push(['receive', args]); return po; },
      cancelPurchaseOrder: async id => { writes.push(['cancel', id]); return po; }
    };
    if (specifier.endsWith('/settings.model.js')) return { getSetting: async () => '' };
    if (specifier.endsWith('/discord.js')) return { sendDiscordTextNotification: async () => {} };
  });
  async function invoke(action, user) {
    let error, response;
    const res = { status() { return this; }, json(body) { response = body; return this; } };
    await controller[action]({ user, params: { id: '99' }, query: { branch_id: 2, department_id: 20 }, body: { items: [] } }, res, err => { error = err; });
    return { error, response };
  }
  return { invoke, writes, reads };
}

for (const user of [
  { role: 'user', branch_id: 1, department_id: 1 },
  { role: 'user', branch_id: 2, department_id: 21 },
  { role: 'user', branch_id: 1, department_id: 20 },
  { role: 'user' }
]) {
  test(`PO details/receipt/cancellation reject wrong or missing scope: ${JSON.stringify(user)}`, async () => {
    const h = await poHarness();
    for (const action of ['getPurchaseOrderById', 'receivePurchaseOrder', 'cancelPurchaseOrder']) {
      const result = await h.invoke(action, user);
      assert.equal(result.error?.statusCode, 403);
      assert.equal(result.response, undefined);
    }
    assert.equal(h.writes.length, 0);
  });
}

for (const user of [{ role: 'user', branch_id: '2', department_id: '20' }, { role: 'admin' }, { role: 'super_admin' }]) {
  test(`PO own scope and administrators keep access: ${user.role}`, async () => {
    const h = await poHarness();
    for (const action of ['getPurchaseOrderById', 'receivePurchaseOrder', 'cancelPurchaseOrder']) {
      const result = await h.invoke(action, user);
      assert.equal(result.error, undefined);
      assert.equal(result.response.success, true);
    }
    assert.equal(h.writes.length, 2);
  });
}

test('PO list cannot override scope; missing scope cannot list or create', async () => {
  const h = await poHarness();
  await h.invoke('getPurchaseOrders', { role: 'user', branch_id: 1, department_id: 1 });
  assert.equal(h.reads[0].branchId, 1);
  assert.equal(h.reads[0].departmentId, 1);
  for (const action of ['getPurchaseOrders', 'createPurchaseOrder']) {
    assert.equal((await h.invoke(action, { role: 'user' })).error.statusCode, 403);
  }
  assert.equal(h.reads.length, 1);
  assert.equal(h.writes.length, 0);
});
