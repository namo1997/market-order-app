import { roundMoney, sumMoney } from './money.js';
import { branchSupportsPaymentChannel } from './paymentChannels.js';
import { receiptConfirmationFields } from './receiptClosing.js';
import { receiptStatusLabel } from './receipts.js';

export const overviewToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => datePattern.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const present = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const amount = (n) => present(n) ? roundMoney(n) : null;
const total = (rows, key) => rows.some(r => present(r[key])) ? sumMoney(rows.map(r => r[key])) : null;
const nonzero = (n) => present(n) && Math.abs(Number(n)) >= 0.01;
const json = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}'); } catch { return {}; } };
const inRange = (date, q) => date && date >= q.from && date <= q.to;
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) { const k = row[key]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
  return groups;
};
export const OVERVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION', 'CLOSED', 'MISSING', 'FUTURE', 'PENDING', 'RECEIVED', 'VARIANCE', 'EVIDENCE', 'WAITING_RECEIPT', 'WAITING_EVIDENCE', 'LATE_EVIDENCE'];

export function parseOverviewQuery(input = {}, today = overviewToday()) {
  const from = String(input.from || `${today.slice(0, 7)}-01`);
  const to = String(input.to || new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10));
  if (!validDate(from) || !validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365) fail('เลือกช่วงวันที่ถูกต้อง ไม่เกิน 366 วัน');
  const basis = input.basis || 'sale';
  const tab = input.tab || 'daily';
  if (!['sale', 'received'].includes(basis) || !['daily', 'transactions', 'followups'].includes(tab)) fail('มุมมองรายงานไม่ถูกต้อง');
  const q = { from, to, basis, tab, status: String(input.status || ''), attention: String(input.attention) === 'true' };
  if (q.status && !OVERVIEW_STATUSES.includes(q.status)) fail('สถานะไม่ถูกต้อง');
  for (const key of ['branch_id', 'channel_id', 'account_id', 'receipt_id']) {
    q[key] = input[key] ? Number(input[key]) : null;
    if (q[key] !== null && (!Number.isSafeInteger(q[key]) || q[key] <= 0)) fail('รหัสตัวกรองไม่ถูกต้อง');
  }
  for (const [key, fallback, max] of [['page', 1, 1000000], ['page_size', 50, 100]]) {
    q[key] = input[key] === undefined ? fallback : Number(input[key]);
    if (!Number.isSafeInteger(q[key]) || q[key] < 1 || q[key] > max) fail('หน้ารายงานไม่ถูกต้อง');
  }
  return q;
}

// A matched platform report is not proof of a bank deposit. Classify the
// transaction's own provenance, never the line's most recently assigned source.
export function bankTransactionEvidence(tx) {
  const p = json(tx.raw_payload);
  const source = String(p.source || '').toLowerCase();
  const name = String(tx.import_name || '').toLowerCase();
  if (!['classified', 'matched_auto', 'matched_manual'].includes(tx.match_status)) return false;
  if (!validDate(String(tx.transaction_date || '')) || !present(tx.amount)) return false;
  if (source === 'grab_daily_report' || /kshop|k shop|grab daily|grab report/.test(name) || p.merchant_id && p.body) return false;
  if (source === 'kbank_monthly_grab_statement') return true;
  // Bank parser records retain their original statement fields. Merchant sales
  // summaries and arbitrary manual values do not satisfy this evidence rule.
  return Boolean(
    p.Time && p.Description || p['วันที่'] && (p['เงินฝาก'] !== undefined || p['ฝาก'] !== undefined || p['ฝากเงิน'] !== undefined || p['ยอดฝาก'] !== undefined) ||
    p['Transaction ID'] && p['Transaction paid time'] && p['Net Transaction amount'] !== undefined ||
    p.transaction_type || p.balance !== undefined || p.Balance !== undefined ||
    /histstmt|historical_|statement|รายการเดินบัญชี/.test(name) && tx.account_id
  );
}

function transactionKey(tx) {
  // Import adapters may prefix the receipt id on an otherwise identical bank
  // hash. A repeated physical transaction must not become another cash receipt.
  const p = json(tx.raw_payload);
  const rawHash = p['Transaction ID'] || String(tx.unique_hash || '').match(/[a-f0-9]{64}$/i)?.[0] || String(tx.unique_hash || '').replace(/^\d+-/, '');
  return `${tx.account_id || 'unknown'}|${rawHash || tx.id}|${tx.transaction_date}`;
}

