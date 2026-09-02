import crypto from 'node:crypto';

export const ACCOUNTING_EXPORT_SCHEMA_VERSION = '1.0';
export const ACCOUNTING_EXPORT_SOURCE = 'GENERAL_CASHFLOW';
export const PILOT_FROM = '2026-08-01';
export const PILOT_TO = '2026-08-31';
export const PILOT_BRANCH = 'SK';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DECIMAL_RE = /^-?\d+(?:\.\d{1,2})?$/;
const MONEY_FIELDS = new Set([
  'gross_amount_incl_vat', 'gross_sales_expected', 'cash_expected', 'non_cash_expected',
  'morning_change_amount', 'actual_money_total', 'deduction_total', 'line_adjustment_total',
  'misc_adjustment_total', 'pos_with_change_total', 'reconciled_total', 'variance_total',
  'pos_amount', 'cashier_confirmed_amount', 'expected_gross_amount', 'expected_fee_amount',
  'expected_net_amount', 'gross_amount', 'fee_amount', 'net_amount', 'actual_money_amount',
  'matched_amount', 'allocated_net_amount', 'allocated_fee_amount'
]);
const OPEN_NULL_FIELDS = new Set([
  ...MONEY_FIELDS,
  'evidence_ref', 'receiving_account_ref', 'settlement_date', 'settlement_source',
  'source_settlement_source', 'source_settlement_status', 'settlement_status',
  'expected_fee_amount', 'expected_net_amount', 'cashier_confirmed_amount'
]);

const SOURCE_FIELDS = {
  'pos_daily_sale': ['source_id', 'revision', 'updated_at', 'revision_of', 'business_date', 'branch_code', 'gross_amount_incl_vat', 'bill_count', 'receipt_status', 'closed_at', 'is_finalized', 'currency'],
  'receipt_day': ['source_id', 'source_receipt_id', 'revision', 'revision_of', 'updated_at', 'business_date', 'branch_code', 'receipt_status', 'source_receipt_status', 'gross_sales_expected', 'cash_expected', 'non_cash_expected', 'morning_change_amount', 'bill_count', 'closed_at', 'closing_snapshot_version', 'actual_money_total', 'deduction_total', 'line_adjustment_total', 'misc_adjustment_total', 'pos_with_change_total', 'reconciled_total', 'variance_total', 'currency'],
  'receipt_expectation': ['source_id', 'source_receipt_line_id', 'source_receipt_id', 'revision', 'revision_of', 'updated_at', 'business_date', 'branch_code', 'receipt_status', 'source_receipt_status', 'channel_code', 'channel_label', 'channel_kind', 'provider', 'pos_amount', 'cashier_confirmed_amount', 'expected_gross_amount', 'expected_fee_amount', 'expected_net_amount', 'source_settlement_status', 'settlement_status', 'source_settlement_source', 'settlement_date', 'currency'],
  'cash_settlement': ['source_id', 'source_settlement_id', 'source_receipt_line_id', 'source_batch_id', 'revision', 'revision_of', 'updated_at', 'business_date', 'settlement_date', 'branch_code', 'channel_code', 'receiving_account_ref', 'gross_amount', 'fee_amount', 'net_amount', 'actual_money_amount', 'matched_amount', 'allocated_net_amount', 'allocated_fee_amount', 'allocation_method', 'source_settlement_status', 'settlement_status', 'source_settlement_source', 'settlement_source', 'evidence_ref', 'currency'],
  'payment_channel': ['source_id', 'source_channel_id', 'code', 'label', 'kind', 'provider', 'is_active', 'revision', 'revision_of', 'updated_at'],
  'receiving_account': ['source_id', 'source_account_id', 'label', 'bank_name', 'account_alias', 'account_type', 'account_last4', 'branch_codes', 'channel_codes', 'is_active', 'revision', 'revision_of', 'updated_at']
};

const fail = (code, message, field, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  error.statusCode = status;
  return error;
};

const isValidDate = (value) => {
  if (!DATE_RE.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const asDate = (value) => String(value || '').slice(0, 10);

export const parseMoney = (value, { nullable = true } = {}) => {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new Error('decimal is required');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.round(value * 100) !== value * 100) throw new Error('invalid decimal');
    return value.toFixed(2);
  }
  const text = String(value);
  if (!DECIMAL_RE.test(text) || !/\.\d{2}$/.test(text)) throw new Error('invalid decimal');
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};

const isMoney = (value) => {
  try { parseMoney(value, { nullable: false }); return true; } catch { return false; }
};

const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      if (!['revision', 'revision_of', 'updated_at'].includes(key)) out[key] = sortObject(value[key]);
      return out;
    }, {});
  }
  return value;
};

