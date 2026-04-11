import pool from '../config/database.js';

// ====================================
// Auto-create Inventory Tables
// ====================================

let inventoryTablesEnsured = false;
let recipeTablesChecked = false;
let recipeTablesAvailable = false;
let pendingTransferTablesChecked = false;
let pendingTransferTablesAvailable = false;
let stockCategoryTablesChecked = false;
let stockCategoryTablesAvailable = false;

const ensureRecipeTablesAvailableForFilter = async () => {
  if (recipeTablesChecked) return recipeTablesAvailable;
  const [[recipesTable]] = await pool.query("SHOW TABLES LIKE 'menu_recipes'");
  const [[recipeItemsTable]] = await pool.query("SHOW TABLES LIKE 'menu_recipe_items'");
  recipeTablesAvailable = Boolean(recipesTable) && Boolean(recipeItemsTable);
  recipeTablesChecked = true;
  return recipeTablesAvailable;
};

const ensurePendingTransferTablesAvailable = async () => {
  if (pendingTransferTablesChecked) return pendingTransferTablesAvailable;

  const [[ordersTable]] = await pool.query("SHOW TABLES LIKE 'orders'");
  const [[orderItemsTable]] = await pool.query("SHOW TABLES LIKE 'order_items'");
  const [[withdrawSourceTable]] = await pool.query("SHOW TABLES LIKE 'product_group_withdraw_sources'");

  if (!ordersTable || !orderItemsTable || !withdrawSourceTable) {
    pendingTransferTablesAvailable = false;
    pendingTransferTablesChecked = true;
    return pendingTransferTablesAvailable;
  }

  const [receivedQuantityColumn] = await pool.query(
    "SHOW COLUMNS FROM order_items LIKE 'received_quantity'"
  );
  pendingTransferTablesAvailable = receivedQuantityColumn.length > 0;
  pendingTransferTablesChecked = true;
  return pendingTransferTablesAvailable;
};

const ensureStockCategoryTablesAvailable = async () => {
  if (stockCategoryTablesChecked) return stockCategoryTablesAvailable;

  const [[stockCategoriesTable]] = await pool.query("SHOW TABLES LIKE 'stock_categories'");
  const [categoryIdColumn] = await pool.query(
    "SHOW COLUMNS FROM stock_templates LIKE 'category_id'"
  );

  stockCategoryTablesAvailable = Boolean(stockCategoriesTable) && categoryIdColumn.length > 0;
  stockCategoryTablesChecked = true;
  return stockCategoryTablesAvailable;
};

