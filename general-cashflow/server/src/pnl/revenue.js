import { fetchExpectedSalesRange } from '../clickhouse.js';
import { cents, money } from './domain.js';
import { elapsedDates } from './report.js';

// Report-only supplement: never create/refresh a receipt or write POS data.
export const loadMissingPosRevenue = async ({ month, branches, receipts, branchId = null, now,
  fetchSalesRange = fetchExpectedSalesRange }) => {
  const dates = elapsedDates(month, now);
  const existing = new Set(receipts.map((row) => `${row.branch_id}:${row.receipt_date}`));
  const selected = branches.filter((row) => branchId == null || String(row.id) === String(branchId));
  const missing = selected.filter((branch) => dates.some((date) => !existing.has(`${branch.id}:${date}`)));
  const mapped = missing.filter((branch) => branch.clickhouse_branch_id);
  const unmapped_branch_ids = missing.filter((branch) => !branch.clickhouse_branch_id).map((branch) => branch.id);
  const status = { status: missing.length ? 'available' : 'not_needed', unmapped_branch_ids };
  if (!mapped.length) return { posRevenue: [], posRevenueStatus: status };
  try {
    const rows = await fetchSalesRange({ from: dates[0], to: dates.at(-1), branches: mapped, signal: AbortSignal.timeout(20000) });
    const byCode = new Map(mapped.map((branch) => [branch.code, branch]));
    const seen = new Set();
    const posRevenue = [];
    for (const row of rows) {
      const branch = byCode.get(row.branchCode);
      const key = `${branch?.id}:${row.businessDate}`;
      if (!branch || !dates.includes(row.businessDate) || existing.has(key) || seen.has(key)) continue;
      if (row.grossSalesExpected == null || !Number.isFinite(Number(row.grossSalesExpected))) throw new Error('Invalid POS amount');
      seen.add(key);
      posRevenue.push({ branch_id: branch.id, receipt_date: row.businessDate,
        gross_sales_expected: money(cents(row.grossSalesExpected)), bill_count: row.billCount,
        source: 'POS_WITHOUT_RECEIPT' });
    }
    return { posRevenue, posRevenueStatus: status };
  } catch {
    // Do not expose upstream response bodies, credentials or substitute false zeroes.
    return { posRevenue: [], posRevenueStatus: { ...status, status: 'unavailable', code: 'PNL_POS_UNAVAILABLE' } };
  }
};
