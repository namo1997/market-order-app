import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';
import { ensureSupplierMasterTable } from './supplier-master.model.js';
import { ensureSupplierColumns, ensureSupplierScopeTable } from './supplier.model.js';

let ensuredProductGroupColumns = false;

const normalizeCountableValue = (value, fallback = 1) => {
  if (value === undefined || value === null || value === '') {
    return Number(fallback) === 0 ? 0 : 1;
  }
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return Number(fallback) === 0 ? 0 : 1;
};

const ensureProductGroupColumns = async () => {
  if (ensuredProductGroupColumns) return;

  const [groupColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'product_group_id'"
  );
  if (groupColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN product_group_id INT NULL AFTER supplier_id'
    );
    await pool.query(
      'UPDATE products SET product_group_id = supplier_id WHERE product_group_id IS NULL'
    );
  }

  const [supplierColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'supplier_id'"
  );
  if (supplierColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN supplier_id INT NULL AFTER product_group_id'
    );
    await pool.query(
      'UPDATE products SET supplier_id = product_group_id WHERE supplier_id IS NULL'
    );
  }

  const [groupIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_product_group'"
  );
  if (groupIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_product_group (product_group_id)'
    );
  }

  await pool.query(`
    UPDATE products
    SET product_group_id = COALESCE(product_group_id, supplier_id),
        supplier_id = COALESCE(supplier_id, product_group_id)
  `);

  const [countableColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'is_countable'"
  );
  if (countableColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN is_countable BOOLEAN NOT NULL DEFAULT true AFTER default_price'
    );
  }

  await ensureSupplierMasterTable();

  const [supplierMasterColumn] = await pool.query(
    "SHOW COLUMNS FROM products LIKE 'supplier_master_id'"
  );
  if (supplierMasterColumn.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD COLUMN supplier_master_id INT NULL AFTER product_group_id'
    );
  }

  const [supplierMasterIndex] = await pool.query(
    "SHOW INDEX FROM products WHERE Key_name = 'idx_supplier_master_id'"
  );
  if (supplierMasterIndex.length === 0) {
    await pool.query(
      'ALTER TABLE products ADD INDEX idx_supplier_master_id (supplier_master_id)'
    );
  }

  ensuredProductGroupColumns = true;
};

// ดึงรายการสินค้าทั้งหมด
export const getAllProducts = async (filters = {}) => {
  await ensureProductGroupColumns();
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  let query = `
    SELECT p.id, p.name, p.code, p.default_price, p.is_countable, p.is_active, p.unit_id,
           u.name as unit_name, u.abbreviation as unit_abbr,
           COALESCE(p.supplier_id, p.product_group_id) as supplier_id,
           s.name as supplier_name,
           COALESCE(p.product_group_id, p.supplier_id) as product_group_id,
           s.name as product_group_name,
           p.supplier_master_id,
           sm.name as supplier_master_name,
           sm.code as supplier_master_code,
           lap.last_actual_price
    FROM products p
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON COALESCE(p.product_group_id, p.supplier_id) = s.id
    LEFT JOIN supplier_masters sm ON p.supplier_master_id = sm.id
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
    WHERE p.is_active = true
  `;
  const params = [];

  // Filter by supplier
  if (filters.supplierId) {
    query += ' AND COALESCE(p.product_group_id, p.supplier_id) = ?';
    params.push(filters.supplierId);
  }

  // Search by name
  if (filters.search) {
    query += ' AND p.name LIKE ?';
    params.push(`%${filters.search}%`);
  }

  const branchId = Number(filters.branchId);
  const departmentId = Number(filters.departmentId);
  if (Number.isFinite(branchId) && Number.isFinite(departmentId)) {
    query += `
      AND (
        s.id IS NULL
        OR (
          NOT EXISTS (
            SELECT 1
            FROM product_group_scopes pgs_any
            WHERE pgs_any.supplier_id = s.id
          )
        )
        OR EXISTS (
          SELECT 1
          FROM product_group_scopes pgs
          WHERE pgs.supplier_id = s.id
            AND pgs.branch_id = ?
            AND pgs.department_id = ?
        )
      )
    `;
    params.push(branchId, departmentId);
  }

  query += ' ORDER BY p.name';

  const [rows] = await pool.query(query, params);
  return rows;
};

