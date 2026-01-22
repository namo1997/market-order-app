import pool from '../config/database.js';

// ตรวจสอบสถานะการเปิด/ปิดรับออเดอร์
export const getOrderStatus = async (date) => {
  const [rows] = await pool.query(
    'SELECT * FROM order_status_settings WHERE order_date = ?',
    [date]
  );

  if (rows.length === 0) {
    // ถ้าไม่มีข้อมูล แสดงว่ายังไม่เปิดรับออเดอร์
    return { is_open: false, order_date: date };
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
export const getUserOrders = async (userId, filters = {}) => {
  let query = `
    SELECT o.id, o.order_number, o.order_date, o.status, o.total_amount,
           o.submitted_at, o.created_at,
           COALESCE(oss.is_open, false) as is_open,
           COUNT(DISTINCT oi.id) as item_count
    FROM orders o
    LEFT JOIN order_status_settings oss ON o.order_date = oss.order_date
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = ?
  `;
  const params = [userId];

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
  const [orderRows] = await pool.query(
    `SELECT o.*, u.name as user_name, u.department_id,
            d.name as department_name, b.name as branch_name,
            COALESCE(oss.is_open, false) as is_open
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
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
export const updateOrder = async (orderId, orderData) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { items } = orderData;

    // ตรวจสอบสถานะ order
    const [orderRows] = await connection.query(
      'SELECT status, order_date FROM orders WHERE id = ?',
      [orderId]
    );

    if (orderRows.length === 0) {
      throw new Error('Order not found');
    }

    const order = orderRows[0];

    if (order.status !== 'draft' && order.status !== 'submitted') {
      throw new Error('Only draft or submitted orders can be updated');
    }

    // ตรวจสอบว่าเปิดรับออเดอร์หรือไม่
    const status = await getOrderStatus(order.order_date);
    if (!status.is_open) {
      throw new Error('Order receiving is closed');
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
