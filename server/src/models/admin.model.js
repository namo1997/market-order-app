import pool from '../config/database.js';
import { ensurePurchaseWalkOrderTable } from './purchase-walk.model.js';
import { ensureOrderTransferColumns } from './order.model.js';
import { ensureWithdrawSourceMappingTable } from './withdraw-source-mapping.model.js';

let ensureOrderItemPrecisionPromise = null;

const ensureOrderItemPrecision = async () => {
  if (ensureOrderItemPrecisionPromise) {
    return ensureOrderItemPrecisionPromise;
  }

  ensureOrderItemPrecisionPromise = (async () => {
    const [columnRows] = await pool.query(
      `SELECT COLUMN_NAME as column_name, NUMERIC_SCALE as numeric_scale
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'order_items'
         AND COLUMN_NAME IN ('actual_price', 'actual_quantity')`
    );

    const getScale = (columnName) => {
      const row = columnRows.find(
        (entry) => (entry.column_name ?? entry.COLUMN_NAME) === columnName
      );
      return Number(row?.numeric_scale ?? row?.NUMERIC_SCALE ?? 0);
    };

    if (getScale('actual_price') < 6) {
      await pool.query(
        'ALTER TABLE order_items MODIFY COLUMN actual_price DECIMAL(12,6) NULL'
      );
    }

    if (getScale('actual_quantity') < 6) {
      await pool.query(
        'ALTER TABLE order_items MODIFY COLUMN actual_quantity DECIMAL(12,6) NULL'
      );
    }
  })().catch((error) => {
    ensureOrderItemPrecisionPromise = null;
    throw error;
  });

  return ensureOrderItemPrecisionPromise;
};

