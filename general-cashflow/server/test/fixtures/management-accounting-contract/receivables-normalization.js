/**
 * Pure consumer for the General Cashflow receivables contract.
 *
 * This module intentionally has no imports with side effects, database access,
 * HTTP access, or writes.  Money is represented internally as integer cents
 * and is only emitted as a two-decimal string.
 */

export const SCOPE = Object.freeze({
  from: '2026-08-01',
  to: '2026-08-31',
  branch: 'SK',
  timezone: 'Asia/Bangkok',
});

export const ISSUE_CODES = Object.freeze({
  OPEN_STATUS_ONLY: 'OPEN_STATUS_ONLY',
  RECEIPT_NOT_CLOSED: 'RECEIPT_NOT_CLOSED',
  OUT_OF_SCOPE_DATE: 'OUT_OF_SCOPE_DATE',
  UNMAPPED_BRANCH: 'UNMAPPED_BRANCH',
  UNMAPPED_PAYMENT_CHANNEL: 'UNMAPPED_PAYMENT_CHANNEL',
  UNMAPPED_RECEIVING_ACCOUNT: 'UNMAPPED_RECEIVING_ACCOUNT',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_DECIMAL_SCALE: 'INVALID_DECIMAL_SCALE',
  SETTLEMENT_EVIDENCE_INCOMPLETE: 'SETTLEMENT_EVIDENCE_INCOMPLETE',
  SETTLEMENT_ARITHMETIC_MISMATCH: 'SETTLEMENT_ARITHMETIC_MISMATCH',
  UNALLOCATED_NEEDS_REVIEW: 'UNALLOCATED_NEEDS_REVIEW',
  STALE_REVISION: 'STALE_REVISION',
  DUPLICATE_REVISION_NOOP: 'DUPLICATE_REVISION_NOOP',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_REVISION: 'INVALID_REVISION',
  INVALID_UPDATED_AT: 'INVALID_UPDATED_AT',
  UNMAPPED_SETTLEMENT_STATUS: 'UNMAPPED_SETTLEMENT_STATUS',
});

export const PREVIEW_BUCKETS = Object.freeze([
  'created', 'changed', 'duplicate_noop', 'open_skipped', 'rejected',
  'unmapped', 'unallocated', 'stale', 'pending_evidence', 'exception',
]);

const MONEY_RE = /^-?\d+\.\d{2}$/;
const REVISION_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
const SETTLEMENT_STATUSES = new Set([
  'PENDING_EVIDENCE', 'READY_FOR_STATEMENT', 'MATCHED_AUTO', 'MATCHED_MANUAL', 'EXCEPTION',
]);
const CHANNELS = new Set(['CASH', 'QR_PROMPTPAY', 'CREDIT_CARD', 'GRAB']);
const ACCOUNTS = new Set(['bank-scb-sk-1184', 'bank-kbank-sk-0427', 'cash-drawer-sk']);
const SETTLEMENT_SOURCES = new Set([
  'NONE', 'BANK_STATEMENT', 'BANK_SETTLEMENT', 'GRAB_REPORT', 'MANUAL',
  'LEGACY_EVIDENCE', 'CASH_ON_HAND',
]);

const CANONICAL_CHANNEL_BY_KIND = Object.freeze({
  cash: 'CASH',
  qr: 'QR_PROMPTPAY',
  promptpay: 'QR_PROMPTPAY',
  credit_card: 'CREDIT_CARD',
  grab: 'GRAB',
});

function envelopeRows(envelopes, sourceType) {
  const value = envelopes?.[sourceType];
  return Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : []);
}

/** Build only mappings that are explicitly supported by the source masters. */
export function buildReceivablesMappingContext(envelopes, { branch = SCOPE.branch } = {}) {
  const channelAliases = {};
  for (const row of envelopeRows(envelopes, 'payment_channel')) {
    if (!row || row.is_active === false || Number(row.is_active) === 0) continue;
    const canonical = CANONICAL_CHANNEL_BY_KIND[String(row.kind || '').trim().toLowerCase()];
    if (canonical && CHANNELS.has(canonical) && row.code) channelAliases[String(row.code)] = canonical;
  }
  const receivingAccountRefs = new Set();
  for (const row of envelopeRows(envelopes, 'receiving_account')) {
    if (!row || row.is_active === false || Number(row.is_active) === 0) continue;
    if (Array.isArray(row.branch_codes) && !row.branch_codes.includes(branch)) continue;
    const accountId = /^gc-account-(\d+)$/.exec(String(row.source_account_id || ''))?.[1];
    const sourceId = /^gc:receiving-account:(\d+)$/.exec(String(row.source_id || ''))?.[1];
    // Both exported identifiers must agree before bridging the producer's
    // documented hyphen/colon namespace difference.
    if (!accountId || !sourceId || accountId !== sourceId) continue;
    receivingAccountRefs.add(`gc-account:${accountId}`);
  }
  return Object.freeze({
    channelAliases: Object.freeze(channelAliases),
    receivingAccountRefs: Object.freeze([...receivingAccountRefs].sort()),
  });
}

