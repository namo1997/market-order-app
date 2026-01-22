import pool from '../config/database.js';
import { ensurePurchaseWalkOrderTable } from './purchase-walk.model.js';

// ดึงคำสั่งซื้อทั้งหมด (สำหรับ admin)
export const getAllOrders = async (filters = {}) => {
  let query = `
    SELECT o.id, o.order_number, o.order_date, o.status, o.total_amount,
           o.submitted_at, o.created_at,
           u.id as user_id, u.name as user_name,
           d.id as department_id, d.name as department_name,
           b.id as branch_id, b.name as branch_name
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN departments d ON u.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.status) {
    query += ' AND o.status = ?';
    params.push(filters.status);
  }

  if (filters.date) {
    query += ' AND o.order_date = ?';
    params.push(filters.date);
  }

  if (filters.branchId) {
    query += ' AND b.id = ?';
    params.push(filters.branchId);
  }

  if (filters.departmentId) {
    query += ' AND d.id = ?';
    params.push(filters.departmentId);
  }

  query += ' ORDER BY o.order_date DESC, o.created_at DESC';

  const [rows] = await pool.query(query, params);
  return rows;
};

// ดึงคำสั่งซื้อทั้งหมดแยกตามสาขา/แผนก
export const getOrdersByBranch = async (date) => {
  const [rows] = await pool.query(
    `SELECT b.id as branch_id, b.name as branch_name,
            d.id as department_id, d.name as department_name,
            o.id, o.order_number, o.status, o.total_amount,
            u.id as user_id, u.name as user_name,
            COUNT(oi.id) as item_count
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN order_items oi ON o.id = oi.order_id
     WHERE o.order_date = ? AND o.status = 'submitted'
     GROUP BY b.id, d.id, o.id
     ORDER BY b.name, d.name, u.name`,
    [date]
  );

  // จัดกลุ่มข้อมูล
  const branches = {};

  rows.forEach(row => {
    const branchId = row.branch_id;
    const deptId = row.department_id;

    if (!branches[branchId]) {
      branches[branchId] = {
        id: branchId,
        name: row.branch_name,
        departments: {}
      };
    }

    if (!branches[branchId].departments[deptId]) {
      branches[branchId].departments[deptId] = {
        id: deptId,
        name: row.department_name,
        orders: []
      };
    }

    branches[branchId].departments[deptId].orders.push({
      id: row.id,
      order_number: row.order_number,
      status: row.status,
      total_amount: row.total_amount,
      user_id: row.user_id,
      user_name: row.user_name,
      item_count: row.item_count
    });
  });

  // แปลงเป็น array
  return Object.values(branches).map(branch => ({
    ...branch,
    departments: Object.values(branch.departments)
  }));
};

// ดึงคำสั่งซื้อทั้งหมดแยกตาม supplier
export const getOrdersBySupplier = async (date) => {
  const [rows] = await pool.query(
    `SELECT s.id as supplier_id, s.name as supplier_name,
            p.id as product_id, p.name as product_name, p.code as product_code,
            u.name as unit_name, u.abbreviation as unit_abbr,
            SUM(oi.quantity) as total_quantity,
            AVG(oi.requested_price) as avg_price,
            GROUP_CONCAT(
              DISTINCT CONCAT(usr.name, ' (', oi.quantity, ' ', u.abbreviation, ')')
              SEPARATOR ', '
            ) as ordered_by
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN products p ON oi.product_id = p.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN units u ON p.unit_id = u.id
     JOIN users usr ON o.user_id = usr.id
     WHERE o.order_date = ? AND o.status = 'submitted'
     GROUP BY s.id, p.id
     ORDER BY s.name, p.name`,
    [date]
  );

  // จัดกลุ่มข้อมูล
  const suppliers = {};

  rows.forEach(row => {
    const supplierId = row.supplier_id || 0;
    const supplierName = row.supplier_name || 'ไม่ระบุซัพพลายเออร์';

    if (!suppliers[supplierId]) {
      suppliers[supplierId] = {
        id: supplierId,
        name: supplierName,
        products: []
      };
    }

    suppliers[supplierId].products.push({
      product_id: row.product_id,
      product_name: row.product_name,
      product_code: row.product_code,
      unit_name: row.unit_name,
      unit_abbr: row.unit_abbr,
      total_quantity: parseFloat(row.total_quantity),
      avg_price: parseFloat(row.avg_price),
      ordered_by: row.ordered_by
    });
  });

  return Object.values(suppliers);
};

// เปิด/ปิดรับคำสั่งซื้อ
export const toggleOrderReceiving = async (date, isOpen, userId) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // ตรวจสอบว่ามีข้อมูลแล้วหรือไม่
    const [existing] = await connection.query(
      'SELECT * FROM order_status_settings WHERE order_date = ?',
      [date]
    );

    if (existing.length > 0) {
      // อัพเดท
      await connection.query(
        `UPDATE order_status_settings
         SET is_open = ?, closed_at = ?, closed_by_user_id = ?
         WHERE order_date = ?`,
        [isOpen, isOpen ? null : new Date(), isOpen ? null : userId, date]
      );
    } else {
      // สร้างใหม่
      await connection.query(
        `INSERT INTO order_status_settings (order_date, is_open, closed_at, closed_by_user_id)
         VALUES (?, ?, ?, ?)`,
        [date, isOpen, isOpen ? null : new Date(), isOpen ? null : userId]
      );
    }

    if (!isOpen) {
      await connection.query(
        `UPDATE orders
         SET status = 'confirmed'
         WHERE order_date = ? AND status = 'submitted'`,
        [date]
      );
    }

    await connection.commit();

    return {
      order_date: date,
      is_open: isOpen
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getOrderItemsByDate = async (date, statuses = []) => {
  await ensurePurchaseWalkOrderTable();
  let statusFilter = '';
  const params = [date, date];

  if (statuses.length > 0) {
    statusFilter = `AND o.status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  } else {
    statusFilter = "AND o.status IN ('submitted', 'confirmed', 'completed')";
  }

  const [rows] = await pool.query(
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.requested_price, oi.actual_price, oi.actual_quantity, oi.is_purchased,
            p.name as product_name, p.code as product_code,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.id as supplier_id, s.name as supplier_name,
            pwo.sort_order as purchase_sort_order,
            lap.last_actual_price,
            lrp.last_requested_price,
            y.yesterday_actual_price,
            o.order_date, o.status,
            usr.id as user_id, usr.name as user_name,
            d.id as department_id, d.name as department_name,
            b.id as branch_id, b.name as branch_name
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN purchase_walk_product_order pwo ON pwo.product_id = p.id
     LEFT JOIN (
       SELECT oi.product_id, MAX(o.order_date) AS last_date
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.actual_price IS NOT NULL
       GROUP BY oi.product_id
     ) last ON last.product_id = p.id
     LEFT JOIN (
       SELECT oi.product_id, o.order_date, MAX(oi.actual_price) AS last_actual_price
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.actual_price IS NOT NULL
       GROUP BY oi.product_id, o.order_date
     ) lap ON lap.product_id = p.id AND lap.order_date = last.last_date
     LEFT JOIN (
       SELECT oi.product_id, MAX(o.order_date) AS last_req_date
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.requested_price IS NOT NULL
       GROUP BY oi.product_id
     ) lreq ON lreq.product_id = p.id
     LEFT JOIN (
       SELECT oi.product_id, o.order_date, MAX(oi.requested_price) AS last_requested_price
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.requested_price IS NOT NULL
       GROUP BY oi.product_id, o.order_date
     ) lrp ON lrp.product_id = p.id AND lrp.order_date = lreq.last_req_date
     LEFT JOIN (
       SELECT oi.product_id, MAX(oi.actual_price) AS yesterday_actual_price
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.order_date = DATE_SUB(?, INTERVAL 1 DAY)
         AND oi.actual_price IS NOT NULL
       GROUP BY oi.product_id
     ) y ON y.product_id = p.id
     WHERE o.order_date = ?
     ${statusFilter}
     ORDER BY s.name, COALESCE(pwo.sort_order, 999999), p.name, usr.name`,
    params
  );

  return rows;
};

export const recordPurchaseByProduct = async (
  date,
  productId,
  actualPrice,
  actualQuantity,
  isPurchased
) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [items] = await connection.query(
      `SELECT oi.id, oi.quantity
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.order_date = ? AND oi.product_id = ?`,
      [date, productId]
    );

    const totalRequested = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const targetQuantity =
      actualQuantity === null || actualQuantity === undefined
        ? totalRequested
        : Number(actualQuantity || 0);

    const ratio = totalRequested > 0 ? targetQuantity / totalRequested : 0;
    const unitPrice =
      actualPrice === null || actualPrice === undefined
        ? null
        : targetQuantity > 0
          ? Number(actualPrice || 0) / targetQuantity
          : null;

    for (const item of items) {
      const perItemActual = totalRequested > 0 ? Number(item.quantity || 0) * ratio : 0;
      await connection.query(
        `UPDATE order_items
         SET actual_price = ?, actual_quantity = ?, is_purchased = ?
         WHERE id = ?`,
        [unitPrice, perItemActual, isPurchased, item.id]
      );
    }

    await connection.commit();

    return {
      product_id: productId,
      order_date: date,
      actual_price: actualPrice,
      actual_quantity: targetQuantity,
      is_purchased: isPurchased
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const resetOrderDay = async (date) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT id FROM order_status_settings WHERE order_date = ?',
      [date]
    );

    if (existing.length > 0) {
      await connection.query(
        `UPDATE order_status_settings
         SET is_open = true, closed_at = NULL, closed_by_user_id = NULL
         WHERE order_date = ?`,
        [date]
      );
    } else {
      await connection.query(
        `INSERT INTO order_status_settings (order_date, is_open)
         VALUES (?, true)`,
        [date]
      );
    }

    await connection.query(
      `UPDATE orders
       SET status = 'submitted', submitted_at = COALESCE(submitted_at, NOW())
       WHERE order_date = ? AND status <> 'cancelled'`,
      [date]
    );

    await connection.query(
      `UPDATE order_items oi
       JOIN orders o ON oi.order_id = o.id
       SET oi.actual_price = NULL, oi.actual_quantity = NULL, oi.is_purchased = false
       WHERE o.order_date = ?`,
      [date]
    );

    await connection.commit();

    return { order_date: date, reset: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const resetOrder = async (orderId) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.query(
      'SELECT id FROM orders WHERE id = ?',
      [orderId]
    );

    if (orders.length === 0) {
      await connection.rollback();
      return null;
    }

    await connection.query(
      `UPDATE orders
       SET status = 'draft', submitted_at = NULL
       WHERE id = ?`,
      [orderId]
    );

    await connection.query(
      `UPDATE order_items
       SET actual_price = NULL, actual_quantity = NULL, is_purchased = false
       WHERE order_id = ?`,
      [orderId]
    );

    await connection.commit();

    return { id: orderId, status: 'draft' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const resetAllOrders = async () => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.query('DELETE FROM orders');

    await connection.commit();

    return { deleted_orders: result.affectedRows };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// บันทึกการซื้อจริง
export const recordPurchase = async (itemId, actualPrice, isPurchased) => {
  await pool.query(
    `UPDATE order_items
     SET actual_price = ?, is_purchased = ?
     WHERE id = ?`,
    [actualPrice, isPurchased, itemId]
  );

  return { id: itemId, actual_price: actualPrice, is_purchased: isPurchased };
};

// เปลี่ยนสถานะคำสั่งซื้อ
export const updateOrderStatus = async (orderId, status) => {
  await pool.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    [status, orderId]
  );

  return { id: orderId, status };
};

export const completeOrdersByDate = async (date) => {
  const [result] = await pool.query(
    `UPDATE orders o
     SET o.status = 'completed'
     WHERE o.order_date = ?
       AND o.status IN ('submitted', 'confirmed')
       AND NOT EXISTS (
         SELECT 1
         FROM order_items oi
         WHERE oi.order_id = o.id
           AND (oi.is_purchased = false OR oi.is_purchased IS NULL)
       )`,
    [date]
  );

  return { updated: result.affectedRows, order_date: date };
};

export const completeOrdersBySupplier = async (date, supplierId) => {
  const [result] = await pool.query(
    `UPDATE orders o
     SET o.status = 'completed'
     WHERE o.order_date = ?
       AND o.status IN ('submitted', 'confirmed')
       AND EXISTS (
         SELECT 1
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = o.id
           AND p.supplier_id = ?
       )
       AND NOT EXISTS (
         SELECT 1
         FROM order_items oi
         WHERE oi.order_id = o.id
           AND (oi.is_purchased = false OR oi.is_purchased IS NULL)
       )`,
    [date, supplierId]
  );

  return { updated: result.affectedRows, order_date: date, supplier_id: supplierId };
};
