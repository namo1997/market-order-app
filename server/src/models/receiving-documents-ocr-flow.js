import { branchOcrExpectedItems, mergeBranchOcrLines, persistBranchOcrLines } from './receiving-branch-ocr.js';
import pool from '../config/database.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertBlindCountComplete,
  assertDocumentAccess,
  fetchExpectedOrderItemsFlat,
  loadDocumentBundleById,
  recalculateAndPersistWarnings,
  recordAuditLog,
  resolveActorScope
} from './receiving-documents-helpers.js';
import { fetchSupplierConfirmedAliases } from './receiving-documents-alias.js';
import {
  DEFAULT_OCR_MODEL,
  MAX_OCR_ATTEMPTS_PER_DOCUMENT,
  MAX_OCR_PAGES,
  MAX_OCR_LINES,
  billBranchMismatch,
  buildSupplierKey,
  checkOcrRateLimit,
  computeImagesContentHash,
  computeDocumentWarnings,
  createReceivingError,
  extractBillWithVision,
  formatQuantity,
  matchOcrLinesToCatalog,
  mergeOcrLinesPreservingUserEdits,
  parseImageDataUrl,
  toFiniteNumberOrNull,
  validatePositiveIntOrNull
} from '../services/receiving-ocr.service.js';

// Taught customer names of a shop (receiving_supplier_customer_names) for bill reading: spelling hints
// for the addressee, and the branch a read addressee names. Local to the OCR flow
// so its tested module graph does not change.
const fetchSupplierCustomerNames = async (connection, supplierKey, limit = 20) => {
  const [rows] = await connection.query(`SELECT c.customer_name, c.branch_id, b.name AS branch_name
    FROM receiving_supplier_customer_names c LEFT JOIN branches b ON b.id = c.branch_id
    WHERE c.supplier_key = ? AND c.is_active = 1 ORDER BY c.customer_name, c.id LIMIT ?`, [supplierKey, limit]);
  return (rows || []).map(row => ({ customer_name: row.customer_name, branch_id: Number(row.branch_id), branch_name: row.branch_name ?? null }));
};
const customerKey = value => String(value || '').normalize('NFC').toLowerCase().replace(/[\s.,()\-_/]+/gu, '');
export const knownCustomerFor = (addressee, known = []) => {
  const wanted = customerKey(addressee);
  return wanted ? known.find(row => customerKey(row.customer_name) === wanted) || null : null;
};

