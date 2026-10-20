// Serialize resume-or-create in the same transaction, including different UUIDs
// after process restart. No new schema or connection-scoped advisory lock.
export async function findReceivingDraft(connection, { branchId, departmentId, branchScope, deliveryDate, productGroupId, supplierMasterId, supplierNameText }) {
  if (!productGroupId && !supplierMasterId && !supplierNameText) return null;
  await connection.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId]);
  const supplierSql = productGroupId ? 'product_group_id = ?'
    : supplierMasterId ? 'product_group_id IS NULL AND supplier_master_id = ?'
      : 'product_group_id IS NULL AND supplier_master_id IS NULL AND supplier_name_text = ?';
  const [rows] = await connection.query(`SELECT id, branch_id, department_id, receiving_scope
    FROM receiving_documents WHERE status = 'draft' AND branch_id = ? AND delivery_date = ?
    AND receiving_scope = ? ${branchScope ? '' : 'AND department_id = ?'} AND ${supplierSql}
    ORDER BY id ASC LIMIT 1 FOR UPDATE`, [branchId, deliveryDate, branchScope ? 'branch' : 'department',
    ...(!branchScope ? [departmentId] : []), productGroupId || supplierMasterId || supplierNameText]);
  return rows[0] || null;
}