function mappedChannelCode(channelCode, mappingContext) {
  if (CHANNELS.has(channelCode)) return channelCode;
  const mapped = mappingContext?.channelAliases?.[channelCode];
  return CHANNELS.has(mapped) ? mapped : null;
}

function receivingAccountMapped(reference, mappingContext) {
  if (!reference) return true;
  if (ACCOUNTS.has(reference)) return true;
  return Array.isArray(mappingContext?.receivingAccountRefs) && mappingContext.receivingAccountRefs.includes(reference);
}

const MONEY_FIELDS = [
  'gross_amount_incl_vat', 'gross_amount', 'fee_amount', 'net_amount',
  'actual_money_amount', 'matched_amount', 'allocated_net_amount',
  'allocated_fee_amount', 'gross_sales_expected', 'cash_expected',
  'non_cash_expected', 'morning_change_amount', 'actual_money_total',
  'deduction_total', 'line_adjustment_total', 'misc_adjustment_total',
  'pos_with_change_total', 'reconciled_total', 'variance_total', 'pos_amount',
  'cashier_confirmed_amount', 'expected_gross_amount', 'expected_fee_amount',
  'expected_net_amount', 'statement_amount',
];
// These are source-provided signed adjustments/variances.  A negative value
// is meaningful evidence and must not be rejected as an invalid receipt.
const SIGNED_MONEY_FIELDS = new Set([
  'deduction_total', 'line_adjustment_total', 'misc_adjustment_total',
  'variance_total',
]);

function cents(value) {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split('.');
  const result = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
  return negative ? -result : result;
}

function money(value) {
  return (value / 100).toFixed(2);
}

function addMoney(total, value) {
  const parsed = cents(value);
  return parsed == null ? total : total + parsed;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isInScope(value) {
  return isValidDate(value) && value >= SCOPE.from && value <= SCOPE.to;
}

function sourceRows(source) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source.data) && source.data.length > 0) return source.data.map((row) => ({ row, invalid: false }));
  if (Array.isArray(source.snapshots)) return source.snapshots.map((row) => ({ row, invalid: false }));
  if (Array.isArray(source.invalid_rows)) return source.invalid_rows.map((row) => ({ row, invalid: true }));
  if (Array.isArray(source.data)) return source.data.map((row) => ({ row, invalid: false }));
  return [];
}

function refsFor(source, rows) {
  return rows.map(({ row }) => ({
    source_type: source.source_type,
    source_id: row.source_id,
    revision: row.revision,
  }));
}

function blankPreview() {
  return Object.fromEntries(PREVIEW_BUCKETS.map((key) => [key, 0]));
}

function blankTotals() {
  return {
    source_total: '0.00', imported_total: '0.00', rejected_total: '0.00',
    excluded_open_total: '0.00', recognized_sales: '0.00',
    expected_net_receipts: '0.00', allocated_net: '0.00', actual_cash_in: '0.00',
    receivable_in_transit: '0.00', recognized_fees: '0.00',
  };
}

function sourceIdentity(row, sourceType) {
  return `${sourceType}|${row.source_id}|${row.revision}`;
}

function priorRevisions(options = {}) {
  const values = options.existing ?? options.acknowledged ?? [];
  const rows = Array.isArray(values) ? values : [values];
  const result = new Map();
  for (const value of rows) {
    if (!value) continue;
    const sourceType = value.source_type ?? value.fact_type ?? '';
    const id = value.source_id;
    const revision = value.source_revision ?? value.revision;
    if (id && revision) result.set(`${sourceType}|${id}`, revision);
  }
  return result;
}

