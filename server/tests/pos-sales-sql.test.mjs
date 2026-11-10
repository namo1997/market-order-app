import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as posSalesSql from '../src/utils/pos-sales-sql.js';
import * as stockLedger from '../src/utils/stock-ledger.js';
import * as bangkokDate from '../src/utils/bangkok-date.js';
import * as unitRules from '../src/utils/unit-rules.js';

const {
  buildEmployeeOrderSalesSql, buildPosBillCountSql, buildPosDailyByBranchSql, buildPosLineSalesSql,
  buildPosSalesBreakdownSql, buildRecipeSaleLinesSql, escapeClickHouse, previousClockRecipeSaleReferenceId,
  recipeSaleReferenceId, shiftLocalText
} = posSalesSql;
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// ตรวจกับข้อมูลจริง 10 พ.ย. 69: ยอดรายวันใหม่ตรงแอป POS 31/31 วัน ทั้งคันคลอง สันกำแพง และรวม
test('every remaining POS sales query reads the Thai day directly, never addHours (10 Nov 2026)', async () => {
  for (const file of [
    '../src/controllers/discord.controller.js',
    '../src/controllers/ai.controller.js',
    '../src/controllers/line-chatbot.controller.js',
    '../src/controllers/inventory.controller.js',
    '../src/controllers/recipe.controller.js',
    '../src/routes/hrms-sales.routes.js'
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /addHours\(/, `${file} must not shift POS time by +7h again`);
    assert.match(source, /from '\.\.\/utils\/pos-sales-sql\.js'/, `${file} must use the shared POS SQL`);
    assert.doesNotMatch(source, /FROM doc d\b/, `${file} must read doc with FINAL`);
  }
  // Discord เดิมอ่าน doci / icitem ซึ่งไม่มีใน dedebi ทำให้คำสั่งยอดขายพังทั้งคำสั่ง
  assert.doesNotMatch(await read('../src/controllers/discord.controller.js'), /FROM doci\b|JOIN icitem\b/);
});

test('bill-level SQL uses doc FINAL, Bangkok dates, both branch fields and no docdetail join', () => {
  const daily = buildPosDailyByBranchSql({ shopId: 'shop', start: '2026-10-01', end: '2026-10-31', branchId: 'SK' });
  assert.match(daily, /FROM doc AS d FINAL/);
  assert.match(daily, /toDate\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) BETWEEN toDate\('2026-10-01'\) AND toDate\('2026-10-31'\)/);
  assert.match(daily, /AND coalesce\(nullIf\(d\.guidbranch, ''\), nullIf\(d\.branchid, ''\), ''\) = 'SK'/);
  assert.match(daily, /coalesce\(nullIf\(d\.guidbranch, ''\), nullIf\(d\.branchid, ''\), ''\) AS clickhouse_branch_id/);
  assert.match(daily, /AND d\.transflag = 44\s+AND d\.iscancel = 0/);
  assert.doesNotMatch(daily, /docdetail/);
  assert.doesNotMatch(buildPosDailyByBranchSql({ shopId: 'shop', start: '2026-10-01' }), /guidbranch, ''\), nullIf\(d\.branchid, ''\), ''\) =/);
  assert.match(buildPosBillCountSql({ shopId: 'shop', date: '2026-10-31', branchId: 'SK' }), /BETWEEN toDate\('2026-10-31'\) AND toDate\('2026-10-31'\)/);

  const keys = {
    hourly: /toHour\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) AS sale_key/,
    weekday: /toDayOfWeek\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) AS sale_key/,
    daily: /toDate\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) AS sale_key/,
    unknown: /toDate\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\)\) AS sale_key/
  };
  for (const [grain, pattern] of Object.entries(keys)) {
    const sql = buildPosSalesBreakdownSql({ shopId: 'shop', start: '2026-10-01', end: '2026-10-31', grain });
    assert.match(sql, pattern, grain);
    assert.doesNotMatch(sql, /docdetail/, `${grain} must count every paid bill, even one without lines`);
  }
});

test('line-level SQL de-duplicates docdetail, keeps cancelled bills out and escapes user search text', () => {
  const sql = buildPosLineSalesSql({
    shopId: "sh'op", start: '2026-10-31', branchId: 'SK',
    select: 'dd.barcode AS barcode, sum(dd.qty) AS qty',
    where: `positionCaseInsensitive(dd.itemname, '${escapeClickHouse("a\\' OR 1=1 --")}') > 0`,
    groupBy: 'dd.barcode', orderBy: 'qty DESC', limit: 20
  });
  assert.match(sql, /JOIN \(SELECT DISTINCT\s+shopid, docno, line_number/);
  assert.match(sql, /FROM docdetail\s+WHERE shopid = 'sh''op'\s+AND transflag = 44\)/);
  assert.match(sql, /AND d\.iscancel = 0/);
  assert.match(sql, /'a\\\\'' OR 1=1 --'\) > 0/, 'backslash and quote must both be escaped');
  assert.match(sql, /GROUP BY dd\.barcode\s+ORDER BY qty DESC\s+LIMIT 20/);
  assert.doesNotMatch(buildPosLineSalesSql({ shopId: 's', start: '2026-10-31', select: 'count()', groupBy: 'dd.barcode', limit: 0 }), /LIMIT/);
});

