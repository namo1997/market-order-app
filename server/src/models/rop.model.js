import pool from '../config/database.js';
import { getProductIdsByDepartmentId } from './department-products.model.js';

const DEFAULT_LEAD_TIME_DAYS = 1;
const DEFAULT_SAFETY_STOCK_DAYS = 0.8;
const ALLOWED_WINDOWS = new Set([7, 14, 28]);

let ropTablesEnsured = false;

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toNumberOrDefault = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getBangkokTodayDate = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
};

const addDays = (dateStr, days) => {
  const base = new Date(`${dateStr}T00:00:00+07:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const resolveWindowDays = (value) => {
  const parsed = Number(value);
  if (ALLOWED_WINDOWS.has(parsed)) return parsed;
  return 7;
};

export const ensureRopTables = async () => {
  if (ropTablesEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_rop_settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      product_id INT NOT NULL,
      department_id INT NOT NULL,
      lead_time_days DECIMAL(10,2) NOT NULL DEFAULT 1.00,
      safety_stock_days DECIMAL(10,2) NOT NULL DEFAULT 0.80,
      min_quantity DECIMAL(14,3) NULL,
      max_quantity DECIMAL(14,3) NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_rop_product_department (product_id, department_id),
      INDEX idx_rop_department (department_id),
      INDEX idx_rop_product (product_id),
      CONSTRAINT fk_rop_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_rop_department
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      CONSTRAINT fk_rop_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_rop_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_rop_setting_audits (
      id INT PRIMARY KEY AUTO_INCREMENT,
      rop_setting_id INT NULL,
      product_id INT NOT NULL,
      department_id INT NOT NULL,
      action ENUM('create', 'update') NOT NULL,
      before_snapshot LONGTEXT NULL,
      after_snapshot LONGTEXT NOT NULL,
      changed_by INT NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rop_audit_department (department_id),
      INDEX idx_rop_audit_product (product_id),
      INDEX idx_rop_audit_changed_at (changed_at),
      CONSTRAINT fk_rop_audit_setting
        FOREIGN KEY (rop_setting_id) REFERENCES inventory_rop_settings(id) ON DELETE SET NULL,
      CONSTRAINT fk_rop_audit_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_rop_audit_department
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      CONSTRAINT fk_rop_audit_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  ropTablesEnsured = true;
};

export const getProductionDepartments = async () => {
  await ensureRopTables();
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.branch_id, b.name AS branch_name
     FROM departments d
     JOIN branches b ON b.id = d.branch_id
     WHERE d.is_active = true
       AND COALESCE(d.is_production, false) = true
     ORDER BY b.name, d.name`
  );
  return rows;
};

const assertProductionDepartment = async (departmentId) => {
  const [rows] = await pool.query(
    `SELECT id, name
     FROM departments
     WHERE id = ?
       AND is_active = true
       AND COALESCE(is_production, false) = true`,
    [departmentId]
  );
  if (rows.length === 0) return null;
  return rows[0];
};

