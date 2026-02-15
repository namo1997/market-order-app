import pool from '../config/database.js';

// ====================================
// Auto-create Inventory Tables
// ====================================

let inventoryTablesEnsured = false;

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
    inventoryTablesEnsured = true;
  } finally {
    connection.release();
  }
};

// ====================================
// Inventory Balance (ยอดคงเหลือ)
// ====================================

/**
 * ดึงยอดคงเหลือทั้งหมด
 */
export const getAllBalances = async (filters = {}) => {
  await ensureInventoryTables();

  let query = `
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
      st.daily_required
    FROM inventory_balance ib
    JOIN products p ON ib.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    JOIN departments d ON ib.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN stock_templates st ON st.product_id = ib.product_id AND st.department_id = ib.department_id
    WHERE 1=1
  `;

  const params = [];

  if (filters.departmentId) {
    query += ' AND ib.department_id = ?';
    params.push(filters.departmentId);
  }

  if (filters.branchId) {
    query += ' AND b.id = ?';
    params.push(filters.branchId);
  }

  if (filters.productId) {
    query += ' AND ib.product_id = ?';
    params.push(filters.productId);
  }

  if (filters.supplierId) {
    query += ' AND s.id = ?';
    params.push(filters.supplierId);
  }

  if (filters.lowStock) {
    query += ' AND st.min_quantity > 0 AND ib.quantity < st.min_quantity';
  }

  if (filters.search) {
    query += ' AND (p.name LIKE ? OR p.code LIKE ?)';
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += ' ORDER BY b.name, d.name, p.name';

  const [rows] = await pool.query(query, params);
  return rows;
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

/**
 * ดึงประวัติการเคลื่อนไหว
 */
export const getTransactions = async (filters = {}) => {
  await ensureInventoryTables();

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
    LEFT JOIN suppliers s ON p.supplier_id = s.id
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

  if (filters.startDate) {
    query += ' AND DATE(it.created_at) >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ' AND DATE(it.created_at) <= ?';
    params.push(filters.endDate);
  }

  const limit = Math.min(Number(filters.limit || 100), 1000);
  const offset = Number(filters.offset || 0);

  query += ' ORDER BY it.created_at DESC, it.id DESC';
  query += ` LIMIT ${limit} OFFSET ${offset}`;

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * ดึงประวัติการเคลื่อนไหวของสินค้าในแผนก (Stock Card)
 */
export const getProductStockCard = async (productId, departmentId, filters = {}) => {
  await ensureInventoryTables();

  let query = `
    SELECT
      it.id,
      it.transaction_type,
      it.quantity,
      it.balance_before,
      it.balance_after,
      it.reference_type,
      it.reference_id,
      it.notes,
      it.created_at,
      usr.name as created_by_name
    FROM inventory_transactions it
    LEFT JOIN users usr ON it.created_by = usr.id
    WHERE it.product_id = ? AND it.department_id = ?
  `;

  const params = [productId, departmentId];

  if (filters.startDate) {
    query += ' AND DATE(it.created_at) >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ' AND DATE(it.created_at) <= ?';
    params.push(filters.endDate);
  }

  query += ' ORDER BY it.created_at DESC, it.id DESC';

  const [rows] = await pool.query(query, params);
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

  let query = `
    SELECT
      ib.product_id,
      ib.department_id,
      ib.quantity as system_quantity,
      sc.stock_quantity as counted_quantity,
      (sc.stock_quantity - ib.quantity) as variance,
      p.name as product_name,
      p.code as product_code,
      p.default_price,
      u.abbreviation as unit_abbr,
      s.name as supplier_name,
      d.name as department_name,
      b.name as branch_name,
      sc.check_date,
      usr.name as counted_by
    FROM stock_checks sc
    JOIN inventory_balance ib ON sc.product_id = ib.product_id AND sc.department_id = ib.department_id
    JOIN products p ON sc.product_id = p.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    JOIN departments d ON sc.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN users usr ON sc.checked_by_user_id = usr.id
    WHERE sc.check_date = ?
  `;

  const params = [date];

  if (filters.departmentId) {
    query += ' AND sc.department_id = ?';
    params.push(filters.departmentId);
  }

  if (filters.branchId) {
    query += ' AND b.id = ?';
    params.push(filters.branchId);
  }

  if (filters.showVarianceOnly) {
    query += ' AND sc.stock_quantity != ib.quantity';
  }

  query += ' ORDER BY ABS(sc.stock_quantity - ib.quantity) DESC, p.name';

  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * ปรับปรุงยอดคงเหลือตามการนับจริง (Stock Adjustment)
 */
export const applyStockAdjustment = async (date, departmentId, userId) => {
  await ensureInventoryTables();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // ดึงรายการที่นับไว้วันนี้
    const [checks] = await connection.query(
      `SELECT sc.product_id, sc.stock_quantity, ib.quantity as current_quantity
       FROM stock_checks sc
       LEFT JOIN inventory_balance ib ON sc.product_id = ib.product_id AND sc.department_id = ib.department_id
       WHERE sc.check_date = ? AND sc.department_id = ?`,
      [date, departmentId]
    );

    const adjustments = [];

    for (const check of checks) {
      const currentQty = parseFloat(check.current_quantity || 0);
      const countedQty = parseFloat(check.stock_quantity);
      const variance = countedQty - currentQty;

      if (variance !== 0) {
        // สร้าง adjustment transaction
        const [transResult] = await connection.query(
          `INSERT INTO inventory_transactions
           (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
            reference_type, reference_id, notes, created_by)
           VALUES (?, ?, 'adjustment', ?, ?, ?, 'stock_check', ?, ?, ?)`,
          [
            check.product_id,
            departmentId,
            variance,
            currentQty,
            countedQty,
            date,
            `ปรับปรุงจากการนับสต็อกวันที่ ${date}`,
            userId
          ]
        );

        // อัพเดทยอดคงเหลือ
        await connection.query(
          `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity = ?,
             last_transaction_id = ?,
             last_updated = CURRENT_TIMESTAMP`,
          [check.product_id, departmentId, countedQty, transResult.insertId, countedQty, transResult.insertId]
        );

        adjustments.push({
          product_id: check.product_id,
          variance,
          transaction_id: transResult.insertId
        });
      }
    }

    await connection.commit();

    return {
      success: true,
      total_adjustments: adjustments.length,
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
  departmentId,
  outputProductId,
  outputQuantity,
  ingredients = [],
  notes,
  createdBy
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

  if (ingredientMap.size === 0) {
    const error = new Error('At least 1 ingredient is required');
    error.statusCode = 400;
    throw error;
  }

  if (ingredientMap.has(normalizedOutputProductId)) {
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
      'SELECT id, name FROM products WHERE id = ? AND is_active = true',
      [normalizedOutputProductId]
    );
    if (outputRows.length === 0) {
      const error = new Error('Output product not found');
      error.statusCode = 404;
      throw error;
    }

    const ingredientProductIds = Array.from(ingredientMap.keys());
    const [ingredientRows] = await connection.query(
      `SELECT p.id, p.name, COALESCE(ib.quantity, 0) AS current_quantity
       FROM products p
       LEFT JOIN inventory_balance ib
         ON ib.product_id = p.id
         AND ib.department_id = ?
       WHERE p.id IN (${ingredientProductIds.map(() => '?').join(', ')})
         AND p.is_active = true`,
      [normalizedDepartmentId, ...ingredientProductIds]
    );

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

    for (const row of ingredientRows) {
      const productId = Number(row.id);
      const requiredQty = Number(ingredientMap.get(productId) || 0);
      const currentQty = Number(ingredientBalance.get(productId) || 0);
      if (currentQty < requiredQty) {
        const error = new Error(`สต็อกวัตถุดิบไม่พอ: ${row.name}`);
        error.statusCode = 400;
        throw error;
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
          reference_type, reference_id, notes, created_by)
         VALUES (?, ?, 'adjustment', ?, ?, ?, 'production_transform', ?, ?, ?)`,
        [
          productId,
          normalizedDepartmentId,
          -usedQty,
          beforeQty,
          afterQty,
          referenceId,
          `แปรรูปสินค้า: ตัดวัตถุดิบ${notes ? ` (${notes})` : ''}`,
          createdBy || null
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
        reference_type, reference_id, notes, created_by)
       VALUES (?, ?, 'adjustment', ?, ?, ?, 'production_transform', ?, ?, ?)`,
      [
        normalizedOutputProductId,
        normalizedDepartmentId,
        normalizedOutputQuantity,
        outputBefore,
        outputAfter,
        referenceId,
        `แปรรูปสินค้า: รับเข้าสินค้าสำเร็จ${notes ? ` (${notes})` : ''}`,
        createdBy || null
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
      department_id: normalizedDepartmentId,
      output: {
        product_id: normalizedOutputProductId,
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
