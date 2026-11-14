import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import * as orderInput from '../src/utils/order-input.js';
import * as receivingGroupSql from '../src/models/receiving-group-sql.js';
import { lockBalanceRow } from '../src/models/inventory-balance-lock.js';
import * as deadlockRetry from '../src/utils/deadlock-retry.js';

const { withDeadlockRetry, isDeadlockError, DEADLOCK_MAX_ATTEMPTS } = deadlockRetry;

// error แบบเดียวกับที่ mysql2 โยนเมื่อ InnoDB เลือก transaction นี้เป็นเหยื่อ deadlock
const deadlock = () => Object.assign(
  new Error('Deadlock found when trying to get lock; try restarting transaction'),
  { code: 'ER_LOCK_DEADLOCK', errno: 1213, sqlState: '40001' }
);
const quiet = { sleep: async () => {}, onRetry() {} };

test('deadlock helper: 1213 retries the whole unit of work and returns the successful result', async () => {
  const waits = [];
  let calls = 0;
  const result = await withDeadlockRetry(async (attempt) => {
    calls += 1;
    assert.equal(attempt, calls);
    if (calls < 3) throw deadlock();
    return { updated: 2 };
  }, { sleep: async (ms) => { waits.push(ms); }, random: () => 0.5, onRetry() {} });
  assert.deepEqual(result, { updated: 2 });
  assert.equal(calls, 3);
  assert.equal(DEADLOCK_MAX_ATTEMPTS, 3);
  // jitter ที่ random=0.5 คือค่า base * 2^(n-1) พอดี: สั้นและเพิ่มขึ้น
  assert.deepEqual(waits, [40, 80]);
  // errno อย่างเดียว (ไม่มี code) ก็ถือว่า deadlock
  assert.equal(isDeadlockError({ errno: 1213 }), true);
});

test('deadlock helper: lock wait timeout (1205) and other errors are rethrown at once without retry', async () => {
  const errors = [
    Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }),
    Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 }),
    Object.assign(new Error('lost connection'), { code: 'ECONNRESET' }),
    Object.assign(new Error('bad input'), { statusCode: 400 })
  ];
  for (const error of errors) {
    let calls = 0;
    await assert.rejects(withDeadlockRetry(async () => { calls += 1; throw error; }, quiet), (thrown) => thrown === error);
    assert.equal(calls, 1, error.message);
    assert.equal(isDeadlockError(error), false);
  }
});

test('deadlock helper: gives up after 3 attempts and rethrows the last deadlock error', async () => {
  const thrown = [];
  await assert.rejects(
    withDeadlockRetry(async () => { const error = deadlock(); thrown.push(error); throw error; }, quiet),
    (error) => error === thrown.at(-1) && error.code === 'ER_LOCK_DEADLOCK'
  );
  assert.equal(thrown.length, 3);
});

// ----- ที่ขอบ transaction จริงของ order.model.js + orders.controller.js (ไม่ใช้ DB จริง) -----

