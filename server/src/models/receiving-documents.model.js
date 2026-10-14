import pool from '../config/database.js';
import { getBangkokDateKey, isDateKey, toBangkokDateKey } from '../utils/bangkok-date.js';
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
import {
  MAX_OCR_LINES,
  computeBaseUnitPrice,
  createReceivingError,
  formatQuantity,
  fromSatangInt,
  normalizeBillDate,
  toFiniteNumberOrNull,
  toMilliQtyInt,
  toSatangInt,
  validateMoneyOrNull,
  validatePositiveIntOrNull,
  validateQuantityOrNull,
  validateUnitPriceOrNull
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
  uploadDocumentImage,
  voidReceivingDocument
};

// 1. GET /expected?date=YYYY-MM-DD
export const getExpectedItems = async ({
  user,
  date,
  branchId = null,
  departmentId = null
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const targetDate = date ? String(date).trim() : getBangkokDateKey();
  if (!isDateKey(targetDate)) {
    throw createReceivingError('VALIDATION_FAILED', 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  }

  const scope = await resolveActorScope(pool, user);
  const parsedBranchId = validatePositiveIntOrNull(branchId, 'branch_id');
  const parsedDeptId = validatePositiveIntOrNull(departmentId, 'department_id');
  if (scope.isAdmin && parsedBranchId && parsedDeptId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: parsedBranchId,
      departmentId: parsedDeptId
    });
  }

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin && parsedDeptId ? parsedDeptId : scope.departmentId;

  if (!scope.isAdmin && (!effectiveBranchId || !effectiveDepartmentId)) {
    throw createReceivingError('FORBIDDEN', 'ไม่พบข้อมูลสาขาหรือแผนกของผู้ใช้งาน');
  }

  const rows = await fetchExpectedOrderItemsFlat(pool, {
    date: targetDate,
    branchId: effectiveBranchId,
    departmentId: effectiveDepartmentId
  });

  const groupsMap = new Map();
  for (const row of rows) {
    const pgId = row.product_group_id ? Number(row.product_group_id) : null;
    const supplierKey = pgId ? `pg:${pgId}` : 'none';
    const supplierName = String(row.product_group_name || 'ไม่ระบุซัพพลายเออร์').trim();

    if (!groupsMap.has(supplierKey)) {
      groupsMap.set(supplierKey, {
        supplier_key: supplierKey,
        supplier_name: supplierName,
        items: []
      });
    }

    groupsMap.get(supplierKey).items.push({
      order_item_id: Number(row.order_item_id),
      product_id: Number(row.product_id),
      product_name: String(row.product_name || ''),
      unit_name: row.unit_name ? String(row.unit_name) : null,
      quantity_ordered: formatQuantity(row.quantity_ordered ?? 0, { allowNull: false }),
      received_quantity: formatQuantity(row.received_quantity, { allowNull: true }),
      is_received: Boolean(row.is_received)
    });
  }

  return Array.from(groupsMap.values());
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
  if (scope.isAdmin && adminBranchId && adminDeptId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: adminBranchId,
      departmentId: adminDeptId
    });
  }

  const targetBranchId = scope.isAdmin && adminBranchId ? adminBranchId : scope.branchId;
  const targetDepartmentId = scope.isAdmin && adminDeptId ? adminDeptId : scope.departmentId;

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
        const qtyOrdered = toFiniteNumberOrNull(item.quantity_ordered) ?? 0;
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
  if (scope.isAdmin && parsedBranchId && parsedDeptId) {
    await validateBranchDepartmentConsistency(pool, {
      branchId: parsedBranchId,
      departmentId: parsedDeptId
    });
  }

  const params = [];
  let whereSql = 'WHERE 1=1';

  const effectiveBranchId = scope.isAdmin && parsedBranchId ? parsedBranchId : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin && parsedDeptId ? parsedDeptId : scope.departmentId;

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

