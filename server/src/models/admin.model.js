import pool from '../config/database.js';
import { ensurePurchaseWalkOrderTable } from './purchase-walk.model.js';
import { ensurePurchaseOrderTables } from './purchase-order.model.js';
import { ensureOrderItemSourceGroupColumn, ensureOrderTransferColumns } from './order.model.js';
import { ensureWithdrawSourceMappingTable } from './withdraw-source-mapping.model.js';
import {
  ensureProductGroupScopeTable,
  ensureProductGroupWithdrawSourceTable
} from './supplier.model.js';
import { ensureSupplierMasterTable } from './supplier-master.model.js';

let ensureOrderItemPrecisionPromise = null;
let ensureProductLatestPriceOverridePromise = null;

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

const ensureProductLatestPriceOverrideColumn = async () => {
  if (ensureProductLatestPriceOverridePromise) {
    return ensureProductLatestPriceOverridePromise;
  }

  ensureProductLatestPriceOverridePromise = (async () => {
    const [rows] = await pool.query(
      "SHOW COLUMNS FROM products LIKE 'latest_price_override'"
    );
    if (rows.length === 0) {
      await pool.query(
        'ALTER TABLE products ADD COLUMN latest_price_override DECIMAL(12,6) NULL AFTER default_price'
      );
    }
  })().catch((error) => {
    ensureProductLatestPriceOverridePromise = null;
    throw error;
  });

  return ensureProductLatestPriceOverridePromise;
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
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

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
  await ensureOrderItemSourceGroupColumn();
  await ensureProductLatestPriceOverrideColumn();
  await ensurePurchaseWalkOrderTable();
  await ensurePurchaseOrderTables();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();
  await ensureSupplierMasterTable();
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
            oi.quantity, oi.received_quantity, oi.requested_price, oi.actual_price, oi.actual_quantity, oi.is_purchased,
            oi.notes,
            oi.purchase_reason,
            oi.purchase_reason,
            p.name as product_name, p.code as product_code, p.default_price,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.id as supplier_id, s.name as supplier_name,
            sm.id as supplier_master_id,
            sm.name as supplier_master_name,
            sm.has_bank_account as supplier_has_bank_account,
            sm.bank_name as supplier_bank_name,
            sm.account_number as supplier_account_number,
            sm.account_name as supplier_account_name,
            po_latest.last_po_unit_price,
            po_latest.last_po_received_at,
            CASE
              WHEN COALESCE(s.name, '') LIKE '%สโตร์%'
                OR COALESCE(s.code, '') LIKE 'STORE%'
                OR COALESCE(store_dep.name, '') LIKE '%สโตร์%'
                THEN 1
              ELSE 0
            END AS is_store_group,
            pwo.sort_order as purchase_sort_order,
            COALESCE(p.latest_price_override, lap.last_actual_price) AS last_actual_price,
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
     LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
     LEFT JOIN departments store_dep ON store_dep.id = s.linked_department_id
     LEFT JOIN purchase_walk_product_order pwo ON pwo.product_id = p.id
     LEFT JOIN (
       SELECT ranked.product_id, ranked.unit_price AS last_po_unit_price, ranked.received_at AS last_po_received_at
       FROM (
         SELECT
           poi.product_id,
           poi.unit_price,
           por.received_at,
           ROW_NUMBER() OVER (
             PARTITION BY poi.product_id
             ORDER BY por.received_at DESC, por.id DESC
           ) AS rn
         FROM purchase_order_receipts por
         JOIN purchase_order_items poi ON poi.id = por.po_item_id
         WHERE poi.unit_price IS NOT NULL
           AND poi.unit_price > 0
       ) ranked
       WHERE ranked.rn = 1
     ) po_latest ON po_latest.product_id = p.id
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

export const getPriceReportByRange = async ({
  startDate,
  endDate,
  supplierIds = []
}) => {
  await ensurePurchaseWalkOrderTable();

  const normalizedSupplierIds = Array.isArray(supplierIds)
    ? supplierIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];

  const monthRefDateObj = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(monthRefDateObj.getTime())) {
    throw new Error('Invalid endDate for price report');
  }
  monthRefDateObj.setDate(monthRefDateObj.getDate() - 30);
  const monthRefDate = monthRefDateObj.toISOString().split('T')[0];

  let supplierFilter = '';
  const params = [
    endDate,
    monthRefDate,
    monthRefDate,
    monthRefDate,
    endDate,
    startDate,
    endDate
  ];

  if (normalizedSupplierIds.length > 0) {
    supplierFilter = `
      AND EXISTS (
        SELECT 1
        FROM product_group_links pgl_filter
        WHERE pgl_filter.product_id = p.id
          AND pgl_filter.product_group_id IN (${normalizedSupplierIds.map(() => '?').join(', ')})
      )
    `;
    params.push(...normalizedSupplierIds);
  }

  const [rows] = await pool.query(
    `SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.code AS product_code,
        p.default_price,
        u.name AS unit_name,
        u.abbreviation AS unit_abbr,
        p.product_group_id AS supplier_id,
        COALESCE(pgx.product_group_names, pg_primary.name, 'ไม่ระบุกลุ่มสินค้า') AS supplier_name,
        COALESCE(pgx.product_group_ids_csv, CAST(p.product_group_id AS CHAR)) AS supplier_ids_csv,
        p.supplier_master_id,
        sm.name AS supplier_master_name,
        td.price_today,
        td.requested_price_today,
        td.price_today_date,
        mr.month_ref_price,
        mr.month_ref_price_date,
        lp.last_actual_price,
        lp.last_requested_price,
        lp.latest_price_date,
        avg30.avg_actual_price_30d
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN product_groups pg_primary ON pg_primary.id = p.product_group_id
     LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
     LEFT JOIN (
       SELECT
         pgl.product_id,
         GROUP_CONCAT(DISTINCT pgl.product_group_id ORDER BY pgl.product_group_id) AS product_group_ids_csv,
         GROUP_CONCAT(DISTINCT pg.name ORDER BY pg.name SEPARATOR ', ') AS product_group_names
       FROM product_group_links pgl
       JOIN product_groups pg
         ON pg.id = pgl.product_group_id
        AND pg.is_active = true
       GROUP BY pgl.product_id
     ) pgx ON pgx.product_id = p.id
     LEFT JOIN (
       SELECT
         latest_td.product_id,
         latest_td.actual_price AS price_today,
         latest_td.requested_price AS requested_price_today,
         latest_td.order_date AS price_today_date
       FROM (
         SELECT
           oi.product_id,
           oi.actual_price,
           oi.requested_price,
           o.order_date,
           ROW_NUMBER() OVER (
             PARTITION BY oi.product_id
             ORDER BY o.order_date DESC, oi.id DESC
           ) AS rn
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.order_date <= ?
           AND (oi.actual_price IS NOT NULL OR oi.requested_price IS NOT NULL)
       ) latest_td
       WHERE latest_td.rn = 1
     ) td ON td.product_id = p.id
     LEFT JOIN (
       SELECT
         picked.product_id,
         picked.month_ref_price,
         picked.month_ref_price_date
       FROM (
         SELECT
           oi.product_id,
           oi.actual_price AS month_ref_price,
           o.order_date AS month_ref_price_date,
           ROW_NUMBER() OVER (
             PARTITION BY oi.product_id
             ORDER BY
               CASE WHEN o.order_date >= ? THEN 0 ELSE 1 END,
               CASE WHEN o.order_date >= ? THEN o.order_date END ASC,
               CASE WHEN o.order_date < ? THEN o.order_date END DESC,
               oi.id DESC
           ) AS rn
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.actual_price IS NOT NULL
           AND o.order_date <= ?
       ) picked
       WHERE picked.rn = 1
     ) mr ON mr.product_id = p.id
     LEFT JOIN (
       SELECT
         ld.product_id,
         ld.latest_price_date,
         MAX(oi.actual_price) AS last_actual_price,
         MAX(oi.requested_price) AS last_requested_price
       FROM (
         SELECT
           oi.product_id,
           MAX(o.order_date) AS latest_price_date
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE (oi.actual_price IS NOT NULL OR oi.requested_price IS NOT NULL)
         GROUP BY oi.product_id
       ) ld
       JOIN order_items oi ON oi.product_id = ld.product_id
       JOIN orders o
         ON o.id = oi.order_id
        AND o.order_date = ld.latest_price_date
       GROUP BY ld.product_id, ld.latest_price_date
     ) lp ON lp.product_id = p.id
     LEFT JOIN (
       SELECT
         oi.product_id,
         AVG(oi.actual_price) AS avg_actual_price_30d
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.order_date BETWEEN ? AND ?
         AND oi.actual_price IS NOT NULL
       GROUP BY oi.product_id
     ) avg30 ON avg30.product_id = p.id
     WHERE p.is_active = true
     ${supplierFilter}
     ORDER BY p.name`,
    params
  );

  return rows;
};