export const getRopOverview = async ({ departmentId, windowDays }) => {
  await ensureRopTables();

  const departments = await getProductionDepartments();
  if (departments.length === 0) {
    return {
      departments: [],
      department_id: null,
      window_days: resolveWindowDays(windowDays),
      defaults: {
        lead_time_days: DEFAULT_LEAD_TIME_DAYS,
        safety_stock_days: DEFAULT_SAFETY_STOCK_DAYS
      },
      items: []
    };
  }

  const targetDepartmentId = Number(departmentId) || Number(departments[0].id);
  const department = await assertProductionDepartment(targetDepartmentId);
  if (!department) {
    throw new Error('DEPARTMENT_NOT_PRODUCTION');
  }

  const productRows = await getProductIdsByDepartmentId(targetDepartmentId);
  const productIds = productRows.map((row) => Number(row.product_id)).filter(Number.isFinite);

  if (productIds.length === 0) {
    return {
      departments,
      department_id: targetDepartmentId,
      window_days: resolveWindowDays(windowDays),
      defaults: {
        lead_time_days: DEFAULT_LEAD_TIME_DAYS,
        safety_stock_days: DEFAULT_SAFETY_STOCK_DAYS
      },
      items: []
    };
  }

  const resolvedWindowDays = resolveWindowDays(windowDays);
  const endDate = getBangkokTodayDate();
  const startDate = addDays(endDate, -(resolvedWindowDays - 1));

  const [products] = await pool.query(
    `SELECT p.id AS product_id, p.name AS product_name, p.code AS product_code,
            u.name AS unit_name, u.abbreviation AS unit_abbreviation
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.is_active = true
       AND p.id IN (?)
     ORDER BY p.name`,
    [productIds]
  );

  const [balanceRows] = await pool.query(
    `SELECT product_id, quantity
     FROM inventory_balance
     WHERE department_id = ?
       AND product_id IN (?)`,
    [targetDepartmentId, productIds]
  );
  const balanceMap = new Map(
    balanceRows.map((row) => [Number(row.product_id), toNumberOrDefault(row.quantity, 0)])
  );

  const [usageRows] = await pool.query(
    `SELECT
       product_id,
       COALESCE(SUM(ABS(quantity)), 0) AS total_used
     FROM inventory_transactions
     WHERE department_id = ?
       AND transaction_type = 'transfer_out'
       AND product_id IN (?)
       AND DATE(DATE_ADD(created_at, INTERVAL 7 HOUR)) BETWEEN ? AND ?
     GROUP BY product_id`,
    [targetDepartmentId, productIds, startDate, endDate]
  );
  const usageMap = new Map(
    usageRows.map((row) => [Number(row.product_id), toNumberOrDefault(row.total_used, 0)])
  );

  const [settingRows] = await pool.query(
    `SELECT
       rs.id,
       rs.product_id,
       rs.lead_time_days,
       rs.safety_stock_days,
       rs.min_quantity,
       rs.max_quantity,
       rs.updated_at,
       rs.updated_by,
       u.name AS updated_by_name
     FROM inventory_rop_settings rs
     LEFT JOIN users u ON u.id = rs.updated_by
     WHERE rs.department_id = ?
       AND rs.product_id IN (?)`,
    [targetDepartmentId, productIds]
  );
  const settingMap = new Map(settingRows.map((row) => [Number(row.product_id), row]));

  const items = products.map((product) => {
    const productId = Number(product.product_id);
    const totalUsed = toNumberOrDefault(usageMap.get(productId), 0);
    const avgDailyUsage = totalUsed / resolvedWindowDays;
    const balanceQty = toNumberOrDefault(balanceMap.get(productId), 0);
    const setting = settingMap.get(productId);
    const leadTimeDays = toNumberOrDefault(setting?.lead_time_days, DEFAULT_LEAD_TIME_DAYS);
    const safetyStockDays = toNumberOrDefault(setting?.safety_stock_days, DEFAULT_SAFETY_STOCK_DAYS);
    const minQty = toNumberOrNull(setting?.min_quantity);
    const maxQty = toNumberOrNull(setting?.max_quantity);

    const ropRaw = avgDailyUsage > 0
      ? (avgDailyUsage * leadTimeDays) + (avgDailyUsage * safetyStockDays)
      : 0;
    const ropQty = Math.ceil(ropRaw);
    const requiresMinMax = avgDailyUsage === 0 && (minQty === null || maxQty === null);

    return {
      product_id: productId,
      product_name: product.product_name,
      product_code: product.product_code,
      unit_name: product.unit_name,
      unit_abbreviation: product.unit_abbreviation,
      current_quantity: balanceQty,
      total_used: totalUsed,
      avg_daily_usage: avgDailyUsage,
      lead_time_days: leadTimeDays,
      safety_stock_days: safetyStockDays,
      min_quantity: minQty,
      max_quantity: maxQty,
      rop_quantity: ropQty,
      requires_min_max: requiresMinMax,
      should_produce: balanceQty <= ropQty,
      setting_id: setting?.id || null,
      updated_at: setting?.updated_at || null,
      updated_by_name: setting?.updated_by_name || null,
      window_days: resolvedWindowDays
    };
  });

  return {
    departments,
    department_id: targetDepartmentId,
    window_days: resolvedWindowDays,
    range: {
      start_date: startDate,
      end_date: endDate
    },
    defaults: {
      lead_time_days: DEFAULT_LEAD_TIME_DAYS,
      safety_stock_days: DEFAULT_SAFETY_STOCK_DAYS
    },
    items
  };
};

