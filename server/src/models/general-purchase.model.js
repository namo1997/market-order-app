import pool from '../config/database.js';

let tablesEnsured = false;

const nowSql = () => new Date();

export const ensureGeneralPurchaseTables = async () => {
  if (tablesEnsured) return;
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS general_purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pr_number VARCHAR(50) UNIQUE NOT NULL,
        po_number VARCHAR(50) UNIQUE NULL,
        status ENUM('pending_review','approved','awaiting_receipt','received','rejected','closed') NOT NULL DEFAULT 'pending_review',
        request_date DATE NOT NULL,
        po_date DATE NULL,
        expected_date DATE NULL,
        branch_name VARCHAR(255) NULL,
        department_name VARCHAR(255) NULL,
        expense_type VARCHAR(255) NULL,
        account_code VARCHAR(100) NULL,
        cost_center VARCHAR(100) NULL,
        vendor_name VARCHAR(255) NULL,
        vendor_tax_id VARCHAR(50) NULL,
        invoice_no VARCHAR(100) NULL,
        tax_invoice_no VARCHAR(100) NULL,
        document_date DATE NULL,
        payment_due_date DATE NULL,
        payment_method VARCHAR(50) NULL,
        vat_type VARCHAR(50) NULL,
        withholding_tax_rate DECIMAL(7,2) NOT NULL DEFAULT 0,
        purpose TEXT NULL,
        requested_by_name VARCHAR(255) NULL,
        created_by INT NULL,
        approved_by INT NULL,
        received_by INT NULL,
        approval_note TEXT NULL,
        rejection_reason TEXT NULL,
        po_note TEXT NULL,
        received_note TEXT NULL,
        subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        actual_total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        approved_at TIMESTAMP NULL,
        rejected_at TIMESTAMP NULL,
        issued_at TIMESTAMP NULL,
        received_at TIMESTAMP NULL,
        closed_at TIMESTAMP NULL,
        INDEX idx_gpo_status (status),
        INDEX idx_gpo_request_date (request_date),
        INDEX idx_gpo_po_number (po_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS general_purchase_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        general_purchase_order_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        requested_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
        received_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
        unit_name VARCHAR(100) NULL,
        estimated_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        actual_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        note TEXT NULL,
        item_image_data_url LONGTEXT NULL,
        item_image_name VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_gpoi_order (general_purchase_order_id),
        CONSTRAINT fk_gpoi_order FOREIGN KEY (general_purchase_order_id)
          REFERENCES general_purchase_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [imageColumnRows] = await connection.query(
      "SHOW COLUMNS FROM general_purchase_order_items LIKE 'item_image_data_url'"
    );
    if (imageColumnRows.length === 0) {
      await connection.query(
        'ALTER TABLE general_purchase_order_items ADD COLUMN item_image_data_url LONGTEXT NULL AFTER note'
      );
    }

    const [imageNameColumnRows] = await connection.query(
      "SHOW COLUMNS FROM general_purchase_order_items LIKE 'item_image_name'"
    );
    if (imageNameColumnRows.length === 0) {
      await connection.query(
        'ALTER TABLE general_purchase_order_items ADD COLUMN item_image_name VARCHAR(255) NULL AFTER item_image_data_url'
      );
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS general_purchase_order_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        general_purchase_order_id INT NOT NULL,
        from_status VARCHAR(50) NULL,
        to_status VARCHAR(50) NULL,
        action VARCHAR(100) NOT NULL,
        actor_user_id INT NULL,
        actor_name VARCHAR(255) NULL,
        details TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_gpol_order (general_purchase_order_id),
        CONSTRAINT fk_gpol_order FOREIGN KEY (general_purchase_order_id)
          REFERENCES general_purchase_orders(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    tablesEnsured = true;
  } finally {
    connection.release();
  }
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDateOrNull = (value) => (value ? String(value).slice(0, 10) : null);

const toDateString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
};

const generatePrNumber = async (connection, requestDate) => {
  const dateStr = String(requestDate).replace(/-/g, '');
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS cnt FROM general_purchase_orders WHERE request_date = ?`,
    [requestDate]
  );
  const seq = String(Number(row?.cnt || 0) + 1).padStart(3, '0');
  return `PR-${dateStr}-${seq}`;
};

const generatePoNumber = async (connection, poDate) => {
  const dateStr = String(poDate).replace(/-/g, '');
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS cnt FROM general_purchase_orders WHERE po_date = ? AND po_number IS NOT NULL`,
    [poDate]
  );
  const seq = String(Number(row?.cnt || 0) + 1).padStart(3, '0');
  return `GPO-${dateStr}-${seq}`;
};

const addLog = async (connection, orderId, { fromStatus = null, toStatus = null, action, actorUserId = null, actorName = null, details = null }) => {
  await connection.query(
    `INSERT INTO general_purchase_order_logs
      (general_purchase_order_id, from_status, to_status, action, actor_user_id, actor_name, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderId, fromStatus, toStatus, action, actorUserId, actorName, details]
  );
};

const mapItem = (row) => ({
  id: row.id,
  name: row.item_name,
  quantity: Number(row.requested_quantity || 0),
  actualQuantity: Number(row.received_quantity || 0),
  unit: row.unit_name || '',
  totalPrice: Number(row.estimated_price || 0),
  actualPrice: Number(row.actual_price || 0),
  note: row.note || '',
  imageDataUrl: row.item_image_data_url || '',
  imageName: row.item_image_name || ''
});

const mapOrder = (row, items = [], timeline = []) => ({
  id: row.id,
  number: row.pr_number,
  prNumber: row.pr_number,
  poNumber: row.po_number || '',
  status: row.status,
  header: {
    requestDate: toDateString(row.request_date),
    branch: row.branch_name || '',
    department: row.department_name || '',
    expenseType: row.expense_type || '',
    accountCode: row.account_code || '',
    costCenter: row.cost_center || '',
    vendorName: row.vendor_name || '',
    vendorTaxId: row.vendor_tax_id || '',
    invoiceNo: row.invoice_no || '',
    taxInvoiceNo: row.tax_invoice_no || '',
    documentDate: toDateString(row.document_date),
    paymentDueDate: toDateString(row.payment_due_date),
    paymentMethod: row.payment_method || '',
    vatType: row.vat_type || '',
    withholdingTaxRate: Number(row.withholding_tax_rate || 0),
    purpose: row.purpose || ''
  },
  items,
  requestedBy: row.requested_by_name || 'ผู้ใช้',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  approvedAt: row.approved_at,
  rejectedAt: row.rejected_at,
  issuedAt: row.issued_at,
  receivedAt: row.received_at,
  closedAt: row.closed_at,
  poDate: toDateString(row.po_date),
  expectedDate: toDateString(row.expected_date),
  approvalNote: row.approval_note || '',
  rejectionReason: row.rejection_reason || '',
  poNote: row.po_note || '',
  receivedNote: row.received_note || '',
  subtotalAmount: Number(row.subtotal_amount || 0),
  actualTotalAmount: Number(row.actual_total_amount || 0),
  timeline
});

export const createGeneralPurchaseOrder = async ({ header = {}, items = [], requestedBy = 'ผู้ใช้', actor = {} }) => {
  await ensureGeneralPurchaseTables();
  const requestDate = toDateOrNull(header.requestDate) || new Date().toISOString().slice(0, 10);
  const cleanItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: String(item.name || item.item_name || '').trim(),
      quantity: toNumber(item.quantity ?? item.requested_quantity),
      unit: String(item.unit || item.unit_name || '').trim(),
      totalPrice: toNumber(item.totalPrice ?? item.estimated_price),
      note: String(item.note || '').trim(),
      imageDataUrl: String(item.imageDataUrl || item.item_image_data_url || '').trim(),
      imageName: String(item.imageName || item.item_image_name || '').trim()
    }))
    .filter((item) => item.name);

  if (!String(header.branch || '').trim()) {
    const err = new Error('branch is required');
    err.statusCode = 400;
    throw err;
  }
  if (!String(header.department || '').trim()) {
    const err = new Error('department is required');
    err.statusCode = 400;
    throw err;
  }
  if (!String(header.expenseType || '').trim()) {
    const err = new Error('expense type is required');
    err.statusCode = 400;
    throw err;
  }
  if (cleanItems.length === 0) {
    const err = new Error('items must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }

  const subtotal = cleanItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const prNumber = await generatePrNumber(connection, requestDate);
    const [result] = await connection.query(
      `INSERT INTO general_purchase_orders
        (pr_number, status, request_date, branch_name, department_name, expense_type, account_code, cost_center,
         vendor_name, vendor_tax_id, invoice_no, tax_invoice_no, document_date, payment_due_date, payment_method,
         vat_type, withholding_tax_rate, purpose, requested_by_name, created_by, subtotal_amount)
       VALUES (?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prNumber,
        requestDate,
        header.branch || null,
        header.department || null,
        header.expenseType || null,
        header.accountCode || null,
        header.costCenter || null,
        header.vendorName || null,
        header.vendorTaxId || null,
        header.invoiceNo || null,
        header.taxInvoiceNo || null,
        toDateOrNull(header.documentDate),
        toDateOrNull(header.paymentDueDate),
        header.paymentMethod || null,
        header.vatType || null,
        toNumber(header.withholdingTaxRate),
        header.purpose || null,
        requestedBy || actor.name || 'ผู้ใช้',
        actor.userId || null,
        subtotal
      ]
    );
    const orderId = result.insertId;

    for (const item of cleanItems) {
      await connection.query(
        `INSERT INTO general_purchase_order_items
          (general_purchase_order_id, item_name, requested_quantity, unit_name, estimated_price, note, item_image_data_url, item_image_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.name, item.quantity, item.unit || null, item.totalPrice, item.note || null, item.imageDataUrl || null, item.imageName || null]
      );
    }

    await addLog(connection, orderId, {
      toStatus: 'pending_review',
      action: 'create_pr',
      actorUserId: actor.userId || null,
      actorName: requestedBy || actor.name || 'ผู้ใช้',
      details: 'ส่งคำขอซื้อทั่วไป'
    });

    await connection.commit();
    return getGeneralPurchaseOrderById(orderId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getGeneralPurchaseOrders = async (filters = {}) => {
  await ensureGeneralPurchaseTables();
  let sql = `SELECT * FROM general_purchase_orders WHERE 1=1`;
  const params = [];
  if (filters.status) {
    sql += ` AND status = ?`;
    params.push(filters.status);
  }
  if (filters.branch) {
    sql += ` AND branch_name = ?`;
    params.push(filters.branch);
  }
  if (filters.department) {
    sql += ` AND department_name = ?`;
    params.push(filters.department);
  }
  sql += ` ORDER BY created_at DESC, id DESC`;
  if (filters.limit) {
    sql += ` LIMIT ?`;
    params.push(Math.min(Math.max(Number(filters.limit) || 50, 1), 500));
  }
  const [orders] = await pool.query(sql, params);
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const [items] = await pool.query(
    `SELECT * FROM general_purchase_order_items WHERE general_purchase_order_id IN (?) ORDER BY id ASC`,
    [ids]
  );
  const itemMap = new Map();
  for (const item of items) {
    const arr = itemMap.get(item.general_purchase_order_id) || [];
    arr.push(mapItem(item));
    itemMap.set(item.general_purchase_order_id, arr);
  }
  return orders.map((order) => mapOrder(order, itemMap.get(order.id) || []));
};

export const getGeneralPurchaseOrderById = async (id) => {
  await ensureGeneralPurchaseTables();
  const [[order]] = await pool.query(`SELECT * FROM general_purchase_orders WHERE id = ?`, [id]);
  if (!order) {
    const err = new Error('general purchase order not found');
    err.statusCode = 404;
    throw err;
  }
  const [items] = await pool.query(
    `SELECT * FROM general_purchase_order_items WHERE general_purchase_order_id = ? ORDER BY id ASC`,
    [id]
  );
  const [logs] = await pool.query(
    `SELECT * FROM general_purchase_order_logs WHERE general_purchase_order_id = ? ORDER BY id ASC`,
    [id]
  );
  const timeline = logs.map((log) => ({
    id: log.id,
    status: log.to_status,
    fromStatus: log.from_status,
    action: log.action,
    actor: log.actor_name,
    note: log.details || '',
    at: log.created_at
  }));
  return mapOrder(order, items.map(mapItem), timeline);
};

const transitionOrder = async ({ id, allowedStatuses, nextStatus, updateSql, updateParams = [], logAction, logDetails, actor = {} }) => {
  await ensureGeneralPurchaseTables();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(`SELECT * FROM general_purchase_orders WHERE id = ? FOR UPDATE`, [id]);
    if (!order) {
      const err = new Error('general purchase order not found');
      err.statusCode = 404;
      throw err;
    }
    if (!allowedStatuses.includes(order.status)) {
      const err = new Error(`invalid status transition from ${order.status} to ${nextStatus}`);
      err.statusCode = 409;
      throw err;
    }
    await connection.query(updateSql, updateParams);
    await addLog(connection, id, {
      fromStatus: order.status,
      toStatus: nextStatus,
      action: logAction,
      actorUserId: actor.userId || null,
      actorName: actor.name || null,
      details: logDetails || null
    });
    await connection.commit();
    return getGeneralPurchaseOrderById(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const approveGeneralPurchaseOrder = ({ id, note, actor = {} }) =>
  transitionOrder({
    id,
    allowedStatuses: ['pending_review'],
    nextStatus: 'approved',
    updateSql: `UPDATE general_purchase_orders SET status = 'approved', approval_note = ?, approved_by = ?, approved_at = ? WHERE id = ?`,
    updateParams: [note || null, actor.userId || null, nowSql(), id],
    logAction: 'approve_pr',
    logDetails: note || 'อนุมัติ PR',
    actor
  });

export const rejectGeneralPurchaseOrder = ({ id, reason, actor = {} }) =>
  transitionOrder({
    id,
    allowedStatuses: ['pending_review'],
    nextStatus: 'rejected',
    updateSql: `UPDATE general_purchase_orders SET status = 'rejected', rejection_reason = ?, rejected_at = ? WHERE id = ?`,
    updateParams: [reason || null, nowSql(), id],
    logAction: 'reject_pr',
    logDetails: reason || 'ไม่อนุมัติ PR',
    actor
  });

export const issueGeneralPurchasePO = async ({
  id,
  poNumber,
  poDate,
  expectedDate,
  note,
  vendorName,
  vendorTaxId,
  documentDate,
  paymentDueDate,
  paymentMethod,
  vatType,
  withholdingTaxRate,
  actor = {}
}) => {
  await ensureGeneralPurchaseTables();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(`SELECT * FROM general_purchase_orders WHERE id = ? FOR UPDATE`, [id]);
    if (!order) {
      const err = new Error('general purchase order not found');
      err.statusCode = 404;
      throw err;
    }
    if (order.status !== 'approved') {
      const err = new Error(`invalid status transition from ${order.status} to awaiting_receipt`);
      err.statusCode = 409;
      throw err;
    }
    const effectivePoDate = toDateOrNull(poDate) || new Date().toISOString().slice(0, 10);
    const effectivePoNumber = String(poNumber || '').trim() || await generatePoNumber(connection, effectivePoDate);
    const cleanVendorName = String(vendorName || '').trim();
    if (!cleanVendorName) {
      const err = new Error('vendor name is required');
      err.statusCode = 400;
      throw err;
    }
    await connection.query(
      `UPDATE general_purchase_orders
       SET status = 'awaiting_receipt',
           po_number = ?,
           po_date = ?,
           expected_date = ?,
           vendor_name = ?,
           vendor_tax_id = ?,
           document_date = ?,
           payment_due_date = ?,
           payment_method = ?,
           vat_type = ?,
           withholding_tax_rate = ?,
           po_note = ?,
           issued_at = ?
       WHERE id = ?`,
      [
        effectivePoNumber,
        effectivePoDate,
        toDateOrNull(expectedDate),
        cleanVendorName,
        String(vendorTaxId || '').trim() || null,
        toDateOrNull(documentDate),
        toDateOrNull(paymentDueDate),
        paymentMethod || null,
        vatType || null,
        toNumber(withholdingTaxRate),
        note || null,
        nowSql(),
        id
      ]
    );
    await addLog(connection, id, {
      fromStatus: order.status,
      toStatus: 'awaiting_receipt',
      action: 'issue_po',
      actorUserId: actor.userId || null,
      actorName: actor.name || null,
      details: `ออก PO ${effectivePoNumber}`
    });
    await connection.commit();
    return getGeneralPurchaseOrderById(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const receiveGeneralPurchaseOrder = async ({ id, items = [], taxInvoiceNo, note, actor = {} }) => {
  await ensureGeneralPurchaseTables();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(`SELECT * FROM general_purchase_orders WHERE id = ? FOR UPDATE`, [id]);
    if (!order) {
      const err = new Error('general purchase order not found');
      err.statusCode = 404;
      throw err;
    }
    if (order.status !== 'awaiting_receipt') {
      const err = new Error(`invalid status transition from ${order.status} to received`);
      err.statusCode = 409;
      throw err;
    }

    for (const item of Array.isArray(items) ? items : []) {
      await connection.query(
        `UPDATE general_purchase_order_items
         SET received_quantity = ?, actual_price = ?
         WHERE id = ? AND general_purchase_order_id = ?`,
        [toNumber(item.actualQuantity ?? item.received_quantity), toNumber(item.actualPrice ?? item.actual_price), Number(item.id), id]
      );
    }

    const [[sumRow]] = await connection.query(
      `SELECT COALESCE(SUM(actual_price), 0) AS actual_total FROM general_purchase_order_items WHERE general_purchase_order_id = ?`,
      [id]
    );

    await connection.query(
      `UPDATE general_purchase_orders
       SET status = 'received', tax_invoice_no = COALESCE(NULLIF(?, ''), tax_invoice_no), received_note = ?,
           received_by = ?, actual_total_amount = ?, received_at = ?, closed_at = ?
       WHERE id = ?`,
      [taxInvoiceNo || '', note || null, actor.userId || null, Number(sumRow.actual_total || 0), nowSql(), nowSql(), id]
    );

    await addLog(connection, id, {
      fromStatus: order.status,
      toStatus: 'received',
      action: 'receive_and_price',
      actorUserId: actor.userId || null,
      actorName: actor.name || null,
      details: note || 'รับของและลงราคาจริง'
    });
    await connection.commit();
    return getGeneralPurchaseOrderById(id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