export const getPurchaseReport = async ({
  startDate,
  endDate,
  groupBy = 'branch',
  statuses = [],
  productGroupId = null
}) => {
  await ensureOrderItemSourceGroupColumn();
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
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND COALESCE(oi.source_product_group_id, p.product_group_id) = ?';
    params.push(Number(productGroupId));
  }

  const [rows] = await pool.query(
    `SELECT ${group.select},
            SUM(CASE WHEN COALESCE(oi.received_quantity, 0) > 0 THEN COALESCE(oi.received_quantity, 0) ELSE 0 END) as total_quantity,
            SUM(
              CASE
                WHEN COALESCE(oi.received_quantity, 0) > 0
                  THEN COALESCE(oi.actual_price, 0) * COALESCE(oi.received_quantity, 0)
                ELSE 0
              END
            ) as total_amount,
            SUM(
              CASE
                WHEN COALESCE(oi.received_quantity, 0) > 0
                  AND (oi.actual_price IS NULL OR oi.actual_price <= 0) THEN 1
                ELSE 0
              END
            ) as missing_actual_count,
            SUM(CASE WHEN COALESCE(oi.received_quantity, 0) > 0 THEN 1 ELSE 0 END) as item_count
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users usr ON o.user_id = usr.id
     JOIN departments d ON usr.department_id = d.id
     JOIN branches b ON d.branch_id = b.id
     LEFT JOIN products p ON oi.product_id = p.id
     LEFT JOIN product_groups s ON s.id = COALESCE(oi.source_product_group_id, p.product_group_id)
     LEFT JOIN units u ON p.unit_id = u.id
     WHERE o.order_date BETWEEN ? AND ?
     ${statusFilter}
     ${productGroupFilter}
     GROUP BY ${group.groupBy}
     HAVING SUM(CASE WHEN COALESCE(oi.received_quantity, 0) > 0 THEN 1 ELSE 0 END) > 0
     ORDER BY total_amount DESC`,
    params
  );

  return rows;
};

