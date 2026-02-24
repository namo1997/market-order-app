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

const columnExists = async (tableName, columnName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
  `;
  return Number(await queryValue(sql, [tableName, columnName])) > 0;
};

const indexExists = async (tableName, indexName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND index_name = ?
  `;
  return Number(await queryValue(sql, [tableName, indexName])) > 0;
};

const triggerExists = async (triggerName) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.triggers
    WHERE trigger_schema = DATABASE()
      AND trigger_name = ?
  `;
  return Number(await queryValue(sql, [triggerName])) > 0;
};

const rollbackScopeTable = async ({ tableName, idxName, insertTrigger, updateTrigger }) => {
  if (await triggerExists(insertTrigger)) {
    await connection.query(`DROP TRIGGER ${insertTrigger}`);
    console.log(`Dropped trigger ${insertTrigger}`);
  }
  if (await triggerExists(updateTrigger)) {
    await connection.query(`DROP TRIGGER ${updateTrigger}`);
    console.log(`Dropped trigger ${updateTrigger}`);
  }

  if (await columnExists(tableName, 'product_group_id')) {
    await connection.query(
      `UPDATE ${tableName}
       SET supplier_id = COALESCE(supplier_id, product_group_id)`
    );
    if (await indexExists(tableName, idxName)) {
      await connection.query(`ALTER TABLE ${tableName} DROP INDEX ${idxName}`);
      console.log(`Dropped index ${idxName}`);
    }
    await connection.query(`ALTER TABLE ${tableName} DROP COLUMN product_group_id`);
    console.log(`Dropped ${tableName}.product_group_id`);
  }
};

const run = async () => {
  try {
    console.log('Starting rollback: scope tables product_group_id compatibility');

    await rollbackScopeTable({
      tableName: 'product_group_scopes',
      idxName: 'idx_product_group_scope_group',
      insertTrigger: 'trg_pgs_sync_group_before_insert',
      updateTrigger: 'trg_pgs_sync_group_before_update'
    });

    await rollbackScopeTable({
      tableName: 'product_group_internal_scopes',
      idxName: 'idx_product_group_internal_scope_group',
      insertTrigger: 'trg_pgis_sync_group_before_insert',
      updateTrigger: 'trg_pgis_sync_group_before_update'
    });

    console.log('Scope rollback completed successfully');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Rollback failed:', error.message);
  process.exit(1);
});