function buildLines(data, today) {
  const txByLine = groupBy(data.transactions || [], 'receipt_line_id');
  const receipts = new Map(data.receipts.map(r => [r.id, r]));
  const seen = new Map();
  const events = [];
  const duplicates = new Set();
  for (const tx of data.transactions || []) {
    if (!bankTransactionEvidence(tx)) continue;
    const key = transactionKey(tx);
    if (seen.has(key)) { duplicates.add(tx.receipt_line_id); duplicates.add(seen.get(key).receipt_line_id); continue; }
    seen.set(key, tx);
    events.push({ ...tx, event_id: `bank:${tx.id}`, received_date: tx.transaction_date, received: amount(tx.amount), evidence_basis: 'รายการธนาคาร', physical_key: key });
  }
  const eventsByLine = groupBy(events, 'receipt_line_id');
  const batchGroups = groupBy(data.lines.filter(l => l.settlement_batch_key), 'settlement_batch_key');
  const batchProof = new Map();
  for (const [key, lines] of batchGroups) {
    const bankTotal = sumMoney(lines.flatMap(l => eventsByLine.get(l.id) || []).map(e => e.received));
    const allocated = sumMoney(lines.map(l => l.settlement_batch_allocated_net_amount));
    batchProof.set(key, lines.every(l => present(l.settlement_batch_allocated_net_amount)) && Math.abs(bankTotal - allocated) < 0.01 && lines.some(l => eventsByLine.has(l.id)));
  }
  const result = data.lines.map(l => {
    const receipt = receipts.get(l.receipt_id);
    if (!receipt || !branchSupportsPaymentChannel(receipt.branch_code, l.channel_code)) return null;
    const submitted = receipt.status !== 'DRAFT';
    const cash = l.channel_code === 'CASH';
    const cashier = submitted ? amount(l.cashier_amount) : null;
    const float = cash ? Number(receipt.morning_change_amount || 0) : 0;
    const hasReference = l.settlement_source && !['NONE', 'MANUAL'].includes(l.settlement_source);
    const referenceKnown = hasReference && (nonzero(l.expected_gross_amount) || nonzero(l.expected_net_amount) || cashier === 0);
    const before = hasReference ? referenceKnown ? amount(l.expected_gross_amount) : null : cashier;
    const fee = cash ? 0 : referenceKnown ? amount(l.fee_amount) : null;
    const expected = cash ? cashier === null ? null : roundMoney(cashier - float)
      : l.settlement_batch_key ? amount(l.settlement_batch_allocated_net_amount)
      : referenceKnown ? amount(l.expected_net_amount)
      : ['qr', 'promptpay'].includes(l.channel_kind) ? cashier : null;
    const lineEvents = eventsByLine.get(l.id) || [];
    const cashChecked = cash && submitted && (Number(l.manual_checked_without_reference) === 1 || ['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(l.settlement_status));
    let received = cashChecked ? roundMoney(Number(l.statement_amount) - float)
      : l.settlement_batch_key ? batchProof.get(l.settlement_batch_key) ? amount(l.settlement_batch_allocated_net_amount) : null
      : total(lineEvents, 'received');
    const noActivity = submitted && cashier === 0 && !nonzero(before) && !lineEvents.length && !nonzero(l.statement_amount) && !nonzero(l.settlement_batch_allocated_net_amount);
    if (noActivity) received = 0;
    const reasons = [];
    const active = !noActivity;
    const variance = received !== null && expected !== null ? roundMoney(received - expected) : null;
    const waitingReceipt = active && !cash && received === null && expected !== null && !['MATCHED_AUTO','MATCHED_MANUAL'].includes(l.settlement_status);
    const receiptState = noActivity ? 'ไม่มีรายการ' : received === null ? cash ? 'รอตรวจนับเงินสด' : waitingReceipt ? 'รอรับเงิน' : 'รอหลักฐานเงินเข้า' : nonzero(variance) ? 'มีส่วนต่าง' : 'ยืนยันยอดรับแล้ว';
    if (active && received === null) reasons.push(receiptState);
    if (active && expected === null) reasons.push('ยังไม่ทราบยอดคาดรับสุทธิ');
    if (nonzero(variance)) reasons.push('ยอดรับเทียบยอดคาดรับไม่ตรง');
    if (cashier !== null && before !== null && Math.abs(cashier - before) >= 0.01) reasons.push('แคชเชียร์เทียบรายงานไม่ตรง');
    if (duplicates.has(l.id)) reasons.push('พบรายการธนาคารซ้ำ ต้องตรวจที่มา');
    if (l.settlement_batch_key && !batchProof.get(l.settlement_batch_key)) reasons.push('หลักฐานชุดโอนยังไม่ครบยอดจัดสรร');
    if (l.exception_note && l.settlement_status === 'EXCEPTION') reasons.push(l.exception_note);
    if (cashChecked && received < 0) reasons.push('เงินตรวจนับต่ำกว่าเงินทอนตั้งต้น');
    const adjustment = sumMoney((data.adjustments || []).filter(a => a.receipt_line_id === l.id).map(a => a.amount));
    const resultLine = {
      id: l.id, receipt_id: l.receipt_id, receipt_date: receipt.receipt_date, branch_id: receipt.branch_id,
      branch_name: receipt.branch_name, branch_code: receipt.branch_code, receipt_status: receipt.status,
      channel_id: l.payment_channel_id, channel_code: l.channel_code, channel_label: l.channel_label,
      account_id: l.receiving_account_id || null, account_label: l.account_label || null,
      cashier, before, fee: l.settlement_batch_key ? amount(l.settlement_batch_allocated_fee_amount) : fee,
      expected, received, variance, cash_float: float, adjustment, line_adjustment: amount(l.reconciliation_adjustment_amount),
      source: l.settlement_source, note: l.exception_note || null, evidence_attachment_id: l.evidence_attachment_id || null,
      batch_key: l.settlement_batch_key || null,
      sale_dates: [...new Set((batchGroups.get(l.settlement_batch_key) || [l]).map(s => receipts.get(s.receipt_id)?.receipt_date).filter(Boolean))].sort(),
      receipt_ids: [...new Set((batchGroups.get(l.settlement_batch_key) || [l]).map(s => s.receipt_id))],
      received_dates: [...new Set((batchGroups.get(l.settlement_batch_key) || [l]).flatMap(s => eventsByLine.get(s.id) || []).map(e => e.received_date))].sort(),
      transactions: (batchGroups.get(l.settlement_batch_key) || [l]).flatMap(s => txByLine.get(s.id) || []).map(t => ({ id: t.id, date: t.transaction_date, amount: amount(t.amount), description: t.description, reference: t.reference_no, import_name: t.import_name, match_status: t.match_status, bank_evidence: bankTransactionEvidence(t) })),
      reasons, attention: active && reasons.length > 0,
      receipt_state: receiptState, money_status: noActivity ? 'NO_ACTIVITY' : received === null ? waitingReceipt ? 'WAITING_RECEIPT' : 'WAITING_EVIDENCE' : nonzero(variance) ? 'VARIANCE' : 'RECEIVED',
      waiting_days: received === null && active ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(receipt.receipt_date)) / 86400000)) : null,
      expected_date: null, // Existing settlement_date mixes inferred and actual dates.
    };
    if (cashChecked && !noActivity) events.push({ event_id: `cash:${l.id}`, receipt_line_id: l.id, received_date: receipt.receipt_date, received, account_id: null, evidence_basis: 'ตรวจนับเงินสดหักเงินทอน', description: 'เงินสดสุทธิจากการตรวจนับ', reference_no: null });
    return resultLine;
  }).filter(Boolean);
  return { lines: result, events };
}

