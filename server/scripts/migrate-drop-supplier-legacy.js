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

const indexNamesByColumn = async (tableName, columnName) => {
  const [rows] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
       AND index_name <> 'PRIMARY'`,
    [tableName, columnName]
  );
  return rows.map((row) => row.index_name).filter(Boolean);
};

const indexExists = async (tableName, indexName) => {
  const total = await queryValue(
    `SELECT COUNT(*)
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName]
  );
  return Number(total) > 0;
};

const constraintExists = async (tableName, constraintName) => {
  const total = await queryValue(
    `SELECT COUNT(*)
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?`,
    [tableName, constraintName]
  );
  return Number(total) > 0;
};

const fkNamesByColumn = async (tableName, columnName) => {
  const [rows] = await connection.query(
    `SELECT DISTINCT constraint_name AS constraint_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?
       AND referenced_table_name IS NOT NULL`,
    [tableName, columnName]
  );
  return rows.map((row) => row.constraint_name).filter(Boolean);
};

const triggerExists = async (triggerName) => {
  const total = await queryValue(
    `SELECT COUNT(*)
     FROM information_schema.triggers
     WHERE trigger_schema = DATABASE()
       AND trigger_name = ?`,
    [triggerName]
  );
  return Number(total) > 0;
};

const dropTriggerIfExists = async (triggerName) => {
  if (await triggerExists(triggerName)) {
    await connection.query(`DROP TRIGGER ${triggerName}`);
    console.log(`Dropped trigger ${triggerName}`);
  }
};

const ensureUniqueScopeIndex = async (tableName, uniqueName) => {
  if (!(await indexExists(tableName, uniqueName))) {
    await connection.query(
      `ALTER TABLE ${tableName}
       ADD UNIQUE KEY ${uniqueName} (product_group_id, branch_id, department_id)`
    );
    console.log(`Added unique index ${uniqueName}`);
  }
};

const run = async () => {
  try {
    console.log('Starting destructive legacy cleanup: drop supplier columns/view');

    const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backups = [
      { src: 'products', dst: `bak_prod_drop_sup_${ts}` },
      { src: 'product_group_scopes', dst: `bak_pgs_drop_sup_${ts}` },
      { src: 'product_group_internal_scopes', dst: `bak_pgis_drop_sup_${ts}` }
    ];

    for (const backup of backups) {
      await connection.query(`CREATE TABLE ${backup.dst} AS SELECT * FROM ${backup.src}`);
      console.log(`Backup created: ${backup.dst}`);
    }

    if ((await tableType('suppliers')) === 'VIEW') {
      const viewBackup = `bak_sview_drop_sup_${ts}`;
      await connection.query(`CREATE TABLE ${viewBackup} AS SELECT * FROM suppliers`);
      console.log(`Backup created: ${viewBackup}`);
    }

    // products.supplier_id
    if (await columnExists('products', 'supplier_id')) {
      await connection.query(
        'UPDATE products SET product_group_id = COALESCE(product_group_id, supplier_id)'
      );

      await dropTriggerIfExists('trg_products_sync_group_before_insert');
      await dropTriggerIfExists('trg_products_sync_group_before_update');

      const fkNames = await fkNamesByColumn('products', 'supplier_id');
      for (const fkName of fkNames) {
        await connection.query(`ALTER TABLE products DROP FOREIGN KEY \`${fkName}\``);
        console.log(`Dropped FK ${fkName} on products.supplier_id`);
      }

      const supplierIndexes = await indexNamesByColumn('products', 'supplier_id');
      for (const indexName of supplierIndexes) {
        if (await indexExists('products', indexName)) {
          await connection.query(`ALTER TABLE products DROP INDEX \`${indexName}\``);
          console.log(`Dropped index ${indexName} on products.supplier_id`);
        }
      }

      await connection.query('ALTER TABLE products DROP COLUMN supplier_id');
      console.log('Dropped products.supplier_id');
    }

    // product_group_scopes.supplier_id
    if (await columnExists('product_group_scopes', 'supplier_id')) {
      await connection.query(
        `UPDATE product_group_scopes
         SET product_group_id = COALESCE(product_group_id, supplier_id)`
      );
      await dropTriggerIfExists('trg_pgs_sync_group_before_insert');
      await dropTriggerIfExists('trg_pgs_sync_group_before_update');

      const indexes = await indexNamesByColumn('product_group_scopes', 'supplier_id');
      for (const indexName of indexes) {
        if (await indexExists('product_group_scopes', indexName)) {
          await connection.query(`ALTER TABLE product_group_scopes DROP INDEX \`${indexName}\``);
          console.log(`Dropped index ${indexName} on product_group_scopes.supplier_id`);
        }
      }

      await connection.query('ALTER TABLE product_group_scopes DROP COLUMN supplier_id');
      console.log('Dropped product_group_scopes.supplier_id');
    }
    await ensureUniqueScopeIndex('product_group_scopes', 'uniq_product_group_scope_group');

    // product_group_internal_scopes.supplier_id
    if (await columnExists('product_group_internal_scopes', 'supplier_id')) {
      await connection.query(
        `UPDATE product_group_internal_scopes
         SET product_group_id = COALESCE(product_group_id, supplier_id)`
      );
      await dropTriggerIfExists('trg_pgis_sync_group_before_insert');
      await dropTriggerIfExists('trg_pgis_sync_group_before_update');

      const indexes = await indexNamesByColumn('product_group_internal_scopes', 'supplier_id');
      for (const indexName of indexes) {
        if (await indexExists('product_group_internal_scopes', indexName)) {
          await connection.query(
            `ALTER TABLE product_group_internal_scopes DROP INDEX \`${indexName}\``
          );
          console.log(
            `Dropped index ${indexName} on product_group_internal_scopes.supplier_id`
          );
        }
      }

      await connection.query('ALTER TABLE product_group_internal_scopes DROP COLUMN supplier_id');
      console.log('Dropped product_group_internal_scopes.supplier_id');
    }
    await ensureUniqueScopeIndex(
      'product_group_internal_scopes',
      'uniq_product_group_internal_scope_group'
    );

    // drop compatibility view
    if ((await tableType('suppliers')) === 'VIEW') {
      await connection.query('DROP VIEW suppliers');
      console.log('Dropped compatibility view suppliers');
    }

    // post checks
    const checks = [
      ['products', 'supplier_id'],
      ['product_group_scopes', 'supplier_id'],
      ['product_group_internal_scopes', 'supplier_id']
    ];
    for (const [tableName, columnName] of checks) {
      if (await columnExists(tableName, columnName)) {
        throw new Error(`Column still exists after cleanup: ${tableName}.${columnName}`);
      }
    }
    if ((await tableType('suppliers')) === 'VIEW') {
      throw new Error('suppliers view still exists after cleanup');
    }
    if (!(await constraintExists('product_group_scopes', 'uniq_product_group_scope_group'))) {
      throw new Error('Missing unique index uniq_product_group_scope_group');
    }
    if (
      !(await constraintExists('product_group_internal_scopes', 'uniq_product_group_internal_scope_group'))
    ) {
      throw new Error('Missing unique index uniq_product_group_internal_scope_group');
    }

    console.log('Destructive legacy cleanup completed successfully');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Cleanup failed:', error.message);
  process.exit(1);
});
