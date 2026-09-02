import { roundCurrency } from './reconciliationSummary.js';

const RECEIPT_DATE_STATES = {
  DRAFT: { className: 'draft', label: 'ยังไม่ส่ง' },
  SUBMITTED: { className: 'submitted', label: 'รอตรวจ' },
  CHECKED_OK: { className: 'checked-ok', label: 'ตรวจครบ' },
  CHECKED_VARIANCE: { className: 'checked-variance', label: 'มีส่วนต่าง' },
  NEEDS_CORRECTION: { className: 'correction', label: 'ต้องแก้' },
  CLOSED: { className: 'closed', label: 'ปิดแล้ว' }
};

export const receiptDateState = (receipt) => {
  if (!receipt) return { className: '', label: '' };
  if (receipt.status === 'CLOSED' && receipt.post_close_adjustment_count > 0) return { className: 'closed', label: 'ปิด/ปรับแล้ว' };
  return RECEIPT_DATE_STATES[receipt.status] || { className: 'draft', label: receipt.status_label || 'มีเอกสาร' };
};

export const receiptCalendarVariance = (receipt) => {
  if (!receipt || receipt.status === 'DRAFT') return 0;
  if (receipt.status !== 'CLOSED') return roundCurrency(receipt.cashier_variance_total);
  const confirmed = receipt.confirmed_variance_total;
  if (confirmed === null || confirmed === undefined || confirmed === '') return null;
  return Number.isFinite(Number(confirmed)) ? roundCurrency(confirmed) : null;
};

export const groupCalendarReceipts = (receipts = []) => {
  const byDate = new Map();
  const statusRank = { NEEDS_CORRECTION: 5, DRAFT: 4, SUBMITTED: 3, CHECKED_VARIANCE: 2, CHECKED_OK: 1, CLOSED: 0 };
  for (const receipt of receipts) {
    if (!receipt.receipt_date) continue;
    const date = String(receipt.receipt_date).slice(0, 10);
    const variance = receiptCalendarVariance(receipt);
    const existing = byDate.get(date);
    const next = existing && statusRank[existing.status] >= statusRank[receipt.status] ? existing : receipt;
    byDate.set(date, {
      ...next,
      calendar_variance_total: existing
        ? existing.calendar_variance_total === null || variance === null
          ? null : roundCurrency(existing.calendar_variance_total + variance)
        : variance
    });
  }
  return byDate;
};

export const receiptCalendarMonthlyVariance = (receipts = []) => {
  const amounts = receipts.map(receiptCalendarVariance);
  return amounts.includes(null) ? null : roundCurrency(amounts.reduce((sum, value) => sum + value, 0));
};

export const receiptCalendarRefreshKey = (receipts = []) =>
  receipts
    .map((receipt) => [
      receipt.id,
      receipt.status,
      receipt.updated_at,
      receipt.cashier_variance_total,
      receipt.statement_total,
      receipt.variance_total,
      receipt.confirmed_variance_total,
      receipt.confirmed_reconciled_total,
      receipt.post_close_adjustment_count
    ].join(':'))
    .join('|');
