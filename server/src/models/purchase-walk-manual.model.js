import pool from '../config/database.js';

export const ensurePurchaseWalkManualTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS purchase_walk_manual_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_date DATE NOT NULL,
      product_group_id INT NOT NULL,
      branch_id INT NOT NULL,
      base_product_id INT NULL,
      product_name VARCHAR(255) NOT NULL,
      unit_abbr VARCHAR(50) NULL,
      unit_name VARCHAR(100) NULL,
      actual_quantity DECIMAL(12,6) NOT NULL DEFAULT 0,
      actual_price DECIMAL(12,6) NULL,
      is_purchased BOOLEAN NOT NULL DEFAULT false,
      purchase_reason TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by_user_id INT NULL,
      updated_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pwm_order_date (order_date),
      INDEX idx_pwm_product_group (product_group_id),
      INDEX idx_pwm_branch (branch_id),
      INDEX idx_pwm_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const validateRequired = (payload = {}) => {
  const orderDate = String(payload.order_date || '').trim();
  const productGroupId = toNumber(payload.product_group_id);
  const branchId = toNumber(payload.branch_id);
  const productName = String(payload.product_name || '').trim();

  if (!orderDate) {
    const error = new Error('order_date is required');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(productGroupId) || productGroupId <= 0) {
    const error = new Error('product_group_id is required');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(branchId) || branchId <= 0) {
    const error = new Error('branch_id is required');
    error.statusCode = 400;
    throw error;
  }
  if (!productName) {
    const error = new Error('product_name is required');
    error.statusCode = 400;
    throw error;
  }
};

export const getPurchaseWalkManualItems = async (date) => {
  await ensurePurchaseWalkManualTable();
  const [rows] = await pool.query(
    `SELECT
       mi.id,
       mi.order_date,
       mi.product_group_id AS supplier_id,
       pg.name AS supplier_name,
       sm.id AS supplier_master_id,
       sm.name AS supplier_master_name,
       sm.has_bank_account AS supplier_has_bank_account,
       sm.bank_name AS supplier_bank_name,
       sm.account_number AS supplier_account_number,
       sm.account_name AS supplier_account_name,
       mi.branch_id,
       b.name AS branch_name,
       mi.base_product_id,
       mi.product_name,
       mi.unit_abbr,
       mi.unit_name,
       mi.actual_quantity,
       mi.actual_price,
       mi.is_purchased,
       mi.purchase_reason,
       mi.created_at,
       mi.updated_at
     FROM purchase_walk_manual_items mi
     LEFT JOIN product_groups pg ON pg.id = mi.product_group_id
     LEFT JOIN products bp ON bp.id = mi.base_product_id
     LEFT JOIN supplier_masters sm ON sm.id = bp.supplier_master_id
     LEFT JOIN branches b ON b.id = mi.branch_id
     WHERE mi.order_date = ?
       AND mi.is_active = true
     ORDER BY mi.product_group_id ASC, mi.id ASC`,
    [date]
  );
  return rows;
};

