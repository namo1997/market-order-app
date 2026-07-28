import pool from '../config/database.js';
import { ensureInventoryTables } from './inventory.model.js';
import {
  ensureSupplierColumns,
  ensureProductGroupWithdrawSourceTable,
  ensureSupplierScopeTable,
  getMappedSourceDepartmentByProductGroup
} from './supplier.model.js';
import { ensureWithdrawSourceMappingTable } from './withdraw-source-mapping.model.js';

export const ensureOrderTransferColumns = async () => {
  const columns = [
    { name: 'transferred_at', definition: 'TIMESTAMP NULL' },
    { name: 'transferred_from_department_id', definition: 'INT NULL' },
    { name: 'transferred_from_branch_id', definition: 'INT NULL' }
  ];

  for (const column of columns) {
    const [rows] = await pool.query(
      'SHOW COLUMNS FROM orders LIKE ?',
      [column.name]
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE orders ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
};

let ensureOrderItemSourceGroupColumnPromise = null;
export const ensureOrderItemSourceGroupColumn = async () => {
  if (ensureOrderItemSourceGroupColumnPromise) {
    return ensureOrderItemSourceGroupColumnPromise;
  }

  ensureOrderItemSourceGroupColumnPromise = (async () => {
    const [rows] = await pool.query(
      "SHOW COLUMNS FROM order_items LIKE 'source_product_group_id'"
    );
    if (rows.length === 0) {
      await pool.query(
        'ALTER TABLE order_items ADD COLUMN source_product_group_id INT NULL AFTER product_id'
      );
    }
  })().catch((error) => {
    ensureOrderItemSourceGroupColumnPromise = null;
    throw error;
  });

  return ensureOrderItemSourceGroupColumnPromise;
};

let ensureProductCarryoverColumnPromise = null;
const ensureProductCarryoverColumn = async () => {
  if (ensureProductCarryoverColumnPromise) {
    return ensureProductCarryoverColumnPromise;
  }

  ensureProductCarryoverColumnPromise = (async () => {
    const [rows] = await pool.query(
      "SHOW COLUMNS FROM products LIKE 'allow_pending_carryover'"
    );
    if (rows.length === 0) {
      await pool.query(
        'ALTER TABLE products ADD COLUMN allow_pending_carryover BOOLEAN NOT NULL DEFAULT false AFTER is_countable'
      );
    }
  })().catch((error) => {
    ensureProductCarryoverColumnPromise = null;
    throw error;
  });

  return ensureProductCarryoverColumnPromise;
};

export const ensureOrderReceivingColumns = async () => {
  await ensureOrderItemSourceGroupColumn();
  await ensureProductCarryoverColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureSupplierColumns();
  await ensureProductGroupWithdrawSourceTable();
  await ensureSupplierScopeTable();

  const columns = [
    { name: 'received_quantity', definition: 'DECIMAL(10,2) NULL' },
    { name: 'received_by_user_id', definition: 'INT NULL' },
    { name: 'received_at', definition: 'TIMESTAMP NULL' },
    { name: 'receive_notes', definition: 'TEXT NULL' },
    { name: 'purchase_reason', definition: 'TEXT NULL' },
    { name: 'is_received', definition: 'BOOLEAN DEFAULT false' }
  ];

  for (const column of columns) {
    const [rows] = await pool.query(
      'SHOW COLUMNS FROM order_items LIKE ?',
      [column.name]
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE order_items ADD COLUMN ${column.name} ${column.definition}`
      );
    }
  }
};

const toNumeric = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toPositiveIntOrNull = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
};

const getProvidedSourceGroupId = (item = {}) =>
  toPositiveIntOrNull(
    item.source_product_group_id ??
    item.sourceProductGroupId ??
    item.supplier_id ??
    item.product_group_id
  );

const getOrderContextByUserId = async (connection, userId) => {
  const [rows] = await connection.query(
    `SELECT b.id AS branch_id, d.id AS department_id
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN branches b ON b.id = d.branch_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    return { branchId: null, departmentId: null };
  }

  return {
    branchId: toPositiveIntOrNull(rows[0].branch_id),
    departmentId: toPositiveIntOrNull(rows[0].department_id)
  };
};

const resolveSourceProductGroupIdForItem = async ({
  connection,
  item,
  branchId,
  departmentId
}) => {
  const explicitGroupId = getProvidedSourceGroupId(item);
  if (explicitGroupId) {
    return explicitGroupId;
  }

  const productId = toPositiveIntOrNull(item?.product_id);
  if (!productId) {
    const error = new Error('ไม่พบรหัสสินค้าในคำสั่งซื้อ');
    error.statusCode = 400;
    throw error;
  }

  const [productRows] = await connection.query(
    `SELECT id, name, product_group_id
     FROM products
     WHERE id = ?
     LIMIT 1`,
    [productId]
  );

  if (productRows.length === 0) {
    const error = new Error(`ไม่พบสินค้า (ID: ${productId})`);
    error.statusCode = 400;
    throw error;
  }

  const product = productRows[0];
  const productName = String(product.name || `ID:${productId}`);
  const safeBranchId = toPositiveIntOrNull(branchId);
  const safeDepartmentId = toPositiveIntOrNull(departmentId);

  const [scopeRows] = await connection.query(
    `SELECT 1
     FROM product_group_links pgl
     JOIN product_group_scopes pgs ON pgs.product_group_id = pgl.product_group_id
     WHERE pgl.product_id = ?
     LIMIT 1`,
    [productId]
  );
  const hasScopedGroup = scopeRows.length > 0;

  let candidateGroupRows = [];
  if (hasScopedGroup && safeBranchId && safeDepartmentId) {
    const [rows] = await connection.query(
      `SELECT DISTINCT pg.id
       FROM product_group_links pgl
       JOIN product_groups pg ON pg.id = pgl.product_group_id
       JOIN product_group_scopes pgs ON pgs.product_group_id = pg.id
       WHERE pgl.product_id = ?
         AND pg.is_active = true
         AND pgs.branch_id = ?
         AND pgs.department_id = ?
       ORDER BY pgl.is_primary DESC, pg.id`,
      [productId, safeBranchId, safeDepartmentId]
    );
    candidateGroupRows = rows;
  } else {
    const [rows] = await connection.query(
      `SELECT DISTINCT pg.id
       FROM product_group_links pgl
       JOIN product_groups pg ON pg.id = pgl.product_group_id
       WHERE pgl.product_id = ?
         AND pg.is_active = true
       ORDER BY pgl.is_primary DESC, pg.id`,
      [productId]
    );
    candidateGroupRows = rows;
  }

  if (candidateGroupRows.length === 1) {
    return toPositiveIntOrNull(candidateGroupRows[0].id);
  }

  if (candidateGroupRows.length > 1) {
    const error = new Error(`กรุณาเลือกกลุ่มสินค้าก่อนบันทึก: ${productName}`);
    error.statusCode = 400;
    throw error;
  }

  const primaryGroupId = toPositiveIntOrNull(product.product_group_id);
  if (primaryGroupId) {
    return primaryGroupId;
  }

  const error = new Error(`ไม่พบกลุ่มสินค้าของสินค้า: ${productName}`);
  error.statusCode = 400;
  throw error;
};

const AUTO_RECEIVE_NOTE = 'รับอัตโนมัติวันถัดไป (ไม่มีผู้กดรับสินค้า)';
const AUTO_RECEIVE_CUTOFF_HOUR = 23;
const AUTO_RECEIVE_CUTOFF_MINUTE = 30;

const createInventoryTransactionForReceiving = async ({
  connection,
  context,
  deltaQuantity,
  userId,
  noteOverride
}) => {
  const delta = toNumeric(deltaQuantity, 0);
  if (delta === 0) return null;

  const isCountable = Number(context?.is_countable ?? 1) === 1;
  if (!isCountable) return null;

  const productId = Number(context?.product_id);
  const departmentId = Number(context?.department_id);
  if (!Number.isFinite(productId) || !Number.isFinite(departmentId)) return null;

  const [balanceRows] = await connection.query(
    `SELECT quantity
     FROM inventory_balance
     WHERE product_id = ? AND department_id = ?
     FOR UPDATE`,
    [productId, departmentId]
  );

  const balanceBefore = balanceRows.length > 0 ? toNumeric(balanceRows[0].quantity, 0) : 0;
  const balanceAfter = balanceBefore + delta;
  const transactionType = delta >= 0 ? 'receive' : 'adjustment';
  const receiveLocation = [context?.branch_name, context?.department_name].filter(Boolean).join(' / ');
  const defaultNote = delta >= 0
    ? `รับสินค้าเข้าคลัง ${receiveLocation}`.trim()
    : `ปรับปรุงรับสินค้าเข้าคลัง ${receiveLocation}`.trim();
  const note = String(noteOverride || '').trim() || defaultNote;

  const [txResult] = await connection.query(
    `INSERT INTO inventory_transactions
      (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
       reference_type, reference_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'order_receiving', ?, ?, ?)`,
    [
      productId,
      departmentId,
      transactionType,
      delta,
      balanceBefore,
      balanceAfter,
      String(context.order_item_id || ''),
      note,
      userId || null
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

  return txResult.insertId;
};

const createInventoryTransactionsForInternalTransfer = async ({
  connection,
  context,
  deltaQuantity,
  sourceDepartmentId,
  sourceDepartmentName,
  userId,
  noteOverride
}) => {
  const delta = toNumeric(deltaQuantity, 0);
  if (delta === 0) return null;

  const isCountable = Number(context?.is_countable ?? 1) === 1;
  if (!isCountable) return null;

  const productId = Number(context?.product_id);
  const targetDepartmentId = Number(context?.department_id);
  const sourceId = Number(sourceDepartmentId);

  if (
    !Number.isFinite(productId) ||
    !Number.isFinite(targetDepartmentId) ||
    !Number.isFinite(sourceId) ||
    sourceId === targetDepartmentId
  ) {
    return null;
  }

  const lockOrder =
    sourceId < targetDepartmentId
      ? [sourceId, targetDepartmentId]
      : [targetDepartmentId, sourceId];

  const balances = new Map();
  for (const departmentId of lockOrder) {
    const [rows] = await connection.query(
      `SELECT quantity
       FROM inventory_balance
       WHERE product_id = ? AND department_id = ?
       FOR UPDATE`,
      [productId, departmentId]
    );
    balances.set(
      departmentId,
      rows.length > 0 ? toNumeric(rows[0].quantity, 0) : 0
    );
  }

  const sourceBefore = balances.get(sourceId) || 0;
  const targetBefore = balances.get(targetDepartmentId) || 0;
  const absDelta = Math.abs(delta);
  const sourceQuantity = delta > 0 ? -absDelta : absDelta;
  const targetQuantity = delta > 0 ? absDelta : -absDelta;
  const sourceType = delta > 0 ? 'transfer_out' : 'transfer_in';
  const targetType = delta > 0 ? 'transfer_in' : 'transfer_out';
  const sourceAfter = sourceBefore + sourceQuantity;
  const targetAfter = targetBefore + targetQuantity;
  const targetBranchName = context.branch_name || '';
  const targetDepartmentName = context.department_name || '';
  const targetLocation = [targetBranchName, targetDepartmentName].filter(Boolean).join(' / ');
  const sourceName = sourceDepartmentName || '';

  const sourceDefaultNote = delta > 0
    ? `ตัดจ่ายจากพื้นที่จัดเก็บไปยัง ${targetLocation}`.trim()
    : `รับคืนเข้าพื้นที่จัดเก็บจาก ${targetLocation}`.trim();
  const targetDefaultNote = delta > 0
    ? `รับสินค้าเบิกจากพื้นที่จัดเก็บ ${sourceName} เข้า ${targetLocation}`.trim()
    : `คืนสินค้าไปพื้นที่จัดเก็บ ${sourceName} จาก ${targetLocation}`.trim();

  const sourceNote = String(noteOverride || '').trim() || sourceDefaultNote;
  const targetNote = String(noteOverride || '').trim() || targetDefaultNote;

  const [sourceTxResult] = await connection.query(
    `INSERT INTO inventory_transactions
      (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
       reference_type, reference_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'order_receiving', ?, ?, ?)`,
    [
      productId,
      sourceId,
      sourceType,
      sourceQuantity,
      sourceBefore,
      sourceAfter,
      String(context.order_item_id || ''),
      sourceNote,
      userId || null
    ]
  );

  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, sourceId, sourceAfter, sourceTxResult.insertId]
  );

  const [targetTxResult] = await connection.query(
    `INSERT INTO inventory_transactions
      (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
       reference_type, reference_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'order_receiving', ?, ?, ?)`,
    [
      productId,
      targetDepartmentId,
      targetType,
      targetQuantity,
      targetBefore,
      targetAfter,
      String(context.order_item_id || ''),
      targetNote,
      userId || null
    ]
  );

  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, targetDepartmentId, targetAfter, targetTxResult.insertId]
  );

  return {
    source_transaction_id: sourceTxResult.insertId,
    target_transaction_id: targetTxResult.insertId
  };
};

const updateOrderItemReceivingWithInventory = async ({
  connection,
  orderItemId,
  receivedQuantity,
  userId,
  receiveNotes
}) => {
  const [rows] = await connection.query(
    `SELECT
      oi.id AS order_item_id,
      oi.product_id,
      oi.quantity,
      oi.received_quantity,
      o.order_number,
      d.id AS department_id,
      d.name AS department_name,
      b.name AS branch_name,
      p.name AS product_name,
      p.product_group_id AS primary_product_group_id,
      pg.id AS product_group_id,
      pg.name AS product_group_name,
      pg.code AS product_group_code,
      COALESCE(pg.is_internal, false) AS is_internal_group,
      COALESCE(p.is_countable, true) AS is_countable,
      COALESCE(p.allow_pending_carryover, false) AS allow_pending_carryover
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN product_groups pg
       ON pg.id = COALESCE(
         oi.source_product_group_id,
         (
           SELECT pg_explicit.id
           FROM product_group_links pgl_explicit
           JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
           JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
           WHERE pgl_explicit.product_id = p.id
             AND pg_explicit.is_active = true
             AND pgws.source_department_id = wbm.source_department_id
           ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
           LIMIT 1
         ),
         (
           SELECT pg_scope.id
           FROM product_group_links pgl_scope
           JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
           JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
           WHERE pgl_scope.product_id = p.id
             AND pg_scope.is_active = true
             AND pgs_scope.branch_id = b.id
             AND pgs_scope.department_id = d.id
           ORDER BY pgl_scope.is_primary DESC, pg_scope.id
           LIMIT 1
         ),
         (
           SELECT pg_map.id
           FROM product_group_links pgl_map
           JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
           WHERE pgl_map.product_id = p.id
             AND pg_map.is_internal = true
             AND pg_map.linked_department_id = wbm.source_department_id
           ORDER BY pg_map.id
           LIMIT 1
         ),
         p.product_group_id
       )
     WHERE oi.id = ?
     FOR UPDATE`,
    [orderItemId]
  );

  if (rows.length === 0) return 0;

  const context = rows[0];
  const orderedQuantity = toNumeric(context.quantity, 0);
  const previousReceived = toNumeric(context.received_quantity, 0);
  const parsedReceivedQuantity =
    receivedQuantity === '' || receivedQuantity === null || receivedQuantity === undefined
      ? null
      : Number(receivedQuantity);
  const hasReceivedInput = Number.isFinite(parsedReceivedQuantity);
  const nextReceived = hasReceivedInput ? toNumeric(parsedReceivedQuantity, 0) : 0;
  const allowPendingCarryover = Number(context.allow_pending_carryover || 0) === 1;
  const effectiveIsReceived =
    hasReceivedInput && (!allowPendingCarryover || nextReceived >= orderedQuantity);
  const receivedAt = hasReceivedInput ? new Date() : null;
  const receivedBy = hasReceivedInput ? userId : null;
  const storedReceivedQuantity = hasReceivedInput ? nextReceived : null;
  const shouldSyncOrderedQuantity =
    orderedQuantity <= 0 && hasReceivedInput && nextReceived > 0;

  const updateSets = [
    'received_quantity = ?',
    'is_received = ?',
    'received_at = ?',
    'received_by_user_id = ?'
  ];
  const updateParams = [storedReceivedQuantity, effectiveIsReceived, receivedAt, receivedBy];

  if (shouldSyncOrderedQuantity) {
    updateSets.push('quantity = ?');
    updateParams.push(nextReceived);
  }
  if (receiveNotes !== undefined) {
    updateSets.push('receive_notes = ?');
    updateParams.push(receiveNotes);
  }

  updateParams.push(orderItemId);
  await connection.query(
    `UPDATE order_items
     SET ${updateSets.join(',\n           ')}
     WHERE id = ?`,
    updateParams
  );

  const delta = nextReceived - previousReceived;
  const isInternalGroup = Number(context?.is_internal_group ?? 0) === 1;
  const productGroupId = Number(context?.product_group_id);
  const explicitSourceDepartment =
    Number.isFinite(productGroupId)
      ? await getMappedSourceDepartmentByProductGroup({
        connection,
        productGroupId
      })
      : null;
  const explicitSourceDepartmentId = Number(explicitSourceDepartment?.source_department_id);

  // ตัดสินใจโอนด้วย explicit source ของกลุ่มสินค้าโดยตรง (ไม่อิงชื่อกลุ่มว่าเป็นสโตร์)
  if (
    delta !== 0 &&
    isInternalGroup &&
    Number.isFinite(explicitSourceDepartmentId)
  ) {
    if (
      explicitSourceDepartmentId !== Number(context.department_id)
    ) {
      await createInventoryTransactionsForInternalTransfer({
        connection,
        context,
        deltaQuantity: delta,
        sourceDepartmentId: explicitSourceDepartmentId,
        sourceDepartmentName: explicitSourceDepartment?.source_department_name || null,
        userId,
        noteOverride: receiveNotes
      });
    } else {
      await createInventoryTransactionForReceiving({
        connection,
        context,
        deltaQuantity: delta,
        userId,
        noteOverride: receiveNotes
      });
    }
  } else {
    await createInventoryTransactionForReceiving({
      connection,
      context,
      deltaQuantity: delta,
      userId,
      noteOverride: receiveNotes
    });
  }

  return 1;
};

// ตรวจสอบสถานะการเปิด/ปิดรับออเดอร์
export const getOrderStatus = async (date) => {
  const [rows] = await pool.query(
    'SELECT * FROM order_status_settings WHERE order_date = ?',
    [date]
  );

  if (rows.length === 0) {
    // ถ้าไม่มีข้อมูล ให้ถือว่าเปิดรับออเดอร์โดยอัตโนมัติ
    return { is_open: true, order_date: date };
  }

  return rows[0];
};

// สร้างเลขที่คำสั่งซื้อ
const generateOrderNumber = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const time = now.getTime().toString().slice(-6);
  return `ORD-${year}${month}${day}-${time}`;
};

