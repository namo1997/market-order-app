import pool from '../config/database.js';
import { groupQueue, lookbackDays } from './receiving-queue-policy.js';
import { ensureQueueTables } from './receiving-queue-schema.js';
import { saveFollowup } from './receiving-followups-store.js';
import { getBangkokDateKey, isDateKey, addDaysToDateKey } from '../utils/bangkok-date.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  RECEIVING_DOCUMENT_SELECT_COLUMNS,
  assertDocumentAccess,
  fetchExpectedOrderItemsFlat,
  isAdminUser,
  loadDocumentBundleById,
  mapReceivingDocumentRow,
  mapReceivingImageRow,
  mapReceivingLineRow,
  recalculateAndPersistWarnings,
  recordAuditLog,
  resolveActorScope,
  validateBranchDepartmentConsistency,
  validateScopedOrderItemsForDocument
} from './receiving-documents-helpers.js';
import { runDocumentOcr, uploadDocumentImage } from './receiving-documents-ocr-flow.js';
import {
  confirmReceivingDocument,
  getDocumentImageBinary,
  saveDocumentSignature,
  voidReceivingDocument
} from './receiving-documents-settlement.js';
import { updateReceivingDocument } from './receiving-documents-update.js';
export { getDocumentSignatureBinary } from './receiving-documents-signatures.js';
export { fetchSupplierConfirmedAliases } from './receiving-documents-alias.js';
import {
  MAX_OCR_LINES,
  createReceivingError,
  formatQuantity,
  fromSatangInt,
  normalizeBillDate,
  roundQty2,
  toFiniteNumberOrNull,
  toSatangInt,
  validatePositiveIntOrNull
} from '../services/receiving-ocr.service.js';

export {
  assertDocumentAccess,
  confirmReceivingDocument,
  getDocumentImageBinary,
  isAdminUser,
  mapReceivingDocumentRow,
  mapReceivingImageRow,
  mapReceivingLineRow,
  resolveActorScope,
  runDocumentOcr,
  saveDocumentSignature,
  updateReceivingDocument,
  uploadDocumentImage,
  voidReceivingDocument
};

// 1. GET /expected?date=YYYY-MM-DD
export const getExpectedItems = async ({
  user,
  date,
  branchId = null,
  departmentId = null,
  autoFollowup = true,
  queueDays = globalThis.process?.env?.RECEIVING_QUEUE_LOOKBACK_DAYS
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const targetDate = date ? String(date).trim() : getBangkokDateKey();
  if (!isDateKey(targetDate) || normalizeBillDate(targetDate) !== targetDate) {
    throw createReceivingError('VALIDATION_FAILED', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  }

  const scope = await resolveActorScope(pool, user);
  const parsedBranchId = validatePositiveIntOrNull(branchId, 'branch_id');
  const parsedDeptId = validatePositiveIntOrNull(departmentId, 'department_id');

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin
      ? parsedDeptId ?? (parsedBranchId ? null : scope.departmentId)
      : scope.departmentId;

  // แก้ข้อ 14: ตรวจความสอดคล้องของ department_id เสมอแม้ Admin ส่งมาเฉพาะ department_id
  if (effectiveDepartmentId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: effectiveBranchId,
      departmentId: effectiveDepartmentId
    });
  }

  if (!scope.isAdmin && (!effectiveBranchId || !effectiveDepartmentId)) {
    throw createReceivingError('FORBIDDEN', 'ไม่พบข้อมูลสาขาหรือแผนกของผู้ใช้งาน');
  }

  await ensureQueueTables(pool);
  const rows = await fetchExpectedOrderItemsFlat(pool, {
    startDate: addDaysToDateKey(targetDate, -lookbackDays(queueDays)),
    endDate: targetDate,
    branchId: effectiveBranchId,
    departmentId: effectiveDepartmentId
  });

  const [leads] = await pool.query('SELECT supplier_key, lead_days FROM receiving_supplier_leads');
  const groups = groupQueue(rows, targetDate, leads);
  // Historical/date-preview requests must never generate automatic reminders.
  if (autoFollowup && targetDate === getBangkokDateKey()) {
    for (const group of groups) {
      if (group.due_status === 'overdue') await saveFollowup(pool, { group, source: 'overdue' });
    }
  }
  return groups;
};

