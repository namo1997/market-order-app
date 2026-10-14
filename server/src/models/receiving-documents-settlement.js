import pool from '../config/database.js';
import { getBangkokDateKey, toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureInventoryTables, lockBalanceRow } from './inventory.model.js';
import {
  ensureOrderReceivingColumns,
  updateOrderItemReceivingWithInventory
} from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertDocumentAccess,
  loadDocumentBundleById,
  recordAuditLog,
  resolveActorScope,
  validateScopedOrderItemsForDocument
} from './receiving-documents-helpers.js';
import {
  buildSupplierKey,
  computeBaseUnitPrice,
  createReceivingError,
  fromMilliQtyInt,
  normalizeMatchText,
  parseImageDataUrl,
  toFiniteNumberOrNull,
  toMilliQtyInt,
  validatePositiveIntOrNull
} from '../services/receiving-ocr.service.js';

// 7. POST /:id/signatures (แก้ข้อ 10 และข้อ 17: FOR UPDATE lock และรับเฉพาะ image/png ตามสัญญา API)
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
      `SELECT id, status, branch_id, department_id
       FROM receiving_documents
       WHERE id = ?
       FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);

    if (doc.status !== 'draft') {
      throw createReceivingError(
        'NOT_DRAFT',
        'ไม่สามารถแก้ไขลายเซ็นในเอกสารที่ยืนยันหรือยกเลิกแล้ว'
      );
    }

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

// 8. POST /:id/confirm (แก้ข้อ 1, 3, 4, 8)
export const confirmReceivingDocument = async ({
  user,
  documentId,
  unmatchedOk = false
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
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

    const [lines] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC
       FOR UPDATE`,
      [docId]
    );

    const positiveLines = (lines || []).filter(
      (line) => (toMilliQtyInt(line.quantity_received) ?? 0) > 0
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

    await validateScopedOrderItemsForDocument(connection, {
      branchId: Number(doc.branch_id),
      departmentId: Number(doc.department_id),
      lines: lines || []
    });

    const supplierKey = buildSupplierKey({
      supplierMasterId: doc.supplier_master_id,
      productGroupId: doc.product_group_id,
      supplierNameText: doc.supplier_name_text
    });

    const unlinkedInventoryLines = [];

    for (const line of lines || []) {
      const qtyReceived = fromMilliQtyInt(toMilliQtyInt(line.quantity_received) ?? 0) ?? 0;
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
      const noteText = `รับสินค้าตามเอกสาร #${docId}${doc.doc_ref ? ` (${doc.doc_ref})` : ''}`;

      if (orderItemId) {
        const [oiRows] = await connection.query(
          `SELECT id, quantity, received_quantity, actual_price, is_received,
                  received_by_user_id, received_at
           FROM order_items
           WHERE id = ?
           FOR UPDATE`,
          [orderItemId]
        );

        if (Array.isArray(oiRows) && oiRows.length > 0) {
          const prevOi = oiRows[0];
          const nextActualPrice =
            effectiveActualPrice !== null ? effectiveActualPrice : (prevOi.actual_price ?? null);

          await connection.query(
            `UPDATE receiving_document_lines
             SET prev_order_received_quantity = ?,
                 prev_order_actual_price = ?,
                 prev_order_is_received = ?,
                 prev_order_received_by_user_id = ?,
                 prev_order_received_at = ?,
                 applied_order_received_quantity = ?,
                 applied_order_actual_price = ?
             WHERE id = ?`,
            [
              prevOi.received_quantity ?? null,
              prevOi.actual_price ?? null,
              prevOi.is_received !== null && prevOi.is_received !== undefined
                ? Boolean(prevOi.is_received)
                : false,
              prevOi.received_by_user_id ?? null,
              prevOi.received_at ?? null,
              qtyReceived,
              nextActualPrice,
              line.id
            ]
          );

          await updateOrderItemReceivingWithInventory({
            connection,
            orderItemId,
            receivedQuantity: qtyReceived,
            userId: scope.userId || doc.receiver_user_id,
            receiveNotes: noteText
          });

          await connection.query(
            `UPDATE order_items
             SET actual_price = ?
             WHERE id = ?`,
            [nextActualPrice, orderItemId]
          );
        }
      } else if (productId && qtyReceived > 0) {
        unlinkedInventoryLines.push({ productId, qtyReceived, noteText });
      }

      const cleanBillText = String(line.bill_text || '').trim();
      const normalizedBillText = normalizeMatchText(cleanBillText);
      if (productId && normalizedBillText && qtyReceived > 0) {
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

        const adminFlag = scope.isAdmin ? 1 : 0;
        await connection.query(
          `INSERT INTO supplier_product_aliases (
             supplier_key, supplier_master_id, product_group_id, supplier_name_text,
             bill_text, normalized_bill_text, unit_text, normalized_unit_text,
             product_id, unit_id, unit_multiplier, last_unit_price,
             confirm_count, candidate_product_id, candidate_confirm_count, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, ?)
           ON DUPLICATE KEY UPDATE
             product_id = CASE
               WHEN product_id = VALUES(product_id) THEN product_id
               WHEN ? = 1 OR confirm_count <= 1 THEN VALUES(product_id)
               WHEN candidate_product_id = VALUES(product_id) AND candidate_confirm_count + 1 >= 3 THEN VALUES(product_id)
               ELSE product_id
             END,
             unit_id = CASE
               WHEN product_id = VALUES(product_id) OR ? = 1 OR confirm_count <= 1 THEN COALESCE(VALUES(unit_id), unit_id)
               ELSE unit_id
             END,
             unit_multiplier = CASE
               WHEN product_id = VALUES(product_id) OR ? = 1 OR confirm_count <= 1 THEN VALUES(unit_multiplier)
               ELSE unit_multiplier
             END,
             last_unit_price = COALESCE(VALUES(last_unit_price), last_unit_price),
             confirm_count = CASE
               WHEN product_id = VALUES(product_id) THEN confirm_count + 1
               WHEN ? = 1 OR confirm_count <= 1 THEN 1
               WHEN candidate_product_id = VALUES(product_id) AND candidate_confirm_count + 1 >= 3 THEN 3
               ELSE confirm_count
             END,
             candidate_product_id = CASE
               WHEN product_id = VALUES(product_id) OR ? = 1 OR confirm_count <= 1 THEN NULL
               WHEN candidate_product_id = VALUES(product_id) AND candidate_confirm_count + 1 >= 3 THEN NULL
               ELSE VALUES(product_id)
             END,
             candidate_confirm_count = CASE
               WHEN product_id = VALUES(product_id) OR ? = 1 OR confirm_count <= 1 THEN 0
               WHEN candidate_product_id = VALUES(product_id) AND candidate_confirm_count + 1 >= 3 THEN 0
               WHEN candidate_product_id = VALUES(product_id) THEN candidate_confirm_count + 1
               ELSE 1
             END,
             updated_by_user_id = VALUES(updated_by_user_id),
             updated_at = CURRENT_TIMESTAMP`,
          [
            supplierKey,
            doc.supplier_master_id ?? null,
            doc.product_group_id ?? null,
            doc.supplier_name_text || null,
            cleanBillText.slice(0, 255),
            normalizedBillText.slice(0, 255),
            cleanUnitText.slice(0, 100),
            normalizedUnitText.slice(0, 100),
            productId,
            line.unit_id ? Number(line.unit_id) : null,
            learnedMultiplier,
            effectiveActualPrice ?? unitPrice,
            scope.userId || doc.receiver_user_id,
            adminFlag,
            adminFlag,
            adminFlag,
            adminFlag,
            adminFlag,
            adminFlag
          ]
        );
      }
    }

    unlinkedInventoryLines.sort((a, b) => a.productId - b.productId);
    for (const item of unlinkedInventoryLines) {
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
      const balanceAfter =
        fromMilliQtyInt((toMilliQtyInt(balanceBefore) ?? 0) + (toMilliQtyInt(item.qtyReceived) ?? 0)) ?? 0;

      const [txRes] = await connection.query(
        `INSERT INTO inventory_transactions
           (product_id, department_id, transaction_type, quantity,
            balance_before, balance_after, reference_type, reference_id, notes, created_by)
         VALUES (?, ?, 'receive', ?, ?, ?, 'receiving_document', ?, ?, ?)`,
        [
          item.productId,
          Number(doc.department_id),
          item.qtyReceived,
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
        unmatched_ok: Boolean(unmatchedOk)
      }
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

// 9. POST /:id/void (แก้ข้อ 3, 4, 15)
export const voidReceivingDocument = async ({
  user,
  documentId,
  reason
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

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

    if (!scope.isAdmin) {
      const isOwner = Number(doc.receiver_user_id) === Number(scope.userId);
      const todayKey = getBangkokDateKey();
      const refDateKey = toBangkokDateKey(doc.confirmed_at || doc.created_at);
      const isSameDay = Boolean(refDateKey) && refDateKey === todayKey;

      if (!isOwner || !isSameDay) {
        throw createReceivingError(
          'FORBIDDEN',
          'เฉพาะผู้ดูแลระบบหรือผู้รับของเจ้าของเอกสารภายในวันเดียวกันเท่านั้นที่ยกเลิกได้'
        );
      }
    }

    const [lines] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC
       FOR UPDATE`,
      [docId]
    );

    if (doc.status === 'confirmed') {
      const unlinkedReverseLines = [];

      for (const line of lines || []) {
        const qtyReceived = fromMilliQtyInt(toMilliQtyInt(line.quantity_received) ?? 0) ?? 0;
        const productId = line.product_id ? Number(line.product_id) : null;
        const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;
        const noteText = `ยกเลิกเอกสารรับสินค้า #${docId}: ${cleanReason}`;

        if (orderItemId) {
          const [oiRows] = await connection.query(
            `SELECT id, received_quantity, actual_price
             FROM order_items
             WHERE id = ?
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

          const expectedAppliedMillis = toMilliQtyInt(
            line.applied_order_received_quantity ?? line.quantity_received
          );
          const currentReceivedMillis = toMilliQtyInt(currentOi.received_quantity);
          if (
            expectedAppliedMillis !== null &&
            currentReceivedMillis !== expectedAppliedMillis
          ) {
            throw createReceivingError(
              'NOT_DRAFT',
              'ไม่สามารถยกเลิกเอกสารได้เนื่องจากรายการใบสั่งซื้อถูกแก้ไขหลังจากยืนยันเอกสารนี้แล้ว'
            );
          }

          if (
            line.applied_order_actual_price !== null &&
            line.applied_order_actual_price !== undefined &&
            currentOi.actual_price !== null &&
            currentOi.actual_price !== undefined &&
            Math.abs(Number(currentOi.actual_price) - Number(line.applied_order_actual_price)) >
              0.0001
          ) {
            throw createReceivingError(
              'NOT_DRAFT',
              'ไม่สามารถยกเลิกเอกสารได้เนื่องจากราคาในใบสั่งซื้อถูกแก้ไขหลังจากยืนยันเอกสารนี้แล้ว'
            );
          }

          await updateOrderItemReceivingWithInventory({
            connection,
            orderItemId,
            receivedQuantity: line.prev_order_received_quantity ?? null,
            userId: scope.userId || doc.receiver_user_id,
            receiveNotes: noteText
          });

          await connection.query(
            `UPDATE order_items
             SET received_quantity = ?,
                 actual_price = ?,
                 is_received = ?,
                 received_by_user_id = ?,
                 received_at = ?
             WHERE id = ?`,
            [
              line.prev_order_received_quantity ?? null,
              line.prev_order_actual_price ?? null,
              line.prev_order_is_received !== null && line.prev_order_is_received !== undefined
                ? Boolean(line.prev_order_is_received)
                : false,
              line.prev_order_received_by_user_id ?? null,
              line.prev_order_received_at ?? null,
              orderItemId
            ]
          );
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
        const balanceAfter =
          fromMilliQtyInt((toMilliQtyInt(balanceBefore) ?? 0) + (toMilliQtyInt(reverseDelta) ?? 0)) ?? 0;

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
      }
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
      details: { reason: cleanReason, previous_status: doc.status }
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
    `SELECT id, branch_id, department_id
     FROM receiving_documents
     WHERE id = ?
     LIMIT 1`,
    [docId]
  );
  const doc = docRows?.[0];
  assertDocumentAccess(scope, doc);

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