async function load(path, dependencies, extra = {}) {
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {} }, Date, ...extra });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link((specifier) => {
    const values = dependencies(specifier);
    if (!values) throw new Error(`Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

// ฐานจำลองแบบ transaction: BEGIN จด snapshot, ROLLBACK คืนค่า, COMMIT เก็บไว้
// failOn(attempt, ctxSelectNo) เลือกจุดที่ InnoDB โยน deadlock ระหว่างทาง (หลังลงสต็อกไปแล้วบางรายการ)
async function receivingHarness({ deadlockAttempts = [1] } = {}) {
  const db = {
    items: [
      { id: 50, product_id: 7, quantity: 5, received_quantity: 2 },
      { id: 51, product_id: 8, quantity: 3, received_quantity: null }
    ],
    balance: { '7|1': 2, '8|1': 0 },
    transactions: []
  };
  const stats = { connections: 0, begins: 0, commits: 0, rollbacks: 0, releases: 0 };
  let snapshot = null;
  let contextSelects = 0;
  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SHOW COLUMNS')) return [[{ Field: 'exists' }]];
    if (q.startsWith('SELECT oi.id FROM order_items')) return [db.items.map((item) => ({ id: item.id }))];
    if (q.startsWith('SELECT oi.id AS order_item_id')) {
      contextSelects += 1;
      // รายการที่สองของรอบที่กำหนด: deadlock หลังรายการแรกลง order_items และสต็อกไปแล้ว
      if (deadlockAttempts.includes(stats.begins) && contextSelects === 2) throw deadlock();
      const item = db.items.find((row) => row.id === params[0]);
      return [[{ ...item, order_item_id: item.id, department_id: 1, product_group_id: 3,
        is_internal_group: 0, is_countable: 1, allow_pending_carryover: 0 }]];
    }
    if (q.startsWith('UPDATE order_items SET received_quantity')) {
      db.items.find((row) => row.id === params.at(-1)).received_quantity = params[0];
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO inventory_balance') && q.includes('product_id = product_id')) {
      db.balance[`${params[0]}|${params[1]}`] ??= 0;
      return [{ affectedRows: 0 }];
    }
    if (q.startsWith('SELECT quantity FROM inventory_balance')) {
      return [[{ quantity: db.balance[`${params[0]}|${params[1]}`] }]];
    }
    if (q.startsWith('INSERT INTO inventory_transactions')) {
      db.transactions.push({ product_id: params[0], quantity: params[3], before: params[4], after: params[5] });
      return [{ insertId: db.transactions.length }];
    }
    if (q.startsWith('INSERT INTO inventory_balance')) {
      db.balance[`${params[0]}|${params[1]}`] = params[2];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unmocked SQL: ${q}`);
  }
  const getConnection = async () => {
    stats.connections += 1;
    return {
      query,
      beginTransaction: async () => { stats.begins += 1; contextSelects = 0; snapshot = structuredClone(db); },
      commit: async () => { stats.commits += 1; snapshot = null; },
      rollback: async () => { stats.rollbacks += 1; Object.assign(db, structuredClone(snapshot)); snapshot = null; },
      release() { stats.releases += 1; }
    };
  };
  const noop = async () => {};
  const fastRetry = {
    ...deadlockRetry,
    withDeadlockRetry: (work, options) => withDeadlockRetry(work, { ...options, ...quiet })
  };
  const model = await load('../src/models/order.model.js', (specifier) => {
    if (specifier.endsWith('/receiving-group-sql.js')) return receivingGroupSql;
    if (specifier === 'node:crypto') return { randomUUID };
    if (specifier.endsWith('/order-input.js')) return orderInput;
    if (specifier.endsWith('/deadlock-retry.js')) return fastRetry;
    if (specifier.endsWith('/database.js')) return { default: { query, getConnection } };
    if (specifier.endsWith('/inventory.model.js')) return { ensureInventoryTables: noop, lockBalanceRow };
    if (specifier.endsWith('/supplier.model.js')) return {
      ensureSupplierColumns: noop, ensureProductGroupWithdrawSourceTable: noop, ensureSupplierScopeTable: noop,
      getMappedSourceDepartmentByProductGroup: async () => null
    };
    if (specifier.endsWith('/withdraw-source-mapping.model.js')) return { ensureWithdrawSourceMappingTable: noop };
  });

  const notifications = [];
  const controllerModel = {
    ...model,
    getReceivingItemsByUser: async () => db.items.map((item) => ({ ...item, supplier_id: 9 }))
  };
  const controller = await load('../src/controllers/orders.controller.js', (specifier) => ({
    '../models/order.model.js': controllerModel,
    '../models/user.model.js': { getUserById: async () => null },
    '../models/settings.model.js': {}, '../models/supplier.model.js': {},
    '../services/order-notification-options.js': { getNotificationOptions() {} },
    '../services/receiving-notify.js': { sendReceivingSavedNotification: async (payload) => { notifications.push(payload); } },
    '../utils/line.js': { sendLineOrderNotification() {} },
    '../utils/discord.js': { sendDiscordOrderNotification() {} },
    '../utils/direct-order.js': { sendDirectOrderAfterCutoff() {} },
    '../utils/product-group.js': { withProductGroupAliases: (value) => value },
    '../utils/other-suppliers-notification.js': { isDiscordWebhookUrl() {}, parseGroupCodes() {}, pickItemsByGroupIds() {} }
  })[specifier]);

  const save = async () => {
    const out = { status: 200, body: null, error: null };
    const res = { status(code) { out.status = code; return res; }, json(body) { out.body = body; return res; } };
    await controller.updateReceivingItems({
      body: { items: [
        { order_item_id: 50, received_quantity: 5, supplier_id: 9 },
        { order_item_id: 51, received_quantity: 3, supplier_id: 9 }
      ] },
      query: { date: '2026-11-10' },
      user: { id: 1, branch_id: 4, department_id: 1 }
    }, res, (error) => { out.error = error; });
    return out;
  };
  return { db, stats, notifications, save };
}

test('PUT /orders/receiving: deadlock on attempt 1 then success commits once, posts stock delta once, notifies once', async () => {
  const h = await receivingHarness({ deadlockAttempts: [1] });
  const out = await h.save();
  assert.equal(out.error, null);
  assert.equal(out.body?.success, true);
  assert.equal(out.body.data.updated, 2);
  // รอบแรก rollback เต็ม (คืนการลงสต็อกของรายการแรก) รอบสองใช้ connection/transaction ใหม่
  assert.deepEqual(h.stats, { connections: 2, begins: 2, commits: 1, rollbacks: 1, releases: 2 });
  // delta = ใหม่ - เดิม ที่อ่านใหม่ในรอบที่สำเร็จ: 50 รับเพิ่ม 3 (2 -> 5), 51 รับ 3 — ไม่ลงซ้ำ
  assert.deepEqual(h.db.transactions.map((tx) => [tx.product_id, tx.quantity, tx.before, tx.after]), [[7, 3, 2, 5], [8, 3, 0, 3]]);
  assert.deepEqual(h.db.balance, { '7|1': 5, '8|1': 3 });
  assert.deepEqual(h.db.items.map((item) => item.received_quantity), [5, 3]);
  assert.equal(h.notifications.length, 1);
});

test('PUT /orders/receiving: deadlock on every attempt leaves stock untouched and sends no notification', async () => {
  const h = await receivingHarness({ deadlockAttempts: [1, 2, 3] });
  const out = await h.save();
  assert.equal(out.error?.code, 'ER_LOCK_DEADLOCK');
  assert.equal(out.body, null);
  assert.deepEqual(h.stats, { connections: 3, begins: 3, commits: 0, rollbacks: 3, releases: 3 });
  assert.deepEqual(h.db.transactions, []);
  assert.deepEqual(h.db.balance, { '7|1': 2, '8|1': 0 });
  assert.deepEqual(h.db.items.map((item) => item.received_quantity), [2, null]);
  assert.equal(h.notifications.length, 0);
});
