import { overviewDefaults } from './receiptsOverviewState.js';
import { thailandBusinessDate } from './cashierReceiptSync.js';

// Current-month cards stop today so future placeholders do not bury real work.
export function mobileMonthRange(month, today = thailandBusinessDate()) {
  const { from, to } = overviewDefaults(`${month}-01`);
  return { from, to: month === today.slice(0, 7) ? today : to };
}
