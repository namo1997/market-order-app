import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createSalesSyncRunner, summarizeSalesSyncResult,
    parseSalesSyncStatus, shouldRunSalesSyncRetry
} from '../src/services/sales-sync-status.service.js';

const targetDate = '2026-10-08';
const options = { targetDate, source: 'primary', userId: 1 };
const largeResult = {
    success: true,
    data: {
        start: targetDate, end: targetDate, branch_id: null, dry_run: false,
        planned_deductions: 160, applied_deductions: 160, applied_quantity: 240,
        skipped_existing: 0, skipped_legacy_daily: 0,
        unresolved_items: Array.from({ length: 1000 }, () => ({
            product_name: 'สินค้า'.repeat(20), reason: 'no_stock_check_found'
        })),
        missing_recipes: [{ name: 'ไม่มีสูตร'.repeat(10000) }],
        missing_conversions: [], missing_branch_mapping: []
    }
};

const fixture = () => {
    const journal = new Map();
    const archives = new Map();
    let rawStatus = JSON.stringify({ target_date: targetDate, state: 'pending', failure_count: 2 });
    let syncCalls = 0;
    const writes = [];
    const logs = [];
    const settings = {
        getSetting: async () => rawStatus,
        setSetting: async (key, value) => {
            assert.ok(Buffer.byteLength(value, 'utf8') <= 65535);
            rawStatus = value;
            writes.push(JSON.parse(value));
        }
    };
    const runs = {
        ensureTable: async () => {},
        findCompletion: async (date) => journal.get(date) || null,
        recordCompletion: async (connection, { runId, targetDate: date, result }) => {
            assert.equal(connection, 'inventory-transaction');
            journal.set(date, { run_id: runId, summary: summarizeSalesSyncResult(result) });
        },
        archiveResult: async (runId, result) => archives.set(runId, result)
    };
    const deps = {
        timezone: 'Asia/Bangkok', settings, runs,
        logger: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
        createRunId: () => 'test-run',
        runSync: async ({ recordCompletion }) => {
            syncCalls++;
            await recordCompletion('inventory-transaction', largeResult);
            return largeResult;
        }
    };
    return { deps, runs, settings, journal, archives, writes, logs,
        get syncCalls() { return syncCalls; }, get status() { return JSON.parse(rawStatus); } };
};

test('oversized Thai result is archived intact and status contains bounded counts only', async () => {
    assert.ok(Buffer.byteLength(JSON.stringify(largeResult)) > 65535);
    const f = fixture();
    const result = await createSalesSyncRunner(f.deps).attempt(options);
    assert.equal(result.success, true);
    assert.equal(f.archives.get('test-run'), largeResult);
    assert.equal(f.status.last_result.data.unresolved_items_count, 1000);
    assert.equal(f.status.last_result.data.missing_recipes_count, 1);
    assert.equal(f.status.last_result.data.applied_deductions, 160);
    assert.equal(f.status.last_result.data.unresolved_items, undefined);
    assert.equal(f.status.run_id, 'test-run');
    assert.equal(f.status.failure_count, 0);
    assert.equal(f.status.next_retry_at, null);
    assert.ok(Buffer.byteLength(JSON.stringify(f.status)) < 2048);
    assert.ok(JSON.stringify(f.logs).length < 2048, 'logs must not contain the full result');
});

test('status write failure after success does not retry, including with a fresh runner after restart', async () => {
    const f = fixture();
    f.settings.setSetting = async () => { throw Object.assign(new Error('too long'), { code: 'ER_DATA_TOO_LONG' }); };
    const first = await createSalesSyncRunner(f.deps).attempt(options);
    assert.equal(first.success, true);
    assert.deepEqual(first.persistenceErrors, ['status']);
    assert.equal(f.status.state, 'pending'); // stale value deliberately remains
    assert.equal(shouldRunSalesSyncRetry(f.status, targetDate), true);
    const second = await createSalesSyncRunner(f.deps).attempt({ ...options, source: 'retry-window' });
    assert.equal(second.success, true);
    assert.equal(f.syncCalls, 1);
    assert.equal(f.writes.length, 0, 'must never write a new pending state for a successful sync');
});

test('archive failure leaves a successful status and durable marker; no sync retry', async () => {
    const f = fixture();
    f.runs.archiveResult = async () => { throw new Error('storage unavailable'); };
    const runner = createSalesSyncRunner(f.deps);
    const result = await runner.attempt(options);
    assert.equal(result.success, true);
    assert.deepEqual(result.persistenceErrors, ['result']);
    assert.equal(f.status.state, 'success');
    await runner.attempt(options);
    assert.equal(f.syncCalls, 1);
});

test('lost response after commit recovers the durable completion instead of marking pending', async () => {
    const f = fixture();
    const realSync = f.deps.runSync;
    f.deps.runSync = async (args) => { await realSync(args); throw new Error('connection lost after commit'); };
    const result = await createSalesSyncRunner(f.deps).attempt(options);
    assert.equal(result.success, true);
    assert.equal(f.status.state, 'success');
    assert.equal(f.status.failure_count, 0);
});

test('actual sync failure increments retries, then final failure stops the retry window', async () => {
    const f = fixture();
    f.deps.runSync = async () => { throw new Error('ClickHouse unavailable'); };
    const runner = createSalesSyncRunner(f.deps);
    assert.equal((await runner.attempt(options)).success, false);
    assert.equal(f.status.state, 'pending');
    assert.equal(f.status.failure_count, 3);
    assert.equal(shouldRunSalesSyncRetry(f.status, targetDate), true);
    await runner.attempt({ ...options, source: 'retry-final', finalizeOnFail: true });
    assert.equal(f.status.state, 'failed_window');
    assert.equal(f.status.failure_count, 4);
    assert.equal(f.status.next_retry_at, null);
    assert.equal(shouldRunSalesSyncRetry(f.status, targetDate), false);
});

test('a missing completion callback cannot silently mark a sync successful', async () => {
    const f = fixture();
    f.deps.runSync = async () => largeResult;
    assert.equal((await createSalesSyncRunner(f.deps).attempt(options)).success, false);
    assert.equal(f.status.state, 'pending');
});

test('unreadable completion journal fails closed without running sync or rewriting status', async () => {
    const f = fixture();
    f.runs.findCompletion = async () => { throw new Error('database unavailable'); };
    await assert.rejects(createSalesSyncRunner(f.deps).attempt(options), /database unavailable/);
    assert.equal(f.syncCalls, 0);
    assert.equal(f.writes.length, 0);
});

test('concurrent attempts for the same date share one sync', async () => {
    const f = fixture();
    const runner = createSalesSyncRunner(f.deps);
    const [a, b] = await Promise.all([runner.attempt(options), runner.attempt(options)]);
    assert.equal(a, b);
    assert.equal(f.syncCalls, 1);
});

test('failure text is bounded in bytes and status parsing rejects invalid values', async () => {
    const f = fixture();
    f.deps.runSync = async () => { throw new Error('ผิดพลาด'.repeat(100000)); };
    await createSalesSyncRunner(f.deps).attempt(options);
    assert.ok(Buffer.byteLength(JSON.stringify(f.status)) < 4096);
    assert.equal(parseSalesSyncStatus('bad json'), null);
    assert.equal(parseSalesSyncStatus('[]'), null);
    assert.equal(shouldRunSalesSyncRetry(f.status, '2026-10-09'), false);
});
