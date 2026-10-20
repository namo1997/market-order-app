// Shared InnoDB upsert lock: safe even when this product/location has no balance yet.
export const lockBalanceRow = async (connection, productId, departmentId) => {
  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, 0, NULL)
     ON DUPLICATE KEY UPDATE product_id = product_id`,
    [productId, departmentId]
  );
  const [rows] = await connection.query(
    `SELECT quantity FROM inventory_balance
     WHERE product_id = ? AND department_id = ?
     FOR UPDATE`,
    [productId, departmentId]
  );
  return rows.length > 0 ? parseFloat(rows[0].quantity || 0) : 0;
};
