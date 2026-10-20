import { createPurchaseWalkMirrorForManualReceiving } from './order.model.js';
import { createReceivingError } from '../services/receiving-ocr.service.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';

// The document row is locked by settlement. Its deterministic order number and
// line links are committed together with inventory, so retries cannot add orders.
export async function createDocumentManualOrderItems(connection, doc, lines) {
  const unlinked = lines.filter(line => !line.order_item_id && line.product_id && Number(line.quantity_received) > 0);
  if (!unlinked.length) return;
  // Reports derive location from orders.user_id. An admin receiving for another
  // department must never put these purchases into the admin's own department.
  const [owners] = await connection.query(
    `SELECT id FROM users WHERE department_id = ? AND is_active = true
     ORDER BY (id = ?) DESC, id LIMIT 1 FOR UPDATE`, [doc.department_id, doc.receiver_user_id]);
  if (!owners.length) throw createReceivingError('VALIDATION_FAILED', 'แผนกที่รับต้องมีผู้ใช้เพื่อบันทึกใบสั่ง');
  const ownerId = owners[0].id;
  const orderDate = toBangkokDateKey(doc.delivery_date);
  const [order] = await connection.query(
    `INSERT INTO orders (order_number, user_id, order_date, status, total_amount, submitted_at)
     VALUES (?, ?, ?, 'confirmed', 0, NOW())`, [`RC-${doc.id}`, ownerId, orderDate]);
  for (const line of unlinked) {
    const [products] = await connection.query('SELECT id, product_group_id FROM products WHERE id = ? LIMIT 1', [line.product_id]);
    if (!products.length) throw createReceivingError('VALIDATION_FAILED', 'ไม่พบสินค้าสำหรับบันทึกใบสั่ง');
    const groupId = doc.product_group_id || products[0].product_group_id || null;
    if (!groupId) throw createReceivingError('VALIDATION_FAILED', 'กรุณากำหนดกลุ่มสินค้าเพื่อบันทึกรายการเดินซื้อ');
    const [item] = await connection.query(
      `INSERT INTO order_items (order_id, product_id, source_product_group_id, quantity, requested_price, notes)
       VALUES (?, ?, ?, 0, NULL, ?)`, [order.insertId, line.product_id, groupId, `รับสินค้าตามเอกสาร #${doc.id}`]);
    await connection.query('UPDATE receiving_document_lines SET order_item_id = ? WHERE id = ?', [item.insertId, line.id]);
    line.order_item_id = item.insertId;
    await createPurchaseWalkMirrorForManualReceiving({ connection, orderDate, orderItemId: item.insertId,
      userId: ownerId, productId: line.product_id, productGroupId: groupId,
      receivedQuantity: line.quantity_received,
      location: { branch_id: doc.branch_id, department_id: doc.department_id } });
  }
}

export async function voidDocumentManualOrder(connection, documentId) {
  // Later receipts can reference a generated item. Keep their remaining balance
  // and mirror active even when the originating receipt is voided first.
  const [orders] = await connection.query(`SELECT DISTINCT o.id FROM orders o
    JOIN receiving_documents origin ON o.order_number = CONCAT('RC-', origin.id)
    JOIN order_items oi ON oi.order_id = o.id
    JOIN receiving_document_lines l ON l.order_item_id = oi.id WHERE l.document_id = ?`, [documentId]);
  for (const order of orders) {
    await connection.query(`UPDATE purchase_walk_manual_items m JOIN order_items oi ON oi.id = m.receiving_order_item_id
      SET m.is_active = (COALESCE(oi.received_quantity, 0) > 0),
          m.actual_quantity = COALESCE(oi.received_quantity, 0) WHERE oi.order_id = ?`, [order.id]);
    await connection.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ? AND COALESCE(received_quantity, 0) > 0)`, [order.id, order.id]);
  }
}
