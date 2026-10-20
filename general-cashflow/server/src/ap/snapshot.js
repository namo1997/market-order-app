import { lbcInvoiceFacts } from './lbcInvoiceFacts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { cents, decimal, sum, normalize, isPassThrough, paymentPeriod, postDocument, uniqueDocuments, monthRange } from './domain.js';
import { buildReport } from '../pnl/report.js';
import { classify } from '../pnl/domain.js';

// Explicit financial allowlist: never load users, credentials, attachments or grants.
export const TABLES = ['branches', 'receiving_accounts', 'payment_channels', 'pnl_expense_items', 'pnl_expense_rounds',
  'pnl_credit_suppliers', 'pnl_categories', 'pnl_category_rules', 'pnl_item_overrides', 'pnl_manual_expenses',
  'pnl_recurring_expenses', 'pnl_recurring_skips', 'statement_transactions', 'statement_imports', 'pnl_social_security_payments'];
const REQUIRED_TABLES = new Set(['branches', 'receiving_accounts', 'pnl_expense_items', 'pnl_expense_rounds', 'pnl_credit_suppliers',
  'pnl_categories', 'pnl_category_rules', 'pnl_item_overrides', 'pnl_manual_expenses', 'pnl_recurring_expenses', 'statement_transactions', 'statement_imports']);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const safeText = v => String(v || '').replace(/(?:\d[ -]?){9,}/g, '[ปกปิดเลข]').slice(0, 800);
const object = v => typeof v === 'string' ? JSON.parse(v) : v || {};
export async function readSnapshot(root) {
  if (!(await fs.realpath(root)).startsWith('/Volumes/SSD Files/SOLAO/')) throw new Error('SNAPSHOT_MUST_BE_ON_SSD');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const data = {}, checksums = {};
  for (const name of TABLES) {
    const table = manifest.tables.find(t => t.name === name);
    if (!table) {
      if (REQUIRED_TABLES.has(name)) throw new Error('AP_SNAPSHOT_REQUIRED_TABLE_MISSING');
      data[name] = []; continue;
    }
    if (table.file !== `${name}.rows.json.gz`) throw new Error('INVALID_SNAPSHOT_PATH');
    const bytes = await fs.readFile(path.join(root, table.file));
    if (hash(bytes) !== table.sha256) throw new Error('SNAPSHOT_CHECKSUM_FAILED');
    data[name] = JSON.parse(gunzipSync(bytes));
    if (data[name].length !== table.row_count) throw new Error('SNAPSHOT_COUNT_FAILED');
    checksums[name] = table.sha256;
  }
  return { data, checksums, capturedAt: manifest.snapshot_at_utc };
}

// Never match on amount alone, nor assume that positive statement money is a debit.
export function statementDirection(row) {
  const raw = object(row.raw_payload);
  const positive = key => raw[key] != null && /^\d+(?:\.\d{1,2})?$/.test(String(raw[key]).replaceAll(',', '')) && cents(String(raw[key]).replaceAll(',', '')) > 0;
  const debit = ['debit', 'Debit', 'withdrawal', 'ยอดถอน'].some(positive);
  const credit = ['credit', 'Credit', 'ยอดฝาก', 'Krungthai Credit Amount', 'Net Transaction amount'].some(positive);
  if (debit && credit) return 'unknown';
  if (debit) return 'outgoing';
  if (credit || row.receipt_line_id != null || row.payment_channel_id != null) return 'incoming';
  return 'unknown';
}