// 3. POST /:id/images (แก้ข้อ 10, 11, 17: FOR UPDATE lock, ON DUPLICATE KEY UPDATE, jpeg/webp เท่านั้น)
// The printed supplier code is a bill fact: stored only when it changes, so lines without one cost no query.
const setLineItemCode = async (connection, docId, lineId, nextCode, previousCode) => {
  const next = nextCode || null;
  if (!lineId || next === (previousCode || null)) return;
  await connection.query(
    'UPDATE receiving_document_lines SET item_code = ? WHERE id = ? AND document_id = ?',
    [next, lineId, docId]
  );
};

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
      `SELECT id, status, branch_id, department_id, receiving_scope
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
    await connection.query('UPDATE receiving_document_lines SET review_decision = NULL WHERE document_id = ?', [docId]);
    await connection.query('UPDATE receiving_documents SET receiver_signature = NULL, courier_signature = NULL WHERE id = ?', [docId]);

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
  // Owner 2026-10-21: a scanned bill is read at once so its product names prefill the blind count.
  // The blind projection still hides every bill quantity, price and total until the count is saved.
  // Branch-scope and no-bill documents keep the original count-first rule.
  if (doc.kind !== 'bill' || doc.receiving_scope === 'branch') assertBlindCountComplete(doc);

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
    // Context belongs to this document only; unrelated orders on the same day are excluded.
    const [contextLines] = await pool.query(
      `SELECT * FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC`,
      [docId]
    );
    const linkedIds = [...new Set(contextLines.map((line) => Number(line.order_item_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];
    const expectedRows = linkedIds.length ? await fetchExpectedOrderItemsFlat(pool, {
      branchId: Number(doc.branch_id),
      departmentId: doc.receiving_scope === 'branch' ? null : Number(doc.department_id),
      orderItemIds: linkedIds
    }) : [];
    // Before the count (early read) the products already in the receipt are the matching context, without quantities.
    const countedLines = linkedIds.length ? [] : contextLines.filter(line => line.product_id && (line.counted_quantity != null || !doc.counted_complete_at));
    const expectedItems = doc.receiving_scope === 'branch'
      ? branchOcrExpectedItems(expectedRows.filter(item => linkedIds.includes(Number(item.order_item_id))))
      : expectedRows;
    const expectedById = new Map(expectedItems.map((item) => [Number(item.order_item_id), item]));
    const ocrExpectedItems = linkedIds.length ? (doc.receiving_scope === 'branch' ? expectedItems
      : linkedIds.map((id) => expectedById.get(id)).filter(Boolean)).map((item) => ({
      product_name: item.product_name,
      unit_name: item.unit_name,
      quantity_ordered: item.quantity_ordered
    })) : countedLines.map(line => ({ product_name: line.product_name, unit_name: line.unit_text,
      quantity_ordered: null, quantity_counted: line.counted_quantity == null ? null : formatQuantity(line.counted_quantity) }));
    const initialSupplierKey = buildSupplierKey({
      supplierMasterId: doc.supplier_master_id,
      productGroupId: doc.product_group_id,
      supplierNameText: doc.supplier_name_text
    });
    let knownAliases = [];
    let knownCustomers = [];
    if (initialSupplierKey && initialSupplierKey !== 'none') {
      knownAliases = await fetchSupplierConfirmedAliases(pool, initialSupplierKey, 50);
      // Hints only: a missing table or read failure must never block reading the bill.
      try { knownCustomers = await fetchSupplierCustomerNames(pool, initialSupplierKey, 20); } catch { knownCustomers = []; }
    }
    const ocrResult = await extractBillWithVision({
      images: imageRows,
      document: doc,
      ...ocrOptions,
      expectedItems: ocrExpectedItems,
      knownAliases: ocrOptions.knownAliases ?? knownAliases,
      knownCustomers
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
      // ชื่อย่อที่ฝ่ายบัญชีปิดใช้แล้ว (is_active = 0) ต้องไม่ถูกใช้จับคู่สินค้า
      aliasRows = Array.isArray(rows) ? rows.filter((row) => Number(row.is_active ?? 1) !== 0) : [];
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

    const branchScope = lockedDoc.receiving_scope === 'branch';
    const matchedLines = branchScope ? [] : matchOcrLinesToCatalog({
      ocrLines: ocrResult.lines,
      aliases: aliasRows,
      expectedItems,
      products: countedLines.map(line => ({ id: line.product_id, name: line.product_name, unit_id: line.unit_id, unit_name: line.unit_text })),
      units: Array.isArray(unitRows) ? unitRows : [],
      supplierKey
    });

    const mergedLines = branchScope ? mergeBranchOcrLines({
      existingLines: existingLineRows, ocrLines: ocrResult.lines, aliases: aliasRows,
      expectedItems, units: Array.isArray(unitRows) ? unitRows : [], supplierKey
    }) : mergeOcrLinesPreservingUserEdits({ existingLines: existingLineRows, newMatchedLines: matchedLines });
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
        : (ocrResult.warnings.includes('DOC_DATE_INVALID') ? null : ocrResult.doc_date ??
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

    let shipToMismatch = null;
    if (ocrResult.ship_to || ocrResult.addressee) {
      const [branches] = await connection.query('SELECT id, name FROM branches ORDER BY id');
      // A taught customer name decides the branch; otherwise fall back to branch-name matching.
      const taught = knownCustomerFor(ocrResult.addressee, knownCustomers);
      shipToMismatch = taught ? Number(taught.branch_id) !== Number(lockedDoc.branch_id)
        : billBranchMismatch(ocrResult.ship_to, ocrResult.addressee, lockedDoc.branch_id, branches);
      if (shipToMismatch) ocrResult.warnings.push('SHIP_TO_MISMATCH');
    }
    const persistedReads = branchScope
      ? mergedLines.filter(line => line.ocr_line_no).map(line => ({
        ...ocrResult.lines.find(read => read.line_no === line.ocr_line_no), line_no: line.line_no
      })) : ocrResult.lines;

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
        JSON.stringify({ ship_to: ocrResult.ship_to, addressee: ocrResult.addressee, supplier_code: ocrResult.supplier_code,
          ship_to_mismatch: shipToMismatch, raw_read: { doc_date: ocrResult.doc_date, total: ocrResult.total, line_count: ocrResult.lines.length },
          line_reads: persistedReads.map(line => ({ line_no: line.line_no, bill_text: line.bill_text, bill_read: line.bill_read,
            ...(line.item_code ? { item_code: line.item_code } : {}) })),
          suggestions: persistedReads.filter(line => line.suggested_product_name).map(line => ({ line_no: line.line_no, bill_text: line.bill_text, suggested_product_name: line.suggested_product_name, suggestion_reason: line.suggestion_reason })),
          doc_kind: ocrResult.doc_kind, discount_lines: ocrResult.discount_lines || [], line_sum_proposal: ocrResult.line_sum_proposal,
          unreadable_line_count: ocrResult.unreadable_line_count,
          warnings: ocrResult.warnings.filter((code) => ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SHIP_TO_MISMATCH', 'TOTAL_MISSING_LINE_SUM', 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN', 'DOC_DATE_INVALID', 'BILL_IS_STATEMENT'].includes(code)) }),
        docId
      ]
    );

    if (branchScope) {
      await persistBranchOcrLines(connection, docId, mergedLines);
    } else {
    // OCR supplies bill facts only. Never replace count rows, IDs or receipt quantities.
    const used = new Set();
    let nextLineNo = Math.max(0, ...existingLineRows.map(line => Number(line.line_no))) + 1;
    let addedLines = 0;
    for (const bill of matchedLines) {
      const raw = ocrResult.lines.find(line => line.line_no === bill.line_no && line.bill_text === bill.bill_text)?.bill_read;
      const billQuantity = raw ? raw.quantity_billed : bill.quantity_billed;
      const billPrice = raw ? raw.unit_price : bill.unit_price;
      const billAmount = raw ? raw.amount : bill.amount;
      const target = existingLineRows.find(row => !used.has(Number(row.id)) &&
        ((bill.order_item_id && Number(row.order_item_id) === Number(bill.order_item_id)) ||
         (bill.product_id && Number(row.product_id) === Number(bill.product_id))));
      if (target) {
        used.add(Number(target.id));
        if (target.is_user_edited) continue;
        await connection.query(`UPDATE receiving_document_lines SET bill_text = ?, quantity_billed = ?, unit_price = ?, base_unit_price = NULL, amount = ?, match_source = ?, match_confidence = ?, review_decision = NULL WHERE id = ? AND document_id = ?`,
          [bill.bill_text || '', billQuantity,
            billPrice, billAmount, bill.match?.source || bill.match_source || 'order', bill.match?.confidence ?? bill.match_confidence ?? null, target.id, docId]);
        await setLineItemCode(connection, docId, target.id, bill.item_code, target.item_code);
      } else {
        if (existingLineRows.length + ++addedLines > MAX_OCR_LINES) throw createReceivingError('VALIDATION_FAILED', 'ผลอ่านรวมรายการเดิมเกินจำนวนที่กำหนด');
        // Keep unmapped bill lines visible; require a human to match/count after reveal.
        const [insertedLine] = await connection.query(`INSERT INTO receiving_document_lines (
          document_id, line_no, bill_text, product_id, product_name, order_item_id,
          unit, unit_text, unit_id, unit_multiplier, quantity_billed, quantity_received,
          unit_price, base_unit_price, amount, match_source, match_confidence, is_user_edited, remember_alias
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, false)`,
        [docId, nextLineNo++, bill.bill_text || '', bill.product_id || null,
          bill.product_name || null, bill.order_item_id || null, bill.unit_text || null, bill.unit_text || null,
          bill.unit_id || null, 1, billQuantity, 0,
          billPrice, bill.base_unit_price || billPrice, billAmount, bill.match?.source || 'none', bill.match?.confidence || null]);
        await setLineItemCode(connection, docId, insertedLine?.insertId, bill.item_code, null);
      }
    }
    for (const target of existingLineRows.filter(row => !used.has(Number(row.id)) && !row.is_user_edited)) {
      await connection.query(`UPDATE receiving_document_lines SET bill_text = ?, quantity_billed = ?, unit_price = ?, base_unit_price = NULL, amount = ?, match_source = ?, match_confidence = ?, review_decision = NULL WHERE id = ? AND document_id = ?`,
        ['', null, null, null, target.match_source || 'order', target.match_confidence, target.id, docId]);
      await setLineItemCode(connection, docId, target.id, null, target.item_code);
    }
    }
    // Any new bill invalidates previous decisions and signatures.
    await connection.query('UPDATE receiving_document_lines SET review_decision = NULL WHERE document_id = ?', [docId]);
    await connection.query('UPDATE receiving_documents SET receiver_signature = NULL, courier_signature = NULL WHERE id = ?', [docId]);

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