// สร้างคำสั่งซื้อใหม่
export const createOrder = async (orderData) => {
  await ensureOrderItemSourceGroupColumn();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { user_id, items, order_date } = orderData;
    const order_number = generateOrderNumber();

    // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
    const status = await getOrderStatus(order_date);
    if (!status.is_open) {
      throw new Error('Order receiving is closed for selected date');
    }

    const orderContext = await getOrderContextByUserId(connection, user_id);

    // คำนวณยอดรวม
    let total_amount = 0;
    items.forEach(item => {
      total_amount += (item.quantity || 0) * (item.requested_price || 0);
    });

    // สร้าง order
    const [orderResult] = await connection.query(
      `INSERT INTO orders (order_number, user_id, order_date, status, total_amount, submitted_at)
       VALUES (?, ?, ?, 'submitted', ?, NOW())`,
      [order_number, user_id, order_date, total_amount]
    );

    const order_id = orderResult.insertId;

    // เพิ่ม order items
    if (items && items.length > 0) {
      const itemValues = [];
      for (const item of items) {
        const sourceProductGroupId = await resolveSourceProductGroupIdForItem({
          connection,
          item,
          branchId: orderContext.branchId,
          departmentId: orderContext.departmentId
        });

        itemValues.push([
          order_id,
          item.product_id,
          sourceProductGroupId,
          item.quantity,
          item.requested_price,
          item.notes ?? null
        ]);
      }

      await connection.query(
        `INSERT INTO order_items (order_id, product_id, source_product_group_id, quantity, requested_price, notes)
         VALUES ?`,
        [itemValues]
      );
    }

    await connection.commit();

    return {
      id: order_id,
      order_number,
      order_date,
      total_amount
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ดึงคำสั่งซื้อของผู้ใช้
export const getUserOrders = async (userId, filters = {}, options = {}) => {
  await ensureOrderTransferColumns();
  const departmentId = options.departmentId || null;
  let query = `
    SELECT o.id, o.order_number, o.order_date, o.status, o.total_amount,
           o.submitted_at, o.created_at,
           COALESCE(oss.is_open, true) as is_open,
           COUNT(DISTINCT oi.id) as item_count,
           d.name as department_name,
           b.name as branch_name,
           o.transferred_at,
           dfrom.name as transferred_from_department_name,
           bfrom.name as transferred_from_branch_name
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN departments d ON u.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN departments dfrom ON o.transferred_from_department_id = dfrom.id
    LEFT JOIN branches bfrom ON o.transferred_from_branch_id = bfrom.id
    LEFT JOIN order_status_settings oss ON o.order_date = oss.order_date
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE 1=1
  `;
  const params = [];

  if (departmentId) {
    query += ' AND d.id = ?';
    params.push(departmentId);
  } else {
    query += ' AND o.user_id = ?';
    params.push(userId);
  }

  if (filters.status) {
    query += ' AND o.status = ?';
    params.push(filters.status);
  }

  if (filters.date) {
    query += ' AND o.order_date = ?';
    params.push(filters.date);
  }

  query += ' GROUP BY o.id ORDER BY o.created_at DESC';

  const [rows] = await pool.query(query, params);
  return rows;
};

// ดึงรายละเอียดคำสั่งซื้อ
export const getOrderById = async (orderId) => {
  await ensureOrderTransferColumns();
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  const [orderRows] = await pool.query(
    `SELECT o.*, u.name as user_name, u.department_id,
            d.name as department_name, b.name as branch_name,
            dfrom.name as transferred_from_department_name,
            bfrom.name as transferred_from_branch_name,
            COALESCE(oss.is_open, true) as is_open
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN departments dfrom ON o.transferred_from_department_id = dfrom.id
     LEFT JOIN branches bfrom ON o.transferred_from_branch_id = bfrom.id
     LEFT JOIN order_status_settings oss ON o.order_date = oss.order_date
     WHERE o.id = ?`,
    [orderId]
  );

  if (orderRows.length === 0) {
    return null;
  }

  const order = orderRows[0];

  // ดึง order items
  const [itemRows] = await pool.query(
    `SELECT oi.*, p.name as product_name, p.code as product_code,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.id as supplier_id,
            s.name as supplier_name
     FROM order_items oi
     JOIN orders o2 ON oi.order_id = o2.id
     JOIN users usr ON o2.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN product_groups s
       ON s.id = COALESCE(
         oi.source_product_group_id,
         (
           SELECT pg_map.id
           FROM product_group_links pgl_map
           JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
           WHERE pgl_map.product_id = p.id
             AND pg_map.is_internal = true
             AND pg_map.linked_department_id = wbm.source_department_id
           ORDER BY pg_map.id
           LIMIT 1
         ),
         p.product_group_id
       )
     WHERE oi.order_id = ?
     ORDER BY p.name`,
    [orderId]
  );

  order.items = itemRows;
  return order;
};

// อัพเดทคำสั่งซื้อ
export const updateOrder = async (orderId, orderData, options = {}) => {
  await ensureOrderItemSourceGroupColumn();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { items } = orderData;
    const isAdmin = options.isAdmin === true;

    const [orderRows] = await connection.query(
      'SELECT status, order_date, user_id FROM orders WHERE id = ?',
      [orderId]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];

    if (!isAdmin) {
      if (order.status !== 'draft' && order.status !== 'submitted') {
        throw new Error('Only draft or submitted orders can be updated');
      }

      // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
      const status = await getOrderStatus(order.order_date);
      if (!status.is_open) {
        throw new Error('Order receiving is closed');
      }
    }

    // Editing clients from before source_product_group_id was added do not
    // include it in their payload. Preserve the original selection instead of
    // trying to infer a group again for products that belong to multiple groups.
    const [existingItemRows] = await connection.query(
      `SELECT product_id, source_product_group_id
       FROM order_items
       WHERE order_id = ?`,
      [orderId]
    );
    const existingSourceGroupByProductId = new Map();
    for (const existingItem of existingItemRows) {
      const productId = toPositiveIntOrNull(existingItem.product_id);
      const sourceGroupId = toPositiveIntOrNull(existingItem.source_product_group_id);
      if (productId && sourceGroupId && !existingSourceGroupByProductId.has(productId)) {
        existingSourceGroupByProductId.set(productId, sourceGroupId);
      }
    }

    // ลบ items เก่า
    await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);

    const orderContext = await getOrderContextByUserId(
      connection,
      toPositiveIntOrNull(order.user_id)
    );

    // เพิ่ม items ใหม่
    let total_amount = 0;

    if (items && items.length > 0) {
      const itemValues = [];
      for (const item of items) {
        const existingSourceGroupId = existingSourceGroupByProductId.get(
          toPositiveIntOrNull(item.product_id)
        );
        const sourceProductGroupId = await resolveSourceProductGroupIdForItem({
          connection,
          item: getProvidedSourceGroupId(item)
            ? item
            : { ...item, source_product_group_id: existingSourceGroupId },
          branchId: orderContext.branchId,
          departmentId: orderContext.departmentId
        });

        total_amount += (item.quantity || 0) * (item.requested_price || 0);
        itemValues.push([
          orderId,
          item.product_id,
          sourceProductGroupId,
          item.quantity,
          item.requested_price,
          item.notes ?? null
        ]);
      }

      await connection.query(
        `INSERT INTO order_items (order_id, product_id, source_product_group_id, quantity, requested_price, notes)
         VALUES ?`,
        [itemValues]
      );
    }

    // อัพเดท total_amount
    await connection.query(
      'UPDATE orders SET total_amount = ? WHERE id = ?',
      [total_amount, orderId]
    );

    await connection.commit();

    return { id: orderId, total_amount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ส่งคำสั่งซื้อ
export const submitOrder = async (orderId) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      'SELECT status, order_date FROM orders WHERE id = ?',
      [orderId]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];

    if (order.status !== 'draft') {
      throw new Error('Only draft orders can be submitted');
    }

    // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
    const status = await getOrderStatus(order.order_date);
    if (!status.is_open) {
      throw new Error('Order receiving is closed');
    }

    // อัพเดทสถานะเป็น submitted
    await connection.query(
      `UPDATE orders
       SET status = 'submitted', submitted_at = NOW()
       WHERE id = ?`,
      [orderId]
    );

    await connection.commit();

    return { id: orderId, status: 'submitted' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// ลบคำสั่งซื้อ (draft only)
export const deleteOrder = async (orderId) => {
  const [orderRows] = await pool.query(
    'SELECT status, order_date FROM orders WHERE id = ?',
    [orderId]
  );

  if (orderRows.length === 0) {
    throw new Error('Order not found');
  }

  const order = orderRows[0];
  if (order.status !== 'draft' && order.status !== 'submitted') {
    throw new Error('Only draft or submitted orders can be deleted');
  }

  const status = await getOrderStatus(order.order_date);
  if (!status.is_open) {
    throw new Error('Order receiving is closed');
  }

  await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);

  return { id: orderId, deleted: true };
};

// ---------------------------------------------------------------------------
// SQL fragment ร่วมสำหรับ 4 receiving functions (ลดโค้ดซ้ำ ~220 บรรทัด)
// ---------------------------------------------------------------------------
const RECEIVING_SELECT_FROM = `
  SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
         CASE
           WHEN COALESCE(oi.quantity, 0) <= 0 AND COALESCE(oi.received_quantity, 0) > 0
             THEN COALESCE(oi.received_quantity, 0)
           ELSE COALESCE(oi.quantity, 0)
         END as quantity,
         oi.received_quantity, oi.is_received,
         oi.received_at, oi.received_by_user_id, oi.receive_notes, oi.purchase_reason,
         p.name as product_name,
         u.name as unit_name, u.abbreviation as unit_abbr,
         s.id as supplier_id, s.name as supplier_name,
         o.order_number, o.order_date, o.status,
         d.id as department_id, d.name as department_name,
         b.id as branch_id, b.name as branch_name,
         ru.name as received_by_name
  FROM order_items oi
  JOIN orders o ON oi.order_id = o.id
  JOIN users usr ON o.user_id = usr.id
  JOIN departments d ON usr.department_id = d.id
  JOIN branches b ON d.branch_id = b.id
  LEFT JOIN withdraw_branch_source_mappings wbm
    ON wbm.target_branch_id = b.id
  LEFT JOIN products p ON oi.product_id = p.id
  LEFT JOIN units u ON p.unit_id = u.id
  LEFT JOIN product_groups s
    ON s.id = COALESCE(
      oi.source_product_group_id,
      (
        SELECT pg_explicit.id
        FROM product_group_links pgl_explicit
        JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
        JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
        WHERE pgl_explicit.product_id = p.id
          AND pg_explicit.is_active = true
          AND pgws.source_department_id = wbm.source_department_id
        ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
        LIMIT 1
      ),
      (
        SELECT pg_scope.id
        FROM product_group_links pgl_scope
        JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
        JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
        WHERE pgl_scope.product_id = p.id
          AND pg_scope.is_active = true
          AND pgs_scope.branch_id = b.id
          AND pgs_scope.department_id = d.id
        ORDER BY pgl_scope.is_primary DESC, pg_scope.id
        LIMIT 1
      ),
      (
        SELECT pg_map.id
        FROM product_group_links pgl_map
        JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
        WHERE pgl_map.product_id = p.id
          AND pg_map.is_internal = true
          AND pg_map.linked_department_id = wbm.source_department_id
        ORDER BY pg_map.id
        LIMIT 1
      ),
      p.product_group_id
    )
  LEFT JOIN users ru ON oi.received_by_user_id = ru.id
`;
// ---------------------------------------------------------------------------

export const getReceivingItemsByDepartments = async ({ date, departmentIds = [] }) => {
  await ensureOrderReceivingColumns();
  const normalizedIds = (departmentIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  const params = [date, date];
  let departmentFilter = '';
  if (normalizedIds.length > 0) {
    departmentFilter = `AND d.id IN (${normalizedIds.map(() => '?').join(', ')})`;
    params.push(...normalizedIds);
  }

  const [rows] = await pool.query(
    `${RECEIVING_SELECT_FROM}
     WHERE o.status IN ('submitted', 'confirmed', 'completed')
       AND (
         o.order_date = ?
         OR (
           o.order_date < ?
           AND COALESCE(oi.is_received, false) = false
           AND COALESCE(p.allow_pending_carryover, false) = true
         )
       )
     ${departmentFilter}
     ORDER BY s.name, b.name, d.name, o.order_date, o.order_number, p.name`,
    params
  );

  return rows;
};

export const getReceivingItemsByUser = async ({ date, userId }) => {
  await ensureOrderReceivingColumns();
  const [rows] = await pool.query(
    `${RECEIVING_SELECT_FROM}
     WHERE (
         o.user_id = ?
         OR (
           o.order_number LIKE 'PW-%'
           AND d.id = (
             SELECT u_current.department_id
             FROM users u_current
             WHERE u_current.id = ?
             LIMIT 1
           )
         )
       )
       AND o.status IN ('submitted', 'confirmed', 'completed')
       AND (
         o.order_date = ?
         OR (
           o.order_date < ?
           AND COALESCE(oi.is_received, false) = false
           AND COALESCE(p.allow_pending_carryover, false) = true
         )
       )
     ORDER BY s.name, o.order_date, o.order_number, p.name`,
    [userId, userId, date, date]
  );

  return rows;
};

export const getReceivingHistoryByUser = async ({
  userId,
  fromDate,
  toDate,
  limit = 200
}) => {
  await ensureOrderReceivingColumns();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));

  const [rows] = await pool.query(
    `${RECEIVING_SELECT_FROM}
     WHERE o.user_id = ?
       AND oi.received_at IS NOT NULL
       AND DATE(oi.received_at) BETWEEN ? AND ?
     ORDER BY oi.received_at DESC, oi.id DESC
     LIMIT ${safeLimit}`,
    [userId, fromDate, toDate]
  );

  return rows;
};

export const getReceivingHistoryByBranch = async ({
  branchId,
  fromDate,
  toDate,
  limit = 300
}) => {
  await ensureOrderReceivingColumns();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 800));

  const [rows] = await pool.query(
    `${RECEIVING_SELECT_FROM}
     WHERE b.id = ?
       AND oi.received_at IS NOT NULL
       AND DATE(oi.received_at) BETWEEN ? AND ?
     ORDER BY oi.received_at DESC, oi.id DESC
     LIMIT ${safeLimit}`,
    [branchId, fromDate, toDate]
  );

  return rows;
};