export const getPurchaseWalkValueByDay = async ({
  startDate,
  endDate,
  viewMode = 'branch',
  priceMode = 'day',
  useReceived = false,
  branchId = null,
  departmentId = null,
  productGroupId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureProductLatestPriceOverrideColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const normalizedView = ['branch', 'branch_department', 'total'].includes(viewMode)
    ? viewMode
    : 'branch';
  const normalizedPriceMode = ['default', 'latest', 'day'].includes(priceMode)
    ? priceMode
    : 'day';
  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [endDate, startDate, endDate, ...statusList];
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND pg.id = ?';
    params.push(Number(productGroupId));
  }
  let branchFilter = '';
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    branchFilter = 'AND b.id = ?';
    params.push(Number(branchId));
  }
  let departmentFilter = '';
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    departmentFilter = 'AND d.id = ?';
    params.push(Number(departmentId));
  }
  const unitPriceExpr =
    normalizedPriceMode === 'default'
      ? 'COALESCE(p.default_price, 0)'
      : normalizedPriceMode === 'latest'
        ? 'COALESCE(p.latest_price_override, lp.latest_actual_price, p.default_price, 0)'
        : 'COALESCE(oi.actual_price, oi.requested_price, p.default_price, 0)';
  const quantityExpr = useReceived
    ? 'COALESCE(oi.received_quantity, 0)'
    : 'COALESCE(oi.actual_quantity, oi.quantity, 0)';

  const selectByView =
    normalizedView === 'total'
      ? `NULL AS branch_id,
         NULL AS branch_name,
         NULL AS department_id,
         NULL AS department_name,`
      : normalizedView === 'branch_department'
        ? `b.id AS branch_id,
           b.name AS branch_name,
           d.id AS department_id,
           d.name AS department_name,`
        : `b.id AS branch_id,
           b.name AS branch_name,
           NULL AS department_id,
           NULL AS department_name,`;
  const groupByView =
    normalizedView === 'total'
      ? 'o.order_date'
      : normalizedView === 'branch_department'
        ? 'o.order_date, b.id, b.name, d.id, d.name'
        : 'o.order_date, b.id, b.name';
  const orderByView =
    normalizedView === 'total'
      ? 'o.order_date ASC'
      : normalizedView === 'branch_department'
        ? 'o.order_date ASC, b.name ASC, d.name ASC'
        : 'o.order_date ASC, b.name ASC';

  const [rows] = await pool.query(
    `SELECT
       o.order_date AS report_date,
       ${selectByView}
       SUM(${quantityExpr}) AS total_quantity,
       SUM(
         ${unitPriceExpr}
         * ${quantityExpr}
       ) AS total_amount,
       SUM(CASE WHEN ${quantityExpr} > 0 THEN 1 ELSE 0 END) AS item_count
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN (
       SELECT ranked.product_id, ranked.actual_price AS latest_actual_price
       FROM (
         SELECT
           oi_latest.product_id,
           oi_latest.actual_price,
           o_latest.order_date,
           o_latest.id AS order_id,
           oi_latest.id AS order_item_id,
           ROW_NUMBER() OVER (
             PARTITION BY oi_latest.product_id
             ORDER BY o_latest.order_date DESC, o_latest.id DESC, oi_latest.id DESC
           ) AS rn
         FROM order_items oi_latest
         JOIN orders o_latest ON o_latest.id = oi_latest.order_id
         WHERE oi_latest.actual_price IS NOT NULL
           AND oi_latest.actual_price > 0
           AND o_latest.order_date <= ?
       ) ranked
       WHERE ranked.rn = 1
     ) lp ON lp.product_id = oi.product_id
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
     WHERE o.order_date BETWEEN ? AND ?
       AND o.status IN (${statusList.map(() => '?').join(', ')})
       ${productGroupFilter}
       ${branchFilter}
       ${departmentFilter}
     GROUP BY ${groupByView}
     ORDER BY ${orderByView}`,
    params
  );

  return rows;
};