// ดึงคำสั่งซื้อทั้งหมด (สำหรับ admin)
export const getAllOrders = async (filters = {}) => {
  await ensureOrderTransferColumns();
  let query = `
    SELECT o.id, o.order_number, o.order_date, o.status, o.total_amount,
           o.submitted_at, o.created_at,
           u.id as user_id, u.name as user_name,
           d.id as department_id, d.name as department_name,
           b.id as branch_id, b.name as branch_name,
           o.transferred_at,
           o.transferred_from_department_id,
           o.transferred_from_branch_id,
           dfrom.name as transferred_from_department_name,
           bfrom.name as transferred_from_branch_name,
           (
             SELECT COUNT(*)
             FROM order_items oi
             WHERE oi.order_id = o.id
           ) as item_count
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN departments d ON u.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    LEFT JOIN departments dfrom ON o.transferred_from_department_id = dfrom.id
    LEFT JOIN branches bfrom ON o.transferred_from_branch_id = bfrom.id
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

  const supplierIds = Array.isArray(filters.supplierIds)
    ? filters.supplierIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (supplierIds.length > 0) {
    query += ` AND EXISTS (
      SELECT 1
      FROM order_items soi
      JOIN products sp ON soi.product_id = sp.id
      WHERE soi.order_id = o.id
        AND sp.product_group_id IN (${supplierIds.map(() => '?').join(', ')})
    )`;
    params.push(...supplierIds);
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
  await ensureWithdrawSourceMappingTable();

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
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN product_groups s
       ON s.id = COALESCE(
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
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE o.order_date = ? AND o.status = 'submitted'
     GROUP BY s.id, p.id
     ORDER BY s.name, p.name`,
    [date]
  );

  // จัดกลุ่มข้อมูล
  const suppliers = {};

  rows.forEach(row => {
    const supplierId = row.supplier_id || 0;
    const supplierName = row.supplier_name || 'ไม่ระบุกลุ่มสินค้า';

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

export const getOrderItemsByDate = async (date, statuses = [], supplierIds = []) => {
  await ensurePurchaseWalkOrderTable();
  await ensureWithdrawSourceMappingTable();
  let statusFilter = '';
  const params = [date, date, date, date];
  let supplierFilter = '';

  if (statuses.length > 0) {
    statusFilter = `AND o.status IN (${statuses.map(() => '?').join(', ')})`;
    params.push(...statuses);
  } else {
    statusFilter = "AND o.status IN ('submitted', 'confirmed', 'completed')";
  }

  const normalizedSupplierIds = Array.isArray(supplierIds)
    ? supplierIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (normalizedSupplierIds.length > 0) {
    supplierFilter = `AND s.id IN (${normalizedSupplierIds.map(() => '?').join(', ')})`;
    params.push(...normalizedSupplierIds);
  }

  const [rows] = await pool.query(
    `SELECT oi.id as order_item_id, oi.order_id, oi.product_id,
            oi.quantity, oi.requested_price, oi.actual_price, oi.actual_quantity, oi.is_purchased,
            oi.notes,
            oi.purchase_reason,
            oi.purchase_reason,
            p.name as product_name, p.code as product_code, p.default_price,
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
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN product_groups s
       ON s.id = COALESCE(
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
     LEFT JOIN (
        SELECT oi.product_id, AVG(oi.actual_price) as avg_actual_price_30d
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.order_date BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
          AND oi.actual_price IS NOT NULL
        GROUP BY oi.product_id
      ) avg30 ON avg30.product_id = p.id
     WHERE o.order_date = ?
     ${statusFilter}
     ${supplierFilter}
     ORDER BY s.name, COALESCE(pwo.sort_order, 999999), p.name, usr.name`,
    params
  );

  return rows;
};

export const getPurchaseReport = async ({
  startDate,
  endDate,
  groupBy = 'branch',
  statuses = []
}) => {
  const statusList = statuses.length > 0 ? statuses : ['submitted', 'confirmed', 'completed'];
  const params = [startDate, endDate, ...statusList];

  const groups = {
    branch: {
      select: 'b.id as group_id, b.name as group_name',
      groupBy: 'b.id, b.name'
    },
    department: {
      select: 'd.id as group_id, d.name as group_name, b.id as branch_id, b.name as branch_name',
      groupBy: 'd.id, d.name, b.id, b.name'
    },
    branch_department: {
      select: 'b.id as branch_id, b.name as branch_name, d.id as department_id, d.name as department_name',
      groupBy: 'b.id, b.name, d.id, d.name'
    },
    supplier: {
      select: `COALESCE(s.id, 0) as group_id,
               COALESCE(s.name, 'ไม่ระบุกลุ่มสินค้า') as group_name`,
      groupBy: `COALESCE(s.id, 0), COALESCE(s.name, 'ไม่ระบุกลุ่มสินค้า')`
    },
    product: {
      select: `p.id as group_id,
               p.name as group_name,
               COALESCE(s.name, 'ไม่ระบุกลุ่มสินค้า') as supplier_name,
               u.abbreviation as unit_abbr`,
      groupBy: 'p.id, p.name, s.name, u.abbreviation'
    }
  };

  const group = groups[groupBy] || groups.branch;
  const statusFilter = `AND o.status IN (${statusList.map(() => '?').join(', ')})`;

  const [rows] = await pool.query(
    `SELECT ${group.select},
            SUM(COALESCE(oi.actual_quantity, oi.quantity, 0)) as total_quantity,
            SUM(COALESCE(oi.actual_price, oi.requested_price, 0) * COALESCE(oi.actual_quantity, oi.quantity, 0)) as total_amount,
            SUM(CASE WHEN oi.actual_price IS NULL THEN 1 ELSE 0 END) as missing_actual_count,
            COUNT(*) as item_count
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN product_groups s ON p.product_group_id = s.id
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE o.order_date BETWEEN ? AND ?
     ${statusFilter}
     GROUP BY ${group.groupBy}
     ORDER BY total_amount DESC`,
    params
  );

  return rows;
};

export const recordPurchaseByProduct = async (
  date,
  productId,
  actualPrice,
  actualQuantity,
  isPurchased,
  purchaseReason
) => {
  await ensureOrderItemPrecision();
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
    const normalizedActualPrice =
      actualPrice === null || actualPrice === undefined
        ? null
        : Number.isFinite(Number(actualPrice)) && Number(actualPrice) > 0
          ? Number(actualPrice)
          : null;

    const ratio = totalRequested > 0 ? targetQuantity / totalRequested : 0;
    const unitPrice =
      normalizedActualPrice === null
        ? null
        : targetQuantity > 0
          ? Number(normalizedActualPrice || 0) / targetQuantity
          : null;

    const reasonValue = purchaseReason ?? null;

    for (const item of items) {
      const perItemActual = totalRequested > 0 ? Number(item.quantity || 0) * ratio : 0;
      await connection.query(
        `UPDATE order_items
         SET actual_price = ?, actual_quantity = ?, is_purchased = ?, purchase_reason = ?
         WHERE id = ?`,
        [unitPrice, perItemActual, isPurchased, reasonValue, item.id]
      );
    }

    await connection.commit();

    return {
      product_id: productId,
      order_date: date,
      actual_price: normalizedActualPrice,
      actual_quantity: targetQuantity,
      is_purchased: isPurchased,
      purchase_reason: reasonValue
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
       SET oi.actual_price = NULL,
           oi.actual_quantity = NULL,
           oi.is_purchased = false,
           oi.purchase_reason = NULL
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
       SET actual_price = NULL,
           actual_quantity = NULL,
           is_purchased = false,
           purchase_reason = NULL
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
export const recordPurchase = async (
  itemId,
  actualPrice,
  isPurchased,
  purchaseReason = null
) => {
  await ensureOrderItemPrecision();
  const normalizedActualPrice =
    actualPrice === null || actualPrice === undefined
      ? null
      : Number.isFinite(Number(actualPrice)) && Number(actualPrice) > 0
        ? Number(actualPrice)
        : null;

  await pool.query(
    `UPDATE order_items
     SET actual_price = ?, is_purchased = ?, purchase_reason = ?
     WHERE id = ?`,
    [normalizedActualPrice, isPurchased, purchaseReason, itemId]
  );

  return {
    id: itemId,
    actual_price: normalizedActualPrice,
    is_purchased: isPurchased,
    purchase_reason: purchaseReason
  };
};

// เปลี่ยนสถานะคำสั่งซื้อ
export const updateOrderStatus = async (orderId, status) => {
  await pool.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    [status, orderId]
  );

  return { id: orderId, status };
};

export const transferOrderDepartment = async (orderId, departmentId) => {
  await ensureOrderTransferColumns();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      `SELECT o.id, u.department_id, d.branch_id
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN departments d ON u.department_id = d.id
       WHERE o.id = ?`,
      [orderId]
    );
    if (orderRows.length === 0) {
      throw new Error('Order not found');
    }
    const currentDepartmentId = orderRows[0].department_id;
    const currentBranchId = orderRows[0].branch_id;

    const [deptRows] = await connection.query(
      'SELECT id FROM departments WHERE id = ? AND is_active = true',
      [departmentId]
    );
    if (deptRows.length === 0) {
      throw new Error('Department not found');
    }

    const [userRows] = await connection.query(
      'SELECT id FROM users WHERE department_id = ? AND is_active = true ORDER BY id LIMIT 1',
      [departmentId]
    );
    if (userRows.length === 0) {
      throw new Error('No active user in target department');
    }

    const nextUserId = userRows[0].id;
    await connection.query(
      `UPDATE orders
       SET user_id = ?,
           transferred_at = NOW(),
           transferred_from_department_id = ?,
           transferred_from_branch_id = ?
       WHERE id = ?`,
      [nextUserId, currentDepartmentId, currentBranchId, orderId]
    );

    await connection.commit();

    return { id: orderId, user_id: nextUserId, department_id: departmentId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
           AND p.product_group_id = ?
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

const toSafeLimit = (value, fallback = 100, max = 500) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
};

export const getDepartmentStockCheckActivitySummary = async () => {
  const [rows] = await pool.query(
    `SELECT
        d.id AS department_id,
        d.name AS department_name,
        b.id AS branch_id,
        b.name AS branch_name,
        MAX(sc.updated_at) AS latest_activity_at,
        MAX(sc.check_date) AS latest_check_date,
        COUNT(sc.id) AS total_records
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN stock_checks sc ON sc.department_id = d.id
     WHERE d.is_active = true
       AND COALESCE(d.stock_check_required, true) = true
     GROUP BY d.id, d.name, b.id, b.name
     ORDER BY b.name, d.name`
  );

  return rows;
};

export const getDepartmentStockCheckActivityDetail = async (departmentId, limit = 120) => {
  const safeLimit = toSafeLimit(limit, 120, 500);
  const [rows] = await pool.query(
    `SELECT
        sc.id,
        sc.department_id,
        sc.check_date,
        sc.stock_quantity,
        sc.updated_at AS activity_at,
        p.id AS product_id,
        p.name AS product_name,
        p.code AS product_code,
        u.abbreviation AS unit_abbr,
        usr.name AS actor_name
     FROM stock_checks sc
     LEFT JOIN products p ON sc.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN users usr ON sc.checked_by_user_id = usr.id
     WHERE sc.department_id = ?
     ORDER BY sc.updated_at DESC, sc.id DESC
     LIMIT ${safeLimit}`,
    [departmentId]
  );
  return rows;
};

export const getDepartmentReceivingActivitySummary = async () => {
  const [rows] = await pool.query(
    `SELECT
        d.id AS department_id,
        d.name AS department_name,
        b.id AS branch_id,
        b.name AS branch_name,
        MAX(oi.received_at) AS latest_activity_at,
        COUNT(oi.id) AS total_records
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN users u ON u.department_id = d.id
     LEFT JOIN orders o ON o.user_id = u.id
     LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.received_at IS NOT NULL
     WHERE d.is_active = true
     GROUP BY d.id, d.name, b.id, b.name
     ORDER BY b.name, d.name`
  );

  return rows;
};

export const getDepartmentReceivingActivityDetail = async (departmentId, limit = 120) => {
  const safeLimit = toSafeLimit(limit, 120, 500);
  const [rows] = await pool.query(
    `SELECT
        oi.id,
        oi.received_at AS activity_at,
        oi.receive_notes,
        oi.quantity AS ordered_quantity,
        oi.received_quantity,
        p.id AS product_id,
        p.name AS product_name,
        p.code AS product_code,
        u.abbreviation AS unit_abbr,
        o.id AS order_id,
        o.order_number,
        ru.name AS actor_name
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users ou ON o.user_id = ou.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN users ru ON oi.received_by_user_id = ru.id
     WHERE ou.department_id = ?
       AND oi.received_at IS NOT NULL
     ORDER BY oi.received_at DESC, oi.id DESC
     LIMIT ${safeLimit}`,
    [departmentId]
  );

  return rows;
};

export const getDepartmentProductionTransformActivitySummary = async () => {
  const [rows] = await pool.query(
    `SELECT
        d.id AS department_id,
        d.name AS department_name,
        b.id AS branch_id,
        b.name AS branch_name,
        MAX(it.created_at) AS latest_activity_at,
        COUNT(it.id) AS total_records
     FROM departments d
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN inventory_transactions it
       ON it.department_id = d.id
      AND it.reference_type = 'production_transform'
      AND it.quantity > 0
     WHERE d.is_active = true
       AND COALESCE(d.stock_check_required, true) = true
       AND COALESCE(d.is_production, false) = true
     GROUP BY d.id, d.name, b.id, b.name
     ORDER BY b.name, d.name`
  );

  return rows;
};

export const getDepartmentProductionTransformActivityDetail = async (departmentId, limit = 120) => {
  const safeLimit = toSafeLimit(limit, 120, 500);
  const [rows] = await pool.query(
    `SELECT
        it.id,
        it.reference_id,
        it.created_at AS activity_at,
        it.quantity,
        it.notes,
        p.id AS product_id,
        p.name AS product_name,
        p.code AS product_code,
        u.abbreviation AS unit_abbr,
        usr.name AS actor_name
     FROM inventory_transactions it
     JOIN products p ON it.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN users usr ON it.created_by = usr.id
     WHERE it.department_id = ?
       AND it.reference_type = 'production_transform'
       AND it.quantity > 0
     ORDER BY it.created_at DESC, it.id DESC
     LIMIT ${safeLimit}`,
    [departmentId]
  );

  return rows;
};
