import pool from '../config/database.js';
import { ensureInventoryTables } from './inventory.model.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import {
  ensureWithdrawSourceMappingTable,
  getMappedSourceDepartmentByBranch
} from './withdraw-source-mapping.model.js';

let withdrawTablesEnsured = false;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeLimit = (value, fallback = 20) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
};

const generateWithdrawalNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const time = now.getTime().toString().slice(-6);
  return `WDR-${year}${month}${day}-${time}`;
};

const generateReceivingOrderNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const time = now.getTime().toString().slice(-6);
  return `RCV-${year}${month}${day}-${time}`;
};

export const ensureWithdrawTables = async () => {
  if (withdrawTablesEnsured) return;
  await ensureWithdrawSourceMappingTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_withdrawals (
      id INT PRIMARY KEY AUTO_INCREMENT,
      withdrawal_number VARCHAR(50) NOT NULL UNIQUE,
      source_department_id INT NOT NULL,
      target_department_id INT NOT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_source_department (source_department_id),
      INDEX idx_target_department (target_department_id),
      INDEX idx_created_at (created_at),
      CONSTRAINT fk_inventory_withdrawals_source_department
        FOREIGN KEY (source_department_id) REFERENCES departments(id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_withdrawals_target_department
        FOREIGN KEY (target_department_id) REFERENCES departments(id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_withdrawals_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_withdrawal_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      withdrawal_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity DECIMAL(10,2) NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_withdrawal_id (withdrawal_id),
      INDEX idx_product_id (product_id),
      CONSTRAINT fk_inventory_withdrawal_items_withdrawal
        FOREIGN KEY (withdrawal_id) REFERENCES inventory_withdrawals(id) ON DELETE CASCADE,
      CONSTRAINT fk_inventory_withdrawal_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  withdrawTablesEnsured = true;
};

const getDepartmentMap = async (connection, ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Map();
  }

  const [rows] = await connection.query(
    `SELECT d.id, d.name AS department_name, d.branch_id, d.is_production, b.name AS branch_name
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     WHERE d.id IN (?) AND d.is_active = true`,
    [ids]
  );

  return new Map(rows.map((row) => [Number(row.id), row]));
};

const ensureDepartmentUserForReceiving = async (connection, departmentId) => {
  const [rows] = await connection.query(
    `SELECT u.id
     FROM users u
     WHERE u.department_id = ?
       AND u.is_active = true
     ORDER BY u.id
     LIMIT 1`,
    [departmentId]
  );

  if (rows.length > 0) {
    return Number(rows[0].id);
  }

  const [deptRows] = await connection.query(
    `SELECT id, name, code
     FROM departments
     WHERE id = ?`,
    [departmentId]
  );
  if (deptRows.length === 0) {
    const error = new Error('ไม่พบแผนกปลายทาง');
    error.statusCode = 400;
    throw error;
  }

  const dept = deptRows[0];
  const username = `dept_${departmentId}`;
  const role = String(dept.code || '').toUpperCase() === 'ADMIN' ? 'admin' : 'user';

  const [existingByUsername] = await connection.query(
    `SELECT id, is_active
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

const createReceivingMirrorEntries = async ({
  connection,
  targetDepartmentId,
  createdBy,
  withdrawalNumber,
  items
}) => {
  await ensureOrderReceivingColumns();

  const targetUserId = await ensureDepartmentUserForReceiving(connection, targetDepartmentId);
  const today = new Date().toISOString().split('T')[0];
  const receivedAt = new Date();

  const [orderResult] = await connection.query(
    `INSERT INTO orders (
      order_number, user_id, order_date, status, total_amount, submitted_at
    ) VALUES (?, ?, ?, 'completed', 0, NOW())`,
    [generateReceivingOrderNumber(), targetUserId, today]
  );

  const orderId = Number(orderResult.insertId);
  if (!Number.isFinite(orderId)) return;

  const itemValues = items.map((item) => {
    const qty = toNumber(item.quantity, 0);
    const note = `ผ่านการเบิก ${withdrawalNumber}`;
    return [
      orderId,
      Number(item.product_id),
      qty,
      null,
      qty,
      true,
      receivedAt,
      createdBy || null,
      note,
      note
    ];
  });

  if (itemValues.length > 0) {
    await connection.query(
      `INSERT INTO order_items (
        order_id,
        product_id,
        quantity,
        requested_price,
        received_quantity,
        is_received,
        received_at,
        received_by_user_id,
        receive_notes,
        notes
      ) VALUES ?`,
      [itemValues]
    );
  }
};

const getProductMap = async (connection, productIds = []) => {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Map();
  }

  const [rows] = await connection.query(
    `SELECT p.id, p.name, p.code, p.is_countable,
            p.product_group_id AS product_group_id,
            u.name AS unit_name, u.abbreviation AS unit_abbr
     FROM products p
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE p.id IN (?) AND p.is_active = true`,
    [productIds]
  );

  return new Map(rows.map((row) => [Number(row.id), row]));
};

const lockBalanceRow = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT quantity
     FROM inventory_balance
     WHERE product_id = ? AND department_id = ?
     FOR UPDATE`,
    [productId, departmentId]
  );
  return rows.length > 0 ? toNumber(rows[0].quantity, 0) : 0;
};

const insertInventoryTransaction = async (
  connection,
  {
    productId,
    departmentId,
    transactionType,
    quantity,
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    notes,
    createdBy
  }
) => {
  const [txResult] = await connection.query(
    `INSERT INTO inventory_transactions
      (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
       reference_type, reference_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      departmentId,
      transactionType,
      quantity,
      balanceBefore,
      balanceAfter,
      referenceType,
      referenceId,
      notes,
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
    [productId, departmentId, balanceAfter, txResult.insertId]
  );
};

const normalizeItems = (items = []) => {
  const merged = new Map();

  for (const rawItem of Array.isArray(items) ? items : []) {
    const productId = Number(rawItem?.product_id);
    const quantity = Number(rawItem?.quantity);

    if (!Number.isFinite(productId)) {
      const error = new Error('product_id ไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error('quantity ต้องมากกว่า 0');
      error.statusCode = 400;
      throw error;
    }

    const itemNote = String(rawItem?.notes || '').trim();
    const existing = merged.get(productId) || { product_id: productId, quantity: 0, notes: '' };
    existing.quantity += quantity;

    if (itemNote) {
      existing.notes = existing.notes ? `${existing.notes} | ${itemNote}` : itemNote;
    }

    merged.set(productId, existing);
  }

  return Array.from(merged.values());
};

export const getWithdrawTargets = async ({ sourceDepartmentId, isAdmin = false }) => {
  await ensureWithdrawTables();

  const sourceId = Number(sourceDepartmentId);
  const hasSourceDepartment = Number.isFinite(sourceId) && sourceId > 0;
  let sourceIsProduction = false;

  if (hasSourceDepartment) {
    const [sourceRows] = await pool.query(
      `SELECT is_production
       FROM departments
       WHERE id = ? AND is_active = true
       LIMIT 1`,
      [sourceId]
    );
    sourceIsProduction = Number(sourceRows?.[0]?.is_production ?? 0) === 1;
  }

  let query = `
    SELECT d.id, d.name AS department_name, d.branch_id, b.name AS branch_name,
           m.source_department_id AS mapped_source_department_id
    FROM departments d
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN withdraw_branch_source_mappings m ON m.target_branch_id = d.branch_id
    WHERE d.is_active = true
  `;
  const params = [];

  if (hasSourceDepartment) {
    query += ' AND d.id <> ?';
    params.push(sourceId);
  }

  // ฝ่ายผลิตสามารถเบิกได้ทุกสาขา/แผนก (ยกเว้นแผนกตัวเอง)
  // ส่วนแผนกอื่นยังคงใช้ผังผูกสาขา -> พื้นที่เก็บเดิม
  if (!isAdmin && hasSourceDepartment && !sourceIsProduction) {
    query += ' AND (m.source_department_id IS NULL OR m.source_department_id = ?)';
    params.push(sourceId);
  }

  query += ' ORDER BY b.name, d.name';

  const [rows] = await pool.query(query, params);

  return rows;
};

export const getWithdrawProducts = async ({ allowedProductGroupIds = [], search = '', limit = 200 }) => {
  await ensureWithdrawTables();

  let query = `
    SELECT p.id, p.name, p.code, p.is_countable,
           p.product_group_id AS product_group_id,
           s.name AS product_group_name,
           u.name AS unit_name,
           u.abbreviation AS unit_abbr
    FROM products p
    LEFT JOIN product_groups s ON p.product_group_id = s.id
    LEFT JOIN units u ON p.unit_id = u.id
    WHERE p.is_active = true
  `;

  const params = [];
  const normalizedGroups = Array.isArray(allowedProductGroupIds)
    ? allowedProductGroupIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
    : [];

  if (normalizedGroups.length > 0) {
    query += ' AND p.product_group_id IN (?)';
    params.push(normalizedGroups);
  }

  const keyword = String(search || '').trim();
  if (keyword) {
    query += ' AND (p.name LIKE ? OR p.code LIKE ?)';
    const like = `%${keyword}%`;
    params.push(like, like);
  }

  query += ' ORDER BY p.name LIMIT ?';
  params.push(normalizeLimit(limit, 200));

  const [rows] = await pool.query(query, params);
  return rows;
};

export const getWithdrawHistory = async ({ sourceDepartmentId, limit = 20 }) => {
  await ensureWithdrawTables();

  const [rows] = await pool.query(
    `SELECT
      iw.id,
      iw.withdrawal_number,
      iw.source_department_id,
      iw.target_department_id,
      iw.notes,
      iw.created_at,
      sd.name AS source_department_name,
      sb.name AS source_branch_name,
      td.name AS target_department_name,
      tb.name AS target_branch_name,
      u.name AS created_by_name,
      COUNT(iwi.id) AS item_count,
      COALESCE(SUM(iwi.quantity), 0) AS total_quantity
     FROM inventory_withdrawals iw
     JOIN departments sd ON iw.source_department_id = sd.id
     JOIN branches sb ON sd.branch_id = sb.id
     JOIN departments td ON iw.target_department_id = td.id
     JOIN branches tb ON td.branch_id = tb.id
     LEFT JOIN users u ON iw.created_by = u.id
     LEFT JOIN inventory_withdrawal_items iwi ON iw.id = iwi.withdrawal_id
     WHERE iw.source_department_id = ?
     GROUP BY iw.id
     ORDER BY iw.created_at DESC
     LIMIT ?`,
    [Number(sourceDepartmentId), normalizeLimit(limit, 20)]
  );

  return rows;
};

export const getWithdrawById = async ({ id, sourceDepartmentId, isAdmin = false }) => {
  await ensureWithdrawTables();

  const withdrawId = Number(id);
  if (!Number.isFinite(withdrawId)) {
    const error = new Error('withdrawal id ไม่ถูกต้อง');
    error.statusCode = 400;
    throw error;
  }

  const [[header]] = await pool.query(
    `SELECT
      iw.id, iw.withdrawal_number, iw.source_department_id, iw.target_department_id,
      iw.notes, iw.created_at,
      sd.name AS source_department_name, sb.name AS source_branch_name,
      td.name AS target_department_name, tb.name AS target_branch_name,
      u.name AS created_by_name
     FROM inventory_withdrawals iw
     JOIN departments sd ON iw.source_department_id = sd.id
     JOIN branches sb ON sd.branch_id = sb.id
     JOIN departments td ON iw.target_department_id = td.id
     JOIN branches tb ON td.branch_id = tb.id
     LEFT JOIN users u ON iw.created_by = u.id
     WHERE iw.id = ?`,
    [withdrawId]
  );

  if (!header) {
    const error = new Error('ไม่พบรายการเบิกสินค้า');
    error.statusCode = 404;
    throw error;
  }

  // ตรวจสิทธิ์: ต้องเป็น source department เดียวกัน หรือ admin
  if (!isAdmin) {
    const sourceId = Number(sourceDepartmentId);
    if (Number(header.source_department_id) !== sourceId) {
      const error = new Error('ไม่มีสิทธิ์ดูรายการเบิกนี้');
      error.statusCode = 403;
      throw error;
    }
  }

  const [items] = await pool.query(
    `SELECT
      iwi.id, iwi.product_id, iwi.quantity, iwi.notes,
      p.name AS product_name, p.code AS product_code,
      u.name AS unit_name, u.abbreviation AS unit_abbr
     FROM inventory_withdrawal_items iwi
     JOIN products p ON iwi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE iwi.withdrawal_id = ?
     ORDER BY iwi.id`,
    [withdrawId]
  );

  return { ...header, items };
};

export const updateWithdrawal = async ({
  id,
  sourceDepartmentId,
  updatedBy,
  notes,
  items = [],
  isAdmin = false
}) => {
  await ensureWithdrawTables();
  await ensureInventoryTables();

  const withdrawId = Number(id);
  if (!Number.isFinite(withdrawId)) {
    const error = new Error('withdrawal id ไม่ถูกต้อง');
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ดึง header ปัจจุบัน
    const [[header]] = await connection.query(
      `SELECT iw.*, sd.is_production AS source_is_production
       FROM inventory_withdrawals iw
       JOIN departments sd ON iw.source_department_id = sd.id
       WHERE iw.id = ? FOR UPDATE`,
      [withdrawId]
    );
    if (!header) {
      const error = new Error('ไม่พบรายการเบิกสินค้า');
      error.statusCode = 404;
      throw error;
    }

    // ตรวจสิทธิ์
    if (!isAdmin && Number(header.source_department_id) !== Number(sourceDepartmentId)) {
      const error = new Error('ไม่มีสิทธิ์แก้ไขรายการเบิกนี้');
      error.statusCode = 403;
      throw error;
    }

    const sourceId = Number(header.source_department_id);
    const targetId = Number(header.target_department_id);

    // ดึง items เดิม
    const [oldItems] = await connection.query(
      `SELECT iwi.id, iwi.product_id, iwi.quantity, p.is_countable
       FROM inventory_withdrawal_items iwi
       JOIN products p ON iwi.product_id = p.id
       WHERE iwi.withdrawal_id = ?`,
      [withdrawId]
    );

    // สร้าง map items ใหม่ keyed by product_id
    const newItemMap = new Map();
    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = Number(item.quantity);
      if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty < 0) continue;
      newItemMap.set(productId, { quantity: qty, notes: String(item.notes || '').trim() || null });
    }

    // ย้อน inventory ของ items เดิม แล้วใส่ qty ใหม่
    for (const oldItem of oldItems) {
      const productId = Number(oldItem.product_id);
      const oldQty = Number(oldItem.quantity);
      const isCountable = Number(oldItem.is_countable ?? 1) === 1;
      const newEntry = newItemMap.get(productId);
      const newQty = newEntry != null ? Number(newEntry.quantity) : oldQty;
      const diff = newQty - oldQty; // บวก = เพิ่ม, ลบ = ลด

      // อัปเดต item row
      if (newEntry != null) {
        await connection.query(
          `UPDATE inventory_withdrawal_items SET quantity = ?, notes = ? WHERE id = ?`,
          [newQty, newEntry.notes, oldItem.id]
        );
      }

      if (!isCountable || diff === 0) continue;

      // ย้อน/ปรับ inventory balance ทั้งสองฝั่ง
      const sourceBefore = await lockBalanceRow(connection, productId, sourceId);
      const sourceAfter = sourceBefore - diff;
      await insertInventoryTransaction(connection, {
        productId,
        departmentId: sourceId,
        transactionType: 'transfer_out',
        quantity: -diff,
        balanceBefore: sourceBefore,
        balanceAfter: sourceAfter,
        referenceType: 'withdrawal_update',
        referenceId: String(withdrawId),
        notes: `แก้ไขใบเบิก ${header.withdrawal_number}: ${oldQty} → ${newQty}`,
        createdBy: updatedBy
      });

      const targetBefore = await lockBalanceRow(connection, productId, targetId);
      const targetAfter = targetBefore + diff;
      await insertInventoryTransaction(connection, {
        productId,
        departmentId: targetId,
        transactionType: 'transfer_in',
        quantity: diff,
        balanceBefore: targetBefore,
        balanceAfter: targetAfter,
        referenceType: 'withdrawal_update',
        referenceId: String(withdrawId),
        notes: `แก้ไขใบเบิก ${header.withdrawal_number}: ${oldQty} → ${newQty}`,
        createdBy: updatedBy
      });
    }

    // อัปเดต notes header
    if (notes !== undefined) {
      await connection.query(
        `UPDATE inventory_withdrawals SET notes = ? WHERE id = ?`,
        [String(notes || '').trim() || null, withdrawId]
      );
    }

    await connection.commit();

    // ดึงข้อมูลใหม่หลังแก้ไข
    const sourceIdForFetch = isAdmin ? null : Number(sourceDepartmentId);
    return getWithdrawById({ id: withdrawId, sourceDepartmentId: sourceIdForFetch, isAdmin });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

export const createWithdrawal = async ({
  sourceDepartmentId,
  targetDepartmentId,
  createdBy,
  notes,
  items,
  allowedProductGroupIds = [],
  isAdmin = false
}) => {
  await ensureWithdrawTables();
  await ensureInventoryTables();

  const sourceId = Number(sourceDepartmentId);
  const targetId = Number(targetDepartmentId);
  if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
    const error = new Error('source_department_id และ target_department_id ต้องถูกต้อง');
    error.statusCode = 400;
    throw error;
  }

  if (sourceId === targetId) {
    const error = new Error('ไม่สามารถเบิกไปยังแผนกเดียวกันได้');
    error.statusCode = 400;
    throw error;
  }

  const normalizedItems = normalizeItems(items);
  if (normalizedItems.length === 0) {
    const error = new Error('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const departmentMap = await getDepartmentMap(connection, [sourceId, targetId]);
    if (!departmentMap.get(sourceId)) {
      const error = new Error('ไม่พบแผนกต้นทาง');
      error.statusCode = 400;
      throw error;
    }
    if (!departmentMap.get(targetId)) {
      const error = new Error('ไม่พบแผนกปลายทาง');
      error.statusCode = 400;
      throw error;
    }

    const targetBranchId = Number(departmentMap.get(targetId)?.branch_id);
    const sourceIsProduction = Number(departmentMap.get(sourceId)?.is_production ?? 0) === 1;

    if (!sourceIsProduction) {
      const mappedSource = await getMappedSourceDepartmentByBranch({
        targetBranchId,
        connection
      });

      if (
        mappedSource &&
        Number.isFinite(Number(mappedSource.source_department_id)) &&
        Number(mappedSource.source_department_id) !== sourceId
      ) {
        const error = new Error(
          `สาขาปลายทางนี้ต้องเบิกจาก ${mappedSource.source_branch_name || ''} / ${mappedSource.source_department_name || ''}`.trim()
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const productIds = normalizedItems.map((item) => Number(item.product_id));
    const productMap = await getProductMap(connection, productIds);

    if (productMap.size !== productIds.length) {
      const error = new Error('มีสินค้าบางรายการไม่ถูกต้องหรือถูกปิดใช้งาน');
      error.statusCode = 400;
      throw error;
    }

    const allowedGroups = new Set(
      Array.isArray(allowedProductGroupIds)
        ? allowedProductGroupIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
        : []
    );

    if (!isAdmin && allowedGroups.size > 0) {
      const blocked = normalizedItems.find((item) => {
        const product = productMap.get(Number(item.product_id));
        const productGroupId = Number(product?.product_group_id);
        return !allowedGroups.has(productGroupId);
      });

      if (blocked) {
        const blockedProduct = productMap.get(Number(blocked.product_id));
        const error = new Error(`ไม่มีสิทธิ์เบิกสินค้า ${blockedProduct?.name || ''}`.trim());
        error.statusCode = 403;
        throw error;
      }
    }

    const withdrawalNumber = generateWithdrawalNumber();
    const [headerResult] = await connection.query(
      `INSERT INTO inventory_withdrawals
       (withdrawal_number, source_department_id, target_department_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [withdrawalNumber, sourceId, targetId, String(notes || '').trim() || null, createdBy || null]
    );

    const withdrawalId = headerResult.insertId;

    const itemValues = normalizedItems.map((item) => [
      withdrawalId,
      Number(item.product_id),
      Number(item.quantity),
      item.notes ? String(item.notes).trim() : null
    ]);

    await connection.query(
      `INSERT INTO inventory_withdrawal_items
       (withdrawal_id, product_id, quantity, notes)
       VALUES ?`,
      [itemValues]
    );

    for (const item of normalizedItems) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);
      const product = productMap.get(productId);
      const isCountable = Number(product?.is_countable ?? 1) === 1;

      if (!isCountable) {
        continue;
      }

      const sourceBefore = await lockBalanceRow(connection, productId, sourceId);
      const sourceAfter = sourceBefore - quantity;

      await insertInventoryTransaction(connection, {
        productId,
        departmentId: sourceId,
        transactionType: 'transfer_out',
        quantity: -quantity,
        balanceBefore: sourceBefore,
        balanceAfter: sourceAfter,
        referenceType: 'withdrawal',
        referenceId: String(withdrawalId),
        notes: `เบิกสินค้าไปยัง ${departmentMap.get(targetId)?.department_name || ''}`,
        createdBy
      });

      const targetBefore = await lockBalanceRow(connection, productId, targetId);
      const targetAfter = targetBefore + quantity;

      await insertInventoryTransaction(connection, {
        productId,
        departmentId: targetId,
        transactionType: 'transfer_in',
        quantity,
        balanceBefore: targetBefore,
        balanceAfter: targetAfter,
        referenceType: 'withdrawal',
        referenceId: String(withdrawalId),
        notes: `รับสินค้าเบิกจาก ${departmentMap.get(sourceId)?.department_name || ''}`,
        createdBy
      });
    }

    await createReceivingMirrorEntries({
      connection,
      targetDepartmentId: targetId,
      createdBy,
      withdrawalNumber,
      items: normalizedItems
    });

    await connection.commit();

    return {
      id: withdrawalId,
      withdrawal_number: withdrawalNumber,
      source_department_id: sourceId,
      target_department_id: targetId,
      notes: String(notes || '').trim() || null,
      created_at: new Date().toISOString(),
      items: normalizedItems.map((item) => {
        const product = productMap.get(Number(item.product_id));
        return {
          product_id: Number(item.product_id),
          product_name: product?.name || '-',
          product_code: product?.code || '-',
          unit_name: product?.unit_name || null,
          unit_abbr: product?.unit_abbr || null,
          quantity: Number(item.quantity),
          notes: item.notes || null
        };
      })
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
