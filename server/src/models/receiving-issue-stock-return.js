import * as p from './receiving-issues-policy.js';
import { lockBalanceRow } from './inventory-balance-lock.js';

// Explicit physical return only. A credit note by itself is financial evidence.
// Caller owns the issue lock and transaction; the document lock serializes all
// returns against its lines and against void. Quantity is always in base units.
export async function applyIssueStockReturn(conn, issue, quantity, user) {
  const qty = p.units(quantity, true);
  if (!issue.line_id) p.fail('ต้องระบุบรรทัดรับสินค้าก่อนคืนจากสต๊อก');
  const [docs] = await conn.query('SELECT id,status,branch_id,department_id,receiving_scope FROM receiving_documents WHERE id=? FOR UPDATE', [issue.document_id]);
  const doc = docs[0];
  p.assertAccess(user, doc);
  if (doc.status !== 'confirmed') p.fail('คืนจากสต๊อกได้เฉพาะใบรับที่ยังยืนยันอยู่', 'NOT_DRAFT');
  const [lines] = await conn.query('SELECT * FROM receiving_document_lines WHERE id=? AND document_id=? FOR UPDATE', [issue.line_id, doc.id]);
  const line = lines[0];
  if (!line?.product_id || Number(line.quantity_received) <= 0 || line.review_decision === 'not_received') p.fail('รายการนี้ไม่ได้รับเข้าสต๊อก ห้ามตัดคืนซ้ำ');
  const departmentId = p.idOf(doc.receiving_scope === 'branch' ? line.branch_department_id : doc.department_id);
  const [locations] = await conn.query('SELECT id FROM departments WHERE id=? AND branch_id=?', [departmentId, doc.branch_id]);
  if (!locations.length) p.fail('แผนกรับสินค้าไม่ตรงสาขา', 'NOT_DRAFT');
  const [products] = await conn.query('SELECT id,is_countable FROM products WHERE id=?', [line.product_id]);
  if (!products.length || Number(products[0].is_countable ?? 1) !== 1) p.fail('รายการนี้ไม่ใช่สินค้าที่นับสต๊อก');
  const [previous] = await conn.query('SELECT issue_id,quantity FROM receiving_issue_stock_returns WHERE document_id=? AND line_id=? FOR UPDATE', [doc.id, line.id]);
  const returned = previous.reduce((sum, row) => sum + p.units(row.quantity), 0n);
  if (previous.some(row => Number(row.issue_id) === Number(issue.id)) || returned + qty > p.units(line.quantity_received)) p.fail('จำนวนคืนเกินที่ใบนี้รับเข้าสต๊อกไว้', 'NOT_DRAFT');
  const before = await lockBalanceRow(conn, Number(line.product_id), departmentId);
  // Do not hide a shortage caused by withdrawals/sales/stock checks.
  const beforeCents = p.units(before);
  if (beforeCents < qty) p.fail('สต๊อกคงเหลือไม่พอคืน กรุณากระทบยอดก่อน', 'NOT_DRAFT');
  const after = p.decimal(beforeCents - qty);
  const [tx] = await conn.query(`INSERT INTO inventory_transactions
    (product_id,department_id,transaction_type,quantity,balance_before,balance_after,reference_type,reference_id,notes,created_by)
    VALUES (?,?,'adjustment',?,?,?,'receiving_document_return',?,?,?)`,
  [line.product_id, departmentId, `-${p.decimal(qty)}`, p.decimal(beforeCents), after, String(doc.id),
    `คืนสินค้าตามเอกสาร #${doc.id} · เรื่อง #${issue.id}`, user.id]);
  await conn.query(`INSERT INTO inventory_balance (product_id,department_id,quantity,last_transaction_id) VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),last_transaction_id=VALUES(last_transaction_id),last_updated=CURRENT_TIMESTAMP`,
  [line.product_id, departmentId, after, tx.insertId]);
  await conn.query(`INSERT INTO receiving_issue_stock_returns (issue_id,document_id,line_id,product_id,department_id,quantity,transaction_id)
    VALUES (?,?,?,?,?,?,?)`, [issue.id, doc.id, line.id, line.product_id, departmentId, p.decimal(qty), tx.insertId]);
  return { quantity: p.decimal(qty), product_id: line.product_id, department_id: departmentId, transaction_id: tx.insertId };
}