export const getPendingReceivingReminderSummary = async ({ date }) => {
  await ensureOrderReceivingColumns();
  const [rows] = await pool.query(
    `SELECT
       o.user_id,
       u.name AS user_name,
       d.id AS department_id,
       d.name AS department_name,
       b.id AS branch_id,
       b.name AS branch_name,
       COUNT(*) AS pending_line_count,
       ROUND(SUM(GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0))), 6) AS pending_quantity_total
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     WHERE o.order_date = ?
       AND o.status IN ('submitted', 'confirmed', 'completed')
       AND COALESCE(oi.is_received, false) = false
       AND GREATEST(0, COALESCE(oi.quantity, 0) - COALESCE(oi.received_quantity, 0)) > 0
     GROUP BY o.user_id, u.name, d.id, d.name, b.id, b.name
     ORDER BY b.name, d.name, u.name`,
    [date]
  );
  return rows;
};


const ensurePurchaseWalkManualMirrorTable = async () => {
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

  const columns = [
    {
      name: 'department_id',
      sql: `ALTER TABLE purchase_walk_manual_items
            ADD COLUMN department_id INT NULL AFTER branch_id,
            ADD INDEX idx_pwm_department (department_id)`
    },
    {
      name: 'receiving_order_item_id',
      sql: `ALTER TABLE purchase_walk_manual_items
            ADD COLUMN receiving_order_item_id INT NULL AFTER department_id,
            ADD INDEX idx_pwm_receiving_order_item (receiving_order_item_id)`
    }
  ];

  for (const column of columns) {
    const [rows] = await pool.query(
      `SHOW COLUMNS FROM purchase_walk_manual_items LIKE ?`,
      [column.name]
    );
    if (rows.length === 0) {
      await pool.query(column.sql);
    }
  }
};

