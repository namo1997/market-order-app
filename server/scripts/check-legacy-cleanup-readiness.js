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

const checks = [];

const addCheck = (ok, key, detail, action = '') => {
  checks.push({ ok, key, detail, action });
};

const getScalar = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  const first = rows?.[0] || {};
  const firstKey = Object.keys(first)[0];
  return firstKey ? first[firstKey] : null;
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
  const total = await getScalar(
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
    const productGroupsType = await tableType('product_groups');
    addCheck(
      productGroupsType === 'BASE TABLE',
      'product_groups',
      `product_groups type = ${productGroupsType || 'missing'}`,
      'ต้องมีตาราง product_groups เป็น BASE TABLE'
    );

    const suppliersType = await tableType('suppliers');
    addCheck(
      suppliersType === 'VIEW',
      'suppliers_compat',
      `suppliers type = ${suppliersType || 'missing'}`,
      'ช่วงนี้ควรเป็น VIEW compatibility ก่อนตัด legacy จริง'
    );

    const supplierMastersType = await tableType('supplier_masters');
    addCheck(
      supplierMastersType === 'BASE TABLE',
      'supplier_masters',
      `supplier_masters type = ${supplierMastersType || 'missing'}`,
      'ต้องมี supplier_masters สำหรับซัพพลายเออร์จริง'
    );

    const hasProductGroupId = await columnExists('products', 'product_group_id');
    addCheck(
      hasProductGroupId,
      'products.product_group_id',
      `products.product_group_id = ${hasProductGroupId ? 'exists' : 'missing'}`,
      'ต้องมีคอลัมน์หลัก product_group_id'
    );

    const hasSupplierId = await columnExists('products', 'supplier_id');
    addCheck(
      hasSupplierId,
      'products.supplier_id',
      `products.supplier_id = ${hasSupplierId ? 'exists (legacy)' : 'missing'}`,
      'ระหว่าง transition ควรยังมี supplier_id เพื่อกันระบบเก่าพัง'
    );

    const mismatch = await getScalar(
      `SELECT COUNT(*)
       FROM products
       WHERE NOT (supplier_id <=> product_group_id)`
    );
    addCheck(
      Number(mismatch) === 0,
      'products_sync',
      `mismatch supplier_id vs product_group_id = ${mismatch}`,
      'ต้อง sync ให้เท่ากันก่อนเริ่มตัด legacy'
    );

    const nullGroup = await getScalar(
      'SELECT COUNT(*) FROM products WHERE product_group_id IS NULL'
    );
    addCheck(
      Number(nullGroup) === 0,
      'products_null_group',
      `products.product_group_id IS NULL = ${nullGroup}`,
      'ต้องเติม product_group_id ให้ครบ'
    );

    const triggerCount = await getScalar(
      `SELECT COUNT(*)
       FROM information_schema.triggers
       WHERE trigger_schema = DATABASE()
         AND trigger_name IN (
           'trg_products_sync_group_before_insert',
           'trg_products_sync_group_before_update'
         )`
    );
    addCheck(
      Number(triggerCount) === 2,
      'sync_triggers',
      `sync trigger count = ${triggerCount}`,
      'ก่อนตัด supplier_id ต้องมี trigger sync ครบ 2 ตัว'
    );

    const fkProductGroup = await getScalar(
      `SELECT COUNT(*)
       FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE()
         AND table_name = 'products'
         AND column_name = 'product_group_id'
         AND referenced_table_name = 'product_groups'`
    );
    addCheck(
      Number(fkProductGroup) > 0,
      'fk_product_group',
      `FK products.product_group_id -> product_groups = ${fkProductGroup}`,
      'ควรมี FK ฝั่ง product_group_id'
    );

    const fkSupplierLegacy = await getScalar(
      `SELECT COUNT(*)
       FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE()
         AND table_name = 'products'
         AND column_name = 'supplier_id'
         AND referenced_table_name = 'product_groups'`
    );
    addCheck(
      Number(fkSupplierLegacy) > 0,
      'fk_supplier_legacy',
      `FK products.supplier_id -> product_groups = ${fkSupplierLegacy}`,
      'ช่วง transition ควรมี FK legacy ด้วย'
    );

    console.log('=== Legacy Cleanup Readiness ===');
    checks.forEach((check) => {
      const status = check.ok ? 'PASS' : 'FAIL';
      console.log(`${status} | ${check.key} | ${check.detail}`);
      if (!check.ok && check.action) {
        console.log(`      action: ${check.action}`);
      }
    });

    const failed = checks.filter((check) => !check.ok).length;
    console.log('--------------------------------');
    console.log(`Summary: ${checks.length - failed} passed, ${failed} failed`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Readiness check failed:', error.message);
  process.exit(1);
});
