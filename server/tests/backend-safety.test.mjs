import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as lineLogin from '../src/utils/line-login.js';
import * as orderInput from '../src/utils/order-input.js';
import * as deadlockRetry from '../src/utils/deadlock-retry.js';
import * as receivingGroupSql from '../src/models/receiving-group-sql.js';
import { lockBalanceRow } from '../src/models/inventory-balance-lock.js';
import { buildBangkokDateRangeSql } from '../src/utils/stock-ledger.js';

// Execute the actual modules with in-memory boundaries: no database, network,
// credentials or notification services are contacted by these regression tests.
async function load(relativePath, dependencies, globals = {}) {
  const context = vm.createContext({ console, process: { env: {} }, setTimeout, clearTimeout, ...globals });
  const mod = new vm.SourceTextModule(await readFile(new URL(relativePath, import.meta.url), 'utf8'), { context });
  await mod.link((specifier) => {
    if (specifier === '../utils/line-login.js') dependencies[specifier] = lineLogin;
    if (specifier === '../models/product-usage-unit.model.js') dependencies[specifier] = { convertIngredientsToBase() {} };
    if (specifier === '../utils/stock-ledger.js') dependencies[specifier] = { buildBangkokDateRangeSql };
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

for (const user of [{ id: 1, role: 'super_admin', username: 'owner' }, { id: 2, role: 'admin', username: 'supper_admin' }]) {
  test(`legacy login cannot bypass PIN for ${user.username}`, async () => {
    const controller = await load('../src/controllers/auth.controller.js', {
      '../models/user.model.js': { getUserById: async () => user },
      '../models/supplier.model.js': {}, '../config/database.js': { default: {} },
      '../utils/jwt.js': { generateToken: () => assert.fail('must not issue token') },
      '../services/db-sync.service.js': { syncDatabaseFromRailway() {} },
      '../utils/product-group.js': { withProductGroupAliases: (value) => value }
    });
    const res = response();
    await controller.login({ body: { userId: user.id } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, 403);
  });
}

test('market authentication rejects scoped and malformed sessions, accepts market user', async () => {
  let payload;
  const auth = await load('../src/middleware/auth.js', { '../utils/jwt.js': { verifyToken: () => payload } });
  for (const session of [{ scope: 'general_purchase', mode: 'readonly' }, { id: 3, role: 'admin', scope: 'general_purchase' }, { id: null, role: 'user' }, { id: 3, role: 'user' }]) {
    payload = session;
    let called = false;
    const res = response();
    auth.authenticate({ headers: { authorization: 'Bearer test' } }, res, () => { called = true; });
    assert.equal(called, session.id === 3 && session.role === 'user');
    if (!called) assert.equal(res.statusCode, 401);
  }
});

test('lost query/execute responses never replay a possibly committed write; connection acquisition retries', async () => {
  let queryCalls = 0, executeCalls = 0, connectionCalls = 0;
  const failure = Object.assign(new Error('lost connection'), { code: 'ECONNRESET' });
  const raw = {
    query: async () => { queryCalls++; throw failure; },
    execute: async () => { executeCalls++; throw failure; },
    getConnection: async () => { connectionCalls++; if (connectionCalls === 2) throw failure; return { release() {} }; },
    end() {}
  };
  const { default: pool } = await load('../src/config/database.js', {
    'mysql2/promise': { default: { createPool: () => raw } },
    dotenv: { default: { config() {} } }
  }, { setTimeout: (callback) => { callback(); }, process: { env: { DB_RETRY_ATTEMPTS: '3' } } });
  await assert.rejects(pool.query('INSERT INTO example VALUES (1)'), /lost connection/);
  await assert.rejects(pool.execute('UPDATE example SET amount = amount + 1'), /lost connection/);
  await pool.getConnection();
  assert.equal(queryCalls, 1);
  assert.equal(executeCalls, 1);
  assert.equal(connectionCalls, 3);
});

async function orderModel(pool) {
  return load('../src/models/order.model.js', {
    'node:crypto': { randomUUID },
    '../utils/order-input.js': orderInput,
    '../utils/deadlock-retry.js': deadlockRetry,
    './receiving-group-sql.js': receivingGroupSql,
    '../config/database.js': { default: pool },
    './inventory.model.js': { ensureInventoryTables: async () => {}, lockBalanceRow },
    './supplier.model.js': Object.fromEntries(['ensureSupplierColumns', 'ensureProductGroupWithdrawSourceTable', 'ensureSupplierScopeTable', 'getMappedSourceDepartmentByProductGroup'].map((key) => [key, async () => {}])),
    './withdraw-source-mapping.model.js': { ensureWithdrawSourceMappingTable: async () => {} }
  });
}

test('invalid order and receiving batches fail before database writes', async () => {
  const model = await orderModel({ query: () => assert.fail('invalid input reached DB'), getConnection: () => assert.fail('invalid input reached DB') });
  for (const items of [undefined, [], {}, [null], [{ product_id: 1, quantity: -2 }], [{ product_id: 1, quantity: 3, requested_price: -1 }], [{ product_id: 1, quantity: Infinity }]]) {
    await assert.rejects(model.createOrder({ items }), (error) => error.statusCode === 400);
    await assert.rejects(model.updateOrder(1, { items }), (error) => error.statusCode === 400);
  }
  for (const quantity of [-1, 'oops', Infinity, {}, true]) {
    for (const scope of ['mine', 'branch']) {
      await assert.rejects(model.updateReceivingItems([{ order_item_id: 1, received_quantity: quantity }], 1, { scope }), (error) => error.statusCode === 400);
    }
  }
});

test('department schema checks run once across concurrent and subsequent reads', async () => {
  let schemaQueries = 0;
  const model = await load('../src/models/user.model.js', { '../config/database.js': { default: { query: async (sql) => {
    if (sql.startsWith('SHOW')) { schemaQueries++; return [[{ Field: 'exists' }]]; }
    return [[]];
  } } } });
  await Promise.all([model.getAllBranches(), model.getAllBranches(), model.getAllBranches()]);
  await model.getAllBranches();
  assert.equal(schemaQueries, 3);
});

for (const action of ['getPurchaseOrderById', 'receivePurchaseOrder', 'cancelPurchaseOrder']) {
  test(`${action} denies cross-branch/department PO access while allowing owner and admin`, async () => {
    let mutations = 0;
    const controller = await load('../src/controllers/purchase-order.controller.js', {
      '../models/purchase-order.model.js': {
        getPurchaseOrderById: async () => ({ id: 1, branch_id: 2, department_id: 20 }),
        receivePurchaseOrder: async () => { mutations++; return {}; },
        cancelPurchaseOrder: async () => { mutations++; return {}; }
      },
      '../models/settings.model.js': {}, '../utils/discord.js': { sendDiscordTextNotification() {} }
    });
    for (const user of [{ role: 'user', branch_id: 1, department_id: 20 }, { role: 'user', branch_id: 2, department_id: 30 }, { role: 'user' }]) {
      const res = response(); let error;
      await controller[action]({ params: { id: 1 }, body: { items: [] }, user }, res, (e) => { error = e; });
      assert.equal(error?.statusCode, 403);
      assert.equal(res.body, undefined);
    }
    assert.equal(mutations, 0);
    for (const user of [{ role: 'user', branch_id: 2, department_id: 20 }, { role: 'admin', branch_id: 1, department_id: 30 }]) {
      const res = response();
      await controller[action]({ params: { id: 1 }, body: { items: [] }, user }, res, (e) => { throw e; });
      assert.equal(res.body.success, true);
    }
  });
}

test('cancellation detects a PO received concurrently instead of overwriting its status', async () => {
  let updateSql;
  const model = await load('../src/models/purchase-order.model.js', {
    '../config/database.js': { default: {
      getConnection: async () => ({ query: async () => [[]], release() {} }),
      query: async (sql) => {
        if (sql.startsWith('SELECT id, status')) return [[{ id: 1, status: 'confirmed' }]];
        updateSql = sql;
        return [{ affectedRows: 0 }];
      }
    } }
  });
  await assert.rejects(model.cancelPurchaseOrder(1), (error) => error.statusCode === 409);
  assert.match(updateSql, /AND status IN \('draft', 'confirmed'\)/);
});

async function inventoryController(createTransaction = () => assert.fail('unauthorized write reached model')) {
  return load('../src/controllers/inventory.controller.js', {
    '../models/inventory.model.js': { createTransaction, setInitialBalance: async (value) => ({ ...await createTransaction(value), changed: true }) }, '../models/production-transform-config.model.js': {},
    '../models/settings.model.js': {}, '../utils/product-group.js': { withProductGroupAliases: (value) => value },
    '../config/database.js': { default: { query: () => assert.fail('unauthorized request reached DB') } },
    '../models/branch.model.js': { getBranchById() {} }, '../services/clickhouse.service.js': { queryClickHouse() {} }
  });
}
for (const action of ['createMovement', 'initializeBalance', 'applyAdjustment']) {
  test(`${action} blocks cross-department writes before touching data`, async () => {
    const controller = await inventoryController();
    let error;
    await controller[action]({ body: { product_id: 1, department_id: 20, quantity: 3, transaction_type: 'receive', date: '2026-11-04', pin: '1997' }, user: { id: 1, role: 'user', department_id: 10 } }, response(), (e) => { error = e; });
    assert.equal(error?.statusCode, 403);
  });
}

test('inventory validates full numeric quantities and retains own-department/admin writes', async () => {
  const writes = [];
  const controller = await inventoryController(async (value) => { writes.push(value); return value; });
  for (const action of ['createMovement', 'initializeBalance']) {
    for (const quantity of ['3abc', {}, true, '', Infinity]) {
      let error;
      await controller[action]({ body: { product_id: 1, department_id: 20, quantity, transaction_type: 'receive' }, user: { role: 'user', department_id: 20 } }, response(), (e) => { error = e; });
      assert.equal(error?.statusCode, 400);
    }
    for (const user of [{ role: 'user', department_id: 20 }, { role: 'admin', department_id: 10 }]) {
      const res = response();
      await controller[action]({ body: { product_id: 1, department_id: 20, quantity: '0', transaction_type: 'receive' }, user }, res, (e) => { throw e; });
      assert.equal(res.statusCode, 201);
    }
  }
  assert.equal(writes.length, 4);
  assert.ok(writes.every((write) => write.quantity === 0));
});

for (const secret of [undefined, '', 'short', 'your-secret-key-change-this-in-production', 'market-order-secret-key-2026-change-this-in-production']) {
  test(`production JWT configuration rejects ${secret === undefined ? 'missing' : secret === '' ? 'empty' : 'unsafe'} secret`, async () => {
    await assert.rejects(load('../src/utils/jwt.js', {
      jsonwebtoken: { default: {} }, dotenv: { default: { config() {} } }
    }, { process: { env: { NODE_ENV: 'production', JWT_SECRET: secret } } }), /unique JWT_SECRET/);
  });
}

test('configured production JWT and development fallback still sign and verify', async () => {
  for (const env of [{ NODE_ENV: 'production', JWT_SECRET: 'test-fixture-only-strong-secret-32-chars' }, { NODE_ENV: 'development' }]) {
    const expected = env.JWT_SECRET || 'default-secret-key';
    const jwt = await load('../src/utils/jwt.js', {
      jsonwebtoken: { default: {
        sign: (payload, secret) => { assert.equal(secret, expected); return 'signed'; },
        verify: (token, secret) => { assert.equal(secret, expected); return { id: 1 }; }
      } }, dotenv: { default: { config() {} } }
    }, { process: { env } });
    assert.equal(jwt.generateToken({ id: 1 }), 'signed'); assert.equal(jwt.verifyToken('signed').id, 1);
  }
});

test('production super-admin PIN fails closed; configured PIN works and development has no implicit owner PIN', async () => {
  for (const [env, pin, expectedStatus] of [
    [{ NODE_ENV: 'production' }, '1997', 503],
    [{ NODE_ENV: 'production', SUPER_ADMIN_PIN: '1997' }, '1997', 503],
    [{ NODE_ENV: 'production', SUPER_ADMIN_PIN: '482951' }, 'wrong', 401],
    [{ NODE_ENV: 'production', SUPER_ADMIN_PIN: '482951' }, '482951', 200],
    [{ NODE_ENV: 'development' }, '1997', 401]
  ]) {
    const controller = await load('../src/controllers/auth.controller.js', {
      '../models/user.model.js': { getUserByUsername: async () => {
        assert.equal(expectedStatus, 200); return { id: 1, username: 'supper_admin', department_id: 1, branch_id: 1 };
      } }, '../models/supplier.model.js': {}, '../config/database.js': { default: {} },
      '../utils/jwt.js': { generateToken: () => 'signed' },
      '../services/db-sync.service.js': { syncDatabaseFromRailway() {} },
      '../utils/product-group.js': { withProductGroupAliases: (value) => value }
    }, { process: { env } });
    const res = response(); await controller.loginSuperAdmin({ body: { pin } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, expectedStatus);
    if (expectedStatus === 200) assert.equal(res.body.data.token, 'signed');
  }
});

test('production stock PIN fails closed and configured PIN preserves the downstream adjustment gate', async () => {
  for (const [env, pin, expectedStatus] of [
    [{ NODE_ENV: 'production' }, '1997', 503],
    [{ NODE_ENV: 'production', STOCK_ADJUSTMENT_PIN: '1997' }, '1997', 503],
    [{ NODE_ENV: 'production', STOCK_ADJUSTMENT_PIN: '482951' }, 'wrong', 403],
    [{ NODE_ENV: 'production', STOCK_ADJUSTMENT_PIN: '482951' }, '482951', 404],
    [{ NODE_ENV: 'development' }, '1997', 404]
  ]) {
    let queried = false;
    const controller = await load('../src/controllers/inventory.controller.js', {
      '../models/inventory.model.js': {}, '../models/production-transform-config.model.js': {},
      '../models/settings.model.js': {}, '../utils/product-group.js': { withProductGroupAliases: (value) => value },
      '../config/database.js': { default: { query: async () => { queried = true; return [[]]; } } },
      '../models/branch.model.js': { getBranchById() {} }, '../services/clickhouse.service.js': { queryClickHouse() {} }
    }, { process: { env } });
    const res = response();
    await controller.applyAdjustment({ body: { pin, date: '2026-11-04', department_id: 1 }, user: { id: 1, role: 'admin' } }, res, (error) => { throw error; });
    assert.equal(res.statusCode, expectedStatus); assert.equal(queried, expectedStatus === 404);
  }
});


test('order status reads can use the existing transaction connection without acquiring another pool slot', async () => {
  const model = await orderModel({ query: () => assert.fail('transaction read escaped into pool') });
  let called = 0;
  const status = await model.getOrderStatus('2026-11-04', { query: async (sql, params) => {
    called++;
    assert.match(sql, /FROM order_status_settings/);
    assert.equal(params[0], '2026-11-04');
    return [[{ is_open: true }]];
  } });
  assert.equal(status.is_open, true);
  assert.equal(called, 1);
});


test('market accounting roles keep receiving access while scoped accounting tokens stay rejected', async () => {
  let payload;
  const auth = await load('../src/middleware/auth.js', { '../utils/jwt.js': { verifyToken: () => payload } });
  for (const role of ['accounting', 'accountant']) {
    for (const scoped of [false, true]) {
      payload = { id: 12, role, ...(scoped ? { scope: 'general_purchase' } : {}) };
      let accepted = false;
      const res = response();
      auth.authenticate({ headers: { authorization: 'Bearer fixture' } }, res, () => { accepted = true; });
      assert.equal(accepted, !scoped);
      if (scoped) assert.equal(res.statusCode, 401);
    }
  }
});
