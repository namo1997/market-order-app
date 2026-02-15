import pool from '../config/database.js';
import { ensureInventoryTables } from './inventory.model.js';

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

export const ensureOrderReceivingColumns = async () => {
  const columns = [
    { name: 'received_quantity', definition: 'DECIMAL(10,2) NULL' },
    { name: 'received_by_user_id', definition: 'INT NULL' },
    { name: 'received_at', definition: 'TIMESTAMP NULL' },
    { name: 'receive_notes', definition: 'TEXT NULL' },
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
  const defaultNote = delta >= 0
    ? `รับสินค้าเข้าคลังจากใบสั่งซื้อ ${context.order_number || ''}`.trim()
    : `ปรับปรุงรับสินค้าเข้าคลังจากใบสั่งซื้อ ${context.order_number || ''}`.trim();
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

const updateOrderItemReceivingWithInventory = async ({
  connection,
  orderItemId,
  receivedQuantity,
  isReceived,
  userId,
  receiveNotes
}) => {
  const [rows] = await connection.query(
    `SELECT
      oi.id AS order_item_id,
      oi.product_id,
      oi.received_quantity,
      o.order_number,
      d.id AS department_id,
      p.name AS product_name,
      COALESCE(p.is_countable, true) AS is_countable
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.id = ?
     FOR UPDATE`,
    [orderItemId]
  );

  if (rows.length === 0) return 0;

  const context = rows[0];
  const previousReceived = toNumeric(context.received_quantity, 0);
  const nextReceived = isReceived ? toNumeric(receivedQuantity, 0) : 0;
  const receivedAt = isReceived ? new Date() : null;
  const receivedBy = isReceived ? userId : null;

  if (receiveNotes === undefined) {
    await connection.query(
      `UPDATE order_items
       SET received_quantity = ?,
           is_received = ?,
           received_at = ?,
           received_by_user_id = ?
       WHERE id = ?`,
      [isReceived ? nextReceived : null, isReceived, receivedAt, receivedBy, orderItemId]
    );
  } else {
    await connection.query(
      `UPDATE order_items
       SET received_quantity = ?,
           is_received = ?,
           receive_notes = ?,
           received_at = ?,
           received_by_user_id = ?
       WHERE id = ?`,
      [isReceived ? nextReceived : null, isReceived, receiveNotes, receivedAt, receivedBy, orderItemId]
    );
  }

  const delta = nextReceived - previousReceived;
  await createInventoryTransactionForReceiving({
    connection,
    context,
    deltaQuantity: delta,
    userId,
    noteOverride: receiveNotes
  });

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
      const itemValues = items.map(item => [
        order_id,
        item.product_id,
        item.quantity,
        item.requested_price,
        item.notes ?? null
      ]);

      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, requested_price, notes)
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
            s.name as supplier_name
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     WHERE oi.order_id = ?
     ORDER BY p.name`,
    [orderId]
  );

  order.items = itemRows;
  return order;
};

// อัพเดทคำสั่งซื้อ
export const updateOrder = async (orderId, orderData, options = {}) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { items } = orderData;
    const isAdmin = options.isAdmin === true;

    // ตรวจสอบสถานะ order
    const [orderRows] = await connection.query(
      'SELECT status, order_date FROM orders WHERE id = ?',
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

    // ลบ items เก่า
    await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);

    // เพิ่ม items ใหม่
    let total_amount = 0;

    if (items && items.length > 0) {
      const itemValues = items.map(item => {
        total_amount += (item.quantity || 0) * (item.requested_price || 0);
        return [
          orderId,
          item.product_id,
          item.quantity,
          item.requested_price,
          item.notes ?? null
        ];
      });

      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, requested_price, notes)
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

    // ตรวจสอบสถานะ order
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

export const getReceivingItemsByDepartments = async ({ date, departmentIds = [] }) => {
  await ensureOrderReceivingColumns();
  const normalizedIds = (departmentIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  const params = [date];
  let departmentFilter = '';
  if (normalizedIds.length > 0) {
    departmentFilter = `AND d.id IN (${normalizedIds.map(() => '?').join(', ')})`;
    params.push(...normalizedIds);
  }

  const [rows] = await pool.query(
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.received_quantity, oi.is_received,
            oi.received_at, oi.received_by_user_id, oi.receive_notes,
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
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users ru ON oi.received_by_user_id = ru.id
     WHERE o.order_date = ?
       AND o.status IN ('submitted', 'confirmed', 'completed')
     ${departmentFilter}
     ORDER BY s.name, b.name, d.name, o.order_number, p.name`,
    params
  );

  return rows;
};

export const getReceivingItemsByUser = async ({ date, userId }) => {
  await ensureOrderReceivingColumns();
  const [rows] = await pool.query(
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.received_quantity, oi.is_received,
            oi.received_at, oi.received_by_user_id, oi.receive_notes,
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
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users ru ON oi.received_by_user_id = ru.id
     WHERE o.order_date = ?
       AND o.user_id = ?
       AND o.status IN ('submitted', 'confirmed', 'completed')
     ORDER BY s.name, o.order_number, p.name`,
    [date, userId]
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
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.received_quantity, oi.is_received,
            oi.received_at, oi.received_by_user_id, oi.receive_notes,
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
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users ru ON oi.received_by_user_id = ru.id
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
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.received_quantity, oi.is_received,
            oi.received_at, oi.received_by_user_id, oi.receive_notes,
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
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users ru ON oi.received_by_user_id = ru.id
     WHERE b.id = ?
       AND oi.received_at IS NOT NULL
       AND DATE(oi.received_at) BETWEEN ? AND ?
     ORDER BY oi.received_at DESC, oi.id DESC
     LIMIT ${safeLimit}`,
    [branchId, fromDate, toDate]
  );

  return rows;
};

export const createManualReceivingItem = async ({
  date,
  userId,
  productId,
  receivedQuantity,
  receiveNotes = null
}) => {
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [productRows] = await connection.query(
      'SELECT id FROM products WHERE id = ? LIMIT 1',
      [productId]
    );
    if (productRows.length === 0) {
      throw new Error('Product not found');
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
         quantity,
         requested_price,
         received_quantity,
         is_received,
         received_at,
         received_by_user_id,
         receive_notes,
         notes
       ) VALUES (?, ?, 0, NULL, NULL, false, NULL, NULL, NULL, ?)`,
      [
        targetOrderId,
        productId,
        receiveNotes
      ]
    );

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
      SUM(oi.quantity) as quantity,
      GROUP_CONCAT(
        CONCAT(oi.id, ':', oi.quantity, ':', COALESCE(oi.received_quantity, ''), ':', COALESCE(oi.received_at, ''))
        ORDER BY d.name, o.order_number
        SEPARATOR '|'
      ) as order_items_data,
      GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ', ') as department_names,
      MIN(o.order_date) as order_date,
      b.id as branch_id,
      b.name as branch_name
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     WHERE o.order_date = ?
       AND b.id = ?
       AND o.status IN ('submitted', 'confirmed', 'completed')
     GROUP BY p.id, p.name, u.name, u.abbreviation, s.id, s.name, b.id, b.name
     ORDER BY s.name, p.name`,
    [date, branchId]
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
