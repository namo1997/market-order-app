// บั๊ก INV-11: สถานะตัดสต็อกขายอัตโนมัติ (system_settings.sales_sync_retry_status) เกิน TEXT 64KB
// ทำให้ซิงค์ที่สำเร็จแล้วถูกนับว่าล้ม → retry ทั้งคืนและขึ้น failed_window ทุกเช้า
// เทสต์นี้ไม่ใช้ DB จริง: โหลด syncJob.js ผ่าน vm แล้วใส่ cron/controller/settings ปลอม
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const MYSQL_TEXT_LIMIT = 65535;

async function loadSyncJob({ syncUsageToInventory, getSetting, setSetting, now }) {
  let clock = now;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
  const logs = [], errors = [];
  const context = vm.createContext({
    console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    process: { env: {} }, Date: Clock
  });
  const source = await readFile(new URL('../src/cron/syncJob.js', import.meta.url), 'utf8');
  const mod = new vm.SourceTextModule(source, { context });
  const callbacks = [];
  const deps = {
    'node-cron': { default: { schedule: (_pattern, fn) => { callbacks.push(fn); return { stop() {} }; } } },
    '../controllers/recipe.controller.js': { syncUsageToInventory },
    '../models/settings.model.js': { getSetting, setSetting }
  };
  await mod.link((specifier) => {
    assert.ok(Object.hasOwn(deps, specifier), `Unexpected dependency: ${specifier}`);
    const exports = deps[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await mod.evaluate();
  const stop = mod.namespace.initSyncJob();
  return {
    job: mod.namespace, stop, logs, errors,
    primary: () => callbacks[0](), retry: () => callbacks[1](), final: () => callbacks[2](),
    setClock: (value) => { clock = value; }
  };
}

// จำลองคอลัมน์ TEXT ของ MySQL: ค่าเกิน 64KB → ER_DATA_TOO_LONG
const textColumn = () => {
  const store = { value: '', writes: [] };
  store.setSetting = async (_key, value) => {
    if (Buffer.byteLength(String(value), 'utf8') > MYSQL_TEXT_LIMIT) {
      throw Object.assign(new Error("Data too long for column 'setting_value' at row 1"), { code: 'ER_DATA_TOO_LONG' });
    }
    store.value = value;
    store.writes.push(JSON.parse(value));
  };
  store.getSetting = async () => store.value;
  return store;
};

const oversizedResult = () => ({
  success: true,
  data: {
    start: '2026-11-13', end: '2026-11-13', branch_id: null, dry_run: false,
    planned_deductions: 420, planned_quantity: 33.5, applied_deductions: 410, applied_quantity: 31.25,
    skipped_existing: 10, skipped_legacy_daily: 0,
    unresolved_items: Array.from({ length: 800 }, (_, i) => ({ product_id: i, reason: 'ไม่มีหน่วยแปลง'.repeat(3) })),
    missing_recipes: Array.from({ length: 4000 }, (_, i) => ({
      sale_date: '2026-11-13', sale_doc_no: `POS-${i}`, branch_id: 1, barcode: String(100000 + i),
      name: `เมนูที่ยังไม่มีสูตร ${i % 9} ${'ยาว'.repeat(40)}`, quantity: 1
    })),
    missing_conversions: Array.from({ length: 50 }, (_, i) => ({ product_id: i })),
    missing_branch_mapping: [{ clickhouse_branch: 'X' }]
  }
});

test('INV-11: ผลซิงค์ขนาดใหญ่ถูกสรุปก่อนเก็บ สถานะเล็กกว่า TEXT 64KB มากและเป็น success', async () => {
  const column = textColumn();
  let syncs = 0;
  const big = oversizedResult();
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > MYSQL_TEXT_LIMIT, 'fixture ต้องใหญ่เกิน 64KB จริง');
  const cron = await loadSyncJob({
    now: '2026-11-13T16:30:00Z',
    syncUsageToInventory: async (_req, res) => { syncs++; res.json(big); },
    getSetting: column.getSetting, setSetting: column.setSetting
  });
  await cron.primary();
  assert.equal(syncs, 1);
  assert.equal(column.writes.length, 1);
  const bytes = Buffer.byteLength(column.value, 'utf8');
  assert.ok(bytes < 4096, `status must stay small (${bytes} bytes)`);
  const status = column.writes[0];
  assert.equal(status.state, 'success');
  assert.equal(status.target_date, '2026-11-13');
  assert.equal(status.source, 'primary');
  assert.equal(status.failure_count, 0);
  assert.equal(status.next_retry_at, null);
  assert.equal(status.last_error, null);
  assert.deepEqual(
    { ...status.last_result, missing_recipe_samples: undefined },
    {
      start: '2026-11-13', end: '2026-11-13', planned_deductions: 420, applied_deductions: 410, applied_quantity: 31.25,
      skipped_existing: 10, skipped_legacy_daily: 0, unresolved_count: 800, missing_recipes_count: 4000,
      missing_recipe_samples: undefined, missing_conversions_count: 50, missing_branch_mapping_count: 1
    }
  );
  assert.ok(status.last_result.missing_recipe_samples.length <= 5);
  for (const name of status.last_result.missing_recipe_samples) assert.ok(name.length <= 60);
  assert.equal(cron.errors.length, 0);

  // รอบ retry หลังเที่ยงคืนต้องไม่ซิงค์ซ้ำเพราะสถานะเป็น success
  cron.setClock('2026-11-13T17:30:00Z');
  await cron.retry();
  cron.setClock('2026-11-13T23:00:00Z');
  await cron.final();
  assert.equal(syncs, 1, 'no retries after a successful sync');
  cron.stop();
});

test('INV-11: summarizeSyncResult รับค่าแปลก ๆ ได้และไม่โยน error', async () => {
  const cron = await loadSyncJob({
    now: '2026-11-13T16:30:00Z', syncUsageToInventory: async () => {}, getSetting: async () => '', setSetting: async () => {}
  });
  const empty = cron.job.summarizeSyncResult(undefined);
  assert.equal(empty.planned_deductions, 0);
  assert.equal(empty.missing_recipes_count, 0);
  assert.deepEqual(Array.from(empty.missing_recipe_samples), []);
  const flat = cron.job.summarizeSyncResult({ applied_deductions: '7', missing_recipes: [{ menu_name: 'ก' }, { menu_name: 'ก' }, {}] });
  assert.equal(flat.applied_deductions, 7);
  assert.equal(flat.missing_recipes_count, 3);
  assert.deepEqual(Array.from(flat.missing_recipe_samples), ['ก']);
  cron.stop();
});

test('INV-11: ซิงค์สำเร็จแต่เขียนสถานะสรุปไม่ได้ → บันทึกสถานะ success แบบสั้น ไม่เป็น pending และไม่ retry', async () => {
  const written = [];
  let syncs = 0, attempts = 0;
  const cron = await loadSyncJob({
    now: '2026-11-13T16:30:00Z',
    syncUsageToInventory: async (_req, res) => { syncs++; res.json({ success: true, data: { applied_deductions: 3 } }); },
    getSetting: async () => (written.length ? JSON.stringify(written.at(-1)) : ''),
    setSetting: async (_key, value) => {
      attempts++;
      if (attempts === 1) throw new Error('Lost connection to MySQL server during query');
      written.push(JSON.parse(value));
    }
  });
  await cron.primary();
  assert.equal(syncs, 1);
  assert.equal(attempts, 2, 'retried once with a minimal status');
  assert.equal(written.length, 1);
  assert.equal(written[0].state, 'success');
  assert.equal(written[0].last_result, null);
  assert.equal(written[0].failure_count, 0);
  assert.ok(cron.errors.some((line) => line.includes('status write failed')), 'write failure is logged');
  assert.ok(!cron.errors.some((line) => line.includes('Sales sync failed')), 'sync is not reported as failed');
  cron.setClock('2026-11-13T17:30:00Z');
  await cron.retry();
  assert.equal(syncs, 1);
  cron.stop();
});

test('INV-11: ซิงค์สำเร็จแต่เขียนสถานะไม่ได้เลย → ยังถือว่าสำเร็จ ไม่บันทึก pending', async () => {
  let syncs = 0, attempts = 0;
  const cron = await loadSyncJob({
    now: '2026-11-13T16:30:00Z',
    syncUsageToInventory: async (_req, res) => { syncs++; res.json({ success: true, data: {} }); },
    getSetting: async () => '',
    setSetting: async () => { attempts++; throw new Error('ER_DATA_TOO_LONG'); }
  });
  await cron.primary();
  assert.equal(syncs, 1);
  assert.equal(attempts, 2, 'full summary + minimal fallback, nothing else');
  assert.ok(cron.logs.some((line) => line.includes('Sales sync success')));
  assert.ok(!cron.errors.some((line) => line.includes('Sales sync failed')));
  cron.stop();
});

test('INV-11: ซิงค์ล้มจริงยังบันทึก pending แล้ว failed_window ตามเดิม', async () => {
  const column = textColumn();
  let syncs = 0;
  const cron = await loadSyncJob({
    now: '2026-11-13T16:30:00Z',
    syncUsageToInventory: async () => { syncs++; throw new Error('ClickHouse timeout'); },
    getSetting: column.getSetting, setSetting: column.setSetting
  });
  await cron.primary();
  let status = JSON.parse(column.value);
  assert.equal(status.state, 'pending');
  assert.equal(status.failure_count, 1);
  assert.equal(status.last_error, 'ClickHouse timeout');
  assert.equal(status.last_result, null);
  assert.ok(status.next_retry_at);

  cron.setClock('2026-11-13T17:30:00Z');
  await cron.retry();
  status = JSON.parse(column.value);
  assert.equal(status.state, 'pending');
  assert.equal(status.failure_count, 2);
  assert.equal(status.source, 'retry-window');

  cron.setClock('2026-11-13T23:00:00Z');
  await cron.final();
  status = JSON.parse(column.value);
  assert.equal(status.state, 'failed_window');
  assert.equal(status.failure_count, 3);
  assert.equal(status.source, 'retry-final');
  assert.equal(status.next_retry_at, null);
  assert.equal(syncs, 3);
  assert.ok(cron.errors.some((line) => line.includes('Sales sync failed')));
  cron.stop();
});
