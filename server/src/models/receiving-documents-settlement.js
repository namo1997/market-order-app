import { mayVoid, receiptNote, appendReceiptNote, removeReceiptNote, hasAutoReceiveNote, stripAutoReceiveNote, pickAutoReceiveNote } from './receiving-void-policy.js';
import { createDocumentManualOrderItems, voidDocumentManualOrder } from './receiving-manual-order.js';
import { documentNotificationPayload } from '../services/receiving-notify-policy.js';
import { enqueueReceivingNotification, dispatchReceivingNotification } from '../services/receiving-notification-outbox.js';
import { linkReceivingExceptions } from './receiving-documents-exceptions.js';
import { ensureQueueTables } from './receiving-queue-schema.js';
import { confirmIssueCandidates } from './receiving-issues-policy.js';
import { afterReceivingConfirm } from '../services/receiving-issues-followup.js';
import pool from '../config/database.js';
import { getBangkokDateKey, toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureInventoryTables, lockBalanceRow } from './inventory.model.js';
import {
  AUTO_RECEIVE_NOTE,
  ensureOrderReceivingColumns,
  ensurePurchaseWalkManualMirrorTable,
  updateOrderItemReceivingWithInventory
} from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  ALIAS_OVERRIDE_MIN_DISTINCT_USERS,
  learnSupplierProductAliasInJs
} from './receiving-documents-alias.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertBlindCountComplete,
  assertDocumentAccess,
  loadDocumentBundleById,
  parseJsonArraySafe,
  recordAuditLog,
  resolveActorScope,
  validateScopedOrderItemsForDocument
} from './receiving-documents-helpers.js';
import {
  buildSupplierKey,
  computeBaseUnitPrice,
  createReceivingError,
  normalizeMatchText,
  parseImageDataUrl,
  roundQty2,
  toFiniteNumberOrNull,
  validatePositiveIntOrNull
} from '../services/receiving-ocr.service.js';

export { ALIAS_OVERRIDE_MIN_DISTINCT_USERS, learnSupplierProductAliasInJs };

// Lock shared order rows before document lines. Successor snapshot rebasing then cannot
// deadlock with another settlement that holds its lines while waiting for the same order.
const lockLinkedOrderItems = async (connection, docId) => {
  const [rows] = await connection.query(
    `SELECT order_item_id FROM receiving_document_lines
     WHERE document_id = ? AND order_item_id IS NOT NULL`, [docId]);
  const ids = [...new Set(rows.map((row) => Number(row.order_item_id)))].sort((a, b) => a - b);
  for (const id of ids) {
    await connection.query('SELECT id FROM order_items WHERE id = ? FOR UPDATE', [id]);
  }
};