export const ensureInventoryTables = async () => {
  if (inventoryTablesEnsured) return;
  const connection = await pool.getConnection();

  try {
    // ตรวจสอบว่ามีตาราง inventory_balance หรือยัง
    const [tables] = await connection.query(
      "SHOW TABLES LIKE 'inventory_balance'"
    );

    if (tables.length === 0) {
      console.log('⚠️  Inventory tables not found. Auto-creating...');
      await connection.query(`
        CREATE TABLE IF NOT EXISTS inventory_balance (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          department_id INT NOT NULL,
          quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
          last_transaction_id INT NULL,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_product_dept (product_id, department_id),
          INDEX idx_dept (department_id),
          INDEX idx_product (product_id),
          INDEX idx_quantity (quantity),
          CONSTRAINT fk_inventory_balance_product
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          CONSTRAINT fk_inventory_balance_department
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS inventory_transactions (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          department_id INT NOT NULL,
          transaction_type ENUM('receive', 'sale', 'adjustment', 'transfer_in', 'transfer_out', 'initial') NOT NULL,
          quantity DECIMAL(10,2) NOT NULL,
          balance_before DECIMAL(10,2) NOT NULL DEFAULT 0,
          balance_after DECIMAL(10,2) NOT NULL,
          reference_type VARCHAR(50) NULL,
          reference_id VARCHAR(100) NULL,
          notes TEXT NULL,
          created_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_product (product_id),
          INDEX idx_dept (department_id),
          INDEX idx_type (transaction_type),
          INDEX idx_date (created_at),
          INDEX idx_reference (reference_type, reference_id),
          CONSTRAINT fk_inventory_trans_product
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          CONSTRAINT fk_inventory_trans_department
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
          CONSTRAINT fk_inventory_trans_user
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS product_clickhouse_mapping (
          id INT PRIMARY KEY AUTO_INCREMENT,
          product_id INT NOT NULL,
          menu_barcode VARCHAR(100) NOT NULL,
          quantity_per_unit DECIMAL(10,3) NOT NULL DEFAULT 1,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_product_barcode (product_id, menu_barcode),
          INDEX idx_barcode (menu_barcode),
          CONSTRAINT fk_product_ch_mapping
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS clickhouse_sync_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          sync_type ENUM('sales', 'menu') NOT NULL DEFAULT 'sales',
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          branch_id INT NULL,
          total_records INT NOT NULL DEFAULT 0,
          success_records INT NOT NULL DEFAULT 0,
          failed_records INT NOT NULL DEFAULT 0,
          status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
          error_message TEXT NULL,
          synced_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          INDEX idx_sync_date (start_date, end_date),
          INDEX idx_status (status),
          INDEX idx_branch (branch_id),
          CONSTRAINT fk_sync_branch
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
          CONSTRAINT fk_sync_user
            FOREIGN KEY (synced_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Inventory tables auto-created successfully');
    }

    // เพิ่ม FULLTEXT index บน products สำหรับ search ที่เร็วขึ้น
    // (InnoDB รองรับ FULLTEXT ตั้งแต่ MySQL 5.6)
    try {
      const [ftIndexRows] = await connection.query(`
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'products'
          AND INDEX_NAME = 'ft_product_search'
        LIMIT 1
      `);
      if (ftIndexRows.length === 0) {
        await connection.query(
          'ALTER TABLE products ADD FULLTEXT INDEX ft_product_search (name, code)'
        );
        console.log('✅ FULLTEXT index ft_product_search added on products(name, code)');
      }
    } catch (err) {
      // ถ้าสร้าง FULLTEXT ไม่ได้ (เช่น version เก่า) ก็ข้ามไป ไม่กระทบ query เดิม
      console.warn('⚠️  Could not create FULLTEXT index on products:', err.message);
    }

    inventoryTablesEnsured = true;
  } finally {
    connection.release();
  }
};

// ---------------------------------------------------------------------------
// Search helper: ใช้ FULLTEXT (MATCH AGAINST) เมื่อ keyword >= 3 ตัวอักษร
// fallback เป็น LIKE สำหรับ keyword สั้น
// ---------------------------------------------------------------------------
const buildProductSearchCondition = (searchTerm, params) => {
  if (!searchTerm) return '';
  if (searchTerm.trim().length >= 3) {
    // FULLTEXT boolean mode: เร็วกว่า LIKE %...% มาก
    params.push(`${searchTerm.trim()}*`);
    return ' AND MATCH(p.name, p.code) AGAINST(? IN BOOLEAN MODE)';
  }
  // keyword สั้น (1-2 ตัวอักษร): fallback เป็น LIKE เหมือนเดิม
  const term = `%${searchTerm}%`;
  params.push(term, term);
  return ' AND (p.name LIKE ? OR p.code LIKE ?)';
};
// ---------------------------------------------------------------------------

const buildEffectiveTransactionTimeExpr = (alias = 'it') => `
  CASE
    WHEN ${alias}.reference_type = 'recipe_sale'
      AND ${alias}.reference_id REGEXP '^recipe-sale-bill:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{14}:'
    THEN STR_TO_DATE(
      SUBSTRING_INDEX(SUBSTRING_INDEX(${alias}.reference_id, ':', 3), ':', -1),
      '%Y%m%d%H%i%s'
    )
    WHEN ${alias}.reference_type = 'recipe_sale'
      AND ${alias}.reference_id REGEXP '^recipe-sale:[0-9]{4}-[0-9]{2}-[0-9]{2}:'
    THEN STR_TO_DATE(
      SUBSTRING_INDEX(SUBSTRING_INDEX(${alias}.reference_id, ':', 2), ':', -1),
      '%Y-%m-%d'
    )
    ELSE ${alias}.created_at
  END
`;

const buildEffectiveTransactionDateExpr = (alias = 'it') => `
  DATE(${buildEffectiveTransactionTimeExpr(alias)})
`;

const pad2 = (value) => String(value).padStart(2, '0');

const toMysqlDateTimeUtc = (date) => {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  const second = pad2(date.getUTCSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const buildTransformCreatedAtUtc = (transformDate) => {
  const now = new Date();
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      if (part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  const hh = timeParts.hour || '00';
  const mm = timeParts.minute || '00';
  const ss = timeParts.second || '00';
  const bangkokDateTime = new Date(`${transformDate}T${hh}:${mm}:${ss}+07:00`);

  if (Number.isNaN(bangkokDateTime.getTime())) {
    return toMysqlDateTimeUtc(now);
  }
  return toMysqlDateTimeUtc(bangkokDateTime);
};

// เมื่อมีการแทรกรายการย้อนหลัง (เช่น stock_check) ต้อง reflow ยอดก่อน/หลัง
// ของทั้ง ledger เพื่อให้ stock card แสดงลำดับถูกต้องตามเวลา
const recalculateLedgerBalances = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, quantity
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, departmentId]
  );

  let runningBalance = 0;
  for (const row of rows) {
    const qty = parseFloat(row.quantity || 0);
    const balanceBefore = runningBalance;
    const balanceAfter = balanceBefore + qty;
    await connection.query(
      `UPDATE inventory_transactions
       SET balance_before = ?, balance_after = ?
       WHERE id = ?`,
      [balanceBefore, balanceAfter, row.id]
    );
    runningBalance = balanceAfter;
  }

  const lastTransactionId = rows.length > 0 ? rows[rows.length - 1].id : null;

  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, departmentId, runningBalance, lastTransactionId]
  );

  return {
    quantity: runningBalance,
    lastTransactionId
  };
};

// ====================================
// Inventory Balance (ยอดคงเหลือ)
// ====================================

/**
 * ดึงยอดคงเหลือทั้งหมด
 */
export const getAllBalances = async (filters = {}) => {
  await ensureInventoryTables();
  const includePendingTransferRequested = Boolean(filters.includePendingTransfer);
  const includePendingTransfer = includePendingTransferRequested
    ? await ensurePendingTransferTablesAvailable()
    : false;
  const includeStockCategory = await ensureStockCategoryTablesAvailable();

  // Pagination — default 100 rows, max 500
  const limit = Math.min(Math.max(1, parseInt(filters.limit) || 100), 500);
  const page  = Math.max(1, parseInt(filters.page) || 1);
  const offset = (page - 1) * limit;

  const baseJoin = `
    FROM inventory_balance ib
    JOIN products p ON ib.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN product_groups s ON p.product_group_id = s.id
    JOIN departments d ON ib.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN stock_templates st ON st.product_id = ib.product_id AND st.department_id = ib.department_id
    ${
      includeStockCategory
        ? 'LEFT JOIN stock_categories sc ON sc.id = st.category_id'
        : ''
    }
  `;

  const pendingTransferJoin = includePendingTransfer
    ? `
      LEFT JOIN (
        SELECT
          oi.product_id,
          pgws.source_department_id AS department_id,
          SUM(
            GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0))
          ) AS pending_transfer_out
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN users usr ON usr.id = o.user_id
        JOIN departments d ON d.id = usr.department_id
        JOIN products p ON p.id = oi.product_id
        JOIN product_groups pg ON pg.id = p.product_group_id
        JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg.id
        WHERE o.status IN ('submitted', 'confirmed', 'completed')
          AND pg.is_internal = true
          AND pgws.source_department_id IS NOT NULL
          AND pgws.source_department_id <> d.id
          AND GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0)) > 0
        GROUP BY oi.product_id, pgws.source_department_id
      ) pto ON pto.product_id = ib.product_id AND pto.department_id = ib.department_id
      LEFT JOIN (
        SELECT
          oi.product_id,
          d.id AS department_id,
          SUM(
            GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0))
          ) AS pending_transfer_in
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN users usr ON usr.id = o.user_id
        JOIN departments d ON d.id = usr.department_id
        JOIN products p ON p.id = oi.product_id
        JOIN product_groups pg ON pg.id = p.product_group_id
        JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg.id
        WHERE o.status IN ('submitted', 'confirmed', 'completed')
          AND pg.is_internal = true
          AND pgws.source_department_id IS NOT NULL
          AND pgws.source_department_id <> d.id
          AND GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0)) > 0
        GROUP BY oi.product_id, d.id
      ) pti ON pti.product_id = ib.product_id AND pti.department_id = ib.department_id
    `
    : '';

  const params = [];

  let whereClause = '';

  if (filters.departmentId) {
    whereClause += ' AND ib.department_id = ?';
    params.push(filters.departmentId);
  }

  if (filters.branchId) {
    whereClause += ' AND b.id = ?';
    params.push(filters.branchId);
  }

  if (filters.productId) {
    whereClause += ' AND ib.product_id = ?';
    params.push(filters.productId);
  }

  if (filters.supplierId) {
    whereClause += ' AND s.id = ?';
    params.push(filters.supplierId);
  }

  if (filters.lowStock) {
    whereClause += ' AND st.min_quantity > 0 AND ib.quantity < st.min_quantity';
  }

  if (filters.highValueOnly) {
    whereClause += ' AND COALESCE(st.daily_required, false) = true';
  }

  if (filters.recipeLinkedOnly) {
    const canUseRecipeFilter = await ensureRecipeTablesAvailableForFilter();
    if (canUseRecipeFilter) {
      whereClause += `
        AND EXISTS (
          SELECT 1
          FROM menu_recipe_items mri
          JOIN menu_recipes mr ON mr.id = mri.recipe_id
          WHERE mri.product_id = ib.product_id
            AND COALESCE(mr.is_active, true) = true
        )
      `;
    } else {
      whereClause += ' AND 1 = 0';
    }
  }

  whereClause += buildProductSearchCondition(filters.search, params);

  // COUNT query — ใช้ params ชุดเดิม (ไม่รวม limit/offset)
  const countQuery = `SELECT COUNT(*) as total ${baseJoin} WHERE 1=1 ${whereClause}`;
  const [[{ total }]] = await pool.query(countQuery, params);

  // Data query — เพิ่ม LIMIT/OFFSET (integer ที่ validate แล้ว ไม่ใช่ user input โดยตรง)
  const dataQuery = `
    SELECT
      ib.id,
      ib.product_id,
      ib.department_id,
      ib.quantity,
      ib.last_updated,
      p.name as product_name,
      p.code as product_code,
      p.default_price,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.id as supplier_id,
      s.name as supplier_name,
      d.name as department_name,
      b.id as branch_id,
      b.name as branch_name,
      st.required_quantity as max_quantity,
      st.min_quantity,
      st.daily_required,
      ${includeStockCategory ? 'st.category_id' : 'NULL'} AS category_id,
      ${includeStockCategory ? 'sc.name' : 'NULL'} AS category_name,
      ${includeStockCategory ? 'sc.sort_order' : 'NULL'} AS category_sort_order,
      ${includePendingTransfer ? 'COALESCE(pto.pending_transfer_out, 0)' : '0'} AS pending_transfer_out,
      ${includePendingTransfer ? 'COALESCE(pti.pending_transfer_in, 0)' : '0'} AS pending_transfer_in,
      ${
        includePendingTransfer
          ? '(ib.quantity - COALESCE(pto.pending_transfer_out, 0) + COALESCE(pti.pending_transfer_in, 0))'
          : 'ib.quantity'
      } AS estimated_quantity,
      EXISTS (
        SELECT 1
        FROM menu_recipe_items mri
        JOIN menu_recipes mr ON mr.id = mri.recipe_id
        WHERE mri.product_id = ib.product_id
          AND COALESCE(mr.is_active, true) = true
      ) AS has_recipe
    ${baseJoin}
    ${pendingTransferJoin}
    WHERE 1=1
    ${whereClause}
    ORDER BY b.name, d.name, p.name
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [rows] = await pool.query(dataQuery, params);

  return {
    data: rows,
    pagination: {
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      has_next: page < Math.ceil(total / limit),
      has_prev: page > 1
    }
  };
};

