import crypto from 'node:crypto';
import { bankTransactionEvidence } from './domain/receiptsOverview.js';

export const DOT_PATH = '/integrations/dot/reconciliation';
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const previousBangkokDay = (now = new Date()) => new Date(now.getTime() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
const dateValid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
// Money is integer satang internally. Unknown never becomes zero.
export function cents(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const text = String(value);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const n = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1 : 1);
  return Number.isSafeInteger(n) ? n : null;
}
const money = n => n === null || !Number.isSafeInteger(n) ? null : (n / 100).toFixed(2);
const sum = ns => !ns.length || ns.some(n => n === null) ? null : ns.reduce((a, b) => a + b, 0);
const difference = (a, b) => a === null || b === null ? null : a - b;
const over = n => n !== null && Math.abs(n) > 10000;
const parseJSON = x => { try { return typeof x === 'string' ? JSON.parse(x) : x || {}; } catch { return {}; } };

export function parseDotQuery(input = {}, now = new Date()) {
  if (Object.keys(input).some(k => !['cursor', 'day'].includes(k))) throw fail(400, 'Unsupported query field.');
  const day = input.day === undefined ? previousBangkokDay(now) : input.day;
  if (!dateValid(day) || day > previousBangkokDay(now)) throw fail(400, 'day must be a completed Bangkok business date.');
  const cursor = input.cursor === undefined ? '0' : input.cursor;
  if (typeof cursor !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(cursor)) throw fail(400, 'Invalid cursor.');
  return { day, cursor: Number(cursor), limit: 50 };
}