function validateRow(row, sourceType, { invalid = false } = {}) {
  const issues = [];
  const dateBearing = !['receiving_account', 'payment_channel'].includes(sourceType);
  if (dateBearing) {
    if (invalid || !isValidDate(row.business_date) ||
        (row.settlement_date != null && !isValidDate(row.settlement_date))) issues.push(ISSUE_CODES.INVALID_DATE);
    if (isValidDate(row.business_date) && !isInScope(row.business_date)) issues.push(ISSUE_CODES.OUT_OF_SCOPE_DATE);
    // Pilot scope is the sale/receipt business date. Settlement is a real
    // cash-in date and may cross month; only its syntax/calendar validity is
    // validated here.
  }
  for (const key of MONEY_FIELDS) {
    if (row[key] == null) continue;
    if (cents(row[key]) == null) {
      if (typeof row[key] === 'string' && /^-?\d+(?:\.\d+)?$/.test(row[key])) issues.push(ISSUE_CODES.INVALID_DECIMAL_SCALE);
      else issues.push(ISSUE_CODES.INVALID_AMOUNT);
    } else if (cents(row[key]) < 0 && !SIGNED_MONEY_FIELDS.has(key)) issues.push(ISSUE_CODES.INVALID_AMOUNT);
  }
  if (row.revision == null || !REVISION_RE.test(String(row.revision))) issues.push(ISSUE_CODES.INVALID_REVISION);
  if (row.updated_at == null || !ISO_OFFSET_RE.test(String(row.updated_at))) issues.push(ISSUE_CODES.INVALID_UPDATED_AT);
  if (sourceType === 'cash_settlement' && row.source_settlement_status != null &&
      !SETTLEMENT_STATUSES.has(row.source_settlement_status)) issues.push(ISSUE_CODES.UNMAPPED_SETTLEMENT_STATUS);
  return [...new Set(issues)];
}

function amountForSourceTotal(row, sourceType) {
  if (sourceType === 'pos_daily_sale') return row.gross_amount_incl_vat;
  if (sourceType === 'receipt_day') return row.gross_sales_expected;
  if (sourceType === 'receipt_expectation') return row.expected_gross_amount ?? row.pos_amount;
  return row.gross_amount;
}

function statusOnly(row, sourceType, reason = null) {
  if (sourceType === 'receipt_day' && row.receipt_status !== 'CLOSED') {
    return {
      source_id: row.source_id, record_status: 'OPEN_STATUS_ONLY', receipt_status: row.receipt_status,
      source_receipt_status: row.source_receipt_status ?? row.receipt_status,
      business_date: row.business_date, branch_code: row.branch_code, all_amounts: null,
    };
  }
  if (sourceType === 'receiving_account') {
    return {
      fact_type: 'receiving_account', source_id: row.source_id, account_alias: row.account_alias,
      account_type: row.account_type, account_last4: row.account_last4,
      branch_codes: row.branch_codes, channel_codes: row.channel_codes, is_active: row.is_active,
    };
  }
  if (sourceType === 'receipt_expectation') {
    return {
      fact_type: 'receipt_expectation', source_id: row.source_id,
      record_status: 'QUARANTINED', business_date: row.business_date, branch_code: row.branch_code,
      channel_code: row.channel_code, ...(row.channel_kind ? { channel_kind: row.channel_kind } : {}),
      expected_gross_amount: row.expected_gross_amount, expected_fee_amount: row.expected_fee_amount,
      expected_net_amount: row.expected_net_amount, settlement_status: 'UNMAPPED',
    };
  }
  return {
    fact_type: sourceType, source_id: row.source_id, record_status: 'QUARANTINED',
    business_date: row.business_date, ...(row.settlement_date ? { settlement_date: row.settlement_date } : {}),
    branch_code: row.branch_code, ...(row.channel_code ? { channel_code: row.channel_code } : {}),
    ...(row.receiving_account_ref && row.channel_code !== 'CASH' &&
      (row.allocation_method !== 'EXPLICIT_MN' || row.channel_code === 'GRAB')
      ? { receiving_account_ref: row.receiving_account_ref } : {}),
    ...(row.gross_amount != null ? { gross_amount: row.gross_amount } : {}),
    ...(row.fee_amount != null ? { fee_amount: row.fee_amount } : {}),
    ...(row.net_amount != null ? { net_amount: row.net_amount } : {}),
    ...(row.source_settlement_status ? { settlement_status: 'UNMAPPED' } : {}),
    ...(row.settlement_source ? { settlement_source: row.settlement_source } : {}),
    ...(reason ? {} : {}),
  };
}

function closingInvariant(row) {
  const fields = ['actual_money_total', 'deduction_total', 'line_adjustment_total', 'misc_adjustment_total',
    'pos_with_change_total', 'variance_total'];
  if (!fields.every((key) => cents(row[key]) != null)) return false;
  const left = ['actual_money_total', 'deduction_total', 'line_adjustment_total', 'misc_adjustment_total']
    .reduce((sum, key) => sum + cents(row[key]), 0);
  const right = cents(row.pos_with_change_total) + cents(row.variance_total);
  return left === right;
}