export const getPurchaseWalkValueDetail = async ({
  startDate,
  endDate,
  priceMode = 'day',
  useReceived = false,
  branchId = null,
  departmentId = null,
  productGroupId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureProductLatestPriceOverrideColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const normalizedPriceMode = ['default', 'latest', 'day'].includes(priceMode)
    ? priceMode
    : 'day';
  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [endDate, startDate, endDate, ...statusList];
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND pg.id = ?';
    params.push(Number(productGroupId));
  }

  let branchFilter = '';
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    branchFilter = 'AND b.id = ?';
    params.push(Number(branchId));
  }
  let departmentFilter = '';
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    departmentFilter = 'AND d.id = ?';
    params.push(Number(departmentId));
  }

  const unitPriceExpr =
    normalizedPriceMode === 'default'
      ? 'COALESCE(p.default_price, 0)'
      : normalizedPriceMode === 'latest'
        ? 'COALESCE(p.latest_price_override, lp.latest_actual_price, p.default_price, 0)'
        : 'COALESCE(oi.actual_price, oi.requested_price, p.default_price, 0)';
  const quantityExpr = useReceived
    ? 'COALESCE(oi.received_quantity, 0)'
    : 'COALESCE(oi.actual_quantity, oi.quantity, 0)';

  const [rows] = await pool.query(
    `SELECT
       b.id AS branch_id,
       b.name AS branch_name,
       d.id AS department_id,
       d.name AS department_name,
       p.id AS product_id,
       p.name AS product_name,
       u.abbreviation AS unit_abbr,
       ROUND(SUM(${quantityExpr}), 6) AS total_quantity,
       ROUND(SUM(${unitPriceExpr} * ${quantityExpr}), 6) AS total_amount,
       ROUND(
         CASE
           WHEN SUM(${quantityExpr}) > 0
             THEN
               SUM(${unitPriceExpr} * ${quantityExpr})
               / SUM(${quantityExpr})
           ELSE 0
         END,
         6
       ) AS unit_price
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN (
       SELECT ranked.product_id, ranked.actual_price AS latest_actual_price
       FROM (
         SELECT
           oi_latest.product_id,
           oi_latest.actual_price,
           o_latest.order_date,
           o_latest.id AS order_id,
           oi_latest.id AS order_item_id,
           ROW_NUMBER() OVER (
             PARTITION BY oi_latest.product_id
             ORDER BY o_latest.order_date DESC, o_latest.id DESC, oi_latest.id DESC
           ) AS rn
         FROM order_items oi_latest
         JOIN orders o_latest ON o_latest.id = oi_latest.order_id
         WHERE oi_latest.actual_price IS NOT NULL
           AND oi_latest.actual_price > 0
           AND o_latest.order_date <= ?
       ) ranked
       WHERE ranked.rn = 1
     ) lp ON lp.product_id = oi.product_id
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
     WHERE o.order_date BETWEEN ? AND ?
       AND o.status IN (${statusList.map(() => '?').join(', ')})
       ${productGroupFilter}
       ${branchFilter}
       ${departmentFilter}
     GROUP BY
       b.id, b.name,
       d.id, d.name,
       p.id, p.name, u.abbreviation
     HAVING ROUND(SUM(${quantityExpr}), 6) <> 0
     ORDER BY b.name ASC, d.name ASC, p.name ASC`,
    params
  );

  return rows;
};

