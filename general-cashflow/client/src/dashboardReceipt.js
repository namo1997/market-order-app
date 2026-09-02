const normalizedDate = (value) => String(value || '').slice(0, 10);

export const dashboardFiltersEqual = (left = {}, right = {}) =>
  String(left.branch_id || '') === String(right.branch_id || '') &&
  normalizedDate(left.date) === normalizedDate(right.date) &&
  String(left.status || '') === String(right.status || '');

export const receiptMatchesDashboardFilters = (receipt, filters = {}) =>
  Boolean(receipt) &&
  String(receipt.branch_id || '') === String(filters.branch_id || '') &&
  normalizedDate(receipt.receipt_date) === normalizedDate(filters.date);
