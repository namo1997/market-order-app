import { cents, money } from './domain.js';
import { grabFeeSource } from './grabFeeBasis.js';

const amount = (value) => value != null && value !== '' && Number.isFinite(Number(value))
  && Number.isSafeInteger(cents(value)) ? cents(value) : null;
// Reporting only: keep bank money, receipt fees and the original closing snapshot untouched.
export const buildCashflowFees = (rows = [], { basis = 'settlement', branchId = null, preferences = [] } = {}) => {
  const seen = new Set(); const expenses = []; const missing = []; const missingGrab = []; const adjustments = []; const corrections = [];
  const preferenceMap = new Map(preferences.map((p) => [String(p.receipt_line_id), p]));
  const basisRows = []; const staleBasis = []; const unreviewedBasis = [];
  for (const row of rows) {
    if (row.status !== 'CLOSED' || row.channel_code === 'CASH' || seen.has(String(row.id))
      || (branchId != null && String(row.branch_id) !== String(branchId))) continue;
    seen.add(String(row.id));
    const value = row.settlement_batch_key ? row.settlement_batch_allocated_fee_amount : row.fee_amount;
    let fee = amount(value);
    if (fee == null) missing.push(row.id);
    let reportedBeforeAdjustment = false;
    if (row.channel_code === 'GRAB') {
      const grab = grabFeeSource(row);
      const preference = preferenceMap.get(String(row.id));
      const active = preference && !preference.deleted_at;
      const validPreference = active && grab?.provenance && preference.source_fingerprint === grab.fingerprint
        && ['before_adjustment', 'net'].includes(preference.treatment);
      const defaultTreatment = row.branch_code === 'KK' ? 'before_adjustment' : 'net';
      const treatment = validPreference ? preference.treatment : active || !grab ? 'net' : defaultTreatment;
      const beforeAdjustment = basis === 'sheet' && treatment === 'before_adjustment';
      if (active && !validPreference) staleBasis.push(row.id);
      if (grab?.adjustment !== 0 && grab && !active) unreviewedBasis.push(row.id);
      if (!grab || grab.adjustment !== 0 || preference) basisRows.push({
        receipt_line_id: row.id, branch_id: row.branch_id, business_date: row.receipt_date,
        net_fee: fee == null ? null : money(fee), before_adjustment_fee: grab ? money(grab.fee) : null,
        income_adjustment_amount: grab ? money(grab.adjustment) : null,
        source_fingerprint: grab?.provenance ? grab.fingerprint : null,
        default_treatment: defaultTreatment, treatment, version: Number(preference?.version || 0),
        preference_status: active ? validPreference ? 'valid' : 'stale' : 'default',
        reference: active ? preference.reference : null, reason: active ? preference.reason : null
      });
      if (grab) {
        if (grab.adjustment !== 0) adjustments.push({ receipt_line_id: row.id, branch_id: row.branch_id,
          business_date: row.receipt_date, amount: money(grab.adjustment),
          treatment: beforeAdjustment ? 'outside_profit' : 'netted_fee' });
        if (beforeAdjustment) { fee = grab.fee; reportedBeforeAdjustment = true; }
      } else if (basis === 'sheet' && fee != null) missingGrab.push(row.id);
    }
    if (fee == null) continue;
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
      description:`ค่าธรรมเนียม ${row.channel_code}${reportedBeforeAdjustment ? ' (ก่อนปรับรายได้ตามรายงาน Grab)' : ' (รวมการตลาดที่หักในยอดแล้ว)'}` });
  }
  // An override for a reopened receipt must remain visible even though its fees are no longer counted.
  const unavailableBasis = preferences.filter((p) => !p.deleted_at && !seen.has(String(p.receipt_line_id))
    && (branchId == null || String(p.branch_id) === String(branchId))).map((p) => p.receipt_line_id);
  return { cashflowExpenses:expenses, cashflowFeeStatus:{status:missing.length || missingGrab.length
      || (basis === 'sheet' && (staleBasis.length || unavailableBasis.length || unreviewedBasis.length)) ? 'partial':'available',
    basis, missing_receipt_line_ids:missing, missing_grab_report_line_ids:missingGrab,
    grab_sheet_basis_rows: basisRows, stale_grab_sheet_basis_line_ids: staleBasis,
    unavailable_grab_sheet_basis_line_ids: unavailableBasis, unreviewed_grab_sheet_basis_line_ids: unreviewedBasis,
    grab_income_adjustments:adjustments, grab_income_adjustment_total:money(adjustments.reduce((sum, row) => sum + cents(row.amount), 0)),
    grab_adjustment_outside_profit_total:money(adjustments.filter(row => row.treatment === 'outside_profit').reduce((sum, row) => sum + cents(row.amount), 0)),
    scb_report_corrections:corrections} };
};
