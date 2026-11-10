import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as work from '../src/utils/sales-report-work.js';

test('sales report validates real bounded dates, branch/limit/search before expensive reads', () => {
  const base = { start: '2026-11-04' };
  for (const change of [
    { start: '2026-02-30' }, { end: '2026-11-03' }, { end: '2028-01-01' },
    { branch_id: '-1' }, { branch_id: 'NaN' }, { limit: 'NaN' }, { limit: '-2' },
    { limit: '1.5' }, { search: 'x'.repeat(201) }, { search: ['a', 'b'] }
  ]) assert.throws(() => work.parseSalesReportFilters({ ...base, ...change }), { statusCode: 400 });
  assert.equal(work.parseSalesReportFilters({ start: '2024-01-01', end: '2024-12-31', limit: '2000' }).limit, 1000);
  assert.equal(work.parseSalesReportFilters({}, new Date('2026-11-03T18:00:00Z')).start, '2026-11-04');
});

test('identical concurrent reads share work, sequential financial reads stay fresh, errors retry', async () => {
  let reads = 0, fail = false;
  const run = work.createSalesQueryRunner(async () => {
    reads++;
    await new Promise(setImmediate);
    if (fail) throw new Error('fixture failure');
    return [{ amount: reads }];
  });
  const [a, b] = await Promise.all([run('sales-A'), run('sales-A')]);
  assert.deepEqual(a, b); assert.equal(reads, 1);
  assert.deepEqual(await run('sales-A'), [{ amount: 2 }]);
  await run('sales-B'); assert.equal(reads, 3);
  fail = true; await assert.rejects(run('sales-A'), /fixture failure/);
  fail = false; await run('sales-A'); assert.equal(reads, 5);
});

test('only group availability has a short bounded metadata TTL, including empty groups', async () => {
  let now = 0, reads = 0;
  const run = work.createSalesQueryRunner(async () => { reads++; return [{ cnt: 0 }]; }, { now: () => now, metadataTtlMs: 60 });
  await run('groups', { groupMetadata: true });
  await run('groups', { groupMetadata: true }); assert.equal(reads, 1);
  now = 60; await run('groups', { groupMetadata: true }); assert.equal(reads, 2);
  await run('other-groups', { groupMetadata: true }); assert.equal(reads, 3);
});

