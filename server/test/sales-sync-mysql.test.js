import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Opt-in, isolated database only. The normal unit suite never connects to a database.
test('MySQL stores oversized results separately and commits/rolls back stock with completion', {
    skip: process.env.SALES_SYNC_TEST_MYSQL !== '1'
}, async (t) => {
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.DB_HOST));
    assert.equal(process.env.DB_NAME, 'sales_sync_test');
    const { default: pool } = await import('../src/config/database.js');
    const runs = await import('../src/models/sales-sync-run.model.js');
    const settings = await import('../src/models/settings.model.js');
    const { createSalesSyncRunner } = await import('../src/services/sales-sync-status.service.js');
    t.after(() => pool.end());
    await runs.ensureTable();
    await pool.query('CREATE TABLE IF NOT EXISTS sync_test_stock (id CHAR(36) PRIMARY KEY, quantity INT) ENGINE=InnoDB');
    const date = '2026-10-08';
    await pool.query('DELETE FROM sales_sync_runs WHERE target_date = ?', [date]);
    await settings.setSetting('sales_sync_retry_status', JSON.stringify({ target_date: date, state: 'pending' }));
    const fullResult = { success: true, data: {
        start: date, end: date, applied_deductions: 160,
        unresolved_items: [{ name: 'สินค้า'.repeat(30000) }]
    } };
    assert.ok(Buffer.byteLength(JSON.stringify(fullResult)) > 65535);
    await assert.rejects(settings.setSetting('overflow-test', JSON.stringify(fullResult)),
        { code: 'ER_DATA_TOO_LONG' });
    let calls = 0;
    const stockId = randomUUID();
    const deps = {
        settings, runs, timezone: 'Asia/Bangkok', logger: { log() {}, error() {} },
        runSync: async ({ recordCompletion }) => {
            calls++;
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                await connection.query('INSERT INTO sync_test_stock VALUES (?, ?)', [stockId, -160]);
                await recordCompletion(connection, fullResult);
                await connection.commit();
                return fullResult;
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        }
    };
    const options = { targetDate: date, source: 'primary' };
    assert.equal((await createSalesSyncRunner(deps).attempt(options)).success, true);
    const [rows] = await pool.query('SELECT run_id, OCTET_LENGTH(summary_json) AS summary_bytes, result_json FROM sales_sync_runs WHERE target_date = ?', [date]);
    assert.ok(rows[0].summary_bytes < 2048);
    assert.deepEqual(JSON.parse(rows[0].result_json), fullResult);
    const status = JSON.parse(await settings.getSetting('sales_sync_retry_status'));
    assert.equal(status.state, 'success');
    assert.equal(status.run_id, rows[0].run_id);

    // Simulate a stale pending setting and a restarted process using the real DB journal.
    await settings.setSetting('sales_sync_retry_status', JSON.stringify({ target_date: date, state: 'pending' }));
    assert.equal((await createSalesSyncRunner(deps).attempt(options)).success, true);
    assert.equal(calls, 1);

    // A second completion for the same day is rejected, rolling stock changes back too.
    const rolledBackStockId = randomUUID();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('INSERT INTO sync_test_stock VALUES (?, ?)', [rolledBackStockId, -160]);
        await assert.rejects(runs.recordCompletion(connection, {
            runId: randomUUID(), targetDate: date, source: 'duplicate', result: fullResult
        }), { code: 'ER_DUP_ENTRY' });
        await connection.rollback();
    } finally {
        connection.release();
    }
    const [stockRows] = await pool.query('SELECT id FROM sync_test_stock WHERE id IN (?, ?)', [stockId, rolledBackStockId]);
    assert.deepEqual(stockRows.map((row) => row.id), [stockId]);
    await pool.query('DELETE FROM sync_test_stock WHERE id = ?', [stockId]);
    await pool.query('DELETE FROM sales_sync_runs WHERE target_date = ?', [date]);
});
