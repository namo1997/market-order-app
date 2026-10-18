import { saveFollowup } from './receiving-followups-store.js';

// Reuse the existing dedupe/lock policy within the caller's settlement transaction.
// Its adapter deliberately owns neither commit nor rollback.
export async function linkReceivingExceptions(connection, { doc, lines, scope, documentId }) {
  const exceptions = lines.filter(line => ['short', 'price_review', 'wrong_product', 'missing_bill'].includes(line.review_decision));
  if (!exceptions.length) return;
  const transactionPool = { getConnection: async () => ({ query: connection.query.bind(connection),
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) };
  await saveFollowup(transactionPool, { group: { branch_id: doc.branch_id, department_id: doc.department_id,
    supplier_key: doc.product_group_id ? `pg:${doc.product_group_id}` : `sm:${doc.supplier_master_id || 0}`,
    supplier_name: doc.supplier_name_text, items: exceptions.map(line => ({ document_id: documentId,
      order_item_id: line.order_item_id, product_name: line.product_name, quantity_received: line.quantity_received,
      quantity_billed: line.quantity_billed, review_decision: line.review_decision, unit_name: line.unit_text })) }, actor: scope,
    note: `ตรวจข้อแตกต่างจากใบรับ #${documentId} (ขาด/ราคา/สินค้า ตามรายการ)`, source: 'manual' });
}
