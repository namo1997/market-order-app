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

const fkByNameExists = async (tableName, constraintName) => {
  const total = await queryValue(
    `SELECT COUNT(*)
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?
       AND constraint_type = 'FOREIGN KEY'`,
    [tableName, constraintName]
  );
  return Number(total) > 0;
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

const createProductSyncTriggers = async () => {
  if (!(await triggerExists('trg_products_sync_group_before_insert'))) {
    await connection.query(`
      CREATE TRIGGER trg_products_sync_group_before_insert
      BEFORE INSERT ON products
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
    console.log('Created trigger trg_products_sync_group_before_insert');
  }
  if (!(await triggerExists('trg_products_sync_group_before_update'))) {
    await connection.query(`
      CREATE TRIGGER trg_products_sync_group_before_update
      BEFORE UPDATE ON products
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
    console.log('Created trigger trg_products_sync_group_before_update');
  }
};

const createScopeSyncTriggers = async (tableName, insertTrigger, updateTrigger) => {
  if (!(await triggerExists(insertTrigger))) {
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
    console.log(`Created trigger ${insertTrigger}`);
  }
  if (!(await triggerExists(updateTrigger))) {
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
    console.log(`Created trigger ${updateTrigger}`);
  }
};

const run = async () => {
  try {
    console.log('Starting rollback: recreate supplier legacy columns/view');

    // products.supplier_id
    if (!(await columnExists('products', 'supplier_id'))) {
      await connection.query('ALTER TABLE products ADD COLUMN supplier_id INT NULL AFTER product_group_id');
      console.log('Added products.supplier_id');
    }
    await connection.query(
      'UPDATE products SET supplier_id = COALESCE(supplier_id, product_group_id)'
    );
    if (!(await indexExists('products', 'idx_supplier'))) {
      await connection.query('ALTER TABLE products ADD INDEX idx_supplier (supplier_id)');
      console.log('Added index idx_supplier');
    }
    if (!(await fkByNameExists('products', 'fk_products_supplier_compat'))) {
      await connection.query(`
        ALTER TABLE products
        ADD CONSTRAINT fk_products_supplier_compat
        FOREIGN KEY (supplier_id) REFERENCES product_groups(id)
        ON DELETE SET NULL
      `);
      console.log('Added FK fk_products_supplier_compat');
    }
    await createProductSyncTriggers();

    // product_group_scopes.supplier_id
    if (!(await columnExists('product_group_scopes', 'supplier_id'))) {
      await connection.query(
        'ALTER TABLE product_group_scopes ADD COLUMN supplier_id INT NULL AFTER product_group_id'
      );
      console.log('Added product_group_scopes.supplier_id');
    }
    await connection.query(
      `UPDATE product_group_scopes
       SET supplier_id = COALESCE(supplier_id, product_group_id)`
    );
    if (!(await indexExists('product_group_scopes', 'idx_product_group_scope_supplier'))) {
      await connection.query(
        'ALTER TABLE product_group_scopes ADD INDEX idx_product_group_scope_supplier (supplier_id)'
      );
      console.log('Added idx_product_group_scope_supplier');
    }
    await createScopeSyncTriggers(
      'product_group_scopes',
      'trg_pgs_sync_group_before_insert',
      'trg_pgs_sync_group_before_update'
    );

    // product_group_internal_scopes.supplier_id
    if (!(await columnExists('product_group_internal_scopes', 'supplier_id'))) {
      await connection.query(
        'ALTER TABLE product_group_internal_scopes ADD COLUMN supplier_id INT NULL AFTER product_group_id'
      );
      console.log('Added product_group_internal_scopes.supplier_id');
    }
    await connection.query(
      `UPDATE product_group_internal_scopes
       SET supplier_id = COALESCE(supplier_id, product_group_id)`
    );
    if (!(await indexExists('product_group_internal_scopes', 'idx_product_group_internal_scope_supplier'))) {
      await connection.query(
        'ALTER TABLE product_group_internal_scopes ADD INDEX idx_product_group_internal_scope_supplier (supplier_id)'
      );
      console.log('Added idx_product_group_internal_scope_supplier');
    }
    await createScopeSyncTriggers(
      'product_group_internal_scopes',
      'trg_pgis_sync_group_before_insert',
      'trg_pgis_sync_group_before_update'
    );

    // suppliers compatibility view
    const suppliersType = await tableType('suppliers');
    if (!suppliersType) {
      await connection.query('CREATE VIEW suppliers AS SELECT * FROM product_groups');
      console.log('Created compatibility view suppliers');
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
