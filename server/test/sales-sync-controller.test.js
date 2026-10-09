import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let mode;
let events;
const connection = {
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
    query: async (sql) => {
        if (sql.includes('SELECT reference_id')) return [[]];
        if (sql.includes('SELECT quantity')) return [[]];
        if (sql.includes('SELECT balance_after')) return [[{ balance_after: 100 }]];
        if (sql.includes('INSERT INTO inventory_transactions')) {
            events.push('stock-transaction');
            return [{ insertId: 1 }];
        }
        if (sql.includes('INSERT INTO inventory_balance')) {
            events.push('stock-balance');
            return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected connection query: ${sql}`);
    }
};
const pool = {
    getConnection: async () => connection,
    query: async (sql) => {
        if (sql.includes('FROM products')) return [[{ id: 1, name: 'สินค้า', product_group_id: 1 }]];
        if (sql.includes("reference_type = 'stock_check'")) {
            return [mode === 'no-stock' ? [] : [{ product_id: 1, department_id: 1, branch_id: 1 }]];
        }
        throw new Error(`Unexpected pool query: ${sql}`);
    }
};

mock.module('../src/config/database.js', { defaultExport: pool });
mock.module('../src/models/recipe.model.js', {
    namedExports: { getRecipesByBarcodes: async () => mode === 'no-recipe' ? [] : [{
        menu_barcode: 'menu-1', item_id: 1, product_id: 1, product_name: 'สินค้า',
        quantity: 2, unit_id: 1, product_unit_id: 1
    }] }
});
mock.module('../src/models/branch.model.js', {
    namedExports: { getAllBranches: async () => [{ id: 1, clickhouse_branch_id: 'branch-1' }] }
});
mock.module('../src/models/unit-conversion.model.js', {
    namedExports: { getConversionsRaw: async () => [] }
});
mock.module('../src/models/supplier.model.js', {
    namedExports: { ensureInternalOrderScopeTable: async () => {} }
});
mock.module('../src/models/inventory.model.js', {
    namedExports: { ensureInventoryTables: async () => {} }
});
mock.module('../src/services/clickhouse.service.js', {
    namedExports: { queryClickHouse: async () => mode === 'no-sales' ? [] : [{
        sale_date: '2026-10-08', sale_datetime_local: '2026-10-08 12:00:00',
        sale_datetime_utc: '2026-10-08 05:00:00', sale_doc_no: 'test-sale',
        clickhouse_branch_id: 'branch-1', barcode: 'menu-1', menu_name: 'เมนู', total_qty: 3
    }] }
});
const { syncUsageToInventory } = await import('../src/controllers/recipe.controller.js');

const invoke = async ({ recordCompletion, dryRun = false } = {}) => {
    let response;
    let error;
    await syncUsageToInventory({
        body: { date: '2026-10-08', dry_run: dryRun }, query: {}, user: { id: 1 },
        recordSalesSyncCompletion: recordCompletion
    }, {
        json: (data) => { events.push('response'); response = data; },
        status: () => ({ json: (data) => { response = data; } })
    }, (err) => { error = err; });
    return { response, error };
};

test('completion is written on the stock connection before COMMIT and response', async () => {
    mode = 'applied'; events = [];
    const { response, error } = await invoke({
        recordCompletion: async (db, result) => {
            assert.equal(db, connection);
            assert.equal(result.data.applied_deductions, 1);
            assert.equal(result.data.applied_quantity, 6);
            events.push('completion');
        }
    });
    assert.equal(error, undefined);
    assert.equal(response.success, true);
    assert.deepEqual(events, [
        'begin', 'stock-transaction', 'stock-balance', 'completion', 'commit', 'response', 'release'
    ]);
});

test('completion failure rolls back stock changes and does not return success', async () => {
    mode = 'applied'; events = [];
    const { response, error } = await invoke({
        recordCompletion: async () => { events.push('completion'); throw new Error('journal unavailable'); }
    });
    assert.equal(response, undefined);
    assert.match(error.message, /journal unavailable/);
    assert.deepEqual(events, [
        'begin', 'stock-transaction', 'stock-balance', 'completion', 'rollback', 'release'
    ]);
});

for (const emptyMode of ['no-sales', 'no-recipe', 'no-stock']) {
    test(`${emptyMode} still records successful completion before its early response`, async () => {
        mode = emptyMode; events = [];
        const { response, error } = await invoke({
            recordCompletion: async (db, result) => {
                assert.equal(db, pool);
                assert.equal(result.data.applied_deductions, 0);
                events.push('completion');
            }
        });
        assert.equal(error, undefined);
        assert.equal(response.success, true);
        assert.deepEqual(events, ['completion', 'response']);
    });
}

test('ordinary HTTP sync keeps its response and stock transaction without a cron journal callback', async () => {
    mode = 'applied'; events = [];
    const { response, error } = await invoke();
    assert.equal(error, undefined);
    assert.equal(response.data.applied_deductions, 1);
    assert.deepEqual(events, ['begin', 'stock-transaction', 'stock-balance', 'commit', 'response', 'release']);
});

test('dry-run keeps the existing preview and makes no stock changes', async () => {
    mode = 'applied'; events = [];
    const { response, error } = await invoke({ dryRun: true });
    assert.equal(error, undefined);
    assert.equal(response.data.dry_run, true);
    assert.equal(response.data.planned_deductions, 1);
    assert.equal(response.data.applied_deductions, 0);
    assert.deepEqual(events, ['response']);
});
