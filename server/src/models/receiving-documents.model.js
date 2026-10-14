import pool from '../config/database.js';
import { getBangkokDateKey, isDateKey, toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureInventoryTables } from './inventory.model.js';
import { ensureOrderReceivingColumns } from './order.model.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import {
  buildSupplierKey,
  computeDocumentWarnings,
  createReceivingError,
  extractBillWithVision,
  formatMoney,
  formatQuantity,
  matchOcrLinesToCatalog,
  mergeOcrLinesPreservingUserEdits,
  normalizeBillDate,
  normalizeMatchText,
  parseImageDataUrl,
  toFiniteNumberOrNull
} from '../services/receiving-ocr.service.js';

const parseJsonArraySafe = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const toIsoTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const str = String(value).trim();
  return str || null;
};

export const isAdminUser = (user) =>
  ['admin', 'super_admin'].includes(String(user?.role || '').trim());

export const resolveActorScope = async (db, user = {}) => {
  const userId = Number(user?.id);
  let branchId = Number(user?.branch_id);
  let departmentId = Number(user?.department_id);
  let userName = String(user?.name || user?.username || '').trim();

  if (
    (!Number.isFinite(branchId) || branchId <= 0 || !Number.isFinite(departmentId) || departmentId <= 0 || !userName) &&
    Number.isFinite(userId) &&
    userId > 0
  ) {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.department_id, d.branch_id
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ?
       LIMIT 1`,
      [userId]
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      if (!Number.isFinite(branchId) || branchId <= 0) {
        branchId = Number(row.branch_id);
      }
      if (!Number.isFinite(departmentId) || departmentId <= 0) {
        departmentId = Number(row.department_id);
      }
      if (!userName && row.name) {
        userName = String(row.name).trim();
      }
    }
  }

  return {
    userId: Number.isFinite(userId) && userId > 0 ? Math.trunc(userId) : null,
    branchId: Number.isFinite(branchId) && branchId > 0 ? Math.trunc(branchId) : null,
    departmentId: Number.isFinite(departmentId) && departmentId > 0 ? Math.trunc(departmentId) : null,
    userName: userName || 'ผู้รับสินค้า',
    isAdmin: isAdminUser(user)
  };
};

export const assertDocumentAccess = (scope, doc) => {
  if (!doc) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }
  if (scope.isAdmin) return;
  if (
    !scope.branchId ||
    !scope.departmentId ||
    Number(doc.branch_id) !== Number(scope.branchId) ||
    Number(doc.department_id) !== Number(scope.departmentId)
  ) {
    throw createReceivingError(
      'FORBIDDEN',
      'ไม่มีสิทธิ์เข้าถึงเอกสารของสาขาหรือแผนกอื่น'
    );
  }
};

export const mapReceivingLineRow = (row) => ({
  id: Number(row.id),
  line_no: Number(row.line_no),
  bill_text: String(row.bill_text || ''),
  product_id: row.product_id !== null && row.product_id !== undefined ? Number(row.product_id) : null,
  product_name: row.product_name ?? null,
  order_item_id:
    row.order_item_id !== null && row.order_item_id !== undefined ? Number(row.order_item_id) : null,
  unit_text: (row.unit_text ?? row.unit) || null,
  unit_id: row.unit_id !== null && row.unit_id !== undefined ? Number(row.unit_id) : null,
  quantity_billed: formatQuantity(row.quantity_billed, { allowNull: true }),
  quantity_received: formatQuantity(row.quantity_received ?? 0, { allowNull: false }),
  unit_price: formatMoney(row.unit_price),
  amount: formatMoney(row.amount),
  match: {
    source: row.match_source || row.match?.source || 'none',
    confidence:
      row.match_confidence !== null && row.match_confidence !== undefined
        ? Number(row.match_confidence)
        : row.match?.confidence !== null && row.match?.confidence !== undefined
          ? Number(row.match.confidence)
          : null
  }
});

export const mapReceivingImageRow = (row) => ({
  id: Number(row.id),
  page_no: Number(row.page_no),
  mime: row.mime_type || row.mime || 'image/jpeg',
  width: row.width !== null && row.width !== undefined ? Number(row.width) : null,
  height: row.height !== null && row.height !== undefined ? Number(row.height) : null
});

export const mapReceivingDocumentRow = (
  row,
  { images = [], lines = [], includeLines = true } = {}
) => {
  const warnings = parseJsonArraySafe(row.warnings_json);
  const ocrWarnings = parseJsonArraySafe(row.ocr_warnings_json);
  const doc = {
    id: Number(row.id),
    status: row.status || 'draft',
    branch_id: Number(row.branch_id),
    department_id: Number(row.department_id),
    supplier_master_id:
      row.supplier_master_id !== null && row.supplier_master_id !== undefined
        ? Number(row.supplier_master_id)
        : null,
    product_group_id:
      row.product_group_id !== null && row.product_group_id !== undefined
        ? Number(row.product_group_id)
        : null,
    supplier_name_text: String(row.supplier_name_text || ''),
    delivery_date: toBangkokDateKey(row.delivery_date) || String(row.delivery_date || ''),
    doc_ref: row.doc_ref ?? null,
    doc_date: row.doc_date ? toBangkokDateKey(row.doc_date) || String(row.doc_date) : null,
    kind: row.kind || 'bill',
    subtotal: formatMoney(row.subtotal),
    discount: formatMoney(row.discount),
    vat: formatMoney(row.vat),
    total: formatMoney(row.total),
    ocr: {
      status: row.ocr_status || 'none',
      model: row.ocr_model ?? null,
      confidence:
        row.ocr_confidence !== null && row.ocr_confidence !== undefined
          ? Number(row.ocr_confidence)
          : null,
      warnings: ocrWarnings
    },
    receiver_user_id: Number(row.receiver_user_id),
    receiver_name: String(row.receiver_name || ''),
    courier_name: row.courier_name ?? null,
    has_receiver_signature: Boolean(
      row.has_receiver_signature ??
        (row.receiver_signature && row.receiver_signature.length > 0)
    ),
    has_courier_signature: Boolean(
      row.has_courier_signature ??
        (row.courier_signature && row.courier_signature.length > 0)
    ),
    images: images.map(mapReceivingImageRow),
    ...(includeLines ? { lines: lines.map(mapReceivingLineRow) } : {}),
    warnings,
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
    confirmed_at: row.confirmed_at ? toIsoTimestamp(row.confirmed_at) : null,
    client_uuid: String(row.client_uuid || '')
  };

  return doc;
};

const recordAuditLog = async (
  db,
  { documentId, action, actorUserId = null, actorName = null, details = null }
) => {
  const detailsJson = details !== null && details !== undefined ? JSON.stringify(details) : null;
  await db.query(
    `INSERT INTO receiving_document_audits
       (document_id, action, actor_user_id, actor_name, details_json)
     VALUES (?, ?, ?, ?, ?)`,
    [documentId, action, actorUserId, actorName, detailsJson]
  );
};

const fetchExpectedOrderItemsFlat = async (
  db,
  { date, branchId, departmentId, orderItemIds = null }
) => {
  const params = [];
  let whereSql = `WHERE o.status IN ('submitted', 'confirmed', 'completed')`;

  if (date) {
    whereSql += ` AND o.order_date = ?`;
    params.push(date);
  }
  if (branchId) {
    whereSql += ` AND b.id = ?`;
    params.push(Number(branchId));
  }
  if (departmentId) {
    whereSql += ` AND d.id = ?`;
    params.push(Number(departmentId));
  }
  if (Array.isArray(orderItemIds) && orderItemIds.length > 0) {
    whereSql += ` AND oi.id IN (${orderItemIds.map(() => '?').join(', ')})`;
    params.push(...orderItemIds.map((id) => Number(id)));
  }

  const [rows] = await db.query(
    `SELECT
       oi.id AS order_item_id,
       oi.product_id,
       CASE
         WHEN COALESCE(oi.quantity, 0) <= 0 AND COALESCE(oi.received_quantity, 0) > 0
           THEN COALESCE(oi.received_quantity, 0)
         ELSE COALESCE(oi.quantity, 0)
       END AS quantity_ordered,
       oi.received_quantity,
       COALESCE(oi.is_received, false) AS is_received,
       oi.requested_price,
       oi.actual_price,
       p.name AS product_name,
       p.default_price,
       u.id AS unit_id,
       COALESCE(u.name, u.abbreviation, '') AS unit_name,
       pg.id AS product_group_id,
       pg.name AS product_group_name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN product_groups pg ON pg.id = COALESCE(oi.source_product_group_id, p.product_group_id)
     ${whereSql}
     ORDER BY pg.name, p.name, oi.id`,
    params
  );

  return Array.isArray(rows) ? rows : [];
};

const fetchLatestPricesByProductIds = async (db, productIds = []) => {
  const validIds = Array.from(
    new Set(
      (productIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
  const priceMap = new Map();
  if (validIds.length === 0) return priceMap;

  const placeholders = validIds.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT
       p.id AS product_id,
       COALESCE(
         (
           SELECT oi.actual_price
           FROM order_items oi
           WHERE oi.product_id = p.id
             AND oi.actual_price IS NOT NULL
             AND oi.actual_price > 0
           ORDER BY oi.received_at DESC, oi.id DESC
           LIMIT 1
         ),
         (
           SELECT spa.last_unit_price
           FROM supplier_product_aliases spa
           WHERE spa.product_id = p.id
             AND spa.last_unit_price IS NOT NULL
             AND spa.last_unit_price > 0
           ORDER BY spa.updated_at DESC, spa.id DESC
           LIMIT 1
         ),
         p.default_price
       ) AS ref_price
     FROM products p
     WHERE p.id IN (${placeholders})`,
    validIds
  );

  for (const row of rows || []) {
    const refPrice = toFiniteNumberOrNull(row.ref_price);
    if (refPrice !== null && refPrice > 0) {
      priceMap.set(Number(row.product_id), refPrice);
    }
  }

  return priceMap;
};

