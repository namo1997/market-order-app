import { branchLineGroups, allocateBranchQuantity } from './receiving-branch-policy.js';
import { receivingScope, aggregateBranchQueue, initialBranchAmounts } from './receiving-branch-policy.js';
import { resolveReceivingSupplier } from './receiving-supplier-catalog.js';
import pool from '../config/database.js';
import { findReceivingDraft } from './receiving-draft-reuse.js';
import { groupQueue, lookbackDays, withReceiptSummary } from './receiving-queue-policy.js';
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
export { searchReceivingSuppliers, receivingSupplierProducts, searchReceivingProducts } from './receiving-supplier-catalog.js';
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
  validatePositiveIntOrNull,
  validateQuantityOrNull
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
  scope: requestedScope = 'department',
  autoFollowup = true,
  includeInternalQuantities = false,
  queueDays = globalThis.process?.env?.RECEIVING_QUEUE_LOOKBACK_DAYS
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const targetDate = date ? String(date).trim() : getBangkokDateKey();
  if (!isDateKey(targetDate) || normalizeBillDate(targetDate) !== targetDate) {
    throw createReceivingError('VALIDATION_FAILED', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  }

  const scope = await resolveActorScope(pool, user);
  const branchScope = receivingScope(requestedScope) === 'branch';
  if (branchScope && !scope.canReceiveBranch && !scope.isAdmin) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับทั้งสาขา');
  if (branchScope && !scope.isAdmin && branchId != null && Number(branchId) !== scope.branchId) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับต่างสาขา');
  const parsedBranchId = validatePositiveIntOrNull(branchId, 'branch_id');
  const parsedDeptId = validatePositiveIntOrNull(departmentId, 'department_id');

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  if (branchScope && !effectiveBranchId) throw createReceivingError('VALIDATION_FAILED', 'กรุณาเลือกสาขาสำหรับรับทั้งสาขา');
  const effectiveDepartmentId =
    branchScope ? null : scope.isAdmin
      ? parsedDeptId ?? (parsedBranchId ? null : scope.departmentId)
      : scope.departmentId;

  // แก้ข้อ 14: ตรวจความสอดคล้องของ department_id เสมอแม้ Admin ส่งมาเฉพาะ department_id
  if (effectiveDepartmentId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: effectiveBranchId,
      departmentId: effectiveDepartmentId
    });
  }

  if (!scope.isAdmin && (!effectiveBranchId || (!branchScope && !effectiveDepartmentId))) {
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
  const queue = branchScope ? aggregateBranchQueue(groups, rows) : groups;
  if (includeInternalQuantities) return queue;
  return withReceiptSummary(queue, rows, branchScope).map(group => ({ ...group, items: group.items.map(item => ({
    order_item_id: item.order_item_id, order_item_ids: item.order_item_ids,
    product_id: item.product_id, product_name: item.product_name, unit_name: item.unit_name,
    unit_id: item.unit_id, is_received: item.is_received, has_pending: Number(item.remaining_quantity ?? (Number(item.quantity_ordered) - Number(item.received_quantity || 0))) > 0,
    due_status: item.due_status, due_date: item.due_date,
    departments: item.departments?.map(part => ({ department_id: part.department_id, department_name: part.department_name }))
  })) }));
};

