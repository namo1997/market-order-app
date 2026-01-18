import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

// ดึงรายการสินค้าทั้งหมด
export const getAllProducts = async (filters = {}) => {
  let query = `
    SELECT p.id, p.name, p.code, p.default_price, p.is_active, p.unit_id,
           u.name as unit_name, u.abbreviation as unit_abbr,
           s.id as supplier_id, s.name as supplier_name,
           lap.last_actual_price
    FROM products p
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
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
    query += ' AND p.supplier_id = ?';
    params.push(filters.supplierId);
  }

  // Search by name
  if (filters.search) {
    query += ' AND p.name LIKE ?';
    params.push(`%${filters.search}%`);
  }

  query += ' ORDER BY p.name';

  const [rows] = await pool.query(query, params);
  return rows;
};

// ดึงข้อมูลสินค้าตาม ID
export const getProductById = async (productId) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.code, p.default_price, p.unit_id, p.supplier_id, p.is_active,
            u.name as unit_name, u.abbreviation as unit_abbr,
            s.name as supplier_name,
            lap.last_actual_price
     FROM products p
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
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
  const { name, code, default_price, unit_id, supplier_id } = data;
  const normalizedCode = String(code || '').trim();
  const finalCode = normalizedCode || await generateNextCode({
    table: 'products',
    prefix: 'PRD',
    codeField: 'code'
  });
  const [result] = await pool.query(
    `INSERT INTO products 
     (name, code, default_price, unit_id, supplier_id, is_active) 
     VALUES (?, ?, ?, ?, ?, true)`,
    [name, finalCode, default_price, unit_id, supplier_id]
  );
  return { id: result.insertId, ...data, code: finalCode };
};

// อัพเดทสินค้า
export const updateProduct = async (id, data) => {
  const { name, code, default_price, unit_id, supplier_id } = data;
  let finalCode = String(code ?? '').trim();

  if (!finalCode) {
    const [rows] = await pool.query(
      'SELECT code FROM products WHERE id = ?',
      [id]
    );
    finalCode = rows?.[0]?.code;
  }
  await pool.query(
    `UPDATE products 
     SET name = ?, code = ?, default_price = ?, unit_id = ?, supplier_id = ? 
     WHERE id = ?`,
    [name, finalCode, default_price, unit_id, supplier_id, id]
  );
  return { id, ...data, code: finalCode };
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
  const [rows] = await pool.query(
    'SELECT id, name, code, contact_person, phone FROM suppliers WHERE is_active = true ORDER BY name'
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