/**
 * ดึงยอดคงเหลือของสินค้าในแผนก
 */
export const getBalance = async (productId, departmentId) => {
  await ensureInventoryTables();

  const [rows] = await pool.query(
    `SELECT * FROM inventory_balance
     WHERE product_id = ? AND department_id = ?`,
    [productId, departmentId]
  );

  return rows[0] || null;
};

/**
 * อัพเดทหรือสร้างยอดคงเหลือ
 */
export const upsertBalance = async (productId, departmentId, quantity, lastTransactionId = null) => {
  await ensureInventoryTables();

  const [result] = await pool.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = ?,
       last_transaction_id = ?,
       last_updated = CURRENT_TIMESTAMP`,
    [productId, departmentId, quantity, lastTransactionId, quantity, lastTransactionId]
  );

  return result;
};

// ====================================
// Inventory Transactions (การเคลื่อนไหว)
// ====================================

/**
 * บันทึกการเคลื่อนไหวสต็อก และอัพเดทยอดคงเหลือ
 */
export const createTransaction = async (data) => {
  await ensureInventoryTables();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      product_id,
      department_id,
      transaction_type,
      quantity,
      reference_type,
      reference_id,
      notes,
      created_by
    } = data;

    // ดึงยอดคงเหลือปัจจุบัน
    const [balanceRows] = await connection.query(
      'SELECT quantity FROM inventory_balance WHERE product_id = ? AND department_id = ?',
      [product_id, department_id]
    );

    const balanceBefore = balanceRows.length > 0 ? parseFloat(balanceRows[0].quantity) : 0;
    const balanceAfter = balanceBefore + parseFloat(quantity);

    // บันทึก transaction
    const [transResult] = await connection.query(
      `INSERT INTO inventory_transactions
       (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
        reference_type, reference_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        department_id,
        transaction_type,
        quantity,
        balanceBefore,
        balanceAfter,
        reference_type,
        reference_id,
        notes,
        created_by
      ]
    );

    const transactionId = transResult.insertId;

    // อัพเดทยอดคงเหลือ
    await connection.query(
      `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity = ?,
         last_transaction_id = ?,
         last_updated = CURRENT_TIMESTAMP`,
      [product_id, department_id, balanceAfter, transactionId, balanceAfter, transactionId]
    );

    await connection.commit();

    return {
      id: transactionId,
      balance_before: balanceBefore,
      balance_after: balanceAfter
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const attachTransferCounterparty = async (rows = [], options = {}) => {
  const fallbackProductId = Number(options.fallbackProductId);
  const transferRows = (rows || []).filter((row) => {
    const type = String(row?.transaction_type || '');
    const refType = String(row?.reference_type || '').trim();
    const refId = String(row?.reference_id || '').trim();
    return (
      (type === 'transfer_in' || type === 'transfer_out') &&
      refType &&
      refId
    );
  });

  if (transferRows.length === 0) return;

  const referenceTypes = [
    ...new Set(transferRows.map((row) => String(row.reference_type || '').trim()).filter(Boolean))
  ];
  const referenceIds = [
    ...new Set(transferRows.map((row) => String(row.reference_id || '').trim()).filter(Boolean))
  ];

  const productIds = [
    ...new Set(
      transferRows
        .map((row) => Number(row.product_id ?? fallbackProductId))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  ];

  if (referenceTypes.length === 0 || referenceIds.length === 0 || productIds.length === 0) {
    return;
  }

  const typePlaceholders = referenceTypes.map(() => '?').join(', ');
  const refPlaceholders = referenceIds.map(() => '?').join(', ');
  const productPlaceholders = productIds.map(() => '?').join(', ');

  const [pairRows] = await pool.query(
    `SELECT
       it.id,
       it.product_id,
       it.department_id,
       it.transaction_type,
       it.quantity,
       it.reference_type,
       it.reference_id,
       d.name AS department_name,
       b.name AS branch_name
     FROM inventory_transactions it
     JOIN departments d ON d.id = it.department_id
     JOIN branches b ON b.id = d.branch_id
     WHERE it.product_id IN (${productPlaceholders})
       AND it.transaction_type IN ('transfer_in', 'transfer_out')
       AND it.reference_type IN (${typePlaceholders})
       AND it.reference_id IN (${refPlaceholders})`,
    [...productIds, ...referenceTypes, ...referenceIds]
  );

  const pairBucket = new Map();
  const makeKey = (row) => {
    const refType = String(row.reference_type || '').trim();
    const refId = String(row.reference_id || '').trim();
    const absQty = Math.abs(Number(row.quantity || 0));
    const pid = Number(row.product_id ?? fallbackProductId) || 0;
    return `${pid}::${refType}::${refId}::${absQty}`;
  };

  for (const pair of pairRows) {
    const key = makeKey(pair);
    if (!pairBucket.has(key)) {
      pairBucket.set(key, { transfer_in: [], transfer_out: [] });
    }
    if (pair.transaction_type === 'transfer_in' || pair.transaction_type === 'transfer_out') {
      pairBucket.get(key)[pair.transaction_type].push(pair);
    }
  }

  for (const row of rows) {
    const type = String(row.transaction_type || '');
    if (type !== 'transfer_in' && type !== 'transfer_out') continue;

    const key = makeKey(row);
    const oppositeType = type === 'transfer_out' ? 'transfer_in' : 'transfer_out';
    const candidates = pairBucket.get(key)?.[oppositeType] || [];
    if (candidates.length === 0) continue;

    const counterpart =
      candidates.find(
        (candidate) => Number(candidate.department_id) !== Number(row.department_id)
      ) || candidates[0];

    if (!counterpart) continue;

    row.counterparty_department_id = counterpart.department_id;
    row.counterparty_department_name = counterpart.department_name;
    row.counterparty_branch_name = counterpart.branch_name;
  }
};

/**
 * ดึงประวัติการเคลื่อนไหว
 */
export const getTransactions = async (filters = {}) => {
  await ensureInventoryTables();
  const effectiveAtExpr = buildEffectiveTransactionTimeExpr('it');
  const effectiveDateExpr = buildEffectiveTransactionDateExpr('it');

  let query = `
    SELECT
      it.id,
      it.product_id,
      it.department_id,
      it.transaction_type,
      it.quantity,
      it.balance_before,
      it.balance_after,
      it.reference_type,
      it.reference_id,
      it.notes,
      it.created_at,
      ${effectiveAtExpr} AS effective_at,
      p.name as product_name,
      p.code as product_code,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.name as supplier_name,
      d.name as department_name,
      b.name as branch_name,
      usr.name as created_by_name
    FROM inventory_transactions it
    JOIN products p ON it.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN product_groups s ON p.product_group_id = s.id
    JOIN departments d ON it.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN users usr ON it.created_by = usr.id
    WHERE 1=1
  `;

  const params = [];

  if (filters.productId) {
    query += ' AND it.product_id = ?';
    params.push(filters.productId);
  }

  if (filters.departmentId) {
    query += ' AND it.department_id = ?';
    params.push(filters.departmentId);
  }

  if (filters.branchId) {
    query += ' AND b.id = ?';
    params.push(filters.branchId);
  }

  if (filters.transactionType) {
    query += ' AND it.transaction_type = ?';
    params.push(filters.transactionType);
  }

  query += buildProductSearchCondition(filters.search, params);

  if (filters.startDate) {
    query += ` AND ${effectiveDateExpr} >= ?`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND ${effectiveDateExpr} <= ?`;
    params.push(filters.endDate);
  }

  const limit = Math.min(Number(filters.limit || 100), 1000);
  const offset = Number(filters.offset || 0);

  query += ` ORDER BY ${effectiveAtExpr} DESC, it.id DESC`;
  query += ` LIMIT ${limit} OFFSET ${offset}`;

  const [rows] = await pool.query(query, params);
  await attachTransferCounterparty(rows);
  return rows;
};

/**
 * ดึงประวัติการเคลื่อนไหวของสินค้าในแผนก (Stock Card)
 */
export const getProductStockCard = async (productId, departmentId, filters = {}) => {
  await ensureInventoryTables();
  const effectiveAtExpr = buildEffectiveTransactionTimeExpr('it');
  const effectiveDateExpr = buildEffectiveTransactionDateExpr('it');

  let query = `
    SELECT
      it.id,
      it.department_id,
      it.transaction_type,
      it.quantity,
      it.balance_before,
      it.balance_after,
      it.reference_type,
      it.reference_id,
      it.notes,
      it.created_at,
      ${effectiveAtExpr} AS effective_at,
      usr.name as created_by_name
    FROM inventory_transactions it
    LEFT JOIN users usr ON it.created_by = usr.id
    WHERE it.product_id = ? AND it.department_id = ?
  `;

  const params = [productId, departmentId];

  if (filters.startDate) {
    query += ` AND ${effectiveDateExpr} >= ?`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND ${effectiveDateExpr} <= ?`;
    params.push(filters.endDate);
  }

  query += ` ORDER BY ${effectiveAtExpr} DESC, it.id DESC`;

  const [rows] = await pool.query(query, params);

  await attachTransferCounterparty(rows, { fallbackProductId: Number(productId) });

  return rows;
};

// ====================================
// Dashboard Statistics
// ====================================

/**
 * สรุปสถิติสำหรับ Dashboard
 */
export const getDashboardStats = async (filters = {}) => {
  await ensureInventoryTables();

  const today = new Date().toISOString().split('T')[0];
  const startDate = filters.startDate || today;
  const endDate = filters.endDate || startDate;

  // ยอดคงเหลือรวม (จำนวนรายการ)
  let balanceQuery = 'SELECT COUNT(*) as total_products, SUM(quantity) as total_quantity FROM inventory_balance WHERE 1=1';
  const balanceParams = [];

  if (filters.departmentId) {
    balanceQuery += ' AND department_id = ?';
    balanceParams.push(filters.departmentId);
  }

  if (filters.branchId) {
    balanceQuery += ' AND department_id IN (SELECT id FROM departments WHERE branch_id = ?)';
    balanceParams.push(filters.branchId);
  }

  const [balanceRows] = await pool.query(balanceQuery, balanceParams);

  // การเคลื่อนไหวตามช่วงวันที่
  let movementQuery = `
    SELECT
      transaction_type,
      COUNT(*) as count,
      SUM(ABS(quantity)) as total_quantity
    FROM inventory_transactions
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
  `;
  const movementParams = [startDate, endDate];

  if (filters.departmentId) {
    movementQuery += ' AND department_id = ?';
    movementParams.push(filters.departmentId);
  }

  if (filters.branchId) {
    movementQuery += ' AND department_id IN (SELECT id FROM departments WHERE branch_id = ?)';
    movementParams.push(filters.branchId);
  }

  movementQuery += ' GROUP BY transaction_type';

  const [movementRows] = await pool.query(movementQuery, movementParams);

  // สินค้าที่ต่ำกว่า Min
  let lowStockQuery = `
    SELECT COUNT(*) as low_stock_count
    FROM inventory_balance ib
    JOIN stock_templates st ON st.product_id = ib.product_id AND st.department_id = ib.department_id
    WHERE st.min_quantity > 0 AND ib.quantity < st.min_quantity
  `;
  const lowStockParams = [];

  if (filters.departmentId) {
    lowStockQuery += ' AND ib.department_id = ?';
    lowStockParams.push(filters.departmentId);
  }

  if (filters.branchId) {
    lowStockQuery += ' AND ib.department_id IN (SELECT id FROM departments WHERE branch_id = ?)';
    lowStockParams.push(filters.branchId);
  }

  const [lowStockRows] = await pool.query(lowStockQuery, lowStockParams);

  return {
    total_products: balanceRows[0]?.total_products || 0,
    total_quantity: parseFloat(balanceRows[0]?.total_quantity || 0),
    movement_start_date: startDate,
    movement_end_date: endDate,
    today_movements: movementRows,
    low_stock_count: lowStockRows[0]?.low_stock_count || 0
  };
};

// ====================================
// Stock Variance Report
// ====================================

/**
 * รายงานเปรียบเทียบยอดระบบ vs ยอดนับจริง
 */
export const getStockVarianceReport = async (date, filters = {}) => {
  await ensureInventoryTables();

  // SQL fragment สำหรับ timestamp ของการนับสต็อก — เป็น column expression ล้วน ไม่มี user input
  // ใช้ CTE เพื่อคำนวณ system_quantity ครั้งเดียวและนำมาใช้ซ้ำ (แทนการ interpolate subquery ซ้ำในทุก clause)
  const CHECK_TIMESTAMP_SQL = `COALESCE(sc2.updated_at, sc2.created_at, CONCAT(sc2.check_date, ' 23:59:59'))`;

  // CTE: คำนวณ system_quantity ณ เวลาที่นับ สำหรับทุก stock_check ในวันที่ระบุ
  // ทำให้ไม่ต้องใช้ string interpolation ใน WHERE / ORDER BY clause ของ main query
  let cteWhere = `sc2.check_date = ?`;
  const cteParams = [date];

  if (filters.departmentId) {
    cteWhere += ` AND sc2.department_id = ?`;
    cteParams.push(filters.departmentId);
  }

  const cte = `
    WITH system_qty_cte AS (
      SELECT
        sc2.product_id,
        sc2.department_id,
        ${CHECK_TIMESTAMP_SQL} AS check_ts,
        COALESCE(
          (
            SELECT it2.balance_after
            FROM inventory_transactions it2
            WHERE it2.product_id = sc2.product_id
              AND it2.department_id = sc2.department_id
              AND it2.created_at <= ${CHECK_TIMESTAMP_SQL}
            ORDER BY it2.created_at DESC, it2.id DESC
            LIMIT 1
          ),
          0
        ) AS system_quantity
      FROM stock_checks sc2
      WHERE ${cteWhere}
    )
  `;

  let mainQuery = `
    SELECT
      ib.product_id,
      ib.department_id,
      cte.system_quantity,
      sc.stock_quantity AS counted_quantity,
      (sc.stock_quantity - cte.system_quantity) AS variance,
      p.name AS product_name,
      p.code AS product_code,
      p.default_price,
      u.abbreviation AS unit_abbr,
      s.name AS supplier_name,
      d.name AS department_name,
      b.name AS branch_name,
      sc.check_date,
      cte.check_ts AS checked_at,
      usr.name AS counted_by,
      sc.id AS stock_check_id,
      -- ตรวจว่า stock_check นี้ถูก apply ไปแล้วหรือยัง
      EXISTS (
        SELECT 1 FROM inventory_transactions it
        WHERE it.reference_type = 'stock_check'
          AND it.reference_id LIKE CONCAT(sc.check_date, ':', sc.id, ':%')
          AND it.product_id = sc.product_id
          AND it.department_id = sc.department_id
      ) AS is_applied,
      -- ตรวจว่ามี stock_check วันหลังกว่านี้ที่ apply แล้ว (จะทำให้ apply ย้อนหลังไม่ได้)
      EXISTS (
        SELECT 1 FROM inventory_transactions it2
        WHERE it2.reference_type = 'stock_check'
          AND it2.product_id = sc.product_id
          AND it2.department_id = sc.department_id
          AND it2.reference_id > CONCAT(sc.check_date, ':')
      ) AS has_newer_applied
    FROM stock_checks sc
    JOIN system_qty_cte cte ON cte.product_id = sc.product_id AND cte.department_id = sc.department_id
    LEFT JOIN inventory_balance ib ON sc.product_id = ib.product_id AND sc.department_id = ib.department_id
    JOIN products p ON sc.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN product_groups s ON p.product_group_id = s.id
    LEFT JOIN stock_templates st
      ON st.product_id = sc.product_id
     AND st.department_id = sc.department_id
    JOIN departments d ON sc.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN users usr ON sc.checked_by_user_id = usr.id
    WHERE sc.check_date = ?
  `;

  const mainParams = [date];

  if (filters.departmentId) {
    mainQuery += ` AND sc.department_id = ?`;
    mainParams.push(filters.departmentId);
  }

  if (filters.branchId) {
    mainQuery += ` AND b.id = ?`;
    mainParams.push(filters.branchId);
  }

  if (filters.showVarianceOnly) {
    // ใช้ cte.system_quantity จาก CTE แทนการ interpolate subquery ซ้ำ
    mainQuery += ` AND sc.stock_quantity != cte.system_quantity`;
  }

  if (filters.highValueOnly) {
    mainQuery += ` AND COALESCE(st.daily_required, false) = true`;
  }

  // เรียงตาม variance (absolute) มากไปน้อย — ใช้ cte column แทน interpolated expression
  mainQuery += ` ORDER BY ABS(sc.stock_quantity - cte.system_quantity) DESC, p.name`;

  const fullQuery = cte + mainQuery;
  const params = [...cteParams, ...mainParams];

  const [rows] = await pool.query(fullQuery, params);
  return rows;
};

/**
 * ปรับปรุงยอดคงเหลือตามการนับจริง (Stock Adjustment)
 */
export const applyStockAdjustment = async (date, departmentId, userId, options = {}) => {
  await ensureInventoryTables();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const allowReapply = options.allowReapply === true;

    const selectedProductIds = Array.isArray(options.productIds)
      ? Array.from(
          new Set(
            options.productIds
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id))
          )
        )
      : [];

    // ใช้ timestamp ตอนบันทึกเช็คจริง เพื่อคำนวณส่วนต่างที่จุดเวลาเช็ค
    const checkTimestampExpr = "COALESCE(sc.updated_at, sc.created_at, CONCAT(sc.check_date, ' 23:59:59'))";
    const checkTimestampFormattedExpr = `DATE_FORMAT(${checkTimestampExpr}, '%Y-%m-%d %H:%i:%s')`;

    // ดึงเฉพาะ "ยอดเช็คล่าสุด" ของแต่ละสินค้าในวันนั้น
    // (กันเคสข้อมูลซ้ำใน stock_checks แล้วถูกปรับยอดซ้ำ)
    let checksQuery = `
      SELECT
        sc.id AS stock_check_id,
        sc.product_id,
        sc.stock_quantity,
        ${checkTimestampFormattedExpr} AS checked_at
      FROM stock_checks sc
      WHERE sc.check_date = ? AND sc.department_id = ?
        AND sc.id = (
          SELECT sc2.id
          FROM stock_checks sc2
          WHERE sc2.check_date = sc.check_date
            AND sc2.department_id = sc.department_id
            AND sc2.product_id = sc.product_id
          ORDER BY COALESCE(sc2.updated_at, sc2.created_at, CONCAT(sc2.check_date, ' 23:59:59')) DESC, sc2.id DESC
          LIMIT 1
        )
    `;
    const checksParams = [date, departmentId];

    if (selectedProductIds.length > 0) {
      checksQuery += ` AND sc.product_id IN (${selectedProductIds.map(() => '?').join(',')})`;
      checksParams.push(...selectedProductIds);
    }

    checksQuery += ' ORDER BY sc.id FOR UPDATE';
    const [checks] = await connection.query(checksQuery, checksParams);

    const adjustments = [];
    const skippedAlreadyApplied = [];

    for (const check of checks) {
      const checkTimestamp = check.checked_at || `${date} 23:59:59`;

      // ล็อกให้เช็ครายการนี้ apply ได้ครั้งเดียว (อิง stock_check_id)
      const referenceId = `${date}:${check.stock_check_id}`;
      const legacyReferencePattern = `${date}:${check.stock_check_id}:%`;

      // กันซ้ำทั้งรูปแบบใหม่ (date:id) และรูปแบบเก่า (date:id:timestamp)
      const [existingRows] = await connection.query(
        `SELECT id FROM inventory_transactions
         WHERE reference_type = 'stock_check'
           AND product_id = ?
           AND department_id = ?
           AND (reference_id = ? OR reference_id LIKE ?)
         ORDER BY id`,
        [check.product_id, departmentId, referenceId, legacyReferencePattern]
      );

      if (!allowReapply && existingRows.length > 0) {
        // เคย apply ไปแล้ว — ข้าม
        skippedAlreadyApplied.push({
          product_id: check.product_id,
          stock_check_id: check.stock_check_id,
          checked_at: check.checked_at,
          reason: 'already_applied',
          existing_transaction_id: existingRows[0].id,
          existing_reference_id: referenceId
        });
        continue;
      }

      const [systemRows] = await connection.query(
        `SELECT COALESCE(SUM(it2.quantity), 0) AS system_quantity_at_check
         FROM inventory_transactions it2
         WHERE it2.product_id = ?
           AND it2.department_id = ?
           AND it2.created_at <= ?`,
        [check.product_id, departmentId, checkTimestamp]
      );
      const systemQtyAtCheck = parseFloat(systemRows?.[0]?.system_quantity_at_check || 0);

      // ตรวจว่ามี stock_check วันหลังกว่านี้ที่ถูก apply แล้วหรือยัง
      // ถ้ามี → balance ปัจจุบันถูกคำนวณจาก stock_check วันหลังแล้ว
      // การ apply variance ของวันก่อนจะทำให้ balance ผิด (variance ซ้อนกัน)
      //
      // NOTE: ใช้ วันถัดไป (nextDay) เป็น prefix แทน `${date}:` เพราะ string comparison:
      //   '2026-02-23:369:...' > '2026-02-23:'  → true (ผิด! วันเดียวกันถูกบล็อก)
      //   '2026-02-24:...'     > '2026-02-24'   → true (ถูก)
      //   '2026-02-23:...'     > '2026-02-24'   → false (ถูก — วันก่อนไม่บล็อก)
      const nextDay = new Date(new Date(date + 'T00:00:00Z').getTime() + 86400000)
        .toISOString().slice(0, 10);
      const [laterAppliedRows] = await connection.query(
        `SELECT it.id, it.reference_id
         FROM inventory_transactions it
         WHERE it.product_id = ?
           AND it.department_id = ?
           AND it.reference_type = 'stock_check'
           AND it.reference_id >= ?
         ORDER BY it.reference_id DESC
         LIMIT 1`,
        [check.product_id, departmentId, nextDay]
      );

      if (laterAppliedRows.length > 0) {
        // มี stock_check วันหลังกว่า apply แล้ว → ไม่สามารถ apply ย้อนหลังได้
        const laterRef = laterAppliedRows[0].reference_id;
        const laterDate = String(laterRef).split(':')[0] || '?';
        skippedAlreadyApplied.push({
          product_id: check.product_id,
          stock_check_id: check.stock_check_id,
          checked_at: check.checked_at,
          reason: 'newer_stock_check_applied',
          newer_date: laterDate,
          existing_reference_id: referenceId
        });
        continue;
      }

      const countedQty = parseFloat(check.stock_quantity);
      const variance = countedQty - systemQtyAtCheck;
      const balanceBefore = systemQtyAtCheck;
      const isReapply = allowReapply && existingRows.length > 0;
      const effectiveReferenceId = isReapply
        ? `${referenceId}:reapply:${Date.now()}`
        : referenceId;

      // ยึดเวลาเช็คจริง:
      // 1) ปรับที่เวลาเช็คให้ไปเป็นยอดนับจริง (balanceAfterAdj = countedQty)
      // 2) ยอดปัจจุบัน = ยอดนับจริง + movement หลังเวลาเช็ค (ไม่นับ stock_check)
      const [postCheckRows] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS post_check_delta
         FROM inventory_transactions
         WHERE product_id = ? AND department_id = ?
           AND created_at > ?
           AND reference_type <> 'stock_check'`,
        [check.product_id, departmentId, checkTimestamp]
      );
      const postCheckDelta = parseFloat(postCheckRows?.[0]?.post_check_delta || 0);
      const balanceAfterAdj = countedQty;

      // INSERT IGNORE: ถ้ามี race condition และ request อื่นแทรก referenceId เดียวกันก่อน
      // row นี้จะถูก ignore อัตโนมัติ (ต้องการ unique index บน reference_type+reference_id)
      // บันทึกเสมอแม้ variance=0 เพื่อเป็น marker ว่าสินค้านี้ผ่านการเช็คสต็อกแล้ว
      // (sale sync ใช้ reference_type='stock_check' ตรวจว่าสินค้าใดผูกสูตรและนับแล้ว)
      const [transResult] = await connection.query(
        `INSERT IGNORE INTO inventory_transactions
         (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
          reference_type, reference_id, notes, created_by, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, ?, 'stock_check', ?, ?, ?, ?)`,
        [
          check.product_id,
          departmentId,
          variance,
          balanceBefore,
          balanceAfterAdj,
          effectiveReferenceId,
          `${isReapply ? 'ปรับปรุงซ้ำ' : 'ปรับปรุง'}จากการนับสต็อกวันที่ ${date} เวลา ${checkTimestamp}`,
          userId,
          checkTimestamp
        ]
      );

      // ถ้า affectedRows = 0 แปลว่า INSERT ถูก ignore (race condition เกิดขึ้น) — ข้าม
      if (transResult.affectedRows === 0) {
        skippedAlreadyApplied.push({
          product_id: check.product_id,
          stock_check_id: check.stock_check_id,
          checked_at: check.checked_at,
          existing_transaction_id: null,
          existing_reference_id: effectiveReferenceId
        });
        continue;
      }

      // แทรกรายการย้อนหลังแล้ว ต้องคำนวณ ledger ใหม่ทั้งเส้น
      const recalculated = await recalculateLedgerBalances(connection, check.product_id, departmentId);

      adjustments.push({
        product_id: check.product_id,
        checked_at: check.checked_at,
        system_quantity_at_check: systemQtyAtCheck,
        counted_quantity: countedQty,
        balance_before_apply: balanceBefore,
        balance_after_apply: balanceAfterAdj,
        post_check_delta: postCheckDelta,
        new_inventory_balance: recalculated.quantity,
        variance,
        is_reapply: isReapply,
        reference_id: effectiveReferenceId,
        transaction_id: transResult.insertId,
        last_transaction_id: recalculated.lastTransactionId
      });
    }

    await connection.commit();

    return {
      success: true,
      selected_products_count: selectedProductIds.length,
      total_adjustments: adjustments.length,
      skipped_already_applied_count: skippedAlreadyApplied.length,
      skipped_already_applied: skippedAlreadyApplied,
      adjustments
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ====================================
// Production Transform
// ====================================

export const createProductionTransform = async ({
  transformDate,
  departmentId,
  outputProductId,
  outputQuantity,
  ingredients = [],
  notes,
  createdBy,
  allowedOutputGroupIds = []
}) => {
  await ensureInventoryTables();

  const normalizedDepartmentId = Number(departmentId);
  const normalizedOutputProductId = Number(outputProductId);
  const normalizedOutputQuantity = Number(outputQuantity);
  if (!Number.isFinite(normalizedDepartmentId) || !Number.isFinite(normalizedOutputProductId)) {
    const error = new Error('Invalid department or output product');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(normalizedOutputQuantity) || normalizedOutputQuantity <= 0) {
    const error = new Error('Output quantity must be greater than 0');
    error.statusCode = 400;
    throw error;
  }
  const normalizedTransformDate = String(transformDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedTransformDate)) {
    const error = new Error('Invalid transform date');
    error.statusCode = 400;
    throw error;
  }
  // เก็บเวลาคลิกจริง (เวลาไทย) โดยยึดวันที่แปรรูปที่ผู้ใช้เลือก
  const transactionCreatedAt = buildTransformCreatedAtUtc(normalizedTransformDate);

  const ingredientMap = new Map();
  for (const row of ingredients || []) {
    const productId = Number(row?.product_id);
    const quantity = Number(row?.quantity);
    if (!Number.isFinite(productId) || !Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error('Invalid ingredient data');
      error.statusCode = 400;
      throw error;
    }
    ingredientMap.set(productId, (ingredientMap.get(productId) || 0) + quantity);
  }

  if (ingredientMap.size > 0 && ingredientMap.has(normalizedOutputProductId)) {
    const error = new Error('Output product must not be included in ingredients');
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  const referenceId = `PRD-${Date.now()}`;

  try {
    await connection.beginTransaction();

    const [departmentRows] = await connection.query(
      'SELECT id, name FROM departments WHERE id = ? AND is_active = true',
      [normalizedDepartmentId]
    );
    if (departmentRows.length === 0) {
      const error = new Error('Department not found');
      error.statusCode = 404;
      throw error;
    }

    const [outputRows] = await connection.query(
      `SELECT id, code, name, product_group_id
       FROM products
       WHERE id = ? AND is_active = true`,
      [normalizedOutputProductId]
    );
    if (outputRows.length === 0) {
      const error = new Error('Output product not found');
      error.statusCode = 404;
      throw error;
    }

    const allowedGroups = Array.isArray(allowedOutputGroupIds)
      ? allowedOutputGroupIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      : [];
    if (allowedGroups.length === 0) {
      const error = new Error('แผนกนี้ยังไม่มีพื้นที่จัดเก็บสินค้าที่ผูกไว้สำหรับสินค้าปลายทาง');
      error.statusCode = 400;
      throw error;
    }

    const outputGroupId = Number(outputRows[0]?.product_group_id);
    if (!Number.isFinite(outputGroupId) || !allowedGroups.includes(outputGroupId)) {
      const error = new Error('สินค้าปลายทางต้องอยู่ในพื้นที่จัดเก็บสินค้าที่ผูกกับแผนกนี้');
      error.statusCode = 400;
      throw error;
    }

    const ingredientProductIds = Array.from(ingredientMap.keys());
    let ingredientRows = [];
    if (ingredientProductIds.length > 0) {
      const [rows] = await connection.query(
        `SELECT p.id, p.name, COALESCE(ib.quantity, 0) AS current_quantity
         FROM products p
         LEFT JOIN inventory_balance ib
           ON ib.product_id = p.id
           AND ib.department_id = ?
         WHERE p.id IN (${ingredientProductIds.map(() => '?').join(', ')})
           AND p.is_active = true`,
        [normalizedDepartmentId, ...ingredientProductIds]
      );
      ingredientRows = rows;
    }

    if (ingredientRows.length !== ingredientProductIds.length) {
      const foundIds = new Set(ingredientRows.map((row) => Number(row.id)));
      const missing = ingredientProductIds.find((id) => !foundIds.has(Number(id)));
      const error = new Error(`Ingredient product not found: ${missing}`);
      error.statusCode = 404;
      throw error;
    }

    const ingredientBalance = new Map(
      ingredientRows.map((row) => [Number(row.id), Number(row.current_quantity || 0)])
    );

    const insufficientIngredients = [];
    for (const row of ingredientRows) {
      const productId = Number(row.id);
      const requiredQty = Number(ingredientMap.get(productId) || 0);
      const currentQty = Number(ingredientBalance.get(productId) || 0);
      if (currentQty < requiredQty) {
        insufficientIngredients.push({
          product_id: productId,
          product_name: row.name,
          required_quantity: requiredQty,
          available_quantity: currentQty,
          shortage_quantity: requiredQty - currentQty
        });
      }
    }

    const ingredientMovements = [];
    for (const row of ingredientRows) {
      const productId = Number(row.id);
      const usedQty = Number(ingredientMap.get(productId) || 0);
      const beforeQty = Number(ingredientBalance.get(productId) || 0);
      const afterQty = beforeQty - usedQty;

      const [txResult] = await connection.query(
        `INSERT INTO inventory_transactions
         (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
          reference_type, reference_id, notes, created_by, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, ?, 'production_transform', ?, ?, ?, ?)`,
        [
          productId,
          normalizedDepartmentId,
          -usedQty,
          beforeQty,
          afterQty,
          referenceId,
          `แปรรูปสินค้า: ตัดวัตถุดิบ${notes ? ` (${notes})` : ''}`,
          createdBy || null,
          transactionCreatedAt
        ]
      );

      await connection.query(
        `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           quantity = VALUES(quantity),
           last_transaction_id = VALUES(last_transaction_id),
           last_updated = CURRENT_TIMESTAMP`,
        [productId, normalizedDepartmentId, afterQty, txResult.insertId]
      );

      ingredientBalance.set(productId, afterQty);
      ingredientMovements.push({
        product_id: productId,
        product_name: row.name,
        quantity: usedQty,
        balance_before: beforeQty,
        balance_after: afterQty,
        transaction_id: txResult.insertId
      });
    }

    const [outputBalanceRows] = await connection.query(
      `SELECT quantity
       FROM inventory_balance
       WHERE product_id = ? AND department_id = ?`,
      [normalizedOutputProductId, normalizedDepartmentId]
    );
    const outputBefore = outputBalanceRows.length > 0
      ? Number(outputBalanceRows[0].quantity || 0)
      : 0;
    const outputAfter = outputBefore + normalizedOutputQuantity;

    const [outputTx] = await connection.query(
      `INSERT INTO inventory_transactions
       (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
        reference_type, reference_id, notes, created_by, created_at)
       VALUES (?, ?, 'receive', ?, ?, ?, 'production_transform', ?, ?, ?, ?)`,
      [
        normalizedOutputProductId,
        normalizedDepartmentId,
        normalizedOutputQuantity,
        outputBefore,
        outputAfter,
        referenceId,
        `แปรรูปสินค้า: รับเข้าแผนกทันที${notes ? ` (${notes})` : ''}`,
        createdBy || null,
        transactionCreatedAt
      ]
    );

    await connection.query(
      `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity = VALUES(quantity),
         last_transaction_id = VALUES(last_transaction_id),
         last_updated = CURRENT_TIMESTAMP`,
      [normalizedOutputProductId, normalizedDepartmentId, outputAfter, outputTx.insertId]
    );

    await connection.commit();

    return {
      reference_id: referenceId,
      transform_date: normalizedTransformDate,
      department_id: normalizedDepartmentId,
      insufficient_ingredients: insufficientIngredients,
      output: {
        product_id: normalizedOutputProductId,
        product_code: outputRows[0].code || null,
        product_name: outputRows[0].name,
        quantity: normalizedOutputQuantity,
        balance_before: outputBefore,
        balance_after: outputAfter,
        transaction_id: outputTx.insertId
      },
      ingredients: ingredientMovements
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getProductionTransformHistory = async (filters = {}) => {
  await ensureInventoryTables();
  const createdAtDateExpr = 'DATE(it.created_at)';
  const createdAtExpr = 'it.created_at';

  let query = `
    SELECT
      it.id,
      it.reference_id,
      it.product_id,
      it.department_id,
      it.quantity,
      it.notes,
      it.created_at,
      ${createdAtExpr} AS effective_at,
      p.name AS product_name,
      p.code AS product_code,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr,
      d.name AS department_name,
      b.name AS branch_name,
      usr.name AS created_by_name
    FROM inventory_transactions it
    JOIN products p ON it.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    JOIN departments d ON it.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN users usr ON it.created_by = usr.id
    WHERE it.reference_type = 'production_transform'
      AND it.quantity > 0
  `;

  const params = [];

  if (filters.departmentId) {
    query += ' AND it.department_id = ?';
    params.push(Number(filters.departmentId));
  }

  if (filters.startDate) {
    query += ` AND ${createdAtDateExpr} >= ?`;
    params.push(String(filters.startDate));
  }

  if (filters.endDate) {
    query += ` AND ${createdAtDateExpr} <= ?`;
    params.push(String(filters.endDate));
  }

  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  query += ' ORDER BY it.created_at DESC, it.id DESC';
  query += ` LIMIT ${limit}`;

  const [rows] = await pool.query(query, params);
  return rows;
};

export const updateProductionTransform = async ({
  transactionId,
  outputQuantity,
  notes,
  userDepartmentId = null,
  isAdmin = false
}) => {
  await ensureInventoryTables();

  const normalizedTransactionId = Number(transactionId);
  if (!Number.isFinite(normalizedTransactionId)) {
    const error = new Error('Invalid transaction id');
    error.statusCode = 400;
    throw error;
  }

  const hasQuantityUpdate = outputQuantity !== undefined && outputQuantity !== null && String(outputQuantity) !== '';
  const hasNotesUpdate = notes !== undefined;

  if (!hasQuantityUpdate && !hasNotesUpdate) {
    const error = new Error('output_quantity or notes is required');
    error.statusCode = 400;
    throw error;
  }

  let normalizedOutputQuantity = null;
  if (hasQuantityUpdate) {
    normalizedOutputQuantity = Number(outputQuantity);
    if (!Number.isFinite(normalizedOutputQuantity) || normalizedOutputQuantity <= 0) {
      const error = new Error('Output quantity must be greater than 0');
      error.statusCode = 400;
      throw error;
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      `SELECT
         id,
         reference_id,
         department_id,
         product_id,
         transaction_type,
         quantity,
         notes
       FROM inventory_transactions
       WHERE id = ?
       FOR UPDATE`,
      [normalizedTransactionId]
    );

    if (targetRows.length === 0) {
      const error = new Error('Production transform record not found');
      error.statusCode = 404;
      throw error;
    }

    const target = targetRows[0];
    if (target.transaction_type !== 'receive' || Number(target.quantity || 0) <= 0) {
      const error = new Error('สามารถแก้ไขได้เฉพาะรายการรับเข้าจากการแปรรูป');
      error.statusCode = 400;
      throw error;
    }

    const [checkRows] = await connection.query(
      `SELECT reference_type
       FROM inventory_transactions
       WHERE id = ?
       LIMIT 1`,
      [normalizedTransactionId]
    );
    if (checkRows.length === 0 || checkRows[0].reference_type !== 'production_transform') {
      const error = new Error('ไม่พบรายการแปรรูปที่ต้องการแก้ไข');
      error.statusCode = 404;
      throw error;
    }

    const normalizedUserDepartmentId = Number(userDepartmentId);
    if (!isAdmin && Number.isFinite(normalizedUserDepartmentId) && normalizedUserDepartmentId !== Number(target.department_id)) {
      const error = new Error('ไม่สามารถแก้ไขประวัติข้ามแผนกได้');
      error.statusCode = 403;
      throw error;
    }

    const [relatedRows] = await connection.query(
      `SELECT id, product_id, department_id, quantity
       FROM inventory_transactions
       WHERE reference_type = 'production_transform'
         AND reference_id = ?
       ORDER BY id ASC
       FOR UPDATE`,
      [target.reference_id]
    );

    if (relatedRows.length === 0) {
      const error = new Error('Production transform reference not found');
      error.statusCode = 404;
      throw error;
    }

    if (hasQuantityUpdate) {
      await connection.query(
        `UPDATE inventory_transactions
         SET quantity = ?
         WHERE id = ?`,
        [normalizedOutputQuantity, normalizedTransactionId]
      );
    }

    if (hasNotesUpdate) {
      const noteText = String(notes || '').trim();
      const outputNote = `แปรรูปสินค้า: รับเข้าแผนกทันที${noteText ? ` (${noteText})` : ''}`;
      const ingredientNote = `แปรรูปสินค้า: ตัดวัตถุดิบ${noteText ? ` (${noteText})` : ''}`;

      await connection.query(
        `UPDATE inventory_transactions
         SET notes = CASE
           WHEN id = ? THEN ?
           WHEN quantity < 0 THEN ?
           ELSE ?
         END
         WHERE reference_type = 'production_transform'
           AND reference_id = ?`,
        [normalizedTransactionId, outputNote, ingredientNote, outputNote, target.reference_id]
      );
    }

    const affectedPairs = Array.from(
      new Set(relatedRows.map((row) => `${Number(row.product_id)}:${Number(row.department_id)}`))
    ).map((key) => {
      const [productId, departmentId] = key.split(':').map((value) => Number(value));
      return { productId, departmentId };
    });

    for (const pair of affectedPairs) {
      await recalculateLedgerBalances(connection, pair.productId, pair.departmentId);
    }

    const [[updatedRow]] = await connection.query(
      `SELECT
         it.id,
         it.reference_id,
         it.product_id,
         it.department_id,
         it.quantity,
         it.notes,
         it.created_at,
         p.name AS product_name,
         p.code AS product_code,
         u.name AS unit_name,
         u.abbreviation AS unit_abbr,
         d.name AS department_name,
         b.name AS branch_name,
         usr.name AS created_by_name
       FROM inventory_transactions it
       JOIN products p ON it.product_id = p.id
       LEFT JOIN units u ON p.unit_id = u.id
       JOIN departments d ON it.department_id = d.id
       JOIN branches b ON d.branch_id = b.id
       LEFT JOIN users usr ON it.created_by = usr.id
       WHERE it.id = ?`,
      [normalizedTransactionId]
    );

    await connection.commit();

    return {
      updated: updatedRow || null,
      affected_products_count: affectedPairs.length
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
