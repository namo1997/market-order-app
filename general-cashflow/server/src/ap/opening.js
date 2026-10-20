import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { cents, decimal, monthRange, date, fail, postDocument, reverseJournal } from './domain.js';

export const OPENING_HEADERS = ['สาขา', 'รหัสซัพ', 'ชื่อซัพ', 'ยอดยกมา (บาท)', 'วันที่ยกมา', 'หมายเหตุ'];
export const openingDate = month => new Date(Date.parse(`${monthRange(month).from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
export function openingTemplate(suppliers, month) {
  return '\uFEFF' + [OPENING_HEADERS, ...suppliers.map(s => [s.branch, s.key, s.name, '', openingDate(month), ''])]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// An import replaces the whole period, including omitted/blank suppliers. Blank is unknown; 0 is confirmed zero.
export function parseOpeningCsv(input, { suppliers, month }) {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  let rows;
  try { rows = parse(text, { bom: true, skip_empty_lines: true, trim: true }); }
  catch { throw fail('AP_OPENING_INVALID_CSV'); }
  if (JSON.stringify(rows.shift()) !== JSON.stringify(OPENING_HEADERS)) throw fail('AP_OPENING_INVALID_HEADERS');
  const expectedDate = openingDate(month), registry = new Map(suppliers.map(s => [s.key, s]));
  const seen = new Set(), entries = [];
  for (const [i, row] of rows.entries()) {
    const bad = code => { throw Object.assign(fail(code), { csvRow: i + 2 }); };
    if (row.length !== OPENING_HEADERS.length) bad('AP_OPENING_INVALID_COLUMNS');
    const [branch, key, name, amount, asOf, note] = row, supplier = registry.get(key);
    if (!supplier || supplier.branch !== branch) bad('AP_OPENING_UNKNOWN_SUPPLIER');
    if (supplier.name !== name) bad('AP_OPENING_SUPPLIER_NAME_MISMATCH');
    if (seen.has(key)) bad('AP_OPENING_DUPLICATE_SUPPLIER');
    seen.add(key);
    try { date(asOf); } catch { bad('AP_OPENING_INVALID_DATE'); }
    if (asOf !== expectedDate) bad('AP_OPENING_WRONG_DATE');
    if (note.length > 1000) bad('AP_OPENING_NOTE_TOO_LONG');
    if (amount === '') continue;
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) bad('AP_OPENING_INVALID_AMOUNT');
    let value;
    try { value = decimal(cents(amount)); } catch { bad('AP_OPENING_INVALID_AMOUNT'); }
    entries.push({ supplier: key, branch, amount: value, date: asOf, note });
  }
  entries.sort((a, b) => a.supplier.localeCompare(b.supplier, 'en'));
  const missing = suppliers.filter(s => !entries.some(e => e.supplier === s.key));
  // Semantic fingerprint: BOM/quoting/order/newlines do not change the economic input.
  const fingerprint = createHash('sha256').update(JSON.stringify({ month, entries })).digest('hex');
  return { month, date: expectedDate, entries, missing, fingerprint };
}

export function openingJournals(input, { id, previous = [] }) {
  const sourceKey = branch => `ap:opening:${id}:${branch}`;
  const reversals = previous.map(j => ({ ...reverseJournal(j, {
    key: `ap:opening:${id}:reverse:${j.key}`, date: input.date, reason: 'แทนที่ยอดยกมาด้วย CSV ฉบับใหม่'
  }), sourceKey: sourceKey(j.branch) }));
  const journals = input.entries.filter(e => cents(e.amount) > 0).map(e => {
    const j = postDocument({ key: `ap:opening:${id}:${e.supplier}`, sourceKey: sourceKey(e.branch),
      type: 'opening', supplier: e.supplier, branch: e.branch, date: e.date, amount: e.amount,
      description: e.note || 'ยอดเจ้าหนี้ยกมาที่เจ้าของกรอก' });
    // This is a baseline-age estimate, not an invented invoice due date.
    j.flags.push('OPENING_AGE_FROM_AS_OF_DATE');
    return j;
  });
  return { journals, reversals };
}
