import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: Number(process.env.DB_PORT || 3306),
  multipleStatements: true
});

const queryValue = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  const first = rows?.[0] || {};
  const key = Object.keys(first)[0];
  return key ? first[key] : 0;
};

const tableExists = async (tableName, tableType = null) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = ?
      ${tableType ? 'AND table_type = ?' : ''}
  `;
  const params = tableType ? [tableName, tableType] : [tableName];
  return (await queryValue(sql, params)) > 0;
};

const columnExists = async (tableName, columnName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
  `;
  return (await queryValue(sql, [tableName, columnName])) > 0;
};

const indexExists = async (tableName, indexName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND index_name = ?
  `;
  return (await queryValue(sql, [tableName, indexName])) > 0;
};

const getForeignKeyByColumn = async (tableName, columnName) => {
  const sql = `
    SELECT
      CONSTRAINT_NAME AS constraint_name,
      REFERENCED_TABLE_NAME AS referenced_table_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
      AND referenced_table_name IS NOT NULL
    LIMIT 1
  `;
  const [rows] = await connection.query(sql, [tableName, columnName]);
  return rows?.[0] || null;
};

const constraintExists = async (tableName, constraintName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND constraint_name = ?
  `;
  return (await queryValue(sql, [tableName, constraintName])) > 0;
};

const run = async () => {
  try {
    console.log('Starting rollback: product_groups -> suppliers');

    const hasProductGroups = await tableExists('product_groups');
    const hasSuppliers = await tableExists('suppliers');

    if (hasProductGroups) {
      await connection.query(
        'CREATE TABLE IF NOT EXISTS backup_product_groups_pre_rollback AS SELECT * FROM product_groups'
      );
      console.log('Backup created: backup_product_groups_pre_rollback');
    }
    if (hasSuppliers) {
      await connection.query(
        'CREATE TABLE IF NOT EXISTS backup_suppliers_pre_rollback AS SELECT * FROM suppliers'
      );
      console.log('Backup created: backup_suppliers_pre_rollback');
    }
    await connection.query(
      'CREATE TABLE IF NOT EXISTS backup_products_pre_rollback AS SELECT * FROM products'
    );
    console.log('Backup created: backup_products_pre_rollback');

    await connection.query('DROP TRIGGER IF EXISTS trg_products_sync_group_before_insert');
    await connection.query('DROP TRIGGER IF EXISTS trg_products_sync_group_before_update');
    console.log('Dropped product sync triggers');

    if (!(await columnExists('products', 'supplier_id'))) {
      await connection.query('ALTER TABLE products ADD COLUMN supplier_id INT NULL AFTER unit_id');
      console.log('Added products.supplier_id');
    }

    if (await columnExists('products', 'product_group_id')) {
      await connection.query(`
        UPDATE products
        SET supplier_id = COALESCE(supplier_id, product_group_id)
      `);

      const fkProductGroup = await getForeignKeyByColumn('products', 'product_group_id');
      if (fkProductGroup) {
        await connection.query(
          `ALTER TABLE products DROP FOREIGN KEY \`${fkProductGroup.constraint_name}\``
        );
        console.log(`Dropped FK ${fkProductGroup.constraint_name}`);
      }

      if (await indexExists('products', 'idx_product_group')) {
        await connection.query('ALTER TABLE products DROP INDEX idx_product_group');
        console.log('Dropped index idx_product_group');
      }

      await connection.query('ALTER TABLE products DROP COLUMN product_group_id');
      console.log('Dropped products.product_group_id');
    }

    const suppliersIsView = await tableExists('suppliers', 'VIEW');
    const suppliersIsBase = await tableExists('suppliers', 'BASE TABLE');
    const productGroupsIsBase = await tableExists('product_groups', 'BASE TABLE');

    if (suppliersIsView) {
      await connection.query('DROP VIEW suppliers');
      console.log('Dropped compatibility view suppliers');
    }

    if (!suppliersIsBase && productGroupsIsBase) {
      await connection.query('RENAME TABLE product_groups TO suppliers');
      console.log('Renamed table product_groups -> suppliers');
    }

    const fkSupplier = await getForeignKeyByColumn('products', 'supplier_id');
    if (fkSupplier && fkSupplier.referenced_table_name !== 'suppliers') {
      await connection.query(
        `ALTER TABLE products DROP FOREIGN KEY \`${fkSupplier.constraint_name}\``
      );
      console.log(`Dropped FK ${fkSupplier.constraint_name} on products.supplier_id`);
    }

    const fkSupplierAfter = await getForeignKeyByColumn('products', 'supplier_id');
    const hasSuppliersBaseAfter = await tableExists('suppliers', 'BASE TABLE');
    if (!fkSupplierAfter && hasSuppliersBaseAfter) {
      if (!(await constraintExists('products', 'fk_products_supplier'))) {
        await connection.query(`
          ALTER TABLE products
          ADD CONSTRAINT fk_products_supplier
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
          ON DELETE SET NULL
        `);
        console.log('Added FK fk_products_supplier');
      }
    }

    console.log('Rollback completed successfully');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Rollback failed:', error.message);
  process.exit(1);
});