const createPurchaseWalkMirrorForManualReceiving = async ({
  connection,
  orderDate,
  orderItemId,
  userId,
  productId,
  productGroupId,
  receivedQuantity
}) => {
  const safeProductGroupId = toPositiveIntOrNull(productGroupId);
  const safeProductId = toPositiveIntOrNull(productId);
  if (!safeProductGroupId || !safeProductId) return null;

  const [contextRows] = await connection.query(
    `SELECT d.id AS department_id, b.id AS branch_id
     FROM users u
     JOIN departments d ON d.id = u.department_id
     JOIN branches b ON b.id = d.branch_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  const context = contextRows[0];
  if (!context) return null;

  const [productRows] = await connection.query(
    `SELECT p.name AS product_name,
            u.abbreviation AS unit_abbr,
            u.name AS unit_name
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = ?
     LIMIT 1`,
    [safeProductId]
  );
  const product = productRows[0];
  if (!product) return null;

  const [existingRows] = await connection.query(
    `SELECT id
     FROM purchase_walk_manual_items
     WHERE receiving_order_item_id = ?
       AND is_active = true
     LIMIT 1`,
    [orderItemId]
  );
  if (existingRows.length > 0) return Number(existingRows[0].id);

  const [result] = await connection.query(
    `INSERT INTO purchase_walk_manual_items
      (order_date, product_group_id, branch_id, department_id, receiving_order_item_id,
       base_product_id, product_name, unit_abbr, unit_name,
       actual_quantity, actual_price, is_purchased, purchase_reason, created_by_user_id, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, false, ?, ?, ?)`,
    [
      orderDate,
      safeProductGroupId,
      Number(context.branch_id),
      Number(context.department_id),
      orderItemId,
      safeProductId,
      product.product_name,
      product.unit_abbr || null,
      product.unit_name || product.unit_abbr || null,
      Number.isFinite(Number(receivedQuantity)) ? Number(receivedQuantity) : 0,
      'เพิ่มจากหน้ารับสินค้า',
      userId || null,
      userId || null
    ]
  );
  return Number(result.insertId);
};

export const createManualReceivingItem = async ({
  date,
  userId,
  productId,
  receivedQuantity,
  sourceProductGroupId = null,
  receiveNotes = null
}) => {
  await ensureOrderReceivingColumns();
  await ensurePurchaseWalkManualMirrorTable();
  await ensureInventoryTables();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [productRows] = await connection.query(
      'SELECT id, product_group_id FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (productRows.length === 0) {
      throw new Error('Product not found');
    }

    let normalizedSourceGroupId = null;
    if (Number.isFinite(Number(sourceProductGroupId)) && Number(sourceProductGroupId) > 0) {
      const [groupRows] = await connection.query(
        'SELECT id FROM product_groups WHERE id = ? LIMIT 1',
        [Number(sourceProductGroupId)]
      );
      if (groupRows.length > 0) {
        normalizedSourceGroupId = Number(sourceProductGroupId);
      }
    }

    if (!normalizedSourceGroupId) {
      normalizedSourceGroupId = toPositiveIntOrNull(productRows[0].product_group_id);
    }

    const [orderRows] = await connection.query(
      `SELECT id
       FROM orders
       WHERE user_id = ?
         AND order_date = ?
         AND status IN ('submitted', 'confirmed', 'completed')
       ORDER BY submitted_at DESC, id DESC
       LIMIT 1`,
      [userId, date]
    );

    let targetOrderId = orderRows[0]?.id || null;

    if (!targetOrderId) {
      const orderNumber = generateOrderNumber();
      const [orderResult] = await connection.query(
        `INSERT INTO orders (
          order_number, user_id, order_date, status, total_amount, submitted_at
        ) VALUES (?, ?, ?, 'confirmed', 0, NOW())`,
        [orderNumber, userId, date]
      );
      targetOrderId = orderResult.insertId;
    }

    const [itemResult] = await connection.query(
      `INSERT INTO order_items (
         order_id,
         product_id,
         source_product_group_id,
         quantity,
         requested_price,
         received_quantity,
         is_received,
         received_at,
         received_by_user_id,
         receive_notes,
         notes
       ) VALUES (?, ?, ?, ?, NULL, NULL, false, NULL, NULL, NULL, ?)`,
      [
        targetOrderId,
        productId,
        normalizedSourceGroupId,
        receivedQuantity,
        receiveNotes
      ]
    );

    await createPurchaseWalkMirrorForManualReceiving({
      connection,
      orderDate: date,
      orderItemId: itemResult.insertId,
      userId,
      productId,
      productGroupId: normalizedSourceGroupId,
      receivedQuantity
    });

    await updateOrderItemReceivingWithInventory({
      connection,
      orderItemId: itemResult.insertId,
      receivedQuantity,
      isReceived: true,
      userId,
      receiveNotes
    });

    await connection.commit();
    return {
      order_id: targetOrderId,
      order_item_id: itemResult.insertId
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// บันทึกรับของแบบรวมสินค้า (branch scope) และแบ่งสัดส่วนไปยัง order_items ทั้งหมด
const updateReceivingItemsBranch = async (items, userId, options = {}) => {
  const branchId = options.branchId ? Number(options.branchId) : null;

  console.log('💾 updateReceivingItemsBranch:');
  console.log('  - Items to process:', items.length);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let totalUpdated = 0;

    for (const item of items) {
      // แปลง items_data จาก JSON string เป็น array
      const itemsData = Array.isArray(item.items_data)
        ? item.items_data
        : JSON.parse(item.items_data || '[]');
      const receivedQuantity = item.received_quantity === '' || item.received_quantity === null || item.received_quantity === undefined
        ? null
        : Number(item.received_quantity);

      console.log('  - Processing product:', item.product_id);
      console.log('    - Total received:', receivedQuantity);
      console.log('    - Sub-items:', itemsData.length);

      // คำนวณสัดส่วนสำหรับแต่ละ order_item
      const totalQuantity = itemsData.reduce((sum, i) => sum + toNumeric(i.quantity, 0), 0);
      const divisor = totalQuantity > 0 ? totalQuantity : Math.max(itemsData.length, 1);
      const useEqualSplit = totalQuantity <= 0;

      for (const subItem of itemsData) {
        // แบ่งสัดส่วนตามปริมาณที่สั่ง
        const proportion = useEqualSplit ? 1 / divisor : toNumeric(subItem.quantity, 0) / divisor;
        const itemReceivedQty = receivedQuantity !== null ? receivedQuantity * proportion : null;
        const isReceived = receivedQuantity !== null && receivedQuantity !== '';
        console.log(`    - Order item ${subItem.order_item_id}: ${subItem.quantity} (${(proportion * 100).toFixed(1)}%) -> ${itemReceivedQty}`);

        // ตรวจสอบว่า order_item นี้อยู่ใน branch ที่ถูกต้องหรือไม่
        if (branchId) {
          const [checkRows] = await connection.query(
            `SELECT oi.id
             FROM order_items oi
             JOIN orders o ON oi.order_id = o.id
             JOIN users u ON o.user_id = u.id
             JOIN departments d ON u.department_id = d.id
             WHERE oi.id = ? AND d.branch_id = ?`,
            [subItem.order_item_id, branchId]
          );

          if (checkRows.length === 0) {
            console.log(`    - Skipped: order_item ${subItem.order_item_id} not in branch ${branchId}`);
            continue;
          }
        }

        const affectedRows = await updateOrderItemReceivingWithInventory({
          connection,
          orderItemId: subItem.order_item_id,
          receivedQuantity: itemReceivedQty,
          isReceived,
          userId,
          receiveNotes: item.receive_notes
        });

        totalUpdated += affectedRows;
      }
    }

    await connection.commit();
    console.log('  - Total updated:', totalUpdated);
    return { updated: totalUpdated };
  } catch (error) {
    await connection.rollback();
    console.error('  - Error:', error);
    throw error;
  } finally {
    connection.release();
  }
};

export const getReceivingItemsByBranch = async ({ date, branchId }) => {
  await ensureOrderReceivingColumns();

  console.log('📊 getReceivingItemsByBranch:');
  console.log('  - date:', date);
  console.log('  - branchId:', branchId);

  const [rows] = await pool.query(
    `SELECT
      p.id as product_id,
      p.name as product_name,
      u.name as unit_name,
      u.abbreviation as unit_abbr,
      s.id as supplier_id,
      s.name as supplier_name,
      SUM(
        CASE
          WHEN COALESCE(oi.quantity, 0) <= 0 AND COALESCE(oi.received_quantity, 0) > 0
            THEN COALESCE(oi.received_quantity, 0)
          ELSE COALESCE(oi.quantity, 0)
        END
      ) as quantity,
      GROUP_CONCAT(
        CONCAT(
          oi.id, ':',
          CASE
            WHEN COALESCE(oi.quantity, 0) <= 0 AND COALESCE(oi.received_quantity, 0) > 0
              THEN COALESCE(oi.received_quantity, 0)
            ELSE COALESCE(oi.quantity, 0)
          END,
          ':',
          COALESCE(oi.received_quantity, ''),
          ':',
          COALESCE(oi.received_at, '')
        )
        ORDER BY d.name, o.order_number
        SEPARATOR '|'
      ) as order_items_data,
      GROUP_CONCAT(
        DISTINCT NULLIF(TRIM(oi.purchase_reason), '')
        ORDER BY oi.purchase_reason
        SEPARATOR ' | '
      ) as purchase_reason,
      GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ', ') as department_names,
      MIN(o.order_date) as order_date,
      b.id as branch_id,
      b.name as branch_name
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN product_groups s
       ON s.id = COALESCE(
         oi.source_product_group_id,
         (
           SELECT pg_explicit.id
           FROM product_group_links pgl_explicit
           JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
           JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
           WHERE pgl_explicit.product_id = p.id
             AND pg_explicit.is_active = true
             AND pgws.source_department_id = wbm.source_department_id
           ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
           LIMIT 1
         ),
         (
           SELECT pg_scope.id
           FROM product_group_links pgl_scope
           JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
           JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
           WHERE pgl_scope.product_id = p.id
             AND pg_scope.is_active = true
             AND pgs_scope.branch_id = b.id
             AND pgs_scope.department_id = d.id
           ORDER BY pgl_scope.is_primary DESC, pg_scope.id
           LIMIT 1
         ),
         (
           SELECT pg_map.id
           FROM product_group_links pgl_map
           JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
           WHERE pgl_map.product_id = p.id
             AND pg_map.is_internal = true
             AND pg_map.linked_department_id = wbm.source_department_id
           ORDER BY pg_map.id
           LIMIT 1
         ),
         p.product_group_id
       )
     WHERE b.id = ?
       AND o.status IN ('submitted', 'confirmed', 'completed')
       AND (
         o.order_date = ?
         OR (
           o.order_date < ?
           AND COALESCE(oi.is_received, false) = false
           AND COALESCE(p.allow_pending_carryover, false) = true
         )
       )
     GROUP BY p.id, p.name, u.name, u.abbreviation, s.id, s.name, b.id, b.name
     ORDER BY s.name, p.name`,
    [branchId, date, date]
  );

  console.log('  - rows found:', rows.length);

  // แปลง order_items_data เป็น array และคำนวณ received_quantity
  const result = rows.map(row => {
    const itemsData = row.order_items_data.split('|').map(item => {
      const [id, qty, receivedQty, receivedAt] = item.split(':');
      return {
        order_item_id: parseInt(id),
        quantity: parseFloat(qty),
        received_quantity: receivedQty ? parseFloat(receivedQty) : null,
        received_at: receivedAt || null
      };
    });

    // คำนวณ received_quantity รวม (ตามสัดส่วน)
    const totalQuantity = row.quantity;
    let receivedQuantity = null;
    let allReceived = true;
    let anyReceived = false;

    for (const item of itemsData) {
      if (item.received_quantity !== null) {
        anyReceived = true;
        if (receivedQuantity === null) receivedQuantity = 0;
        receivedQuantity += item.received_quantity;
      } else {
        allReceived = false;
      }
    }

    // เก็บข้อมูลรายการย่อยไว้ใน JSON string
    const orderItemIds = itemsData.map(i => i.order_item_id).join(',');

    return {
      product_id: row.product_id,
      product_name: row.product_name,
      unit_name: row.unit_name,
      unit_abbr: row.unit_abbr,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      quantity: totalQuantity,
      received_quantity: receivedQuantity,
      is_received: allReceived && anyReceived,
      received_at: allReceived && anyReceived ? itemsData[0].received_at : null,
      purchase_reason: row.purchase_reason || null,
      order_item_ids: orderItemIds, // เก็บ ids ของ order_items ทั้งหมดที่รวมกัน
      items_data: JSON.stringify(itemsData), // เก็บข้อมูลรายละเอียดไว้สำหรับการแบ่งสัดส่วนตอนบันทึก
      department_names: row.department_names,
      order_date: row.order_date,
      branch_id: row.branch_id,
      branch_name: row.branch_name
    };
  });

  console.log('  - result count:', result.length);
  if (result.length > 0) {
    console.log('  - sample result:', result[0]);
  }

  return result;
};

const toIsoDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
};

const buildAutoReceiveNote = (orderDate) => {
  const sourceDate = toIsoDate(orderDate);
  if (!sourceDate) return AUTO_RECEIVE_NOTE;
  return `${AUTO_RECEIVE_NOTE} • จากคำสั่งซื้อวันที่ ${sourceDate}`;
};

const getPreviousDate = (dateString) => {
  const normalized = toIsoDate(dateString);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
};

const getBangkokHourMinute = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return { hour, minute };
};

const isAfterAutoReceiveCutoff = () => {
  const { hour, minute } = getBangkokHourMinute();
  return hour > AUTO_RECEIVE_CUTOFF_HOUR || (
    hour === AUTO_RECEIVE_CUTOFF_HOUR && minute >= AUTO_RECEIVE_CUTOFF_MINUTE
  );
};

export const autoReceivePendingItemsForNextDay = async ({
  date,
  scope = 'mine',
  userId = null,
  branchId = null
}) => {
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

  const cutoffDate = getPreviousDate(date);
  if (!cutoffDate) {
    return { updated: 0, cutoff_date: null };
  }

  if (!isAfterAutoReceiveCutoff()) {
    return {
      updated: 0,
      cutoff_date: cutoffDate,
      skipped_before_cutoff: true,
      cutoff_time: `${String(AUTO_RECEIVE_CUTOFF_HOUR).padStart(2, '0')}:${String(
        AUTO_RECEIVE_CUTOFF_MINUTE
      ).padStart(2, '0')}`
    };
  }

  const params = [cutoffDate];
  let scopeFilter = '';
  if (scope === 'branch' && Number.isFinite(Number(branchId))) {
    scopeFilter = 'AND d.branch_id = ?';
    params.push(Number(branchId));
  } else if (Number.isFinite(Number(userId))) {
    scopeFilter = 'AND o.user_id = ?';
    params.push(Number(userId));
  } else {
    return { updated: 0, cutoff_date: cutoffDate };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT oi.id AS order_item_id, oi.quantity, o.order_date
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN departments d ON u.department_id = d.id
       JOIN branches b ON d.branch_id = b.id
       LEFT JOIN withdraw_branch_source_mappings wbm
         ON wbm.target_branch_id = b.id
       LEFT JOIN products p ON oi.product_id = p.id
       LEFT JOIN product_groups pg_auto
         ON pg_auto.id = COALESCE(
           (
             SELECT pg_explicit.id
             FROM product_group_links pgl_explicit
             JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
             JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
             WHERE pgl_explicit.product_id = p.id
               AND pg_explicit.is_active = true
               AND pgws.source_department_id = wbm.source_department_id
             ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
             LIMIT 1
           ),
           (
             SELECT pg_scope.id
             FROM product_group_links pgl_scope
             JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
             JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
             WHERE pgl_scope.product_id = p.id
               AND pg_scope.is_active = true
               AND pgs_scope.branch_id = b.id
               AND pgs_scope.department_id = d.id
             ORDER BY pgl_scope.is_primary DESC, pg_scope.id
             LIMIT 1
           ),
           (
             SELECT pg_map.id
             FROM product_group_links pgl_map
             JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
             WHERE pgl_map.product_id = p.id
               AND pg_map.is_internal = true
               AND pg_map.linked_department_id = wbm.source_department_id
             ORDER BY pg_map.id
             LIMIT 1
           ),
           p.product_group_id
         )
       WHERE o.order_date <= ?
         AND o.status IN ('submitted', 'confirmed', 'completed')
         AND COALESCE(oi.is_received, false) = false
         AND COALESCE(pg_auto.skip_receiving_required, true) = true
         AND COALESCE(p.allow_pending_carryover, false) = false
       ${scopeFilter}
       FOR UPDATE`,
      params
    );

    let updated = 0;
    for (const row of rows) {
      const affectedRows = await updateOrderItemReceivingWithInventory({
        connection,
        orderItemId: Number(row.order_item_id),
        receivedQuantity: Number(row.quantity) || 0,
        isReceived: true,
        userId: Number.isFinite(Number(userId)) ? Number(userId) : null,
        receiveNotes: buildAutoReceiveNote(row.order_date)
      });
      updated += affectedRows;
    }

    await connection.commit();
    return { updated, cutoff_date: cutoffDate };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateReceivingItems = async (items, userId, options = {}) => {
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();
  const scope = options.scope || 'mine';

  // ถ้าเป็น branch scope ให้ใช้ logic แบบแบ่งสัดส่วน
  if (scope === 'branch') {
    return await updateReceivingItemsBranch(items, userId, options);
  }

  // แบบเดิม (mine scope)
  const departmentId = options.departmentId ? Number(options.departmentId) : null;
  const ownerUserId = options.userId ? Number(options.userId) : null;
  const branchId = options.branchId ? Number(options.branchId) : null;
  const normalizedItems = (items || [])
    .filter((item) => item && item.order_item_id)
    .map((item) => {
      const parsedReceivedQuantity =
        item.received_quantity === '' || item.received_quantity === null || item.received_quantity === undefined
          ? null
          : Number(item.received_quantity);
      return {
        order_item_id: Number(item.order_item_id),
        received_quantity: Number.isFinite(parsedReceivedQuantity) ? parsedReceivedQuantity : null,
        is_received:
          item.is_received !== undefined && item.is_received !== null
            ? Boolean(item.is_received)
            : item.received_quantity !== '' && item.received_quantity !== null && item.received_quantity !== undefined,
        receive_notes: Object.prototype.hasOwnProperty.call(item, 'receive_notes')
          ? item.receive_notes
          : undefined
      };
    })
    .filter((item) => Number.isFinite(item.order_item_id));

  if (normalizedItems.length === 0) {
    return { updated: 0 };
  }

  let allowedIds = normalizedItems.map((item) => item.order_item_id);
  if (departmentId || ownerUserId || branchId) {
    const [rows] = await pool.query(
      `SELECT oi.id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN departments d ON u.department_id = d.id
       WHERE oi.id IN (${allowedIds.map(() => '?').join(', ')})
        ${departmentId ? 'AND d.id = ?' : ''}
        ${ownerUserId ? 'AND o.user_id = ?' : ''}
        ${branchId ? 'AND d.branch_id = ?' : ''}`,
      [
        ...allowedIds,
        ...(departmentId ? [departmentId] : []),
        ...(ownerUserId ? [ownerUserId] : []),
        ...(branchId ? [branchId] : [])
      ]
    );
    const allowedSet = new Set(rows.map((row) => Number(row.id)));
    allowedIds = allowedIds.filter((id) => allowedSet.has(Number(id)));
  }

  if (allowedIds.length === 0) {
    return { updated: 0 };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let updated = 0;

    for (const item of normalizedItems) {
      if (!allowedIds.includes(item.order_item_id)) continue;
      const affectedRows = await updateOrderItemReceivingWithInventory({
        connection,
        orderItemId: item.order_item_id,
        receivedQuantity: item.received_quantity,
        isReceived: item.is_received,
        userId,
        receiveNotes: item.receive_notes
      });
      updated += affectedRows;
    }

    await connection.commit();
    return { updated };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const bulkReceiveByDepartments = async (date, departmentIds = [], userId) => {
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();
  const normalizedIds = (departmentIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (normalizedIds.length === 0) {
    return { updated: 0 };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [targetRows] = await connection.query(
      `SELECT oi.id AS order_item_id, oi.quantity
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN departments d ON u.department_id = d.id
       WHERE o.order_date = ?
         AND o.status IN ('submitted', 'confirmed', 'completed')
         AND d.id IN (${normalizedIds.map(() => '?').join(', ')})
       FOR UPDATE`,
      [date, ...normalizedIds]
    );

    let updated = 0;
    for (const row of targetRows) {
      const affectedRows = await updateOrderItemReceivingWithInventory({
        connection,
        orderItemId: row.order_item_id,
        receivedQuantity: row.quantity,
        isReceived: true,
        userId,
        receiveNotes: null
      });
      updated += affectedRows;
    }

    await connection.commit();
    return { updated };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const ensureProductionPrintLogsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS production_print_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      user_name VARCHAR(100) NOT NULL,
      user_branch_id INT NOT NULL,
      user_branch_name VARCHAR(150) NOT NULL,
      user_department_id INT NOT NULL,
      user_department_name VARCHAR(150) NOT NULL,
      target_branch_id INT NOT NULL,
      target_branch_name VARCHAR(150) NOT NULL,
      target_department_id INT NOT NULL,
      target_department_name VARCHAR(150) NOT NULL,
      order_date DATE NOT NULL,
      supplier_code VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_print_order_date (order_date),
      INDEX idx_print_user (user_id),
      INDEX idx_print_target (target_branch_id, target_department_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getBranchDepartmentInfo = async ({ branchId, departmentId }) => {
  const [rows] = await pool.query(
    `SELECT b.id AS branch_id, b.name AS branch_name,
            d.id AS department_id, d.name AS department_name
     FROM branches b
     JOIN departments d ON d.branch_id = b.id
     WHERE b.id = ? AND d.id = ?`,
    [branchId, departmentId]
  );
  return rows[0] || null;
};

export const getProductionPrintItems = async ({ date, branchId, departmentId }) => {
  const [rows] = await pool.query(
    `SELECT p.id as product_id, p.name as product_name, p.code as product_code,
            u.abbreviation as unit_abbr, u.name as unit_name,
            SUM(oi.quantity) as total_quantity,
            GROUP_CONCAT(DISTINCT NULLIF(oi.notes, '') ORDER BY oi.notes SEPARATOR ' | ') as notes,
            d.id as department_id, d.name as department_name,
            b.id as branch_id, b.name as branch_name
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE o.order_date = ?
       AND b.id = ?
       AND d.id = ?
       AND o.status IN ('confirmed', 'completed')
     GROUP BY p.id, p.name, p.code, u.abbreviation, u.name, d.id, d.name, b.id, b.name
     ORDER BY p.name`,
    [date, branchId, departmentId]
  );

  return rows;
};

export const logProductionPrint = async ({
  user,
  target,
  orderDate,
  supplierCode = null
}) => {
  await ensureProductionPrintLogsTable();
  await pool.query(
    `INSERT INTO production_print_logs (
       user_id, user_name, user_branch_id, user_branch_name,
       user_department_id, user_department_name,
       target_branch_id, target_branch_name,
       target_department_id, target_department_name,
       order_date, supplier_code
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.name,
      user.branch_id,
      user.branch_name,
      user.department_id,
      user.department_name,
      target.branch_id,
      target.branch_name,
      target.department_id,
      target.department_name,
      orderDate,
      supplierCode
    ]
  );
};