// ดึงข้อมูลสินค้าตาม ID
export const getProductById = async (productId) => {
  await ensureProductGroupColumns();
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.code, p.default_price, p.is_countable, p.unit_id, p.supplier_id, p.is_active,
            COALESCE(p.product_group_id, p.supplier_id) as product_group_id,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.name as supplier_name,
            s.name as product_group_name,
            p.supplier_master_id,
            sm.name as supplier_master_name,
            sm.code as supplier_master_code,
            lap.last_actual_price
     FROM products p
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON COALESCE(p.product_group_id, p.supplier_id) = s.id
     LEFT JOIN supplier_masters sm ON p.supplier_master_id = sm.id
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
     WHERE p.id = ?`,
    [productId]
  );
  return rows[0] || null;
};

// สร้างสินค้าใหม่
export const createProduct = async (data) => {
  await ensureProductGroupColumns();
  const {
    name,
    code,
    default_price,
    is_countable,
    unit_id,
    supplier_id: supplierIdFromLegacy,
    product_group_id: productGroupId,
    supplier_master_id: supplierMasterId
  } = data;
  const supplier_id =
    supplierIdFromLegacy !== undefined ? supplierIdFromLegacy : productGroupId;
  const product_group_id = supplier_id;
  const parsedSupplierMasterId = Number(supplierMasterId);
  const normalizedSupplierMasterId =
    supplierMasterId === null || supplierMasterId === undefined || supplierMasterId === ''
      ? null
      : Number.isFinite(parsedSupplierMasterId)
        ? parsedSupplierMasterId
        : null;
  const normalizedDefaultPrice =
    default_price === undefined || default_price === null || default_price === ''
      ? 0
      : default_price;
  const normalizedIsCountable = normalizeCountableValue(is_countable, 1);
  const normalizedCode = String(code || '').trim();
  const finalCode = normalizedCode || await generateNextCode({
    table: 'products',
    prefix: 'PRD',
    codeField: 'code'
  });
  const [result] = await pool.query(
    `INSERT INTO products 
     (name, code, default_price, is_countable, unit_id, product_group_id, supplier_id, supplier_master_id, is_active) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)`,
    [
      name,
      finalCode,
      normalizedDefaultPrice,
      normalizedIsCountable,
      unit_id,
      product_group_id,
      supplier_id,
      normalizedSupplierMasterId
    ]
  );
  return {
    id: result.insertId,
    ...data,
    code: finalCode,
    supplier_id,
    product_group_id,
    supplier_master_id: normalizedSupplierMasterId
  };
};

// อัพเดทสินค้า
export const updateProduct = async (id, data) => {
  await ensureProductGroupColumns();
  const {
    name,
    code,
    default_price,
    is_countable,
    unit_id,
    supplier_id: supplierIdFromLegacy,
    product_group_id: productGroupId,
    supplier_master_id: supplierMasterId
  } = data;
  const [rows] = await pool.query(
    `SELECT name, code, default_price, is_countable, unit_id, product_group_id, supplier_id, supplier_master_id
     FROM products
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  const current = rows[0];
  if (!current) {
    throw new Error('Product not found');
  }

  const groupInputProvided = supplierIdFromLegacy !== undefined || productGroupId !== undefined;
  const groupInputValue = supplierIdFromLegacy !== undefined ? supplierIdFromLegacy : productGroupId;
  const supplier_id = groupInputProvided
    ? groupInputValue
    : (current.product_group_id ?? current.supplier_id);
  const product_group_id = supplier_id;

  const parsedSupplierMasterId = Number(supplierMasterId);
  const normalizedSupplierMasterId =
    supplierMasterId === undefined
      ? current.supplier_master_id
      : supplierMasterId === null || supplierMasterId === ''
        ? null
        : Number.isFinite(parsedSupplierMasterId)
          ? parsedSupplierMasterId
          : current.supplier_master_id;

  const normalizedName = name !== undefined ? name : current.name;
  const normalizedDefaultPrice =
    default_price !== undefined ? default_price : current.default_price;
  const normalizedUnitId = unit_id !== undefined ? unit_id : current.unit_id;
  const normalizedIsCountable = normalizeCountableValue(is_countable, current.is_countable);
  let finalCode = String(code ?? '').trim();
  if (!finalCode) {
    finalCode = current.code;
  }

  await pool.query(
    `UPDATE products 
     SET name = ?, code = ?, default_price = ?, is_countable = ?, unit_id = ?, product_group_id = ?, supplier_id = ?, supplier_master_id = ? 
     WHERE id = ?`,
    [
      normalizedName,
      finalCode,
      normalizedDefaultPrice,
      normalizedIsCountable,
      normalizedUnitId,
      product_group_id,
      supplier_id,
      normalizedSupplierMasterId,
      id
    ]
  );
  return {
    id,
    ...data,
    code: finalCode,
    supplier_id,
    product_group_id,
    supplier_master_id: normalizedSupplierMasterId
  };
};

