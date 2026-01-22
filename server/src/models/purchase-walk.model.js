import pool from '../config/database.js';

export const ensurePurchaseWalkOrderTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS purchase_walk_product_order (
      product_id INT PRIMARY KEY,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getPurchaseWalkProducts = async (supplierId) => {
  await ensurePurchaseWalkOrderTable();
  let query = `
    SELECT p.id as product_id, p.name as product_name, p.code,
           p.supplier_id, s.name as supplier_name,
           pwo.sort_order
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN purchase_walk_product_order pwo ON pwo.product_id = p.id
    WHERE p.is_active = true
  `;
  const params = [];

  if (supplierId) {
    query += ' AND p.supplier_id = ?';
    params.push(supplierId);
  }

  query += ' ORDER BY s.name, COALESCE(pwo.sort_order, 999999), p.name';

  const [rows] = await pool.query(query, params);
  return rows;
};

export const updatePurchaseWalkOrder = async (supplierId, productIds) => {
  await ensurePurchaseWalkOrderTable();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (let i = 0; i < productIds.length; i += 1) {
      const productId = productIds[i];
      await connection.query(
        `INSERT INTO purchase_walk_product_order (product_id, sort_order)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
        [productId, i + 1]
      );
    }

    await connection.commit();
    return {
      supplier_id: supplierId,
      count: productIds.length
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