export const canonicalRevision = (row) => crypto
  .createHash('sha256')
  .update(JSON.stringify(sortObject(row)))
  .digest('hex');

const isoWithOffset = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (OFFSET_ISO_RE.test(text)) return text;
  // mysql DATETIME has no zone; the General Cashflow database is Bangkok time.
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?$/);
  return match ? `${match[1]}T${match[2]}+07:00` : null;
};

const isClosed = (row, sourceType) => sourceType === 'payment_channel' || sourceType === 'receiving_account'
  || row.receipt_status === 'CLOSED' || row.source_receipt_status === 'CLOSED' || row.record_status === 'CLOSED_READY' || row.record_status === 'QUARANTINED' || row.record_status === 'REJECTED' || row.record_status === 'STALE';
const rowStatus = (row, closed) => {
  if (!closed) return 'OPEN_STATUS_ONLY';
  if (row.record_status && ['STALE', 'QUARANTINED', 'REJECTED'].includes(row.record_status)) return row.record_status;
  return 'CLOSED_READY';
};

const sanitizedAccountLast4 = (value) => /^\d{4}$/.test(String(value || '')) ? String(value) : null;

export const serializeAccountingRow = (sourceType, input, options = {}) => {
  if (!SOURCE_FIELDS[sourceType]) throw new Error(`Unsupported accounting source type: ${sourceType}`);
  const row = { ...input };
  const closed = isClosed(row, sourceType);
  const output = {};
  for (const field of SOURCE_FIELDS[sourceType]) {
    let value = row[field] ?? null;
    if (field === 'revision') value = SHA256_RE.test(String(value || '')) ? String(value) : canonicalRevision(row);
    if (field === 'updated_at') value = isoWithOffset(value);
    if (MONEY_FIELDS.has(field) && value !== null) {
      try { value = parseMoney(value); } catch { value = null; }
    }
    if (field === 'account_last4') value = sanitizedAccountLast4(value);
    if (sourceType === 'receiving_account' && ['branch_codes', 'channel_codes'].includes(field) && !Array.isArray(value)) value = value ? String(value).split(',').map((x) => x.trim()).filter(Boolean) : [];
    output[field] = value;
  }
  if (!output.source_id && row.source_id) output.source_id = row.source_id;
  const issues = Array.isArray(row.issues) ? [...row.issues] : [];
  if (!SHA256_RE.test(String(row.revision || ''))) issues.push('INVALID_REVISION');
  if (row.updated_at && !isoWithOffset(row.updated_at)) issues.push('INVALID_UPDATED_AT');
  if (row.business_date && !isValidDate(asDate(row.business_date))) issues.push('INVALID_DATE');
  for (const field of MONEY_FIELDS) if (row[field] !== null && row[field] !== undefined && row[field] !== '' && !isMoney(row[field])) issues.push('INVALID_DECIMAL_SCALE');
  if (sourceType === 'receiving_account' && row.account_last4 !== undefined && !sanitizedAccountLast4(row.account_last4)) issues.push('INVALID_ACCOUNT_LAST4');
  if (sourceType === 'cash_settlement' && row.source_settlement_status && !['PENDING_EVIDENCE', 'READY_FOR_STATEMENT', 'MATCHED_AUTO', 'MATCHED_MANUAL', 'EXCEPTION'].includes(row.source_settlement_status)) issues.push('UNMAPPED_SETTLEMENT_STATUS');
  if (!closed) {
    for (const field of OPEN_NULL_FIELDS) if (field in output) output[field] = null;
  }
  if (issues.length) {
    output.record_status = ['OPEN_STATUS_ONLY', 'QUARANTINED', 'STALE', 'REJECTED'].includes(row.record_status)
      ? row.record_status : 'REJECTED';
    output.issues = [...new Set(issues)].sort();
    if (output.record_status === 'REJECTED') {
      for (const field of MONEY_FIELDS) if (field in output) output[field] = null;
      for (const field of ['evidence_ref', 'settlement_date']) if (field in output) output[field] = null;
    }
  } else {
    output.record_status = rowStatus(row, closed);
    if (row.issues?.length) output.issues = [...new Set(row.issues)].sort();
  }
  if (!closed && !output.issues?.length) output.issues = ['OPEN_STATUS_ONLY'];
  if (sourceType === 'receiving_account') {
    // Never copy unknown source properties such as account_number/account_name.
    delete output.account_number;
    delete output.account_name;
    // The target's pure replay validator uses the pilot date as a validation
    // context for master rows, although master DTOs do not expose a date.
    // Keep this context non-enumerable so it cannot cross the HTTP boundary.
    Object.defineProperty(output, 'business_date', { value: PILOT_FROM, enumerable: false });
  }
  return output;
};