// ลบสินค้า (Soft delete)
export const deleteProduct = async (id) => {
  await pool.query(
    'UPDATE products SET is_active = false WHERE id = ?',
    [id]
  );
  return { id };
};

// ดึงรายการ suppliers ทั้งหมด
export const getAllSuppliers = async () => {
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.code, s.contact_person, s.phone,
            s.linked_branch_id, s.linked_department_id,
            b.name AS linked_branch_name, d.name AS linked_department_name,
            s.id as product_group_id, s.name as product_group_name
     FROM suppliers s
     LEFT JOIN branches b ON s.linked_branch_id = b.id
     LEFT JOIN departments d ON s.linked_department_id = d.id
     WHERE s.is_active = true
     ORDER BY s.name`
  );
  return rows;
};

export const getAllSuppliersByScope = async ({ branchId, departmentId }) => {
  await ensureSupplierColumns();
  await ensureSupplierScopeTable();
  const normalizedBranchId = Number(branchId);
  const normalizedDepartmentId = Number(departmentId);

  if (!Number.isFinite(normalizedBranchId) || !Number.isFinite(normalizedDepartmentId)) {
    return getAllSuppliers();
  }

  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.code, s.contact_person, s.phone,
            s.linked_branch_id, s.linked_department_id,
            b.name AS linked_branch_name, d.name AS linked_department_name,
            s.id as product_group_id, s.name as product_group_name
     FROM suppliers s
     LEFT JOIN branches b ON s.linked_branch_id = b.id
     LEFT JOIN departments d ON s.linked_department_id = d.id
     WHERE s.is_active = true
       AND (
         (
           NOT EXISTS (
             SELECT 1
             FROM product_group_scopes pgs_any
             WHERE pgs_any.supplier_id = s.id
           )
         )
         OR EXISTS (
           SELECT 1
           FROM product_group_scopes pgs
           WHERE pgs.supplier_id = s.id
             AND pgs.branch_id = ?
             AND pgs.department_id = ?
         )
       )
     ORDER BY s.name`,
    [
      normalizedBranchId,
      normalizedDepartmentId
    ]
  );
  return rows;
};

export const getAllSupplierMasters = async () => {
  await ensureSupplierMasterTable();
  const [rows] = await pool.query(
    `SELECT id, name, code, contact_person, phone
     FROM supplier_masters
     WHERE is_active = true
     ORDER BY name`
  );
  return rows;
};

// ดึงรายการ units ทั้งหมด
export const getAllUnits = async () => {
  const [rows] = await pool.query(
    'SELECT id, name, abbreviation FROM units WHERE is_active = true ORDER BY name'
  );
  return rows;
};
