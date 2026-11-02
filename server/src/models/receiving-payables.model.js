import pool from '../config/database.js';
import { canReadReceivingLedger } from './receiving-admin-access.js';
import { fetchSupplierConfirmedAliases } from './receiving-documents-alias.js';
import { checkOcrRateLimit, createReceivingError, extractBillWithVision, parseImageDataUrl } from '../services/receiving-ocr.service.js';
import { MAX_PAYABLE_PAGES, bangkokPeriod, billFromRead, billPeriod, editsFromBody, payableWarnings, sameRef, summarize, validPeriod } from './receiving-payables-logic.js';

// Owner 2026-11-02 "ระบบรวบรวมเจ้าหนี้ … เลือกซัพ → ถ่ายบิล → AI ประมวลผลพร้อมจำนวนราคาเลย": an accounting-only store,
// separate from receiving documents. Nothing here touches stock, orders or the blind count; it only records what each
// supplier's bills say so the month's amount owed per supplier can be paid.

let ready = null;
export function ensurePayablesTables(db = pool) {
  if (db !== pool) return createTables(db);
  ready ||= createTables(db).catch(error => { ready = null; throw error; });
  return ready;
}
async function createTables(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS receiving_payable_bills (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    supplier_key VARCHAR(40) NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    period CHAR(7) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    doc_ref VARCHAR(100) NULL,
    doc_date DATE NULL,
    subtotal DECIMAL(12,2) NULL,
    discount DECIMAL(12,2) NULL,
    vat DECIMAL(12,2) NULL,
    total DECIMAL(12,2) NULL,
    total_source VARCHAR(10) NULL,
    shop_name_read VARCHAR(255) NULL,
    doc_kind VARCHAR(30) NULL,
    lines_json LONGTEXT NULL,
    warnings_json LONGTEXT NULL,
    ocr_status VARCHAR(16) NOT NULL DEFAULT 'none',
    ocr_model VARCHAR(80) NULL,
    note VARCHAR(500) NULL,
    created_by INT NULL,
    created_by_name VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_payable_period (period, status),
    KEY idx_payable_supplier (supplier_key, period),
    KEY idx_payable_ref (supplier_key, doc_ref)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS receiving_payable_bill_images (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bill_id BIGINT UNSIGNED NOT NULL,
    page_no INT NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    size_bytes INT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    image_data MEDIUMBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payable_page (bill_id, page_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

const fail = (message, code = 'VALIDATION_FAILED') => { throw createReceivingError(code, message); };
export function assertPayablesUser(user) {
  if (!canReadReceivingLedger(user)) throw createReceivingError('FORBIDDEN', 'เฉพาะบัญชีหรือผู้ดูแล');
}
const positiveId = value => {
  const textValue = typeof value === 'number' ? String(value) : value;
  if (typeof textValue !== 'string' || !/^[1-9]\d{0,15}$/.test(textValue)) fail('ไม่พบบิล', 'NOT_FOUND');
  return Number(textValue);
};
const parseKey = value => {
  const match = typeof value === 'string' ? /^(sm|pg):([1-9]\d{0,9})$/.exec(value) : null;
  if (!match) fail('รหัสร้านไม่ถูกต้อง');
  return { key: value, master: match[1] === 'sm', id: Number(match[2]) };
};
const json = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const dateText = value => value instanceof Date ? new Date(value.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const num = value => value === null || value === undefined ? null : Number(value);

const view = (row, images = []) => ({
  id: Number(row.id), supplier_key: row.supplier_key, supplier_name: row.supplier_name, period: row.period, status: row.status,
  doc_ref: row.doc_ref || null, doc_date: dateText(row.doc_date), subtotal: num(row.subtotal), discount: num(row.discount), vat: num(row.vat), total: num(row.total),
  total_source: row.total_source || null, shop_name_read: row.shop_name_read || null, doc_kind: row.doc_kind || null,
  lines: json(row.lines_json, []), warnings: json(row.warnings_json, []), ocr_status: row.ocr_status, note: row.note || null,
  created_by_name: row.created_by_name || null, created_at: row.created_at, updated_at: row.updated_at,
  pages: images.map(image => ({ id: Number(image.id), page_no: Number(image.page_no) })),
});

async function loadRow(db, id, lock = false) {
  const [rows] = await db.query(`SELECT * FROM receiving_payable_bills WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows.length) fail('ไม่พบบิล', 'NOT_FOUND');
  return rows[0];
}
async function pagesOf(db, id) {
  const [rows] = await db.query('SELECT id, page_no FROM receiving_payable_bill_images WHERE bill_id = ? ORDER BY page_no', [id]);
  return rows;
}
export async function getBill(db, { user, id }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  const row = await loadRow(db, billId);
  return view(row, await pagesOf(db, billId));
}

async function supplierName(db, parsed) {
  const [rows] = parsed.master
    ? await db.query('SELECT name FROM supplier_masters WHERE id = ? AND is_active = true', [parsed.id])
    : await db.query('SELECT name FROM product_groups WHERE id = ? AND is_active = true', [parsed.id]);
  if (!rows.length) fail('ไม่พบร้านนี้ในทะเบียน', 'NOT_FOUND');
  return String(rows[0].name).trim();
}

export async function createBill(db, { user, body = {} }) {
  assertPayablesUser(user);
  const parsed = parseKey(body?.supplier_key);
  const name = await supplierName(db, parsed);
  const [result] = await db.query(`INSERT INTO receiving_payable_bills (supplier_key, supplier_name, period, status, created_by, created_by_name)
    VALUES (?, ?, ?, 'draft', ?, ?)`, [parsed.key, name, bangkokPeriod(), Number(user?.id) || null, String(user?.name || user?.username || '').slice(0, 255) || null]);
  return getBill(db, { user, id: String(result.insertId) });
}

export async function uploadPage(db, { user, id, body = {} }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  const row = await loadRow(db, billId);
  if (row.status === 'void') fail('บิลนี้ถูกลบแล้ว', 'NOT_DRAFT');
  const pageNo = Number(body?.page_no);
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > MAX_PAYABLE_PAGES) fail(`หน้าบิลต้องอยู่ระหว่าง 1–${MAX_PAYABLE_PAGES}`);
  const image = parseImageDataUrl(body?.image_data_url);
  await db.query('DELETE FROM receiving_payable_bill_images WHERE bill_id = ? AND page_no = ?', [billId, pageNo]);
  await db.query(`INSERT INTO receiving_payable_bill_images (bill_id, page_no, mime_type, size_bytes, sha256, image_data) VALUES (?, ?, ?, ?, ?, ?)`,
    [billId, pageNo, image.mimeType, image.sizeBytes, image.sha256, image.buffer]);
  return { page_no: pageNo, pages: (await pagesOf(db, billId)).length };
}

async function findDuplicates(db, row, docRef) {
  if (!docRef) return [];
  const [rows] = await db.query(`SELECT id, doc_ref, doc_date, total FROM receiving_payable_bills
    WHERE supplier_key = ? AND id <> ? AND status = 'saved' AND doc_ref IS NOT NULL`, [row.supplier_key, Number(row.id)]);
  return rows.filter(other => sameRef(other.doc_ref, docRef)).map(other => ({ id: Number(other.id), doc_date: dateText(other.doc_date), total: num(other.total) }));
}
async function findReceived(db, row, docRef) {
  if (!docRef) return [];
  const parsed = parseKey(row.supplier_key);
  try {
    const [rows] = await db.query(`SELECT id, doc_ref FROM receiving_documents
      WHERE ${parsed.master ? 'supplier_master_id' : 'product_group_id'} = ? AND status = 'confirmed' AND doc_ref IS NOT NULL ORDER BY id DESC LIMIT 200`, [parsed.id]);
    return rows.filter(doc => sameRef(doc.doc_ref, docRef)).slice(0, 3).map(doc => ({ id: Number(doc.id) }));
  } catch { return []; }
}
async function warningsFor(db, row, bill) {
  return payableWarnings(bill, { duplicates: await findDuplicates(db, row, bill.doc_ref), received: await findReceived(db, row, bill.doc_ref) });
}

// Hints the receiving reader already uses for this shop. Each is optional: a missing table never blocks the read.
async function readHints(db, supplierKey) {
  const hints = { knownAliases: [], billFormatNote: '', billRefPattern: null, complex: false };
  try { hints.knownAliases = await fetchSupplierConfirmedAliases(db, supplierKey, 50); } catch { /* hints only */ }
  try { const [rows] = await db.query('SELECT bill_format_note FROM receiving_supplier_profiles WHERE supplier_key = ? LIMIT 1', [supplierKey]); hints.billFormatNote = String(rows?.[0]?.bill_format_note || '').trim().slice(0, 500); } catch { /* hints only */ }
  try { const [rows] = await db.query('SELECT ref_pattern FROM receiving_supplier_bill_refs WHERE supplier_key = ? LIMIT 1', [supplierKey]); hints.billRefPattern = rows?.[0]?.ref_pattern || null; } catch { /* hints only */ }
  try { const [rows] = await db.query('SELECT complex_bills FROM receiving_supplier_ocr_modes WHERE supplier_key = ? LIMIT 1', [supplierKey]); hints.complex = Number(rows?.[0]?.complex_bills || 0) === 1; } catch { /* hints only */ }
  return hints;
}

export async function readBill(db, { user, id, read = extractBillWithVision }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  const row = await loadRow(db, billId);
  if (row.status === 'void') fail('บิลนี้ถูกลบแล้ว', 'NOT_DRAFT');
  const [images] = await db.query('SELECT page_no, mime_type, size_bytes, image_data FROM receiving_payable_bill_images WHERE bill_id = ? ORDER BY page_no', [billId]);
  if (!images.length) fail('ถ่ายรูปบิลก่อน');
  const rateKey = `payable-user:${Number(user?.id) || 'anon'}`;
  checkOcrRateLimit(rateKey, { dryRun: true });
  checkOcrRateLimit(rateKey);
  await db.query(`UPDATE receiving_payable_bills SET ocr_status = 'pending' WHERE id = ?`, [billId]);
  let result;
  try {
    const hints = await readHints(db, row.supplier_key);
    const complexModel = String(globalThis.process?.env?.RECEIVING_OCR_MODEL_COMPLEX || '').trim();
    result = await read({ images, document: { supplier_name_text: row.supplier_name }, knownAliases: hints.knownAliases,
      billFormatNote: hints.billFormatNote, billRefPattern: hints.billRefPattern, ...(hints.complex && complexModel ? { model: complexModel } : {}) });
  } catch (error) {
    await db.query(`UPDATE receiving_payable_bills SET ocr_status = 'failed' WHERE id = ?`, [billId]);
    throw error;
  }
  const bill = billFromRead(result);
  const warnings = await warningsFor(db, row, bill);
  await db.query(`UPDATE receiving_payable_bills SET doc_ref = ?, doc_date = ?, subtotal = ?, discount = ?, vat = ?, total = ?, total_source = ?,
    shop_name_read = ?, doc_kind = ?, lines_json = ?, warnings_json = ?, ocr_status = 'done', ocr_model = ?, period = ? WHERE id = ?`,
  [bill.doc_ref, bill.doc_date, bill.subtotal, bill.discount, bill.vat, bill.total, bill.total_source, bill.shop_name_read, bill.doc_kind,
    JSON.stringify(bill.lines), JSON.stringify(warnings), String(result?.model || '').slice(0, 80) || null, billPeriod(bill.doc_date), billId]);
  return getBill(db, { user, id: String(billId) });
}

export async function updateBill(db, { user, id, body }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  const row = await loadRow(db, billId);
  if (row.status === 'void') fail('บิลนี้ถูกลบแล้ว', 'NOT_DRAFT');
  let edits;
  try { edits = editsFromBody(body); } catch (error) { throw createReceivingError('VALIDATION_FAILED', error.message); }
  const next = { ...view(row), ...edits };
  const bill = { ...next, total_source: 'total' in edits ? 'bill' : next.total_source, line_sum: (next.lines || []).some(line => line.amount !== null)
    ? Math.round(next.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) * 100) / 100 : null };
  const warnings = await warningsFor(db, row, bill);
  await db.query(`UPDATE receiving_payable_bills SET doc_ref = ?, doc_date = ?, subtotal = ?, discount = ?, vat = ?, total = ?, total_source = ?,
    note = ?, status = ?, warnings_json = ?, period = ? WHERE id = ?`,
  [bill.doc_ref, bill.doc_date, bill.subtotal, bill.discount, bill.vat, bill.total, bill.total_source, bill.note, bill.status,
    JSON.stringify(warnings), billPeriod(bill.doc_date, row.created_at ? new Date(row.created_at) : new Date()), billId]);
  return getBill(db, { user, id: String(billId) });
}

export async function voidBill(db, { user, id }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  await loadRow(db, billId);
  await db.query(`UPDATE receiving_payable_bills SET status = 'void' WHERE id = ?`, [billId]);
  return { id: billId, status: 'void' };
}

const periodOf = value => {
  if (value === undefined || value === null || value === '') return bangkokPeriod();
  if (!validPeriod(value)) fail('เดือนไม่ถูกต้อง');
  return value;
};

export async function summary(db, { user, query = {} }) {
  assertPayablesUser(user);
  const period = periodOf(query.period);
  const [rows] = await db.query(`SELECT supplier_key, supplier_name, status, total FROM receiving_payable_bills WHERE period = ? AND status <> 'void'`, [period]);
  return { period, ...summarize(rows) };
}

export async function listBills(db, { user, query = {} }) {
  assertPayablesUser(user);
  const period = periodOf(query.period);
  const params = [period];
  let where = `period = ? AND status <> 'void'`;
  if (query.supplier_key) { where += ' AND supplier_key = ?'; params.push(parseKey(query.supplier_key).key); }
  const [rows] = await db.query(`SELECT * FROM receiving_payable_bills WHERE ${where} ORDER BY doc_date IS NULL, doc_date DESC, id DESC LIMIT 500`, params);
  return { period, items: rows.map(row => view(row)) };
}

export async function pageImage(db, { user, id, page }) {
  assertPayablesUser(user);
  const billId = positiveId(id);
  const pageNo = Number(page);
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > MAX_PAYABLE_PAGES) fail('ไม่พบหน้าบิล', 'NOT_FOUND');
  const [rows] = await db.query('SELECT mime_type, image_data FROM receiving_payable_bill_images WHERE bill_id = ? AND page_no = ?', [billId, pageNo]);
  if (!rows.length) fail('ไม่พบหน้าบิล', 'NOT_FOUND');
  return { mime: rows[0].mime_type, data: rows[0].image_data };
}
