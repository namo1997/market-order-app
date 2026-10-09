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
