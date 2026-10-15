import pool from '../config/database.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertDocumentAccess,
  fetchExpectedOrderItemsFlat,
  loadDocumentBundleById,
  recalculateAndPersistWarnings,
  recordAuditLog,
  resolveActorScope
} from './receiving-documents-helpers.js';
import {
  DEFAULT_OCR_MODEL,
  MAX_OCR_ATTEMPTS_PER_DOCUMENT,
  MAX_OCR_PAGES,
  buildSupplierKey,
  checkOcrRateLimit,
  computeBaseUnitPrice,
  computeImagesContentHash,
  computeDocumentWarnings,
  createReceivingError,
  extractBillWithVision,
  matchOcrLinesToCatalog,
  mergeOcrLinesPreservingUserEdits,
  parseImageDataUrl,
  roundQty2,
  toFiniteNumberOrNull,
  validatePositiveIntOrNull
} from '../services/receiving-ocr.service.js';

// 3. POST /:id/images (แก้ข้อ 10, 11, 17: FOR UPDATE lock, ON DUPLICATE KEY UPDATE, jpeg/webp เท่านั้น)
export const uploadDocumentImage = async ({
  user,
  documentId,
  pageNo,
  imageDataUrl
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }
  const parsedPageNo = validatePositiveIntOrNull(pageNo, 'page_no');
  if (!parsedPageNo || parsedPageNo > MAX_OCR_PAGES) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `เลขหน้า (page_no) ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง ${MAX_OCR_PAGES}`
    );
  }

  const parsedImage = parseImageDataUrl(imageDataUrl, {
    allowedMimes: ['image/jpeg', 'image/webp']
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
        'ไม่สามารถเพิ่มหรือแก้ไขรูปบิลในเอกสารที่ยืนยันหรือยกเลิกแล้ว'
      );
    }

    const [upsertRes] = await connection.query(
      `INSERT INTO receiving_document_images
         (document_id, page_no, mime_type, width, height, size_bytes, sha256, image_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         mime_type = VALUES(mime_type),
         width = VALUES(width),
         height = VALUES(height),
         size_bytes = VALUES(size_bytes),
         sha256 = VALUES(sha256),
         image_data = VALUES(image_data)`,
      [
        docId,
        parsedPageNo,
        parsedImage.mimeType,
        parsedImage.width,
        parsedImage.height,
        parsedImage.sizeBytes,
        parsedImage.sha256,
        parsedImage.buffer
      ]
    );

    const imageId = Number(upsertRes.insertId);

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'upload_image',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: {
        image_id: imageId,
        page_no: parsedPageNo,
        mime: parsedImage.mimeType,
        size_bytes: parsedImage.sizeBytes,
        sha256: parsedImage.sha256
      }
    });

    await connection.commit();
    return { image_id: imageId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// 4. POST /:id/ocr (แก้ข้อ 2, 5, 7, R2-3, R2-10)
export const runDocumentOcr = async ({ user, documentId, ocrOptions = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const scope = await resolveActorScope(pool, user);
  const [docRows] = await pool.query(
    `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
     FROM receiving_documents rd
     WHERE rd.id = ?
     LIMIT 1`,
    [docId]
  );
  const doc = docRows?.[0];
  assertDocumentAccess(scope, doc);

  if (doc.status !== 'draft') {
    throw createReceivingError(
      'NOT_DRAFT',
      'ไม่สามารถสั่งอ่านบิลซ้ำในเอกสารที่ยืนยันหรือยกเลิกแล้ว'
    );
  }

  const [imageRows] = await pool.query(
    `SELECT id, page_no, mime_type, width, height, size_bytes, sha256, image_data
     FROM receiving_document_images
     WHERE document_id = ?
     ORDER BY page_no ASC, id ASC`,
    [docId]
  );

  if (!Array.isArray(imageRows) || imageRows.length === 0) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'กรุณาอัปโหลดรูปบิลอย่างน้อย 1 หน้าก่อนเริ่มอ่านบิล'
    );
  }

  if (imageRows.length > MAX_OCR_PAGES) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `จำนวนหน้าบิลเกินกำหนด (สูงสุด ${MAX_OCR_PAGES} หน้าต่อเอกสาร)`
    );
  }

  const currentImagesHash = computeImagesContentHash(imageRows);

  if (
    doc.ocr_status === 'done' &&
    doc.ocr_images_hash &&
    doc.ocr_images_hash === currentImagesHash
  ) {
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  }

  // R2-10: ใช้คอลัมน์ใน DB เป็นเพดานหลักต่อเอกสาร และตรวจ rate limit แบบ dryRun ก่อน claim
  if (Number(doc.ocr_attempt_count || 0) >= MAX_OCR_ATTEMPTS_PER_DOCUMENT) {
    throw createReceivingError(
      'RATE_LIMITED',
      'เอกสารถูกสั่งอ่านบิลเกินจำนวนครั้งที่กำหนด กรุณาแก้ไขข้อมูลด้วยตนเอง',
      429
    );
  }

  const userRateKey = scope.userId
    ? `user:${scope.userId}`
    : `scope:${doc.branch_id}:${doc.department_id}`;
  const docRateKey = `doc:${docId}`;
  checkOcrRateLimit(userRateKey, { dryRun: true });
  checkOcrRateLimit(docRateKey, { dryRun: true });

  // R2-3: ให้ claim ใหม่ได้เมื่อ ocr_status <> 'pending' หรือค้าง pending เกิน 2 นาที
  const [claimRes] = await pool.query(
    `UPDATE receiving_documents
     SET ocr_status = 'pending',
         ocr_attempt_count = COALESCE(ocr_attempt_count, 0) + 1,
         ocr_last_requested_at = NOW()
     WHERE id = ?
       AND status = 'draft'
       AND (
         ocr_status <> 'pending'
         OR ocr_last_requested_at IS NULL
         OR ocr_last_requested_at < NOW() - INTERVAL 2 MINUTE
       )`,
    [docId]
  );

  if (claimRes && Number(claimRes.affectedRows) === 0) {
    throw createReceivingError(
      'NOT_DRAFT',
      'เอกสารกำลังอ่านบิลอยู่ หรือไม่อยู่ในสถานะร่าง (draft)'
    );
  }

  // R2-10: หักโควตาเฉพาะหลังจาก claim สำเร็จแล้วเท่านั้น
  checkOcrRateLimit(userRateKey, { dryRun: false });
  checkOcrRateLimit(docRateKey, { dryRun: false });

  // R2-3: ครอบทุกขั้นตอนหลัง claim ด้วย try/catch เดียว เพื่อไม่ให้ค้างสถานะ pending ถาวรหากขั้นตอนใดล้มเหลว
  let connection = null;
  let inTransaction = false;
  try {
    // Only linked items, within this document's scope, are OCR context. Never send catalog prices.
    const [linkedLines] = await pool.query(
      `SELECT order_item_id FROM receiving_document_lines
       WHERE document_id = ? AND order_item_id IS NOT NULL
       ORDER BY line_no ASC, id ASC`,
      [docId]
    );
    const linkedIds = [...new Set(linkedLines.map((line) => Number(line.order_item_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    const expectedItems = await fetchExpectedOrderItemsFlat(pool, {
      branchId: Number(doc.branch_id),
      departmentId: Number(doc.department_id),
      ...(linkedIds.length > 0
        ? { orderItemIds: linkedIds }
        : { date: toBangkokDateKey(doc.delivery_date) })
    });
    const expectedById = new Map(expectedItems.map((item) => [Number(item.order_item_id), item]));
    const ocrExpectedItems = linkedIds.map((id) => expectedById.get(id)).filter(Boolean).map((item) => ({
      product_name: item.product_name,
      unit_name: item.unit_name,
      quantity_ordered: item.quantity_ordered
    }));
    const ocrResult = await extractBillWithVision({
      images: imageRows,
      document: doc,
      ...ocrOptions,
      expectedItems: ocrExpectedItems
    });

    const supplierNameCandidate =
      String(doc.supplier_name_text || '').trim() ||
      String(ocrResult.supplier_name || '').trim() ||
      '';

    const supplierKey = buildSupplierKey({
      supplierMasterId: doc.supplier_master_id,
      productGroupId: doc.product_group_id,
      supplierNameText: supplierNameCandidate
    });

    let aliasRows = [];
    if (supplierKey && supplierKey !== 'none') {
      const [rows] = await pool.query(
        `SELECT spa.*, p.name AS product_name, p.unit_id AS product_unit_id
         FROM supplier_product_aliases spa
         LEFT JOIN products p ON p.id = spa.product_id
         WHERE spa.supplier_key = ?
         ORDER BY spa.confirm_count DESC, spa.updated_at DESC`,
        [supplierKey]
      );
      aliasRows = Array.isArray(rows) ? rows : [];
    }

    const [unitRows] = await pool.query(
      `SELECT id, name, abbreviation FROM units WHERE is_active = true`
    );

    connection = await pool.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    const [lockedDocRows] = await connection.query(
      `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
       FROM receiving_documents rd
       WHERE rd.id = ?
       FOR UPDATE`,
      [docId]
    );
    const lockedDoc = lockedDocRows?.[0];
    if (!lockedDoc || lockedDoc.status !== 'draft') {
      throw createReceivingError(
        'NOT_DRAFT',
        'ไม่สามารถบันทึกผลอ่านบิลได้เนื่องจากเอกสารถูกยืนยันหรือยกเลิกไปแล้วระหว่างรอผล'
      );
    }

    const [existingLineRows] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC
       FOR UPDATE`,
      [docId]
    );

    const matchedLines = matchOcrLinesToCatalog({
      ocrLines: ocrResult.lines,
      aliases: aliasRows,
      expectedItems,
      units: Array.isArray(unitRows) ? unitRows : [],
      supplierKey
    });

    const mergedLines = mergeOcrLinesPreservingUserEdits({
      existingLines: Array.isArray(existingLineRows) ? existingLineRows : [],
      newMatchedLines: matchedLines
    });

    const preserveHeader = Boolean(lockedDoc.is_header_edited);
    const nextSupplierNameText = preserveHeader
      ? String(lockedDoc.supplier_name_text || '')
      : supplierNameCandidate.slice(0, 255);
    const nextDocRef =
      preserveHeader && lockedDoc.doc_ref
        ? lockedDoc.doc_ref
        : (ocrResult.doc_ref ?? lockedDoc.doc_ref ?? null);
    const nextDocDate =
      preserveHeader && lockedDoc.doc_date
        ? toBangkokDateKey(lockedDoc.doc_date)
        : (ocrResult.doc_date ??
          (lockedDoc.doc_date ? toBangkokDateKey(lockedDoc.doc_date) : null));
    const nextSubtotal =
      preserveHeader && lockedDoc.subtotal != null
        ? toFiniteNumberOrNull(lockedDoc.subtotal)
        : (ocrResult.subtotal ?? toFiniteNumberOrNull(lockedDoc.subtotal));
    const nextDiscount =
      preserveHeader && lockedDoc.discount != null
        ? toFiniteNumberOrNull(lockedDoc.discount)
        : (ocrResult.discount ?? toFiniteNumberOrNull(lockedDoc.discount));
    const nextVat =
      preserveHeader && lockedDoc.vat != null
        ? toFiniteNumberOrNull(lockedDoc.vat)
        : (ocrResult.vat ?? toFiniteNumberOrNull(lockedDoc.vat));
    const nextTotal =
      preserveHeader && lockedDoc.total != null
        ? toFiniteNumberOrNull(lockedDoc.total)
        : (ocrResult.total ?? toFiniteNumberOrNull(lockedDoc.total));
    const nextModel = String(ocrResult.model || DEFAULT_OCR_MODEL).slice(0, 100);
    const { warningCodes: mergedWarningCodes } = computeDocumentWarnings({
      document: { subtotal: nextSubtotal, discount: nextDiscount, vat: nextVat, total: nextTotal },
      lines: mergedLines
    });
    const nextConfidence = mergedWarningCodes.some((code) =>
      ['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH'].includes(code))
      ? Math.min(ocrResult.confidence ?? 0.6, 0.6)
      : ocrResult.confidence;

    await connection.query(
      `UPDATE receiving_documents
       SET supplier_name_text = ?,
           doc_ref = ?,
           doc_date = ?,
           subtotal = ?,
           discount = ?,
           vat = ?,
           total = ?,
           ocr_status = 'done',
           ocr_model = ?,
           ocr_confidence = ?,
           ocr_images_hash = ?,
           ocr_result_json = ?
       WHERE id = ?`,
      [
        nextSupplierNameText,
        nextDocRef,
        nextDocDate,
        nextSubtotal,
        nextDiscount,
        nextVat,
        nextTotal,
        nextModel,
        nextConfidence,
        currentImagesHash,
        JSON.stringify({ doc_kind: ocrResult.doc_kind, line_sum_proposal: ocrResult.line_sum_proposal,
          unreadable_line_count: ocrResult.unreadable_line_count,
          warnings: ocrResult.warnings.filter((code) => ['TOTAL_MISSING_LINE_SUM', 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN'].includes(code)) }),
        docId
      ]
    );

    await connection.query(
      `DELETE FROM receiving_document_lines
       WHERE document_id = ? AND COALESCE(is_user_edited, false) = false`,
      [docId]
    );

    for (const line of mergedLines) {
      if (line.id && Boolean(line.is_user_edited)) {
        continue;
      }
      const mult = toFiniteNumberOrNull(line.unit_multiplier) ?? 1;
      const uPrice = toFiniteNumberOrNull(line.unit_price);
      const bPrice =
        toFiniteNumberOrNull(line.base_unit_price) ??
        computeBaseUnitPrice({
          unitPrice: uPrice,
          amount: line.amount,
          quantityBilled: line.quantity_billed,
          quantityReceived: line.quantity_received,
          unitMultiplier: mult
        });

      await connection.query(
        `INSERT INTO receiving_document_lines (
           document_id, line_no, bill_text, product_id, product_name,
           order_item_id, unit, unit_text, unit_id, unit_multiplier,
           quantity_billed, quantity_received, unit_price, base_unit_price, amount,
           match_source, match_confidence, is_user_edited
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [
          docId,
          Number(line.line_no),
          String(line.bill_text || '').slice(0, 500),
          line.product_id ? Number(line.product_id) : null,
          line.product_name ? String(line.product_name).slice(0, 255) : null,
          line.order_item_id ? Number(line.order_item_id) : null,
          line.unit_text ? String(line.unit_text).slice(0, 100) : null,
          line.unit_text ? String(line.unit_text).slice(0, 100) : null,
          line.unit_id ? Number(line.unit_id) : null,
          mult,
          roundQty2(line.quantity_billed),
          roundQty2(line.quantity_received) ?? 0,
          uPrice,
          bPrice,
          toFiniteNumberOrNull(line.amount),
          line.match?.source || line.match_source || 'none',
          toFiniteNumberOrNull(line.match?.confidence ?? line.match_confidence)
        ]
      );
    }

    const [updatedLines] = await connection.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC`,
      [docId]
    );

    await recalculateAndPersistWarnings(
      connection,
      {
        ...lockedDoc,
        id: docId,
        supplier_name_text: nextSupplierNameText,
        doc_ref: nextDocRef,
        doc_date: nextDocDate,
        subtotal: nextSubtotal,
        discount: nextDiscount,
        vat: nextVat,
        total: nextTotal,
        ocr_status: 'done',
        ocr_result_json: JSON.stringify({ warnings: ocrResult.warnings }),
        ocr_model: nextModel,
        ocr_confidence: nextConfidence
      },
      updatedLines
    );

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'ocr',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: {
        model: nextModel,
        confidence: nextConfidence,
        line_count: updatedLines.length,
        images_hash: currentImagesHash
      }
    });

    await connection.commit();
    inTransaction = false;
    return loadDocumentBundleById(pool, docId, { includeLines: true });
  } catch (error) {
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback error
      }
    }
    if (error?.code !== 'NOT_DRAFT') {
      try {
        await pool.query(
          `UPDATE receiving_documents
           SET ocr_status = 'failed'
           WHERE id = ? AND status = 'draft' AND ocr_status = 'pending'`,
          [docId]
        );
      } catch {
        // ignore secondary cleanup error
      }
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
