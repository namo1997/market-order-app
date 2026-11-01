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
        supplier_master_id INT NULL,
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

    const [supplierColumnRows] = await connection.query(
      "SHOW COLUMNS FROM purchase_orders LIKE 'supplier_master_id'"
    );
    if (Array.isArray(supplierColumnRows) && supplierColumnRows.length > 0) {
      const supplierColumn = supplierColumnRows[0];
      if (String(supplierColumn.Null || '').toUpperCase() !== 'YES') {
        await connection.query(
          'ALTER TABLE purchase_orders MODIFY COLUMN supplier_master_id INT NULL'
        );
      }
    }

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

    const [linkTableRows] = await connection.query(
      "SHOW TABLES LIKE 'product_supplier_master_links'"
    );
    if (Array.isArray(linkTableRows) && linkTableRows.length > 0) {
      const [purchaseUnitColumn] = await connection.query(
        "SHOW COLUMNS FROM product_supplier_master_links LIKE 'purchase_unit_id'"
      );
      if (purchaseUnitColumn.length === 0) {
        await connection.query(
          'ALTER TABLE product_supplier_master_links ADD COLUMN purchase_unit_id INT NULL AFTER is_primary'
        );
      }

      const [purchaseMultiplierColumn] = await connection.query(
        "SHOW COLUMNS FROM product_supplier_master_links LIKE 'purchase_to_base_multiplier'"
      );
      if (purchaseMultiplierColumn.length === 0) {
        await connection.query(
          'ALTER TABLE product_supplier_master_links ADD COLUMN purchase_to_base_multiplier DECIMAL(16,6) NULL AFTER purchase_unit_id'
        );
      }
    }

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

