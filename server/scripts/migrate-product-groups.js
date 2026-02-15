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
    console.log('Starting migration: suppliers -> product_groups');

    const suppliersBase = await tableExists('suppliers', 'BASE TABLE');
    const suppliersView = await tableExists('suppliers', 'VIEW');
    const productGroupsBase = await tableExists('product_groups', 'BASE TABLE');

    if (suppliersBase || suppliersView) {
      await connection.query(
        'CREATE TABLE IF NOT EXISTS backup_suppliers_pre_product_groups AS SELECT * FROM suppliers'
      );
      console.log('Backup created: backup_suppliers_pre_product_groups');
    }
    await connection.query(
      'CREATE TABLE IF NOT EXISTS backup_products_pre_product_groups AS SELECT * FROM products'
    );
    console.log('Backup created: backup_products_pre_product_groups');

    if (suppliersBase && !productGroupsBase) {
      await connection.query('RENAME TABLE suppliers TO product_groups');
      console.log('Renamed table suppliers -> product_groups');
    }

    const hasProductGroups = await tableExists('product_groups', 'BASE TABLE');
    if (!hasProductGroups) {
      throw new Error('Table `product_groups` not found after rename step');
    }

    const hasSuppliersBaseAfter = await tableExists('suppliers', 'BASE TABLE');
    const hasSuppliersViewAfter = await tableExists('suppliers', 'VIEW');

    if (!hasSuppliersBaseAfter) {
      if (hasSuppliersViewAfter) {
        await connection.query('DROP VIEW suppliers');
      }
      await connection.query('CREATE VIEW suppliers AS SELECT * FROM product_groups');
      console.log('Created compatibility view: suppliers');
    } else {
      console.log('Compatibility view skipped: base table `suppliers` still exists');
    }

    if (!(await columnExists('product_groups', 'is_internal'))) {
      await connection.query(
        'ALTER TABLE product_groups ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false AFTER line_id'
      );
      console.log('Added column product_groups.is_internal');
    }
    if (!(await columnExists('product_groups', 'linked_branch_id'))) {
      await connection.query(
        'ALTER TABLE product_groups ADD COLUMN linked_branch_id INT NULL AFTER is_internal'
      );
      console.log('Added column product_groups.linked_branch_id');
    }
    if (!(await columnExists('product_groups', 'linked_department_id'))) {
      await connection.query(
        'ALTER TABLE product_groups ADD COLUMN linked_department_id INT NULL AFTER linked_branch_id'
      );
      console.log('Added column product_groups.linked_department_id');
    }

    const hasSupplierId = await columnExists('products', 'supplier_id');
    const hasProductGroupId = await columnExists('products', 'product_group_id');

    if (!hasProductGroupId) {
      if (hasSupplierId) {
        await connection.query(
          'ALTER TABLE products ADD COLUMN product_group_id INT NULL AFTER supplier_id'
        );
      } else {
        await connection.query(
          'ALTER TABLE products ADD COLUMN product_group_id INT NULL AFTER unit_id'
        );
      }
      console.log('Added column products.product_group_id');
    }

    if (!(await columnExists('products', 'supplier_id'))) {
      await connection.query(
        'ALTER TABLE products ADD COLUMN supplier_id INT NULL AFTER product_group_id'
      );
      console.log('Added compatibility column products.supplier_id');
    }

    await connection.query(`
      UPDATE products
      SET product_group_id = COALESCE(product_group_id, supplier_id),
          supplier_id = COALESCE(supplier_id, product_group_id)
    `);
    console.log('Synced values between products.product_group_id and products.supplier_id');

    if (!(await indexExists('products', 'idx_product_group'))) {
      await connection.query('ALTER TABLE products ADD INDEX idx_product_group (product_group_id)');
      console.log('Added index idx_product_group');
    }

    if (!(await indexExists('products', 'idx_supplier'))) {
      await connection.query('ALTER TABLE products ADD INDEX idx_supplier (supplier_id)');
      console.log('Added index idx_supplier');
    }

    const fkProductGroup = await getForeignKeyByColumn('products', 'product_group_id');
    if (!fkProductGroup) {
      if (!(await constraintExists('products', 'fk_products_product_group'))) {
        await connection.query(`
          ALTER TABLE products
          ADD CONSTRAINT fk_products_product_group
          FOREIGN KEY (product_group_id) REFERENCES product_groups(id)
          ON DELETE SET NULL
        `);
        console.log('Added FK fk_products_product_group');
      }
    }

    const fkSupplier = await getForeignKeyByColumn('products', 'supplier_id');
    if (fkSupplier && fkSupplier.referenced_table_name !== 'product_groups') {
      await connection.query(
        `ALTER TABLE products DROP FOREIGN KEY \`${fkSupplier.constraint_name}\``
      );
      console.log(`Dropped old FK ${fkSupplier.constraint_name} on products.supplier_id`);
    }

    const fkSupplierAfter = await getForeignKeyByColumn('products', 'supplier_id');
    if (!fkSupplierAfter) {
      if (!(await constraintExists('products', 'fk_products_supplier_compat'))) {
        await connection.query(`
          ALTER TABLE products
          ADD CONSTRAINT fk_products_supplier_compat
          FOREIGN KEY (supplier_id) REFERENCES product_groups(id)
          ON DELETE SET NULL
        `);
        console.log('Added compatibility FK fk_products_supplier_compat');
      }
    }

    await connection.query('DROP TRIGGER IF EXISTS trg_products_sync_group_before_insert');
    await connection.query('DROP TRIGGER IF EXISTS trg_products_sync_group_before_update');

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

    console.log('Created sync triggers on products');
    console.log('Migration completed successfully');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