async function controller(query) {
  const context = vm.createContext({ process: { env: {} }, console });
  const mod = new vm.SourceTextModule(await readFile(new URL('../src/controllers/reports.controller.js', import.meta.url), 'utf8'), { context });
  const deps = {
    '../models/branch.model.js': { getBranchById: async (id) => ({ clickhouse_branch_id: `branch-${id}` }) },
    '../services/clickhouse.service.js': { queryClickHouse: query },
    '../utils/sales-report-work.js': work
  };
  await mod.link((name) => {
    assert.ok(deps[name], name);
    return new vm.SyntheticModule(Object.keys(deps[name]), function () {
      for (const [key, value] of Object.entries(deps[name])) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate(); return mod.namespace.getSalesReport;
}
async function controllerModule() {
  const context = vm.createContext({ process: { env: {} }, console });
  const mod = new vm.SourceTextModule(await readFile(new URL('../src/controllers/reports.controller.js', import.meta.url), 'utf8'), { context });
  const deps = {
    '../models/branch.model.js': { getBranchById: async () => null },
    '../services/clickhouse.service.js': { queryClickHouse: async () => [] },
    '../utils/sales-report-work.js': work
  };
  await mod.link((name) => new vm.SyntheticModule(Object.keys(deps[name]), function () {
    for (const [key, value] of Object.entries(deps[name])) this.setExport(key, value);
  }, { context }));
  await mod.evaluate(); return mod.namespace;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('actual controller reuses Pareto rows, coalesces requests, and preserves fresh branch-scoped report data', async () => {
  const queries = [], menus = [{ barcode: 'a', total_revenue: 300 }, { barcode: 'b', total_revenue: 200 }, { barcode: 'c', total_revenue: 100 }];
  const handler = await controller(async (sql) => {
    queries.push(sql); await new Promise(setImmediate);
    if (sql.includes('count() as cnt')) return [{ cnt: 1 }];
    if (sql.includes('LIMIT 2000')) return menus;
    return [];
  });
  const req = { query: { start: '2026-11-04', end: '2026-11-04', branch_id: '1', limit: '2' } };
  const a = response(), b = response();
  await Promise.all([handler(req, a, (e) => { throw e; }), handler(req, b, (e) => { throw e; })]);
  assert.equal(queries.length, 12, 'one metadata + eleven data queries for two identical simultaneous reports');
  assert.deepEqual(a.body.data.items, menus.slice(0, 2));
  assert.deepEqual(a.body.data.pareto_items, menus);
  assert.equal(a.body.data.prev_start, '2026-11-03');
  assert.equal(a.body.data.prev_end, '2026-11-03');
  assert.equal(queries.filter((sql) => sql.includes('LIMIT 2000')).length, 2, 'current Pareto + full previous-period menus');
  await handler(req, response(), (e) => { throw e; });
  assert.equal(queries.length, 23, 'fresh financial reads; only group metadata cached');
  await handler({ query: { ...req.query, branch_id: '2' } }, response(), (e) => { throw e; });
  assert.equal(queries.length, 34);
  assert.ok(queries.slice(23).every((sql) => sql.includes("coalesce(nullIf(d.guidbranch, ''), nullIf(d.branchid, ''), '') = 'branch-2'")));
});

test('invalid requests never query ClickHouse and failed reads never become an empty success', async () => {
  let reads = 0;
  const handler = await controller(async () => { reads++; throw new Error('fixture unavailable'); });
  let failure;
  await handler({ query: { start: '2026-99-99' } }, response(), (e) => { failure = e; });
  assert.equal(failure.statusCode, 400); assert.equal(reads, 0);
  const res = response();
  await handler({ query: { start: '2026-11-04' } }, res, (e) => { failure = e; });
  assert.match(failure.message, /fixture unavailable/); assert.equal(res.body, undefined);
});

const sqlFixture = async (overrides = {}) => (await controllerModule()).buildSalesReportSql({
  shopId: 'shop-1', start: '2026-10-01', end: '2026-10-31', prevStart: '2026-08-31', prevEnd: '2026-09-30',
  lastYearStart: '2025-10-01', lastYearEnd: '2025-10-31', clickhouseBranchId: null, search: '', limit: 200, ...overrides
});

test('POS server already runs Asia/Bangkok: every date/hour/weekday uses toTimeZone, never addHours (10 Nov 2026)', async () => {
  const sql = await sqlFixture();
  for (const [name, text] of Object.entries(sql)) assert.doesNotMatch(text, /addHours/, `${name} must not shift +7h again`);
  for (const name of ['summary', 'daily', 'branch', 'hourly', 'billDist', 'prevSummary', 'lastYearSummary', 'weekday', 'pareto', 'group', 'prevItems']) {
    assert.match(sql[name], /toDate\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) BETWEEN/, name);
  }
  assert.match(sql.hourly, /toHour\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\)/);
  assert.match(sql.weekday, /toDayOfWeek\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\)/);
});

test('bill totals come from doc FINAL headers only, like the POS app and cashflow', async () => {
  const sql = await sqlFixture();
  for (const name of ['daily', 'branch', 'hourly', 'billDist', 'prevSummary', 'lastYearSummary', 'weekday']) {
    assert.match(sql[name], /FROM doc AS d FINAL/, name);
    assert.doesNotMatch(sql[name], /docdetail/, `${name} must not drop or multiply bills through line joins`);
    assert.match(sql[name], /d\.transflag = 44/); assert.match(sql[name], /d\.iscancel = 0/);
  }
  assert.match(sql.summary, /SELECT sum\(d\.totalamount\) FROM doc AS d FINAL/);
});

test('menu lines are de-duplicated, ungrouped menus stay visible, search stays escaped', async () => {
  const sql = await sqlFixture({ search: "ต้ม' OR 1=1 \\" });
  for (const name of ['pareto', 'group', 'prevItems']) {
    assert.match(sql[name], /SELECT DISTINCT\s+shopid, docno, line_number/, name);
    assert.match(sql[name], /productbarcode FINAL/, name);
    assert.ok(sql[name].includes("ต้ม'' OR 1=1 \\\\"), `${name} escapes search`);
  }
  assert.match(sql.pareto, /'ยังไม่จัดกลุ่ม'\) as group_name/);
  assert.match(sql.group, /GROUP BY group_name/);
  assert.doesNotMatch(sql.group, /length\(pb\.groupnames\) > 0/);
  assert.match(sql.prevItems, /LIMIT 2000/);
});
