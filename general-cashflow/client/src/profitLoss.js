export const formatPnlMoney = (value) => value == null ? '—' : new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export const sumPnlRows = (rows) => rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;
export const thaiMonth = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
export const previousMonth = (month) => { const [y, m] = month.split('-').map(Number); return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`; };

// MySQL dateStrings DATETIME has no offset; persisted timestamps are UTC.
// Match Cashflow's Thai dateStyle/timeStyle display after making UTC explicit.
export const formatPnlDateTime = (value) => {
  if (!value) return '-';
  const input = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(String(value)) ? String(value).replace(' ', 'T') + 'Z' : value;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
};
export const pnlView = (report, mode = 'matched') => mode === 'matched' ? {
  totals: report.totals_matched,
  branch_columns: report.branch_columns.map((row) => ({ ...row, ...row.matched })),
  category_rows: report.category_rows.map((row) => ({ ...row, ...row.matched }))
} : { totals: report.totals, branch_columns: report.branch_columns, category_rows: report.category_rows };

export const formatPnlMonth = (month) => new Intl.DateTimeFormat('th-TH', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
export const periodMonthBounds = (businessDate) => {
  const max = businessDate.slice(0, 7);
  return { max, min: previousMonth(previousMonth(previousMonth(max))) };
};
export const formatPnlDate = (date) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

// Presentation helpers: never mutate report rows or replace report totals.
export const waitingPnlItems = (items, query = '', showAll = false) => {
  const needle = query.trim().toLocaleLowerCase('th-TH');
  const matching = items.filter((item) => `${item.supplier_name || ''} ${item.description || ''}`.toLocaleLowerCase('th-TH').includes(needle))
    .sort((a, b) => Number(b.amount) - Number(a.amount) || String(a.stable_key).localeCompare(String(b.stable_key)));
  return { items: showAll ? matching : matching.slice(0, 15), count: matching.length };
};
const zero = (value) => value != null && Number(value) === 0;
export const isZeroPnlCategory = (row) => zero(row.amount) && Object.values(row.branches || {}).every(zero);
export const visiblePnlColumns = (view) => view.branch_columns.filter((column) =>
  !['UNASSIGNED', 'CENTRAL', 'PRODUCTION'].includes(column.key) ||
  !(['revenue', 'cogs', 'opex', 'gross_profit', 'net_profit'].every((field) => zero(column[field])) &&
    view.category_rows.every((row) => zero(row.branches?.[column.key]))));
export const pnlMonthlyDisplay = (item, report, mode) => {
  if (item.skipped) return 0;
  if (mode !== 'matched') return item.amount;
  const days = item.branch_id == null ? report.matched_days : report.completeness.find((row) => String(row.branch_id) === String(item.branch_id))?.matched_days || 0;
  const [year, month] = report.month.split('-').map(Number);
  return Math.round(Math.round(Number(item.amount) * 100) * days / new Date(Date.UTC(year, month, 0)).getUTCDate()) / 100;
};
export const pnlApproximateSources = (report) => [...(report.recurring?.items || []).filter((item) => !item.skipped), ...(report.manual_expenses || []), ...(report.moved_in?.items || []).filter((item) => !item.excluded)];
