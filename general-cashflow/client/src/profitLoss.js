export const formatPnlMoney = (value) => value == null ? '—' : new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export const sumPnlRows = (rows) => rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;
export const thaiMonth = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
export const previousMonth = (month) => { const [y, m] = month.split('-').map(Number); return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`; };
