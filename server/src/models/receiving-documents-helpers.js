import { RECEIVING_GROUP_SQL } from './receiving-group-sql.js';
import { aggregateBranchLines, canReceiveBranch } from './receiving-branch-policy.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import {
  computeDocumentWarnings,
  createReceivingError,
  formatMoney,
  formatQuantity,
  toFiniteNumberOrNull,
  toSatangInt
} from '../services/receiving-ocr.service.js';

export const RECEIVING_DOCUMENT_SELECT_COLUMNS = `
  rd.id,
  rd.client_uuid,
  rd.counted_complete_at,
  rd.count_client_uuid,
  rd.status,
  rd.kind,
  rd.branch_id,
  rd.department_id,
  rd.receiving_scope,
  rd.supplier_master_id,
  rd.product_group_id,
  rd.supplier_name_text,
  rd.delivery_date,
  rd.doc_ref,
  rd.doc_date,
  rd.subtotal,
  rd.discount,
  rd.vat,
  rd.total,
  rd.is_header_edited,
  rd.ocr_status,
  rd.ocr_model,
  rd.ocr_confidence,
  rd.ocr_images_hash,
  rd.ocr_result_json,
  rd.ocr_attempt_count,
  rd.ocr_last_requested_at,
  rd.ocr_warnings_json,
  rd.warnings_json,
  rd.lbc_capture_id,
  rd.receiver_user_id,
  rd.receiver_name,
  rd.courier_name,
  rd.confirmed_at,
  rd.confirmed_by_user_id,
  rd.voided_at,
  rd.voided_by_user_id,
  rd.void_reason,
  rd.created_at,
  rd.updated_at,
  (rd.receiver_signature IS NOT NULL AND OCTET_LENGTH(rd.receiver_signature) > 0) AS has_receiver_signature,
  (rd.courier_signature IS NOT NULL AND OCTET_LENGTH(rd.courier_signature) > 0) AS has_courier_signature
`;

export const parseJsonArraySafe = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const toIsoTimestamp = (value) => {
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
    (!Number.isFinite(branchId) ||
      branchId <= 0 ||
      !Number.isFinite(departmentId) ||
      departmentId <= 0 ||
      !userName) &&
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
    departmentId:
      Number.isFinite(departmentId) && departmentId > 0 ? Math.trunc(departmentId) : null,
    userName: userName || 'ผู้รับสินค้า',
    canReceiveBranch: canReceiveBranch(user),
    isAdmin: isAdminUser(user)
  };
};

// แก้ข้อ 14: ตรวจสอบว่า department_id มีอยู่จริงและอยู่ใน branch_id ที่ระบุหรือของบริบทนั้นจริง
export const validateBranchDepartmentConsistency = async (
  db,
  { branchId = null, departmentId = null } = {}
) => {
  if (!departmentId) return;
  const [rows] = await db.query(
    `SELECT id, branch_id FROM departments WHERE id = ? LIMIT 1`,
    [Number(departmentId)]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw createReceivingError('VALIDATION_FAILED', 'ไม่พบแผนกที่ระบุ');
  }
  if (!branchId || Number(rows[0].branch_id) !== Number(branchId)) {
    throw createReceivingError(
      'VALIDATION_FAILED',
      'แผนกที่ระบุไม่ได้อยู่ในสาขาที่เลือก'
    );
  }
};