export const validateExportQuery = (query = {}) => {
  const from = String(query.from || '');
  const to = String(query.to || '');
  if (!isValidDate(from) || !isValidDate(to) || from > to || from < PILOT_FROM || to > PILOT_TO) throw fail('INVALID_DATE_RANGE', 'Date range must be within the approved pilot.', !isValidDate(from) ? 'from' : 'to');
  if (String(query.branch || '') !== PILOT_BRANCH) throw fail('INVALID_BRANCH', 'Branch is outside the approved pilot.', 'branch');
  let updatedSince = null;
  if (query.updated_since !== undefined && query.updated_since !== '') {
    const text = String(query.updated_since);
    if (!OFFSET_ISO_RE.test(text) || Number.isNaN(Date.parse(text))) throw fail('INVALID_UPDATED_SINCE', 'updated_since must be an ISO-8601 timestamp with offset.', 'updated_since');
    updatedSince = text;
  }
  const limitText = query.limit === undefined || query.limit === '' ? '100' : String(query.limit);
  const offsetText = query.offset === undefined || query.offset === '' ? '0' : String(query.offset);
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 500 || !/^\d+$/.test(offsetText)) throw fail('INVALID_PAGINATION', 'Pagination must use a limit from 1 to 500 and a non-negative offset.');
  const closedOnlyText = query.closed_only === undefined || query.closed_only === '' ? 'true' : String(query.closed_only).toLowerCase();
  if (!['true', 'false'].includes(closedOnlyText)) throw fail('INVALID_PAGINATION', 'closed_only must be true or false.', 'closed_only');
  return { from, to, branch: PILOT_BRANCH, updatedSince, limit: Number(limitText), offset: Number(offsetText), closedOnly: closedOnlyText === 'true' };
};

const compareNullable = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : String(a).localeCompare(String(b)));
export const deterministicCompare = (a, b) => compareNullable(asDate(a.business_date) || null, asDate(b.business_date) || null)
  || compareNullable(a.settlement_date ? asDate(a.settlement_date) : null, b.settlement_date ? asDate(b.settlement_date) : null)
  || String(a.branch_code || '').localeCompare(String(b.branch_code || ''))
  || String(a.source_id || '').localeCompare(String(b.source_id || ''))
  || String(a.revision || '').localeCompare(String(b.revision || ''));

export const filterPaginate = (rows, query, sourceType) => {
  const filtered = rows.map((row) => serializeAccountingRow(sourceType, row)).filter((row) => {
    const date = sourceType === 'cash_settlement' && row.business_date ? row.business_date : row.business_date;
    if (date && (date < query.from || date > query.to)) return false;
    if (query.updatedSince && (!row.updated_at || Date.parse(row.updated_at) <= Date.parse(query.updatedSince))) return false;
    if (query.closedOnly && row.record_status === 'OPEN_STATUS_ONLY') return false;
    return true;
  }).sort(deterministicCompare);
  const data = filtered.slice(query.offset, query.offset + query.limit);
  return { data, pagination: { limit: query.limit, offset: query.offset, total: filtered.length, next_offset: query.offset + data.length < filtered.length ? query.offset + data.length : null } };
};

export const successEnvelope = (sourceType, result) => ({ schema_version: ACCOUNTING_EXPORT_SCHEMA_VERSION, source: ACCOUNTING_EXPORT_SOURCE, source_type: sourceType, data: result.data, pagination: result.pagination });

export const errorEnvelope = (error) => ({ schema_version: ACCOUNTING_EXPORT_SCHEMA_VERSION, source: ACCOUNTING_EXPORT_SOURCE, error: { code: error.code || 'ACCOUNTING_EXPORT_ERROR', message: error.statusCode && error.statusCode >= 500 ? 'Accounting export failed.' : (error.message || 'Invalid accounting export request.'), ...(error.field ? { field: error.field } : {}) } });

export const createAccountingExportHandler = ({ sourceType, loadRows, authenticate } = {}) => async (req, res) => {
  try {
    if (authenticate) await authenticate(req);
    const query = validateExportQuery(req.query);
    const rows = await loadRows({ sourceType, ...query });
    res.status(200).json(successEnvelope(sourceType, filterPaginate(rows || [], query, sourceType)));
  } catch (error) {
    res.status(error.statusCode || 500).json(errorEnvelope(error));
  }
};

export const createAccountingExportHandlers = ({ loadRows, authenticate } = {}) => Object.fromEntries(Object.keys(SOURCE_FIELDS).map((sourceType) => [sourceType, createAccountingExportHandler({ sourceType, loadRows, authenticate })]));
