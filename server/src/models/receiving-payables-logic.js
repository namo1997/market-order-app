// Owner 2026-11-02 "ระบบรวบรวมเจ้าหนี้": accounting picks a supplier, photographs a bill, and the AI reads it with
// quantities and prices straight away (no blind count, no stock). The goal is the amount owed per supplier this month.
// Pure helpers only: no database, no network — shared by the model and its tests.

export const PAYABLE_STATUSES = ['draft', 'saved', 'void'];
export const MAX_PAYABLE_PAGES = 5;

// Bangkok calendar month of a moment, as YYYY-MM.
export const bangkokPeriod = (now = new Date()) => new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);

export const validPeriod = value => typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);

// A bill belongs to the month printed on it; a bill with no readable date belongs to the month it was photographed.
export const billPeriod = (docDate, capturedAt = new Date()) =>
  typeof docDate === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(docDate) ? docDate.slice(0, 7) : bangkokPeriod(capturedAt);

const money = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
};
const qty = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
};
const text = (value, max) => {
  const clean = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};

// The read keeps what the bill says. Each row's amount falls back to quantity × price; the bill total falls back to
// the sum of the rows and is then marked as computed so the person checks it.
export function billFromRead(read = {}) {
  const lines = (Array.isArray(read.lines) ? read.lines : []).slice(0, 200).map((line, index) => {
    const quantity = qty(line?.quantity_billed ?? line?.quantity);
    const unitPrice = money(line?.unit_price);
    const amount = money(line?.amount) ?? (quantity !== null && unitPrice !== null ? money(quantity * unitPrice) : null);
    return { line_no: index + 1, bill_text: text(line?.bill_text ?? line?.text, 255) || '', quantity, unit: text(line?.unit_text ?? line?.unit, 50), unit_price: unitPrice, amount };
  }).filter(line => line.bill_text || line.amount !== null);
  const lineSum = lines.some(line => line.amount !== null) ? money(lines.reduce((sum, line) => sum + (line.amount || 0), 0)) : null;
  const printedTotal = money(read.total);
  const total = printedTotal ?? lineSum;
  const docDate = typeof read.doc_date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(read.doc_date) ? read.doc_date : null;
  return {
    doc_ref: text(read.doc_ref, 100), doc_date: docDate,
    subtotal: money(read.subtotal), discount: money(read.discount), vat: money(read.vat), total,
    total_source: printedTotal !== null ? 'bill' : lineSum !== null ? 'lines' : 'none',
    shop_name_read: text(read.supplier_name, 255), doc_kind: text(read.doc_kind, 30) || 'bill',
    lines, line_sum: lineSum,
  };
}

