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

const tableExists = async (tableName, tableType = null) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = ?
      ${tableType ? 'AND table_type = ?' : ''}
  `;
  const params = tableType ? [tableName, tableType] : [tableName];
  return Number(await queryValue(sql, params)) > 0;
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

const ensureScopeTableColumns = async ({ tableName, idxName, insertTrigger, updateTrigger }) => {
  if (!(await tableExists(tableName, 'BASE TABLE'))) {
    throw new Error(`Table not found: ${tableName}`);
  }

  if (!(await columnExists(tableName, 'product_group_id'))) {
    await connection.query(
      `ALTER TABLE ${tableName} ADD COLUMN product_group_id INT NULL AFTER supplier_id`
    );
    console.log(`Added ${tableName}.product_group_id`);
  }

  await connection.query(
    `UPDATE ${tableName}
     SET product_group_id = COALESCE(product_group_id, supplier_id),
         supplier_id = COALESCE(supplier_id, product_group_id)`
  );
  console.log(`Synced supplier_id <-> product_group_id in ${tableName}`);

  if (!(await indexExists(tableName, idxName))) {
    await connection.query(
      `ALTER TABLE ${tableName} ADD INDEX ${idxName} (product_group_id)`
    );
    console.log(`Added index ${idxName}`);
  }

  if (await triggerExists(insertTrigger)) {
    await connection.query(`DROP TRIGGER ${insertTrigger}`);
  }
  if (await triggerExists(updateTrigger)) {
    await connection.query(`DROP TRIGGER ${updateTrigger}`);
  }

  await connection.query(`
    CREATE TRIGGER ${insertTrigger}
    BEFORE INSERT ON ${tableName}
    FOR EACH ROW
    BEGIN
      IF NEW.product_group_id IS NULL AND NEW.supplier_id IS NOT NULL THEN
        SET NEW.product_group_id = NEW.supplier_id;
      END IF;
      IF NEW.supplier_id IS NULL AND NEW.product_group_id IS NOT NULL THEN
        SET NEW.supplier_id = NEW.product_group_id;
      END IF;
      IF NEW.product_group_id IS NOT NULL THEN
        SET NEW.supplier_id = NEW.product_group_id;
      END IF;
    END
  `);

  await connection.query(`
    CREATE TRIGGER ${updateTrigger}
    BEFORE UPDATE ON ${tableName}
    FOR EACH ROW
    BEGIN
      IF NEW.product_group_id IS NULL AND NEW.supplier_id IS NOT NULL THEN
        SET NEW.product_group_id = NEW.supplier_id;
      ELSEIF NEW.supplier_id IS NULL AND NEW.product_group_id IS NOT NULL THEN
        SET NEW.supplier_id = NEW.product_group_id;
      ELSEIF NOT (NEW.product_group_id <=> OLD.product_group_id) THEN
        SET NEW.supplier_id = NEW.product_group_id;
      ELSEIF NOT (NEW.supplier_id <=> OLD.supplier_id) THEN
        SET NEW.product_group_id = NEW.supplier_id;
      END IF;
    END
  `);
  console.log(`Created sync triggers for ${tableName}`);
};

const run = async () => {
  try {
    console.log('Starting migration: scope tables supplier_id -> product_group_id compatibility');

    const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupScopes = `bak_pgs_scope_${ts}`;
    const backupInternal = `bak_pgis_scope_${ts}`;

    await connection.query(
      `CREATE TABLE ${backupScopes} AS SELECT * FROM product_group_scopes`
    );
    console.log(`Backup created: ${backupScopes}`);

    await connection.query(
      `CREATE TABLE ${backupInternal} AS SELECT * FROM product_group_internal_scopes`
    );
    console.log(`Backup created: ${backupInternal}`);

    await ensureScopeTableColumns({
      tableName: 'product_group_scopes',
      idxName: 'idx_product_group_scope_group',
      insertTrigger: 'trg_pgs_sync_group_before_insert',
      updateTrigger: 'trg_pgs_sync_group_before_update'
    });

    await ensureScopeTableColumns({
      tableName: 'product_group_internal_scopes',
      idxName: 'idx_product_group_internal_scope_group',
      insertTrigger: 'trg_pgis_sync_group_before_insert',
      updateTrigger: 'trg_pgis_sync_group_before_update'
    });

    const mismatchScopes = Number(
      await queryValue(
        'SELECT COUNT(*) FROM product_group_scopes WHERE NOT (supplier_id <=> product_group_id)'
      )
    );
    const mismatchInternal = Number(
      await queryValue(
        'SELECT COUNT(*) FROM product_group_internal_scopes WHERE NOT (supplier_id <=> product_group_id)'
      )
    );

    console.log(`Mismatch product_group_scopes: ${mismatchScopes}`);
    console.log(`Mismatch product_group_internal_scopes: ${mismatchInternal}`);

    if (mismatchScopes > 0 || mismatchInternal > 0) {
      throw new Error('Mismatch remains after scope migration');
    }

    console.log('Scope migration completed successfully');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