const checkDuplicateBillInDb = async (db, doc) => {
  const docRef = String(doc.doc_ref || '').trim();
  const total = toFiniteNumberOrNull(doc.total);
  if (!docRef || total === null) return false;

  const params = [Number(doc.id || 0), docRef, total];
  let supplierClause = '';

  if (doc.supplier_master_id) {
    supplierClause = 'AND supplier_master_id = ?';
    params.push(Number(doc.supplier_master_id));
  } else if (doc.product_group_id) {
    supplierClause = 'AND product_group_id = ?';
    params.push(Number(doc.product_group_id));
  } else if (String(doc.supplier_name_text || '').trim()) {
    supplierClause = 'AND LOWER(TRIM(supplier_name_text)) = LOWER(TRIM(?))';
    params.push(String(doc.supplier_name_text).trim());
  }

  const [rows] = await db.query(
    `SELECT id
     FROM receiving_documents
     WHERE id <> ?
       AND status <> 'void'
       AND TRIM(doc_ref) = ?
       AND ABS(COALESCE(total, 0) - ?) < 0.01
       ${supplierClause}
     LIMIT 1`,
    params
  );

  return Array.isArray(rows) && rows.length > 0;
};

const recalculateAndPersistWarnings = async (db, documentRow, lines = []) => {
  const orderItemIds = lines
    .map((line) => Number(line.order_item_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const productIds = lines
    .map((line) => Number(line.product_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const expectedItemsById = new Map();
  if (orderItemIds.length > 0) {
    const expectedRows = await fetchExpectedOrderItemsFlat(db, {
      orderItemIds
    });
    for (const row of expectedRows) {
      expectedItemsById.set(Number(row.order_item_id), row);
      if (
        row.product_id &&
        (row.actual_price || row.requested_price || row.default_price)
      ) {
        // Fallback reference price from order item if needed
        const fallbackPrice = toFiniteNumberOrNull(
          row.actual_price ?? row.requested_price ?? row.default_price
        );
        if (fallbackPrice !== null && fallbackPrice > 0) {
          expectedItemsById.set(`price:${row.product_id}`, fallbackPrice);
        }
      }
    }
  }

  const latestPricesByProductId = await fetchLatestPricesByProductIds(db, productIds);
  for (const pid of productIds) {
    if (!latestPricesByProductId.has(pid) && expectedItemsById.has(`price:${pid}`)) {
      latestPricesByProductId.set(pid, expectedItemsById.get(`price:${pid}`));
    }
  }

  const isDuplicateBill = await checkDuplicateBillInDb(db, documentRow);

  const { warnings, warningCodes } = computeDocumentWarnings({
    document: documentRow,
    lines,
    expectedItemsById,
    latestPricesByProductId,
    isDuplicateBill
  });

  const warningsJson = JSON.stringify(warnings);
  const ocrWarningsJson =
    documentRow.ocr_status === 'done'
      ? JSON.stringify(warningCodes)
      : documentRow.ocr_warnings_json || JSON.stringify([]);

  await db.query(
    `UPDATE receiving_documents
     SET warnings_json = ?, ocr_warnings_json = ?
     WHERE id = ?`,
    [warningsJson, ocrWarningsJson, documentRow.id]
  );

  documentRow.warnings_json = warningsJson;
  documentRow.ocr_warnings_json = ocrWarningsJson;
  return { warnings, warningCodes };
};

const loadDocumentBundleById = async (db, documentId, { includeLines = true } = {}) => {
  const [docRows] = await db.query(
    `SELECT
       rd.*,
       (rd.receiver_signature IS NOT NULL AND OCTET_LENGTH(rd.receiver_signature) > 0) AS has_receiver_signature,
       (rd.courier_signature IS NOT NULL AND OCTET_LENGTH(rd.courier_signature) > 0) AS has_courier_signature
     FROM receiving_documents rd
     WHERE rd.id = ?
     LIMIT 1`,
    [documentId]
  );

  if (!Array.isArray(docRows) || docRows.length === 0) {
    return null;
  }

  const docRow = docRows[0];

  const [imageRows] = await db.query(
    `SELECT id, document_id, page_no, mime_type, width, height, size_bytes, sha256, created_at
     FROM receiving_document_images
     WHERE document_id = ?
     ORDER BY page_no ASC, id ASC`,
    [documentId]
  );

  let lineRows = [];
  if (includeLines) {
    const [rows] = await db.query(
      `SELECT *
       FROM receiving_document_lines
       WHERE document_id = ?
       ORDER BY line_no ASC, id ASC`,
      [documentId]
    );
    lineRows = Array.isArray(rows) ? rows : [];
  }

  return mapReceivingDocumentRow(docRow, {
    images: Array.isArray(imageRows) ? imageRows : [],
    lines: lineRows,
    includeLines
  });
};

// ============================================================================
// 1. GET /expected?date=YYYY-MM-DD
// ============================================================================
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
    throw createReceivingError(
      'VALIDATION_FAILED',
      'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)'
    );
  }

  const scope = await resolveActorScope(pool, user);
  const effectiveBranchId = scope.isAdmin && branchId ? Number(branchId) : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin && departmentId ? Number(departmentId) : scope.departmentId;

  if (!scope.isAdmin && (!effectiveBranchId || !effectiveDepartmentId)) {
    throw createReceivingError(
      'FORBIDDEN',
      'ไม่พบข้อมูลสาขาหรือแผนกของผู้ใช้งาน'
    );
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

// ============================================================================
// 2. POST / (Create draft receiving document, idempotent by client_uuid)
// ============================================================================
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
  const targetBranchId =
    scope.isAdmin && body.branch_id ? Number(body.branch_id) : scope.branchId;
  const targetDepartmentId =
    scope.isAdmin && body.department_id ? Number(body.department_id) : scope.departmentId;

  if (!targetBranchId || !targetDepartmentId || !scope.userId) {
    throw createReceivingError(
      'FORBIDDEN',
      'ไม่พบสิทธิ์สาขาหรือแผนกสำหรับสร้างเอกสารรับสินค้า'
    );
  }

  // ตรวจสอบ client_uuid ซ้ำ (Idempotent สำหรับคิวออฟไลน์)
  const [existingRows] = await pool.query(
    `SELECT id, branch_id, department_id
     FROM receiving_documents
     WHERE client_uuid = ?
     LIMIT 1`,
    [clientUuid]
  );

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    const existing = existingRows[0];
    assertDocumentAccess(scope, existing);
    const doc = await loadDocumentBundleById(pool, existing.id, { includeLines: true });
    return { document: doc, created: false };
  }

  const supplierMasterId =
    body.supplier_master_id !== null &&
    body.supplier_master_id !== undefined &&
    body.supplier_master_id !== ''
      ? Number(body.supplier_master_id)
      : null;
  const productGroupId =
    body.product_group_id !== null &&
    body.product_group_id !== undefined &&
    body.product_group_id !== ''
      ? Number(body.product_group_id)
      : null;

  let supplierNameText = String(body.supplier_name_text || '').trim();
  if (!supplierNameText && supplierMasterId) {
    const [smRows] = await pool.query(
      `SELECT name FROM supplier_masters WHERE id = ? LIMIT 1`,
      [supplierMasterId]
    );
    if (Array.isArray(smRows) && smRows[0]?.name) {
      supplierNameText = String(smRows[0].name).trim();
    }
  }
  if (!supplierNameText && productGroupId) {
    const [pgRows] = await pool.query(
      `SELECT name FROM product_groups WHERE id = ? LIMIT 1`,
      [productGroupId]
    );
    if (Array.isArray(pgRows) && pgRows[0]?.name) {
      supplierNameText = String(pgRows[0].name).trim();
    }
  }

  const orderItemIds = Array.isArray(body.order_item_ids)
    ? Array.from(
        new Set(
          body.order_item_ids
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        )
      )
    : [];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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
          unitPrice !== null
            ? Math.round((qtyOrdered * unitPrice + Number.EPSILON) * 100) / 100
            : null;

        const [lineRes] = await connection.query(
          `INSERT INTO receiving_document_lines (
             document_id, line_no, bill_text, product_id, product_name,
             order_item_id, unit, unit_text, unit_id,
             quantity_billed, quantity_received, unit_price, amount,
             match_source, match_confidence, is_user_edited
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'order', 1.0000, false)`,
          [
            documentId,
            lineNo,
            String(item.product_name || ''),
            Number(item.product_id),
            String(item.product_name || ''),
            Number(item.order_item_id),
            item.unit_name || null,
            item.unit_name || null,
            item.unit_id ? Number(item.unit_id) : null,
            null,
            qtyOrdered,
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
          quantity_billed: null,
          quantity_received: qtyOrdered,
          unit_price: unitPrice,
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
        `SELECT id, branch_id, department_id
         FROM receiving_documents
         WHERE client_uuid = ?
         LIMIT 1`,
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

// ============================================================================
// 3. POST /:id/images
// ============================================================================
export const uploadDocumentImage = async ({
  user,
  documentId,
  pageNo,
  imageDataUrl
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = Number(documentId);
  const parsedPageNo = Number(pageNo);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw createReceivingError('VALIDATION_FAILED', 'รหัสเอกสารไม่ถูกต้อง');
  }
  if (!Number.isInteger(parsedPageNo) || parsedPageNo <= 0 || parsedPageNo > 50) {
    throw createReceivingError('VALIDATION_FAILED', 'เลขหน้า (page_no) ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  }

  const parsedImage = parseImageDataUrl(imageDataUrl, {
    allowedMimes: ['image/jpeg', 'image/webp', 'image/png']
  });

  const scope = await resolveActorScope(pool, user);
  const [docRows] = await pool.query(
    `SELECT id, status, branch_id, department_id
     FROM receiving_documents
     WHERE id = ?
     LIMIT 1`,
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

  const [existingPageRows] = await pool.query(
    `SELECT id
     FROM receiving_document_images
     WHERE document_id = ? AND page_no = ?
     LIMIT 1`,
    [docId, parsedPageNo]
  );

  let imageId;
  if (Array.isArray(existingPageRows) && existingPageRows.length > 0) {
    imageId = Number(existingPageRows[0].id);
    await pool.query(
      `UPDATE receiving_document_images
       SET mime_type = ?, width = ?, height = ?, size_bytes = ?, sha256 = ?, image_data = ?
       WHERE id = ?`,
      [
        parsedImage.mimeType,
        parsedImage.width,
        parsedImage.height,
        parsedImage.sizeBytes,
        parsedImage.sha256,
        parsedImage.buffer,
        imageId
      ]
    );
  } else {
    const [insertRes] = await pool.query(
      `INSERT INTO receiving_document_images
         (document_id, page_no, mime_type, width, height, size_bytes, sha256, image_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    imageId = Number(insertRes.insertId);
  }

  await recordAuditLog(pool, {
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

  return { image_id: imageId };
};

// ============================================================================
// 4. POST /:id/ocr
// ============================================================================
export const runDocumentOcr = async ({ user, documentId, ocrOptions = {} } = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw createReceivingError('VALIDATION_FAILED', 'รหัสเอกสารไม่ถูกต้อง');
  }

  const scope = await resolveActorScope(pool, user);
  const [docRows] = await pool.query(
    `SELECT *
     FROM receiving_documents
     WHERE id = ?
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
    `SELECT id, page_no, mime_type, width, height, image_data
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

  await pool.query(
    `UPDATE receiving_documents SET ocr_status = 'pending' WHERE id = ?`,
    [docId]
  );

  let ocrResult;
  try {
    ocrResult = await extractBillWithVision({
      images: imageRows,
      document: doc,
      ...ocrOptions
    });
  } catch (ocrError) {
    await pool.query(
      `UPDATE receiving_documents SET ocr_status = 'failed' WHERE id = ?`,
      [docId]
    );
    throw ocrError;
  }

  const supplierNameText =
    String(doc.supplier_name_text || '').trim() ||
    String(ocrResult.supplier_name || '').trim() ||
    '';

  const supplierKey = buildSupplierKey({
    supplierMasterId: doc.supplier_master_id,
    productGroupId: doc.product_group_id,
    supplierNameText
  });

  // โหลด aliases, expected order_items, products, units เพื่อใช้จับคู่บรรทัด
  const [aliasRows] = await pool.query(
    `SELECT spa.*, p.name AS product_name, p.unit_id AS product_unit_id
     FROM supplier_product_aliases spa
     LEFT JOIN products p ON p.id = spa.product_id
     WHERE spa.supplier_key = ? OR spa.supplier_key = 'none'
     ORDER BY (spa.supplier_key = ?) DESC, spa.confirm_count DESC, spa.updated_at DESC`,
    [supplierKey, supplierKey]
  );

  const expectedItems = await fetchExpectedOrderItemsFlat(pool, {
    date: toBangkokDateKey(doc.delivery_date),
    branchId: Number(doc.branch_id),
    departmentId: Number(doc.department_id)
  });

  const [unitRows] = await pool.query(
    `SELECT id, name, abbreviation FROM units WHERE is_active = true`
  );

  const [existingLineRows] = await pool.query(
    `SELECT *
     FROM receiving_document_lines
     WHERE document_id = ?
     ORDER BY line_no ASC, id ASC`,
    [docId]
  );

  const matchedLines = matchOcrLinesToCatalog({
    ocrLines: ocrResult.lines,
    aliases: Array.isArray(aliasRows) ? aliasRows : [],
    expectedItems,
    units: Array.isArray(unitRows) ? unitRows : [],
    supplierKey
  });

  const mergedLines = mergeOcrLinesPreservingUserEdits({
    existingLines: Array.isArray(existingLineRows) ? existingLineRows : [],
    newMatchedLines: matchedLines
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const nextDocRef = ocrResult.doc_ref ?? doc.doc_ref ?? null;
    const nextDocDate = ocrResult.doc_date ?? (doc.doc_date ? toBangkokDateKey(doc.doc_date) : null);
    const nextSubtotal = ocrResult.subtotal ?? toFiniteNumberOrNull(doc.subtotal);
    const nextDiscount = ocrResult.discount ?? toFiniteNumberOrNull(doc.discount);
    const nextVat = ocrResult.vat ?? toFiniteNumberOrNull(doc.vat);
    const nextTotal = ocrResult.total ?? toFiniteNumberOrNull(doc.total);
    const nextModel = ocrResult.model || 'gpt-4o-mini';
    const nextConfidence = ocrResult.confidence;

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
           ocr_confidence = ?
       WHERE id = ?`,
      [
        supplierNameText,
        nextDocRef,
        nextDocDate,
        nextSubtotal,
        nextDiscount,
        nextVat,
        nextTotal,
        nextModel,
        nextConfidence,
        docId
      ]
    );

    // ลบเฉพาะบรรทัดที่ผู้ใช้ไม่ได้แก้ไขเอง แล้วเขียนบรรทัดจากการอ่านบิลใหม่
    await connection.query(
      `DELETE FROM receiving_document_lines
       WHERE document_id = ? AND COALESCE(is_user_edited, false) = false`,
      [docId]
    );

    for (const line of mergedLines) {
      if (line.id && Boolean(line.is_user_edited)) {
        continue;
      }
      await connection.query(
        `INSERT INTO receiving_document_lines (
           document_id, line_no, bill_text, product_id, product_name,
           order_item_id, unit, unit_text, unit_id,
           quantity_billed, quantity_received, unit_price, amount,
           match_source, match_confidence, is_user_edited
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [
          docId,
          Number(line.line_no),
          String(line.bill_text || ''),
          line.product_id ? Number(line.product_id) : null,
          line.product_name || null,
          line.order_item_id ? Number(line.order_item_id) : null,
          line.unit_text || null,
          line.unit_text || null,
          line.unit_id ? Number(line.unit_id) : null,
          toFiniteNumberOrNull(line.quantity_billed),
          toFiniteNumberOrNull(line.quantity_received) ?? 0,
          toFiniteNumberOrNull(line.unit_price),
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
        ...doc,
        id: docId,
        supplier_name_text: supplierNameText,
        doc_ref: nextDocRef,
        doc_date: nextDocDate,
        subtotal: nextSubtotal,
        discount: nextDiscount,
        vat: nextVat,
        total: nextTotal,
        ocr_status: 'done',
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
        line_count: updatedLines.length
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

// ============================================================================
// 5. GET /:id & GET /?date=&status=
// ============================================================================
export const getReceivingDocumentById = async ({ user, documentId } = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
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

  const params = [];
  let whereSql = 'WHERE 1=1';

  const effectiveBranchId = scope.isAdmin && branchId ? Number(branchId) : scope.branchId;
  const effectiveDepartmentId =
    scope.isAdmin && departmentId ? Number(departmentId) : scope.departmentId;

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
      throw createReceivingError(
        'VALIDATION_FAILED',
        'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)'
      );
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
    `SELECT
       rd.*,
       (rd.receiver_signature IS NOT NULL AND OCTET_LENGTH(rd.receiver_signature) > 0) AS has_receiver_signature,
       (rd.courier_signature IS NOT NULL AND OCTET_LENGTH(rd.courier_signature) > 0) AS has_courier_signature
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

// ============================================================================
// 6. PUT /:id (Update draft document headers and lines)
// ============================================================================
export const updateReceivingDocument = async ({
  user,
  documentId,
  body = {}
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT *
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
        'แก้ไขได้เฉพาะเอกสารที่อยู่ในสถานะร่าง (draft) เท่านั้น'
      );
    }

    const nextKind =
      body.kind !== undefined ? String(body.kind).trim() : doc.kind;
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
        ? body.supplier_master_id === null || body.supplier_master_id === ''
          ? null
          : Number(body.supplier_master_id)
        : doc.supplier_master_id;
    const nextProductGroupId =
      body.product_group_id !== undefined
        ? body.product_group_id === null || body.product_group_id === ''
          ? null
          : Number(body.product_group_id)
        : doc.product_group_id;
    const nextSupplierNameText =
      body.supplier_name_text !== undefined
        ? String(body.supplier_name_text || '').trim()
        : String(doc.supplier_name_text || '');
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
          : String(body.courier_name).trim()
        : doc.courier_name;

    const parseMoneyField = (fieldVal, currentVal, fieldLabel) => {
      if (fieldVal === undefined) return toFiniteNumberOrNull(currentVal);
      if (fieldVal === null || fieldVal === '') return null;
      const parsed = toFiniteNumberOrNull(fieldVal);
      if (parsed === null || parsed < 0) {
        throw createReceivingError('VALIDATION_FAILED', `ค่า ${fieldLabel} ไม่ถูกต้อง`);
      }
      return Math.round((parsed + Number.EPSILON) * 100) / 100;
    };

    const nextSubtotal = parseMoneyField(body.subtotal, doc.subtotal, 'subtotal');
    const nextDiscount = parseMoneyField(body.discount, doc.discount, 'discount');
    const nextVat = parseMoneyField(body.vat, doc.vat, 'vat');
    const nextTotal = parseMoneyField(body.total, doc.total, 'total');

    await connection.query(
      `UPDATE receiving_documents
       SET kind = ?,
           supplier_master_id = ?,
           product_group_id = ?,
           supplier_name_text = ?,
           delivery_date = ?,
           doc_ref = ?,
           doc_date = ?,
           subtotal = ?,
           discount = ?,
           vat = ?,
           total = ?,
           courier_name = ?
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
        nextCourierName,
        docId
      ]
    );

    if (Array.isArray(body.deleted_line_ids) && body.deleted_line_ids.length > 0) {
      const delIds = body.deleted_line_ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (delIds.length > 0) {
        await connection.query(
          `DELETE FROM receiving_document_lines
           WHERE document_id = ? AND id IN (${delIds.map(() => '?').join(', ')})`,
          [docId, ...delIds]
        );
      }
    }

    if (Array.isArray(body.lines)) {
      for (let idx = 0; idx < body.lines.length; idx += 1) {
        const line = body.lines[idx];
        if (!line || typeof line !== 'object') {
          throw createReceivingError('VALIDATION_FAILED', 'ข้อมูลรายการสินค้า (lines) ไม่ถูกต้อง');
        }

        const lineNo =
          Number.isFinite(Number(line.line_no)) && Number(line.line_no) > 0
            ? Math.trunc(Number(line.line_no))
            : idx + 1;
        const billText = String(line.bill_text ?? line.product_name ?? '').trim();
        const productId =
          line.product_id !== null && line.product_id !== undefined && line.product_id !== ''
            ? Number(line.product_id)
            : null;
        let productName =
          line.product_name !== undefined && line.product_name !== null
            ? String(line.product_name).trim() || null
            : null;

        if (productId && !productName) {
          const [pRows] = await connection.query(
            `SELECT name FROM products WHERE id = ? LIMIT 1`,
            [productId]
          );
          if (Array.isArray(pRows) && pRows[0]?.name) {
            productName = String(pRows[0].name);
          }
        }

        const orderItemId =
          line.order_item_id !== null && line.order_item_id !== undefined && line.order_item_id !== ''
            ? Number(line.order_item_id)
            : null;
        const unitText =
          line.unit_text !== undefined && line.unit_text !== null
            ? String(line.unit_text).trim() || null
            : null;
        const unitId =
          line.unit_id !== null && line.unit_id !== undefined && line.unit_id !== ''
            ? Number(line.unit_id)
            : null;

        const qtyBilled =
          line.quantity_billed === null || line.quantity_billed === undefined || line.quantity_billed === ''
            ? null
            : toFiniteNumberOrNull(line.quantity_billed);
        if (qtyBilled !== null && qtyBilled < 0) {
          throw createReceivingError('VALIDATION_FAILED', 'quantity_billed ต้องไม่ติดลบ');
        }

        const qtyReceived = toFiniteNumberOrNull(line.quantity_received ?? 0);
        if (qtyReceived === null || qtyReceived < 0) {
          throw createReceivingError('VALIDATION_FAILED', 'quantity_received ต้องเป็นตัวเลขที่ไม่ติดลบ');
        }

        const unitPrice =
          line.unit_price === null || line.unit_price === undefined || line.unit_price === ''
            ? null
            : toFiniteNumberOrNull(line.unit_price);
        if (unitPrice !== null && unitPrice < 0) {
          throw createReceivingError('VALIDATION_FAILED', 'unit_price ต้องไม่ติดลบ');
        }

        let amount =
          line.amount === null || line.amount === undefined || line.amount === ''
            ? null
            : toFiniteNumberOrNull(line.amount);
        if (amount === null && unitPrice !== null) {
          const baseQty = qtyBilled !== null ? qtyBilled : qtyReceived;
          amount = Math.round((baseQty * unitPrice + Number.EPSILON) * 100) / 100;
        }

        const matchSourceCandidate = String(line.match?.source || '').trim();
        const matchSource = ['alias', 'order', 'manual', 'none'].includes(matchSourceCandidate)
          ? matchSourceCandidate
          : productId
            ? 'manual'
            : 'none';
        const matchConfidence =
          line.match?.confidence !== undefined && line.match?.confidence !== null
            ? toFiniteNumberOrNull(line.match.confidence)
            : matchSource === 'manual'
              ? 1
              : null;

        if (line.id) {
          await connection.query(
            `UPDATE receiving_document_lines
             SET line_no = ?,
                 bill_text = ?,
                 product_id = ?,
                 product_name = ?,
                 order_item_id = ?,
                 unit = ?,
                 unit_text = ?,
                 unit_id = ?,
                 quantity_billed = ?,
                 quantity_received = ?,
                 unit_price = ?,
                 amount = ?,
                 match_source = ?,
                 match_confidence = ?,
                 is_user_edited = true
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
              qtyBilled,
              qtyReceived,
              unitPrice,
              amount,
              matchSource,
              matchConfidence,
              Number(line.id),
              docId
            ]
          );
        } else {
          await connection.query(
            `INSERT INTO receiving_document_lines (
               document_id, line_no, bill_text, product_id, product_name,
               order_item_id, unit, unit_text, unit_id,
               quantity_billed, quantity_received, unit_price, amount,
               match_source, match_confidence, is_user_edited
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
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
              qtyBilled,
              qtyReceived,
              unitPrice,
              amount,
              matchSource,
              matchConfidence
            ]
          );
        }
      }
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

// ============================================================================
// 7. POST /:id/signatures
// ============================================================================
export const saveDocumentSignature = async ({
  user,
  documentId,
  role,
  imageDataUrl,
  name = undefined
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
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
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp']
  });

  const scope = await resolveActorScope(pool, user);
  const [docRows] = await pool.query(
    `SELECT *
     FROM receiving_documents
     WHERE id = ?
     LIMIT 1`,
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
      ? String(name).trim()
      : null;

  if (cleanRole === 'receiver') {
    await pool.query(
      `UPDATE receiving_documents
       SET receiver_signature = ?,
           receiver_signature_mime = ?,
           receiver_name = COALESCE(?, receiver_name)
       WHERE id = ?`,
      [parsedSig.buffer, parsedSig.mimeType, cleanName, docId]
    );
  } else {
    await pool.query(
      `UPDATE receiving_documents
       SET courier_signature = ?,
           courier_signature_mime = ?,
           courier_name = COALESCE(?, courier_name)
       WHERE id = ?`,
      [parsedSig.buffer, parsedSig.mimeType, cleanName, docId]
    );
  }

  await recordAuditLog(pool, {
    documentId: docId,
    action: 'sign',
    actorUserId: scope.userId,
    actorName: scope.userName,
    details: { role: cleanRole, name: cleanName }
  });

  return loadDocumentBundleById(pool, docId, { includeLines: true });
};

// ============================================================================
// 8. POST /:id/confirm
// ============================================================================
export const confirmReceivingDocument = async ({
  user,
  documentId,
  unmatchedOk = false
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const scope = await resolveActorScope(pool, user);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [docRows] = await connection.query(
      `SELECT
         rd.*,
         (rd.receiver_signature IS NOT NULL AND OCTET_LENGTH(rd.receiver_signature) > 0) AS has_receiver_signature
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
      (line) => (toFiniteNumberOrNull(line.quantity_received) ?? 0) > 0
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

    const supplierKey = buildSupplierKey({
      supplierMasterId: doc.supplier_master_id,
      productGroupId: doc.product_group_id,
      supplierNameText: doc.supplier_name_text
    });

    for (const line of lines || []) {
      const qtyReceived = toFiniteNumberOrNull(line.quantity_received) ?? 0;
      const qtyBilled = toFiniteNumberOrNull(line.quantity_billed);
      const unitPrice = toFiniteNumberOrNull(line.unit_price);
      const productId = line.product_id ? Number(line.product_id) : null;
      const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;

      // 8.1 อัปเดต order_items ที่ผูกไว้ พร้อมเก็บ snapshot เดิมเผื่อ void
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
          await connection.query(
            `UPDATE receiving_document_lines
             SET prev_order_received_quantity = ?,
                 prev_order_actual_price = ?,
                 prev_order_is_received = ?,
                 prev_order_received_by_user_id = ?,
                 prev_order_received_at = ?
             WHERE id = ?`,
            [
              prevOi.received_quantity ?? null,
              prevOi.actual_price ?? null,
              prevOi.is_received !== null && prevOi.is_received !== undefined
                ? Boolean(prevOi.is_received)
                : false,
              prevOi.received_by_user_id ?? null,
              prevOi.received_at ?? null,
              line.id
            ]
          );

          await connection.query(
            `UPDATE order_items
             SET received_quantity = ?,
                 actual_price = ?,
                 is_received = true,
                 received_by_user_id = ?,
                 received_at = NOW()
             WHERE id = ?`,
            [
              qtyReceived,
              unitPrice !== null ? unitPrice : prevOi.actual_price ?? null,
              scope.userId || doc.receiver_user_id,
              orderItemId
            ]
          );
        }
      }

      // 8.2 เพิ่ม inventory_transactions type 'receive' และอัปเดต inventory_balance
      if (productId && qtyReceived > 0) {
        const [balanceRows] = await connection.query(
          `SELECT quantity
           FROM inventory_balance
           WHERE product_id = ? AND department_id = ?
           FOR UPDATE`,
          [productId, Number(doc.department_id)]
        );

        const balanceBefore =
          Array.isArray(balanceRows) && balanceRows.length > 0
            ? toFiniteNumberOrNull(balanceRows[0].quantity) ?? 0
            : 0;
        const balanceAfter =
          Math.round((balanceBefore + qtyReceived + Number.EPSILON) * 1000) / 1000;
        const noteText = `รับสินค้าตามเอกสาร #${docId}${doc.doc_ref ? ` (${doc.doc_ref})` : ''}`;

        const [txRes] = await connection.query(
          `INSERT INTO inventory_transactions
             (product_id, department_id, transaction_type, quantity,
              balance_before, balance_after, reference_type, reference_id, notes, created_by)
           VALUES (?, ?, 'receive', ?, ?, ?, 'receiving_document', ?, ?, ?)`,
          [
            productId,
            Number(doc.department_id),
            qtyReceived,
            balanceBefore,
            balanceAfter,
            String(docId),
            noteText,
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
          [productId, Number(doc.department_id), balanceAfter, txRes.insertId]
        );
      }

      // 8.3 บันทึก/อัปเดต supplier_product_aliases จาก line ที่ผู้ใช้ยืนยัน
      const cleanBillText = String(line.bill_text || '').trim();
      const normalizedBillText = normalizeMatchText(cleanBillText);
      if (productId && normalizedBillText) {
        const cleanUnitText = String(line.unit_text || line.unit || '').trim();
        const normalizedUnitText = normalizeMatchText(cleanUnitText);
        let unitMultiplier = 1;
        if (
          qtyBilled !== null &&
          qtyBilled > 0 &&
          qtyReceived > 0 &&
          cleanUnitText &&
          Math.abs(qtyReceived / qtyBilled - Math.round(qtyReceived / qtyBilled)) < 0.0001 &&
          Math.round(qtyReceived / qtyBilled) >= 2 &&
          line.match_source === 'alias'
        ) {
          unitMultiplier = Math.round(qtyReceived / qtyBilled);
        }

        await connection.query(
          `INSERT INTO supplier_product_aliases (
             supplier_key, supplier_master_id, product_group_id, supplier_name_text,
             bill_text, normalized_bill_text, unit_text, normalized_unit_text,
             product_id, unit_id, unit_multiplier, last_unit_price,
             confirm_count, updated_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE
             product_id = VALUES(product_id),
             unit_id = COALESCE(VALUES(unit_id), unit_id),
             last_unit_price = COALESCE(VALUES(last_unit_price), last_unit_price),
             confirm_count = confirm_count + 1,
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
            unitMultiplier,
            unitPrice,
            scope.userId || doc.receiver_user_id
          ]
        );
      }
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

// ============================================================================
// 9. POST /:id/void
// ============================================================================
export const voidReceivingDocument = async ({
  user,
  documentId,
  reason
} = {}) => {
  await ensureReceivingDocumentsTables();
  await ensureOrderReceivingColumns();
  await ensureInventoryTables();

  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }

  const cleanReason = String(reason || '').trim();
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
      `SELECT *
       FROM receiving_documents
       WHERE id = ?
       FOR UPDATE`,
      [docId]
    );
    const doc = docRows?.[0];
    assertDocumentAccess(scope, doc);

    if (doc.status === 'void') {
      throw createReceivingError('NOT_DRAFT', 'เอกสารนี้ถูกยกเลิกไปแล้ว');
    }

    // ตรวจสอบสิทธิ์: admin หรือเจ้าของเอกสารภายในวันเดียวกัน
    if (!scope.isAdmin) {
      const isOwner = Number(doc.receiver_user_id) === Number(scope.userId);
      const todayKey = getBangkokDateKey();
      const refDateKey =
        toBangkokDateKey(doc.confirmed_at) ||
        toBangkokDateKey(doc.created_at) ||
        toBangkokDateKey(doc.delivery_date);
      const deliveryDateKey = toBangkokDateKey(doc.delivery_date);
      const isSameDay = refDateKey === todayKey || deliveryDateKey === todayKey;

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
      for (const line of lines || []) {
        const qtyReceived = toFiniteNumberOrNull(line.quantity_received) ?? 0;
        const productId = line.product_id ? Number(line.product_id) : null;
        const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;

        // 9.1 ย้อนค่า order_items ที่เอกสารนี้ตั้งไว้
        if (orderItemId) {
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
        }

        // 9.2 ย้อนสต็อก (inventory reverse)
        if (productId && qtyReceived > 0) {
          const [balanceRows] = await connection.query(
            `SELECT quantity
             FROM inventory_balance
             WHERE product_id = ? AND department_id = ?
             FOR UPDATE`,
            [productId, Number(doc.department_id)]
          );

          const balanceBefore =
            Array.isArray(balanceRows) && balanceRows.length > 0
              ? toFiniteNumberOrNull(balanceRows[0].quantity) ?? 0
              : 0;
          const reverseDelta = -Math.abs(qtyReceived);
          const balanceAfter =
            Math.round((balanceBefore + reverseDelta + Number.EPSILON) * 1000) / 1000;
          const noteText = `ยกเลิกเอกสารรับสินค้า #${docId}: ${cleanReason}`;

          const [txRes] = await connection.query(
            `INSERT INTO inventory_transactions
               (product_id, department_id, transaction_type, quantity,
                balance_before, balance_after, reference_type, reference_id, notes, created_by)
             VALUES (?, ?, 'adjustment', ?, ?, ?, 'receiving_document_void', ?, ?, ?)`,
            [
              productId,
              Number(doc.department_id),
              reverseDelta,
              balanceBefore,
              balanceAfter,
              String(docId),
              noteText,
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
            [productId, Number(doc.department_id), balanceAfter, txRes.insertId]
          );
        }
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

// ============================================================================
// 10. GET /:id/images/:imageId
// ============================================================================
export const getDocumentImageBinary = async ({
  user,
  documentId,
  imageId
} = {}) => {
  await ensureReceivingDocumentsTables();

  const docId = Number(documentId);
  const imgId = Number(imageId);
  if (!Number.isInteger(docId) || docId <= 0 || !Number.isInteger(imgId) || imgId <= 0) {
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