// No users, attachments, booking references, free-text notes or bank account numbers.
// Data acquisition is bounded and SELECT-only inside a consistent read-only transaction.
export async function loadDotData(pool, q, branches) {
  const c = await pool.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION READ ONLY');
    const select = async (sql, params = []) => (await c.query({ sql, timeout: 15000 }, params))[0];
    const branchRows = await select('SELECT id, code, is_active FROM branches WHERE code IN (?) ORDER BY id', [branches]);
    const selected = await select(`SELECT dr.id FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
      WHERE b.code IN (?) AND dr.receipt_date <= ? AND dr.id > ? ORDER BY dr.id LIMIT ?`, [branches, q.day, q.cursor, q.limit + 1]);
    const pageIds = selected.slice(0, q.limit).map(r => r.id);
    const next = selected.length > q.limit ? pageIds.at(-1) : null;
    // Yesterday is always present on page one even if its ids are at the end of history.
    const daily = q.cursor === 0 ? await select(`SELECT dr.id FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
      WHERE b.code IN (?) AND dr.receipt_date = ?`, [branches, q.day]) : [];
    const ids = [...new Set([...pageIds, ...daily.map(r => r.id)])];
    const empty = { branches: branchRows, receipts: [], lines: [], transactions: [], adjustments: [], selectedIds: ids, next_cursor: next };
    if (!ids.length) { await c.commit(); return empty; }
    const siblings = await select(`SELECT DISTINCT l.receipt_id AS id, b.code AS branch_code, r.settlement_batch_key AS batch_key FROM daily_receipt_lines l
      JOIN receipt_line_reconciliations r ON r.receipt_line_id = l.id
      JOIN daily_receipts dr ON dr.id = l.receipt_id JOIN branches b ON b.id = dr.branch_id
      WHERE r.settlement_batch_key IN (SELECT r2.settlement_batch_key FROM receipt_line_reconciliations r2
      JOIN daily_receipt_lines l2 ON l2.id = r2.receipt_line_id WHERE l2.receipt_id IN (?) AND r2.settlement_batch_key IS NOT NULL)
      LIMIT 501`, [ids]);
    if (siblings.length > 500) throw fail(503, 'Settlement batch exceeds safe read limit.');
    // Batch membership metadata can reveal an out-of-scope participant. Never
    // load its amounts/evidence; the affected batch must remain unproven.
    const blockedBatchKeys = [...new Set(siblings.filter(r => !branches.includes(r.branch_code)).map(r => r.batch_key))];
    const allIds = [...new Set([...ids, ...siblings.filter(r => branches.includes(r.branch_code)).map(r => r.id)])];
    const receipts = await select(`SELECT dr.id, dr.receipt_date, b.code AS branch_code, dr.status,
      dr.gross_sales_expected, dr.morning_change_amount, dr.clickhouse_synced_at,
      dr.closed_reconciliation_snapshot,
      (SELECT COALESCE(SUM(amount),0) FROM receipt_misc_items WHERE receipt_id = dr.id) AS misc_total,
      (SELECT COALESCE(SUM(amount),0) FROM reservation_deposits WHERE receipt_id = dr.id AND status <> 'VOID') AS deposits_received,
      (SELECT COALESCE(SUM(amount),0) FROM reservation_deposit_applications WHERE receipt_id = dr.id) AS deposits_applied
      FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id WHERE dr.id IN (?)`, [allIds]);
    const lines = await select(`SELECT l.id, l.receipt_id, l.expected_amount, l.cashier_amount, l.statement_amount,
      l.reconciliation_adjustment_amount, pc.code AS channel_code, pc.kind AS channel_kind,
      r.expected_gross_amount, r.expected_net_amount, r.fee_amount, r.settlement_source, r.settlement_status,
      r.manual_checked_without_reference, r.settlement_date, r.settlement_batch_key,
      r.settlement_batch_allocated_net_amount, r.settlement_batch_allocated_fee_amount
      FROM daily_receipt_lines l JOIN payment_channels pc ON pc.id = l.payment_channel_id
      LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id = l.id WHERE l.receipt_id IN (?) ORDER BY l.id`, [allIds]);
    const transactions = await select(`SELECT st.id, st.receipt_line_id, st.transaction_date, st.amount, st.unique_hash,
      st.raw_payload, st.match_status, COALESCE(st.receiving_account_id, si.receiving_account_id, r.receiving_account_id) AS account_id,
      si.original_name AS import_name FROM statement_transactions st
      JOIN statement_imports si ON si.id = st.import_id
      LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id = st.receipt_line_id
      WHERE st.receipt_id IN (?) ORDER BY st.id LIMIT 20001`, [allIds]);
    if (transactions.length > 20000) throw fail(503, 'Evidence exceeds safe read limit.');
    const adjustments = await select(`SELECT receipt_id, receipt_line_id, revision, amount, variance_total_after
      FROM receipt_post_close_adjustments WHERE receipt_id IN (?) ORDER BY receipt_id, revision`, [ids]);
    await c.commit();
    return { ...empty, receipts, lines, transactions, adjustments, blockedBatchKeys };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}