export function compileSnapshot({ data, checksums = {}, capturedAt }, month) {
  const { from, to } = monthRange(month);
  const branches = data.branches.map(b => ({ id: String(b.id), code: b.code, name: b.name }));
  const branchFor = id => branches.find(b => b.id === String(id))?.code || 'UNASSIGNED';
  const overrides = new Map(data.pnl_item_overrides.map(o => [o.stable_key, o]));
  const rules = data.pnl_category_rules;
  const closed = new Set(data.pnl_expense_rounds.filter(r => r.status === 'closed').map(r => String(r.id)));
  const credit = data.pnl_credit_suppliers.filter(s => Number(s.active));
  const suppliers = [], sources = [], journals = [], seen = new Map();
  // Only a supplier reference is available; do not claim there are receiving invoices.
  for (const b of branches) for (const s of credit) suppliers.push({ key: `credit:${b.code}:${s.id}`, branch: b.code, name: safeText(s.display_name), reference: `pnl_credit_suppliers:${s.id}` });
  const sourceItems = data.pnl_expense_items.filter(i => i.business_date >= from && i.business_date <= to);
  let duplicateCount = 0;
  for (const item of sourceItems) {
    const canonicalKey = item.bill_id ? `lbc:bill:${item.bill_id}` : item.stable_key;
    const branch = branchFor(item.branch_id);
    const facts = JSON.stringify([item.business_date, branch, item.amount, item.payment_method, item.transaction_type, item.supplier_name, item.description]);
    if (seen.has(canonicalKey)) { if (seen.get(canonicalKey) !== facts) throw new Error('CONFLICTING_SOURCE_KEY'); duplicateCount++; continue; }
    seen.set(canonicalKey, facts);
    const classified = classify(item, rules, overrides.get(item.stable_key));
    const text = normalize(`${item.supplier_name || ''} ${item.description || ''}`);
    const matches = credit.filter(s => s.pattern && text.includes(normalize(s.pattern)));
    // Prefer the longest pattern, but preserve ambiguity for a reviewer.
    matches.sort((a, b) => normalize(b.pattern).length - normalize(a.pattern).length || Number(a.id) - Number(b.id));
    const supplier = matches[0];
    const pass = isPassThrough(`${item.supplier_name || ''} ${item.description || ''}`);
    const active = closed.has(String(item.round_id));
    const status = !active ? 'OPEN_ROUND' : pass ? 'PASS_THROUGH' : supplier && matches.length === 1 ? 'CREDIT_PAYMENT' :
      matches.length > 1 ? 'AMBIGUOUS_SUPPLIER' : classified.excluded ? 'PNL_EXCLUDED' : item.transaction_type === 'purchase' ? 'PAID_PURCHASE' : 'REVIEW_TRANSACTION';
    const source = { ...lbcInvoiceFacts(typeof item.raw_json === 'string' ? JSON.parse(item.raw_json) : item.raw_json || item), key: canonicalKey, nativeKey: item.stable_key, branch, date: item.business_date, amount: decimal(cents(item.amount)),
      sourceType: 'LBC', supplier: supplier ? `credit:${branch}:${supplier.id}` : null, supplierName: safeText(item.supplier_name),
      description: safeText(item.description), paymentMethod: item.payment_method, transactionType: item.transaction_type,
      category: classified.category_code, status, period: overrides.get(item.stable_key)?.period_month?.slice(0, 7) || item.business_date.slice(0, 7),
      pnlExcluded: classified.excluded, flags: ['RECEIVING_DATE_MISSING', 'THREE_WAY_DOCUMENTS_MISSING'] };
    if (supplier) source.purchasePeriod = paymentPeriod(item.business_date, true);
    if (matches.length > 1) source.flags.push('SUPPLIER_AMBIGUOUS');
    sources.push(source);
    if (!['CREDIT_PAYMENT', 'PAID_PURCHASE', 'PASS_THROUGH'].includes(status) || cents(source.amount) <= 0) continue;
    const journal = postDocument({ key: `${canonicalKey}:${status === 'CREDIT_PAYMENT' ? 'payment' : 'paid'}`, sourceKey: canonicalKey,
      date: source.date, branch, amount: source.amount, supplier: source.supplier, supplierName: source.supplierName, description: source.description,
      type: status === 'CREDIT_PAYMENT' ? 'payment' : 'cash_purchase', paymentAccount: item.payment_method === 'cash' ? 'CASH' : item.payment_method === 'bank_transfer' ? 'BANK_UNASSIGNED' : 'PAYMENT_UNASSIGNED',
      costAccount: classified.category_code || 'OTHER' });
    journal.flags.push('PROVISIONAL_PAID_EVIDENCE', ...(status === 'CREDIT_PAYMENT' ? ['OPENING_AND_RECEIVING_INVOICES_MISSING'] : ['ACCRUAL_DATE_UNVERIFIED']));
    if (item.payment_method === 'bank_transfer') journal.flags.push('BANK_ACCOUNT_NOT_EVIDENCED');
    journals.push(journal);
  }
  uniqueDocuments(journals);
  const statements = data.statement_transactions.filter(r => r.transaction_date >= from && r.transaction_date <= to).map(r => {
    const imp = data.statement_imports.find(i => String(i.id) === String(r.import_id));
    const account = data.receiving_accounts.find(a => String(a.id) === String(r.receiving_account_id || imp?.receiving_account_id));
    return { key: `cashflow:statement:${r.id}`, date: r.transaction_date, branch: branchFor(account?.branch_id),
      amount: decimal(cents(r.amount)), direction: statementDirection(r), accountCode: account ? `BANK:${account.id}` : null,
      status: 'UNMATCHED', reason: 'NO_VERIFIED_OUTGOING_SUPPLIER_REFERENCE' };
  });
  // Same existing P&L builder, with snapshot-only inputs and no POS/HRMS/network calls.
  const recurring = data.pnl_recurring_expenses.map(r => ({ ...r, skipped: data.pnl_recurring_skips.some(s => String(s.recurring_id) === String(r.id) && s.month_start === from) }));
  const pnl = buildReport({ month, branches: data.branches, categories: data.pnl_categories, items: data.pnl_expense_items,
    rounds: data.pnl_expense_rounds, overrides: data.pnl_item_overrides, rules, creditSuppliers: credit,
    manual: data.pnl_manual_expenses.filter(r => r.month_start === from), recurring,
    socialSecurityPayments: data.pnl_social_security_payments.filter(r => r.month_start === from), now: new Date(`${to}T23:59:59Z`) });
  const pnlItems = pnl.items.map(r => ({ key: r.stable_key, branch: branchFor(r.branch_id), date: r.business_date, amount: decimal(cents(r.amount)), excluded: r.excluded, category: r.category_code, period: r.period_month }));
  const metadata = { month, capturedAt, checksums, branches, duplicateCount, sourceCount: sourceItems.length,
    policy: 'periodic; payments are not receiving invoices; no automatic bank matches',
    limitations: ['ไม่มีใบรับของและวันรับของ จึงยังสรุปยอดซื้อเกณฑ์คงค้างไม่ได้', 'ไม่มียอดเจ้าหนี้ยกมาที่รับรอง จึงยังสรุปคงค้างและอายุหนี้ไม่ได้',
      'ไม่พบข้อมูลใบกำกับภาษีเต็มรูป จึงไม่แยกภาษีซื้อ', 'P&L เปรียบเทียบเฉพาะ LBC/รายการกรอกเอง/รายจ่ายประจำ/SSO ที่อยู่ใน snapshot ไม่รวม HRMS, POS หรือค่าธรรมเนียมรับเงิน'],
    pnl: { items: pnlItems, manualTotal: decimal(cents(pnl.manual_total)), recurringTotal: decimal(cents(pnl.recurring.total)), socialSecurityTotal: decimal(cents(pnl.social_security_total)),
      branches: pnl.branch_columns.map(b => ({ branch: branches.find(v => v.id === b.key)?.code || b.key,
        amount: decimal(sum([cents(b.cogs), cents(b.opex), cents(b.tax)])) })) },
    accounts: data.receiving_accounts.map(a => ({ code: `BANK:${a.id}`, name: `ธนาคาร · บัญชีระบบ #${a.id}`, nativeId: Number(a.id) })) };
  const payload = { metadata, suppliers, sources, statements, journals };
  return { ...payload, fingerprint: hash(JSON.stringify(payload)) };
}