export const createPurchaseWalkManualItem = async (payload, userId) => {
  await ensurePurchaseWalkManualTable();
  validateRequired(payload);

  const orderDate = String(payload.order_date).trim();
  const productGroupId = Number(payload.product_group_id);
  const branchId = Number(payload.branch_id);
  const baseProductId = toNumber(payload.base_product_id);
  const productName = String(payload.product_name || '').trim();
  const unitAbbr = String(payload.unit_abbr || '').trim() || null;
  const unitName = String(payload.unit_name || '').trim() || null;
  const actualQuantity = toNumber(payload.actual_quantity, 0) || 0;
  const actualPrice = toNumber(payload.actual_price, null);
  const isPurchased = payload.is_purchased === true || payload.is_purchased === 1;
  const purchaseReason = String(payload.purchase_reason || '').trim() || null;

  if (
    isPurchased &&
    Number(actualQuantity || 0) > 0 &&
    (!Number.isFinite(Number(actualPrice)) || Number(actualPrice) <= 0)
  ) {
    const error = new Error('actual_price is required and must be greater than 0');
    error.statusCode = 400;
    throw error;
  }

  const [result] = await pool.query(
    `INSERT INTO purchase_walk_manual_items
      (order_date, product_group_id, branch_id, base_product_id, product_name, unit_abbr, unit_name,
       actual_quantity, actual_price, is_purchased, purchase_reason, created_by_user_id, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderDate,
      productGroupId,
      branchId,
      baseProductId,
      productName,
      unitAbbr,
      unitName,
      actualQuantity,
      actualPrice,
      isPurchased,
      purchaseReason,
      userId || null,
      userId || null
    ]
  );

  const [rows] = await pool.query(
    `SELECT
       mi.id,
       mi.order_date,
       mi.product_group_id AS supplier_id,
       pg.name AS supplier_name,
       sm.id AS supplier_master_id,
       sm.name AS supplier_master_name,
       sm.has_bank_account AS supplier_has_bank_account,
       sm.bank_name AS supplier_bank_name,
       sm.account_number AS supplier_account_number,
       sm.account_name AS supplier_account_name,
       mi.branch_id,
       b.name AS branch_name,
       mi.base_product_id,
       mi.product_name,
       mi.unit_abbr,
       mi.unit_name,
       mi.actual_quantity,
       mi.actual_price,
       mi.is_purchased,
       mi.purchase_reason,
       mi.created_at,
       mi.updated_at
     FROM purchase_walk_manual_items mi
     LEFT JOIN product_groups pg ON pg.id = mi.product_group_id
     LEFT JOIN products bp ON bp.id = mi.base_product_id
     LEFT JOIN supplier_masters sm ON sm.id = bp.supplier_master_id
     LEFT JOIN branches b ON b.id = mi.branch_id
     WHERE mi.id = ?
     LIMIT 1`,
    [result.insertId]
  );

  return rows[0] || null;
};

export const updatePurchaseWalkManualItem = async (id, payload, userId) => {
  await ensurePurchaseWalkManualTable();

  const [existingRows] = await pool.query(
    `SELECT *
     FROM purchase_walk_manual_items
     WHERE id = ?
       AND is_active = true
     LIMIT 1`,
    [id]
  );

  const existing = existingRows[0];
  if (!existing) {
    const error = new Error('Manual purchase item not found');
    error.statusCode = 404;
    throw error;
  }

  const actualQuantity = payload.actual_quantity !== undefined
    ? toNumber(payload.actual_quantity, 0) || 0
    : Number(existing.actual_quantity || 0);
  const actualPrice = payload.actual_price !== undefined
    ? toNumber(payload.actual_price, null)
    : existing.actual_price;
  const isPurchased = payload.is_purchased !== undefined
    ? payload.is_purchased === true || payload.is_purchased === 1
    : Boolean(existing.is_purchased);
  const purchaseReason = payload.purchase_reason !== undefined
    ? String(payload.purchase_reason || '').trim() || null
    : existing.purchase_reason;
  const branchId = payload.branch_id !== undefined
    ? toNumber(payload.branch_id, Number(existing.branch_id))
    : Number(existing.branch_id);

  if (
    isPurchased &&
    Number(actualQuantity || 0) > 0 &&
    (!Number.isFinite(Number(actualPrice)) || Number(actualPrice) <= 0)
  ) {
    const error = new Error('actual_price is required and must be greater than 0');
    error.statusCode = 400;
    throw error;
  }

  await pool.query(
    `UPDATE purchase_walk_manual_items
     SET actual_quantity = ?,
         actual_price = ?,
         is_purchased = ?,
         purchase_reason = ?,
         branch_id = ?,
         updated_by_user_id = ?
     WHERE id = ?`,
    [actualQuantity, actualPrice, isPurchased, purchaseReason, branchId, userId || null, id]
  );

  const [rows] = await pool.query(
    `SELECT
       mi.id,
       mi.order_date,
       mi.product_group_id AS supplier_id,
       pg.name AS supplier_name,
       sm.id AS supplier_master_id,
       sm.name AS supplier_master_name,
       sm.has_bank_account AS supplier_has_bank_account,
       sm.bank_name AS supplier_bank_name,
       sm.account_number AS supplier_account_number,
       sm.account_name AS supplier_account_name,
       mi.branch_id,
       b.name AS branch_name,
       mi.base_product_id,
       mi.product_name,
       mi.unit_abbr,
       mi.unit_name,
       mi.actual_quantity,
       mi.actual_price,
       mi.is_purchased,
       mi.purchase_reason,
       mi.created_at,
       mi.updated_at
     FROM purchase_walk_manual_items mi
     LEFT JOIN product_groups pg ON pg.id = mi.product_group_id
     LEFT JOIN products bp ON bp.id = mi.base_product_id
     LEFT JOIN supplier_masters sm ON sm.id = bp.supplier_master_id
     LEFT JOIN branches b ON b.id = mi.branch_id
     WHERE mi.id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
};

export const deletePurchaseWalkManualItem = async (id, userId) => {
  await ensurePurchaseWalkManualTable();
  const [result] = await pool.query(
    `UPDATE purchase_walk_manual_items
     SET is_active = false,
         updated_by_user_id = ?
     WHERE id = ?
       AND is_active = true`,
    [userId || null, id]
  );
  return { id: Number(id), deleted: result.affectedRows > 0 };
};