// 2. POST / (Create draft receiving document, idempotent by client_uuid)
export const createReceivingDocument = async ({ user, body = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  if (body.resume_draft !== undefined && typeof body.resume_draft !== 'boolean') throw createReceivingError('VALIDATION_FAILED', 'resume_draft ต้องเป็น boolean');

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
  const branchScope = receivingScope(body.scope) === 'branch';
  if (branchScope && !scope.canReceiveBranch && !scope.isAdmin) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับทั้งสาขา');
  if (branchScope && !scope.isAdmin && body.branch_id != null && Number(body.branch_id) !== scope.branchId) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับต่างสาขา');
  const adminBranchId = validatePositiveIntOrNull(body.branch_id, 'branch_id');
  const adminDeptId = validatePositiveIntOrNull(body.department_id, 'department_id');

  const targetBranchId = scope.isAdmin && adminBranchId ? adminBranchId : scope.branchId;
  let targetDepartmentId = scope.isAdmin && adminDeptId ? adminDeptId : scope.departmentId;
  if (branchScope && scope.isAdmin && (!targetDepartmentId || (adminBranchId && !adminDeptId))) {
    const [departments] = await pool.query('SELECT id FROM departments WHERE branch_id = ? ORDER BY id LIMIT 1', [targetBranchId]);
    targetDepartmentId = departments?.[0]?.id ? Number(departments[0].id) : null;
  }

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
    `SELECT id, branch_id, department_id, receiving_scope FROM receiving_documents WHERE client_uuid = ? LIMIT 1`,
    [clientUuid]
  );

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    assertDocumentAccess(scope, existingRows[0]);
    if ((existingRows[0].receiving_scope || 'department') !== (branchScope ? 'branch' : 'department') || Number(existingRows[0].branch_id) !== Number(targetBranchId)) throw createReceivingError('NOT_DRAFT', 'client_uuid นี้ถูกใช้ในขอบเขตอื่นแล้ว');
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

  if (!orderItemIds.length && (supplierMasterId || productGroupId)) {
    if (supplierMasterId && productGroupId) throw createReceivingError('VALIDATION_FAILED', 'กรุณาเลือกร้านจากทะเบียนเดียว');
    const supplier = await resolveReceivingSupplier({ user, supplierKey: supplierMasterId ? `sm:${supplierMasterId}` : `pg:${productGroupId}`,
      filters: { branch_id: targetBranchId, department_id: targetDepartmentId } });
    supplierNameText = String(supplier.name).trim().slice(0, 255);
  }
  if (branchScope && orderItemIds.length === 0) throw createReceivingError('VALIDATION_FAILED', 'ใบรับทั้งสาขาต้องเลือกรายการใบสั่งซื้อ');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (orderItemIds.length > 0) {
      await validateScopedOrderItemsForDocument(connection, {
        branchId: targetBranchId,
        departmentId: branchScope ? null : targetDepartmentId,
        lines: orderItemIds.map((id) => ({ order_item_id: id }))
      });
    }

    if (body.resume_draft) {
      const existing = await findReceivingDraft(connection, { branchId: targetBranchId, departmentId: targetDepartmentId,
        branchScope, deliveryDate, productGroupId, supplierMasterId, supplierNameText });
      if (existing) {
        assertDocumentAccess(scope, existing);
        await connection.commit();
        return { document: await loadDocumentBundleById(pool, existing.id, { includeLines: true }), created: false };
      }
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
    if (branchScope) await connection.query('UPDATE receiving_documents SET receiving_scope = ? WHERE id = ?', ['branch', documentId]);
    const createdLines = [];

    if (orderItemIds.length > 0) {
      const expectedItems = await fetchExpectedOrderItemsFlat(connection, {
        branchId: targetBranchId,
        departmentId: branchScope ? null : targetDepartmentId,
        orderItemIds
      });

      if (branchScope) {
        const suppliers = new Set(expectedItems.map(item => Number(item.product_group_id) || 0));
        if (!expectedItems.length || suppliers.size !== 1 || (productGroupId && !suppliers.has(productGroupId))) {
          throw createReceivingError('VALIDATION_FAILED', 'ใบรับทั้งสาขาต้องอ้างอิงรายการจากร้านเดียวกัน');
        }
      }
      const branchAmounts = branchScope ? initialBranchAmounts(expectedItems) : null;
      let lineNo = 1;
      for (const item of expectedItems) {
        const qtyOrdered = branchScope ? Math.max(0, ((Math.round(Number(item.quantity_ordered || 0) * 100) - Math.round(Number(item.received_quantity || 0) * 100)) / 100)) : roundQty2(item.quantity_ordered) ?? 0;
        const unitPrice = toFiniteNumberOrNull(item.actual_price ?? item.requested_price);
        const amount = branchScope ? branchAmounts.get(Number(item.order_item_id)) :
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

        if (branchScope) await connection.query(
          'UPDATE receiving_document_lines SET branch_weight = ?, branch_department_id = ?, branch_department_name = ? WHERE id = ?',
          [item.quantity_ordered, item.department_id, item.department_name || '', lineRes.insertId]);
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
        department_id: branchScope ? null : targetDepartmentId,
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
        `SELECT id, branch_id, department_id, receiving_scope FROM receiving_documents WHERE client_uuid = ? LIMIT 1`,
        [clientUuid]
      );
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        assertDocumentAccess(scope, dupRows[0]);
        if ((dupRows[0].receiving_scope || 'department') !== (branchScope ? 'branch' : 'department') || Number(dupRows[0].branch_id) !== Number(targetBranchId)) throw createReceivingError('NOT_DRAFT', 'client_uuid นี้ถูกใช้ในขอบเขตอื่นแล้ว');
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
  departmentId = null,
  scope: requestedScope = 'department'
} = {}) => {
  await ensureReceivingDocumentsTables();

  const scope = await resolveActorScope(pool, user);
  if (!scope.isAdmin && (!scope.branchId || !scope.departmentId)) {
    throw createReceivingError('FORBIDDEN', 'ไม่พบข้อมูลสาขาหรือแผนกของผู้ใช้งาน');
  }

  const branchScope = receivingScope(requestedScope) === 'branch';
  if (branchScope && !scope.canReceiveBranch && !scope.isAdmin) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับทั้งสาขา');
  if (branchScope && !scope.isAdmin && branchId != null && Number(branchId) !== scope.branchId) throw createReceivingError('FORBIDDEN', 'ไม่มีสิทธิ์รับต่างสาขา');
  const parsedBranchId = validatePositiveIntOrNull(branchId, 'branch_id');
  const parsedDeptId = validatePositiveIntOrNull(departmentId, 'department_id');

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  if (branchScope && !effectiveBranchId) throw createReceivingError('VALIDATION_FAILED', 'กรุณาเลือกสาขาสำหรับรับทั้งสาขา');
  const effectiveDepartmentId =
    branchScope ? null : scope.isAdmin
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

  whereSql += ' AND rd.receiving_scope = ?';
  params.push(branchScope ? 'branch' : 'department');

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

// A complete snapshot is committed once under the document row lock. Its original
// values survive all subsequent bill/receipt edits. Retry identity is the draft UUID.
export const saveBlindCount = async ({ user, documentId, body = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  const id = validatePositiveIntOrNull(documentId, 'id');
  if (!id) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสาร');
  const scope = await resolveActorScope(pool, user);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [docs] = await conn.query(`SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS} FROM receiving_documents rd WHERE rd.id = ? FOR UPDATE`, [id]);
    const doc = docs[0]; assertDocumentAccess(scope, doc);
    if (doc.status !== 'draft') throw createReceivingError('NOT_DRAFT', 'นับได้เฉพาะใบรับร่าง');
    if (!body.client_uuid || body.client_uuid !== doc.client_uuid) throw createReceivingError('VALIDATION_FAILED', 'ใช้ client_uuid เดิมของใบรับ');
    if (Array.isArray(body.lines) && body.lines.some(line => !line || typeof line !== 'object' || !/^\d+(?:\.\d{1,2})?$/.test(String(line.counted_quantity ?? '').trim()))) throw createReceivingError('VALIDATION_FAILED', 'จำนวนนับต้องเป็นตัวเลข 0 ขึ้นไปไม่เกินสองตำแหน่ง');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_OCR_LINES) throw createReceivingError('VALIDATION_FAILED', 'ต้องมีรายการนับ 1 ถึง 200 รายการ');
    if (!doc.counted_complete_at) {
      for (const input of body.lines.filter(line => line && !line.id)) {
        if (doc.receiving_scope === 'branch') throw createReceivingError('VALIDATION_FAILED', 'ใบสาขาต้องใช้รายการใบสั่งเดิม');
        if (input.unit_text != null && (typeof input.unit_text !== 'string' || input.unit_text.length > 100)) throw createReceivingError('VALIDATION_FAILED', 'ชื่อหน่วยต้องเป็นข้อความไม่เกิน 100 ตัวอักษร');
        const productId = validatePositiveIntOrNull(input.product_id, 'product_id');
        const [products] = await conn.query('SELECT id, name, unit_id FROM products WHERE id = ? LIMIT 1', [productId]);
        const product = products[0];
        if (!product) throw createReceivingError('VALIDATION_FAILED', 'ไม่พบสินค้า');
        const quantity = validateQuantityOrNull(input.counted_quantity, 'counted_quantity', { allowNull: false });
        if (input.counted_quantity == null || String(input.counted_quantity).trim() === '') throw createReceivingError('VALIDATION_FAILED', 'ต้องระบุจำนวนนับ');
        const [inserted] = await conn.query(`INSERT INTO receiving_document_lines (
          document_id, line_no, bill_text, product_id, product_name, order_item_id, unit, unit_text, unit_id,
          unit_multiplier, quantity_billed, quantity_received, unit_price, base_unit_price, amount,
          match_source, match_confidence, is_user_edited
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [id, body.lines.indexOf(input) + 1, '', product.id, product.name, null, input.unit_text || null,
          input.unit_text || null, product.unit_id || null, 1, null, quantity, null, null, null, 'manual', 1]);
        input.id = Number(inserted.insertId);
      }
    }
    const [rows] = await conn.query('SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC FOR UPDATE', [id]);
    const groups = doc.receiving_scope === 'branch' ? branchLineGroups(rows) : rows.map(row => [row]);
    if (!groups.length || !Array.isArray(body.lines) || body.lines.length !== groups.length) throw createReceivingError('VALIDATION_FAILED', 'ต้องนับครบทุกสินค้า');
    const seen = new Set();
    const patches = groups.flatMap(parts => {
      const input = body.lines.find(line => line && (Number(line.id) === Number(parts[0].id) || (!line.id && !parts[0].order_item_id && Number(line.product_id) === Number(parts[0].product_id))));
      if (!input || seen.has(Number(parts[0].id))) throw createReceivingError('VALIDATION_FAILED', 'รายการนับไม่ครบหรือซ้ำ');
      seen.add(Number(parts[0].id));
      if (input.counted_quantity == null || String(input.counted_quantity).trim() === '') throw createReceivingError('VALIDATION_FAILED', 'ไม่มีของให้กรอก 0 อย่างตั้งใจ');
      const quantity = validateQuantityOrNull(input.counted_quantity, 'counted_quantity', { allowNull: false });
      const values = parts.length > 1 ? allocateBranchQuantity(quantity, parts) : [quantity];
      return parts.map((part, i) => ({ part, value: values[i] }));
    });
    if (doc.counted_complete_at) {
      if (patches.some(({ part, value }) => formatQuantity(value) !== formatQuantity(part.counted_quantity))) throw createReceivingError('NOT_DRAFT', 'เปิดบิลแล้ว ใช้การแก้จำนวนหลังเปิดบิลแทนการนับใหม่');
    } else {
      for (const { part, value } of patches) await conn.query(`UPDATE receiving_document_lines SET counted_quantity = ?, counted_at = UTC_TIMESTAMP(), counted_by = ?, quantity_received = ?, remember_alias = false WHERE id = ? AND document_id = ?`, [value, scope.userId, value, part.id, id]);
      // The explicit count also acknowledges that this receipt has no supplier bill.
      // Keep the original physical count and the missing-bill accounting followup.
      if (doc.kind === 'manual_receipt') for (const { part } of patches) await conn.query(
        'UPDATE receiving_document_lines SET review_decision = ? WHERE id = ? AND document_id = ?', ['missing_bill', part.id, id]);
      await conn.query('UPDATE receiving_documents SET counted_complete_at = UTC_TIMESTAMP(), count_client_uuid = ? WHERE id = ?', [body.client_uuid, id]);
      await recordAuditLog(conn, { documentId: id, action: 'blind_count', actorUserId: scope.userId, actorName: scope.userName,
        details: { lines: patches.map(({ part, value }) => ({ id: part.id, counted_quantity: value })) } });
    }
    await conn.commit();
    return loadDocumentBundleById(pool, id, { includeLines: true });
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
};
