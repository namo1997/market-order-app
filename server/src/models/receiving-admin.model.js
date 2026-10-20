import { canReadReceivingLedger } from './receiving-admin-access.js';
import { RECEIVING_DOCUMENT_SELECT_COLUMNS, mapReceivingDocumentRow, redactBlindDocument } from './receiving-documents-helpers.js';
import { createReceivingError, normalizeBillDate, formatQuantity } from '../services/receiving-ocr.service.js';
import { getBangkokDateKey } from '../utils/bangkok-date.js';
import { confirmedValues, pageValues, receiptValue } from './receiving-admin-values.js';
import { adminAudit } from './receiving-admin-history.js';

export function assertLedgerReader(user) {
  if (!canReadReceivingLedger(user)) throw createReceivingError('FORBIDDEN', 'เฉพาะบัญชีหรือผู้ดูแล');
}
const invalid = () => { throw createReceivingError('VALIDATION_FAILED', 'ตัวกรองหรือเลขหน้าไม่ถูกต้อง'); };
const scalar = value => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return invalid();
  return String(value);
};
const integer = (value, fallback, max = 2147483647) => {
  const text = scalar(value);
  if (text === null) return fallback;
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > max) return invalid();
  return Number(text);
};
const choice = (value, choices) => {
  const text = scalar(value);
  if (text !== null && !choices.includes(text)) return invalid();
  return text;
};
// Decimal comparison in SQL, never floating point in JS. Missing billed quantity is unknown.
const discrepancy = `EXISTS (SELECT 1 FROM receiving_document_lines problem
  WHERE problem.document_id = rd.id AND (rd.status <> 'draft' OR rd.counted_complete_at IS NOT NULL) AND problem.quantity_billed IS NOT NULL
  AND problem.quantity_received <> problem.quantity_billed)`;
export function ledgerFilters(query = {}) {
  const params = [], clauses = ['1=1'];
  const add = (sql, value) => { clauses.push(sql); params.push(value); };
  const dates = ['date_from', 'date_to'].map(key => {
    const text = scalar(query[key]);
    if (text !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || normalizeBillDate(text) !== text)) invalid();
    return text;
  });
  if (dates[0] && dates[1] && dates[0] > dates[1]) invalid();
  if (dates[0]) add('rd.delivery_date >= ?', dates[0]);
  if (dates[1]) add('rd.delivery_date <= ?', dates[1]);
  for (const key of ['branch_id', 'department_id']) {
    const id = integer(query[key], null);
    if (id) add(`rd.${key} = ?`, id);
  }
  const scope = choice(query.scope, ['department', 'branch']);
  if (scope) add('rd.receiving_scope = ?', scope);
  const status = choice(query.status, ['draft', 'confirmed', 'void']);
  if (status) add('rd.status = ?', status);
  const supplier = scalar(query.supplier);
  if (supplier !== null) {
    if (supplier.length > 255) invalid();
    // LOCATE implements literal substring search; % and _ are not wildcards.
    add('LOCATE(?, rd.supplier_name_text) > 0', supplier.trim());
  }
  const problem = choice(query.discrepancy, ['yes', 'no']);
  if (problem) clauses.push(`${problem === 'no' ? 'NOT ' : ''}${discrepancy}`);
  const page = integer(query.page, 1, 1000000), pageSize = integer(query.page_size, 25, 100);
  return { where: `WHERE ${clauses.join(' AND ')}`, params, page, pageSize, offset: (page - 1) * pageSize };
}
const names = `LEFT JOIN branches b ON b.id = rd.branch_id
  LEFT JOIN departments d ON d.id = rd.department_id`;
const displayNames = row => ({ branch_name: row.branch_name || `สาขา ${row.branch_id}`,
  department_name: row.department_name || `แผนก ${row.department_id}` });

