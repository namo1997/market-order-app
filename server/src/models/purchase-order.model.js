import pool from '../config/database.js';

// ====================================
// Auto-create Tables
// ====================================

let tablesEnsured = false;

export const ensurePurchaseOrderTables = async () => {
  if (tablesEnsured) return;
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        supplier_master_id INT NOT NULL,
        department_id INT,
        branch_id INT,
        created_by INT NOT NULL,
        po_date DATE NOT NULL,
        expected_date DATE,
        status ENUM('draft','confirmed','partial','completed','cancelled') DEFAULT 'draft',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity_ordered DECIMAL(10,2) NOT NULL,
        unit_price DECIMAL(10,2),
        quantity_received DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_receipts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        po_id INT NOT NULL,
        po_item_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity_received DECIMAL(10,2) NOT NULL,
        received_by INT NOT NULL,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    tablesEnsured = true;
  } catch (err) {
    console.error('ensurePurchaseOrderTables error:', err);
    throw err;
  } finally {
    connection.release();
  }
};

// ====================================
// PO Number Generator
// ====================================

const generatePoNumber = async (connection, poDate) => {
  const dateStr = poDate.replace(/-/g, '');
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS cnt FROM purchase_orders WHERE po_date = ?`,
    [poDate]
  );
  const seq = String(Number(row.cnt) + 1).padStart(3, '0');
  return `PO-${dateStr}-${seq}`;
};

// ====================================
// Create PO
// ====================================

export const createPurchaseOrder = async ({
  supplierMasterId,
  departmentId,
  branchId,
  createdBy,
  poDate,
  expectedDate,
  notes,
  items = []
}) => {
  await ensurePurchaseOrderTables();

  if (!supplierMasterId || !createdBy || !poDate) {
    const err = new Error('supplierMasterId, createdBy, poDate are required');
    err.statusCode = 400;
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('items must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const poNumber = await generatePoNumber(connection, poDate);

    const [poResult] = await connection.query(
      `INSERT INTO purchase_orders
        (po_number, supplier_master_id, department_id, branch_id, created_by, po_date, expected_date, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [
        poNumber,
        Number(supplierMasterId),
        departmentId ? Number(departmentId) : null,
        branchId ? Number(branchId) : null,
        Number(createdBy),
        poDate,
        expectedDate || null,
        notes || null
      ]
    );
    const poId = poResult.insertId;

    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = Number(item.quantity_ordered);
      const price = item.unit_price != null ? Number(item.unit_price) : null;
      if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty <= 0) {
        const err = new Error(`Invalid item data for product_id: ${item.product_id}`);
        err.statusCode = 400;
        throw err;
      }
      await connection.query(
        `INSERT INTO purchase_order_items (po_id, product_id, quantity_ordered, unit_price, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [poId, productId, qty, price, item.notes || null]
      );
    }

    await connection.commit();
    return getPurchaseOrderById(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

// ====================================
// List POs
// ====================================

export const getPurchaseOrders = async (filters = {}) => {
  await ensurePurchaseOrderTables();

  let query = `
    SELECT
      po.id, po.po_number, po.status, po.po_date, po.expected_date, po.notes,
      po.created_at, po.updated_at,
      sm.name AS supplier_name, sm.phone AS supplier_phone,
      u.name AS created_by_name,
      d.name AS department_name,
      b.name AS branch_name,
      COUNT(poi.id) AS item_count,
      SUM(poi.quantity_ordered) AS total_qty_ordered,
      SUM(poi.quantity_received) AS total_qty_received
    FROM purchase_orders po
    LEFT JOIN supplier_masters sm ON sm.id = po.supplier_master_id
    LEFT JOIN users u ON u.id = po.created_by
    LEFT JOIN departments d ON d.id = po.department_id
    LEFT JOIN branches b ON b.id = po.branch_id
    LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.status) {
    query += ' AND po.status = ?';
    params.push(filters.status);
  }
  if (filters.supplierMasterId) {
    query += ' AND po.supplier_master_id = ?';
    params.push(Number(filters.supplierMasterId));
  }
  if (filters.startDate) {
    query += ' AND po.po_date >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    query += ' AND po.po_date <= ?';
    params.push(filters.endDate);
  }
  if (filters.branchId) {
    query += ' AND po.branch_id = ?';
    params.push(Number(filters.branchId));
  }
  if (filters.departmentId) {
    query += ' AND po.department_id = ?';
    params.push(Number(filters.departmentId));
  }

  query += ' GROUP BY po.id ORDER BY po.created_at DESC';

  const limit = Math.min(Math.max(1, parseInt(filters.limit) || 100), 500);
  query += ` LIMIT ${limit}`;

  const [rows] = await pool.query(query, params);
  return rows;
};

// ====================================
// Get PO by ID
// ====================================

export const getPurchaseOrderById = async (id) => {
  await ensurePurchaseOrderTables();

  const [[po]] = await pool.query(
    `SELECT
       po.id, po.po_number, po.status, po.po_date, po.expected_date, po.notes,
       po.supplier_master_id, po.department_id, po.branch_id, po.created_by,
       po.created_at, po.updated_at,
       sm.name AS supplier_name, sm.phone AS supplier_phone,
       sm.contact_person AS supplier_contact, sm.address AS supplier_address,
       u.name AS created_by_name,
       d.name AS department_name,
       b.name AS branch_name
     FROM purchase_orders po
     LEFT JOIN supplier_masters sm ON sm.id = po.supplier_master_id
     LEFT JOIN users u ON u.id = po.created_by
     LEFT JOIN departments d ON d.id = po.department_id
     LEFT JOIN branches b ON b.id = po.branch_id
     WHERE po.id = ?`,
    [id]
  );
  if (!po) {
    const err = new Error('Purchase order not found');
    err.statusCode = 404;
    throw err;
  }

  const [items] = await pool.query(
    `SELECT
       poi.id, poi.product_id, poi.quantity_ordered, poi.unit_price,
       poi.quantity_received, poi.notes,
       p.name AS product_name, p.code AS product_code, p.barcode, p.qr_code,
       u.abbreviation AS unit_abbr
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE poi.po_id = ?
     ORDER BY poi.id`,
    [id]
  );

  const [receipts] = await pool.query(
    `SELECT
       por.id, por.po_item_id, por.product_id, por.quantity_received,
       por.received_at, por.notes,
       u.name AS received_by_name,
       p.name AS product_name
     FROM purchase_order_receipts por
     LEFT JOIN users u ON u.id = por.received_by
     LEFT JOIN products p ON p.id = por.product_id
     WHERE por.po_id = ?
     ORDER BY por.received_at DESC`,
    [id]
  );

  return { ...po, items, receipts };
};

