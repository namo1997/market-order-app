import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: Number(process.env.DB_PORT || 3306)
});

const queryValue = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  const first = rows?.[0] || {};
  const key = Object.keys(first)[0];
  return key ? first[key] : null;
};

const tableType = async (tableName) => {
  const [rows] = await connection.query(
    `SELECT TABLE_TYPE
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return rows?.[0]?.TABLE_TYPE || null;
};

const columnExists = async (tableName, columnName) => {
  const total = await queryValue(
    `SELECT COUNT(*)
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(total) > 0;
};

const run = async () => {
  try {
    const checks = [];
    const add = (ok, key, detail) => checks.push({ ok, key, detail });

    add((await tableType('product_groups')) === 'BASE TABLE', 'product_groups', 'ต้องเป็น BASE TABLE');
    add((await tableType('suppliers')) !== 'VIEW', 'suppliers_view_removed', 'ต้องไม่มี suppliers VIEW');
    add(!(await columnExists('products', 'supplier_id')), 'products.supplier_id', 'ต้องถูกลบแล้ว');
    add(
      !(await columnExists('product_group_scopes', 'supplier_id')),
      'product_group_scopes.supplier_id',
      'ต้องถูกลบแล้ว'
    );
    add(
      !(await columnExists('product_group_internal_scopes', 'supplier_id')),
      'product_group_internal_scopes.supplier_id',
      'ต้องถูกลบแล้ว'
    );
    add(await columnExists('products', 'product_group_id'), 'products.product_group_id', 'ต้องยังอยู่');
    add(
      await columnExists('product_group_scopes', 'product_group_id'),
      'product_group_scopes.product_group_id',
      'ต้องยังอยู่'
    );
    add(
      await columnExists('product_group_internal_scopes', 'product_group_id'),
      'product_group_internal_scopes.product_group_id',
      'ต้องยังอยู่'
    );

    const [triggerRows] = await connection.query(
      `SELECT trigger_name
       FROM information_schema.triggers
       WHERE trigger_schema = DATABASE()
         AND trigger_name IN (
           'trg_products_sync_group_before_insert',
           'trg_products_sync_group_before_update',
           'trg_pgs_sync_group_before_insert',
           'trg_pgs_sync_group_before_update',
           'trg_pgis_sync_group_before_insert',
           'trg_pgis_sync_group_before_update'
         )`
    );
    add(triggerRows.length === 0, 'legacy_sync_triggers', 'trigger sync เก่าต้องไม่มีแล้ว');

    console.log('=== Post Legacy Cleanup Check ===');
    for (const check of checks) {
      console.log(`${check.ok ? 'PASS' : 'FAIL'} | ${check.key} | ${check.detail}`);
    }
    const failed = checks.filter((check) => !check.ok).length;
    console.log('--------------------------------');
    console.log(`Summary: ${checks.length - failed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Post-cleanup check failed:', error.message);
  process.exit(1);
});