export function buildDotReport(data, q, now = new Date()) {
  const receipts = new Map(data.receipts.map(r => [r.id, r]));
  const bank = new Map();
  const duplicateLines = new Set();
  const seen = new Map();
  for (const tx of data.transactions) {
    if (!bankTransactionEvidence(tx)) continue;
    const p = parseJSON(tx.raw_payload);
    const identity = p['Transaction ID'] || String(tx.unique_hash || '').match(/[a-f0-9]{64}$/i)?.[0] || String(tx.unique_hash || '').replace(/^\d+-/, '') || tx.id;
    const key = `${tx.account_id || 'unknown'}|${identity}|${tx.transaction_date}`;
    if (seen.has(key)) { duplicateLines.add(tx.receipt_line_id); duplicateLines.add(seen.get(key)); continue; }
    seen.set(key, tx.receipt_line_id);
    bank.set(tx.receipt_line_id, [...(bank.get(tx.receipt_line_id) || []), tx]);
  }
  const batch = new Map();
  for (const l of data.lines.filter(l => l.settlement_batch_key)) batch.set(l.settlement_batch_key, [...(batch.get(l.settlement_batch_key) || []), l]);
  const rows = [];
  for (const id of data.selectedIds) {
    const r = receipts.get(id);
    if (!r || r.receipt_date > q.day || !data.branches.some(b => b.code === r.branch_code)) continue;
    const submitted = r.status !== 'DRAFT';
    const rawLines = data.lines.filter(l => l.receipt_id === id);
    const issues = new Set();
    const comparisons = [];
    const resultLines = rawLines.map(l => {
      const isCash = l.channel_code === 'CASH';
      const group = isCash ? 'cash' : l.channel_kind === 'credit_card' ? 'card' : l.channel_kind === 'delivery' || l.channel_code === 'GRAB' ? 'delivery' : ['qr', 'promptpay','transfer'].includes(l.channel_kind) ? 'transfer' : 'other';
      const cashier = submitted ? cents(l.cashier_amount) : null;
      const pos = r.clickhouse_synced_at ? cents(l.expected_amount) : null;
      let txs = bank.get(l.id) || [];
      let actual = isCash ? submitted && (Number(l.manual_checked_without_reference) === 1 || ['MATCHED_AUTO','MATCHED_MANUAL'].includes(l.settlement_status)) ? cents(l.statement_amount) : null : sum(txs.map(t => cents(t.amount)));
      let expected = isCash || ['qr', 'promptpay','transfer'].includes(l.channel_kind) ? cashier : null;
      let fee = isCash ? 0 : null;
      const source = l.settlement_source;
      const hasReference = ['BANK_SETTLEMENT','BANK_STATEMENT','GRAB_REPORT','LEGACY_EVIDENCE'].includes(source);
      const referenceGross = hasReference ? cents(l.expected_gross_amount) : null;
      if (!isCash && hasReference) { expected = cents(l.expected_net_amount); fee = cents(l.fee_amount); }
      if (source === 'GRAB_REPORT' && referenceGross > 0 && expected === 0) {
        expected = null; fee = null; issues.add('INCOMPLETE_DELIVERY_REPORT');
      }
      if (l.settlement_batch_key) {
        const siblings = batch.get(l.settlement_batch_key);
        txs = siblings.flatMap(s => bank.get(s.id) || []);
        const bankTotal = sum(txs.map(t => cents(t.amount)));
        const allocated = sum(siblings.map(s => cents(s.settlement_batch_allocated_net_amount)));
        const outOfScope = (data.blockedBatchKeys || []).includes(l.settlement_batch_key);
        const proven = !outOfScope && bankTotal !== null && allocated !== null && bankTotal === allocated && !siblings.some(s => duplicateLines.has(s.id));
        actual = proven ? cents(l.settlement_batch_allocated_net_amount) : null;
        expected = cents(l.settlement_batch_allocated_net_amount);
        fee = cents(l.settlement_batch_allocated_fee_amount);
        if (!proven) issues.add('UNPROVEN_SETTLEMENT_BATCH');
        if (outOfScope) issues.add('SETTLEMENT_BATCH_OUTSIDE_APPROVED_BRANCHES');
      }
      if (duplicateLines.has(l.id)) { actual = null; issues.add('DUPLICATE_BANK_EVIDENCE'); }
      if (actual === null) issues.add('MISSING_ACTUAL_RECEIPT');
      if (expected === null) issues.add('MISSING_EXPECTED_NET');
      if (l.channel_code === 'OTHER_UNKNOWN') issues.add('UNMAPPED_CHANNEL');
      const settlementDiff = difference(actual, expected);
      const cashierReferenceDiff = difference(cashier, referenceGross);
      comparisons.push(settlementDiff, cashierReferenceDiff);
      return { line_id: l.id, channel_code: l.channel_code, group,
        pos_amount: money(pos), cashier_amount: money(cashier), reference_gross_amount: money(referenceGross),
        expected_net_amount: money(expected), fee_amount: money(fee), actual_amount: money(actual),
        actual_basis: actual === null ? null : isCash ? 'VERIFIED_CASH_COUNT_INCLUDING_FLOAT' : 'BANK_EVIDENCE',
        settlement_variance: money(settlementDiff), cashier_reference_variance: money(cashierReferenceDiff),
        adjustment_amount: money(cents(l.reconciliation_adjustment_amount)),
        settlement_source: source || null, settlement_status: l.settlement_status || null,
        recorded_settlement_date: l.settlement_date || null,
        bank_received_dates: [...new Set(txs.map(t => t.transaction_date))].sort(),
        bank_evidence_count: txs.length, allocated_batch: Boolean(l.settlement_batch_key) };
    });
    const pos = r.clickhouse_synced_at ? cents(r.gross_sales_expected) : null;
    const float = cents(r.morning_change_amount);
    const misc = submitted ? cents(r.misc_total) : null;
    const depositsReceived = submitted ? cents(r.deposits_received) : null;
    const depositsApplied = submitted ? cents(r.deposits_applied) : null;
    const expectedTotal = sum([pos, float, depositsReceived, depositsApplied === null ? null : -depositsApplied]);
    const cashierTotal = sum(resultLines.map(l => cents(l.cashier_amount)));
    const actualTotal = sum(resultLines.map(l => cents(l.actual_amount)));
    const feesTotal = sum(resultLines.map(l => cents(l.fee_amount)));
    const adjustmentTotal = sum(resultLines.map(l => cents(l.adjustment_amount)));
    const postClose = data.adjustments.filter(a => a.receipt_id === id);
    const postCloseTotal = postClose.length ? sum(postClose.map(a => cents(a.amount))) : 0;
    const cashierVariance = difference(sum([cashierTotal, misc]), expectedTotal);
    const actualVariance = difference(sum([actualTotal, feesTotal, adjustmentTotal, misc, postCloseTotal]), expectedTotal);
    const snapshot = parseJSON(r.closed_reconciliation_snapshot);
    const confirmed = r.status === 'CLOSED' ? postClose.length ? cents(postClose.at(-1).variance_total_after) : snapshot.version === 1 ? cents(snapshot.variance_total) : null : null;
    const groups = ['cash','transfer','card','delivery','other'].map(group => {
      const ls = resultLines.filter(l => l.group === group);
      const groupPos = sum(ls.map(l => cents(l.pos_amount)));
      const groupCashier = sum(ls.map(l => cents(l.cashier_amount)));
      // Deposits and miscellaneous items are not reliably allocated to POS channels.
      // Compare the day instead when any of those adjustments are present/unknown.
      const comparable = misc === 0 && depositsReceived === 0 && depositsApplied === 0;
      const groupExpected = group === 'cash' ? sum([groupPos, float]) : groupPos;
      const delta = comparable ? difference(groupCashier, groupExpected) : null;
      comparisons.push(delta);
      return { group, pos_amount: money(groupPos), cashier_amount: money(groupCashier),
        actual_amount: money(sum(ls.map(l => cents(l.actual_amount)))), cashier_pos_variance: money(delta),
        comparison_basis: comparable ? 'POS_PLUS_CASH_FLOAT' : 'DAY_ADJUSTMENTS_NOT_ALLOCATED_TO_CHANNELS' };
    });
    // Closure is not a resolution flag. Keep quantified residuals for human review,
    // including offsets between channels; never infer refunds from free text.
    const exceeds = [cashierVariance, actualVariance, confirmed, ...comparisons].some(over);
    if (r.receipt_date !== q.day && !exceeds) continue;
    if (pos === null) issues.add('POS_NOT_SYNCED');
    rows.push({ receipt_id: id, business_date: r.receipt_date, branch_code: r.branch_code, status: r.status,
      scope: r.receipt_date === q.day ? 'PREVIOUS_DAY' : 'HISTORICAL_DIFFERENCE',
      exceeds_100_thb: exceeds, resolution_status: 'NOT_AVAILABLE_IN_SOURCE',
      pos_synced_at: r.clickhouse_synced_at || null, pos_amount: money(pos), morning_change_amount: money(float),
      misc_amount: money(misc), deposits_received: money(depositsReceived), deposits_applied: money(depositsApplied),
      refund_amount: null, refund_status: 'NO_STRUCTURED_REFUND_SOURCE',
      cashier_total: money(cashierTotal), actual_total: money(actualTotal), fees_total: money(feesTotal),
      post_close_adjustment_total: money(postCloseTotal), cashier_variance: money(cashierVariance),
      actual_reconciled_variance: money(actualVariance), confirmed_variance: money(confirmed),
      issues: [...issues].sort(), groups, lines: resultLines });
  }
  if (q.cursor === 0) for (const b of data.branches.filter(b => b.is_active)) {
    if (!rows.some(r => r.business_date === q.day && r.branch_code === b.code)) rows.push({ receipt_id: null, business_date: q.day, branch_code: b.code, status: 'MISSING', scope: 'PREVIOUS_DAY', pos_amount: null, cashier_total: null, actual_total: null, exceeds_100_thb: false, issues: ['MISSING_RECEIPT'], lines: [] });
  }
  return { schema_version: '1.0', source: 'GENERAL_CASHFLOW', read_only: true, timezone: 'Asia/Bangkok', currency: 'THB',
    day: q.day, generated_at: now.toISOString(), threshold: { absolute_thb: '100.00', operator: '>' },
    coverage: { pos: 'STORED_SNAPSHOT_NO_REFRESH', history: 'ALL_PRIOR_RECORDED_DAYS_PAGINATED', refunds: 'UNAVAILABLE', resolution: 'RESIDUAL_CANDIDATES_REQUIRE_REVIEW',
      warning: 'Null means unknown. Missing historic amounts are not quantified differences. Closed documents may still have residuals. Do not claim complete refund or resolution reconciliation.' },
    rows: rows.sort((a,b) => b.business_date.localeCompare(a.business_date) || a.branch_code.localeCompare(b.branch_code)),
    pagination: { scanned_receipts: data.selectedIds.length, next_cursor: data.next_cursor === null ? null : String(data.next_cursor), complete: data.next_cursor === null } };
}