// 7. POST /:id/signatures
export const saveDocumentSignature = async ({
  user,
  documentId,
  role,
  imageDataUrl,
  name = undefined
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const cleanRole = String(role || '').trim();
  if (!['receiver', 'courier'].includes(cleanRole)) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'role สำหรับลายเซ็นต้องเป็น receiver หรือ courier เท่านั้น'
    );
  }

  const parsedSig = parseImageDataUrl(imageDataUrl, {
    allowedMimes: ['image/png']
  });

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT id, status, branch_id, department_id, receiving_scope, counted_complete_at
       FROM receiving_documents
       WHERE id = ?
       FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);
    assertBlindCountComplete(doc);

    if (doc.status !== 'draft') {
      throw createReceivingError(
        'NOT_DRAFT',
        'ไม่สามารถแก้ไขลายเซ็นในเอกสารที่ยืนยันหรือยกเลิกแล้ว'
      );
    }

    const [reviewLines] = await connection.query('SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC FOR UPDATE', [docId]);
    if (!reviewLines.length || reviewLines.some(line => !line.review_decision)) throw createReceivingError('NOT_DRAFT', 'ต้องตัดสินใจครบก่อนเซ็นรับ');

    const cleanName =
      name !== undefined && name !== null && String(name).trim() !== ''
        ? String(name).trim().slice(0, 255)
        : null;

    if (cleanRole === 'receiver') {
      await connection.query(
        `UPDATE receiving_documents
         SET receiver_signature = ?,
             receiver_signature_mime = ?,
             receiver_name = COALESCE(?, receiver_name)
         WHERE id = ?`,
        [parsedSig.buffer, parsedSig.mimeType, cleanName, docId]
      );
    } else {
      await connection.query(
        `UPDATE receiving_documents
         SET courier_signature = ?,
             courier_signature_mime = ?,
             courier_name = COALESCE(?, courier_name)
         WHERE id = ?`,
        [parsedSig.buffer, parsedSig.mimeType, cleanName, docId]
      );
    }

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'sign',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: { role: cleanRole, name: cleanName }
    });

    await connection.commit();
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 8. POST /:id/confirm (แก้ R2-2, R2-6, R2-7)
export const confirmReceivingDocument = async ({
  user,
  documentId,
  unmatchedOk = false
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureQueueTables(pool);
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();
  await ensurePurchaseWalkManualMirrorTable();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  let released = false;
  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
       FROM receiving_documents rd
       WHERE rd.id = ?
       FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);
    assertBlindCountComplete(doc);

    if (doc.status !== 'draft') {
      throw createReceivingError(
        'NOT_DRAFT',
        'สามารถยืนยันได้เฉพาะเอกสารสถานะร่าง (draft) เท่านั้น'
      );
    }

    if (!doc.has_receiver_signature) {
      throw createReceivingError(
        'SIGNATURE_REQUIRED',
        'กรุณาลงลายมือชื่อผู้รับสินค้าก่อนยืนยันการรับของ'
      );
    }

    await lockLinkedOrderItems(connection, docId);
    const [lines] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC
       FOR UPDATE`,
      [docId]
    );

    if ((lines || []).some(line => line.match_source === 'ai')) {
      throw createReceivingError('VALIDATION_FAILED', 'กรุณายืนยันสินค้าที่ AI เสนอก่อนรับเข้าคลัง');
    }
    if ((lines || []).some(line => !line.review_decision)) throw createReceivingError('NOT_DRAFT', 'ต้องตัดสินใจทุกรายการก่อนยืนยัน');
    const positiveLines = (lines || []).filter(
      (line) => (roundQty2(line.quantity_received) ?? 0) > 0
    );
    if (positiveLines.length === 0) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        'ต้องมีรายการที่จำนวนรับจริงมากกว่า 0 อย่างน้อย 1 รายการ'
      );
    }

    const allowUnmatched = doc.kind === 'manual_receipt' && Boolean(unmatchedOk);
    if (!allowUnmatched) {
      const hasUnmatched = (lines || []).some((line) => !line.product_id);
      if (hasUnmatched) {
        throw createReceivingError(
          'VALIDATION_FAILED',
          'ทุกรายการต้องจับคู่สินค้าในระบบให้ครบก่อนยืนยันรับของ'
        );
      }
    }

    const scopedItems = await validateScopedOrderItemsForDocument(connection, {
      branchId: Number(doc.branch_id),
      departmentId: doc.receiving_scope === 'branch' ? null : Number(doc.department_id),
      lines: lines || []
    });

    if (doc.receiving_scope === 'branch') {
      for (const line of lines) {
        if (!line.order_item_id || !line.branch_department_id || Number(scopedItems.get(Number(line.order_item_id))?.department_id) !== Number(line.branch_department_id)) {
          throw createReceivingError('VALIDATION_FAILED', 'รายการสาขาต้องผูกใบสั่งและแผนกเดิม');
        }
      }
    }
    const learnedBranchProducts = new Set();
    const supplierKey = buildSupplierKey({
      supplierMasterId: doc.supplier_master_id,
      productGroupId: doc.product_group_id,
      supplierNameText: doc.supplier_name_text
    });

    const notificationPayload = documentNotificationPayload(doc, lines, scopedItems);
    await createDocumentManualOrderItems(connection, doc, lines);
    const currentWarnings = parseJsonArraySafe(doc.warnings_json);
    let warningsChanged = false;

    for (const line of lines || []) {
      const qtyReceived = roundQty2(line.quantity_received) ?? 0;
      const qtyBilled = toFiniteNumberOrNull(line.quantity_billed);
      const unitPrice = toFiniteNumberOrNull(line.unit_price);
      const unitMultiplier = toFiniteNumberOrNull(line.unit_multiplier) ?? 1;
      const effectiveActualPrice = computeBaseUnitPrice({
        unitPrice: toFiniteNumberOrNull(line.base_unit_price) ?? unitPrice,
        amount: line.amount,
        quantityBilled: qtyBilled,
        quantityReceived: qtyReceived,
        unitMultiplier: line.base_unit_price != null ? 1 : unitMultiplier
      });
      const productId = line.product_id ? Number(line.product_id) : null;
      const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;
      const noteText = receiptNote(docId, line.note);

      // R2-6: ข้ามบรรทัดที่ผูก order_item แต่มีจำนวนรับ = 0 เพื่อไม่ให้ไปล้างยอดรับของเดิมเป็น 0 และบันทึก warning
      if (orderItemId && qtyReceived <= 0) {
        const lineNo = Number(line.line_no) || null;
        if (!currentWarnings.some((w) => w.code === 'QTY_SHORT' && w.line_no === lineNo)) {
          currentWarnings.push({
            code: 'QTY_SHORT',
            message: `บรรทัดที่ ${lineNo || '-'}: จำนวนรับจริงเป็น 0 จึงข้ามการอัปเดตใบสั่งซื้อ`,
            line_no: lineNo
          });
          warningsChanged = true;
        }
        continue;
      }

      if (orderItemId && qtyReceived > 0) {
        const [oiRows] = await connection.query(
          `SELECT id, quantity, received_quantity, actual_price, is_received,
                  received_by_user_id, received_at, receive_notes
           FROM order_items
           WHERE id = ?
           FOR UPDATE`,
          [orderItemId]
        );

        if (Array.isArray(oiRows) && oiRows.length > 0) {
          const prevOi = oiRows[0];
          const prevReceivedQty = roundQty2(prevOi.received_quantity) ?? 0;
          // The nightly auto-receive job already booked the ordered quantity: staff's count REPLACES it
          // (only when that is the sole source of the received state), otherwise accumulate as before.
          let replacedAutoQty = null;
          if (hasAutoReceiveNote(prevOi.receive_notes, AUTO_RECEIVE_NOTE) && Boolean(prevOi.is_received)) {
            const [otherConfirmed] = await connection.query(
              `SELECT 1 AS found
               FROM receiving_document_lines rdl
               JOIN receiving_documents rd ON rd.id = rdl.document_id
               WHERE rdl.order_item_id = ? AND rdl.document_id <> ? AND rd.status = 'confirmed'
               LIMIT 1`,
              [orderItemId, docId]
            );
            if (!otherConfirmed?.length) replacedAutoQty = prevReceivedQty;
          }
          // R2-6: บวกสะสมยอดรับ (prev + qtyReceived) เพื่อรองรับหลายบิลต่อใบสั่งเดียวกัน
          const nextCumulativeReceivedQty = replacedAutoQty !== null
            ? qtyReceived : roundQty2(prevReceivedQty + qtyReceived);
          const nextActualPrice =
            effectiveActualPrice !== null ? effectiveActualPrice : (prevOi.actual_price ?? null);

          // R2-7: เก็บ prev_order_quantity และ prev_order_receive_notes ไว้คืนค่าตอน void
          await connection.query(
            `UPDATE receiving_document_lines
             SET prev_order_quantity = ?,
                 prev_order_received_quantity = ?,
                 prev_order_actual_price = ?,
                 prev_order_is_received = ?,
                 prev_order_received_by_user_id = ?,
                 prev_order_received_at = ?,
                 prev_order_receive_notes = ?,
                 applied_order_received_quantity = ?,
                 applied_order_actual_price = ?,
                 replaced_auto_receive_quantity = ?
             WHERE id = ?`,
            [
              prevOi.quantity ?? null,
              prevOi.received_quantity ?? null,
              prevOi.actual_price ?? null,
              prevOi.is_received !== null && prevOi.is_received !== undefined
                ? Boolean(prevOi.is_received)
                : false,
              prevOi.received_by_user_id ?? null,
              prevOi.received_at ?? null,
              prevOi.receive_notes ?? null,
              nextCumulativeReceivedQty,
              nextActualPrice,
              replacedAutoQty,
              line.id
            ]
          );

          await updateOrderItemReceivingWithInventory({
            connection,
            orderItemId,
            receivedQuantity: nextCumulativeReceivedQty,
            userId: scope.userId || doc.receiver_user_id,
            receiveNotes: appendReceiptNote(
              replacedAutoQty !== null ? stripAutoReceiveNote(prevOi.receive_notes, AUTO_RECEIVE_NOTE) : prevOi.receive_notes,
              noteText
            )
          });
          if (replacedAutoQty !== null) {
            await recordAuditLog(connection, {
              documentId: docId,
              action: 'replace_auto_receive',
              actorUserId: scope.userId || doc.receiver_user_id,
              actorName: scope.userName,
              details: {
                line_id: Number(line.id),
                order_item_id: orderItemId,
                previous_auto_quantity: replacedAutoQty,
                counted_quantity: qtyReceived,
                inventory_delta: roundQty2(qtyReceived - replacedAutoQty)
              }
            });
          }

          await connection.query(
            `UPDATE order_items
             SET actual_price = ?
             WHERE id = ?`,
            [nextActualPrice, orderItemId]
          );
        }
      }

      const cleanBillText = String(line.bill_text || '').trim();
      const normalizedBillText = normalizeMatchText(cleanBillText);
      const aliasKey = `${productId}:${normalizedBillText}:${line.unit_text || ''}`;
      const learnAlias = doc.receiving_scope !== 'branch' || !learnedBranchProducts.has(aliasKey);
      if (learnAlias && productId && normalizedBillText && qtyReceived > 0 && line.remember_alias !== false && Number(line.remember_alias ?? 1) !== 0) {
        const cleanUnitText = String(line.unit_text || line.unit || '').trim();
        const normalizedUnitText = normalizeMatchText(cleanUnitText);
        let learnedMultiplier = unitMultiplier;
        if (
          learnedMultiplier === 1 &&
          qtyBilled !== null &&
          qtyBilled > 0 &&
          qtyReceived > qtyBilled &&
          cleanUnitText &&
          Math.abs(qtyReceived / qtyBilled - Math.round(qtyReceived / qtyBilled)) < 0.0001 &&
          Math.round(qtyReceived / qtyBilled) >= 2
        ) {
          learnedMultiplier = Math.round(qtyReceived / qtyBilled);
        }

        learnedBranchProducts.add(aliasKey);
        await learnSupplierProductAliasInJs(connection, {
          docId,
          doc,
          supplierKey,
          cleanBillText,
          normalizedBillText,
          cleanUnitText,
          normalizedUnitText,
          productId,
          unitId: line.unit_id ? Number(line.unit_id) : null,
          learnedMultiplier,
          lastPrice: effectiveActualPrice ?? unitPrice,
          scope
        });
      }
    }

    if (warningsChanged) {
      await connection.query(
        `UPDATE receiving_documents SET warnings_json = ?, ocr_warnings_json = ? WHERE id = ?`,
        [
          JSON.stringify(currentWarnings),
          doc.ocr_warnings_json || '[]',
          docId
        ]
      );
    }

    await connection.query(
      `UPDATE receiving_documents
       SET status = 'confirmed',
           confirmed_at = NOW(),
           confirmed_by_user_id = ?
       WHERE id = ?`,
      [scope.userId || doc.receiver_user_id, docId]
    );

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'confirm',
      actorUserId: scope.userId || doc.receiver_user_id,
      actorName: scope.userName,
      details: {
        confirmed_lines: positiveLines.length,
        unmatched_ok: Boolean(unmatchedOk),
        // Freeze the pre-confirm outstanding quantity for durable retry, including zero receipts.
        issue_candidates: confirmIssueCandidates(lines || [], scopedItems)
      }
    });

    await linkReceivingExceptions(connection, { doc, lines, scope, documentId: docId });
    await enqueueReceivingNotification(connection, docId, notificationPayload);
    await connection.commit();
    connection.release();
    released = true;
    void afterReceivingConfirm(pool, docId);
    void dispatchReceivingNotification(pool, docId);
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  } catch (error) {
    if (!released) await connection.rollback();
    throw error;
  } finally {
    if (!released) connection.release();
  }
};

// 9. POST /:id/void (แก้ R2-5, R2-6, R2-7)
export const voidReceivingDocument = async ({
  user,
  documentId,
  reason
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();
  await ensurePurchaseWalkManualMirrorTable();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const cleanReason = String(reason || '').trim().slice(0, 1000);
  if (!cleanReason) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'กรุณาระบุเหตุผลในการยกเลิกเอกสาร (reason)'
    );
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
       FROM receiving_documents rd
       WHERE rd.id = ?
       FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);

    if (doc.status === 'void') {
      throw createReceivingError('NOT_DRAFT', 'เอกสารนี้ถูกยกเลิกไปแล้ว');
    }

    if (!mayVoid({ isAdmin: scope.isAdmin, role: user?.role,
      isOwner: Number(doc.receiver_user_id) === Number(scope.userId),
      referenceDay: toBangkokDateKey(doc.confirmed_at || doc.created_at), today: getBangkokDateKey() })) {
      throw createReceivingError('FORBIDDEN', 'แก้ข้ามวันให้ฝ่ายบัญชีหรือแอดมิน (ฝ่ายบัญชีภายใน 7 วัน)');
    }

    await lockLinkedOrderItems(connection, docId);
    const [lines] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC
       FOR UPDATE`,
      [docId]
    );

    const changedBalances = new Map();
    const onInventoryBalanceChange = ({ productId, departmentId, balanceAfter }) => {
      changedBalances.set(`${productId}:${departmentId}`, balanceAfter);
    };
    if (doc.status === 'confirmed') {
      if (doc.receiving_scope === 'branch') {
        const owned = await validateScopedOrderItemsForDocument(connection, { branchId: Number(doc.branch_id), departmentId: null, lines });
        if (lines.some(line => Number(owned.get(Number(line.order_item_id))?.department_id) !== Number(line.branch_department_id))) {
          throw createReceivingError('NOT_DRAFT', 'แผนกเจ้าของใบสั่งเปลี่ยนไป กรุณาให้ผู้ดูแลตรวจสอบก่อนยกเลิก');
        }
      }
      const unlinkedReverseLines = [];

      for (const line of lines || []) {
        const qtyReceived = roundQty2(line.quantity_received) ?? 0;
        const productId = line.product_id ? Number(line.product_id) : null;
        const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;
        const noteText = `ยกเลิกเอกสารรับสินค้า #${docId}: ${cleanReason}`;

        if (orderItemId) {
          // หากบรรทัดนี้มี qtyReceived = 0 ตอน confirm จะไม่ได้อัปเดต order_items จึงข้ามตอน void
          if (
            qtyReceived <= 0 &&
            (line.applied_order_received_quantity === null ||
              line.applied_order_received_quantity === undefined)
          ) {
            continue;
          }

          const [oiRows] = await connection.query(
            `SELECT oi.id, oi.quantity, oi.received_quantity, oi.actual_price, oi.receive_notes,
                    oi.is_received, oi.received_by_user_id, oi.received_at,
                    o.status AS order_status
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE oi.id = ?
             FOR UPDATE`,
            [orderItemId]
          );
          const currentOi = oiRows?.[0];
          if (!currentOi) {
            throw createReceivingError(
              'NOT_DRAFT',
              `ไม่พบรายการใบสั่งซื้อ (ID: ${orderItemId}) สำหรับย้อนสถานะ`
            );
          }

          // The locked current row is authoritative: undo only this document's delta.
          const currentQtyCents = Math.round((roundQty2(currentOi.received_quantity) ?? 0) * 100);
          const deltaCents = Math.round(qtyReceived * 100);
          // A line that replaced the auto-received quantity gives that quantity back on void.
          const autoCents = line.replaced_auto_receive_quantity == null
            ? null : Math.round(Number(line.replaced_auto_receive_quantity) * 100);
          const removedCents = deltaCents - (autoCents ?? 0);
          const nextQtyCents = currentQtyCents - removedCents;
          if (nextQtyCents < 0 || currentOi.order_status === 'cancelled') {
            throw createReceivingError('NOT_DRAFT',
              'ไม่สามารถย้อนรายการที่จำนวนรับจะติดลบหรือใบสั่งซื้อถูกยกเลิกแล้ว');
          }
          const entry = receiptNote(docId, line.note);
          const legacyEntry = `รับสินค้าตามเอกสาร #${docId}${doc.doc_ref ? ` (${doc.doc_ref})` : ''}`;
          const appliedNote = appendReceiptNote(
            autoCents !== null ? stripAutoReceiveNote(line.prev_order_receive_notes, AUTO_RECEIVE_NOTE) : line.prev_order_receive_notes, entry);
          const ownsMetadata = currentOi.receive_notes === appliedNote || currentOi.receive_notes === legacyEntry;
          const samePrice = (a, b) => a == null || b == null
            ? a == null && b == null : Number(a) === Number(b);
          const nextPrice = ownsMetadata && samePrice(currentOi.actual_price, line.applied_order_actual_price)
            ? line.prev_order_actual_price ?? null : currentOi.actual_price ?? null;
          let nextNotes = removeReceiptNote(removeReceiptNote(currentOi.receive_notes, entry, line.prev_order_receive_notes ?? null), legacyEntry, line.prev_order_receive_notes ?? null);
          if (autoCents !== null && ownsMetadata) {
            nextNotes = line.prev_order_receive_notes ?? null; // exact pre-confirm note, auto line included
          } else if (autoCents !== null && !hasAutoReceiveNote(nextNotes, AUTO_RECEIVE_NOTE)) {
            const autoNote = pickAutoReceiveNote(line.prev_order_receive_notes, AUTO_RECEIVE_NOTE);
            nextNotes = autoNote ? (nextNotes ? `${autoNote}\n${nextNotes}` : autoNote) : nextNotes;
          }
          const nextQty = nextQtyCents === 0 && line.prev_order_received_quantity == null
            ? null : nextQtyCents / 100;
          // Only restore an auto-filled ordered quantity if no receipt remains and it is unchanged.
          const autoFilledQty = Number(line.prev_order_quantity) <= 0 &&
            Number(currentOi.quantity) === Number(line.applied_order_received_quantity);
          const nextOrderedQty = ownsMetadata && nextQtyCents === 0 && autoFilledQty
            ? line.prev_order_quantity : currentOi.quantity;

          await updateOrderItemReceivingWithInventory({
            connection, orderItemId, receivedQuantity: nextQty,
            userId: scope.userId || doc.receiver_user_id, receiveNotes: noteText, onInventoryBalanceChange
          });
          await connection.query(
            `UPDATE order_items
             SET quantity = COALESCE(?, quantity),
                 received_quantity = ?, actual_price = ?,
                 is_received = CASE WHEN ? THEN ? ELSE is_received END,
                 received_by_user_id = ?, received_at = ?, receive_notes = ?
             WHERE id = ?`,
            [nextOrderedQty, nextQty, nextPrice,
              nextQtyCents === 0, Boolean(line.prev_order_is_received),
              ownsMetadata ? line.prev_order_received_by_user_id ?? null : currentOi.received_by_user_id ?? null,
              ownsMetadata ? line.prev_order_received_at ?? null : currentOi.received_at ?? null,
              nextNotes, orderItemId]
          );
          const [successors] = await connection.query(
            'SELECT id, prev_order_receive_notes, prev_order_received_quantity FROM receiving_document_lines WHERE order_item_id = ? AND document_id <> ? FOR UPDATE', [orderItemId, docId]);
          // Rebase successor snapshots so a later void cannot resurrect this voided bill's metadata.
          await connection.query(
            `UPDATE receiving_document_lines
             SET prev_order_actual_price = CASE WHEN prev_order_actual_price <=> ? THEN ? ELSE prev_order_actual_price END,
                 prev_order_quantity = CASE WHEN ? AND prev_order_quantity = ? THEN ? ELSE prev_order_quantity END,
                 prev_order_receive_notes = ?, prev_order_received_by_user_id = ?,
                 prev_order_received_at = ?, prev_order_is_received = ?
             WHERE order_item_id = ? AND document_id <> ? AND (prev_order_receive_notes = ? OR prev_order_receive_notes = ?)`,
            [line.applied_order_actual_price ?? null, line.prev_order_actual_price ?? null,
              Number(line.prev_order_quantity) <= 0, line.applied_order_received_quantity, line.prev_order_quantity,
              line.prev_order_receive_notes ?? null, line.prev_order_received_by_user_id ?? null,
              line.prev_order_received_at ?? null, Boolean(line.prev_order_is_received),
              orderItemId, docId, appliedNote, legacyEntry]
          );
          for (const successor of successors) {
            const notes = removeReceiptNote(removeReceiptNote(successor.prev_order_receive_notes, entry, line.prev_order_receive_notes ?? null), legacyEntry, line.prev_order_receive_notes ?? null);
            if (notes !== successor.prev_order_receive_notes) {
              const rebasedCents = Math.round(Number(successor.prev_order_received_quantity || 0) * 100) - removedCents;
              const previousQuantity = rebasedCents === 0 && line.prev_order_received_quantity == null ? null : Math.max(0, rebasedCents) / 100;
              await connection.query('UPDATE receiving_document_lines SET prev_order_receive_notes = ?, prev_order_received_quantity = ? WHERE id = ?', [notes, previousQuantity, successor.id]);
            }
          }
        } else if (productId && qtyReceived > 0) {
          unlinkedReverseLines.push({ productId, qtyReceived, noteText });
        }
      }

      unlinkedReverseLines.sort((a, b) => a.productId - b.productId);
      for (const item of unlinkedReverseLines) {
        const [prodRows] = await connection.query(
          `SELECT COALESCE(is_countable, true) AS is_countable
           FROM products
           WHERE id = ?
           LIMIT 1`,
          [item.productId]
        );
        const isCountable =
          !Array.isArray(prodRows) || prodRows.length === 0
            ? true
            : Number(prodRows[0].is_countable ?? 1) === 1;
        if (!isCountable) continue;

        const balanceBefore = await lockBalanceRow(
          connection,
          item.productId,
          Number(doc.department_id)
        );
        const reverseDelta = -Math.abs(item.qtyReceived);
        const balanceAfter = (Math.round(balanceBefore * 100) + Math.round(reverseDelta * 100)) / 100;
        const [txRes] = await connection.query(
          `INSERT INTO inventory_transactions
             (product_id, department_id, transaction_type, quantity,
              balance_before, balance_after, reference_type, reference_id, notes, created_by)
           VALUES (?, ?, 'adjustment', ?, ?, ?, 'receiving_document_void', ?, ?, ?)`,
          [
            item.productId,
            Number(doc.department_id),
            reverseDelta,
            balanceBefore,
            balanceAfter,
            String(docId),
            item.noteText,
            scope.userId || doc.receiver_user_id
          ]
        );

        await connection.query(
          `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity = VALUES(quantity),
             last_transaction_id = VALUES(last_transaction_id),
             last_updated = CURRENT_TIMESTAMP`,
          [item.productId, Number(doc.department_id), balanceAfter, txRes.insertId]
        );
        onInventoryBalanceChange({ productId: item.productId, departmentId: Number(doc.department_id), balanceAfter });
      }
    }

    if (doc.status === 'confirmed') await voidDocumentManualOrder(connection, docId);

    const warningCodes = [...changedBalances.values()].some(balance => balance < 0)
      ? ['INVENTORY_NEGATIVE_AFTER_VOID'] : [];
    if (warningCodes.length > 0) {
      const warnings = parseJsonArraySafe(doc.warnings_json);
      warnings.push({ code: warningCodes[0], message: 'ยอดคลังหลังยกเลิกเอกสารติดลบ กรุณาตรวจสอบคลัง', line_no: null });
      await connection.query(
        `UPDATE receiving_documents SET warnings_json = ?, ocr_warnings_json = ? WHERE id = ?`,
        [JSON.stringify(warnings), doc.ocr_warnings_json || JSON.stringify([]), docId]
      );
    }

    await connection.query(
      `UPDATE receiving_documents
       SET status = 'void',
           voided_at = NOW(),
           voided_by_user_id = ?,
           void_reason = ?
       WHERE id = ?`,
      [scope.userId || doc.receiver_user_id, cleanReason, docId]
    );

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'void',
      actorUserId: scope.userId || doc.receiver_user_id,
      actorName: scope.userName,
      details: { reason: cleanReason, previous_status: doc.status, warnings: warningCodes }
    });

    await connection.commit();
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 10. GET /:id/images/:imageId
export const getDocumentImageBinary = async ({
  user,
  documentId,
  imageId
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  const imgId = validatePositiveIntOrNull(imageId, 'imageId');
  if (!docId || !imgId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบรูปภาพบิลที่ต้องการ');
  }

  const scope = await resolveActorScope(pool, user);
  const [docRows] = await pool.query(
    `SELECT id, status, branch_id, department_id, receiving_scope, counted_complete_at
     FROM receiving_documents
     WHERE id = ?
     LIMIT 1`,
    [docId]
  );
  const doc = docRows?.[0];
  // Accounting cross-branch exception applies to this binary GET only, never writes.
  assertDocumentAccess((['accounting', 'accountant'].includes(user?.role) ? { ...scope, isAdmin: true } : scope), doc);
  assertBlindCountComplete(doc);

  const [imgRows] = await pool.query(
    `SELECT id, document_id, page_no, mime_type, width, height, size_bytes, sha256, image_data
     FROM receiving_document_images
     WHERE id = ? AND document_id = ?
     LIMIT 1`,
    [imgId, docId]
  );

  if (!Array.isArray(imgRows) || imgRows.length === 0 || !imgRows[0].image_data) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบรูปภาพบิลที่ต้องการ');
  }

  const img = imgRows[0];
  return {
    id: Number(img.id),
    document_id: Number(img.document_id),
    page_no: Number(img.page_no),
    mime: img.mime_type || 'image/jpeg',
    size_bytes: Number(img.size_bytes || img.image_data.length),
    sha256: img.sha256,
    buffer: Buffer.isBuffer(img.image_data) ? img.image_data : Buffer.from(img.image_data)
  };
};
