// Minimal read-only preflight; mutations retain their existing transactional loaders.
export const requireReceiptState = async (connection, receiptId) => {
  const [rows] = await connection.query(`SELECT dr.id, dr.status, dr.receipt_date, dr.branch_id,
    b.code AS branch_code, b.clickhouse_branch_id
    FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id WHERE dr.id = ?`, [receiptId]);
  if (!rows[0]) throw Object.assign(new Error('Receipt not found.'), { statusCode: 404 });
  return rows[0];
};