export function createDotHandler({ pool, env = process.env, now = () => new Date(), loader = loadDotData }) {
  let inFlight = false;
  let windowStart = 0;
  let calls = 0;
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.removeHeader('X-Powered-By');
    let extra = [];
    try { extra = env.CASHFLOW_DOT_EXTRA_TOKENS_JSON ? JSON.parse(env.CASHFLOW_DOT_EXTRA_TOKENS_JSON) : []; } catch { extra = []; }
    if (!Array.isArray(extra)) extra = [];
    const policies = [
      {sha256: env.CASHFLOW_DOT_TOKEN_SHA256, branches: String(env.CASHFLOW_DOT_BRANCHES || '').split(',').filter(Boolean), expires_at: env.CASHFLOW_DOT_EXPIRES_AT},
      ...extra
    ].filter(policy => /^[a-f0-9]{64}$/.test(policy?.sha256 || '') && Array.isArray(policy.branches) && policy.branches.length && policy.branches.every(b => /^[A-Z0-9_-]{1,20}$/.test(b)) && Number.isFinite(Date.parse(policy.expires_at || '')) && now().getTime() < Date.parse(policy.expires_at));
    if (!policies.length) return res.status(503).json({ error: 'Integration disabled.' });
    const header = req.headers.authorization || '';
    const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(header)?.[1];
    const tokenHash = token ? crypto.createHash('sha256').update(token).digest() : null;
    const policy = tokenHash ? policies.find(item => crypto.timingSafeEqual(tokenHash, Buffer.from(item.sha256, 'hex'))) : null;
    if (!policy) return res.status(401).json({ error: 'Unauthorized.' });
    if (req.method !== 'GET') { res.set('Allow', 'GET'); return res.status(405).json({ error: 'Read-only endpoint.' }); }
    if (req.headers.origin) return res.status(403).json({ error: 'Browser access is not supported.' });
    if (inFlight) return res.status(429).json({ error: 'Read already in progress.' });
    const time = now().getTime();
    if (time - windowStart >= 60000) { windowStart = time; calls = 0; }
    if (++calls > 60) return res.status(429).json({ error: 'Read rate exceeded.' });
    try {
      const q = parseDotQuery(req.query, now());
      inFlight = true;
      const data = await loader(pool, q, policy.branches);
      return res.json(buildDotReport(data, q, now()));
    } catch (error) { return res.status(error.statusCode || 500).json({ error: error.statusCode === 400 ? error.message : 'Reconciliation read failed.' }); }
    finally { inFlight = false; }
  };
}