test('recipe sync reads real UTC for created_at (old value was the Thai clock, 7 h late)', () => {
  const sql = buildRecipeSaleLinesSql({ shopId: 'shop', start: '2026-11-09', branchId: 'SK' });
  assert.match(sql, /formatDateTime\(toTimeZone\(d\.docdatetime, 'Asia\/Bangkok'\), '%F %T'\) AS sale_datetime_local/);
  assert.match(sql, /formatDateTime\(d\.docdatetime, '%F %T', 'UTC'\) AS sale_datetime_utc/);
  assert.match(sql, /AND d\.iscancel = 0/);
  assert.match(sql, /GROUP BY sale_date, sale_datetime_local, sale_datetime_utc, sale_doc_no, clickhouse_branch_id, dd\.barcode/);
});

test('previous-clock reference ids reproduce what Production stored before the fix', () => {
  // Production เก็บบิล HL12611090038 (POS 16:42:28 ไทย) เป็นเวลา 23:42:28 วันที่ 2026-11-09
  const base = { branchId: 3, departmentId: 7, productId: 10, docNo: 'HL12611090038' };
  assert.equal(recipeSaleReferenceId({ ...base, saleDate: '2026-11-09', saleLocal: '2026-11-09 16:42:28' }),
    'recipe-sale-bill:2026-11-09:20261109164228:branch3:dept7:product10:docHL12611090038');
  assert.equal(previousClockRecipeSaleReferenceId({ ...base, saleDate: '2026-11-09', saleLocal: '2026-11-09 16:42:28' }),
    'recipe-sale-bill:2026-11-09:20261109234228:branch3:dept7:product10:docHL12611090038');
  // บิลหลัง 17:00 ระบบเดิมย้ายไปวันถัดไป
  assert.equal(previousClockRecipeSaleReferenceId({ ...base, saleDate: '2026-10-31', saleLocal: '2026-10-31 18:05:00' }),
    'recipe-sale-bill:2026-11-01:20261101010500:branch3:dept7:product10:docHL12611090038');
  assert.equal(shiftLocalText('2024-02-28 20:00:00', 7), '2024-02-29 03:00:00');
  assert.equal(previousClockRecipeSaleReferenceId({ ...base, saleDate: '2026-11-09', saleLocal: '' }), null);
});

