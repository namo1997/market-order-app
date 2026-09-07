export const overviewDefaults = (date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())) => ({
  basis: 'sale', from: `${date.slice(0, 7)}-01`,
  to: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10),
  branch_id: '', channel_id: '', account_id: '', status: '', attention: false, tab: 'daily', page: 1, page_size: 50,
});
export const overviewMoney = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const overviewDate = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' }) : 'ยังไม่ทราบ';
export const overviewWeekday = value => new Date(`${value}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long' });
export const overviewRequest = (current, changes) => ({ ...current, ...changes, page: changes.page ?? 1 });
