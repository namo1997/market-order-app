import { createHash } from 'node:crypto';
import { cents, date, dueDate, fail, normalize } from './domain.js';

export const RECEIVING_DDL = [
  `CREATE TABLE IF NOT EXISTS ap_receiving_sync_runs (id BIGINT PRIMARY KEY AUTO_INCREMENT, status VARCHAR(20) NOT NULL, origin_hash CHAR(64) NOT NULL, cursor TEXT NULL, updated_since VARCHAR(40) NULL, watermark VARCHAR(40) NULL, documents_seen INT NOT NULL DEFAULT 0, documents_changed INT NOT NULL DEFAULT 0, error_code VARCHAR(60) NULL, started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TIMESTAMP NULL)`,
  `CREATE TABLE IF NOT EXISTS ap_receiving_documents (document_id BIGINT PRIMARY KEY, source_updated_at VARCHAR(40) NOT NULL, receipt_date DATE NOT NULL, branch_code VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL, content_hash CHAR(64) NOT NULL, document JSON NOT NULL, match_status VARCHAR(30) NOT NULL, linked_source_key VARCHAR(200) NULL, sync_run_id BIGINT NOT NULL, FOREIGN KEY (sync_run_id) REFERENCES ap_receiving_sync_runs(id), INDEX ap_receiving_period (receipt_date, branch_code))`,
  `CREATE TABLE IF NOT EXISTS ap_receiving_history (id BIGINT PRIMARY KEY AUTO_INCREMENT, document_id BIGINT NOT NULL, sync_run_id BIGINT NOT NULL, content_hash CHAR(64) NOT NULL, document JSON NOT NULL, match_status VARCHAR(30) NOT NULL, linked_source_key VARCHAR(200) NULL, previous_hash CHAR(64) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (document_id) REFERENCES ap_receiving_documents(document_id), FOREIGN KEY (sync_run_id) REFERENCES ap_receiving_sync_runs(id))`
];
export const receivingHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => fail('RECEIVING_INVALID_PAYLOAD', 502);
const text = (v, max = 300, nullable = false) => {
  if (v == null && nullable) return null;
  if (typeof v !== 'string' || v.length > max) throw invalid();
  return v.trim();
};
const safeName = v => text(v).replace(/(?:\d[ -]?){9,}/g, '[ปกปิดเลข]');
const integer = (v, nullable = false) => {
  if (v === null && nullable) return null;
  if (!Number.isSafeInteger(v) || v < 0 || v > 99999999999999) throw invalid();
  return v;
};
const id = v => { integer(v); if (!v) throw invalid(); return v; };
const choice = (v, values) => { if (!values.includes(v)) throw invalid(); return v; };
const isoDate = (v, nullable = false) => { if (v === null && nullable) return null; try { return date(v); } catch { throw invalid(); } };
const timestamp = (v, nullable = false) => {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) throw invalid();
  isoDate(v.slice(0, 10));
  if (Number(v.slice(11, 13)) > 23 || Number(v.slice(14, 16)) > 59 || Number(v.slice(17, 19)) > 59) throw invalid();
  return new Date(v).toISOString();
};
// Explicit allowlist: never persist raw OCR, images or supplier contact/account metadata.
export function receivingDocument(row) {
  if (!row || !row.branch || !row.supplier || !Array.isArray(row.lines) || !Array.isArray(row.open_issues) || row.lines.length > 5000 || row.open_issues.length > 1000) throw invalid();
  const doc = {
    document_id: id(row.document_id), status: choice(row.status, ['confirmed', 'void']),
    updated_at: timestamp(row.updated_at), confirmed_at: timestamp(row.confirmed_at, true), voided_at: timestamp(row.voided_at, true),
    receipt_date: isoDate(row.receipt_date),
    branch: { id: id(row.branch.id), code: text(row.branch.code, 20), name: safeName(row.branch.name) },
    department: row.department == null ? null : { id: id(row.department.id), name: safeName(row.department.name) },
    receiving_scope: choice(row.receiving_scope, ['department', 'branch']),
    supplier: { key: text(row.supplier.key, 160), master_id: row.supplier.master_id == null ? null : id(row.supplier.master_id),
      product_group_id: row.supplier.product_group_id == null ? null : id(row.supplier.product_group_id), name: safeName(row.supplier.name),
      ap_code: text(row.supplier.ap_code, 80, true), ap_code_source: choice(row.supplier.ap_code_source, ['branch_code', 'master_code', 'none']) },
    doc_kind: choice(row.doc_kind, ['bill', 'no_bill', 'statement_only']), doc_ref: text(row.doc_ref, 200, true), doc_date: isoDate(row.doc_date, true),
    bill_totals_satang: row.bill_totals_satang == null ? null : Object.fromEntries(['subtotal','discount','vat','total'].map(k => [k, integer(row.bill_totals_satang[k], true)])),
    received_value_satang: integer(row.received_value_satang, true), price_status: choice(row.price_status, ['from_bill', 'needs_accounting_price']),
    lines: row.lines.map(l => {
      if (typeof l.quantity_received !== 'string' || !/^\d{1,12}\.\d{2}$/.test(l.quantity_received)) throw invalid();
      return { line_id: id(l.line_id), product_id: l.product_id == null ? null : id(l.product_id), product_name: safeName(l.product_name),
        item_code: text(l.item_code, 120, true), bill_text: l.bill_text == null ? null : safeName(l.bill_text), quantity_received: l.quantity_received,
        unit: text(l.unit, 80), unit_price_satang: integer(l.unit_price_satang, true), amount_satang: integer(l.amount_satang, true), decision: text(l.decision, 60) };
    }),
    open_issues: row.open_issues.map(i => ({ type: text(i.type, 60), status: choice(i.status, ['open', 'resolved']), credit_note_ref: text(i.credit_note_ref, 200, true) })),
    image_count: integer(row.image_count)
  };
  if (!doc.branch.code || !doc.supplier.key || !doc.supplier.name || (doc.status === 'void' && !doc.voided_at)
    || (doc.status === 'confirmed' && !doc.confirmed_at) || (doc.confirmed_at && doc.confirmed_at > doc.updated_at)
    || (doc.voided_at && doc.voided_at > doc.updated_at) || (doc.doc_kind === 'statement_only' && doc.lines.length > 0) || new Set(doc.lines.map(l => l.line_id)).size !== doc.lines.length) throw invalid();
  return doc;
}
export function receivingEndpoint(config) {
  if (!config?.url || !config?.token) throw fail('RECEIVING_DISABLED', 503);
  try {
    const url = new URL(config.url);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith('/api/receiving-export/ap/v1/documents')) throw new Error();
    return url;
  } catch { throw fail('RECEIVING_CONFIG_INVALID', 503); }
}
export function receivingConfigured(config) { try { receivingEndpoint(config); return true; } catch { return false; } }
export function receivingSourceUrl(config, documentId) {
  try { return new URL(`/admin/receiving/documents/${id(documentId)}`, receivingEndpoint(config)).href; } catch { return null; }
}
export async function fetchReceivingPage(config, { cursor = null, updatedSince = null, fetchImpl = fetch } = {}) {
  const url = receivingEndpoint(config);
  url.searchParams.set('limit', '500');
  if (cursor != null) url.searchParams.set('cursor', cursor);
  if (updatedSince) url.searchParams.set('updated_since', timestamp(updatedSince));
  try {
    const response = await fetchImpl(url.href, { method: 'GET', headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw fail('RECEIVING_HTTP_FAILED', 502);
    // Bound untrusted upstream input before parsing it.
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw invalid(); } chunks.push(Buffer.from(value)); }
    } finally { reader.releaseLock(); }
    const page = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (page.version !== 1 || !Array.isArray(page.documents) || page.documents.length > 500 || !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length > 0 && page.next_cursor.length <= 4096))) throw invalid();
    const generatedAt = timestamp(page.generated_at), documents = page.documents.map(receivingDocument);
    if (documents.some(d => d.updated_at > generatedAt)) throw invalid();
    return { generatedAt, nextCursor: page.next_cursor, documents };
  } catch (error) { throw fail(['RECEIVING_HTTP_FAILED','RECEIVING_INVALID_PAYLOAD'].includes(error.message) ? error.message : 'RECEIVING_FETCH_FAILED', 502); }
}
const ref = v => String(v || '').normalize('NFKC').trim().toUpperCase();
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const supplierIdentity = value => normalize(value).replaceAll('จำกัด'.normalize('NFKC'), '');
const supplierMatch = (doc, source) => doc.supplier.ap_code && source.apCode
  ? ref(doc.supplier.ap_code) === ref(source.apCode)
  : Boolean(supplierIdentity(doc.supplier.name)) && supplierIdentity(doc.supplier.name) === supplierIdentity(source.supplierName);
