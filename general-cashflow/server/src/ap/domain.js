// All accounting arithmetic uses integer satang. API/SQL money is decimal text.
export const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });
export function cents(value) {
  const match = /^(\-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw fail('INVALID_MONEY');
  const n = Number(BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'))) * (match[1] ? -1 : 1);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 99999999999999) throw fail('MONEY_OVERFLOW');
  return n;
}
export function decimal(n) {
  if (!Number.isSafeInteger(n)) throw fail('MONEY_OVERFLOW');
  return `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
}
export function sum(values) {
  return values.reduce((a, b) => { const n = a + b; if (!Number.isSafeInteger(n)) throw fail('MONEY_OVERFLOW'); return n; }, 0);
}
export const normalize = v => String(v || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
  .replace(/บจก\.|หจก\.|บริษัท|จำกัด|\(มหาชน\)|ร้าน/g, '');
export function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail('INVALID_DATE');
  return value;
}
export function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') || Number(month.slice(0, 4)) < 1000) throw fail('INVALID_MONTH');
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
export function dueDate(received) {
  date(received);
  const [y, m, d] = received.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + (d > 15 ? 1 : 0), d > 15 ? 5 : 20)).toISOString().slice(0, 10);
}
export function paymentPeriod(paid, creditSupplier) {
  date(paid);
  const [y, m, d] = paid.split('-').map(Number);
  return creditSupplier && [5, 6].includes(d) ? new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) : paid.slice(0, 7);
}
export const isPassThrough = value => /(?:พี่เก้ง|ร้านเนื้อย่าง)/.test(String(value || ''));
export function vatInclusive(amount, fullTaxInvoice = false) {
  const gross = cents(amount);
  if (gross <= 0) throw fail('AMOUNT_MUST_BE_POSITIVE');
  const tax = fullTaxInvoice ? Number((BigInt(gross) * 7n + 53n) / 107n) : 0;
  return { gross, tax, cost: gross - tax, flags: fullTaxInvoice ? [] : ['VAT_EVIDENCE_MISSING_INCLUDED_IN_COST'] };
}
export function validateJournal(journal) {
  date(journal.date);
  if (!journal.key || !journal.branch || !Array.isArray(journal.lines) || journal.lines.length < 2) throw fail('INVALID_JOURNAL');
  const dr = [], cr = [];
  for (const l of journal.lines) {
    const d = cents(l.dr || '0'), c = cents(l.cr || '0');
    if (!l.account || d < 0 || c < 0 || (d > 0) === (c > 0)) throw fail('INVALID_JOURNAL_LINE');
    dr.push(d); cr.push(c);
  }
  if (sum(dr) !== sum(cr)) throw fail('UNBALANCED_JOURNAL');
  return journal;
}
const line = (account, dr, cr, supplier = null) => ({ account, dr: decimal(dr), cr: decimal(cr), supplier });
export function postDocument(doc) {
  const amount = cents(doc.amount);
  if (amount <= 0) throw fail('AMOUNT_MUST_BE_POSITIVE');
  const pass = isPassThrough(`${doc.supplierName || ''} ${doc.description || ''}`);
  const j = { key: doc.key, sourceKey: doc.sourceKey || doc.key, date: date(doc.date), branch: doc.branch, type: doc.type, supplier: doc.supplier || null,
    description: doc.description || '', dueDate: null, flags: [], lines: [] };
  const costAccount = pass ? 'PASS_THROUGH' : (doc.costAccount || 'COGS_FOOD');
  const cash = doc.paymentAccount || 'PAYMENT_UNASSIGNED';
  if (pass) j.flags.push('PASS_THROUGH_NOT_EXPENSE');
  if (['bill', 'payment', 'opening'].includes(doc.type) && !doc.supplier) throw fail('SUPPLIER_REQUIRED');
  if (doc.type === 'bill' || doc.type === 'cash_purchase') {
    const vat = vatInclusive(doc.amount, !pass && doc.fullTaxInvoice === true);
    j.flags.push(...vat.flags);
    j.lines = [line(costAccount, vat.cost, 0, j.supplier)];
    if (vat.tax) j.lines.push(line('INPUT_VAT', vat.tax, 0));
    j.lines.push(line(doc.type === 'bill' ? 'AP' : cash, 0, amount, doc.type === 'bill' ? j.supplier : null));
    if (doc.type === 'bill') j.dueDate = dueDate(doc.date);
  } else if (doc.type === 'payment') {
    j.lines = [line('AP', amount, 0, j.supplier), line(cash, 0, amount)];
    j.purchasePeriod = paymentPeriod(doc.date, true);
    if (j.purchasePeriod !== doc.date.slice(0, 7)) j.flags.push('PAYMENT_FOR_PREVIOUS_MONTH');
  } else if (doc.type === 'opening') j.lines = [line('OPENING_CLEARING', amount, 0), line('AP', 0, amount, j.supplier)];
  else throw fail('UNSUPPORTED_DOCUMENT');
  if (cash === 'PAYMENT_UNASSIGNED' && ['cash_purchase', 'payment'].includes(doc.type)) j.flags.push('PAYMENT_ACCOUNT_NOT_EVIDENCED');
  return validateJournal(j);
}
// Returns, credit notes and voids append a dated, linked reversal. Never delete history.
export function reverseJournal(original, { key, date: reversalDate, reason, amount = null }) {
  validateJournal(original);
  if (!key || key === original.key || !reason?.trim() || date(reversalDate) < original.date) throw fail('REVERSAL_REASON_DATE_REQUIRED');
  const total = sum(original.lines.map(l => cents(l.dr)));
  const target = amount == null ? total : cents(amount);
  if (target <= 0 || target > total) throw fail('INVALID_REVERSAL_AMOUNT');
  // Partial credit notes require explicit account allocations; do not prorate tax silently.
  if (target !== total) throw fail('PARTIAL_CREDIT_REQUIRES_EXPLICIT_LINES');
  return validateJournal({ ...original, key, date: reversalDate, type: 'reversal', reverses: original.key, description: reason,
    lines: original.lines.map(l => ({ ...l, dr: l.cr, cr: l.dr })) });
}
export function uniqueDocuments(documents) {
  const seen = new Map();
  for (const doc of documents) {
    const key = doc.canonicalKey || doc.sourceKey || doc.key;
    if (!key) throw fail('SOURCE_KEY_REQUIRED');
    if (seen.has(key)) {
      const prior = seen.get(key);
      if (cents(prior.amount) !== cents(doc.amount) || prior.branch !== doc.branch || prior.date !== doc.date || prior.type !== doc.type || prior.supplier !== doc.supplier) throw fail('CONFLICTING_SOURCE_KEY');
    } else seen.set(key, doc);
  }
  return [...seen.values()];
}
// Isolated adapter contract: no network access or dependency on the receiving APK.
// itemKey must be the same stable order_items key on all three documents.
export function threeWayMatch({ order_items, receiving_documents, bill_items }) {
  if (![order_items, receiving_documents, bill_items].every(Array.isArray)) return { status: 'pending', differences: [{ reason: 'MISSING_DOCUMENT' }] };
  const qty = v => {
    if (!/^\d+(?:\.\d{1,6})?$/.test(String(v))) throw fail('INVALID_QUANTITY');
    const [a, b = ''] = String(v).split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0'));
  };
  const group = items => {
    const map = new Map();
    for (const item of items) {
      if (!item.itemKey || map.has(item.itemKey)) throw fail('DUPLICATE_OR_MISSING_ITEM_KEY');
      map.set(item.itemKey, { qty: qty(item.quantity), price: cents(item.unitPrice), unit: item.unit });
    }
    return map;
  };
  const [o, r, b] = [order_items, receiving_documents, bill_items].map(group), differences = [];
  for (const key of new Set([...o.keys(), ...r.keys(), ...b.keys()])) {
    const a = o.get(key), c = r.get(key), d = b.get(key);
    if (!a || !c || !d) differences.push({ itemKey: key, reason: 'MISSING_ITEM' });
    else {
      if (!a.unit || a.unit !== c.unit || a.unit !== d.unit) differences.push({ itemKey: key, reason: 'UNIT_MISMATCH' });
      if (a.qty !== c.qty || c.qty !== d.qty) differences.push({ itemKey: key, reason: 'QUANTITY_MISMATCH', order: String(a.qty), received: String(c.qty), billed: String(d.qty), scale: 1000000 });
      if (a.price !== d.price || c.price !== d.price) differences.push({ itemKey: key, reason: 'PRICE_MISMATCH', order: decimal(a.price), received: decimal(c.price), billed: decimal(d.price) });
    }
  }
  return { status: differences.length || !o.size ? 'pending' : 'matched', differences: o.size ? differences : [{ reason: 'EMPTY_DOCUMENT' }] };
}
export function trialBalance(journals, { from, to, branch = '' }) {
  const rows = new Map();
  for (const j of journals.filter(j => j.date <= to && (!branch || j.branch === branch))) {
    validateJournal(j);
    for (const l of j.lines) {
      const row = rows.get(l.account) || { account: l.account, opening: 0, dr: 0, cr: 0 };
      if (j.date < from) row.opening = sum([row.opening, cents(l.dr), -cents(l.cr)]);
      else { row.dr = sum([row.dr, cents(l.dr)]); row.cr = sum([row.cr, cents(l.cr)]); }
      rows.set(l.account, row);
    }
  }
  return [...rows.values()].map(r => ({ account: r.account, opening: decimal(r.opening), dr: decimal(r.dr), cr: decimal(r.cr), closing: decimal(sum([r.opening, r.dr, -r.cr])) }));
}
export function supplierLedger({ journals, suppliers, from, to, branch = '', complete = false }) {
  return suppliers.filter(s => !branch || s.branch === branch).map(s => {
    let opening = 0, purchases = 0, paid = 0, other = 0;
    const invoices = [], payments = [];
    const relevant = journals.filter(j => j.branch === s.branch && j.date <= to).sort((a,b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    const reversed = new Set(relevant.filter(j => j.reverses).map(j => j.reverses));
    for (const j of relevant) {
      const movement = sum(j.lines.filter(l => l.account === 'AP' && l.supplier === s.key).map(l => cents(l.cr) - cents(l.dr)));
      if (!movement) continue;
      if (j.date < from) opening = sum([opening, movement]);
      else if (j.type === 'bill') purchases = sum([purchases, movement]);
      else if (j.type === 'payment') paid = sum([paid, -movement]);
      else other = sum([other, movement]);
      // Full linked reversals cancel the original lot, not another invoice through FIFO.
      if (reversed.has(j.key) || j.reverses) continue;
      const due = j.dueDate || (j.type === 'opening' && j.flags?.includes('OPENING_AGE_FROM_AS_OF_DATE') ? j.date : null);
      if (movement > 0) invoices.push({ amount: movement, due }); else payments.push(-movement);
    }
    // FIFO is a report allocation only; absent opening/invoice evidence keeps aging unknown.
    let remainingPayment = sum(payments);
    const ages = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91plus: 0 };
    let agingKnown = complete;
    for (const inv of invoices) {
      const settled = Math.min(inv.amount, remainingPayment); remainingPayment -= settled;
      const outstanding = inv.amount - settled;
      if (!inv.due && outstanding) { agingKnown = false; continue; }
      const days = inv.due ? Math.floor((Date.parse(to) - Date.parse(inv.due)) / 86400000) : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'days1_30' : days <= 60 ? 'days31_60' : days <= 90 ? 'days61_90' : 'days91plus';
      ages[bucket] = sum([ages[bucket], outstanding]);
    }
    const movement = sum([purchases, -paid, other]);
    return { ...s, opening: complete ? decimal(opening) : null, purchases: complete ? decimal(purchases) : null, observedPurchases: decimal(purchases), paid: decimal(paid), adjustments: decimal(other), movement: decimal(movement),
      closing: complete ? decimal(sum([opening, movement])) : null, aging: agingKnown ? Object.fromEntries(Object.entries(ages).map(([k, v]) => [k, decimal(v)])) : null,
      advance: complete ? decimal(remainingPayment) : null };
  });
}