export const getPurchaseWalkValueProductDetailByDate = async ({
  startDate,
  endDate,
  productId,
  priceMode = 'day',
  useReceived = false,
  branchId = null,
  departmentId = null,
  productGroupId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureProductLatestPriceOverrideColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const normalizedPriceMode = ['default', 'latest', 'day'].includes(priceMode)
    ? priceMode
    : 'day';
  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const normalizedProductId = Number(productId);
  if (!Number.isFinite(normalizedProductId) || normalizedProductId <= 0) {
    return [];
  }

  const params = [endDate, startDate, endDate, ...statusList, normalizedProductId];
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND pg.id = ?';
    params.push(Number(productGroupId));
  }

  let branchFilter = '';
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    branchFilter = 'AND b.id = ?';
    params.push(Number(branchId));
  }

  let departmentFilter = '';
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    departmentFilter = 'AND d.id = ?';
    params.push(Number(departmentId));
  }

  const unitPriceExpr =
    normalizedPriceMode === 'default'
      ? 'COALESCE(p.default_price, 0)'
      : normalizedPriceMode === 'latest'
        ? 'COALESCE(p.latest_price_override, lp.latest_actual_price, p.default_price, 0)'
        : 'COALESCE(oi.actual_price, oi.requested_price, p.default_price, 0)';
  const quantityExpr = useReceived
    ? 'COALESCE(oi.received_quantity, 0)'
    : 'COALESCE(oi.actual_quantity, oi.quantity, 0)';

  const [rows] = await pool.query(
    `SELECT
       o.order_date AS report_date,
       b.id AS branch_id,
       b.name AS branch_name,
       d.id AS department_id,
       d.name AS department_name,
       p.id AS product_id,
       p.name AS product_name,
       u.abbreviation AS unit_abbr,
       ROUND(SUM(${quantityExpr}), 6) AS total_quantity,
       ROUND(
         CASE
           WHEN SUM(${quantityExpr}) > 0
             THEN
               SUM(${unitPriceExpr} * ${quantityExpr})
               / SUM(${quantityExpr})
           ELSE 0
         END,
         6
       ) AS unit_price,
       ROUND(SUM(${unitPriceExpr} * ${quantityExpr}), 6) AS total_amount
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN (
       SELECT ranked.product_id, ranked.actual_price AS latest_actual_price
       FROM (
         SELECT
           oi_latest.product_id,
           oi_latest.actual_price,
           o_latest.order_date,
           o_latest.id AS order_id,
           oi_latest.id AS order_item_id,
           ROW_NUMBER() OVER (
             PARTITION BY oi_latest.product_id
             ORDER BY o_latest.order_date DESC, o_latest.id DESC, oi_latest.id DESC
           ) AS rn
         FROM order_items oi_latest
         JOIN orders o_latest ON o_latest.id = oi_latest.order_id
         WHERE oi_latest.actual_price IS NOT NULL
           AND oi_latest.actual_price > 0
           AND o_latest.order_date <= ?
       ) ranked
       WHERE ranked.rn = 1
     ) lp ON lp.product_id = oi.product_id
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
     WHERE o.order_date BETWEEN ? AND ?
       AND o.status IN (${statusList.map(() => '?').join(', ')})
       AND p.id = ?
       ${productGroupFilter}
       ${branchFilter}
       ${departmentFilter}
     GROUP BY
       o.order_date,
       b.id, b.name,
       d.id, d.name,
       p.id, p.name, u.abbreviation
     HAVING ROUND(SUM(${quantityExpr}), 6) <> 0
     ORDER BY o.order_date ASC, b.name ASC, d.name ASC`,
    params
  );

  return rows;
};

export const getPurchaseReceiveReconcileReport = async ({
  startDate,
  endDate,
  productGroupId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [startDate, endDate, ...statusList];
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND summary.product_group_id = ?';
    params.push(Number(productGroupId));
  }

  const [rows] = await pool.query(
    `SELECT
       summary.product_group_id,
       summary.product_group_name,
       summary.product_id,
       summary.product_name,
       summary.unit_abbr,
       ROUND(SUM(summary.ordered_quantity), 6) AS ordered_quantity,
       ROUND(SUM(summary.purchased_quantity), 6) AS purchased_quantity,
       ROUND(SUM(summary.received_quantity), 6) AS received_quantity,
       ROUND(SUM(summary.purchased_quantity) - SUM(summary.received_quantity), 6) AS pending_quantity,
       SUM(summary.purchased_line_count) AS purchased_line_count,
       SUM(summary.received_line_count) AS received_line_count
     FROM (
       SELECT
         p.id AS product_id,
         p.name AS product_name,
         u.abbreviation AS unit_abbr,
         pg.id AS product_group_id,
         pg.name AS product_group_name,
         COALESCE(oi.quantity, 0) AS ordered_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             THEN COALESCE(oi.actual_quantity, oi.quantity, 0)
           ELSE 0
         END AS purchased_quantity,
         CASE
           WHEN oi.received_quantity IS NULL THEN 0
           ELSE COALESCE(oi.received_quantity, 0)
         END AS received_quantity,
         CASE WHEN COALESCE(oi.is_purchased, false) = true THEN 1 ELSE 0 END AS purchased_line_count,
         CASE WHEN oi.received_quantity IS NULL THEN 0 ELSE 1 END AS received_line_count
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users usr ON usr.id = o.user_id
       JOIN departments d ON d.id = usr.department_id
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN withdraw_branch_source_mappings wbm
         ON wbm.target_branch_id = b.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id
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
       WHERE DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) BETWEEN ? AND ?
         AND o.status IN (${statusList.map(() => '?').join(', ')})
     ) AS summary
     WHERE summary.product_id IS NOT NULL
       ${productGroupFilter}
     GROUP BY
       summary.product_group_id,
       summary.product_group_name,
       summary.product_id,
       summary.product_name,
       summary.unit_abbr
     HAVING
       ROUND(SUM(summary.purchased_quantity), 6) <> 0
       OR ROUND(SUM(summary.received_quantity), 6) <> 0
     ORDER BY
       summary.product_group_name ASC,
       summary.product_name ASC`,
    params
  );

  return rows;
};