export function buildReceiptsOverview(data, q, { today = overviewToday(), now = new Date().toISOString() } = {}) {
  const { lines, events } = buildLines(data, today);
  const lineMap = new Map(lines.map(l => [l.id, l]));
  const matchLine = l => (!q.branch_id || l.branch_id === q.branch_id) && (!q.channel_id || l.channel_id === q.channel_id) && (!q.account_id || l.account_id === q.account_id || events.some(e => e.receipt_line_id === l.id && e.account_id === q.account_id)) && (!q.receipt_id || l.receipt_id === q.receipt_id);
  const selectedLines = lines.filter(matchLine).map(l => {
    if (!q.account_id || l.batch_key) return l;
    const bankEvents = events.filter(e => e.receipt_line_id === l.id);
    const selectedEvents = bankEvents.filter(e => e.account_id === q.account_id);
    // A line can span receiving accounts. Only physical receipts into the
    // selected account count; its share of cashier/gross/fees is unknown.
    if (bankEvents.some(e => e.account_id !== q.account_id)) return {
      ...l, received: total(selectedEvents, 'received'), cashier:null, before:null, fee:null, expected:null, variance:null,
      account_id:q.account_id, account_label:data.accounts?.find(a=>a.id===q.account_id)?.label || null,
      reasons:[...l.reasons,'ยอดรายงานรวมหลายบัญชี เปิดเอกสารเพื่อดูการจัดสรร'], attention:true,
    };
    return l;
  });
  const eligibleEvents = events.filter(e => {
    const l = lineMap.get(e.receipt_line_id);
    return l && matchLine(l) && (!q.account_id || e.account_id === q.account_id) && inRange(q.basis === 'sale' ? l.receipt_date : e.received_date, q);
  });
  const eventReceiptIds = new Set(eligibleEvents.flatMap(e => lineMap.get(e.receipt_line_id).receipt_ids));
  const receiptLines = groupBy(selectedLines, 'receipt_id');
  const rows = [];
  for (const r of data.receipts) {
    if (q.branch_id && r.branch_id !== q.branch_id || q.receipt_id && r.id !== q.receipt_id) continue;
    if (!q.receipt_id && !inRange(r.receipt_date, q) && !eventReceiptIds.has(r.id)) continue;
    const ls = receiptLines.get(r.id) || [];
    if ((q.channel_id || q.account_id) && !ls.length) continue;
    const rawLines = data.lines.filter(l => l.receipt_id === r.id);
    const notes = (data.adjustments || []).filter(a => a.receipt_id === r.id);
    const confirmation = receiptConfirmationFields({ ...r, lines: rawLines, post_close_adjustments: notes });
    const fullReceipt = !q.channel_id && !q.account_id;
    const cashier = total(ls, 'cashier');
    const misc = amount(r.misc_total) || 0;
    const cashierVariance = fullReceipt && cashier !== null && ls.every(l => l.cashier !== null) && r.clickhouse_synced_at && present(r.gross_sales_expected) && present(r.morning_change_amount)
      ? roundMoney(cashier + misc - Number(r.gross_sales_expected) - Number(r.morning_change_amount)) : null;
    const reasons = [...new Set(ls.flatMap(l => l.reasons))];
    if (r.status === 'DRAFT') reasons.unshift('ยังไม่ส่งยอด');
    if (r.status === 'SUBMITTED') reasons.unshift('รอตรวจเอกสาร');
    if (r.status === 'NEEDS_CORRECTION') reasons.unshift('ต้องแก้ไขเอกสาร');
    if (['CHECKED_OK', 'CHECKED_VARIANCE'].includes(r.status)) reasons.unshift('ตรวจแล้ว รอปิดเอกสาร');
    if (nonzero(cashierVariance)) reasons.unshift('ยอดแคชเชียร์เทียบ POS และเงินทอนมีส่วนต่าง');
    if (r.status === 'CLOSED' && ls.some(l => nonzero(l.variance))) reasons.unshift('หลักฐานย้อนหลังไม่ตรง');
    if (fullReceipt && nonzero(confirmation.confirmed_variance_total)) reasons.unshift('ยอดยืนยันปิดวันมีส่วนต่าง');
    rows.push({
      key: `sale:${r.id}`, receipt_ids: [r.id], receipt_id: r.id, date: r.receipt_date,
      branch_id: r.branch_id, branch_name: r.branch_name, branch_code: r.branch_code,
      status: r.status, status_label: receiptStatusLabel(r.status), lines: ls,
      pos: fullReceipt && r.clickhouse_synced_at ? amount(r.gross_sales_expected) : null,
      float: fullReceipt ? amount(r.morning_change_amount) : null, misc: fullReceipt ? misc : null,
      cashier, received: total(ls, 'received'), expected: total(ls, 'expected'),
      confirmed_variance: fullReceipt ? confirmation.confirmed_variance_total : null,
      confirmed_source: confirmation.confirmed_variance_source, cashier_variance: cashierVariance,
      reasons, attention: reasons.length > 0, unknown_count: ls.filter(l => l.received === null).length,
      review_note: r.review_note, correction_note: r.correction_note,
      submitted_by: r.submitted_by_name, submitted_at: r.submitted_at, checked_by: r.checked_by_name,
      checked_at: r.checked_at, closed_by: r.closed_by_name, closed_at: r.closed_at,
      adjustments: notes, attachments: (data.attachments || []).filter(a => a.receipt_id === r.id),
      audit: (data.audit || []).filter(a => a.entity_id === r.id),
      misc_items: (data.misc || []).filter(a => a.receipt_id === r.id),
    });
  }
  const saleRows = rows.filter(r => q.receipt_id || inRange(r.date, q));
  if (!q.channel_id && !q.account_id && !q.receipt_id) {
    const keys = new Set(saleRows.map(r => `${r.date}:${r.branch_id}`));
    for (let day = Date.parse(q.from); day <= Date.parse(q.to); day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10);
      for (const b of data.branches.filter(b => b.is_active && (!q.branch_id || b.id === q.branch_id))) {
        if (keys.has(`${date}:${b.id}`)) continue;
        const future = date > today;
        saleRows.push({ key: `${date}:${b.id}`, date, branch_id: b.id, branch_name: b.name, branch_code: b.code,
          status: future ? 'FUTURE' : 'MISSING', status_label: future ? 'ยังไม่ถึงวัน' : 'ไม่มีเอกสาร',
          lines: [], receipt_ids: [], received: null, cashier: null, pos: null, float: null, misc: null,
          cashier_variance: null, confirmed_variance: null, reasons: future ? [] : ['ไม่มีเอกสาร'], attention: !future,
          unknown_count: future ? 0 : 1, attachments: [], adjustments: [], audit: [], misc_items: [] });
      }
    }
  }
  const transactions = eligibleEvents.filter(e => q.basis !== 'sale' || !lineMap.get(e.receipt_line_id).batch_key).map(e => {
    const l = lineMap.get(e.receipt_line_id);
    const wholeLine = !l.batch_key && events.filter(event => event.receipt_line_id === l.id).length === 1;
    return { ...l, key: e.event_id, date: q.basis === 'sale' ? l.receipt_date : e.received_date, received_date: e.received_date, received: e.received,
      account_id: e.account_id || null, account_label: data.accounts?.find(a => a.id === e.account_id)?.label || (e.account_id === l.account_id ? l.account_label : null), evidence_basis: e.evidence_basis, reference: e.reference_no,
      description: e.description, before: wholeLine ? l.channel_code === 'CASH' ? l.expected : l.before : null,
      fee: wholeLine ? l.fee : null, expected: wholeLine ? l.expected : null, cashier: null,
      // Per-line fees cannot be repeated on every transaction. Available in detail.
      status: l.receipt_status, status_label: receiptStatusLabel(l.receipt_status), unknown_count: 0 };
  });
  // Include report-only lines in the sales ledger so absent evidence is visible.
  if (q.basis === 'sale') {
    const eventLineIds = new Set(transactions.map(t => t.id));
    for (const l of selectedLines.filter(l => inRange(l.receipt_date, q) && !eventLineIds.has(l.id) && (l.received === null || nonzero(l.cashier) || nonzero(l.received)))) {
      const allocated = l.batch_key && l.received !== null;
      transactions.push({ ...l, key: `line:${l.id}`, date: l.receipt_date, received_date: allocated && l.received_dates.length === 1 ? l.received_dates[0] : null,
        before: allocated && l.fee !== null ? roundMoney(l.received + l.fee) : l.before,
        status: l.receipt_status, status_label: receiptStatusLabel(l.receipt_status), evidence_basis: allocated ? 'ยอดจัดสรรจากชุดโอนที่มีหลักฐาน' : 'ยังไม่มีรายการรับเงินจริงที่ยืนยัน', unknown_count: l.received === null ? 1 : 0 });
    }
  }
  const receiptMap = new Map(rows.map(r => [r.receipt_id, r]));
  const receivedDaily = [];
  const eventGroups = groupBy(transactions, 'date');
  for (const [date, ts] of eventGroups) {
    for (const [branchId, entries] of groupBy(ts, 'branch_id')) {
      const rs = [...new Set(entries.flatMap(t => t.receipt_ids))].map(id => receiptMap.get(id)).filter(Boolean);
      const workflowReasons = rs.filter(r => r.status !== 'CLOSED').map(r => `เอกสาร ${r.date}: ${r.status_label}`);
      const channels = [...groupBy(entries, 'channel_id')].map(([, values]) => ({ ...values[0], cashier: null, received: total(values, 'received'), attention: values.some(v => v.attention) }));
      receivedDaily.push({ key: `received:${date}:${branchId}`, date, branch_id: branchId, branch_name: entries[0].branch_name,
        receipt_ids: rs.map(r => r.receipt_id), receipts: rs, lines: channels,
        received: total(entries, 'received'), cashier: null, pos: null, float: null, misc: null,
        cashier_variance: null, confirmed_variance: null, status: rs.length === 1 ? rs[0].status : 'MIXED',
        statuses: rs.map(r => r.status), status_label: rs.length === 1 ? rs[0].status_label : `${rs.length} เอกสารต้นทาง`,
        reasons: [...new Set([...workflowReasons, ...entries.flatMap(t => t.reasons)])], attention: workflowReasons.length > 0 || entries.some(t => t.attention), unknown_count: 0,
      });
    }
  }
  const matchesStatus = (r) => !q.status || r.status === q.status || r.statuses?.includes(q.status) ||
    q.status === 'PENDING' && (r.received === null || r.unknown_count > 0) ||
    q.status === 'RECEIVED' && r.received !== null && !r.unknown_count ||
    q.status === 'VARIANCE' && (nonzero(r.variance) || nonzero(r.cashier_variance) || nonzero(r.confirmed_variance) || r.lines?.some(l => nonzero(l.variance))) ||
    ['WAITING_RECEIPT','WAITING_EVIDENCE'].includes(q.status) && (r.money_status === q.status || r.lines?.some(l => l.money_status === q.status)) ||
    q.status === 'LATE_EVIDENCE' && r.reasons.includes('หลักฐานย้อนหลังไม่ตรง') ||
    q.status === 'EVIDENCE' && r.reasons.some(s => /หลักฐาน/.test(s));
  const followups = saleRows.filter(r => r.attention).flatMap(r => {
    const ls = r.lines.filter(l => l.attention);
    return ls.length ? ls.map(l => ({ ...r, key:`follow:${l.id}`, lines:[l], received:l.received, expected:l.expected,
      cashier:l.cashier, pos:null, float:null, misc:null, cashier_variance:null, confirmed_variance:null,
      reasons:[...new Set([...l.reasons,...r.reasons.filter(s => /เอกสาร|ปิดวัน|ย้อนหลัง/.test(s))])], unknown_count:l.received === null ? 1 : 0 })) : [r];
  });
  let resultRows = q.tab === 'transactions' ? transactions : q.tab === 'followups' ? followups : q.basis === 'received' ? receivedDaily : saleRows;
  // Undated pending work always uses sales dates and remains accessible in its
  // own tab; the response explicitly states this instead of dropping that work.
  resultRows = resultRows.filter(r => matchesStatus(r) && (!q.attention || r.attention))
    .sort((a, b) => b.date.localeCompare(a.date) || a.branch_id - b.branch_id || String(a.key).localeCompare(String(b.key)));
  const channels = data.channels.filter(c => (!q.channel_id || c.id === q.channel_id) && (!q.branch_id || data.branches.some(b => b.id === q.branch_id && branchSupportsPaymentChannel(b.code, c.code))));
  const summary = { rows: resultRows.length, received: total(resultRows, 'received'), cashier: q.tab === 'transactions' ? null : total(resultRows, 'cashier'),
    pos: total(resultRows, 'pos'), float: total(resultRows, 'float'), misc: total(resultRows, 'misc'),
    attention: resultRows.filter(r => r.attention).length, unknown_count: sumMoney(resultRows.map(r => r.unknown_count || 0)),
    confirmed_variance: total(resultRows, 'confirmed_variance'),
    channels: channels.map(c => ({ id: c.id, cashier: total(resultRows.flatMap(r => r.lines || (r.channel_id ? [r] : [])).filter(l => l.channel_id === c.id), 'cashier'), received: total(resultRows.flatMap(r => r.lines || (r.channel_id ? [r] : [])).filter(l => l.channel_id === c.id), 'received') })) };
  const offset = (q.page - 1) * q.page_size;
  return { filters: q, basis: q.tab === 'followups' ? 'sale' : q.basis, generated_at: now,
    channels, summary, rows: resultRows.slice(offset, offset + q.page_size),
    pagination: { page: q.page, page_size: q.page_size, total: resultRows.length, pages: Math.ceil(resultRows.length / q.page_size) },
    note: q.tab === 'followups' ? 'งานติดตามใช้ช่วงวันที่ขาย รวมรายการที่ยังไม่ทราบวันที่รับเงินจริง' : q.basis === 'received' ? 'รวมเฉพาะรายการรับที่มีหลักฐานและวันที่รับจริง เงินสดเป็นยอดตรวจนับหักเงินทอน' : 'ยอดรับที่ยืนยันแล้วของวันขาย อาจรับเงินจริงคนละวัน เงินสดเป็นยอดตรวจนับหักเงินทอน',
  };
}