// 6. PUT /:id
export const updateReceivingDocument = async ({ user, documentId, body = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  if (Array.isArray(body.lines) && body.lines.length > MAX_OCR_LINES) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      `จำนวนบรรทัดรายการเกินกำหนด (สูงสุด ${MAX_OCR_LINES} รายการ)`
    );
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS} FROM receiving_documents rd WHERE rd.id = ? FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);

    if (doc.status !== 'draft') {
      throw createReceivingError('NOT_DRAFT', 'แก้ไขได้เฉพาะเอกสารที่อยู่ในสถานะร่าง (draft) เท่านั้น');
    }

    const nextKind = body.kind !== undefined ? String(body.kind).trim() : doc.kind;
    if (!['bill', 'manual_receipt'].includes(nextKind)) {
      throw createReceivingError('VALIDATION_FAILED', 'ชนิดเอกสาร (kind) ไม่ถูกต้อง');
    }

    const nextDeliveryDate =
      body.delivery_date !== undefined
        ? normalizeBillDate(body.delivery_date)
        : toBangkokDateKey(doc.delivery_date);
    if (!nextDeliveryDate) {
      throw createReceivingError('VALIDATION_FAILED', 'วันที่รับของ (delivery_date) ไม่ถูกต้อง');
    }

    let nextDocDate = doc.doc_date ? toBangkokDateKey(doc.doc_date) : null;
    if (body.doc_date !== undefined) {
      if (body.doc_date === null || body.doc_date === '') {
        nextDocDate = null;
      } else {
        nextDocDate = normalizeBillDate(body.doc_date);
        if (!nextDocDate) {
          throw createReceivingError('VALIDATION_FAILED', 'วันที่ในบิล (doc_date) ไม่ถูกต้อง');
        }
      }
    }

    const nextSupplierMasterId =
      body.supplier_master_id !== undefined
        ? validatePositiveIntOrNull(body.supplier_master_id, 'supplier_master_id')
        : doc.supplier_master_id;
    const nextProductGroupId =
      body.product_group_id !== undefined
        ? validatePositiveIntOrNull(body.product_group_id, 'product_group_id')
        : doc.product_group_id;

    if (
      body.supplier_name_text !== undefined &&
      String(body.supplier_name_text || '').trim().length > 255
    ) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        'ชื่อซัพพลายเออร์ (supplier_name_text) ยาวเกิน 255 ตัวอักษร'
      );
    }
    const nextSupplierNameText =
      body.supplier_name_text !== undefined
        ? String(body.supplier_name_text || '').trim()
        : String(doc.supplier_name_text || '');

    if (body.doc_ref !== undefined && String(body.doc_ref || '').trim().length > 100) {
      throw createReceivingError('VALIDATION_FAILED', 'เลขที่บิล (doc_ref) ยาวเกิน 100 ตัวอักษร');
    }
    const nextDocRef =
      body.doc_ref !== undefined
        ? body.doc_ref === null || String(body.doc_ref).trim() === ''
          ? null
          : String(body.doc_ref).trim()
        : doc.doc_ref;

    const nextCourierName =
      body.courier_name !== undefined
        ? body.courier_name === null || String(body.courier_name).trim() === ''
          ? null
          : String(body.courier_name).trim().slice(0, 255)
        : doc.courier_name;

    const nextSubtotal =
      body.subtotal !== undefined
        ? validateMoneyOrNull(body.subtotal, 'subtotal')
        : toFiniteNumberOrNull(doc.subtotal);
    const nextDiscount =
      body.discount !== undefined
        ? validateMoneyOrNull(body.discount, 'discount')
        : toFiniteNumberOrNull(doc.discount);
    const nextVat =
      body.vat !== undefined
        ? validateMoneyOrNull(body.vat, 'vat')
        : toFiniteNumberOrNull(doc.vat);
    const nextTotal =
      body.total !== undefined
        ? validateMoneyOrNull(body.total, 'total')
        : toFiniteNumberOrNull(doc.total);

    const headerEdited =
      Boolean(doc.is_header_edited) ||
      body.doc_ref !== undefined ||
      body.doc_date !== undefined ||
      body.subtotal !== undefined ||
      body.discount !== undefined ||
      body.vat !== undefined ||
      body.total !== undefined ||
      body.supplier_name_text !== undefined;

    await connection.query(
      `UPDATE receiving_documents
       SET kind = ?, supplier_master_id = ?, product_group_id = ?, supplier_name_text = ?,
           delivery_date = ?, doc_ref = ?, doc_date = ?, subtotal = ?, discount = ?,
           vat = ?, total = ?, is_header_edited = ?, courier_name = ?
       WHERE id = ?`,
      [
        nextKind,
        nextSupplierMasterId,
        nextProductGroupId,
        nextSupplierNameText,
        nextDeliveryDate,
        nextDocRef,
        nextDocDate,
        nextSubtotal,
        nextDiscount,
        nextVat,
        nextTotal,
        headerEdited,
        nextCourierName,
        docId
      ]
    );

    if (Array.isArray(body.deleted_line_ids) && body.deleted_line_ids.length > 0) {
      const delIds = body.deleted_line_ids
        .map((id) => validatePositiveIntOrNull(id, 'deleted_line_id'))
        .filter(Boolean);
      if (delIds.length > 0) {
        await connection.query(
          `DELETE FROM receiving_document_lines
           WHERE document_id = ? AND id IN (${delIds.map(() => '?').join(', ')})`,
          [docId, ...delIds]
        );
      }
    }

    if (Array.isArray(body.lines)) {
      const [existingLineRows] = await connection.query(
        `SELECT * FROM receiving_document_lines WHERE document_id = ? FOR UPDATE`,
        [docId]
      );
      const existingById = new Map((existingLineRows || []).map((r) => [Number(r.id), r]));

      const normalizedInputLines = body.lines.map((line, idx) => {
        if (!line || typeof line !== 'object') {
          throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลรายการสินค้า (lines) ไม่ถูกต้อง');
        }
        const existing = line.id ? existingById.get(Number(line.id)) : null;
        const productId =
          line.product_id !== undefined
            ? validatePositiveIntOrNull(line.product_id, 'product_id')
            : existing?.product_id ?? null;
        const orderItemId =
          line.order_item_id !== undefined
            ? validatePositiveIntOrNull(line.order_item_id, 'order_item_id')
            : existing?.order_item_id ?? null;
        return { raw: line, existing, idx, product_id: productId, order_item_id: orderItemId };
      });

      await validateScopedOrderItemsForDocument(connection, {
        branchId: Number(doc.branch_id),
        departmentId: Number(doc.department_id),
        lines: normalizedInputLines
      });

      for (const item of normalizedInputLines) {
        const { raw: line, existing, idx, product_id: productId, order_item_id: orderItemId } = item;
        const lineNo =
          Number.isFinite(Number(line.line_no)) && Number(line.line_no) > 0
            ? Math.trunc(Number(line.line_no))
            : existing?.line_no ?? idx + 1;

        const rawBillText =
          line.bill_text !== undefined
            ? String(line.bill_text ?? '').trim()
            : String(existing?.bill_text ?? line.product_name ?? '').trim();
        if (rawBillText.length > 500) {
          throw createReceivingError('VALIDATION_FAILED', 'ข้อความรายการ (bill_text) ยาวเกิน 500 ตัวอักษร');
        }
        const billText = rawBillText;

        let productName =
          line.product_name !== undefined
            ? line.product_name === null
              ? null
              : String(line.product_name).trim().slice(0, 255) || null
            : existing?.product_name ?? null;

        if (productId && !productName) {
          const [pRows] = await connection.query(`SELECT name FROM products WHERE id = ? LIMIT 1`, [
            productId
          ]);
          if (Array.isArray(pRows) && pRows[0]?.name) {
            productName = String(pRows[0].name).slice(0, 255);
          }
        }

        const rawUnitText =
          line.unit_text !== undefined
            ? line.unit_text === null
              ? ''
              : String(line.unit_text).trim()
            : String(existing?.unit_text ?? existing?.unit ?? '').trim();
        if (rawUnitText.length > 100) {
          throw createReceivingError('VALIDATION_FAILED', 'ชื่อหน่วย (unit_text) ยาวเกิน 100 ตัวอักษร');
        }
        const unitText = rawUnitText || null;

        const unitId =
          line.unit_id !== undefined
            ? validatePositiveIntOrNull(line.unit_id, 'unit_id')
            : existing?.unit_id ?? null;

        const qtyBilled =
          line.quantity_billed !== undefined
            ? validateQuantityOrNull(line.quantity_billed, 'quantity_billed', { allowNull: true })
            : toFiniteNumberOrNull(existing?.quantity_billed);

        const qtyReceived =
          line.quantity_received !== undefined
            ? validateQuantityOrNull(line.quantity_received, 'quantity_received', { allowNull: false })
            : toFiniteNumberOrNull(existing?.quantity_received) ?? 0;

        const unitPrice =
          line.unit_price !== undefined
            ? validateUnitPriceOrNull(line.unit_price, 'unit_price')
            : toFiniteNumberOrNull(existing?.unit_price);

        let amount =
          line.amount !== undefined
            ? validateMoneyOrNull(line.amount, 'amount')
            : toFiniteNumberOrNull(existing?.amount);
        if (amount === null && unitPrice !== null) {
          const baseQty = qtyBilled !== null ? qtyBilled : qtyReceived;
          amount = fromSatangInt(toSatangInt(baseQty * unitPrice));
        }

        const unitMultiplier =
          toFiniteNumberOrNull(line.unit_multiplier ?? existing?.unit_multiplier) ?? 1;
        const baseUnitPrice = computeBaseUnitPrice({
          unitPrice,
          amount,
          quantityBilled: qtyBilled,
          quantityReceived: qtyReceived,
          unitMultiplier
        });

        const matchSourceCandidate = String(line.match?.source || '').trim();
        const matchSource = ['alias', 'order', 'manual', 'none'].includes(matchSourceCandidate)
          ? matchSourceCandidate
          : existing?.match_source || (productId ? 'manual' : 'none');
        const matchConfidence =
          line.match?.confidence !== undefined && line.match?.confidence !== null
            ? toFiniteNumberOrNull(line.match.confidence)
            : existing?.match_confidence ?? (matchSource === 'manual' ? 1 : null);

        if (existing) {
          const didChange =
            Boolean(existing.is_user_edited) ||
            billText !== String(existing.bill_text || '') ||
            Number(productId || 0) !== Number(existing.product_id || 0) ||
            Number(orderItemId || 0) !== Number(existing.order_item_id || 0) ||
            toMilliQtyInt(qtyBilled) !== toMilliQtyInt(existing.quantity_billed) ||
            toMilliQtyInt(qtyReceived) !== toMilliQtyInt(existing.quantity_received) ||
            toSatangInt(unitPrice) !== toSatangInt(existing.unit_price) ||
            toSatangInt(amount) !== toSatangInt(existing.amount);

          await connection.query(
            `UPDATE receiving_document_lines
             SET line_no = ?, bill_text = ?, product_id = ?, product_name = ?, order_item_id = ?,
                 unit = ?, unit_text = ?, unit_id = ?, unit_multiplier = ?,
                 quantity_billed = ?, quantity_received = ?, unit_price = ?, base_unit_price = ?,
                 amount = ?, match_source = ?, match_confidence = ?, is_user_edited = ?
             WHERE id = ? AND document_id = ?`,
            [
              lineNo,
              billText,
              productId,
              productName,
              orderItemId,
              unitText,
              unitText,
              unitId,
              unitMultiplier,
              qtyBilled,
              qtyReceived,
              unitPrice,
              baseUnitPrice,
              amount,
              matchSource,
              matchConfidence,
              didChange,
              Number(existing.id),
              docId
            ]
          );
        } else {
          await connection.query(
            `INSERT INTO receiving_document_lines (
               document_id, line_no, bill_text, product_id, product_name,
               order_item_id, unit, unit_text, unit_id, unit_multiplier,
               quantity_billed, quantity_received, unit_price, base_unit_price, amount,
               match_source, match_confidence, is_user_edited
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
            [
              docId,
              lineNo,
              billText,
              productId,
              productName,
              orderItemId,
              unitText,
              unitText,
              unitId,
              unitMultiplier,
              qtyBilled,
              qtyReceived,
              unitPrice,
              baseUnitPrice,
              amount,
              matchSource,
              matchConfidence
            ]
          );
        }
      }
    }

    const [updatedLines] = await connection.query(
      `SELECT * FROM receiving_document_lines WHERE document_id = ? ORDER BY line_no ASC, id ASC`,
      [docId]
    );

    await recalculateAndPersistWarnings(
      connection,
      {
        ...doc,
        id: docId,
        kind: nextKind,
        supplier_master_id: nextSupplierMasterId,
        product_group_id: nextProductGroupId,
        supplier_name_text: nextSupplierNameText,
        delivery_date: nextDeliveryDate,
        doc_ref: nextDocRef,
        doc_date: nextDocDate,
        subtotal: nextSubtotal,
        discount: nextDiscount,
        vat: nextVat,
        total: nextTotal,
        courier_name: nextCourierName
      },
      updatedLines
    );

    await recordAuditLog(connection, {
      documentId: docId,
      action: 'update',
      actorUserId: scope.userId,
      actorName: scope.userName,
      details: {
        updated_lines_count: Array.isArray(body.lines) ? body.lines.length : 0,
        deleted_line_ids: body.deleted_line_ids || []
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
