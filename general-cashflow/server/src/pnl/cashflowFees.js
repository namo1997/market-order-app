import { cents, money } from './domain.js';
// Grab marketing is already part of the stored gross-to-net fee. Never add it again.
export const buildCashflowFees = (rows = []) => {
  const seen = new Set(); const expenses = []; const missing = [];
  for (const row of rows) {
    if (row.status !== 'CLOSED' || row.channel_code === 'CASH' || seen.has(String(row.id))) continue;
    seen.add(String(row.id));
    const value = row.settlement_batch_key ? row.settlement_batch_allocated_fee_amount : row.fee_amount;
    if (value == null || value === '' || !Number.isFinite(Number(value))) { missing.push(row.id); continue; }
    if (!Number.isSafeInteger(cents(value))) { missing.push(row.id); continue; }
    if (cents(value) === 0) continue;
    expenses.push({ stable_key:`cashflow:fee:${row.id}`,branch_id:row.branch_id,business_date:row.receipt_date,
      category_code:'MARKETING',source:'CASHFLOW_FEE',excluded:false,amount:money(cents(value)),
      description:`ค่าธรรมเนียม ${row.channel_code} (รวมการตลาดที่หักในยอดแล้ว)` });
  }
  return { cashflowExpenses:expenses, cashflowFeeStatus:{status:missing.length?'partial':'available',missing_receipt_line_ids:missing} };
};