const refKey = value => String(value ?? '').normalize('NFC').toUpperCase().replace(/[\s\-_/.#]+/g, '');

// Notes the person sees before saving. Short Thai, one line each.
export function payableWarnings(bill, { duplicates = [], received = [] } = {}) {
  const warnings = [];
  if (bill.doc_kind && bill.doc_kind !== 'bill') warnings.push({ code: 'NOT_A_BILL', message: bill.doc_kind === 'statement' ? 'อาจเป็นใบวางบิล/ใบสรุปยอด ไม่ใช่บิลรายใบ' : 'อาจไม่ใช่บิล ตรวจรูปอีกครั้ง' });
  if (bill.total === null || bill.total === undefined) warnings.push({ code: 'NO_TOTAL', message: 'อ่านยอดรวมไม่ได้ กรอกยอดเอง' });
  else if (bill.total_source === 'lines') warnings.push({ code: 'TOTAL_FROM_LINES', message: 'ยอดรวมคิดจากรายการ ตรวจกับบิล' });
  if (bill.total_source === 'bill' && bill.line_sum !== null && bill.line_sum !== undefined && Math.abs(Number(bill.line_sum) - Number(bill.total)) > 1
    && !(bill.vat && Math.abs(Number(bill.line_sum) + Number(bill.vat) - Number(bill.discount || 0) - Number(bill.total)) <= 1)) {
    warnings.push({ code: 'SUM_MISMATCH', message: `รวมรายการ ${Number(bill.line_sum).toFixed(2)} ไม่ตรงยอดบิล ${Number(bill.total).toFixed(2)}` });
  }
  if (!bill.doc_ref) warnings.push({ code: 'NO_REF', message: 'ไม่พบเลขที่บิล' });
  for (const other of duplicates) warnings.push({ code: 'DUPLICATE', bill_id: other.id, message: `บิลซ้ำ? เลขที่เดียวกันบันทึกแล้ว${other.doc_date ? ` (${other.doc_date})` : ''}${other.total !== null && other.total !== undefined ? ` ยอด ${Number(other.total).toFixed(2)}` : ''}` });
  for (const doc of received) warnings.push({ code: 'RECEIVED', document_id: doc.id, message: `บิลนี้รับของแล้วในใบรับ #${doc.id}` });
  return warnings;
}

export const sameRef = (a, b) => !!refKey(a) && refKey(a) === refKey(b);

// Edits from the review form. Only these fields; amounts must be numbers ≥ 0.
export function editsFromBody(body = {}) {
  const allowed = ['doc_ref', 'doc_date', 'total', 'subtotal', 'discount', 'vat', 'note', 'status'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('รูปแบบข้อมูลไม่ถูกต้อง'), { code: 'VALIDATION_FAILED' });
  const unknown = Object.keys(body).filter(key => !allowed.includes(key));
  if (unknown.length) throw Object.assign(new Error('มีฟิลด์ที่ไม่รองรับ'), { code: 'VALIDATION_FAILED' });
  const edits = {};
  if ('doc_ref' in body) edits.doc_ref = text(body.doc_ref, 100);
  if ('note' in body) edits.note = text(body.note, 500);
  if ('doc_date' in body) {
    if (body.doc_date !== null && body.doc_date !== '' && !(typeof body.doc_date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(body.doc_date))) throw Object.assign(new Error('วันที่บิลไม่ถูกต้อง'), { code: 'VALIDATION_FAILED' });
    edits.doc_date = body.doc_date || null;
  }
  for (const key of ['total', 'subtotal', 'discount', 'vat']) {
    if (!(key in body)) continue;
    if (body[key] === null || body[key] === '') { edits[key] = null; continue; }
    const value = money(body[key]);
    if (value === null || value < 0 || value > 99999999.99) throw Object.assign(new Error('จำนวนเงินไม่ถูกต้อง'), { code: 'VALIDATION_FAILED' });
    edits[key] = value;
  }
  if ('status' in body) {
    if (!['draft', 'saved'].includes(body.status)) throw Object.assign(new Error('สถานะไม่ถูกต้อง'), { code: 'VALIDATION_FAILED' });
    edits.status = body.status;
  }
  return edits;
}

// Owed per supplier for a month: saved bills only; drafts are counted apart so nothing photographed is lost.
export function summarize(rows = []) {
  const shops = new Map();
  let total = 0, bills = 0, drafts = 0, missingTotals = 0;
  for (const row of rows) {
    if (row.status === 'void') continue;
    const shop = shops.get(row.supplier_key) || { supplier_key: row.supplier_key, supplier_name: row.supplier_name, bill_count: 0, draft_count: 0, total: 0, missing_total_count: 0 };
    if (row.status === 'draft') { shop.draft_count += 1; drafts += 1; }
    else {
      shop.bill_count += 1; bills += 1;
      if (row.total === null || row.total === undefined) { shop.missing_total_count += 1; missingTotals += 1; }
      else { shop.total = Math.round((shop.total + Number(row.total)) * 100) / 100; total = Math.round((total + Number(row.total)) * 100) / 100; }
    }
    shops.set(row.supplier_key, shop);
  }
  return { shops: [...shops.values()].sort((a, b) => b.total - a.total || a.supplier_name.localeCompare(b.supplier_name, 'th')), total, bill_count: bills, draft_count: drafts, missing_total_count: missingTotals };
}
