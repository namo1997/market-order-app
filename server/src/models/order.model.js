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
      `SELECT pg.id
       FROM product_group_links pgl
       JOIN product_groups pg ON pg.id = pgl.product_group_id
       JOIN product_group_scopes pgs ON pgs.product_group_id = pg.id
       WHERE pgl.product_id = ?
         AND pg.is_active = true
         AND pgs.branch_id = ?
         AND pgs.department_id = ?
       GROUP BY pg.id
       ORDER BY MAX(pgl.is_primary) DESC, pg.id`,
      [productId, safeBranchId, safeDepartmentId]
    );
    candidateGroupRows = rows;
  } else {
    const [rows] = await connection.query(
      `SELECT pg.id
       FROM product_group_links pgl
       JOIN product_groups pg ON pg.id = pgl.product_group_id
       WHERE pgl.product_id = ?
         AND pg.is_active = true
       GROUP BY pg.id
       ORDER BY MAX(pgl.is_primary) DESC, pg.id`,
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

// ---------------------------------------------------------------------------
// Validation สำหรับสร้าง/แก้ไขคำสั่งซื้อ และรับสินค้า (ห้ามเชื่อค่าจาก client)
// ---------------------------------------------------------------------------
export const ORDER_MAX_QUANTITY = 100000;
export const ORDER_MAX_PRICE = 1000000;
const ORDER_MAX_LINES = 500;
const ORDER_NOTES_MAX_LENGTH = 1000;
// หน้า /order อนุญาตเลือกวันที่ตั้งแต่วันนี้ถึง +7 วัน (เหมือน admin openOrders)
const ORDER_MAX_DAYS_AHEAD = (() => {
  const raw = String(process.env.ORDER_MAX_DAYS_AHEAD ?? '').trim();
  const parsed = Number(raw);
  return raw !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : 7;
})();
const ORDER_CLOSED_MESSAGE = 'ปิดรับคำสั่งซื้อของวันที่นี้แล้ว';

const createHttpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const roundTo2 = (value) => Math.round(Number(value) * 100) / 100;

export const isValidDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const getBangkokDateKey = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const validateOrderDateForCreate = (orderDate) => {
  if (!isValidDateOnly(orderDate)) {
    throw createHttpError('รูปแบบวันที่สั่งซื้อไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  }
  const today = getBangkokDateKey();
  if (orderDate < today) {
    throw createHttpError('ไม่สามารถสั่งซื้อย้อนหลังได้ กรุณาเลือกวันที่ตั้งแต่วันนี้เป็นต้นไป');
  }
  if (orderDate > addDaysToDateKey(today, ORDER_MAX_DAYS_AHEAD)) {
    throw createHttpError(`สั่งซื้อล่วงหน้าได้ไม่เกิน ${ORDER_MAX_DAYS_AHEAD} วัน`);
  }
};

const parseStrictNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const trimmed = value.trim();
  return trimmed === '' ? NaN : Number(trimmed);
};

const parseOrderQuantity = (value, productLabel) => {
  const parsed = parseStrictNumber(value);
  if (!Number.isFinite(parsed) || roundTo2(parsed) <= 0) {
    throw createHttpError(`จำนวนสินค้าไม่ถูกต้อง: ${productLabel} (ต้องเป็นตัวเลขมากกว่า 0)`);
  }
  if (parsed > ORDER_MAX_QUANTITY) {
    throw createHttpError(
      `จำนวนสินค้ามากเกินไป: ${productLabel} (สูงสุด ${ORDER_MAX_QUANTITY.toLocaleString('en-US')})`
    );
  }
  return roundTo2(parsed);
};

const parseAdminPrice = (value, productLabel) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseStrictNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > ORDER_MAX_PRICE) {
    throw createHttpError(`ราคาไม่ถูกต้อง: ${productLabel}`);
  }
  return roundTo2(parsed);
};

// ใช้สำหรับจำนวนรับสินค้า: คืน null เมื่อไม่ได้กรอก, throw 400 เมื่อไม่ถูกต้อง
const parseReceivedQuantityInput = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = parseStrictNumber(value);
  if (!Number.isFinite(parsed)) {
    throw createHttpError('จำนวนรับสินค้าต้องเป็นตัวเลข');
  }
  if (parsed < 0) {
    throw createHttpError('จำนวนรับสินค้าต้องไม่ติดลบ');
  }
  if (parsed > ORDER_MAX_QUANTITY) {
    throw createHttpError(
      `จำนวนรับสินค้ามากเกินไป (สูงสุด ${ORDER_MAX_QUANTITY.toLocaleString('en-US')})`
    );
  }
  return parsed;
};