// 2. POST / (Create draft receiving document, idempotent by client_uuid)
export const createReceivingDocument = async ({ user, body = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const clientUuid = String(body.client_uuid || '').trim();
  if (!clientUuid || clientUuid.length > 100) {
    throw createReceivingError('VALIDATION_FAILED', 'กรุณาระบุ client_uuid ให้ถูกต้อง');
  }

  const deliveryDate = normalizeBillDate(body.delivery_date);
  if (!deliveryDate) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'กรุณาระบุวันที่รับของ (delivery_date) ในรูปแบบ YYYY-MM-DD'
    );
  }

  const kind = String(body.kind || 'bill').trim();
  if (!['bill', 'manual_receipt'].includes(kind)) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'ชนิดเอกสาร (kind) ต้องเป็น bill หรือ manual_receipt เท่านั้น'
    );
  }

  const scope = await resolveActorScope(pool, user);
  const adminBranchId = validatePositiveIntOrNull(body.branch_id, 'branch_id');
  const adminDeptId = validatePositiveIntOrNull(body.department_id, 'department_id');

  const targetBranchId = scope.isAdmin && adminBranchId ? adminBranchId : scope.branchId;
  const targetDepartmentId = scope.isAdmin && adminDeptId ? adminDeptId : scope.departmentId;

  // แก้ข้อ 14: ตรวจความสอดคล้องของ targetBranchId และ targetDepartmentId เสมอแม้ Admin ส่งมาเฉพาะ department_id หรือ branch_id
  if (scope.isAdmin && (adminBranchId || adminDeptId)) {
    if (!targetDepartmentId) {
      throw createReceivingError('VALIDATION_FAILED', 'กรุณาระบุ department_id ของสาขาที่เลือก');
    }
    await validateBranchDepartmentConsistency(pool, {
      branchId: targetBranchId,
      departmentId: targetDepartmentId
    });
  }

  if (!targetBranchId || !targetDepartmentId || !scope.userId) {
    throw createReceivingError('FORBIDDEN', 'ไม่พบสิทธิ์สาขาหรือแผนกสำหรับสร้างเอกสารรับสินค้า');
  }

  const [existingRows] = await pool.query(
    `SELECT id, branch_id, department_id FROM receiving_documents WHERE client_uuid = ? LIMIT 1`,
    [clientUuid]
  );

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    assertDocumentAccess(scope, existingRows[0]);
    const doc = await loadDocumentBundleById(pool, existingRows[0].id, { includeLines: true });
    return { document: doc, created: false };
  }

  const supplierMasterId = validatePositiveIntOrNull(body.supplier_master_id, 'supplier_master_id');
  const productGroupId = validatePositiveIntOrNull(body.product_group_id, 'product_group_id');

  let supplierNameText = String(body.supplier_name_text || '').trim().slice(0, 255);
  if (!supplierNameText && supplierMasterId) {
    const [smRows] = await pool.query(`SELECT name FROM supplier_masters WHERE id = ? LIMIT 1`, [
      supplierMasterId
    ]);
    if (Array.isArray(smRows) && smRows[0]?.name) {
      supplierNameText = String(smRows[0].name).trim().slice(0, 255);
    }
  }
  if (!supplierNameText && productGroupId) {
    const [pgRows] = await pool.query(`SELECT name FROM product_groups WHERE id = ? LIMIT 1`, [
      productGroupId
    ]);
    if (Array.isArray(pgRows) && pgRows[0]?.name) {
      supplierNameText = String(pgRows[0].name).trim().slice(0, 255);
    }
  }

  const orderItemIds = Array.isArray(body.order_item_ids)
    ? Array.from(
        new Set(
          body.order_item_ids
            .map((id) => validatePositiveIntOrNull(id, 'order_item_id'))
            .filter(Boolean)
        )
      )
    : [];

  if (orderItemIds.length > MAX_OCR_LINES) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `จำนวนรายการเกินกำหนด (สูงสุด ${MAX_OCR_LINES} รายการ)`
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (orderItemIds.length > 0) {
      await validateScopedOrderItemsForDocument(connection, {
        branchId: targetBranchId,
        departmentId: targetDepartmentId,
        lines: orderItemIds.map((id) => ({ order_item_id: id }))
      });
    }

    const [insertResult] = await connection.query(
      `INSERT INTO receiving_documents (
         client_uuid, status, kind, branch_id, department_id,
         supplier_master_id, product_group_id, supplier_name_text,
         delivery_date, ocr_status, receiver_user_id, receiver_name,
         ocr_warnings_json, warnings_json
       ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, '[]', '[]')`,
      [
        clientUuid,
        kind,
        targetBranchId,
        targetDepartmentId,
        supplierMasterId,
        productGroupId,
        supplierNameText,
        deliveryDate,
        scope.userId,
        scope.userName
      ]
    );

    const documentId = Number(insertResult.insertId);
    const createdLines = [];

    if (orderItemIds.length > 0) {
      const expectedItems = await fetchExpectedOrderItemsFlat(connection, {
        branchId: targetBranchId,
        departmentId: targetDepartmentId,
        orderItemIds
      });

      let lineNo = 1;
      for (const item of expectedItems) {
        const qtyOrdered = roundQty2(item.quantity_ordered) ?? 0;
        const unitPrice = toFiniteNumberOrNull(item.actual_price ?? item.requested_price);
        const amount =
          unitPrice !== null ? fromSatangInt(toSatangInt(qtyOrdered * unitPrice)) : null;

        const [lineRes] = await connection.query(
          `INSERT INTO receiving_document_lines (
             document_id, line_no, bill_text, product_id, product_name,
             order_item_id, unit, unit_text, unit_id, unit_multiplier,
             quantity_billed, quantity_received, unit_price, base_unit_price, amount,
             match_source, match_confidence, is_user_edited
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0000, ?, ?, ?, ?, ?, 'order', 1.0000, false)`,
          [
            documentId,
            lineNo,
            String(item.product_name || '').slice(0, 500),
            Number(item.product_id),
            String(item.product_name || '').slice(0, 255),
            Number(item.order_item_id),
            item.unit_name || null,
            item.unit_name || null,
            item.unit_id ? Number(item.unit_id) : null,
            null,
            qtyOrdered,
            unitPrice,
            unitPrice,
            amount
          ]
        );

        createdLines.push({
          id: lineRes.insertId,
          line_no: lineNo,
          bill_text: String(item.product_name || ''),
          product_id: Number(item.product_id),
          product_name: String(item.product_name || ''),
          order_item_id: Number(item.order_item_id),
          unit_text: item.unit_name || null,
          unit_id: item.unit_id ? Number(item.unit_id) : null,
          unit_multiplier: 1,
          quantity_billed: null,
          quantity_received: qtyOrdered,
          unit_price: unitPrice,
          base_unit_price: unitPrice,
          amount,
          match_source: 'order',
          match_confidence: 1
        });
        lineNo += 1;
      }
    }

    await recalculateAndPersistWarnings(
      connection,
      {
        id: documentId,
        branch_id: targetBranchId,
        department_id: targetDepartmentId,
        supplier_master_id: supplierMasterId,
        product_group_id: productGroupId,
        supplier_name_text: supplierNameText,
        doc_ref: null,
        subtotal: null,
        discount: null,
        vat: null,
        total: null,
        ocr_status: 'none',
        ocr_confidence: null,
        ocr_warnings_json: '[]'
      },
      createdLines
    );

    await recordAuditLog(connection, {
      documentId,
      action: 'create',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: { client_uuid: clientUuid, kind, delivery_date: deliveryDate }
    });

    await connection.commit();
    const document = await loadDocumentBundleById(pool, documentId, { includeLines: true });
    return { document, created: true };
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      const [dupRows] = await pool.query(
        `SELECT id, branch_id, department_id FROM receiving_documents WHERE client_uuid = ? LIMIT 1`,
        [clientUuid]
      );
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        assertDocumentAccess(scope, dupRows[0]);
        const doc = await loadDocumentBundleById(pool, dupRows[0].id, { includeLines: true });
        return { document: doc, created: false };
      }
    }
    throw error;
  } finally {
    connection.release();
  }
};

