import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const isApply = args.includes('--apply');

const readNumberArg = (prefix, fallback = null) => {
  const found = args.find((arg) => arg.startsWith(`${prefix}=`));
  if (!found) return fallback;
  const parsed = Number(found.split('=').slice(1).join('='));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const limitGroups = readNumberArg('--limit-groups', null);
const STORE_GROUP_NAMES = ['สโตร์คันคลอง', 'สโตร์สันกำแพง'];

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: Number(process.env.DB_PORT || 3306),
  multipleStatements: true
});

const log = (...values) => console.log('[merge-duplicate-products]', ...values);

const getDuplicateGroups = async () => {
  const limitSql =
    Number.isFinite(limitGroups) && limitGroups > 0
      ? ` LIMIT ${Math.floor(limitGroups)}`
      : '';

  const [rows] = await connection.query(
    `SELECT p.name, GROUP_CONCAT(p.id ORDER BY p.id) AS ids
     FROM products p
     WHERE p.is_active = 1
       AND EXISTS (
         SELECT 1
         FROM product_group_links pgl
         JOIN product_groups pg ON pg.id = pgl.product_group_id
         WHERE pgl.product_id = p.id
           AND pg.name IN (?, ?)
       )
     GROUP BY p.name
     HAVING COUNT(*) > 1
     ORDER BY p.name${limitSql}`,
    STORE_GROUP_NAMES
  );

  return rows.map((row) => {
    const ids = String(row.ids || '')
      .split(',')
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    const keepId = ids[0];
    const dropIds = ids.slice(1);
    return {
      name: row.name,
      keepId,
      dropIds
    };
  });
};

const createMergeMapTempTable = async (groups) => {
  await connection.query(`
    CREATE TEMPORARY TABLE tmp_merge_map (
      old_product_id INT PRIMARY KEY,
      new_product_id INT NOT NULL,
      name VARCHAR(150) NOT NULL
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TEMPORARY TABLE tmp_merge_scope (
      product_id INT PRIMARY KEY,
      new_product_id INT NOT NULL,
      INDEX idx_tmp_merge_scope_new (new_product_id)
    ) ENGINE=InnoDB
  `);

  const values = [];
  const scopeValues = [];
  const keepIds = new Set();

  groups.forEach((group) => {
    keepIds.add(group.keepId);
    group.dropIds.forEach((oldId) => {
      values.push([oldId, group.keepId, group.name]);
      scopeValues.push([oldId, group.keepId]);
    });
  });

  if (values.length > 0) {
    await connection.query(
      'INSERT INTO tmp_merge_map (old_product_id, new_product_id, name) VALUES ?',
      [values]
    );
  }

  if (scopeValues.length > 0) {
    await connection.query(
      'INSERT INTO tmp_merge_scope (product_id, new_product_id) VALUES ?',
      [scopeValues]
    );
  }

  const keepValues = [...keepIds].map((id) => [id, id]);
  if (keepValues.length > 0) {
    await connection.query(
      'INSERT IGNORE INTO tmp_merge_scope (product_id, new_product_id) VALUES ?',
      [keepValues]
    );
  }
};

const getMappingStats = async () => {
  const [[summary]] = await connection.query(
    `SELECT
       COUNT(*) AS merge_rows,
       COUNT(DISTINCT new_product_id) AS keep_products,
       COUNT(DISTINCT name) AS duplicate_names
     FROM tmp_merge_map`
  );

  const [sample] = await connection.query(
    `SELECT name, new_product_id, GROUP_CONCAT(old_product_id ORDER BY old_product_id) AS old_ids
     FROM tmp_merge_map
     GROUP BY name, new_product_id
     ORDER BY name
     LIMIT 20`
  );

  return { summary, sample };
};

const ensureNoMenuRecipeUnitConflict = async () => {
  const [conflicts] = await connection.query(
    `SELECT
       sm.new_product_id,
       mri.recipe_id,
       COUNT(DISTINCT mri.unit_id) AS unit_count,
       GROUP_CONCAT(DISTINCT mri.unit_id ORDER BY mri.unit_id) AS unit_ids
     FROM menu_recipe_items mri
     JOIN tmp_merge_scope sm ON sm.product_id = mri.product_id
     GROUP BY sm.new_product_id, mri.recipe_id
     HAVING COUNT(DISTINCT mri.unit_id) > 1`
  );

  if (conflicts.length > 0) {
    const first = conflicts[0];
    const err = new Error(
      `พบสูตรที่หน่วยไม่ตรงกัน (product=${first.new_product_id}, recipe=${first.recipe_id}, units=${first.unit_ids})`
    );
    err.details = conflicts;
    throw err;
  }
};