const normalizeOrderNotes = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value);
  if (text.length > ORDER_NOTES_MAX_LENGTH) {
    throw createHttpError(`หมายเหตุยาวเกินไป (สูงสุด ${ORDER_NOTES_MAX_LENGTH} ตัวอักษร)`);
  }
  return text;
};

// ราคาเดียวกับที่หน้า /order ใช้ตั้ง requested_price:
// COALESCE(latest_price_override, ราคาซื้อจริงล่าสุด) แล้ว fallback default_price
const getCurrentProductPrice = (product) => {
  for (const value of [
    product?.latest_price_override,
    product?.last_actual_price,
    product?.default_price
  ]) {
    if (value === null || value === undefined) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return roundTo2(parsed);
  }
  return 0;
};

const loadOrderProductsById = async (connection, productIds) => {
  const ids = Array.from(new Set(productIds));
  const products = new Map();
  if (ids.length === 0) return products;

  const [productRows] = await connection.query(
    `SELECT p.id, p.name, p.is_active, p.product_group_id, p.default_price, p.latest_price_override,
            (
              SELECT oi_last.actual_price
              FROM order_items oi_last
              JOIN orders o_last ON o_last.id = oi_last.order_id
              WHERE oi_last.product_id = p.id
                AND oi_last.actual_price IS NOT NULL
              ORDER BY o_last.order_date DESC, oi_last.actual_price DESC
              LIMIT 1
            ) AS last_actual_price
     FROM products p
     WHERE p.id IN (?)`,
    [ids]
  );
  const [linkRows] = await connection.query(
    `SELECT product_id, product_group_id
     FROM product_group_links
     WHERE product_id IN (?)`,
    [ids]
  );

  for (const row of productRows) {
    const groupIds = new Set();
    const primaryGroupId = toPositiveIntOrNull(row.product_group_id);
    if (primaryGroupId) groupIds.add(primaryGroupId);
    products.set(Number(row.id), { ...row, group_ids: groupIds });
  }
  for (const link of linkRows) {
    const product = products.get(Number(link.product_id));
    const groupId = toPositiveIntOrNull(link.product_group_id);
    if (product && groupId) product.group_ids.add(groupId);
  }
  return products;
};

// ตรวจและแปลง items จาก client ให้เป็นรูปแบบเดียวกัน (ยังไม่ resolve กลุ่มสินค้า)
const normalizeOrderItemsInput = async (connection, items, { allowClientPrice = false } = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError('ต้องมีสินค้าอย่างน้อย 1 รายการ');
  }
  if (items.length > ORDER_MAX_LINES) {
    throw createHttpError(`จำนวนรายการสินค้าเกิน ${ORDER_MAX_LINES} รายการ`);
  }

  const productIds = items.map((item) => {
    const productId = toPositiveIntOrNull(item?.product_id);
    if (!productId || Number(item?.product_id) !== productId) {
      throw createHttpError('รหัสสินค้าไม่ถูกต้อง');
    }
    return productId;
  });
  const products = await loadOrderProductsById(connection, productIds);

  return items.map((item, index) => {
    const productId = productIds[index];
    const product = products.get(productId);
    if (!product) {
      throw createHttpError(`ไม่พบสินค้า (ID: ${productId})`);
    }
    const productLabel = String(product.name || `ID:${productId}`);
    const providedGroupId = getProvidedSourceGroupId(item);
    return {
      itemId: toPositiveIntOrNull(item.id ?? item.order_item_id),
      productId,
      product,
      productLabel,
      quantity: parseOrderQuantity(item.quantity, productLabel),
      notes: normalizeOrderNotes(item.notes ?? item.note),
      providedGroupId,
      providedGroupIsMember: providedGroupId ? product.group_ids.has(providedGroupId) : false,
      clientPrice: allowClientPrice ? parseAdminPrice(item.requested_price, productLabel) : null
    };
  });
};

const assertProductActive = (normalizedItem) => {
  if (!Number(normalizedItem.product.is_active)) {
    throw createHttpError(`สินค้าถูกปิดใช้งานแล้ว: ${normalizedItem.productLabel}`);
  }
};

