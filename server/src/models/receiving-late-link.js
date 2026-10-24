// Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": a bill line whose product was not in the catalogue is confirmed as
// receive_unmatched (no stock, no order item). Accounting links the product afterwards; only then is the line
// posted exactly as confirm would have posted it (receipt order RC-<id>, inventory, purchase-walk mirror),
// with the same void snapshot, and the shop's bill wording can be remembered.
import pool from '../config/database.js';
import { canManageReceivingSuppliers } from './receiving-admin-access.js';
import { createDocumentManualOrderItems } from './receiving-manual-order.js';
import { postOrderItemReceipt, learnSupplierProductAliasInJs } from './receiving-documents-settlement.js';
import { receiptNote } from './receiving-void-policy.js';
import { ensureInventoryTables } from './inventory.model.js';
import { ensureOrderReceivingColumns, ensurePurchaseWalkManualMirrorTable } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import { RECEIVING_DOCUMENT_SELECT_COLUMNS, recordAuditLog, resolveActorScope } from './receiving-documents-helpers.js';
import { searchReceivingProducts } from './receiving-supplier-catalog.js';
import { buildSupplierKey, createReceivingError, normalizeMatchText, roundQty2, toFiniteNumberOrNull,
  validatePositiveIntOrNull } from '../services/receiving-ocr.service.js';

const assertAccounting = user => {
  if (!canManageReceivingSuppliers(user)) throw createReceivingError('FORBIDDEN', 'เฉพาะบัญชีหรือผู้ดูแล');
};

// Product search for accounting, scoped to the receipt's branch (accounting users have no branch of their own).
export async function lateLinkProductSearch({ user, documentId, q, db = pool }) {
  assertAccounting(user);
  const docId = validatePositiveIntOrNull(documentId, 'id');
  const [docs] = await db.query('SELECT id, branch_id FROM receiving_documents WHERE id = ? LIMIT 1', [docId]);
  if (!docs.length) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  return searchReceivingProducts({ user, filters: { q }, db, scopeBranchId: Number(docs[0].branch_id) });
}

export async function linkReceivedLineProduct({ user, documentId, lineId, body = {}, db = pool }) {
  assertAccounting(user);
  const docId = validatePositiveIntOrNull(documentId, 'id');
  const id = validatePositiveIntOrNull(lineId, 'line_id');
  const productId = validatePositiveIntOrNull(body.product_id, 'product_id');
  if (!docId || !id || !productId) throw createReceivingError('VALIDATION_FAILED', 'กรุณาเลือกสินค้า');
  if (body.remember_alias !== undefined && typeof body.remember_alias !== 'boolean') throw createReceivingError('VALIDATION_FAILED', 'remember_alias ต้องเป็น true หรือ false');
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();
  await ensurePurchaseWalkManualMirrorTable();
  const scope = await resolveActorScope(db, user);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [docs] = await connection.query(`SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS} FROM receiving_documents rd WHERE rd.id = ? FOR UPDATE`, [docId]);
    const doc = docs[0];
    if (!doc) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
    if (doc.status !== 'confirmed') throw createReceivingError('NOT_DRAFT', 'ผูกสินค้าได้เฉพาะใบรับที่ยืนยันแล้ว');
    const [lines] = await connection.query('SELECT * FROM receiving_document_lines WHERE id = ? AND document_id = ? FOR UPDATE', [id, docId]);
    const line = lines[0];
    if (!line) throw createReceivingError('NOT_FOUND', 'ไม่พบบรรทัดในเอกสารนี้');
    if (line.product_id || line.order_item_id || line.review_decision !== 'receive_unmatched') {
      throw createReceivingError('NOT_DRAFT', 'รายการนี้ผูกสินค้าแล้ว กรุณาโหลดใหม่');
    }
    const [products] = await connection.query(`SELECT p.id, p.name, p.unit_id, u.name AS unit_name
      FROM products p LEFT JOIN units u ON u.id = p.unit_id WHERE p.id = ? AND p.is_active = true LIMIT 1`, [productId]);
    const product = products[0];
    if (!product) throw createReceivingError('VALIDATION_FAILED', 'ไม่พบสินค้าที่เลือก หรือสินค้าถูกปิดใช้');
    await connection.query(`UPDATE receiving_document_lines SET product_id = ?, product_name = ?, unit_id = ?,
      match_source = 'manual', match_confidence = 1.0000 WHERE id = ?`, [product.id, String(product.name).slice(0, 255), product.unit_id ?? null, id]);
    const linked = { ...line, product_id: Number(product.id), product_name: product.name, unit_id: product.unit_id ?? null };
    // Same posting as confirm: a receipt order item for this line, then cumulative quantity, inventory and the void snapshot.
    await createDocumentManualOrderItems(connection, doc, [linked]);
    const quantity = roundQty2(linked.quantity_received) ?? 0;
    await postOrderItemReceipt(connection, { docId, doc, line: linked, orderItemId: Number(linked.order_item_id),
      qtyReceived: quantity, noteText: receiptNote(docId, linked.note), scope });
    const supplierKey = buildSupplierKey({ supplierMasterId: doc.supplier_master_id, productGroupId: doc.product_group_id, supplierNameText: doc.supplier_name_text });
    const billText = String(line.bill_text || '').trim();
    const remembered = Boolean(body.remember_alias) && supplierKey !== 'none' && Boolean(doc.supplier_master_id || doc.product_group_id) && Boolean(normalizeMatchText(billText));
    if (remembered) {
      const unitText = String(line.unit_text || '').trim();
      await learnSupplierProductAliasInJs(connection, { docId, doc, supplierKey, cleanBillText: billText, normalizedBillText: normalizeMatchText(billText),
        cleanUnitText: unitText, normalizedUnitText: normalizeMatchText(unitText), productId: Number(product.id),
        unitId: product.unit_id ? Number(product.unit_id) : null, learnedMultiplier: 1, lastPrice: toFiniteNumberOrNull(line.unit_price), scope });
    }
    await recordAuditLog(connection, { documentId: docId, action: 'link_product', actorUserId: scope.userId || null, actorName: scope.userName,
      details: { line_id: id, bill_text: billText, product_id: Number(product.id), product_name: product.name, quantity, remembered } });
    await connection.commit();
    return { line_id: id, product_id: Number(product.id), product_name: product.name, order_item_id: Number(linked.order_item_id), remembered };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
