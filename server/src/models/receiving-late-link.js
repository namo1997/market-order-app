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
  validatePositiveIntOrNull, validateQuantityOrNull } from '../services/receiving-ocr.service.js';

// Bug hunt 2026-10-24: staff count an unmatched line in the bill's unit (1 ลัง). When the linked product counts
// in another unit (กก.), accounting must say how much that was in the product's unit, or stock is posted wrong.
const unitKey = value => {
  const unit = String(value || '').trim().toLowerCase().replace(/[.\s]/g, '');
  return ['กก', 'กิโลกรัม', 'kg', 'kgs', 'kilogram'].includes(unit) ? 'kg' : unit;
};
export const sameLinkUnit = (line, product) => {
  if (line.unit_id && product.unit_id && Number(line.unit_id) === Number(product.unit_id)) return true;
  const billUnit = unitKey(line.unit_text || line.unit);
  return Boolean(billUnit) && billUnit === unitKey(product.unit_name);
};

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
    const billUnit = String(line.unit_text || line.unit || '').trim();
    const counted = roundQty2(line.quantity_received) ?? 0;
    let quantity = counted;
    let converted = null;
    if (!sameLinkUnit(line, product)) {
      const productUnit = product.unit_name || 'หน่วยของสินค้า';
      if (body.quantity_received === undefined || body.quantity_received === null || body.quantity_received === '') {
        throw createReceivingError('VALIDATION_FAILED', `บิลเป็น ${billUnit || 'หน่วยอื่น'} แต่สินค้านี้นับเป็น ${productUnit} · กรุณาใส่จำนวนที่รับเป็น ${productUnit}`);
      }
      quantity = validateQuantityOrNull(body.quantity_received, 'quantity_received', { allowNull: false });
      if (!(quantity > 0)) throw createReceivingError('VALIDATION_FAILED', `จำนวนที่รับเป็น ${productUnit} ต้องมากกว่า 0`);
      const factor = counted > 0 ? quantity / counted : 1;
      const billed = toFiniteNumberOrNull(line.quantity_billed);
      const amount = toFiniteNumberOrNull(line.amount);
      const price = toFiniteNumberOrNull(line.unit_price);
      converted = { from: { quantity: counted, unit: billUnit || null }, to: { quantity, unit: product.unit_name || null }, factor };
      // The whole line now reads in the product's unit (count, received, bill and price); the bill amount is
      // unchanged and the original count stays in the link audit.
      const counts = toFiniteNumberOrNull(line.counted_quantity);
      line.counted_quantity = counts === null ? null : roundQty2(counts * factor);
      line.quantity_billed = billed === null ? null : roundQty2(billed * factor);
      line.unit_price = price === null ? null : price / factor;
      line.base_unit_price = amount !== null && line.quantity_billed > 0 ? amount / line.quantity_billed : line.unit_price;
      converted.from.counted = counts;
      await connection.query(`UPDATE receiving_document_lines SET counted_quantity = ?, quantity_received = ?, quantity_billed = ?, unit_multiplier = 1,
        unit = ?, unit_text = ?, unit_price = ?, base_unit_price = ? WHERE id = ? AND document_id = ?`,
        [line.counted_quantity, quantity, line.quantity_billed, product.unit_name || null, product.unit_name || null, line.unit_price, line.base_unit_price, id, docId]);
    }
    await connection.query(`UPDATE receiving_document_lines SET product_id = ?, product_name = ?, unit_id = ?,
      match_source = 'manual', match_confidence = 1.0000 WHERE id = ?`, [product.id, String(product.name).slice(0, 255), product.unit_id ?? null, id]);
    const linked = { ...line, product_id: Number(product.id), product_name: product.name, unit_id: product.unit_id ?? null,
      quantity_received: quantity, ...(converted ? { unit: product.unit_name || null, unit_text: product.unit_name || null } : {}) };
    // Same posting as confirm: a receipt order item for this line, then cumulative quantity, inventory and the void snapshot.
    await createDocumentManualOrderItems(connection, doc, [linked]);
    await postOrderItemReceipt(connection, { docId, doc, line: linked, orderItemId: Number(linked.order_item_id),
      qtyReceived: quantity, noteText: receiptNote(docId, linked.note), scope });
    const supplierKey = buildSupplierKey({ supplierMasterId: doc.supplier_master_id, productGroupId: doc.product_group_id, supplierNameText: doc.supplier_name_text });
    const billText = String(line.bill_text || '').trim();
    const remembered = Boolean(body.remember_alias) && supplierKey !== 'none' && Boolean(doc.supplier_master_id || doc.product_group_id) && Boolean(normalizeMatchText(billText));
    if (remembered) {
      // The shop's wording is remembered with the bill's own unit; a whole-number pack size (1 ลัง = 10 ถุง) is
      // learned like confirm does, a weighed conversion (1 ลัง = 10.35 กก.) is not.
      const factor = converted?.factor ?? 1;
      const learnedMultiplier = factor >= 2 && Math.abs(factor - Math.round(factor)) < 0.0001 ? Math.round(factor) : 1;
      await learnSupplierProductAliasInJs(connection, { docId, doc, supplierKey, cleanBillText: billText, normalizedBillText: normalizeMatchText(billText),
        cleanUnitText: billUnit, normalizedUnitText: normalizeMatchText(billUnit), productId: Number(product.id),
        unitId: product.unit_id ? Number(product.unit_id) : null, learnedMultiplier,
        lastPrice: converted ? line.base_unit_price : toFiniteNumberOrNull(line.unit_price), scope });
    }
    await recordAuditLog(connection, { documentId: docId, action: 'link_product', actorUserId: scope.userId || null, actorName: scope.userName,
      details: { line_id: id, bill_text: billText, product_id: Number(product.id), product_name: product.name, quantity, remembered,
        ...(converted ? { converted } : {}) } });
    await connection.commit();
    return { line_id: id, product_id: Number(product.id), product_name: product.name, order_item_id: Number(linked.order_item_id), remembered,
      quantity, unit: converted ? product.unit_name || null : billUnit || null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