export const assertDocumentAccess = (scope, doc) => {
  if (!doc) {
    throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  }
  if (scope.isAdmin) return;
  if ((doc.receiving_scope || doc.scope) === 'branch' && scope.canReceiveBranch && Number(doc.branch_id) === Number(scope.branchId)) return;
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

// แก้ข้อ 1 (Critical), ข้อ 4 (High), และ R2-12 (Low):
// ตรวจสอบว่าทุก order_item_id ไม่ซ้ำกันในเอกสาร, อยู่ในสาขา/แผนกของเอกสารจริง,
// ตรงกับ product_id ของบรรทัด และไม่อยู่ในใบสั่งซื้อที่ถูกยกเลิก (cancelled)
export const validateScopedOrderItemsForDocument = async (
  db,
  { branchId, departmentId, lines = [] } = {}
) => {
  const seenOrderItemIds = new Set();
  const requestedItems = [];

  for (const line of lines) {
    if (
      !line ||
      line.order_item_id === null ||
      line.order_item_id === undefined ||
      line.order_item_id === ''
    ) {
      continue;
    }
    const oiId = Number(line.order_item_id);
    if (!Number.isSafeInteger(oiId) || oiId <= 0) {
      throw createReceivingError('VALIDATION_FAILED', 'รหัสรายการใบสั่ง (order_item_id) ไม่ถูกต้อง');
    }
    if (seenOrderItemIds.has(oiId)) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        `ห้ามผูก order_item_id (${oiId}) ซ้ำหลายบรรทัดในเอกสารเดียวกัน`
      );
    }
    seenOrderItemIds.add(oiId);
    requestedItems.push({
      orderItemId: oiId,
      productId:
        line.product_id !== null && line.product_id !== undefined && line.product_id !== ''
          ? Number(line.product_id)
          : null
    });
  }

  if (requestedItems.length === 0) {
    return new Map();
  }

  const ids = requestedItems.map((item) => item.orderItemId);
  const [rows] = await db.query(
    `SELECT
       oi.id,
       oi.product_id,
       oi.quantity,
       oi.received_quantity,
       oi.actual_price,
       oi.is_received,
       oi.received_by_user_id,
       oi.received_at,
       o.status AS order_status,
       d.id AS department_id,
       d.branch_id
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN users u ON o.user_id = u.id
     JOIN departments d ON u.department_id = d.id
     WHERE oi.id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );

  const rowById = new Map();
  for (const row of rows || []) {
    rowById.set(Number(row.id), row);
  }

  for (const reqItem of requestedItems) {
    const found = rowById.get(reqItem.orderItemId);
    if (!found) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        `ไม่พบรายการใบสั่งซื้อ (order_item_id: ${reqItem.orderItemId})`
      );
    }
    if (
      Number(found.branch_id) !== Number(branchId) ||
      (departmentId != null && Number(found.department_id) !== Number(departmentId))
    ) {
      throw createReceivingError(
        'FORBIDDEN',
        'ไม่มีสิทธิ์อ้างอิงรายการใบสั่งซื้อของสาขาหรือแผนกอื่น'
      );
    }
    // R2-12: ปฏิเสธการผูกรายการจากใบสั่งซื้อที่ถูกยกเลิกหรือยังไม่ส่ง
    const orderStatus = String(found.order_status || 'submitted').trim();
    if (!['submitted', 'confirmed', 'completed'].includes(orderStatus)) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        `ไม่สามารถผูกรายการจากใบสั่งซื้อที่มีสถานะ ${orderStatus} ได้ (order_item_id: ${reqItem.orderItemId})`
      );
    }
    if (reqItem.productId !== null && Number(found.product_id) !== Number(reqItem.productId)) {
      throw createReceivingError(
        'VALIDATION_FAILED',
        `รหัสสินค้า (${reqItem.productId}) ไม่ตรงกับสินค้าในใบสั่งซื้อ (${found.product_id})`
      );
    }
  }

  return rowById;
};

export const mapReceivingLineRow = (row) => ({
  id: Number(row.id),
  line_no: Number(row.line_no),
  counted_quantity: row.counted_quantity == null ? null : Number(row.counted_quantity).toFixed(2),
  counted_at: row.counted_at ? toIsoTimestamp(row.counted_at) : null,
  counted_by: row.counted_by == null ? null : Number(row.counted_by),
  review_decision: row.review_decision || null,
  return_status: row.review_decision === 'not_received' ? row.return_status || 'waiting' : null,
  remember_alias: row.remember_alias == null ? false : Boolean(row.remember_alias),
  bill_entered_manually: Boolean(row.is_user_edited && row.quantity_billed != null),
  ...(row.departments ? { departments: row.departments } : {}),
  bill_text: String(row.bill_text || ''),
  ...(row.item_code ? { item_code: String(row.item_code) } : {}),
  product_id: row.product_id !== null && row.product_id !== undefined ? Number(row.product_id) : null,
  product_name: row.product_name ?? null,
  order_item_id:
    row.order_item_id !== null && row.order_item_id !== undefined ? Number(row.order_item_id) : null,
  unit_text: (row.unit_text ?? row.unit) || null,
  unit_id: row.unit_id !== null && row.unit_id !== undefined ? Number(row.unit_id) : null,
  quantity_billed: formatQuantity(row.quantity_billed, { allowNull: true }),
  quantity_received: formatQuantity(row.quantity_received ?? 0, { allowNull: false }),
  note: row.note ?? null,
  unit_price: formatMoney(row.unit_price),
  amount: formatMoney(row.amount),
  ...(Number(row.price_by_weight || 0) ? { price_by_weight: true,
    bill_weight: row.bill_weight == null ? null : String(Number(row.bill_weight)),
    bill_weight_unit: row.bill_weight_unit || null,
    weight_unit_price: formatMoney(row.weight_unit_price), weight_ref_price: formatMoney(row.weight_ref_price) } : {}),
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
  let ocrResult = {};
  try { ocrResult = JSON.parse(row.ocr_result_json || '{}') || {}; } catch { /* Legacy metadata absent. */ }
  const mapped = {
    id: Number(row.id),
    counted_complete_at: row.counted_complete_at ? toIsoTimestamp(row.counted_complete_at) : null,
    status: row.status || 'draft',
    scope: row.receiving_scope || 'department',
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
      ship_to: ocrResult.ship_to ?? null,
      addressee: ocrResult.addressee ?? null,
      supplier_code: ocrResult.supplier_code ?? null,
      ship_to_mismatch: ocrResult.ship_to_mismatch ?? null,
      shop_mismatch: ocrResult.shop_mismatch ?? null,
      bill_shop_name: ocrResult.bill_shop_name ?? null,
      raw_read: ocrResult.raw_read ?? null,
      header_shop: ocrResult.header_shop ?? null,
      doc_kind: ocrResult.doc_kind ?? null,
      line_sum_proposal: ocrResult.line_sum_proposal ?? null,
      unreadable_line_count: ocrResult.unreadable_line_count ?? null,
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
    ...(includeLines ? { lines: lines.map(line => {
      const read = (ocrResult.line_reads || []).find(item => Number(item.line_no) === Number(line.line_no) && item.bill_text === line.bill_text);
      const suggestion = (ocrResult.suggestions || []).find(item => Number(item.line_no) === Number(line.line_no) && item.bill_text === line.bill_text);
      const mapped = mapReceivingLineRow(line);
      // Bug hunt 2026-10-24: picking a product marks the line as edited; the bill quantity is still the one
      // the bill was read with, so it is not "typed by a person".
      const readQty = read?.bill_read?.quantity_billed;
      if (mapped.bill_entered_manually && readQty != null && Math.abs(Number(readQty) - Number(line.quantity_billed)) < 0.005) mapped.bill_entered_manually = false;
      return { ...mapped, ...(read ? { bill_read: read.bill_read } : {}), ...(suggestion ? { suggested_product_name: suggestion.suggested_product_name, suggestion_reason: suggestion.suggestion_reason } : {}) };
    }) } : {}),
    warnings,
    created_at: toIsoTimestamp(row.created_at),
    updated_at: toIsoTimestamp(row.updated_at),
    confirmed_at: row.confirmed_at ? toIsoTimestamp(row.confirmed_at) : null,
    client_uuid: String(row.client_uuid || '')
  };
  return row.status === 'draft' && !row.counted_complete_at ? redactBlindDocument(mapped) : mapped;
};

export const recordAuditLog = async (
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

export const fetchExpectedOrderItemsFlat = async (
  db,
  { date, startDate, endDate, carryoverStartDate, branchId, departmentId, orderItemIds = null }
) => {
  const params = [];
  let whereSql = `WHERE o.status IN ('submitted', 'confirmed', 'completed')`;

  if (date) {
    whereSql += ` AND o.order_date = ?`;
    params.push(date);
  }
  if (startDate && endDate) {
    if (carryoverStartDate) {
      whereSql += ` AND (o.order_date BETWEEN ? AND ? OR (
        o.order_date BETWEEN ? AND ? AND COALESCE(p.allow_pending_carryover, false) = true
        AND COALESCE(oi.quantity, 0) > COALESCE(oi.received_quantity, 0)))`;
      params.push(startDate, endDate, carryoverStartDate, endDate);
    } else {
      whereSql += ` AND o.order_date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }
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
       o.order_date,
       oi.product_id,
       CASE
         WHEN COALESCE(oi.quantity, 0) <= 0 AND COALESCE(oi.received_quantity, 0) > 0
           THEN COALESCE(oi.received_quantity, 0)
         ELSE COALESCE(oi.quantity, 0)
       END AS quantity_ordered,
       oi.received_quantity,
       COALESCE(oi.is_received, false) AS is_received,
       EXISTS (
         SELECT 1 FROM receiving_document_lines receipt_line
         JOIN receiving_documents receipt_doc ON receipt_doc.id = receipt_line.document_id
         WHERE receipt_line.order_item_id = oi.id AND receipt_doc.status = 'confirmed'
           AND receipt_doc.branch_id = b.id
           AND (receipt_doc.receiving_scope = 'branch' OR receipt_doc.department_id = d.id)
       ) AS has_confirmed_receipt,
       oi.requested_price,
       oi.actual_price,
       p.name AS product_name,
       p.default_price,
       COALESCE(p.is_countable, true) AS is_countable,
       COALESCE(p.allow_pending_carryover, false) AS allow_pending_carryover,
       u.id AS unit_id,
       COALESCE(u.name, u.abbreviation, '') AS unit_name,
       pg.id AS product_group_id,
       pg.name AS product_group_name,
       shop.id AS shop_id,
       shop.name AS shop_name,
       COALESCE(pg.skip_receiving_required, true) AS skip_receiving_required,
       b.id AS branch_id,
       d.id AS department_id,
       d.name AS department_name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users usr ON usr.id = o.user_id
     JOIN departments d ON d.id = usr.department_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN withdraw_branch_source_mappings wbm ON wbm.target_branch_id = b.id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN supplier_masters shop ON shop.id = p.supplier_master_id
     LEFT JOIN product_groups pg ON pg.id = ${RECEIVING_GROUP_SQL}
     ${whereSql}
     ORDER BY pg.name, p.name, oi.id`,
    params
  );

  return Array.isArray(rows) ? rows : [];
};

export const fetchLatestPricesByProductIds = async (db, productIds = []) => {
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

// แก้ข้อ 13: DUPLICATE_BILL ต้องตรวจภายใน branch_id เดียวกัน และต้องมีข้อมูลซัพพลายเออร์
export const checkDuplicateBillInDb = async (db, doc) => {
  const docRef = String(doc.doc_ref || '').trim();
  const totalSatang = toSatangInt(doc.total);
  const branchId = Number(doc.branch_id);
  if (!docRef || totalSatang === null || !Number.isFinite(branchId) || branchId <= 0) {
    return false;
  }

  const total = totalSatang / 100;
  const params = [Number(doc.id || 0), branchId, docRef, total];
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
  } else {
    return false;
  }

  const [rows] = await db.query(
    `SELECT id
     FROM receiving_documents
     WHERE id <> ?
       AND branch_id = ?
       AND status <> 'void'
       AND TRIM(doc_ref) = ?
       AND ABS(COALESCE(total, 0) - ?) < 0.01
       ${supplierClause}
     LIMIT 1`,
    params
  );

  return Array.isArray(rows) && rows.length > 0;
};

export const recalculateAndPersistWarnings = async (db, documentRow, lines = []) => {
  const orderItemIds = lines
    .map((line) => Number(line.order_item_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const productIds = lines
    .map((line) => Number(line.product_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const expectedItemsById = new Map();
  if (orderItemIds.length > 0) {
    const expectedRows = await fetchExpectedOrderItemsFlat(db, {
      branchId: documentRow.branch_id ? Number(documentRow.branch_id) : null,
      departmentId: documentRow.department_id ? Number(documentRow.department_id) : null,
      orderItemIds
    });
    for (const row of expectedRows) {
      expectedItemsById.set(Number(row.order_item_id), row);
      if (row.product_id && (row.actual_price || row.requested_price || row.default_price)) {
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

export const loadDocumentBundleById = async (db, documentId, { includeLines = true } = {}) => {
  const [docRows] = await db.query(
    `SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS}
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

  const bundle = mapReceivingDocumentRow(docRow, {
    images: Array.isArray(imageRows) ? imageRows : [],
    lines: docRow.receiving_scope === 'branch' ? aggregateBranchLines(lineRows) : lineRows,
    includeLines
  });
  if (docRow.status === 'draft' && !docRow.counted_complete_at) return redactBlindDocument(bundle);
  if (includeLines) {
    const expected = await fetchExpectedOrderItemsFlat(db, { branchId: docRow.branch_id,
      departmentId: docRow.receiving_scope === 'branch' ? null : docRow.department_id,
      orderItemIds: lineRows.map(line => line.order_item_id).filter(Boolean) });
    bundle.lines = bundle.lines.map(line => {
      const ids = line.departments?.map(part => part.order_item_id) || [line.order_item_id];
      const items = expected.filter(item => ids.includes(Number(item.order_item_id)));
      const qty = items.reduce((n, item) => n + Math.round(Number(item.quantity_ordered || 0) * 100), 0) / 100;
      // P8: only after the blind count (draft) the previous receipts of the linked order items are shown,
      // so staff can see what is still outstanding. Confirmed/void documents already include their own receipt
      // in order_items.received_quantity, so the figure is unknown there and left null.
      const previous = items.reduce((n, item) => n + Math.round(Number(item.received_quantity || 0) * 100), 0) / 100;
      return { ...line, quantity_ordered: items.length ? formatQuantity(qty) : null,
        previously_received_quantity: items.length && docRow.status === 'draft' ? formatQuantity(previous) : null,
        ordered_unit: items[0]?.unit_name || null, ordered_price: items[0]?.actual_price ?? items[0]?.requested_price ?? null };
    });
  }
  return bundle;
};

