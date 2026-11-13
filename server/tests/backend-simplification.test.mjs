import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import * as orderInput from '../src/utils/order-input.js';
import * as groupSql from '../src/models/receiving-group-sql.js';

async function load(relativePath, dependencies = {}, globals = {}) {
  const context = vm.createContext({ console, process: { env: {} }, Date, Buffer, ...globals });
  const mod = new vm.SourceTextModule(await readFile(new URL(relativePath, import.meta.url), 'utf8'), { context });
  await mod.link((specifier) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  return mod.namespace;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

async function loadOrderModel(pool) {
  return load('../src/models/order.model.js', {
    'node:crypto': { randomUUID }, '../utils/order-input.js': orderInput,
    './receiving-group-sql.js': groupSql, '../config/database.js': { default: pool },
    './inventory.model.js': { ensureInventoryTables: async () => {}, lockBalanceRow: async () => {} },
    './supplier.model.js': Object.fromEntries(['ensureSupplierColumns', 'ensureProductGroupWithdrawSourceTable', 'ensureSupplierScopeTable', 'getMappedSourceDepartmentByProductGroup'].map((key) => [key, async () => {}])),
    './withdraw-source-mapping.model.js': { ensureWithdrawSourceMappingTable: async () => {} }
  });
}

test('production print HTTP endpoint records all-branch scope, still rejects unauthenticated/non-production users and missing targets', async () => {
  const audit = [];
  let targetLookups = 0;
  const model = await loadOrderModel({ query: async (sql, params) => {
    if (sql.includes('FROM branches b')) { targetLookups++; return [[]]; }
    if (sql.includes('INSERT INTO production_print_logs')) { audit.push(params); return [{ insertId: 1 }]; }
    if (sql.includes('CREATE TABLE IF NOT EXISTS production_print_logs')) return [[]];
    assert.fail(`Unexpected SQL: ${sql}`);
  } });
  const controller = await load('../src/controllers/orders.controller.js', {
    '../models/order.model.js': model,
    '../models/user.model.js': { getUserById: async (id) => ({ id, name: 'Fixture', is_production: id === 1, branch_id: 4, branch_name: 'Production', department_id: 10, department_name: 'Kitchen' }) },
    '../models/settings.model.js': {}, '../models/supplier.model.js': {},
    '../services/order-notification-options.js': { getNotificationOptions() {} },
    '../services/receiving-notify.js': { sendReceivingSavedNotification() {} },
    '../utils/line.js': { sendLineOrderNotification() {} },
    '../utils/discord.js': { sendDiscordOrderNotification() {} },
    '../utils/direct-order.js': { sendDirectOrderAfterCutoff() {} },
    '../utils/product-group.js': { withProductGroupAliases: value => value },
    '../utils/other-suppliers-notification.js': { isDiscordWebhookUrl() {}, parseGroupCodes() {}, pickItemsByGroupIds() {} }
  });
  const auth = await load('../src/middleware/auth.js', {
    '../utils/jwt.js': { verifyToken: (token) => ({ id: Number(token), role: 'user' }) }
  });
  const routes = await load('../src/routes/orders.routes.js', {
    express: { default: express }, '../controllers/orders.controller.js': controller,
    '../middleware/auth.js': auth, '../middleware/legacy-receiving.js': { legacyReceivingWriteGuard: (_req, _res, next) => next() }
  });
  const app = express(); app.use(express.json()); app.use('/api/orders', routes.default);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const send = async (token, branch_id, department_id, expected) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/orders/production/print-log`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ date: '2026-11-04', branch_id, department_id })
      });
      assert.equal(res.status, expected); return res.json();
    };
    await send(null, 0, 0, 401);
    await send('2', 0, 0, 403);
    assert.equal((await send('1', 0, 0, 200)).success, true);
    assert.equal(targetLookups, 0, 'all-branch audit does not look up synthetic id zero');
    assert.equal(audit.length, 1);
    assert.deepEqual(plain(audit[0].slice(6, 10)), [0, 'ทุกสาขา', 0, 'ทุกแผนก']);
    await send('1', 999, 999, 404);
    await send('1', null, null, 404);
    await send('1', 0, 999, 404);
    assert.equal(audit.length, 1, 'invalid target creates no audit row');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('settings initialize schema once across concurrent calls, batch fresh reads, and preserve concurrent admin values', async () => {
  const data = new Map([['enabled', 'true'], ['provider', 'line']]);
  let creates = 0, metadata = 0, reads = 0, alters = 0;
  const model = await load('../src/models/settings.model.js', { '../config/database.js': { default: { query: async (sql, params) => {
    if (sql.includes('CREATE TABLE')) { creates++; return [[]]; }
    if (sql.startsWith('SHOW')) { metadata++; return [[{ Type: 'longtext' }]]; }
    if (sql.startsWith('ALTER')) { alters++; return [[]]; }
    if (sql.startsWith('SELECT')) {
      reads++; return [params[0].filter(key => data.has(key)).map(key => ({ setting_key: key, setting_value: data.get(key) }))];
    }
    if (sql.includes('VALUES ?')) {
      for (const [key, value] of params[0]) if (!data.has(key)) data.set(key, key === 'race' ? 'admin-write' : value);
      return [{ affectedRows: params[0].length }];
    }
    if (sql.includes('ON DUPLICATE KEY')) { data.set(params[0], params[1]); return [{ affectedRows: 1 }]; }
    assert.fail(sql);
  } } } });
  await Promise.all([model.getSetting('enabled'), model.getSetting('provider'), model.getSettings({ enabled: '', provider: '' })]);
  assert.equal(creates, 1); assert.equal(metadata, 1); assert.equal(alters, 0, 'wider existing text is not narrowed');
  const before = reads;
  assert.deepEqual(plain(await model.getSettings({ enabled: '', provider: '' })), { enabled: 'true', provider: 'line' });
  assert.equal(reads - before, 1);
  await model.setSetting('provider', 'discord');
  assert.equal(await model.getSetting('provider'), 'discord', 'settings values are not cached');
  assert.equal(await model.getSetting('race', 'default'), 'admin-write');
  assert.equal(creates, 1);
});

test('failed settings schema initialization is retried, without swallowing migration errors', async () => {
  let creates = 0, alters = 0;
  const model = await load('../src/models/settings.model.js', { '../config/database.js': { default: { query: async (sql) => {
    if (sql.includes('CREATE TABLE')) { creates++; return [[]]; }
    if (sql.startsWith('SHOW')) return [[{ Type: alters ? 'text' : 'varchar(255)' }]];
    if (sql.startsWith('ALTER')) { alters++; throw Error('temporary metadata failure'); }
    if (sql.startsWith('SELECT')) return [[{ setting_key: 'key', setting_value: 'saved' }]];
    assert.fail(sql);
  } } } });
  await assert.rejects(model.getSetting('key'), /temporary metadata failure/);
  assert.equal(await model.getSetting('key'), 'saved');
  assert.equal(creates, 2); assert.equal(alters, 1);
});

test('notification options batch provider settings freshly and retain disabled/group fallback behavior', async () => {
  const data = { line_notifications_enabled: 'true', notification_provider: 'discord',
    discord_webhook_url: 'https://fixture.invalid/main', discord_receiving_webhook_url: 'https://fixture.invalid/receiving' };
  let batches = 0;
  const options = await load('../src/services/order-notification-options.js', {
    '../models/settings.model.js': {
      getSetting: async (key, fallback) => data[key] ?? fallback,
      getSettings: async (defaults) => { batches++; return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, data[key] ?? fallback])); }
    }
  });
  const first = await options.getNotificationOptions();
  assert.equal(batches, 2); assert.equal(first.receivingWebhookUrl, data.discord_receiving_webhook_url);
  assert.equal(first.groups[0].accessTokens[0].token, data.discord_webhook_url);
  data.discord_webhook_url = 'https://fixture.invalid/changed';
  assert.equal((await options.getNotificationOptions()).webhookUrl, data.discord_webhook_url);
  data.line_notifications_enabled = 'false';
  const before = batches;
  assert.equal(await options.getNotificationOptions(), null); assert.equal(batches, before);
});

test('receiving metadata checks singleflight and retry after a failed metadata read', async () => {
  let checks = 0, fail = true;
  const model = await loadOrderModel({ query: async (sql, params) => {
    assert.ok(sql.startsWith('SHOW'));
    checks++;
    if (params?.[0] === 'received_quantity' && fail) { fail = false; throw Error('metadata unavailable'); }
    return [[{ Field: 'exists' }]];
  } });
  await assert.rejects(model.ensureOrderReceivingColumns(), /metadata unavailable/);
  await Promise.all([model.ensureOrderReceivingColumns(), model.ensureOrderReceivingColumns()]);
  const completed = checks;
  await model.ensureOrderReceivingColumns();
  assert.equal(checks, completed);
  assert.equal(completed, 9, 'two cached prerequisite checks, one failed read, six successful receiving checks');
});

test('background job ownership is opt-in; disabled/unowned processes do not initialize; duplicate starts share cleanup', async () => {
  const jobs = await load('../src/cron/background-jobs.js');
  assert.equal(jobs.shouldRunBackgroundJob('receiving_push', {}), true);
  for (const env of [{ BACKGROUND_JOBS_ENABLED: 'false' }, { RECEIVING_PUSH_JOB_ENABLED: 'false' },
    { BACKGROUND_JOBS_OWNER: 'worker' }, { BACKGROUND_JOBS_OWNER: 'worker', BACKGROUND_JOBS_INSTANCE_ID: 'web' }]) {
    assert.equal(jobs.shouldRunBackgroundJob('receiving_push', env), false);
    jobs.startBackgroundJob('receiving_push', () => assert.fail('disabled job initialized'), env);
  }
  let starts = 0, stops = 0;
  const initialize = () => { starts++; return () => { stops++; }; };
  const env = { BACKGROUND_JOBS_OWNER: 'worker', BACKGROUND_JOBS_INSTANCE_ID: 'worker' };
  const stop = jobs.startBackgroundJob('receiving_push', initialize, env);
  assert.equal(jobs.startBackgroundJob('receiving_push', initialize, env), stop);
  assert.equal(starts, 1); stop(); stop(); assert.equal(stops, 1);
  jobs.startBackgroundJob('receiving_push', initialize, env)(); assert.equal(starts, 2);
  assert.throws(() => jobs.startBackgroundJob('failure', () => { throw Error('start failed'); }), /start failed/);
  jobs.startBackgroundJob('failure', initialize)(); assert.equal(starts, 3);
});

test('push worker coalesces overlapping ticks and still discovers followups without configured FCM', async () => {
  let intervalTick, unblock, ensures = 0, discoveries = 0, issueDiscoveries = 0;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const dispatcher = await load('../src/services/receiving-push.js', {
    'node:crypto': { createHash },
    '../models/receiving-followups-store.js': { assertFollowupManager() {} },
    './receiving-ocr.service.js': { createReceivingError() {} }
  });
  const job = await load('../src/cron/receiving-push-job.js', {
    '../config/database.js': { default: { query: () => assert.fail('keyless push must not query devices') } },
    '../services/receiving-issues-followup.js': { discoverIssueFollowups: async () => { issueDiscoveries++; } },
    '../services/receiving-fcm.js': { createFcm: () => ({ configured: () => false }) },
    '../services/receiving-push.js': dispatcher,
    '../models/receiving-push-schema.js': { ensurePushTables: async () => { ensures++; await blocked; } },
    '../models/receiving-documents.model.js': { getExpectedItems: async () => { discoveries++; } }
  }, { setInterval: (fn) => { intervalTick = fn; return { unref() {} }; }, clearInterval() {} });
  const stop = job.initReceivingPushJob();
  await intervalTick(); assert.equal(ensures, 1);
  unblock(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(discoveries, 1); assert.equal(issueDiscoveries, 1);
  await intervalTick(); assert.equal(discoveries, 2); stop();
});

test('sales sync coalesces same-date overlapping attempts and returns a scheduler cleanup', async () => {
  const callbacks = [];
  let unblock, syncs = 0, saved = 0, stopped = 0;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const cron = await load('../src/cron/syncJob.js', {
    'node-cron': { default: { schedule: (_pattern, fn) => { callbacks.push(fn); return { stop: () => { stopped++; } }; } } },
    '../controllers/recipe.controller.js': { syncUsageToInventory: async (_req, res) => { syncs++; await blocked; res.json({ success: true }); } },
    '../models/settings.model.js': { getSetting: async () => '', setSetting: async () => { saved++; } }
  }, { console: { log() {}, error() {} } });
  const stop = cron.initSyncJob();
  const first = callbacks[0](), second = callbacks[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncs, 1); unblock(); await Promise.all([first, second]);
  assert.equal(saved, 1); stop(); assert.equal(stopped, 4);
});

test('sales sync success survives a failing status write and stores only a small summary', async () => {
  const callbacks = [], saved = [];
  let syncs = 0, failWrite = true;
  const bigResult = {
    success: true,
    data: {
      start: '2026-11-09', end: '2026-11-09', planned_deductions: 178, applied_deductions: 178, applied_quantity: 12.5,
      missing_recipes: Array.from({ length: 5000 }, (_, i) => ({ name: `เมนู ${i % 7}`, barcode: String(i), quantity: 1 })),
      unresolved_items: [{ product_id: 1 }], missing_conversions: [], missing_branch_mapping: []
    }
  };
  const cron = await load('../src/cron/syncJob.js', {
    'node-cron': { default: { schedule: (_pattern, fn) => { callbacks.push(fn); return { stop() {} }; } } },
    '../controllers/recipe.controller.js': { syncUsageToInventory: async (_req, res) => { syncs++; res.json(bigResult); } },
    '../models/settings.model.js': {
      getSetting: async () => '',
      setSetting: async (_key, value) => {
        if (failWrite) { failWrite = false; throw Error("Data too long for column 'setting_value'"); }
        saved.push(value);
      }
    }
  }, { console: { log() {}, error() {} } });
  const stop = cron.initSyncJob();
  await callbacks[0]();
  assert.equal(syncs, 1);
  assert.equal(saved.length, 0, 'failed write is swallowed, not turned into a retry');
  await callbacks[0]();
  const status = JSON.parse(saved[0]);
  assert.equal(status.state, 'success');
  assert.ok(saved[0].length < 2000, `status must stay small (${saved[0].length})`);
  assert.equal(status.last_result.missing_recipes_count, 5000);
  assert.equal(status.last_result.applied_deductions, 178);
  assert.ok(status.last_result.missing_recipe_samples.length <= 5);
  stop();
});

test('sales sync catch-up after midnight re-runs the previous day only after a 23:30 primary success', async () => {
  let clock = '2026-11-09T18:15:00Z';
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
  const callbacks = [], targets = [];
  let status = { state: 'success', source: 'primary', target_date: '2026-11-09' };
  const cron = await load('../src/cron/syncJob.js', {
    'node-cron': { default: { schedule: (_pattern, fn) => { callbacks.push(fn); return { stop() {} }; } } },
    '../controllers/recipe.controller.js': { syncUsageToInventory: async (req, res) => { targets.push(req.body.date); res.json({ success: true, data: {} }); } },
    '../models/settings.model.js': {
      getSetting: async () => JSON.stringify(status),
      setSetting: async (_key, value) => { status = JSON.parse(value); }
    }
  }, { Date: Clock, console: { log() {}, error() {} } });
  const stop = cron.initSyncJob();
  const catchUp = callbacks[3];
  await catchUp();
  assert.deepEqual(targets, ['2026-11-09']);
  assert.equal(status.source, 'catch-up');
  await catchUp();
  assert.deepEqual(targets, ['2026-11-09'], 'runs once per day');
  assert.equal(cron.shouldRunCatchUp({ state: 'pending', source: 'primary', target_date: '2026-11-09' }, '2026-11-09'), false);
  assert.equal(cron.shouldRunCatchUp({ state: 'success', source: 'primary', target_date: '2026-11-08' }, '2026-11-09'), false);
  stop();
});

test('overlapping final sales retry retains failed-window status without replaying the stock operation', async () => {
  let clock = '2026-11-04T16:30:00Z', unblock, syncs = 0, saved;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
  const callbacks = [], blocked = new Promise(resolve => { unblock = resolve; });
  const cron = await load('../src/cron/syncJob.js', {
    'node-cron': { default: { schedule: (_pattern, fn) => { callbacks.push(fn); return { stop() {} }; } } },
    '../controllers/recipe.controller.js': { syncUsageToInventory: async () => { syncs++; await blocked; throw Error('fixture failure'); } },
    '../models/settings.model.js': {
      getSetting: async () => JSON.stringify({ state: 'pending', target_date: '2026-11-04' }),
      setSetting: async (_key, value) => { saved = JSON.parse(value); }
    }
  }, { Date: Clock, console: { log() {}, error() {} } });
  const stop = cron.initSyncJob(), primary = callbacks[0]();
  await new Promise(resolve => setImmediate(resolve));
  clock = '2026-11-04T23:00:00Z';
  const final = callbacks[2]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(syncs, 1); unblock(); await Promise.all([primary, final]);
  assert.equal(saved.state, 'failed_window'); assert.equal(saved.source, 'retry-final');
  assert.equal(saved.next_retry_at, null); stop();
});

test('GP opt-in summaries paginate lightweight rows and global tab counts; legacy list and detail keep images', async () => {
  const header = { id: 7, pr_number: 'PR-20261104-001', status: 'pending_review', branch_name: 'KK', department_name: 'Kitchen', subtotal_amount: '125.50' };
  const imageItem = { id: 8, general_purchase_order_id: 7, item_name: 'Fixture item', item_image_data_url: 'data:image/png;base64,FIXTURE', requested_quantity: '2', estimated_price: '125.50' };
  const queries = [];
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (/^\s*(CREATE|ALTER)/.test(sql)) return [[]];
    if (sql.startsWith('SHOW')) return [[{ Field: 'exists' }]];
    if (sql.includes('GROUP BY status')) return [[{ status: 'pending_review', count: 35 }, { status: 'approved', count: 2 }]];
    if (sql.includes('COUNT(*) AS item_count')) {
      assert.ok(sql.includes('SUM(COALESCE(estimated_price, 0))'));
      assert.ok(sql.includes('SUM(COALESCE(actual_price, 0))'));
      return [[{ general_purchase_order_id: 7, item_count: 3, item_names: 'Fixture item · Second item', item_estimated_total: '150.25', item_actual_total: '0.00' }]];
    }
    if (sql.includes('FROM general_purchase_order_items')) return [[imageItem]];
    if (sql.includes('FROM general_purchase_order_logs')) return [[{ id: 1, action: 'create_pr' }]];
    if (sql.includes('FROM general_purchase_orders')) return [[header]];
    assert.fail(sql);
  };
  const model = await load('../src/models/general-purchase.model.js', {
    '../config/database.js': { default: { query, getConnection: async () => ({ query, release() {} }) } }
  });
  const result = await model.getGeneralPurchaseOrderSummaries({ status: 'pending_review', branch: 'KK', page: '2', pageSize: '30' });
  assert.deepEqual(plain(result.pagination), { page: 2, page_size: 30, total: 35, total_pages: 2 });
  assert.deepEqual(plain(result.stats), { total: 37, byStatus: { pending_review: 35, approved: 2 } });
  assert.equal(result.orders[0].itemSummary, 'Fixture item · Second item และอีก 1 รายการ');
  assert.equal(result.orders[0].itemCount, 3); assert.equal(result.orders[0].subtotalAmount, 125.5);
  assert.equal(result.orders[0].itemEstimatedTotal, 150.25, 'legacy item-sum display remains separate from stored header total');
  assert.equal(result.orders[0].itemActualTotal, 0, 'zero actual item amount never falls back to estimate/header');
  assert.deepEqual(plain(result.orders[0].items), []);
  assert.equal(JSON.stringify(result).includes('base64'), false);
  const summaryQuery = queries.find(({ sql }) => sql.includes('LIMIT ? OFFSET ?'));
  assert.deepEqual(plain(summaryQuery.params), ['KK', 'pending_review', 30, 30]);
  assert.ok(queries.find(({ sql }) => sql.includes('GROUP BY status')).sql.includes('branch_name = ?'));
  assert.equal(queries.some(({ sql }) => sql.includes('SELECT * FROM general_purchase_order_items')), false);
  assert.equal((await model.getGeneralPurchaseOrders())[0].items[0].imageDataUrl, imageItem.item_image_data_url);
  assert.equal((await model.getGeneralPurchaseOrderById(7)).items[0].imageDataUrl, imageItem.item_image_data_url);
  for (const filters of [{ page: '0' }, { page: 'NaN' }, { pageSize: '101' }, { pageSize: '1.5' }]) {
    await assert.rejects(model.getGeneralPurchaseOrderSummaries(filters), error => error.statusCode === 400);
  }
});

async function gpIssueFixture({ duplicates = 0, failure = null, status = 'approved' } = {}) {
  const events = [];
  let attempts = 0, commits = 0, audits = 0;
  const header = { id: 7, status, pr_number: 'PR-SIM-7' };
  const duplicate = () => Object.assign(new Error("Duplicate entry for key 'general_purchase_orders.po_number'"), { code: 'ER_DUP_ENTRY' });
  const pool = {
    query: async (sql) => {
      if (sql.includes('FROM general_purchase_orders')) return [[header]];
      if (sql.includes('FROM general_purchase_order_items') || sql.includes('FROM general_purchase_order_logs')) return [[]];
      assert.fail(sql);
    },
    getConnection: async () => {
      let attempt = 0, proposed;
      return {
        beginTransaction: async () => { attempt = ++attempts; events.push(`begin:${attempt}`); },
        commit: async () => { commits++; Object.assign(header, { status: 'awaiting_receipt', po_number: proposed }); events.push(`commit:${attempt}`); },
        rollback: async () => { events.push(`rollback:${attempt}`); },
        release: () => { if (attempt) events.push(`release:${attempt}`); },
        query: async (sql, params) => {
          if (/^\s*(CREATE|ALTER)/.test(sql)) return [[]];
          if (sql.startsWith('SHOW')) return [[{ Field: 'exists' }]];
          if (sql.includes('FOR UPDATE')) return [[header]];
          if (sql.includes('SUBSTRING_INDEX(po_number')) {
            assert.ok(sql.includes('MAX('));
            assert.ok(sql.includes('po_number LIKE ? AND po_number REGEXP ?'));
            assert.equal(sql.includes('WHERE po_date'), false, 'number uniqueness follows its embedded prefix, not editable PO date');
            assert.deepEqual(plain(params), ['GPO-20261105-%', '^GPO-20261105-[0-9]+$']);
            return [[{ cnt: 2 + attempt }]];
          }
          if (sql.includes('UPDATE general_purchase_orders')) {
            events.push(`write:${attempt}`);
            if (attempt <= duplicates) throw duplicate();
            if (failure) throw failure;
            proposed = params[0]; return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO general_purchase_order_logs')) { audits++; return [{ insertId: 1 }]; }
          assert.fail(sql);
        }
      };
    }
  };
  const model = await load('../src/models/general-purchase.model.js', { '../config/database.js': { default: pool } });
  return { model, events, counts: () => ({ attempts, commits, audits }), header };
}

test('automatic GP number conflict rolls back and releases before retry; successful approval transition/audit commit once', async () => {
  const fixture = await gpIssueFixture({ duplicates: 1 });
  const issued = await fixture.model.issueGeneralPurchasePO({ id: 7, poNumber: '', poDate: '2026-11-05', vendorName: 'Synthetic' });
  assert.equal(issued.poNumber, 'GPO-20261105-005');
  assert.deepEqual(fixture.counts(), { attempts: 2, commits: 1, audits: 1 });
  assert.ok(fixture.events.indexOf('rollback:1') < fixture.events.indexOf('release:1'));
  assert.ok(fixture.events.indexOf('release:1') < fixture.events.indexOf('begin:2'));
});

test('manual duplicate GP number returns 409 without retry or renumbering; same-PR state conflict stays 409', async () => {
  const duplicate = await gpIssueFixture({ duplicates: 1 });
  await assert.rejects(duplicate.model.issueGeneralPurchasePO({ id: 7, poNumber: 'MANUAL-003', poDate: '2026-11-05', vendorName: 'Synthetic' }),
    error => error.statusCode === 409 && error.message === 'PO number already exists');
  assert.deepEqual(duplicate.counts(), { attempts: 1, commits: 0, audits: 0 });
  assert.equal(duplicate.header.status, 'approved');
  const conflict = await gpIssueFixture({ status: 'awaiting_receipt' });
  await assert.rejects(conflict.model.issueGeneralPurchasePO({ id: 7, poDate: '2026-11-05', vendorName: 'Synthetic' }), error => error.statusCode === 409);
  assert.deepEqual(conflict.counts(), { attempts: 1, commits: 0, audits: 0 });
});

test('automatic GP allocation retry is bounded and unrelated write failures are never replayed', async () => {
  const exhausted = await gpIssueFixture({ duplicates: 100 });
  await assert.rejects(exhausted.model.issueGeneralPurchasePO({ id: 7, poDate: '2026-11-05', vendorName: 'Synthetic' }), error => error.statusCode === 409);
  assert.deepEqual(exhausted.counts(), { attempts: 8, commits: 0, audits: 0 });
  assert.equal(exhausted.events.filter(value => value.startsWith('release:')).length, 8);
  const failure = Object.assign(new Error('unrelated database failure'), { code: 'ER_ACCESS_DENIED_ERROR' });
  const fixture = await gpIssueFixture({ failure });
  await assert.rejects(fixture.model.issueGeneralPurchasePO({ id: 7, poDate: '2026-11-05', vendorName: 'Synthetic' }), error => error === failure);
  assert.deepEqual(fixture.counts(), { attempts: 1, commits: 0, audits: 0 });
});