const assertProvidedGroupIsMember = (normalizedItem) => {
  if (normalizedItem.providedGroupId && !normalizedItem.providedGroupIsMember) {
    throw createHttpError(`กลุ่มสินค้าที่เลือกไม่ตรงกับสินค้า: ${normalizedItem.productLabel}`);
  }
};

const isReceivedOrderLine = (row) =>
  Number(row?.is_received || 0) === 1 ||
  (row?.received_quantity !== null && row?.received_quantity !== undefined);

const isPurchasedOrderLine = (row) => Number(row?.is_purchased || 0) === 1;

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
  const parsedReceivedQuantity = parseReceivedQuantityInput(receivedQuantity);
  const hasReceivedInput = parsedReceivedQuantity !== null;
  // received_quantity เป็น DECIMAL(10,2) จึงปัดก่อน เพื่อให้ยอด movement ตรงกับค่าที่บันทึกจริง
  const nextReceived = hasReceivedInput ? roundTo2(parsedReceivedQuantity) : 0;
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

export const getProductGroupIdByCode = async (code) => {
  const [rows] = await pool.query(
    'SELECT id FROM product_groups WHERE code = ? ORDER BY id LIMIT 1',
    [code]
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
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
  const { user_id, items, order_date } = orderData;

  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError('ต้องมีสินค้าอย่างน้อย 1 รายการ');
  }
  validateOrderDateForCreate(order_date);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const order_number = generateOrderNumber();

    // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
    const status = await getOrderStatus(order_date);
    if (!status.is_open) {
      throw createHttpError(ORDER_CLOSED_MESSAGE);
    }

    const orderContext = await getOrderContextByUserId(connection, user_id);
    const normalizedItems = await normalizeOrderItemsInput(connection, items);

    // ราคาที่ขอ (requested_price) คำนวณจากราคาปัจจุบันของสินค้าฝั่ง server เสมอ
    let total_amount = 0;
    const itemRows = [];
    for (const item of normalizedItems) {
      assertProductActive(item);
      assertProvidedGroupIsMember(item);
      const sourceProductGroupId = await resolveSourceProductGroupIdForItem({
        connection,
        item: {
          product_id: item.productId,
          source_product_group_id: item.providedGroupId
        },
        branchId: orderContext.branchId,
        departmentId: orderContext.departmentId
      });
      const requestedPrice = getCurrentProductPrice(item.product);
      total_amount += item.quantity * requestedPrice;
      itemRows.push([
        item.productId,
        sourceProductGroupId,
        item.quantity,
        requestedPrice,
        item.notes ?? null
      ]);
    }
    total_amount = roundTo2(total_amount);

    // สร้าง order
    const [orderResult] = await connection.query(
      `INSERT INTO orders (order_number, user_id, order_date, status, total_amount, submitted_at)
       VALUES (?, ?, ?, 'submitted', ?, NOW())`,
      [order_number, user_id, order_date, total_amount]
    );

    const order_id = orderResult.insertId;

    // เพิ่ม order items
    await connection.query(
      `INSERT INTO order_items (order_id, product_id, source_product_group_id, quantity, requested_price, notes)
       VALUES ?`,
      [itemRows.map((row) => [order_id, ...row])]
    );

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
// แก้ไขแบบ diff: รายการเดิมอัปเดตในแถวเดิม (คง id และข้อมูลซื้อ/รับไว้),
// รายการใหม่ insert, และลบเฉพาะรายการที่ถูกเอาออก
export const updateOrder = async (orderId, orderData, options = {}) => {
  await ensureOrderReceivingColumns();
  const { items } = orderData;
  const isAdmin = options.isAdmin === true;

  if (!Array.isArray(items)) {
    throw createHttpError('รูปแบบรายการสินค้าไม่ถูกต้อง');
  }
  // หน้า admin ส่งรายการว่างเมื่อผู้ใช้ลบสินค้าออกทั้งหมด = ลบคำสั่งซื้อ (ใช้เงื่อนไขเดียวกับการลบ)
  if (items.length === 0) {
    await deleteOrder(orderId);
    return { id: orderId, total_amount: 0, deleted: true };
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      'SELECT status, order_date, user_id FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );

    if (orderRows.length === 0) {
      throw createHttpError('ไม่พบคำสั่งซื้อ', 404);
    }

    const order = orderRows[0];

    if (!isAdmin) {
      if (order.status !== 'draft' && order.status !== 'submitted') {
        throw createHttpError('แก้ไขได้เฉพาะคำสั่งซื้อที่ยังไม่ปิดรับ (รอดำเนินการ/ส่งแล้ว)');
      }

      // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
      const status = await getOrderStatus(order.order_date);
      if (!status.is_open) {
        throw createHttpError(ORDER_CLOSED_MESSAGE);
      }
    }

    const [existingRows] = await connection.query(
      `SELECT oi.id, oi.product_id, oi.source_product_group_id, oi.quantity, oi.requested_price,
              oi.notes, oi.is_purchased, oi.is_received, oi.received_quantity,
              p.name AS product_name
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.id
       FOR UPDATE`,
      [orderId]
    );

    const normalizedItems = await normalizeOrderItemsInput(connection, items, {
      allowClientPrice: isAdmin
    });

    // จับคู่รายการจาก client กับแถวเดิม: id ก่อน แล้วค่อยตาม product_id (+ กลุ่มที่เลือก)
    const unmatchedRows = new Map(existingRows.map((row) => [Number(row.id), row]));
    const matches = [];
    const newItems = [];
    const pendingItems = [];

    for (const item of normalizedItems) {
      const row = item.itemId ? unmatchedRows.get(item.itemId) : null;
      if (row && Number(row.product_id) === item.productId) {
        unmatchedRows.delete(Number(row.id));
        matches.push({ row, item });
      } else {
        pendingItems.push(item);
      }
    }
    for (const item of pendingItems) {
      const candidates = Array.from(unmatchedRows.values()).filter(
        (row) => Number(row.product_id) === item.productId
      );
      const row =
        candidates.find(
          (candidate) =>
            item.providedGroupId &&
            toPositiveIntOrNull(candidate.source_product_group_id) === item.providedGroupId
        ) || candidates[0];
      if (row) {
        unmatchedRows.delete(Number(row.id));
        matches.push({ row, item });
      } else {
        newItems.push(item);
      }
    }

    // ห้ามลบรายการที่รับสินค้าหรือซื้อแล้ว
    for (const row of unmatchedRows.values()) {
      const productLabel = row.product_name || `ID:${row.product_id}`;
      if (isReceivedOrderLine(row)) {
        throw createHttpError(`ไม่สามารถลบรายการ "${productLabel}" ได้ เนื่องจากรับสินค้าแล้ว`);
      }
      if (isPurchasedOrderLine(row)) {
        throw createHttpError(`ไม่สามารถลบรายการ "${productLabel}" ได้ เนื่องจากซื้อสินค้าแล้ว`);
      }
    }

    for (const { row, item } of matches) {
      const previousQuantity = toNumeric(row.quantity, 0);
      if (isReceivedOrderLine(row) && item.quantity < previousQuantity) {
        throw createHttpError(
          `ไม่สามารถลดจำนวน "${item.productLabel}" ได้ เนื่องจากรับสินค้าแล้ว`
        );
      }

      const existingGroupId = toPositiveIntOrNull(row.source_product_group_id);
      if (item.providedGroupId && item.providedGroupId !== existingGroupId) {
        assertProvidedGroupIsMember(item);
      }
      // เปลี่ยนกลุ่มได้เฉพาะแถวที่มีกลุ่มอยู่แล้วและยังไม่ซื้อ/รับ
      // (แถวเก่าที่ไม่มี source_product_group_id ให้คงไว้ตามเดิม ไม่เดากลุ่มใหม่)
      const nextGroupId =
        existingGroupId &&
        item.providedGroupId &&
        !isReceivedOrderLine(row) &&
        !isPurchasedOrderLine(row)
          ? item.providedGroupId
          : existingGroupId;

      // ผู้ใช้ทั่วไปแก้ราคาไม่ได้: คงราคาเดิมของแถวไว้ (admin แก้ราคาได้จากหน้า admin)
      const existingPrice =
        row.requested_price === null || row.requested_price === undefined
          ? null
          : toNumeric(row.requested_price, 0);
      const nextPrice =
        item.clientPrice !== null
          ? item.clientPrice
          : existingPrice !== null
            ? existingPrice
            : getCurrentProductPrice(item.product);

      await connection.query(
        `UPDATE order_items
         SET quantity = ?, requested_price = ?, source_product_group_id = ?, notes = ?
         WHERE id = ?`,
        [
          item.quantity,
          nextPrice,
          nextGroupId,
          // หมายเหตุว่าง ("") จากหน้าแก้ไขเท่ากับไม่มีหมายเหตุ: คง NULL เดิมไว้
          item.notes === undefined || (item.notes === '' && row.notes === null)
            ? row.notes
            : item.notes,
          row.id
        ]
      );
    }

    if (newItems.length > 0) {
      const orderContext = await getOrderContextByUserId(
        connection,
        toPositiveIntOrNull(order.user_id)
      );
      const itemValues = [];
      for (const item of newItems) {
        assertProductActive(item);
        assertProvidedGroupIsMember(item);
        const sourceProductGroupId = await resolveSourceProductGroupIdForItem({
          connection,
          item: {
            product_id: item.productId,
            source_product_group_id: item.providedGroupId
          },
          branchId: orderContext.branchId,
          departmentId: orderContext.departmentId
        });
        itemValues.push([
          orderId,
          item.productId,
          sourceProductGroupId,
          item.quantity,
          item.clientPrice !== null ? item.clientPrice : getCurrentProductPrice(item.product),
          item.notes ?? null
        ]);
      }
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, source_product_group_id, quantity, requested_price, notes)
         VALUES ?`,
        [itemValues]
      );
    }

    const removedIds = Array.from(unmatchedRows.keys());
    if (removedIds.length > 0) {
      await connection.query(
        'DELETE FROM order_items WHERE order_id = ? AND id IN (?)',
        [orderId, removedIds]
      );
    }

    const [totalRows] = await connection.query(
      `SELECT COALESCE(SUM(quantity * COALESCE(requested_price, 0)), 0) AS total_amount
       FROM order_items
       WHERE order_id = ?`,
      [orderId]
    );
    const total_amount = roundTo2(totalRows[0]?.total_amount || 0);

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

// ลบคำสั่งซื้อ (draft/submitted ที่ยังเปิดรับ และยังไม่มีรายการที่ซื้อหรือรับแล้ว)
export const deleteOrder = async (orderId) => {
  await ensureOrderReceivingColumns();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      'SELECT status, order_date FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );

    if (orderRows.length === 0) {
      throw createHttpError('ไม่พบคำสั่งซื้อ', 404);
    }

    const order = orderRows[0];
    if (order.status !== 'draft' && order.status !== 'submitted') {
      throw createHttpError('ลบได้เฉพาะคำสั่งซื้อที่ยังไม่ปิดรับ (รอดำเนินการ/ส่งแล้ว)');
    }

    const status = await getOrderStatus(order.order_date);
    if (!status.is_open) {
      throw createHttpError(ORDER_CLOSED_MESSAGE);
    }

    // ทุก role (รวม admin) ห้ามลบเมื่อมีรายการที่รับหรือซื้อแล้ว
    // เพราะ inventory_transactions / ข้อมูลเดินซื้อ อ้างถึงรายการเหล่านี้อยู่
    const [lockedRows] = await connection.query(
      `SELECT oi.id, oi.is_purchased, oi.is_received, oi.received_quantity,
              p.name AS product_name
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
         AND (
           COALESCE(oi.is_received, false) = true
           OR oi.received_quantity IS NOT NULL
           OR COALESCE(oi.is_purchased, false) = true
         )
       ORDER BY oi.id
       FOR UPDATE`,
      [orderId]
    );
    if (lockedRows.length > 0) {
      const hasReceived = lockedRows.some((row) => isReceivedOrderLine(row));
      const names = lockedRows
        .slice(0, 5)
        .map((row) => row.product_name || `ID:${row.id}`)
        .join(', ');
      const more = lockedRows.length > 5 ? ` และอีก ${lockedRows.length - 5} รายการ` : '';
      throw createHttpError(
        `ไม่สามารถลบคำสั่งซื้อได้ เนื่องจากมีรายการที่${hasReceived ? 'รับสินค้า' : 'ซื้อ'}แล้ว: ${names}${more}`
      );
    }

    await connection.query('DELETE FROM orders WHERE id = ?', [orderId]);

    await connection.commit();
    return { id: orderId, deleted: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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

// หมายเหตุ: ยังให้รับสินค้าของคำสั่งซื้อสถานะ submitted ได้ (บางวัน admin ไม่ได้กดปิดรับ
// และของเบิกภายในไม่ผ่านเดินซื้อ) ความสอดคล้องคุมด้วย updateOrder/deleteOrder ที่ห้ามลบ/ลด
// รายการที่รับแล้ว และห้ามลบคำสั่งซื้อที่มีรายการรับ/ซื้อแล้ว
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

// แบ่ง total ตามน้ำหนัก ปัดทศนิยม 2 ตำแหน่ง และให้ผลรวมเท่ากับ total พอดี
const distributeByWeight = (total, entries, getWeight) => {
  if (entries.length === 0) return [];
  const weights = entries.map((entry) => Math.max(0, toNumeric(getWeight(entry), 0)));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightSum > 0 ? weights : entries.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : entries.length;
  let allocated = 0;
  return entries.map((entry, index) => {
    if (index === entries.length - 1) {
      return roundTo2(total - allocated);
    }
    const share = roundTo2((total * effectiveWeights[index]) / effectiveSum);
    allocated += share;
    return share;
  });
};

// บันทึกรับของแบบรวมสินค้า (branch scope)
// ค่าที่กรอกคือ "ยอดรับรวมทั้งสาขา" ของสินค้านั้น ระบบกระจายเฉพาะส่วนต่างจากยอดที่รับไว้แล้ว
// ไปยังรายการที่ยังรับไม่ครบ ไม่ลด/ไม่เขียนทับรายการที่แผนกอื่นรับไว้แล้ว
// และรายการที่ไม่ถูกแตะจะคง received_by เดิม
const updateReceivingItemsBranch = async (items, userId, options = {}) => {
  const branchId = options.branchId ? Number(options.branchId) : null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let totalUpdated = 0;

    for (const item of items) {
      let itemsData = item.items_data;
      if (!Array.isArray(itemsData)) {
        try {
          itemsData = JSON.parse(itemsData || '[]');
        } catch (parseError) {
          throw createHttpError('ข้อมูลรายการรับสินค้าไม่ถูกต้อง');
        }
      }
      const targetTotal = parseReceivedQuantityInput(item.received_quantity);
      // ไม่กรอกจำนวน = ไม่เปลี่ยนแปลง (ไม่ล้างยอดที่แผนกอื่นรับไว้แล้ว)
      if (targetTotal === null) continue;

      const orderItemIds = Array.from(
        new Set(
          (Array.isArray(itemsData) ? itemsData : [])
            .map((subItem) => toPositiveIntOrNull(subItem?.order_item_id))
            .filter(Boolean)
        )
      );
      if (orderItemIds.length === 0) continue;

      // อ่านยอดล่าสุดจาก DB (ไม่ใช้ค่าที่ client ส่งมา) และตรวจว่าอยู่ในสาขาเดียวกัน
      const [lineRows] = await connection.query(
        `SELECT oi.id, oi.product_id, oi.quantity, oi.received_quantity, oi.received_by_user_id
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         JOIN users u ON o.user_id = u.id
         JOIN departments d ON u.department_id = d.id
         WHERE oi.id IN (?)
           ${branchId ? 'AND d.branch_id = ?' : ''}
         ORDER BY oi.id
         FOR UPDATE`,
        [orderItemIds, ...(branchId ? [branchId] : [])]
      );
      const productId = toPositiveIntOrNull(item.product_id);
      const lines = lineRows
        .filter((row) => !productId || Number(row.product_id) === productId)
        .map((row) => {
          const received =
            row.received_quantity === null || row.received_quantity === undefined
              ? null
              : toNumeric(row.received_quantity, 0);
          const rawQuantity = toNumeric(row.quantity, 0);
          return {
            id: Number(row.id),
            ordered: rawQuantity <= 0 && (received || 0) > 0 ? received : rawQuantity,
            received,
            receivedBy: row.received_by_user_id
          };
        });
      if (lines.length === 0) continue;

      const currentTotal = roundTo2(lines.reduce((sum, line) => sum + (line.received ?? 0), 0));
      const anyReceived = lines.some((line) => line.received !== null);
      const delta = roundTo2(targetTotal - currentTotal);
      const nextReceivedById = new Map();

      if (!anyReceived) {
        // ยังไม่มีแผนกใดรับ: แบ่งยอดทั้งหมดตามสัดส่วนจำนวนสั่ง (รับ 0 ก็บันทึกเป็น 0)
        const shares = distributeByWeight(targetTotal, lines, (line) => line.ordered);
        lines.forEach((line, index) => nextReceivedById.set(line.id, shares[index]));
      } else if (delta > 0) {
        // รับเพิ่ม: ให้รายการที่ยังรับไม่ครบก่อน (ตามจำนวนที่ยังขาด)
        const openLines = lines.filter((line) => (line.received ?? 0) < line.ordered);
        const targetLines = openLines.length > 0 ? openLines : lines;
        const shares = distributeByWeight(delta, targetLines, (line) =>
          openLines.length > 0 ? line.ordered - (line.received ?? 0) : line.ordered
        );
        targetLines.forEach((line, index) => {
          if (shares[index] === 0 && line.received === null) return;
          nextReceivedById.set(line.id, roundTo2((line.received ?? 0) + shares[index]));
        });
      } else if (delta < 0) {
        // ลดยอด: ลดได้เฉพาะรายการที่ผู้ใช้คนนี้เป็นคนบันทึกรับเอง
        const ownLines = lines.filter(
          (line) =>
            (line.received ?? 0) > 0 &&
            Number(line.receivedBy) === Number(userId)
        );
        const reducible = roundTo2(ownLines.reduce((sum, line) => sum + line.received, 0));
        if (reducible < -delta) {
          const productLabel = String(item.product_name || '').trim() || `ID:${productId || '-'}`;
          throw createHttpError(
            `ไม่สามารถลดยอดรับรวมของ "${productLabel}" ได้ เนื่องจากเป็นยอดที่แผนกอื่นบันทึกรับไว้แล้ว ` +
            'กรุณาให้แผนกนั้นแก้ไขจากหน้ารับสินค้าของตนเอง'
          );
        }
        const shares = distributeByWeight(-delta, ownLines, (line) => line.received);
        ownLines.forEach((line, index) => {
          nextReceivedById.set(line.id, Math.max(0, roundTo2(line.received - shares[index])));
        });
      }
      // delta = 0 และมีการรับแล้ว: ไม่มีการเปลี่ยนแปลง

      for (const line of lines) {
        if (!nextReceivedById.has(line.id)) continue;
        const nextReceived = nextReceivedById.get(line.id);
        if (line.received !== null && roundTo2(line.received) === nextReceived) continue;
        totalUpdated += await updateOrderItemReceivingWithInventory({
          connection,
          orderItemId: line.id,
          receivedQuantity: nextReceived,
          userId,
          receiveNotes: item.receive_notes
        });
      }
    }

    await connection.commit();
    return { updated: totalUpdated };
  } catch (error) {
    await connection.rollback();
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

  // order_items_data ใช้ GROUP_CONCAT จึงต้องขยายความยาว ไม่ให้ข้อมูลถูกตัดเมื่อมีหลายแผนก
  const branchConnection = await pool.getConnection();
  let rows = [];
  try {
    await branchConnection.query('SET SESSION group_concat_max_len = 1048576');
    [rows] = await branchConnection.query(
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
          d.id,
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
  } finally {
    branchConnection.release();
  }

  console.log('  - rows found:', rows.length);

  const [departmentRows] = await pool.query(
    'SELECT id, name FROM departments WHERE branch_id = ?',
    [branchId]
  );
  const departmentNameById = new Map(
    departmentRows.map((department) => [Number(department.id), department.name])
  );

  // แปลง order_items_data เป็น array และคำนวณ received_quantity
  const result = rows.map(row => {
    const itemsData = row.order_items_data.split('|').map(item => {
      // received_at มี ':' อยู่ในเวลา จึงต้องต่อส่วนที่เหลือกลับ
      const [id, qty, receivedQty, departmentId, ...receivedAtParts] = item.split(':');
      const receivedAt = receivedAtParts.join(':');
      return {
        order_item_id: parseInt(id),
        quantity: parseFloat(qty),
        received_quantity: receivedQty ? parseFloat(receivedQty) : null,
        received_at: receivedAt || null,
        department_id: Number(departmentId) || null,
        department_name: departmentNameById.get(Number(departmentId)) || null
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
      const parsedReceivedQuantity = parseReceivedQuantityInput(item.received_quantity);
      return {
        order_item_id: Number(item.order_item_id),
        received_quantity: parsedReceivedQuantity,
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
