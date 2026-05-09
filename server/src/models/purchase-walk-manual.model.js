import pool from '../config/database.js';
import { ensureOrderReceivingColumns } from './order.model.js';

export const ensurePurchaseWalkManualTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS purchase_walk_manual_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_date DATE NOT NULL,
      product_group_id INT NOT NULL,
      branch_id INT NOT NULL,
      department_id INT NULL,
      receiving_order_item_id INT NULL,
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
      INDEX idx_pwm_department (department_id),
      INDEX idx_pwm_receiving_order_item (receiving_order_item_id),
      INDEX idx_pwm_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const [departmentColumns] = await pool.query(
    `SHOW COLUMNS FROM purchase_walk_manual_items LIKE 'department_id'`
  );
  if (departmentColumns.length === 0) {
    await pool.query(
      `ALTER TABLE purchase_walk_manual_items
       ADD COLUMN department_id INT NULL AFTER branch_id,
       ADD INDEX idx_pwm_department (department_id)`
    );
  }

  const [receivingColumns] = await pool.query(
    `SHOW COLUMNS FROM purchase_walk_manual_items LIKE 'receiving_order_item_id'`
  );
  if (receivingColumns.length === 0) {
    await pool.query(
      `ALTER TABLE purchase_walk_manual_items
       ADD COLUMN receiving_order_item_id INT NULL AFTER department_id,
       ADD INDEX idx_pwm_receiving_order_item (receiving_order_item_id)`
    );
  }
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

const generatePurchaseWalkOrderNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const time = now.getTime().toString().slice(-6);
  return `PW-${year}${month}${day}-${time}`;
};

const ensureDepartmentUserForPurchaseWalk = async (connection, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id
     FROM users
     WHERE department_id = ?
       AND is_active = true
     ORDER BY id
     LIMIT 1`,
    [departmentId]
  );
  if (rows.length > 0) return Number(rows[0].id);

  const [deptRows] = await connection.query(
    `SELECT id, name, code
     FROM departments
     WHERE id = ?
     LIMIT 1`,
    [departmentId]
  );
  if (deptRows.length === 0) {
    const error = new Error('department_id is invalid');
    error.statusCode = 400;
    throw error;
  }

  const dept = deptRows[0];
  const username = `dept_${departmentId}`;
  const role = String(dept.code || '').toUpperCase() === 'ADMIN' ? 'admin' : 'user';

  const [existingByUsername] = await connection.query(
    `SELECT id
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [username]
  );
  if (existingByUsername.length > 0) {
    const existingId = Number(existingByUsername[0].id);
    await connection.query(
      `UPDATE users
       SET name = ?, role = ?, department_id = ?, is_active = true
       WHERE id = ?`,
      [dept.name, role, departmentId, existingId]
    );
    return existingId;
  }

  const [insertResult] = await connection.query(
    `INSERT INTO users (username, name, role, department_id, is_active)
     VALUES (?, ?, ?, ?, true)`,
    [username, dept.name, role, departmentId]
  );
  return Number(insertResult.insertId);
};

