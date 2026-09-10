import { canonicalRevision, serializeAccountingRow } from '../accountingExportReceivables.js';

export const MONTHLY_CLOSE_SCHEMA_VERSION = '1.0';
export const MONTHLY_CLOSE_SOURCE_TYPES = Object.freeze([
  'pos_daily_sale',
  'receipt_day',
  'receipt_expectation',
  'cash_settlement',
  'receivable_adjustment',
  'payment_channel',
  'receiving_account'
]);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY_RE = /^-?\d+\.\d{2}$/;
const ELIGIBLE_SETTLEMENT_STATES = new Set(['SETTLED', 'PARTIALLY_SETTLED']);
const ELIGIBLE_SETTLEMENT_SOURCES = new Set(['BANK_STATEMENT', 'BANK_SETTLEMENT', 'MANUAL', 'LEGACY_EVIDENCE', 'CASH_ON_HAND']);

const fail = (code, message, statusCode = 400, details = undefined) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
};

export const parseMonthlyCloseMonth = (value) => {
  const month = String(value || '');
  if (!MONTH_RE.test(month)) throw fail('INVALID_MONTH', 'เดือนต้องอยู่ในรูปแบบ YYYY-MM');
  const [year, number] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
};

export const todayBangkok = (clock = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(clock);

const asMoneyString = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value.toFixed(2);
  }
  const text = String(value);
  return MONEY_RE.test(text) ? text : null;
};

const toCents = (value) => {
  const text = asMoneyString(value);
  if (text === null) return null;
  const negative = text.startsWith('-');
  const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -cents : cents;
};