// อ่านเลขล่าสุดด้วย pool (autocommit) เพื่อให้เห็นแถวที่ transaction อื่น commit แล้วเสมอ
// แล้ว INSERT ใน transaction; ถ้าชน UNIQUE(po_number) จะ retry ด้วยเลขถัดไป
const generatePoNumber = async (poDate) => {
  const dateStr = poDate.replace(/-/g, '');
  const prefix = `PO-${dateStr}-`;
  const [[row]] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(po_number, ?) AS UNSIGNED)) AS max_seq
     FROM purchase_orders
     WHERE po_number LIKE ?`,
    [prefix.length + 1, `${prefix}%`]
  );
  const seq = String(Number(row?.max_seq || 0) + 1).padStart(3, '0');
  return `${prefix}${seq}`;
};

const PO_NUMBER_MAX_ATTEMPTS = 8;

// ====================================
// Validation helpers
// ====================================

// DECIMAL(10,2): เก็บได้ 2 ตำแหน่ง และไม่เกิน 99,999,999.99
const MAX_PO_QUANTITY = 1000000;
const MAX_PO_UNIT_PRICE = 10000000;

const badRequest = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const toCents = (value) => Math.round(Number(value) * 100);
const roundQty = (value) => toCents(value) / 100;

const isValidDateOnly = (value) => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 2000 && y <= 2100 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

const parsePositiveInt = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const getPurchaseOrderAccessInfo = async (id) => {
  await ensurePurchaseOrderTables();
  const [[row]] = await pool.query(
    'SELECT id, department_id, branch_id, status FROM purchase_orders WHERE id = ?',
    [id]
  );
  return row || null;
};

export const getBranchInfo = async (branchId) => {
  if (!branchId) return null;
  const [[row]] = await pool.query('SELECT id, code, name FROM branches WHERE id = ?', [branchId]);
  return row || null;
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

  if (!createdBy) {
    throw badRequest('createdBy is required');
  }
  const cleanPoDate = String(poDate || '').trim();
  if (!isValidDateOnly(cleanPoDate)) {
    throw badRequest('วันที่สั่งซื้อไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)');
  }
  const cleanExpectedDate = expectedDate ? String(expectedDate).trim() : null;
  if (cleanExpectedDate && !isValidDateOnly(cleanExpectedDate)) {
    throw badRequest('วันที่คาดรับสินค้าไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('items must be a non-empty array');
  }
  if (items.length > 1000) {
    throw badRequest('จำนวนรายการในใบสั่งซื้อมากเกินไป');
  }

  let cleanSupplierMasterId = null;
  if (supplierMasterId != null && supplierMasterId !== '') {
    cleanSupplierMasterId = parsePositiveInt(supplierMasterId);
    if (!cleanSupplierMasterId) throw badRequest('ซัพพลายเออร์ไม่ถูกต้อง');
    const [[supplierRow]] = await pool.query('SELECT id FROM supplier_masters WHERE id = ? LIMIT 1', [cleanSupplierMasterId]);
    if (!supplierRow) throw badRequest('ไม่พบซัพพลายเออร์ที่เลือก');
  }

  const cleanItems = items.map((item, index) => {
    const label = `รายการที่ ${index + 1}`;
    const productId = parsePositiveInt(item?.product_id);
    if (!productId) throw badRequest(`${label}: รหัสสินค้าไม่ถูกต้อง`);
    const rawQty = Number(item?.quantity_ordered);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      throw badRequest(`${label}: จำนวนต้องเป็นตัวเลขมากกว่า 0`);
    }
    if (rawQty > MAX_PO_QUANTITY) {
      throw badRequest(`${label}: จำนวนสูงเกินไป (ไม่เกิน ${MAX_PO_QUANTITY.toLocaleString('en-US')})`);
    }
    const qty = roundQty(rawQty);
    if (qty <= 0) {
      throw badRequest(`${label}: จำนวนน้อยเกินไป (ระบบเก็บทศนิยม 2 ตำแหน่ง ขั้นต่ำ 0.01)`);
    }
    let price = null;
    if (item?.unit_price != null && item.unit_price !== '') {
      price = Number(item.unit_price);
      if (!Number.isFinite(price) || price < 0) {
        throw badRequest(`${label}: ราคาต่อหน่วยต้องเป็นตัวเลขไม่ติดลบ`);
      }
      if (price > MAX_PO_UNIT_PRICE) {
        throw badRequest(`${label}: ราคาต่อหน่วยสูงเกินไป`);
      }
      price = roundQty(price);
    }
    return { productId, qty, price, notes: item?.notes ? String(item.notes) : null };
  });

  const productIds = [...new Set(cleanItems.map((item) => item.productId))];
  const [productRows] = await pool.query('SELECT id FROM products WHERE id IN (?)', [productIds]);
  const existingProductIds = new Set(productRows.map((row) => Number(row.id)));
  const missingProductId = productIds.find((id) => !existingProductIds.has(id));
  if (missingProductId) {
    throw badRequest(`ไม่พบสินค้า product_id: ${missingProductId}`);
  }

  // เลข PO อาจชนกันเมื่อสร้างพร้อมกัน: ถ้า INSERT ชน UNIQUE หรือเกิด deadlock ให้เริ่ม transaction ใหม่ด้วยเลขถัดไป
  const connection = await pool.getConnection();
  try {
    for (let attempt = 1; ; attempt += 1) {
      await connection.beginTransaction();
      try {
        const poNumber = await generatePoNumber(cleanPoDate);
        const [poResult] = await connection.query(
          `INSERT INTO purchase_orders
            (po_number, supplier_master_id, department_id, branch_id, created_by, po_date, expected_date, notes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [
            poNumber,
            cleanSupplierMasterId,
            departmentId ? Number(departmentId) : null,
            branchId ? Number(branchId) : null,
            Number(createdBy),
            cleanPoDate,
            cleanExpectedDate,
            notes || null
          ]
        );
        const poId = poResult.insertId;

        for (const item of cleanItems) {
          await connection.query(
            `INSERT INTO purchase_order_items (po_id, product_id, quantity_ordered, unit_price, notes)
             VALUES (?, ?, ?, ?, ?)`,
            [poId, item.productId, item.qty, item.price, item.notes]
          );
        }

        await connection.commit();
        return getPurchaseOrderById(poId);
      } catch (err) {
        await connection.rollback();
        const retryable = ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err?.code);
        if (!retryable || attempt >= PO_NUMBER_MAX_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 80) * attempt));
      }
    }
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
       u.abbreviation AS unit_abbr,
       psml.purchase_unit_id,
       psml.purchase_to_base_multiplier,
       pu.abbreviation AS purchase_unit_abbr,
       pu.name AS purchase_unit_name
     FROM purchase_order_items poi
     JOIN purchase_orders po_ref ON po_ref.id = poi.po_id
     JOIN products p ON p.id = poi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN product_supplier_master_links psml
       ON psml.product_id = poi.product_id
      AND psml.supplier_master_id = po_ref.supplier_master_id
     LEFT JOIN units pu ON pu.id = psml.purchase_unit_id
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