async function recipeController({ saleLines, storedReferences }) {
  const context = vm.createContext({ console, process: { env: {} } });
  const mod = new vm.SourceTextModule(await read('../src/controllers/recipe.controller.js'), { context });
  const inserts = [];
  const lookups = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params = []) => {
      if (/SELECT reference_id/.test(sql)) {
        lookups.push(params);
        return [params.filter((id) => storedReferences.includes(id)).map((reference_id) => ({ reference_id }))];
      }
      if (/INSERT INTO inventory_transactions/.test(sql)) { inserts.push(params); return [{ insertId: inserts.length }]; }
      return [[]];
    }
  };
  const pool = {
    getConnection: async () => connection,
    query: async (sql) => {
      if (/FROM products/.test(sql)) return [[{ id: 10, name: 'หมูสับ', product_group_id: 1 }]];
      if (/stock_check/.test(sql)) return [[{ product_id: 10, branch_id: 3, department_id: 7 }]];
      return [[]];
    }
  };
  const deps = {
    '../models/recipe.model.js': { getRecipesByBarcodes: async () => [{ menu_barcode: 'M1', item_id: 1, product_id: 10, product_name: 'หมูสับ', quantity: 0.1, unit_id: 2, product_unit_id: 2, unit_abbr: 'kg' }] },
    '../models/branch.model.js': { getAllBranches: async () => [{ id: 3, clickhouse_branch_id: 'SK' }], getBranchById: async () => ({ id: 3, clickhouse_branch_id: 'SK' }) },
    '../models/unit-conversion.model.js': { getConversionsRaw: async () => [] },
    '../models/supplier.model.js': { ensureInternalOrderScopeTable: async () => {} },
    '../models/inventory.model.js': { ensureInventoryTables: async () => {}, recalculateLedgerForPairs: async () => {} },
    '../utils/stock-ledger.js': stockLedger,
    '../utils/bangkok-date.js': bangkokDate,
    '../config/database.js': { default: pool },
    '../utils/unit-rules.js': unitRules,
    '../services/clickhouse.service.js': { queryClickHouse: async () => saleLines },
    '../utils/pos-sales-sql.js': posSalesSql
  };
  await mod.link((specifier) => {
    assert.ok(Object.hasOwn(deps, specifier), `Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(deps[specifier]), function () {
      for (const [key, value] of Object.entries(deps[specifier])) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  const run = async (body) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await mod.namespace.syncUsageToInventory({ body, query: {}, user: { id: 1 } }, res, (error) => { throw error; });
    return res;
  };
  return { run, inserts, lookups };
}

test('recipe sync never deducts a bill twice across the clock fix and stamps the real UTC time', async () => {
  const line = (doc, local, utc) => ({ sale_date: '2026-11-09', sale_datetime_local: local, sale_datetime_utc: utc, sale_doc_no: doc,
    clickhouse_branch_id: 'SK', barcode: 'M1', menu_name: 'กะเพรา', total_qty: 2 });
  const alreadyDeductedByOldCode = 'recipe-sale-bill:2026-11-09:20261109234228:branch3:dept7:product10:docHL1';
  const harness = await recipeController({
    saleLines: [line('HL1', '2026-11-09 16:42:28', '2026-11-09 09:42:28'), line('HL2', '2026-11-09 18:30:00', '2026-11-09 11:30:00')],
    storedReferences: [alreadyDeductedByOldCode]
  });
  const res = await harness.run({ start: '2026-11-09', end: '2026-11-09', dry_run: false });
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.skipped_existing, 1);
  assert.equal(res.body.data.skipped_previous_clock, 1);
  assert.equal(res.body.data.applied_deductions, 1);
  assert.ok(harness.lookups.flat().includes(alreadyDeductedByOldCode), 'the old-format id must be looked up');
  assert.equal(harness.inserts.length, 1);
  const [productId, departmentId, quantity, , , referenceId, notes, , createdAt] = harness.inserts[0];
  assert.deepEqual([productId, departmentId, quantity], [10, 7, -0.2]);
  assert.equal(referenceId, 'recipe-sale-bill:2026-11-09:20261109183000:branch3:dept7:product10:docHL2');
  assert.equal(createdAt, '2026-11-09 11:30:00');
  assert.match(notes, /เวลา 2026-11-09 18:30:00/);

  // รันซ้ำหลังบันทึกรหัสใหม่แล้ว ต้องไม่ตัดเพิ่ม
  const again = await recipeController({
    saleLines: [line('HL2', '2026-11-09 18:30:00', '2026-11-09 11:30:00')],
    storedReferences: [referenceId]
  });
  const second = await again.run({ start: '2026-11-09', end: '2026-11-09', dry_run: false });
  assert.equal(second.body.data.applied_deductions, 0);
  assert.equal(again.inserts.length, 0);
});

test('HRMS employee sales: orderdatetime holds the UTC clock, so bounds and labels convert explicitly', () => {
  const sql = buildEmployeeOrderSalesSql({
    shopId: 'shop', branchId: 'SK', employeeCodes: ['E1', "E'2"],
    from: '2026-11-09T05:00:00.000Z', to: '2026-11-09T09:00:00.000Z'
  });
  assert.doesNotMatch(sql, /addHours/);
  assert.match(sql, /orderdatetime >= toDateTime\(formatDateTime\(parseDateTimeBestEffort\('2026-11-09T05:00:00\.000Z'\), '%F %T', 'UTC'\)\)/);
  assert.match(sql, /orderdatetime < toDateTime\(formatDateTime\(parseDateTimeBestEffort\('2026-11-09T09:00:00\.000Z'\), '%F %T', 'UTC'\)\)/);
  assert.match(sql, /formatDateTime\(toStartOfHour\(toTimeZone\(toDateTime\(toString\(orderdatetime\), 'UTC'\), 'Asia\/Bangkok'\)\), '%Y-%m-%d %H:00:00'\) AS sale_hour/);
  assert.match(sql, /formatDateTime\(max\(toTimeZone\(toDateTime\(toString\(orderdatetime\), 'UTC'\), 'Asia\/Bangkok'\)\), '%F %T'\) AS latest_order_at/);
  assert.match(sql, /IN \('E1', 'E''2'\)/);
});

test('live stock estimate recognises recipe deductions already synced today', async () => {
  const source = await read('../src/controllers/inventory.controller.js');
  // รายการตัดตามสูตรบันทึกเป็น transaction_type='sale' + reference_type='recipe_sale'
  assert.doesNotMatch(source, /transaction_type = 'recipe_sale'/);
  assert.match(source, /AND reference_type = 'recipe_sale'\s+AND \$\{todayRange\.sql\}/);
});