const createPendingReceivingItemForManualPurchase = async ({
  connection,
  orderDate,
  departmentId,
  productGroupId,
  productId,
  quantity,
  createdByUserId
}) => {
  if (!Number.isFinite(Number(departmentId)) || Number(departmentId) <= 0) return null;
  if (!Number.isFinite(Number(productId)) || Number(productId) <= 0) return null;

  await ensureOrderReceivingColumns();

  const targetUserId = await ensureDepartmentUserForPurchaseWalk(connection, Number(departmentId));
  const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : 0;

  const [orderRows] = await connection.query(
    `SELECT id
     FROM orders
     WHERE user_id = ?
       AND order_date = ?
       AND status IN ('submitted', 'confirmed', 'completed')
       AND order_number LIKE 'PW-%'
     ORDER BY id DESC
     LIMIT 1`,
    [targetUserId, orderDate]
  );

  let orderId = orderRows[0]?.id || null;
  if (!orderId) {
    const [orderResult] = await connection.query(
      `INSERT INTO orders (order_number, user_id, order_date, status, total_amount, submitted_at)
       VALUES (?, ?, ?, 'confirmed', 0, NOW())`,
      [generatePurchaseWalkOrderNumber(), targetUserId, orderDate]
    );
    orderId = Number(orderResult.insertId);
  }

  const note = 'เพิ่มจากหน้าเดินซื้อของ';
  const [itemResult] = await connection.query(
    `INSERT INTO order_items
       (order_id, product_id, source_product_group_id, quantity, requested_price,
        received_quantity, is_received, received_at, received_by_user_id, receive_notes, purchase_reason, notes)
     VALUES (?, ?, ?, ?, NULL, NULL, false, NULL, NULL, NULL, ?, ?)`,
    [
      orderId,
      Number(productId),
      Number(productGroupId),
      safeQuantity,
      note,
      createdByUserId ? `${note} โดยผู้ใช้ ${createdByUserId}` : note
    ]
  );

  return Number(itemResult.insertId);
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
       mi.department_id,
       d.name AS department_name,
       mi.receiving_order_item_id,
       mi.base_product_id,
       mi.product_name,
       mi.unit_abbr,
       mi.unit_name,
       mi.actual_quantity,
       mi.actual_price,
       mi.is_purchased,
       mi.purchase_reason,
       bp.default_price,
       NULLIF(bp.latest_price_override, 0) AS latest_price_override,
       COALESCE(NULLIF(bp.latest_price_override, 0), lap.last_actual_price) AS last_actual_price,
       lrp.last_requested_price,
       oi.quantity AS receiving_order_quantity,
       oi.received_quantity,
       oi.is_received,
       oi.received_at,
       mi.created_at,
       mi.updated_at
     FROM purchase_walk_manual_items mi
     LEFT JOIN product_groups pg ON pg.id = mi.product_group_id
     LEFT JOIN products bp ON bp.id = mi.base_product_id
     LEFT JOIN order_items oi ON oi.id = mi.receiving_order_item_id
     LEFT JOIN (
       SELECT oi2.product_id, MAX(o2.order_date) AS last_date
       FROM order_items oi2
       JOIN orders o2 ON oi2.order_id = o2.id
       WHERE oi2.actual_price IS NOT NULL
         AND oi2.actual_price > 0
       GROUP BY oi2.product_id
     ) last ON last.product_id = bp.id
     LEFT JOIN (
       SELECT oi3.product_id, o3.order_date, MAX(oi3.actual_price) AS last_actual_price
       FROM order_items oi3
       JOIN orders o3 ON oi3.order_id = o3.id
       WHERE oi3.actual_price IS NOT NULL
         AND oi3.actual_price > 0
       GROUP BY oi3.product_id, o3.order_date
     ) lap ON lap.product_id = bp.id AND lap.order_date = last.last_date
     LEFT JOIN (
       SELECT oi4.product_id, MAX(o4.order_date) AS last_req_date
       FROM order_items oi4
       JOIN orders o4 ON oi4.order_id = o4.id
       WHERE oi4.requested_price IS NOT NULL
         AND oi4.requested_price > 0
       GROUP BY oi4.product_id
     ) lreq ON lreq.product_id = bp.id
     LEFT JOIN (
       SELECT oi5.product_id, o5.order_date, MAX(oi5.requested_price) AS last_requested_price
       FROM order_items oi5
       JOIN orders o5 ON oi5.order_id = o5.id
       WHERE oi5.requested_price IS NOT NULL
         AND oi5.requested_price > 0
       GROUP BY oi5.product_id, o5.order_date
     ) lrp ON lrp.product_id = bp.id AND lrp.order_date = lreq.last_req_date
     LEFT JOIN supplier_masters sm ON sm.id = bp.supplier_master_id
     LEFT JOIN branches b ON b.id = mi.branch_id
     LEFT JOIN departments d ON d.id = mi.department_id
     WHERE mi.order_date = ?
       AND mi.is_active = true
     ORDER BY mi.product_group_id ASC, mi.id ASC`,
    [date]
  );
  return rows;
};

export const createPurchaseWalkManualItem = async (payload, userId) => {
  await ensurePurchaseWalkManualTable();
  await ensureOrderReceivingColumns();
  validateRequired(payload);

  const orderDate = String(payload.order_date).trim();
  const productGroupId = Number(payload.product_group_id);
  const branchId = Number(payload.branch_id);
  const departmentId = toNumber(payload.department_id);
  const baseProductId = toNumber(payload.base_product_id);
  const productName = String(payload.product_name || '').trim();
  const unitAbbr = String(payload.unit_abbr || '').trim() || null;
  const unitName = String(payload.unit_name || '').trim() || null;
  const actualQuantity = toNumber(payload.actual_quantity, 0) || 0;
  const actualPrice = toNumber(payload.actual_price, null);
  const isPurchased = payload.is_purchased === true || payload.is_purchased === 1;
  const purchaseReason = String(payload.purchase_reason || '').trim() || null;

  if (!Number.isFinite(Number(departmentId)) || Number(departmentId) <= 0) {
    const error = new Error('department_id is required');
    error.statusCode = 400;
    throw error;
  }

  if (
    isPurchased &&
    Number(actualQuantity || 0) > 0 &&
    (!Number.isFinite(Number(actualPrice)) || Number(actualPrice) <= 0)
  ) {
    const error = new Error('actual_price is required and must be greater than 0');
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const receivingOrderItemId = await createPendingReceivingItemForManualPurchase({
      connection,
      orderDate,
      departmentId,
      productGroupId,
      productId: baseProductId,
      quantity: actualQuantity,
      createdByUserId: userId
    });

    const [result] = await connection.query(
      `INSERT INTO purchase_walk_manual_items
        (order_date, product_group_id, branch_id, department_id, receiving_order_item_id,
         base_product_id, product_name, unit_abbr, unit_name,
         actual_quantity, actual_price, is_purchased, purchase_reason, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderDate,
        productGroupId,
        branchId,
        departmentId,
        receivingOrderItemId,
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

    const [rows] = await connection.query(
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
         mi.department_id,
         d.name AS department_name,
         mi.receiving_order_item_id,
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
       LEFT JOIN departments d ON d.id = mi.department_id
       WHERE mi.id = ?
       LIMIT 1`,
      [result.insertId]
    );

    await connection.commit();
    return rows[0] || null;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
  const departmentId = payload.department_id !== undefined
    ? toNumber(payload.department_id, existing.department_id || null)
    : existing.department_id;

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
         department_id = ?,
         updated_by_user_id = ?
     WHERE id = ?`,
    [actualQuantity, actualPrice, isPurchased, purchaseReason, branchId, departmentId, userId || null, id]
  );

  // auto-clear latest_price_override เมื่อบันทึกราคาจริงสำเร็จ
  const baseProductId = existing.base_product_id;
  if (baseProductId && Number.isFinite(Number(actualPrice)) && Number(actualPrice) > 0) {
    try {
      await pool.query(
        `UPDATE products SET latest_price_override = NULL WHERE id = ? AND latest_price_override IS NOT NULL`,
        [baseProductId]
      );
    } catch {
      // ไม่ให้ error นี้กระทบ response หลัก
    }
  }

  if (existing.receiving_order_item_id) {
    await pool.query(
      `UPDATE order_items oi
       JOIN orders o ON o.id = oi.order_id
       SET oi.quantity = ?,
           oi.source_product_group_id = ?,
           oi.purchase_reason = COALESCE(oi.purchase_reason, 'เพิ่มจากหน้าเดินซื้อของ')
       WHERE oi.id = ?
         AND COALESCE(oi.is_received, false) = false
         AND oi.received_at IS NULL
         AND o.order_number LIKE 'PW-%'`,
      [actualQuantity, Number(existing.product_group_id), existing.receiving_order_item_id]
    );
  }

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
       mi.department_id,
       d.name AS department_name,
       mi.receiving_order_item_id,
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
     LEFT JOIN departments d ON d.id = mi.department_id
     WHERE mi.id = ?
     LIMIT 1`,
    [id]
  );

  return rows[0] || null;
};

export const deletePurchaseWalkManualItem = async (id, userId) => {
  await ensurePurchaseWalkManualTable();
  const [existingRows] = await pool.query(
    `SELECT receiving_order_item_id
     FROM purchase_walk_manual_items
     WHERE id = ?
       AND is_active = true
     LIMIT 1`,
    [id]
  );

  const [result] = await pool.query(
    `UPDATE purchase_walk_manual_items
     SET is_active = false,
         updated_by_user_id = ?
     WHERE id = ?
       AND is_active = true`,
    [userId || null, id]
  );

  const receivingOrderItemId = existingRows[0]?.receiving_order_item_id;
  if (receivingOrderItemId) {
    await pool.query(
      `DELETE oi
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.id = ?
         AND COALESCE(oi.is_received, false) = false
         AND oi.received_at IS NULL
         AND o.order_number LIKE 'PW-%'`,
      [receivingOrderItemId]
    );
  }

  return { id: Number(id), deleted: result.affectedRows > 0 };
};