export const upsertRopSetting = async ({
  departmentId,
  productId,
  leadTimeDays,
  safetyStockDays,
  minQuantity,
  maxQuantity,
  userId
}) => {
  await ensureRopTables();

  const targetDepartmentId = Number(departmentId);
  const targetProductId = Number(productId);
  if (!Number.isFinite(targetDepartmentId) || !Number.isFinite(targetProductId)) {
    throw new Error('INVALID_INPUT');
  }

  const department = await assertProductionDepartment(targetDepartmentId);
  if (!department) throw new Error('DEPARTMENT_NOT_PRODUCTION');

  const productRows = await getProductIdsByDepartmentId(targetDepartmentId);
  const allowedProductIds = new Set(
    productRows.map((row) => Number(row.product_id)).filter(Number.isFinite)
  );
  if (!allowedProductIds.has(targetProductId)) {
    throw new Error('PRODUCT_NOT_IN_DEPARTMENT');
  }

  const lead = toNumberOrDefault(leadTimeDays, DEFAULT_LEAD_TIME_DAYS);
  const safety = toNumberOrDefault(safetyStockDays, DEFAULT_SAFETY_STOCK_DAYS);
  const minQty = toNumberOrNull(minQuantity);
  const maxQty = toNumberOrNull(maxQuantity);

  if (lead < 0 || safety < 0) {
    throw new Error('INVALID_SETTING');
  }
  if (minQty !== null && maxQty !== null && minQty > maxQty) {
    throw new Error('INVALID_MIN_MAX');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `SELECT *
       FROM inventory_rop_settings
       WHERE department_id = ? AND product_id = ?
       LIMIT 1
       FOR UPDATE`,
      [targetDepartmentId, targetProductId]
    );

    const snapshotAfter = {
      lead_time_days: lead,
      safety_stock_days: safety,
      min_quantity: minQty,
      max_quantity: maxQty
    };

    let settingId;
    let action = 'update';
    let snapshotBefore = null;

    if (existingRows.length === 0) {
      const [insertResult] = await connection.query(
        `INSERT INTO inventory_rop_settings
          (product_id, department_id, lead_time_days, safety_stock_days, min_quantity, max_quantity, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [targetProductId, targetDepartmentId, lead, safety, minQty, maxQty, userId || null, userId || null]
      );
      settingId = insertResult.insertId;
      action = 'create';
    } else {
      const existing = existingRows[0];
      settingId = existing.id;
      snapshotBefore = {
        lead_time_days: toNumberOrDefault(existing.lead_time_days, DEFAULT_LEAD_TIME_DAYS),
        safety_stock_days: toNumberOrDefault(existing.safety_stock_days, DEFAULT_SAFETY_STOCK_DAYS),
        min_quantity: toNumberOrNull(existing.min_quantity),
        max_quantity: toNumberOrNull(existing.max_quantity)
      };

      await connection.query(
        `UPDATE inventory_rop_settings
         SET lead_time_days = ?, safety_stock_days = ?, min_quantity = ?, max_quantity = ?, updated_by = ?
         WHERE id = ?`,
        [lead, safety, minQty, maxQty, userId || null, settingId]
      );
    }

    await connection.query(
      `INSERT INTO inventory_rop_setting_audits
        (rop_setting_id, product_id, department_id, action, before_snapshot, after_snapshot, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        settingId,
        targetProductId,
        targetDepartmentId,
        action,
        snapshotBefore ? JSON.stringify(snapshotBefore) : null,
        JSON.stringify(snapshotAfter),
        userId || null
      ]
    );

    await connection.commit();

    return {
      id: settingId,
      action,
      ...snapshotAfter
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