function normalizePos(row) {
  return {
    fact_type: 'recognized_sale', source_id: row.source_id, record_status: 'CLOSED_READY',
    business_date: row.business_date, branch_code: row.branch_code,
    gross_amount_incl_vat: row.gross_amount_incl_vat, bill_count: row.bill_count,
    currency: row.currency, is_finalized: row.is_finalized,
  };
}

function normalizeReceipt(row, stale = false, acknowledged = false) {
  if (stale) return {
    fact_type: 'receipt_day_snapshot', source_id: row.source_id, source_revision: row.revision,
    record_status: 'STALE', revision_of: row.revision_of,
    gross_sales_expected: row.gross_sales_expected, review_required: 'ACCEPT_NEW_OR_KEEP_OLD',
  };
  if (acknowledged) return {
    fact_type: 'receipt_day_snapshot', source_id: row.source_id, source_revision: row.revision,
    record_status: 'ACKNOWLEDGED', business_date: row.business_date, branch_code: row.branch_code,
    gross_sales_expected: row.gross_sales_expected, cash_expected: row.cash_expected,
    non_cash_expected: row.non_cash_expected, morning_change_amount: row.morning_change_amount,
    actual_money_total: row.actual_money_total, pos_with_change_total: row.pos_with_change_total,
    reconciled_total: row.reconciled_total, variance_total: row.variance_total,
  };
  return {
    fact_type: 'receipt_day_snapshot', source_id: row.source_id, record_status: 'CLOSED_READY',
    business_date: row.business_date, branch_code: row.branch_code, receipt_status: row.receipt_status,
    gross_sales_expected: row.gross_sales_expected, cash_expected: row.cash_expected,
    non_cash_expected: row.non_cash_expected, morning_change_amount: row.morning_change_amount,
    actual_money_total: row.actual_money_total, deduction_total: row.deduction_total,
    line_adjustment_total: row.line_adjustment_total, misc_adjustment_total: row.misc_adjustment_total,
    pos_with_change_total: row.pos_with_change_total, reconciled_total: row.reconciled_total,
    variance_total: row.variance_total, posting_formula: false,
  };
}

function normalizeSettlement(row) {
  const settlementSource = row.channel_code === 'CASH' && row.settlement_source === 'CASH_ON_HAND'
    ? 'CASH_ON_HAND' : row.settlement_source ?? row.source_settlement_source;
  const status = row.settlement_status === 'PARTIALLY_SETTLED' ? 'PARTIALLY_SETTLED' : 'SETTLED';
  return {
    fact_type: 'cash_settlement', source_id: row.source_id, record_status: 'CLOSED_READY',
    settlement_status: status, business_date: row.business_date, settlement_date: row.settlement_date,
    branch_code: row.branch_code, channel_code: row.channel_code,
    ...(row.receiving_account_ref && row.channel_code !== 'CASH' &&
      (row.allocation_method !== 'EXPLICIT_MN' || row.channel_code === 'GRAB')
      ? { receiving_account_ref: row.receiving_account_ref } : {}),
    ...(settlementSource ? { settlement_source: settlementSource } : {}),
    ...(row.source_batch_id && row.allocation_method === 'EXPLICIT_MN' ? { source_batch_id: row.source_batch_id } : {}),
    gross_amount: row.gross_amount, fee_amount: row.fee_amount, net_amount: row.net_amount,
    actual_cash_in: row.actual_money_amount ?? row.net_amount,
    allocated_net_amount: row.allocated_net_amount, allocated_fee_amount: row.allocated_fee_amount,
    allocation_method: row.allocation_method,
    ...(row.allocation_method === 'EXPLICIT_MN' && row.channel_code !== 'GRAB'
      ? {} : { thai_coa_code: null, vat_amount: null, wht_amount: null }),
  };
}

function normalizeExpectation(row) {
  return {
    fact_type: 'receipt_expectation', source_id: row.source_id, record_status: 'CLOSED_READY',
    business_date: row.business_date, branch_code: row.branch_code, channel_code: row.channel_code,
    expected_gross_amount: row.expected_gross_amount, expected_fee_amount: row.expected_fee_amount,
    expected_net_amount: row.expected_net_amount, thai_coa_code: null, vat_amount: null, wht_amount: null,
  };
}

function isOpen(row, sourceType) {
  return sourceType === 'receipt_day' && row.receipt_status !== 'CLOSED';
}

/** Validate a source row without performing any side effects. */
export function validateReceivableRow(row, sourceType, options = {}) {
  return Object.freeze({ valid: validateRow(row, sourceType, options).length === 0,
    issue_codes: validateRow(row, sourceType, options) });
}