export const receivePurchaseOrder = async ({ poId, items = [], receivedBy, supplierMasterId = null }) => {
  await ensurePurchaseOrderTables();

  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('กรุณาระบุจำนวนรับอย่างน้อย 1 รายการ');
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

    let effectiveSupplierMasterId = po.supplier_master_id ? Number(po.supplier_master_id) : null;
    if (!effectiveSupplierMasterId) {
      const parsedSupplierMasterId = Number(supplierMasterId);
      if (!Number.isFinite(parsedSupplierMasterId) || parsedSupplierMasterId <= 0) {
        const err = new Error('กรุณาเลือกซัพพลายเออร์ก่อนบันทึกรับสินค้า');
        err.statusCode = 400;
        throw err;
      }
      const [[supplierRow]] = await connection.query(
        'SELECT id FROM supplier_masters WHERE id = ? LIMIT 1',
        [parsedSupplierMasterId]
      );
      if (!supplierRow) {
        const err = new Error('ไม่พบซัพพลายเออร์ที่เลือก');
        err.statusCode = 400;
        throw err;
      }
      await connection.query(
        'UPDATE purchase_orders SET supplier_master_id = ? WHERE id = ?',
        [parsedSupplierMasterId, poId]
      );
      effectiveSupplierMasterId = parsedSupplierMasterId;
    }

    const departmentId = po.department_id;
    let receivedLineCount = 0;
    const seenPoItemIds = new Set();

    for (const receiveItem of items) {
      const poItemId = parsePositiveInt(receiveItem?.po_item_id);
      if (!poItemId) {
        throw badRequest('รายการรับสินค้าไม่ถูกต้อง (po_item_id)');
      }
      if (seenPoItemIds.has(poItemId)) {
        throw badRequest('มีรายการรับสินค้าซ้ำในคำขอเดียวกัน');
      }
      seenPoItemIds.add(poItemId);
      const rawQtyReceived =
        receiveItem.quantity_received === '' || receiveItem.quantity_received == null
          ? 0
          : Number(receiveItem.quantity_received);
      if (!Number.isFinite(rawQtyReceived) || rawQtyReceived < 0) {
        throw badRequest('จำนวนรับต้องเป็นตัวเลขไม่ติดลบ');
      }
      // 0 = ไม่รับรายการนี้ในครั้งนี้
      if (rawQtyReceived === 0) continue;
      // ปัดเป็นทศนิยม 2 ตำแหน่งให้ตรงกับที่ฐานข้อมูลเก็บ
      const qtyReceived = roundQty(rawQtyReceived);
      if (qtyReceived <= 0) {
        throw badRequest('จำนวนรับน้อยเกินไป (ระบบเก็บทศนิยม 2 ตำแหน่ง ขั้นต่ำ 0.01)');
      }

      const hasUnitPrice = Object.prototype.hasOwnProperty.call(receiveItem, 'unit_price');
      let unitPrice = null;
      if (hasUnitPrice) {
        if (receiveItem.unit_price === '' || receiveItem.unit_price == null) {
          unitPrice = null;
        } else {
          unitPrice = Number(receiveItem.unit_price);
          if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_PO_UNIT_PRICE) {
            throw badRequest(`ราคาต่อหน่วยไม่ถูกต้อง (po_item_id: ${poItemId})`);
          }
          unitPrice = roundQty(unitPrice);
        }
      }

      // ดึง item ปัจจุบัน
      const [[poItem]] = await connection.query(
        `SELECT poi.*, p.id AS pid, p.name AS product_name FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         WHERE poi.id = ? AND poi.po_id = ? FOR UPDATE`,
        [poItemId, poId]
      );
      if (!poItem) {
        throw badRequest(`ไม่พบรายการสินค้าในใบสั่งซื้อนี้ (po_item_id: ${poItemId})`);
      }

      // ห้ามรับเกินจำนวนคงเหลือ (เทียบเป็นหน่วยสตางค์/0.01 เพื่อเลี่ยงปัญหาทศนิยม)
      const remainingCents = toCents(poItem.quantity_ordered) - toCents(poItem.quantity_received || 0);
      if (remainingCents <= 0) {
        throw badRequest(`${poItem.product_name || 'สินค้า'} รับครบแล้ว ไม่สามารถรับเพิ่มได้`);
      }
      if (toCents(qtyReceived) > remainingCents) {
        throw badRequest(
          `รับเกินจำนวนที่สั่ง: ${poItem.product_name || 'สินค้า'} คงเหลือรับได้ ${remainingCents / 100} แต่ระบุ ${qtyReceived}`
        );
      }

      const productId = poItem.product_id;
      const newQtyReceived = (toCents(poItem.quantity_received || 0) + toCents(qtyReceived)) / 100;
      receivedLineCount += 1;

      // บันทึก receipt
      await connection.query(
        `INSERT INTO purchase_order_receipts (po_id, po_item_id, product_id, quantity_received, received_by, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [poId, poItemId, productId, qtyReceived, receivedBy, receiveItem.notes || null]
      );

      // อัปเดต quantity_received ใน purchase_order_items
      if (hasUnitPrice && unitPrice != null) {
        await connection.query(
          `UPDATE purchase_order_items
           SET quantity_received = ?, unit_price = ?
           WHERE id = ?`,
          [newQtyReceived, unitPrice, poItemId]
        );
      } else {
        await connection.query(
          `UPDATE purchase_order_items
           SET quantity_received = ?
           WHERE id = ?`,
          [newQtyReceived, poItemId]
        );
      }

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

    if (receivedLineCount === 0) {
      throw badRequest('กรุณาระบุจำนวนรับมากกว่า 0 อย่างน้อย 1 รายการ');
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