// ====================================
// Receive PO Items
// ====================================

export const receivePurchaseOrder = async ({ poId, items = [], receivedBy }) => {
  await ensurePurchaseOrderTables();

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('items must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ตรวจสอบ PO
    const [[po]] = await connection.query(
      `SELECT po.*, d.id AS dept_id FROM purchase_orders po
       LEFT JOIN departments d ON d.id = po.department_id
       WHERE po.id = ? FOR UPDATE`,
      [poId]
    );
    if (!po) {
      const err = new Error('Purchase order not found');
      err.statusCode = 404;
      throw err;
    }
    if (['completed', 'cancelled'].includes(po.status)) {
      const err = new Error(`ไม่สามารถรับสินค้าได้ เนื่องจาก PO มีสถานะ: ${po.status}`);
      err.statusCode = 400;
      throw err;
    }

    const departmentId = po.department_id;

    for (const receiveItem of items) {
      const poItemId = Number(receiveItem.po_item_id);
      const qtyReceived = Number(receiveItem.quantity_received);
      if (!Number.isFinite(poItemId) || !Number.isFinite(qtyReceived) || qtyReceived <= 0) continue;

      // ดึง item ปัจจุบัน
      const [[poItem]] = await connection.query(
        `SELECT poi.*, p.id AS pid FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         WHERE poi.id = ? AND poi.po_id = ? FOR UPDATE`,
        [poItemId, poId]
      );
      if (!poItem) continue;

      const productId = poItem.product_id;
      const newQtyReceived = Number(poItem.quantity_received) + qtyReceived;

      // บันทึก receipt
      await connection.query(
        `INSERT INTO purchase_order_receipts (po_id, po_item_id, product_id, quantity_received, received_by, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [poId, poItemId, productId, qtyReceived, receivedBy, receiveItem.notes || null]
      );

      // อัปเดต quantity_received ใน purchase_order_items
      await connection.query(
        `UPDATE purchase_order_items SET quantity_received = ? WHERE id = ?`,
        [newQtyReceived, poItemId]
      );

      // ดึงยอดคงเหลือ inventory ปัจจุบัน (ถ้ามี department)
      if (departmentId) {
        const [[balRow]] = await connection.query(
          `SELECT quantity FROM inventory_balance
           WHERE product_id = ? AND department_id = ? FOR UPDATE`,
          [productId, departmentId]
        );
        const balanceBefore = balRow ? Number(balRow.quantity) : 0;
        const balanceAfter = balanceBefore + qtyReceived;

        // สร้าง inventory transaction
        const referenceId = `PO-${poId}-${poItemId}-${Date.now()}`;
        const [txResult] = await connection.query(
          `INSERT INTO inventory_transactions
             (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
              reference_type, reference_id, notes, created_by)
           VALUES (?, ?, 'receive', ?, ?, ?, 'purchase_order', ?, ?, ?)`,
          [
            productId, departmentId, qtyReceived,
            balanceBefore, balanceAfter,
            referenceId,
            `รับสินค้าจาก PO ${po.po_number}`,
            receivedBy
          ]
        );

        // อัปเดต inventory_balance
        await connection.query(
          `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity = VALUES(quantity),
             last_transaction_id = VALUES(last_transaction_id),
             last_updated = CURRENT_TIMESTAMP`,
          [productId, departmentId, balanceAfter, txResult.insertId]
        );
      }
    }

    // คำนวณสถานะใหม่
    const [[statusRow]] = await connection.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN quantity_received >= quantity_ordered THEN 1 ELSE 0 END) AS completed_count,
         SUM(CASE WHEN quantity_received > 0 THEN 1 ELSE 0 END) AS partial_count
       FROM purchase_order_items WHERE po_id = ?`,
      [poId]
    );
    let newStatus = po.status;
    if (Number(statusRow.completed_count) >= Number(statusRow.total)) {
      newStatus = 'completed';
    } else if (Number(statusRow.partial_count) > 0) {
      newStatus = 'partial';
    }

    await connection.query(
      `UPDATE purchase_orders SET status = ? WHERE id = ?`,
      [newStatus, poId]
    );

    await connection.commit();
    return getPurchaseOrderById(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

// ====================================
// Cancel PO
// ====================================

export const cancelPurchaseOrder = async (id) => {
  await ensurePurchaseOrderTables();

  const [[po]] = await pool.query(
    `SELECT id, status FROM purchase_orders WHERE id = ?`, [id]
  );
  if (!po) {
    const err = new Error('Purchase order not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['draft', 'confirmed'].includes(po.status)) {
    const err = new Error(`ไม่สามารถยกเลิกได้ เนื่องจาก PO มีสถานะ: ${po.status}`);
    err.statusCode = 400;
    throw err;
  }

  await pool.query(
    `UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?`, [id]
  );
  return getPurchaseOrderById(id);
};