// This module deliberately performs SELECT only: no lazy schema creation or side effects.
export async function listLedger(db, { user, query = {}, today = getBangkokDateKey() }) {
  assertLedgerReader(user);
  const f = ledgerFilters(query);
  const [counts] = await db.query(`SELECT COUNT(*) AS total_count,
    COALESCE(SUM(rd.delivery_date = ?), 0) AS today_count,
    COALESCE(SUM(rd.status = 'draft'), 0) AS draft_count,
    CAST(COALESCE(SUM(CASE WHEN rd.status = 'confirmed' THEN rd.total ELSE 0 END), 0) AS CHAR) AS confirmed_total,
    COALESCE(SUM(rd.status = 'confirmed' AND rd.total IS NULL), 0) AS unknown_total_count
    FROM receiving_documents rd ${f.where}`, [today, ...f.params]);
  const [rows] = await db.query(`SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS},
    b.name AS branch_name, d.name AS department_name, ${discrepancy} AS has_discrepancy
    FROM receiving_documents rd ${names} ${f.where}
    ORDER BY rd.delivery_date DESC, rd.id DESC LIMIT ? OFFSET ?`, [...f.params, f.pageSize, f.offset]);
  const values = await pageValues(db, rows);
  const confirmed = await confirmedValues(db, f);
  const count = counts[0] || {};
  return { items: rows.map(row => {
    const locked = row.status === 'draft' && !row.counted_complete_at;
    const mapped = mapReceivingDocumentRow(row, { includeLines: false });
    return { ...(locked ? redactBlindDocument(mapped) : mapped), ...displayNames(row),
      has_discrepancy: locked ? null : Boolean(Number(row.has_discrepancy)),
      receipt_value: locked ? null : values.get(Number(row.id)) ?? null };
  }),
  pagination: { page: f.page, page_size: f.pageSize, total: Number(count.total_count || 0),
    total_pages: Math.ceil(Number(count.total_count || 0) / f.pageSize) },
  summary: { today, today_count: Number(count.today_count || 0), draft_count: Number(count.draft_count || 0),
    confirmed_total: String(count.confirmed_total ?? '0.00'), unknown_total_count: Number(count.unknown_total_count || 0), ...confirmed } };
}
export async function ledgerIssueSummary(db, { user }) {
  assertLedgerReader(user);
  // These four roles have the same cross-branch read scope in the issues API.
  const [[row]] = await db.query(`SELECT COUNT(*) AS pending_issue_count FROM receiving_issues
    WHERE status IN ('open', 'waiting_supplier')`);
  return { pending_issue_count: Number(row?.pending_issue_count || 0) };
}
export async function ledgerOptions(db, { user }) {
  assertLedgerReader(user);
  const [branches] = await db.query(`SELECT DISTINCT b.id, b.name FROM branches b
    JOIN receiving_documents rd ON rd.branch_id = b.id ORDER BY b.name, b.id`);
  const [departments] = await db.query(`SELECT DISTINCT d.id, d.name, d.branch_id FROM departments d
    JOIN receiving_documents rd ON rd.department_id = d.id ORDER BY d.name, d.id`);
  return { branches, departments };
}
export async function ledgerDetail(db, { user, id }) {
  assertLedgerReader(user);
  const documentId = integer(id, null);
  if (!documentId) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  const [docs] = await db.query(`SELECT ${RECEIVING_DOCUMENT_SELECT_COLUMNS},
    b.name AS branch_name, d.name AS department_name FROM receiving_documents rd ${names}
    WHERE rd.id = ? LIMIT 1`, [documentId]);
  if (!docs.length) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  const [lines] = await db.query(`SELECT line.*, oi.quantity AS quantity_ordered,
    d.name AS department_name FROM receiving_document_lines line
    LEFT JOIN order_items oi ON oi.id = line.order_item_id
    LEFT JOIN departments d ON d.id = line.branch_department_id
    WHERE line.document_id = ? ORDER BY line.line_no, line.id`, [documentId]);
  const [images] = await db.query(`SELECT id, page_no, mime_type, width, height
    FROM receiving_document_images WHERE document_id = ? ORDER BY page_no, id`, [documentId]);
  const [audits] = await db.query(`SELECT id, action, actor_name, created_at, details_json
    FROM receiving_document_audits WHERE document_id = ? ORDER BY created_at, id`, [documentId]);
  const blind = docs[0].status === 'draft' && !docs[0].counted_complete_at;
  const [issues] = blind ? [[]] : await db.query(`SELECT id, document_id, type, status, product_name, auto_key
    FROM receiving_issues WHERE document_id = ? ORDER BY id DESC`, [documentId]);
  const document = mapReceivingDocumentRow(docs[0], { lines, images });
  const result = { ...document, ...displayNames(docs[0]), voided_at: docs[0].voided_at || null,
    void_reason: docs[0].void_reason || null,
    lines: document.lines.map((line, index) => ({ ...line,
      // Older documents have no blind-count field: show unknown, do not infer a physical count.
      counted_quantity: formatQuantity(lines[index].counted_quantity, { allowNull: true }),
      quantity_ordered: formatQuantity(lines[index].quantity_ordered, { allowNull: true }),
      department_name: lines[index].department_name || null })),
    audits: audits.map(row => adminAudit(row, blind)), issues };
  return docs[0].status === 'draft' && !docs[0].counted_complete_at ? { ...redactBlindDocument(result), receipt_value: null }
    : { ...result, receipt_value: receiptValue({ ...docs[0], lines }) };
}