export const getPurchaseOrderStatusLedger = async ({
  date,
  productGroupId = null,
  branchId = null,
  departmentId = null,
  statusFilter = 'all',
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [date, ...statusList];

  const filters = [];
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    filters.push('base.product_group_id = ?');
    params.push(Number(productGroupId));
  }
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    filters.push('base.branch_id = ?');
    params.push(Number(branchId));
  }
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    filters.push('base.department_id = ?');
    params.push(Number(departmentId));
  }
  if (statusFilter && statusFilter !== 'all') {
    filters.push('base.central_status = ?');
    params.push(statusFilter);
  }

  const whereFilters = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT *
     FROM (
       SELECT
         oi.id AS order_item_id,
         o.id AS order_id,
         o.order_number,
         DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) AS order_date_local,
         o.status AS order_status,
         b.id AS branch_id,
         b.name AS branch_name,
         d.id AS department_id,
         d.name AS department_name,
         p.id AS product_id,
         p.code AS product_code,
         p.name AS product_name,
         u.abbreviation AS unit_abbr,
         pg.id AS product_group_id,
         COALESCE(pg.name, 'ไม่ระบุกลุ่มสินค้า') AS product_group_name,
         COALESCE(oi.quantity, 0) AS ordered_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             THEN COALESCE(oi.actual_quantity, oi.quantity, 0)
           ELSE 0
         END AS purchased_quantity,
         oi.actual_quantity,
         oi.actual_price,
         COALESCE(oi.received_quantity, 0) AS received_quantity,
         oi.received_at,
         oi.is_purchased,
         oi.is_received,
         oi.purchase_reason,
         oi.receive_notes,
         oi.notes,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = false THEN 'not_purchased'
           WHEN COALESCE(oi.actual_quantity, oi.quantity, 0) > 0
             AND (oi.actual_price IS NULL OR oi.actual_price <= 0)
             THEN 'missing_price'
           WHEN oi.received_quantity IS NULL THEN 'not_received'
           WHEN COALESCE(oi.received_quantity, 0) < COALESCE(oi.actual_quantity, oi.quantity, 0)
             THEN 'short_received'
           WHEN COALESCE(oi.received_quantity, 0) > COALESCE(oi.actual_quantity, oi.quantity, 0)
             THEN 'over_received'
           ELSE 'complete'
         END AS central_status
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users usr ON usr.id = o.user_id
       JOIN departments d ON d.id = usr.department_id
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN withdraw_branch_source_mappings wbm
         ON wbm.target_branch_id = b.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id
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
       WHERE DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) = ?
         AND o.status IN (${statusList.map(() => '?').join(', ')})
     ) base
     ${whereFilters}
     ORDER BY
       base.product_group_name ASC,
       base.branch_name ASC,
       base.department_name ASC,
       base.product_name ASC,
       base.order_item_id ASC`,
    params
  );

  return rows;
};

export const getPurchaseReceivingSummaryReport = async ({
  startDate,
  endDate,
  viewMode = 'branch_department',
  productGroupId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const normalizedView = ['branch', 'branch_department'].includes(String(viewMode))
    ? String(viewMode)
    : 'branch_department';

  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [startDate, endDate, ...statusList];
  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND base.product_group_id = ?';
    params.push(Number(productGroupId));
  }

  const selectView =
    normalizedView === 'branch'
      ? `base.product_group_id,
         base.product_group_name,
         base.branch_id,
         base.branch_name,
         NULL AS department_id,
         NULL AS department_name`
      : `base.product_group_id,
         base.product_group_name,
         base.branch_id,
         base.branch_name,
         base.department_id,
         base.department_name`;

  const groupByView =
    normalizedView === 'branch'
      ? 'base.product_group_id, base.product_group_name, base.branch_id, base.branch_name'
      : `base.product_group_id,
         base.product_group_name,
         base.branch_id,
         base.branch_name,
         base.department_id,
         base.department_name`;

  const orderByView =
    normalizedView === 'branch'
      ? 'base.product_group_name ASC, base.branch_name ASC'
      : 'base.product_group_name ASC, base.branch_name ASC, base.department_name ASC';

  const [rows] = await pool.query(
    `SELECT
       ${selectView},
       ROUND(SUM(base.ordered_quantity), 6) AS ordered_quantity,
       ROUND(SUM(base.purchased_quantity), 6) AS purchased_quantity,
       ROUND(SUM(base.received_quantity), 6) AS received_quantity,
       ROUND(SUM(base.purchased_quantity) - SUM(base.received_quantity), 6) AS pending_quantity,
       ROUND(SUM(base.purchased_amount), 2) AS purchased_amount,
       ROUND(SUM(base.received_amount), 2) AS received_amount,
       SUM(base.item_count) AS item_count,
       SUM(base.unpurchased_line) AS unpurchased_line_count,
       SUM(base.missing_price_line) AS missing_price_line_count,
       SUM(base.incomplete_line) AS incomplete_line_count
     FROM (
       SELECT
         p.id AS product_id,
         COALESCE(pg.id, 0) AS product_group_id,
         COALESCE(pg.name, 'ไม่ระบุกลุ่มสินค้า') AS product_group_name,
         b.id AS branch_id,
         b.name AS branch_name,
         d.id AS department_id,
         d.name AS department_name,
         COALESCE(oi.quantity, 0) AS ordered_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             THEN COALESCE(oi.actual_quantity, oi.quantity, 0)
           ELSE 0
         END AS purchased_quantity,
         CASE
           WHEN oi.received_quantity IS NULL THEN 0
           ELSE COALESCE(oi.received_quantity, 0)
         END AS received_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             AND oi.actual_price IS NOT NULL
             AND oi.actual_price > 0
             THEN COALESCE(oi.actual_price, 0) * COALESCE(oi.actual_quantity, oi.quantity, 0)
           ELSE 0
         END AS purchased_amount,
         CASE
           WHEN oi.received_quantity IS NOT NULL
             AND oi.actual_price IS NOT NULL
             AND oi.actual_price > 0
             THEN COALESCE(oi.actual_price, 0) * COALESCE(oi.received_quantity, 0)
           ELSE 0
         END AS received_amount,
         1 AS item_count,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = false THEN 1
           ELSE 0
         END AS unpurchased_line,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             AND COALESCE(oi.actual_quantity, oi.quantity, 0) > 0
             AND (oi.actual_price IS NULL OR oi.actual_price <= 0)
             THEN 1
           ELSE 0
         END AS missing_price_line,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = false THEN 1
           WHEN COALESCE(oi.is_purchased, false) = true
             AND COALESCE(oi.actual_quantity, oi.quantity, 0) > 0
             AND (oi.actual_price IS NULL OR oi.actual_price <= 0)
             THEN 1
           ELSE 0
         END AS incomplete_line
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users usr ON usr.id = o.user_id
       JOIN departments d ON d.id = usr.department_id
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN withdraw_branch_source_mappings wbm
         ON wbm.target_branch_id = b.id
       LEFT JOIN products p ON p.id = oi.product_id
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
       WHERE DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) BETWEEN ? AND ?
         AND o.status IN (${statusList.map(() => '?').join(', ')})
     ) base
     WHERE base.product_id IS NOT NULL
       ${productGroupFilter}
     GROUP BY ${groupByView}
     HAVING
       ROUND(SUM(base.ordered_quantity), 6) <> 0
       OR ROUND(SUM(base.purchased_quantity), 6) <> 0
       OR ROUND(SUM(base.received_quantity), 6) <> 0
     ORDER BY ${orderByView}`,
    params
  );

  return rows;
};

export const getPurchaseReceiveReconcileDetail = async ({
  date,
  productId,
  productGroupId,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [date, ...statusList, Number(productId), Number(productGroupId)];

  const [rows] = await pool.query(
    `SELECT
       oi.id AS order_item_id,
       o.order_number,
       DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) AS order_date_local,
       p.id AS product_id,
       p.name AS product_name,
       pg.id AS product_group_id,
       pg.name AS product_group_name,
       b.id AS branch_id,
       b.name AS branch_name,
       d.id AS department_id,
       d.name AS department_name,
       u.abbreviation AS unit_abbr,
       oi.quantity,
       oi.actual_quantity,
       CASE
         WHEN COALESCE(oi.is_purchased, false) = true
           THEN COALESCE(oi.actual_quantity, oi.quantity, 0)
         ELSE 0
       END AS purchased_quantity,
       COALESCE(oi.received_quantity, 0) AS received_quantity,
       oi.is_purchased,
       oi.is_received,
       oi.received_at,
       oi.purchase_reason
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm
       ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
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
     WHERE DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) = ?
       AND o.status IN (${statusList.map(() => '?').join(', ')})
       AND p.id = ?
       AND pg.id = ?
     ORDER BY b.name ASC, d.name ASC, o.order_number ASC, oi.id ASC`,
    params
  );

  return rows;
};

export const getPurchaseReceivingSummaryDetail = async ({
  startDate,
  endDate,
  productGroupId = null,
  branchId = null,
  departmentId = null,
  statuses = []
}) => {
  await ensureOrderItemSourceGroupColumn();
  await ensureWithdrawSourceMappingTable();
  await ensureProductGroupScopeTable();
  await ensureProductGroupWithdrawSourceTable();

  const statusList =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : ['submitted', 'confirmed', 'completed'];

  const params = [startDate, endDate, ...statusList];

  let productGroupFilter = '';
  if (Number.isFinite(Number(productGroupId)) && Number(productGroupId) > 0) {
    productGroupFilter = 'AND base.product_group_id = ?';
    params.push(Number(productGroupId));
  }
  let branchFilter = '';
  if (Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
    branchFilter = 'AND base.branch_id = ?';
    params.push(Number(branchId));
  }
  let departmentFilter = '';
  if (Number.isFinite(Number(departmentId)) && Number(departmentId) > 0) {
    departmentFilter = 'AND base.department_id = ?';
    params.push(Number(departmentId));
  }

  const [rows] = await pool.query(
    `SELECT
       base.product_id,
       base.product_name,
       base.unit_abbr,
       ROUND(SUM(base.ordered_quantity), 6) AS ordered_quantity,
       ROUND(SUM(base.purchased_quantity), 6) AS purchased_quantity,
       ROUND(SUM(base.received_quantity), 6) AS received_quantity,
       MAX(CASE WHEN base.unit_price > 0 THEN base.unit_price ELSE NULL END) AS unit_price,
       ROUND(SUM(base.received_amount), 2) AS received_amount
     FROM (
       SELECT
         p.id AS product_id,
         p.name AS product_name,
         u.abbreviation AS unit_abbr,
         COALESCE(pg.id, 0) AS product_group_id,
         b.id AS branch_id,
         d.id AS department_id,
         COALESCE(oi.quantity, 0) AS ordered_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             THEN COALESCE(oi.actual_quantity, oi.quantity, 0)
           ELSE 0
         END AS purchased_quantity,
         CASE
           WHEN oi.received_quantity IS NULL THEN 0
           ELSE COALESCE(oi.received_quantity, 0)
         END AS received_quantity,
         CASE
           WHEN COALESCE(oi.is_purchased, false) = true
             AND oi.actual_price IS NOT NULL
             AND oi.actual_price > 0
             THEN oi.actual_price
           ELSE NULL
         END AS unit_price,
         CASE
           WHEN oi.received_quantity IS NOT NULL
             AND oi.actual_price IS NOT NULL
             AND oi.actual_price > 0
             THEN oi.actual_price * COALESCE(oi.received_quantity, 0)
           ELSE 0
         END AS received_amount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users usr ON usr.id = o.user_id
       JOIN departments d ON d.id = usr.department_id
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN withdraw_branch_source_mappings wbm
         ON wbm.target_branch_id = b.id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id
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
       WHERE DATE(DATE_ADD(o.order_date, INTERVAL 7 HOUR)) BETWEEN ? AND ?
         AND o.status IN (${statusList.map(() => '?').join(', ')})
     ) base
     WHERE base.product_id IS NOT NULL
       ${productGroupFilter}
       ${branchFilter}
       ${departmentFilter}
     GROUP BY base.product_id, base.product_name, base.unit_abbr
     HAVING
       ROUND(SUM(base.ordered_quantity), 6) <> 0
       OR ROUND(SUM(base.purchased_quantity), 6) <> 0
       OR ROUND(SUM(base.received_quantity), 6) <> 0
     ORDER BY base.product_name ASC`,
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
  purchaseReason,
  scopedOrderItemIds = []
) => {
  await ensureOrderItemPrecision();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const scopedIds = Array.isArray(scopedOrderItemIds)
      ? [...new Set(scopedOrderItemIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))]
      : [];
    const scopedFilter =
      scopedIds.length > 0
        ? ` AND oi.id IN (${scopedIds.map(() => '?').join(', ')})`
        : '';

    const [items] = await connection.query(
      `SELECT oi.id, oi.quantity
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.order_date = ? AND oi.product_id = ?${scopedFilter}`,
      [date, productId, ...scopedIds]
    );

    if (items.length === 0) {
      const error = new Error('No order items found for this scope');
      error.statusCode = 400;
      throw error;
    }

    const totalRequested = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const targetQuantity =
      actualQuantity === null || actualQuantity === undefined
        ? totalRequested
        : Number(actualQuantity || 0);
    if (
      Boolean(isPurchased) &&
      totalRequested <= 0 &&
      (!Number.isFinite(targetQuantity) || targetQuantity <= 0)
    ) {
      const error = new Error('actual_quantity is required and must be greater than 0');
      error.statusCode = 400;
      throw error;
    }
    const hasActualPriceInput =
      actualPrice !== null &&
      actualPrice !== undefined &&
      actualPrice !== '';
    const parsedActualPrice = hasActualPriceInput ? Number(actualPrice) : null;

    const shouldRequirePrice = Boolean(isPurchased) && Number(targetQuantity || 0) > 0;

    if (shouldRequirePrice) {
      if (
        !hasActualPriceInput ||
        parsedActualPrice === null ||
        !Number.isFinite(parsedActualPrice) ||
        parsedActualPrice <= 0
      ) {
        const error = new Error('actual_price is required and must be greater than 0');
        error.statusCode = 400;
        throw error;
      }
    }

    const normalizedActualPrice =
      !hasActualPriceInput
        ? null
        : Number.isFinite(parsedActualPrice) && parsedActualPrice > 0
          ? parsedActualPrice
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