export const assertBlindCountComplete = doc => {
  if (!doc.counted_complete_at && doc.status === 'draft') {
    throw createReceivingError('NOT_DRAFT', 'ต้องนับของจริงครบทั้งใบก่อนเปิดบิลและดำเนินการต่อ');
  }
};
// early_read exposes only the reading state; bill_name is the printed name of a bill row that
// is not matched to a product yet (names only: no quantity, price, amount or confidence).
// The shop printed on the bill is not a number from the bill: a wrong-shop warning stays visible during the count.
export const redactBlindDocument = doc => ({ ...doc, blind: true, doc_ref: null, doc_date: null,
  shop_mismatch: doc.shop_mismatch ?? doc.ocr?.shop_mismatch ?? null,
  subtotal: null, discount: null, vat: null, total: null, warnings: [], ocr: { status: 'locked' },
  // Redaction can run twice (row mapper, then bundle); keep what the first pass derived.
  early_read: doc.early_read ?? (['pending', 'done', 'failed'].includes(doc.ocr?.status) ? doc.ocr.status : null),
  lines: doc.lines?.map(line => ({ id: line.id, line_no: line.line_no, product_id: line.product_id,
    product_name: line.product_name, order_item_id: line.order_item_id, unit_text: line.unit_text,
    unit_id: line.unit_id, counted_quantity: line.counted_quantity, counted_at: line.counted_at,
    counted_by: line.counted_by, ...(line.product_id ? {} : { bill_name: line.bill_name ?? (line.bill_text || null) }) })) });