// 5. GET /:id & GET /?date=&status=
export const getReceivingDocumentById = async ({ user, documentId } = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const scope = await resolveActorScope(pool, user);
  const doc = await loadDocumentBundleById(pool, docId, { includeLines: true });
  assertDocumentAccess(scope, doc);
  return doc;
};

export const listReceivingDocuments = async ({
  user,
  date = null,
  status = null,
  branchId = null,
  departmentId = null
} = {}) => {
  await ensureReceivingDocumentsTables();

  const scope = await resolveActorScope(pool, user);
  if (!scope.isAdmin && (!scope.branchId || !scope.departmentId)) {
    throw createReceivingError('FORBIDDEN', 'ไม่พบข้อมูลสาขาหรือแผนกของผู้ใช้งาน');
  }

  const parsedBranchId = validatePositiveIntOrNull(branchId, 'branch_id');
  const parsedDeptId = validatePositiveIntOrNull(departmentId, 'department_id');

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin
      ? parsedDeptId ?? (parsedBranchId ? null : scope.departmentId)
      : scope.departmentId;

  // แก้ข้อ 14: ตรวจความสอดคล้องของ department_id เสมอแม้ Admin ส่งมาเฉพาะ department_id
  if (effectiveDepartmentId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: effectiveBranchId,
      departmentId: effectiveDepartmentId
    });
  }

  const params = [];
  let whereSql = 'WHERE 1=1';

  if (effectiveBranchId) {
    whereSql += ' AND rd.branch_id = ?';
    params.push(Number(effectiveBranchId));
  }
  if (effectiveDepartmentId) {
    whereSql += ' AND rd.department_id = ?';
    params.push(Number(effectiveDepartmentId));
  }

  if (date !== null && date !== undefined && String(date).trim() !== '') {
    const normalizedDate = normalizeBillDate(date);
    if (!normalizedDate) {
      throw createReceivingError('VALIDATION_FAILED', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
    }
    whereSql += ' AND rd.delivery_date = ?';
    params.push(normalizedDate);
  }

  if (status !== null && status !== undefined && String(status).trim() !== '') {
    const cleanStatus = String(status).trim();
    if (!['draft', 'confirmed', 'void'].includes(cleanStatus)) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        'สถานะเอกสารต้องเป็น draft, confirmed หรือ void เท่านั้น'
      );
    }
    whereSql += ' AND rd.status = ?';
    params.push(cleanStatus);
  }

  const [docRows] = await pool.query(
    `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
     FROM receiving_documents rd
     ${whereSql}
     ORDER BY rd.delivery_date DESC, rd.id DESC
     LIMIT 200`,
    params
  );

  if (!Array.isArray(docRows) || docRows.length === 0) {
    return [];
  }

  const docIds = docRows.map((row) => Number(row.id));
  const [imageRows] = await pool.query(
    `SELECT id, document_id, page_no, mime_type, width, height
     FROM receiving_document_images
     WHERE document_id IN (${docIds.map(() => '?').join(', ')})
     ORDER BY page_no ASC, id ASC`,
    docIds
  );

  const imagesByDocId = new Map();
  for (const img of imageRows || []) {
    const did = Number(img.document_id);
    if (!imagesByDocId.has(did)) imagesByDocId.set(did, []);
    imagesByDocId.get(did).push(img);
  }

  return docRows.map((row) =>
    mapReceivingDocumentRow(row, {
      images: imagesByDocId.get(Number(row.id)) || [],
      includeLines: false
    })
  );
};