const money = (value) => {
  const cents = BigInt(value || 0);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

const sumField = (rows, field) => rows.reduce((total, row) => total + (toCents(row[field]) || 0n), 0n);
const expectedDates = ({ from, days }) => Array.from({ length: days }, (_, index) => `${from.slice(0, 8)}${String(index + 1).padStart(2, '0')}`);
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

const settlementAmount = (row) => {
  if (!ELIGIBLE_SETTLEMENT_STATES.has(row.settlement_status)) return null;
  if (!ELIGIBLE_SETTLEMENT_SOURCES.has(row.settlement_source)) return null;
  if (row.settlement_source !== 'CASH_ON_HAND' && !row.evidence_ref) return null;
  return toCents(row.source_batch_id ? row.allocated_net_amount : row.actual_money_amount);
};

const publicDataset = (sourceType, rows = []) => rows.map((row) => serializeAccountingRow(sourceType, row));

const channelSummary = (expectations, settlements) => {
  const channels = new Map();
  const ensure = (code) => {
    const key = String(code || 'UNMAPPED');
    if (!channels.has(key)) channels.set(key, { channel_code: key, expected_gross: 0n, expected_fee: 0n, expected_net: 0n, received: 0n, pending: 0n, unknown_expected_count: 0, pending_line_count: 0 });
    return channels.get(key);
  };
  const receivedByLine = new Map();
  settlements.forEach((row) => {
    const amount = settlementAmount(row);
    if (amount === null) return;
    const lineId = String(row.source_receipt_line_id || '');
    receivedByLine.set(lineId, (receivedByLine.get(lineId) || 0n) + amount);
    ensure(row.channel_code).received += amount;
  });
  expectations.forEach((row) => {
    const item = ensure(row.channel_code);
    const gross = toCents(row.expected_gross_amount);
    const fee = toCents(row.expected_fee_amount);
    const net = toCents(row.expected_net_amount);
    if (gross !== null) item.expected_gross += gross;
    if (fee !== null) item.expected_fee += fee;
    if (net === null) {
      item.unknown_expected_count += 1;
      return;
    }
    item.expected_net += net;
    const received = receivedByLine.get(String(row.source_receipt_line_id || '')) || 0n;
    const pending = net > received ? net - received : 0n;
    item.pending += pending;
    if (pending > 0n) item.pending_line_count += 1;
  });
  return [...channels.values()].sort((a, b) => a.channel_code.localeCompare(b.channel_code)).map((row) => ({
    channel_code: row.channel_code,
    expected_gross: money(row.expected_gross),
    expected_fee: money(row.expected_fee),
    expected_net: row.unknown_expected_count ? null : money(row.expected_net),
    received: money(row.received),
    pending: row.unknown_expected_count ? null : money(row.pending),
    pending_line_count: row.pending_line_count,
    unknown_expected_count: row.unknown_expected_count
  }));
};

export const buildMonthlySalesCloseSnapshot = ({ month, branch, datasets = {}, today = todayBangkok() }) => {
  const period = parseMonthlyCloseMonth(month);
  if (!branch?.code) throw fail('INVALID_BRANCH', 'ไม่พบรหัสสาขา');
  const serialized = Object.fromEntries(MONTHLY_CLOSE_SOURCE_TYPES.map((sourceType) => [sourceType, publicDataset(sourceType, datasets[sourceType] || [])]));
  const sales = serialized.pos_daily_sale;
  const receipts = serialized.receipt_day;
  const expectations = serialized.receipt_expectation.filter((row) => row.record_status !== 'OPEN_STATUS_ONLY');
  const settlements = serialized.cash_settlement.filter((row) => row.record_status !== 'OPEN_STATUS_ONLY');
  const adjustments = serialized.receivable_adjustment;
  const dates = expectedDates(period);
  const receiptsByDate = new Map();
  receipts.forEach((row) => {
    const list = receiptsByDate.get(row.business_date) || [];
    list.push(row);
    receiptsByDate.set(row.business_date, list);
  });
  const salesByDate = new Map();
  sales.forEach((row) => {
    const list = salesByDate.get(row.business_date) || [];
    list.push(row);
    salesByDate.set(row.business_date, list);
  });
  const missingDates = dates.filter((date) => !receiptsByDate.has(date));
  const missingSalesDates = dates.filter((date) => !salesByDate.has(date));
  const duplicateDates = dates.filter((date) => (receiptsByDate.get(date) || []).length > 1 || (salesByDate.get(date) || []).length > 1);
  const openDates = uniqueSorted(receipts.filter((row) => row.receipt_status !== 'CLOSED' || row.record_status === 'OPEN_STATUS_ONLY').map((row) => row.business_date));
  const invalidDates = uniqueSorted([
    ...receipts.filter((row) => row.receipt_status === 'CLOSED' && (row.record_status !== 'CLOSED_READY' || row.gross_sales_expected === null)).map((row) => row.business_date),
    ...sales.filter((row) => row.receipt_status === 'CLOSED' && (row.record_status !== 'CLOSED_READY' || row.gross_amount_incl_vat === null)).map((row) => row.business_date)
  ]);
  const periodEnded = period.to < today;
  const blockers = [];
  if (!periodEnded) blockers.push({ code: 'PERIOD_NOT_ENDED', message: 'ปิดยอดรายเดือนได้หลังวันสุดท้ายของเดือน' });
  if (missingDates.length) blockers.push({ code: 'MISSING_DAILY_RECEIPTS', message: `ไม่มีเอกสารรับเงิน ${missingDates.length} วัน`, dates: missingDates });
  if (missingSalesDates.length) blockers.push({ code: 'MISSING_DAILY_SALES', message: `ไม่พบยอดขายต้นทาง ${missingSalesDates.length} วัน`, dates: missingSalesDates });
  if (openDates.length) blockers.push({ code: 'DAILY_RECEIPTS_NOT_CLOSED', message: `ยังปิดยอดรายวันไม่ครบ ${openDates.length} วัน`, dates: openDates });
  if (duplicateDates.length) blockers.push({ code: 'DUPLICATE_DAILY_FACTS', message: `ข้อมูลรายวันซ้ำ ${duplicateDates.length} วัน`, dates: duplicateDates });
  if (invalidDates.length) blockers.push({ code: 'INVALID_DAILY_FACTS', message: `ข้อมูลยอดขายหรือยอดปิดวันไม่สมบูรณ์ ${invalidDates.length} วัน`, dates: invalidDates });

  const validExpectations = expectations.filter((row) => row.channel_code !== 'OTHER_UNKNOWN' && !['REJECTED'].includes(row.record_status));
  const validSettlements = settlements.filter((row) => row.channel_code !== 'OTHER_UNKNOWN' && !['REJECTED', 'QUARANTINED'].includes(row.record_status));
  const receivedByLine = new Map();
  let confirmedReceived = 0n;
  let confirmedSettlementCount = 0;
  validSettlements.forEach((row) => {
    const amount = settlementAmount(row);
    if (amount === null) return;
    confirmedReceived += amount;
    confirmedSettlementCount += 1;
    const lineId = String(row.source_receipt_line_id || '');
    receivedByLine.set(lineId, (receivedByLine.get(lineId) || 0n) + amount);
  });
  let pending = 0n;
  let pendingLineCount = 0;
  let unknownExpectedCount = 0;
  let overReceived = 0n;
  validExpectations.forEach((row) => {
    const net = toCents(row.expected_net_amount);
    if (net === null) {
      unknownExpectedCount += 1;
      return;
    }
    const received = receivedByLine.get(String(row.source_receipt_line_id || '')) || 0n;
    if (received < net) {
      pending += net - received;
      pendingLineCount += 1;
    } else if (received > net) {
      overReceived += received - net;
    }
  });
  const unresolvedSettlementCount = settlements.filter((row) => settlementAmount(row) === null && row.record_status !== 'OPEN_STATUS_ONLY').length;
  const exceptionCount = [...expectations, ...settlements].filter((row) => ['REJECTED', 'QUARANTINED'].includes(row.record_status) || ['EXCEPTION', 'UNMAPPED'].includes(row.settlement_status)).length;
  const warnings = [];
  if (pendingLineCount || unknownExpectedCount) warnings.push({ code: 'RECEIPTS_PENDING', message: 'ยังมีเงินรอรับหรือรอหลักฐาน ซึ่งแยกติดตามจากยอดขายที่ปิดแล้ว', count: pendingLineCount + unknownExpectedCount });
  if (exceptionCount) warnings.push({ code: 'RECEIPT_EXCEPTIONS', message: 'มีรายการรับเงินที่ต้องตรวจการจับคู่หรือการตั้งค่า', count: exceptionCount });
  if (adjustments.length) warnings.push({ code: 'POST_CLOSE_ADJUSTMENTS_INCLUDED', message: 'ชุดข้อมูลนี้รวมรายการปรับปรุงหลังปิดรายวัน', count: adjustments.length });

  const recognizedSales = sales.filter((row) => row.record_status === 'CLOSED_READY').reduce((total, row) => total + (toCents(row.gross_amount_incl_vat) || 0n), 0n);
  const billCount = sales.filter((row) => row.record_status === 'CLOSED_READY').reduce((total, row) => total + (Number.isSafeInteger(Number(row.bill_count)) ? Number(row.bill_count) : 0), 0);
  const expectedGross = sumField(validExpectations, 'expected_gross_amount');
  const expectedFee = sumField(validExpectations, 'expected_fee_amount');
  const expectedNetKnown = sumField(validExpectations, 'expected_net_amount');
  const originalVariance = sumField(receipts.filter((row) => row.record_status === 'CLOSED_READY'), 'variance_total');
  const adjustmentTotal = sumField(adjustments, 'amount');
  const sourceSnapshotSha256 = canonicalRevision({ period, branch_code: branch.code, datasets: serialized });

  return Object.freeze({
    schema_version: MONTHLY_CLOSE_SCHEMA_VERSION,
    source: 'GENERAL_CASHFLOW',
    source_type: 'monthly_sales_close_snapshot',
    period: { month: period.month, from: period.from, to: period.to, timezone: 'Asia/Bangkok' },
    branch: { id: Number(branch.id), code: String(branch.code), name: String(branch.name || branch.code) },
    source_snapshot_sha256: sourceSnapshotSha256,
    ready_to_close: blockers.length === 0,
    completeness: {
      expected_days: period.days,
      receipt_days: receiptsByDate.size,
      closed_days: receipts.filter((row) => row.receipt_status === 'CLOSED' && row.record_status === 'CLOSED_READY').length,
      missing_dates: missingDates,
      missing_sales_dates: missingSalesDates,
      open_dates: openDates,
      duplicate_dates: duplicateDates,
      invalid_dates: invalidDates
    },
    blockers,
    warnings,
    summary: {
      currency: 'THB',
      recognized_sales: money(recognizedSales),
      bill_count: billCount,
      expected_receipts_gross: money(expectedGross),
      expected_fees: money(expectedFee),
      expected_receipts_net: unknownExpectedCount ? null : money(expectedNetKnown),
      confirmed_received: money(confirmedReceived),
      confirmed_settlement_count: confirmedSettlementCount,
      pending_receipts: unknownExpectedCount ? null : money(pending),
      pending_line_count: pendingLineCount,
      unknown_expected_count: unknownExpectedCount,
      over_received: money(overReceived),
      acknowledged_daily_variance: money(originalVariance + adjustmentTotal),
      post_close_adjustment_total: money(adjustmentTotal),
      post_close_adjustment_count: adjustments.length,
      unresolved_settlement_count: unresolvedSettlementCount,
      exception_count: exceptionCount
    },
    channels: channelSummary(validExpectations, validSettlements),
    datasets: serialized
  });
};

export const monthlyClosePublicPreview = (snapshot, latestClose = null) => ({
  schema_version: snapshot.schema_version,
  source: snapshot.source,
  period: snapshot.period,
  branch: snapshot.branch,
  source_snapshot_sha256: snapshot.source_snapshot_sha256,
  ready_to_close: snapshot.ready_to_close,
  completeness: snapshot.completeness,
  blockers: snapshot.blockers,
  warnings: snapshot.warnings,
  summary: snapshot.summary,
  channels: snapshot.channels,
  latest_close: latestClose
});

export const buildCompanyMonthlySummary = ({ month, branches = [] }) => {
  const closed = branches.filter((row) => row.latest_close);
  const add = (field) => closed.reduce((total, row) => total + (toCents(row.latest_close.summary?.[field]) || 0n), 0n);
  return {
    month,
    status: branches.length > 0 && closed.length === branches.length ? 'CLOSED_READY' : 'INCOMPLETE',
    operational_branch_count: branches.length,
    closed_branch_count: closed.length,
    missing_branches: branches.filter((row) => !row.latest_close).map((row) => row.branch.code),
    summary: {
      currency: 'THB',
      recognized_sales: money(add('recognized_sales')),
      expected_fees: money(add('expected_fees')),
      confirmed_received: money(add('confirmed_received')),
      pending_receipts: closed.some((row) => row.latest_close.summary?.pending_receipts === null) ? null : money(add('pending_receipts')),
      acknowledged_daily_variance: money(add('acknowledged_daily_variance'))
    }
  };
};

export const monthlyCloseError = fail;
