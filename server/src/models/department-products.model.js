import pool from '../config/database.js';

const ensureDepartmentProductsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS department_products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      department_id INT NOT NULL,
      product_id INT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY unique_department_product (department_id, product_id),
      INDEX idx_department (department_id),
      INDEX idx_product (product_id),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getProductIdsByDepartmentId = async (departmentId) => {
  await ensureDepartmentProductsTable();

  const [rows] = await pool.query(
    `SELECT product_id
     FROM department_products
     WHERE department_id = ? AND is_active = true
     ORDER BY product_id`,
    [departmentId]
  );
  return rows;
};

export const getDepartmentProducts = async (departmentId) => {
  await ensureDepartmentProductsTable();

  const [rows] = await pool.query(
    `SELECT
      dp.id,
      dp.department_id,
      dp.product_id,
      p.name AS product_name,
      p.code AS product_code,
      p.default_price,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr,
      s.id AS supplier_id,
      s.name AS supplier_name
     FROM department_products dp
     JOIN products p ON dp.product_id = p.id
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     WHERE dp.department_id = ?
       AND dp.is_active = true
       AND p.is_active = true
     ORDER BY p.name`,
    [departmentId]
  );

  return rows;
};

export const getAvailableProducts = async (departmentId) => {
  await ensureDepartmentProductsTable();

  const [rows] = await pool.query(
    `SELECT
      p.id,
      p.name,
      p.code,
      p.default_price,
      u.name AS unit_name,
      u.abbreviation AS unit_abbr,
      s.id AS supplier_id,
      s.name AS supplier_name
     FROM products p
     LEFT JOIN units u ON p.unit_id = u.id
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     WHERE p.is_active = true
       AND p.id NOT IN (
         SELECT product_id
         FROM department_products
         WHERE department_id = ? AND is_active = true
       )
     ORDER BY p.name`,
    [departmentId]
  );

  return rows;
};

export const addDepartmentProduct = async (departmentId, productId) => {
  await ensureDepartmentProductsTable();

  const [existing] = await pool.query(
    'SELECT id, is_active FROM department_products WHERE department_id = ? AND product_id = ?',
    [departmentId, productId]
  );

  if (existing.length > 0) {
    if (!existing[0].is_active) {
      await pool.query(
        'UPDATE department_products SET is_active = true WHERE id = ?',
        [existing[0].id]
      );
    }
    return { id: existing[0].id, department_id: departmentId, product_id: productId };
  }

  const [result] = await pool.query(
    'INSERT INTO department_products (department_id, product_id, is_active) VALUES (?, ?, true)',
    [departmentId, productId]
  );

  return { id: result.insertId, department_id: departmentId, product_id: productId };
};

export const removeDepartmentProduct = async (id) => {
  await ensureDepartmentProductsTable();

  const [result] = await pool.query(
    'UPDATE department_products SET is_active = false WHERE id = ?',
    [id]
  );

  if (result.affectedRows === 0) {
    return null;
  }

  return { id };
};

export const copyFromStockTemplate = async (departmentId) => {
  await ensureDepartmentProductsTable();

  const [[countRow]] = await pool.query(
    'SELECT COUNT(*) AS total FROM stock_templates WHERE department_id = ?',
    [departmentId]
  );
  const total = Number(countRow?.total || 0);

  if (total === 0) {
    return { inserted: 0, total };
  }

  const [result] = await pool.query(
    `INSERT IGNORE INTO department_products (department_id, product_id, is_active)
     SELECT st.department_id, st.product_id, true
     FROM stock_templates st
     JOIN products p ON st.product_id = p.id
     WHERE st.department_id = ? AND p.is_active = true`,
    [departmentId]
  );

  return { inserted: result.affectedRows || 0, total };
};