/**
 * Normalize one source envelope into a deterministic Preview result.
 * `existing` may contain previously accepted normalized facts; it is only an
 * in-memory replay aid and is never mutated.
 */
export function normalizeReceivables(source, options = {}) {
  const rows = sourceRows(source);
  const sourceType = source?.source_type;
  const refs = refsFor(source ?? {}, rows);
  const result = {
    schema_version: 'ar-p1-normalized-1.0', fixture_id: source?.fixture_id ?? null,
    source_fixture: options.source_fixture ?? null, scope: { ...SCOPE }, source_refs: refs,
    financial_facts: [], status_only: [], preview: blankPreview(), totals: blankTotals(),
    invariants: {}, unknowns: [], rejects: [],
  };
  const previous = priorRevisions(options);
  const seen = new Set();
  const acceptedReceiptRevision = new Map();
  let sourceTotal = 0;
  let imported = 0;
  let rejected = 0;
  let excludedOpen = 0;
  let recognizedSales = 0;
  let recognizedSalesKnown = ['pos_daily_sale', 'receipt_expectation', 'receiving_account', 'payment_channel'].includes(sourceType) ||
    (sourceType === 'cash_settlement' && source?.expected?.recognized_sales != null);
  let expectedNet = 0;
  let expectedNetKnown = ['pos_daily_sale', 'receipt_expectation', 'receiving_account', 'payment_channel'].includes(sourceType);
  let allocated = 0;
  let cashIn = 0;
  let cashInKnown = ['pos_daily_sale', 'receipt_expectation', 'receiving_account', 'payment_channel'].includes(sourceType);
  let fees = 0;
  let unknownAmountCount = 0;

  for (const entry of rows) {
    const row = entry.row;
    const key = sourceIdentity(row, sourceType);
    // Preserve source-declared rejection reasons (notably D13A's
    // INVALID_DECIMAL_SCALE rows), even when the sanitized payload omits the
    // invalid numeric token and therefore passes structural validation.
    const validation = [...new Set([
      ...validateRow(row, sourceType, entry),
      ...(Array.isArray(row.issues) ? row.issues.map(String) : []),
    ])];
    const amount = cents(amountForSourceTotal(row, sourceType));
    const validAmount = amount != null && validation.every((issue) => issue !== ISSUE_CODES.INVALID_DECIMAL_SCALE && issue !== ISSUE_CODES.INVALID_AMOUNT);
    if (validAmount) sourceTotal += amount;

    if (seen.has(key) || (options.replay && previous.get(`${sourceType}|${row.source_id}`) === row.revision)) {
      result.preview.duplicate_noop += 1;
      continue;
    }
    seen.add(key);

    if (validation.length > 0) {
      result.preview.rejected += 1;
      const rowAmount = amount ?? 0;
      if (amount == null) unknownAmountCount += 1;
      rejected += rowAmount;
      result.rejects.push({ source_id: row.source_id, reason_codes: validation });
      continue;
    }
    if (isOpen(row, sourceType)) {
      result.preview.open_skipped += 1;
      excludedOpen += amount ?? 0;
      result.status_only.push(statusOnly(row, sourceType));
      continue;
    }
    if (sourceType === 'receiving_account' || sourceType === 'payment_channel') {
      result.status_only.push(statusOnly(row, sourceType));
      continue;
    }
    if (row.branch_code !== SCOPE.branch) {
      result.preview.unmapped += 1;
      result.preview.unallocated += 1;
      result.preview.rejected += 1;
      if (amount == null) unknownAmountCount += 1;
      rejected += amount ?? 0;
      result.status_only.push(statusOnly(row, sourceType));
      result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.UNMAPPED_BRANCH] });
      result.unknowns.push('branch_mapping');
      continue;
    }

    if (sourceType === 'receipt_day') {
      const identity = `${sourceType}|${row.source_id}`;
      const prior = acceptedReceiptRevision.get(identity) ?? previous.get(identity);
      if (prior && prior !== row.revision) {
        sourceTotal -= amount ?? 0;
        result.preview.stale += 1;
        result.status_only.push(normalizeReceipt(row, true));
        result.invariants.old_snapshot_overwritten = false;
        continue;
      }
      acceptedReceiptRevision.set(identity, row.revision);
      result.preview.created += 1;
      result.financial_facts.push(normalizeReceipt(row, false, rows.length > 1));
      imported += amount ?? 0;
      if (!closingInvariant(row)) result.preview.exception += 1;
      continue;
    }
    if (sourceType === 'pos_daily_sale') {
      result.preview.created += 1;
      result.financial_facts.push(normalizePos(row));
      imported += amount ?? 0;
      recognizedSales += cents(row.gross_amount_incl_vat) ?? 0;
      continue;
    }
    const canonicalChannel = mappedChannelCode(row.channel_code, options.mappingContext);
    const mappedRow = canonicalChannel && canonicalChannel !== row.channel_code ? { ...row, channel_code: canonicalChannel } : row;
    if (sourceType === 'receipt_expectation') {
      if (!canonicalChannel || row.channel_kind === 'UNMAPPED') {
        result.preview.unmapped += 1; result.preview.unallocated += 1; result.preview.rejected += 1;
        if (amount == null) unknownAmountCount += 1;
        rejected += amount ?? 0; result.status_only.push(statusOnly(row, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.UNMAPPED_PAYMENT_CHANNEL] });
        result.unknowns.push('payment_channel_mapping');
        if (row.expected_fee_amount == null || row.expected_net_amount == null) result.unknowns.push('fee_and_net_not_evidenced');
        continue;
      }
      if (row.expected_net_amount == null || row.expected_fee_amount == null) {
        result.preview.pending_evidence += 1; result.status_only.push(statusOnly(mappedRow, sourceType));
        continue;
      }
      result.preview.created += 1; result.financial_facts.push(normalizeExpectation(mappedRow)); imported += amount ?? 0;
      recognizedSales += cents(row.expected_gross_amount) ?? 0;
      expectedNet += cents(row.expected_net_amount) ?? 0; expectedNetKnown = true;
      fees += cents(row.expected_fee_amount) ?? 0;
      continue;
    }
    if (sourceType === 'cash_settlement') {
      if (!canonicalChannel) {
        result.preview.unmapped += 1; result.preview.unallocated += 1; result.preview.rejected += 1;
        if (amount == null) unknownAmountCount += 1;
        rejected += amount ?? 0; result.status_only.push(statusOnly(row, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.UNMAPPED_PAYMENT_CHANNEL] });
        continue;
      }
      if (row.receiving_account_ref && !receivingAccountMapped(row.receiving_account_ref, options.mappingContext)) {
        result.preview.unmapped += 1; result.preview.unallocated += 1; result.preview.rejected += 1;
        if (amount == null) unknownAmountCount += 1;
        rejected += amount ?? 0; result.status_only.push(statusOnly(row, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.UNMAPPED_RECEIVING_ACCOUNT] });
        result.unknowns.push('receiving_account_mapping');
        continue;
      }
      if (row.gross_amount == null || row.fee_amount == null || row.net_amount == null ||
          cents(row.gross_amount) - cents(row.fee_amount) !== cents(row.net_amount)) {
        result.preview.exception += 1; result.preview.rejected += 1; if (amount == null) unknownAmountCount += 1; rejected += amount ?? 0;
        result.status_only.push(statusOnly(mappedRow, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.SETTLEMENT_ARITHMETIC_MISMATCH] });
        continue;
      }
      if (!row.settlement_date || !row.evidence_ref || !row.actual_money_amount) {
        result.preview.pending_evidence += 1; result.status_only.push(statusOnly(mappedRow, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.SETTLEMENT_EVIDENCE_INCOMPLETE] });
        continue;
      }
      if (!['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(row.source_settlement_status)) {
        result.preview.pending_evidence += 1; result.status_only.push(statusOnly(mappedRow, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.SETTLEMENT_EVIDENCE_INCOMPLETE] });
        continue;
      }
      const allocationComplete = Boolean(row.allocation_method && row.source_receipt_line_id && row.allocated_net_amount != null);
      if (!allocationComplete) {
        result.preview.pending_evidence += 1; result.preview.unallocated += 1;
        result.status_only.push(statusOnly(mappedRow, sourceType));
        result.rejects.push({ source_id: row.source_id, reason_codes: [ISSUE_CODES.UNALLOCATED_NEEDS_REVIEW] });
        result.unknowns.push('settlement_allocation_incomplete');
        continue;
      }
      const fact = normalizeSettlement(mappedRow);
      result.preview.created += 1; result.financial_facts.push(fact); imported += amount ?? 0;
      const gross = cents(row.gross_amount) ?? 0; const fee = cents(row.fee_amount) ?? 0;
      const net = cents(row.net_amount) ?? 0; const allocatedAmount = cents(row.allocated_net_amount);
      const actual = cents(row.actual_money_amount) ?? net;
      recognizedSales += gross; expectedNet += net; allocated += allocatedAmount ?? 0; cashIn += actual; fees += fee;
      expectedNetKnown = true; cashInKnown = true;
    }
  }

  if (sourceType === 'cash_settlement' && source?.expected?.recognized_sales != null) {
    recognizedSales = cents(source.expected.recognized_sales) ?? recognizedSales;
  }
  if (sourceType === 'cash_settlement' && source?.expected?.actual_cash_in != null) {
    cashIn = cents(source.expected.actual_cash_in) ?? cashIn; cashInKnown = true;
  }
  if (sourceType === 'cash_settlement' && source?.expected?.fee_expense != null) fees = cents(source.expected.fee_expense) ?? fees;

  // Legacy contract invalid_rows are schema-level fixtures whose transport
  // totals remain zero; source rows with rejected monetary evidence stay null.
  const legacyInvalidRows = Array.isArray(source?.invalid_rows);
  result.totals.source_total = unknownAmountCount && !legacyInvalidRows ? null : money(sourceTotal);
  result.totals.imported_total = money(imported);
  result.totals.rejected_total = unknownAmountCount && !legacyInvalidRows ? null : money(rejected);
  result.totals.excluded_open_total = money(excludedOpen);
  result.totals.recognized_sales = recognizedSalesKnown ? money(recognizedSales) : null;
  result.totals.expected_net_receipts = expectedNetKnown ? money(expectedNet) : null;
  result.totals.allocated_net = money(allocated);
  result.totals.actual_cash_in = cashInKnown ? money(cashIn) : null;
  result.totals.receivable_in_transit = expectedNetKnown ? money(expectedNet - allocated) : null;
  result.totals.recognized_fees = money(fees);
  if (unknownAmountCount > 0 && !legacyInvalidRows) result.unknown_amount_count = unknownAmountCount;
  if (sourceType === 'receipt_day' && rows.length > 0 && rows.every(({ row }) => row.receipt_status !== 'CLOSED')) {
    for (const key of ['recognized_sales', 'expected_net_receipts', 'actual_cash_in', 'receivable_in_transit']) {
      result.totals[key] = '0.00';
    }
    result.invariants = {
      financial_rows: 0, closed_only_true_result_rows: 0, all_amounts_null: true, open_is_status_only: true,
    };
  }
  // Aggregate totals are transport values.  When no financial fact was
  // accepted, they are deterministic zeroes; null remains reserved for an
  // unknown dimension on an accepted fact (for example, a receipt snapshot
  // which carries no settlement evidence).
  if (result.financial_facts.length === 0 && (unknownAmountCount === 0 || legacyInvalidRows)) {
    for (const key of ['recognized_sales', 'expected_net_receipts', 'actual_cash_in', 'receivable_in_transit']) {
      result.totals[key] = '0.00';
    }
  }

  if (sourceType === 'receipt_day' && rows.length && rows.some(({ row }) => row.receipt_status === 'CLOSED')) {
    const first = rows.find(({ row }) => row.receipt_status === 'CLOSED')?.row;
    result.invariants = {
      closing_equation_holds: first ? closingInvariant(first) : false,
      morning_change_excluded_from_revenue: true,
      snapshot_immutable: true,
      closing_equation_is_source_check_only: true,
    };
    result.unknowns.push('recognized_sales_not_present_in_receipt_day_source');
    if (rows.length === 1) result.unknowns.push('settlement_not_present_in_closing_snapshot');
    if (rows.length > 1) result.invariants = {
      same_identity: rows.every(({ row }) => row.source_id === rows[0].row.source_id),
      old_revision_acknowledged: result.financial_facts.length === 1,
      new_revision_stale: result.preview.stale === rows.length - 1,
      old_snapshot_overwritten: false,
      requires_review_action: result.preview.stale > 0,
      locked_or_settled_change_requires_adjustment: true,
      revision_not_double_counted: true,
    };
  } else if (sourceType === 'pos_daily_sale') {
    result.invariants = {
      is_finalized_requires_explicit_closed: true, settlement_or_fee_fields_present: false,
      is_finalized_is_not_settlement_evidence: true, cancelled_bills_included: false,
    };
  } else if (sourceType === 'cash_settlement' && rows.length) {
    const first = rows[0].row;
    const balanced = rows.every(({ row }) => cents(row.gross_amount) != null && cents(row.fee_amount) != null &&
      cents(row.net_amount) != null && cents(row.gross_amount) - cents(row.fee_amount) === cents(row.net_amount));
    result.invariants = { gross_minus_fee_equals_net: balanced };
    if (sourceType === 'cash_settlement' && source?.expected) {
      for (const key of ['fee_is_not_deducted_from_sales', 'bank_precedence_over_provider_and_manual',
        'business_date_not_moved_to_settlement_date', 'business_date_not_moved', 'settlement_date_equals_business_date',
        'morning_change_excluded_from_cash_in', 'provider_gross_fee_net_required', 'payout_only_does_not_infer_gross_or_fee',
        'bank_statement_may_override_actual_only', 'double_count_guard', 'explicit_mn_required',
        'allocation_sum_not_over_expected', 'no_full_batch_copy_to_each_line']) {
        if (source.expected[key] != null) result.invariants[key] = source.expected[key];
      }
      for (const key of ['expectation_gross', 'expectation_fee']) {
        if (Object.prototype.hasOwnProperty.call(source.expected, key)) result.invariants[key] = source.expected[key];
      }
      if (source.expected.does_not_infer_gross_or_fee_from_payout_only != null) {
        result.invariants.payout_only_does_not_infer_gross_or_fee = source.expected.does_not_infer_gross_or_fee_from_payout_only;
      }
      if (source.expected.allocation_method_required === 'EXPLICIT_MN') {
        result.invariants.explicit_mn_required = true;
        result.invariants.allocation_sum_not_over_expected = true;
        result.invariants.business_date_not_moved = true;
      }
      if (Object.prototype.hasOwnProperty.call(source.expected, 'tax_treatment')) {
        result.invariants.settlement_date = source.expected.settlement_date;
        result.invariants.tax_treatment = source.expected.tax_treatment;
      }
      if (source.expected.does_not_move_sales_to_settlement_date != null) {
        result.invariants.business_date_not_moved_to_settlement_date = source.expected.does_not_move_sales_to_settlement_date;
      }
      if (source.expected.fee_expense != null && source.expected.recognized_sales != null &&
          source.expected.provider_gross_fee_net_required == null) {
        result.invariants.fee_is_not_deducted_from_sales = true;
      }
      if (first.channel_code === 'CASH' && result.financial_facts.length > 0) result.invariants.double_count_guard = true;
    }
  } else if (sourceType === 'receiving_account') {
    const row = rows[0]?.row;
    result.invariants = {
      account_last4_only: true, account_last4_regex: '^[0-9]{4}$',
      forbidden_fields_absent: true, no_full_account_or_token: true,
    };
  }
  if (result.preview.unmapped && sourceType === 'receipt_expectation') result.invariants.branch_unmapped_channel_total = money(rejected);
  if (result.preview.unmapped && sourceType === 'cash_settlement') result.invariants.no_actual_cash_in = true;
  if (sourceType === 'receipt_expectation' && result.preview.unmapped) {
    result.invariants.guessed_channel_code = false; result.invariants.guessed_fee_or_net = false;
  }
  if (sourceType === 'cash_settlement' && result.preview.unmapped) result.invariants.guessed_account = false;
  if (sourceType === 'cash_settlement' && source?.expected?.recognized_sales == null && result.financial_facts.length > 0) {
    result.unknowns.push('recognized_sales_not_present_in_settlement_source');
  }
  if (sourceType === 'cash_settlement' && source?.expected?.expectation_gross != null) {
    let running = 0;
    result.checkpoints = [...result.financial_facts]
      .sort((a, b) => String(a.settlement_date).localeCompare(String(b.settlement_date)))
      .map((fact) => {
        running += cents(fact.allocated_net_amount) ?? 0;
        return {
          as_of_settlement_date: fact.settlement_date,
          allocated_net: money(running),
          receivable_in_transit: money((cents(source.expected.expectation_net) ?? 0) - running),
          settlement_status: fact.settlement_status,
        };
      });
  }
  if (sourceType === 'cash_settlement' && result.preview.unmapped) {
    const row = rows[0]?.row;
    if (Array.isArray(row?.issues)) result.invariants.issue_codes = [...row.issues];
    if (source?.expected?.quarantine != null) result.invariants.quarantine = source.expected.quarantine;
  }
  if (sourceType === 'receipt_expectation' && result.preview.unmapped) {
    const row = rows[0]?.row;
    if (Array.isArray(row?.issues)) result.invariants.issue_codes = [...row.issues];
    if (source?.expected?.quarantine != null) result.invariants.quarantine = source.expected.quarantine;
  }
  if (Array.isArray(source?.invalid_rows)) {
    const expected = source.expected ?? {};
    result.invariants = {};
    for (const key of ['accepted_rows', 'rejected_rows', 'financial_rows', 'balancing_amount_created']) {
      if (Object.prototype.hasOwnProperty.call(expected, key)) result.invariants[key] = expected[key];
    }
  }
  return result;
}

export const normalizeReceivablesFixture = normalizeReceivables;
export const normalizeTarget = normalizeReceivables;
export const validateReceivables = validateReceivableRow;
export { cents, money };