const createBackupTables = async () => {
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const tables = [
    'products',
    'order_items',
    'inventory_transactions',
    'inventory_balance',
    'department_products',
    'stock_templates',
    'stock_checks',
    'menu_recipe_items',
    'product_group_links',
    'product_supplier_master_links',
    'product_clickhouse_mapping',
    'purchase_walk_product_order',
    'inventory_withdrawal_items'
  ];

  for (const table of tables) {
    const backup = `bkp_dm_${table}_${suffix}`;
    await connection.query(`DROP TABLE IF EXISTS \`${backup}\``);
    await connection.query(`CREATE TABLE \`${backup}\` AS SELECT * FROM \`${table}\``);
    const [[countRow]] = await connection.query(`SELECT COUNT(*) AS c FROM \`${backup}\``);
    log('backup', backup, `rows=${countRow.c}`);
  }
};

const runMergeApply = async () => {
  await ensureNoMenuRecipeUnitConflict();

  await connection.beginTransaction();
  try {
    // Non-unique FK tables
    await connection.query(
      `UPDATE order_items oi
       JOIN tmp_merge_map mm ON mm.old_product_id = oi.product_id
       SET oi.product_id = mm.new_product_id`
    );
    await connection.query(
      `UPDATE inventory_transactions it
       JOIN tmp_merge_map mm ON mm.old_product_id = it.product_id
       SET it.product_id = mm.new_product_id`
    );
    await connection.query(
      `UPDATE inventory_withdrawal_items iwi
       JOIN tmp_merge_map mm ON mm.old_product_id = iwi.product_id
       SET iwi.product_id = mm.new_product_id`
    );

    // department_products
    await connection.query(`
      INSERT INTO department_products (department_id, product_id, is_active, created_at, updated_at)
      SELECT
        dp.department_id,
        sm.new_product_id,
        MAX(COALESCE(dp.is_active, 1)) AS is_active,
        MIN(dp.created_at) AS created_at,
        MAX(dp.updated_at) AS updated_at
      FROM department_products dp
      JOIN tmp_merge_scope sm ON sm.product_id = dp.product_id
      GROUP BY dp.department_id, sm.new_product_id
      ON DUPLICATE KEY UPDATE
        is_active = GREATEST(department_products.is_active, VALUES(is_active)),
        updated_at = GREATEST(department_products.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE dp FROM department_products dp
       JOIN tmp_merge_map mm ON mm.old_product_id = dp.product_id`
    );

    // stock_templates
    await connection.query(`
      INSERT INTO stock_templates (
        department_id, product_id, required_quantity, min_quantity, daily_required,
        created_at, updated_at, category_id
      )
      SELECT
        st.department_id,
        sm.new_product_id,
        MAX(COALESCE(st.required_quantity, 0)) AS required_quantity,
        MAX(COALESCE(st.min_quantity, 0)) AS min_quantity,
        MAX(COALESCE(st.daily_required, 0)) AS daily_required,
        MIN(st.created_at) AS created_at,
        MAX(st.updated_at) AS updated_at,
        MAX(st.category_id) AS category_id
      FROM stock_templates st
      JOIN tmp_merge_scope sm ON sm.product_id = st.product_id
      GROUP BY st.department_id, sm.new_product_id
      ON DUPLICATE KEY UPDATE
        required_quantity = GREATEST(stock_templates.required_quantity, VALUES(required_quantity)),
        min_quantity = GREATEST(stock_templates.min_quantity, VALUES(min_quantity)),
        daily_required = GREATEST(stock_templates.daily_required, VALUES(daily_required)),
        category_id = COALESCE(stock_templates.category_id, VALUES(category_id)),
        updated_at = GREATEST(stock_templates.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE st FROM stock_templates st
       JOIN tmp_merge_map mm ON mm.old_product_id = st.product_id`
    );

    // stock_checks (latest row per day/dept)
    await connection.query(`
      CREATE TEMPORARY TABLE tmp_stock_checks_merge AS
      SELECT
        x.department_id,
        x.new_product_id AS product_id,
        x.check_date,
        x.stock_quantity,
        x.checked_by_user_id,
        x.created_at,
        x.updated_at
      FROM (
        SELECT
          sc.*,
          sm.new_product_id,
          ROW_NUMBER() OVER (
            PARTITION BY sm.new_product_id, sc.department_id, sc.check_date
            ORDER BY sc.updated_at DESC, sc.id DESC
          ) AS rn
        FROM stock_checks sc
        JOIN tmp_merge_scope sm ON sm.product_id = sc.product_id
      ) x
      WHERE x.rn = 1
    `);
    await connection.query(`
      INSERT INTO stock_checks (
        department_id, product_id, check_date, stock_quantity, checked_by_user_id, created_at, updated_at
      )
      SELECT
        department_id, product_id, check_date, stock_quantity, checked_by_user_id, created_at, updated_at
      FROM tmp_stock_checks_merge
      ON DUPLICATE KEY UPDATE
        stock_quantity = VALUES(stock_quantity),
        checked_by_user_id = VALUES(checked_by_user_id),
        updated_at = GREATEST(stock_checks.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE sc FROM stock_checks sc
       JOIN tmp_merge_map mm ON mm.old_product_id = sc.product_id`
    );

    // inventory_balance (sum quantity)
    await connection.query(`
      INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id, created_at, last_updated)
      SELECT
        sm.new_product_id AS product_id,
        ib.department_id,
        SUM(COALESCE(ib.quantity, 0)) AS quantity,
        MAX(ib.last_transaction_id) AS last_transaction_id,
        MIN(ib.created_at) AS created_at,
        MAX(ib.last_updated) AS last_updated
      FROM inventory_balance ib
      JOIN tmp_merge_scope sm ON sm.product_id = ib.product_id
      GROUP BY sm.new_product_id, ib.department_id
      ON DUPLICATE KEY UPDATE
        quantity = VALUES(quantity),
        last_transaction_id = COALESCE(VALUES(last_transaction_id), inventory_balance.last_transaction_id),
        last_updated = GREATEST(inventory_balance.last_updated, VALUES(last_updated))
    `);
    await connection.query(
      `DELETE ib FROM inventory_balance ib
       JOIN tmp_merge_map mm ON mm.old_product_id = ib.product_id`
    );

    // product_group_links
    await connection.query(`
      INSERT INTO product_group_links (product_id, product_group_id, is_primary, created_at)
      SELECT
        sm.new_product_id AS product_id,
        pgl.product_group_id,
        MAX(COALESCE(pgl.is_primary, 0)) AS is_primary,
        MIN(pgl.created_at) AS created_at
      FROM product_group_links pgl
      JOIN tmp_merge_scope sm ON sm.product_id = pgl.product_id
      GROUP BY sm.new_product_id, pgl.product_group_id
      ON DUPLICATE KEY UPDATE
        is_primary = GREATEST(product_group_links.is_primary, VALUES(is_primary))
    `);
    await connection.query(
      `DELETE pgl FROM product_group_links pgl
       JOIN tmp_merge_map mm ON mm.old_product_id = pgl.product_id`
    );

    // product_supplier_master_links
    await connection.query(`
      INSERT INTO product_supplier_master_links (product_id, supplier_master_id, is_primary, created_at)
      SELECT
        sm.new_product_id AS product_id,
        psl.supplier_master_id,
        MAX(COALESCE(psl.is_primary, 0)) AS is_primary,
        MIN(psl.created_at) AS created_at
      FROM product_supplier_master_links psl
      JOIN tmp_merge_scope sm ON sm.product_id = psl.product_id
      GROUP BY sm.new_product_id, psl.supplier_master_id
      ON DUPLICATE KEY UPDATE
        is_primary = GREATEST(product_supplier_master_links.is_primary, VALUES(is_primary))
    `);
    await connection.query(
      `DELETE psl FROM product_supplier_master_links psl
       JOIN tmp_merge_map mm ON mm.old_product_id = psl.product_id`
    );

    // menu_recipe_items (sum quantity, no unit conflict prechecked)
    await connection.query(`
      INSERT INTO menu_recipe_items (recipe_id, product_id, unit_id, quantity, created_at, updated_at)
      SELECT
        mri.recipe_id,
        sm.new_product_id AS product_id,
        MAX(mri.unit_id) AS unit_id,
        SUM(COALESCE(mri.quantity, 0)) AS quantity,
        MIN(mri.created_at) AS created_at,
        MAX(mri.updated_at) AS updated_at
      FROM menu_recipe_items mri
      JOIN tmp_merge_scope sm ON sm.product_id = mri.product_id
      GROUP BY mri.recipe_id, sm.new_product_id
      ON DUPLICATE KEY UPDATE
        quantity = VALUES(quantity),
        unit_id = VALUES(unit_id),
        updated_at = GREATEST(menu_recipe_items.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE mri FROM menu_recipe_items mri
       JOIN tmp_merge_map mm ON mm.old_product_id = mri.product_id`
    );

    // product_clickhouse_mapping
    await connection.query(`
      INSERT INTO product_clickhouse_mapping (
        product_id, menu_barcode, quantity_per_unit, is_active, created_at, updated_at
      )
      SELECT
        sm.new_product_id AS product_id,
        pcm.menu_barcode,
        MAX(COALESCE(pcm.quantity_per_unit, 1)) AS quantity_per_unit,
        MAX(COALESCE(pcm.is_active, 1)) AS is_active,
        MIN(pcm.created_at) AS created_at,
        MAX(pcm.updated_at) AS updated_at
      FROM product_clickhouse_mapping pcm
      JOIN tmp_merge_scope sm ON sm.product_id = pcm.product_id
      GROUP BY sm.new_product_id, pcm.menu_barcode
      ON DUPLICATE KEY UPDATE
        quantity_per_unit = VALUES(quantity_per_unit),
        is_active = GREATEST(product_clickhouse_mapping.is_active, VALUES(is_active)),
        updated_at = GREATEST(product_clickhouse_mapping.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE pcm FROM product_clickhouse_mapping pcm
       JOIN tmp_merge_map mm ON mm.old_product_id = pcm.product_id`
    );

    // purchase_walk_product_order
    await connection.query(`
      INSERT INTO purchase_walk_product_order (product_id, sort_order, updated_at)
      SELECT
        sm.new_product_id AS product_id,
        MIN(COALESCE(pwo.sort_order, 0)) AS sort_order,
        MAX(pwo.updated_at) AS updated_at
      FROM purchase_walk_product_order pwo
      JOIN tmp_merge_scope sm ON sm.product_id = pwo.product_id
      GROUP BY sm.new_product_id
      ON DUPLICATE KEY UPDATE
        sort_order = LEAST(purchase_walk_product_order.sort_order, VALUES(sort_order)),
        updated_at = GREATEST(purchase_walk_product_order.updated_at, VALUES(updated_at))
    `);
    await connection.query(
      `DELETE pwo FROM purchase_walk_product_order pwo
       JOIN tmp_merge_map mm ON mm.old_product_id = pwo.product_id`
    );

    // Fill missing canonical fields from dropped rows
    await connection.query(`
      CREATE TEMPORARY TABLE tmp_product_enrich AS
      SELECT
        mm.new_product_id,
        MAX(NULLIF(TRIM(p.barcode), '')) AS barcode,
        MAX(NULLIF(TRIM(p.qr_code), '')) AS qr_code,
        MAX(p.default_price) AS default_price,
        MAX(p.product_group_id) AS product_group_id,
        MAX(p.supplier_master_id) AS supplier_master_id,
        MAX(COALESCE(p.is_countable, 1)) AS is_countable
      FROM tmp_merge_map mm
      JOIN products p ON p.id = mm.old_product_id
      GROUP BY mm.new_product_id
    `);
    await connection.query(`
      UPDATE products kp
      JOIN tmp_product_enrich e ON e.new_product_id = kp.id
      SET
        kp.barcode = COALESCE(NULLIF(TRIM(kp.barcode), ''), e.barcode),
        kp.qr_code = COALESCE(NULLIF(TRIM(kp.qr_code), ''), e.qr_code),
        kp.default_price = COALESCE(kp.default_price, e.default_price),
        kp.product_group_id = COALESCE(kp.product_group_id, e.product_group_id),
        kp.supplier_master_id = COALESCE(kp.supplier_master_id, e.supplier_master_id),
        kp.is_countable = GREATEST(COALESCE(kp.is_countable, 1), COALESCE(e.is_countable, 1))
    `);

    // Disable merged duplicates
    await connection.query(`
      UPDATE products p
      JOIN tmp_merge_map mm ON mm.old_product_id = p.id
      SET p.is_active = 0
    `);

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
};

const run = async () => {
  try {
    const groups = await getDuplicateGroups();
    if (groups.length === 0) {
      log('ไม่พบชื่อสินค้าซ้ำ');
      return;
    }

    await createMergeMapTempTable(groups);
    const { summary, sample } = await getMappingStats();
    log('duplicate_names=', summary.duplicate_names, 'merge_rows=', summary.merge_rows);
    log('sample (first 20):');
    sample.forEach((row) => {
      log(`- ${row.name}: keep=${row.new_product_id}, drop=[${row.old_ids}]`);
    });

    await ensureNoMenuRecipeUnitConflict();

    if (!isApply) {
      log('dry-run complete (ยังไม่ได้แก้ข้อมูลจริง)');
      return;
    }

    log('creating backup tables...');
    await createBackupTables();
    log('running merge...');
    await runMergeApply();
    log('merge completed');
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error('[merge-duplicate-products] failed:', error.message);
  if (error?.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exit(1);
});
