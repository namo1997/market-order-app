import { cents, money } from './domain.js';

const amount = (value) => value != null && value !== '' && Number.isFinite(Number(value))
  && Number.isSafeInteger(cents(value)) ? cents(value) : null;
const grabAmounts = (row) => {
  let payload = row.grab_report_payload;
  try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return null; }
  if (!payload || row.settlement_batch_key) return null;
  const components = ['commission_and_tax_amount', 'additional_commission_amount', 'marketing_fee_amount', 'merchant_delivery_discount_amount'].map((key) => amount(payload[key]));
  const adjustment = amount(payload.income_adjustment_amount);
  const gross = amount(payload.cashier_amount), net = amount(payload.net_amount);
  // A report for another revision/day must never replace the current receipt fee.
  if (components.some((value) => value == null || value < 0) || adjustment == null || gross == null || net == null
    || gross !== amount(row.cashier_amount) || gross !== amount(row.expected_gross_amount)
    || net !== amount(row.expected_net_amount) || gross - net !== amount(row.fee_amount)) return null;
  const fee = components.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(fee) || gross - fee + adjustment !== net) return null;
  return { fee, adjustment };
};

// Reporting only: keep bank money, receipt fees and the original closing snapshot untouched.
export const buildCashflowFees = (rows = [], { basis = 'settlement', branchId = null } = {}) => {
  const seen = new Set(); const expenses = []; const missing = []; const missingGrab = []; const adjustments = []; const corrections = [];
  for (const row of rows) {
    if (row.status !== 'CLOSED' || row.channel_code === 'CASH' || seen.has(String(row.id))
      || (branchId != null && String(row.branch_id) !== String(branchId))) continue;
    seen.add(String(row.id));
    const value = row.settlement_batch_key ? row.settlement_batch_allocated_fee_amount : row.fee_amount;
    let fee = amount(value);
    if (fee == null) { missing.push(row.id); continue; }
    if (row.channel_code === 'GRAB') {
      const grab = grabAmounts(row);
      // The KK Sheet uses commission before adjustments; the SK Sheet uses net deductions.
      const beforeAdjustment = basis === 'sheet' && row.branch_code === 'KK';
      if (grab) {
        if (grab.adjustment !== 0) adjustments.push({ receipt_line_id: row.id, branch_id: row.branch_id,
          business_date: row.receipt_date, amount: money(grab.adjustment),
          treatment: beforeAdjustment ? 'outside_profit' : 'netted_fee' });
        if (beforeAdjustment) fee = grab.fee;
      } else if (beforeAdjustment) missingGrab.push(row.id);
    }
    const gross = amount(row.cashier_amount), net = amount(row.expected_net_amount);
    if (row.channel_code === 'CREDIT_CARD_SCB' && !row.settlement_batch_key
      && row.settlement_source === 'BANK_SETTLEMENT' && Number(row.bank_match_count) === 1
      && ['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(row.settlement_status)
      && gross != null && net != null && gross >= net && net > 0
      && net === amount(row.statement_amount) && net === amount(row.matched_amount)
      && net === amount(row.bank_match_amount)) {
      const derivedFee = gross - net;
      if (derivedFee !== fee) corrections.push({ receipt_line_id: row.id, branch_id: row.branch_id,
        business_date: row.receipt_date, stored_fee: money(fee), reported_fee: money(derivedFee),
        gross_amount: money(gross), net_amount: money(net) });
      fee = derivedFee;
    }
    if (fee === 0) continue;
    expenses.push({ stable_key:`cashflow:fee:${row.id}`,branch_id:row.branch_id,business_date:row.receipt_date,
      category_code:'MARKETING',source:'CASHFLOW_FEE',excluded:false,amount:money(fee),
      description:`ค่าธรรมเนียม ${row.channel_code}${basis === 'sheet' && row.branch_code === 'KK' && row.channel_code === 'GRAB' && !missingGrab.includes(row.id) ? ' (ก่อนปรับรายได้ตามรายงาน Grab)' : ' (รวมการตลาดที่หักในยอดแล้ว)'}` });
  }
  return { cashflowExpenses:expenses, cashflowFeeStatus:{status:missing.length || missingGrab.length ? 'partial':'available',
    basis, missing_receipt_line_ids:missing, missing_grab_report_line_ids:missingGrab,
    grab_income_adjustments:adjustments, grab_income_adjustment_total:money(adjustments.reduce((sum, row) => sum + cents(row.amount), 0)),
    grab_adjustment_outside_profit_total:money(adjustments.filter(row => row.treatment === 'outside_profit').reduce((sum, row) => sum + cents(row.amount), 0)),
    scb_report_corrections:corrections} };
};
