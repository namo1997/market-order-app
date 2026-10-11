import { overviewDefaults } from './receiptsOverviewState.js';
import { thailandBusinessDate } from './cashierReceiptSync.js';

// Current-month cards stop today so future placeholders do not bury real work.
export function mobileMonthRange(month, today = thailandBusinessDate()) {
  const { from, to } = overviewDefaults(`${month}-01`);
  return { from, to: month === today.slice(0, 7) ? today : to };
}

export function mobileInitialRange(search = '', today = thailandBusinessDate()) {
  const date = new URLSearchParams(search).get('date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date || '') && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) return { from: date, to: date };
  return mobileMonthRange(today.slice(0, 7), today);
}