const facts = d => Boolean(d.doc_ref && d.doc_date && d.bill_totals_satang?.total != null && d.price_status === 'from_bill');
export function matchReceiving(doc, sources) {
  const result = (status, reason, linkedSourceKey = null) => ({ status, reason, linkedSourceKey });
  if (doc.status === 'void') return result('VOID', 'ยกเลิกหลักฐานและปลดลิงก์แล้ว');
  if (doc.doc_kind === 'statement_only') return result('REFERENCE', 'ใบวางบิลอ้างอิง ไม่ใช่การซื้อ');
  if (!facts(doc) || doc.doc_kind !== 'bill') return result('REVIEW', 'รอตรวจบิล วันที่ หรือราคา');
  const candidates = sources.filter(s => s.sourceType === 'LBC' && s.branch === doc.branch.code && (supplierMatch(doc, s) || (supplierIdentity(doc.supplier.name) && supplierIdentity(doc.supplier.name) === supplierIdentity(s.supplierName))));
  const matches = candidates.filter(s => {
    try { return supplierMatch(doc, s) && s.docRef && s.docDate && ref(s.docRef) === ref(doc.doc_ref) && days(date(s.docDate), doc.doc_date) <= 3
      && Math.abs(cents(s.amount) - doc.bill_totals_satang.total) <= 100; } catch { return false; }
  });
  if (matches.length === 1) return result('LINKED', 'ตรงตามผู้ขาย เลขบิล วันบิล และยอด', matches[0].key);
  if (matches.length > 1) return result('REVIEW', 'พบบิลไลน์ตรงหลายรายการ');
  return candidates.length ? result('REVIEW', 'บิลไลน์ขาดข้อมูลวันบิล/เลขบิล หรือข้อมูลไม่ตรง') : result('NO_LBC', 'ไม่มีใน LBC ชุดที่นำเข้า; รอตรวจสมุดรับจ่ายก่อนลงบัญชี');
}
export function matchReceivingDocuments(documents, sources) {
  const results = documents.map(document => ({ document, match: matchReceiving(document, sources) }));
  // Multiple receipts may describe the same bill: do not count or auto-link them twice.
  const links = new Map();
  for (const { match } of results) if (match.linkedSourceKey) links.set(match.linkedSourceKey, (links.get(match.linkedSourceKey) || 0) + 1);
  return results.map(({ document, match }) => ({ document, match: match.linkedSourceKey && links.get(match.linkedSourceKey) > 1 ? { status: 'REVIEW', reason: 'หลายใบรับของอ้างบิลไลน์เดียวกัน', linkedSourceKey: null } : match }));
}
export function receivingView(doc, match, config) {
  return { documentId: doc.document_id, source: 'ใบรับของ', branch: doc.branch.code, supplierName: doc.supplier.name, apCode: doc.supplier.ap_code,
    docRef: doc.doc_ref, docDate: doc.doc_date, receiptDate: doc.receipt_date, status: doc.status, kind: doc.doc_kind,
    amountSatang: doc.received_value_satang, billTotalSatang: doc.bill_totals_satang?.total ?? null,
    priceStatus: doc.price_status, matchStatus: match.status, linkedSourceKey: match.linkedSourceKey, reason: match.reason,
    reviewRequired: doc.status !== 'void' && (match.status !== 'LINKED' || doc.open_issues.some(i => i.status === 'open')),
    dueDate: doc.doc_kind === 'statement_only' ? null : dueDate(doc.receipt_date), periodMonth: null,
    periodStatus: 'รอตรวจเดือนบัญชีกับสมุดรับจ่าย', sourceUrl: receivingSourceUrl(config, doc.document_id) };
}
const parsed = v => typeof v === 'string' ? JSON.parse(v) : v;
export async function loadReceiving(connection, { month, branch = '', config = {} } = {}) {
  await connection.beginTransaction();
  try {
    // Read all current docs to detect competing links across month/branch filters.
    const [rows] = await connection.query('SELECT document FROM ap_receiving_documents ORDER BY document_id');
    const [sources] = await connection.query("SELECT document FROM ap_sources WHERE source_type='LBC' ORDER BY source_key");
    const [runs] = await connection.query('SELECT id,status,documents_seen,documents_changed,error_code,finished_at FROM ap_receiving_sync_runs ORDER BY id DESC LIMIT 1');
    const documents = matchReceivingDocuments(rows.map(r => parsed(r.document)), sources.map(r => parsed(r.document)))
      .filter(r => r.document.receipt_date.slice(0, 7) === month && (!branch || r.document.branch.code === branch))
      .map(r => receivingView(r.document, r.match, config));
    await connection.commit();
    return { configured: receivingConfigured(config), schemaReady: true, documents, latestRun: runs[0] || null };
  } catch (error) {
    await connection.rollback();
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_TABLE_ERROR'].includes(error.code)) return { configured: receivingConfigured(config), schemaReady: false, documents: [], latestRun: null };
    throw error;
  }
}
