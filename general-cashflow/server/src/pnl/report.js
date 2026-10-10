import { cents, money, monthRange, classify, suggestPeriodMonth } from './domain.js';
export const elapsedDates = (month, now = new Date()) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const { days } = monthRange(month);
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`).filter((date) => date < today);
};
export const buildReport = ({ month, branches = [], categories = [], receipts = [], rounds = [], items = [], rules = [], overrides = [], manual = [], closes = [], posRevenue = [], hrmsExpenses = [], cashflowExpenses = [], branchId = null, now }) => {
  const dates = elapsedDates(month, now);
  const included = (row) => branchId == null || String(row.branch_id) === String(branchId);
  const existingReceipts = new Set(receipts.map((row) => `${row.branch_id}:${row.receipt_date}`));
  const seenPos = new Set();
  const supplement = posRevenue.filter((row) => {
    const key = `${row.branch_id}:${row.receipt_date}`;
    if (!included(row) || !dates.includes(row.receipt_date) || existingReceipts.has(key) || seenPos.has(key)) return false;
    seenPos.add(key); return true;
  });
  const revenueRows = [...receipts, ...supplement];
  const overrideMap = new Map(overrides.map((row) => [row.stable_key, row]));
  const closedIds = new Set(rounds.filter((row) => row.status === 'closed').map((row) => String(row.id)));
  const classifiedItems = items.filter((row) => closedIds.has(String(row.round_id)) && included(row))
    .map((row) => ({ ...classify(row, rules, overrideMap.get(row.stable_key)),
      period_month: overrideMap.get(row.stable_key)?.period_month?.slice(0, 7) || null,
      suggested_period_month: suggestPeriodMonth(row.description, row.business_date) }));
  const lineItems = classifiedItems.filter((row) => (row.period_month || row.business_date.slice(0, 7)) === month);
  const movedIn = lineItems.filter((row) => row.business_date.slice(0, 7) !== month);
  const movedOut = classifiedItems.filter((row) => row.business_date.slice(0, 7) === month && row.period_month && row.period_month !== month);
  const movement = (rows) => ({ items: rows, count: rows.length, amount: money(rows.reduce((sum, row) => sum + cents(row.amount), 0)),
    counted_amount: money(rows.filter((row) => !row.excluded).reduce((sum, row) => sum + cents(row.amount), 0)) });
  const manualItems = manual.filter((row) => !row.deleted_at && included(row)).map((row) => ({ ...row, manual: true, excluded: false }));
  const importedItems = hrmsExpenses.filter(included);
  const feeItems = cashflowExpenses.filter(included);
  const allItems = [...lineItems, ...manualItems, ...importedItems, ...feeItems];
  const buckets = [...branches.map((row) => ({ key: String(row.id), name: row.name })),
    ...(importedItems.some((row) => row.bucket === 'PRODUCTION') ? [{ key: 'PRODUCTION', name: 'ผลิต' }] : []),
    { key: 'UNASSIGNED', name: 'ไม่ระบุสาขา' }, { key: 'CENTRAL', name: 'ส่วนกลาง' }]
    .filter((row) => branchId == null || row.key === String(branchId));
  const bucketFor = (row) => row.bucket || (row.branch_id == null ? (row.manual ? 'CENTRAL' : 'UNASSIGNED') : String(row.branch_id));
  const completeness = branches.filter((row) => branchId == null || String(row.id) === String(branchId)).map((branch) => {
    const receiptDates = new Set(receipts.filter((row) => String(row.branch_id) === String(branch.id) && row.status === 'CLOSED').map((row) => row.receipt_date));
    const posDates = new Set(supplement.filter((row) => String(row.branch_id) === String(branch.id)).map((row) => row.receipt_date));
    const availableDates = new Set([...receiptDates, ...posDates]);
    const branchRounds = rounds.filter((row) => String(row.branch_id) === String(branch.id));
    // Multiple LINE groups mapped to one branch count as one complete day only if all observed rounds are closed.
    const closedDates = new Set(branchRounds.filter((row) => row.status === 'closed'
      && !branchRounds.some((other) => other.business_date === row.business_date && other.status !== 'closed')).map((row) => row.business_date));
    return { branch_id: branch.id, name: branch.name, days_expected: dates.length,
      revenue_available_days: dates.filter((date) => availableDates.has(date)).length,
      pos_without_receipt_dates: dates.filter((date) => posDates.has(date)),
      revenue_unavailable: dates.filter((date) => !availableDates.has(date)),
      revenue_days: dates.filter((date) => receiptDates.has(date)).length,
      expense_days: dates.filter((date) => closedDates.has(date)).length,
      revenue_missing: dates.filter((date) => !receiptDates.has(date)), expense_missing: dates.filter((date) => !closedDates.has(date)),
      matched_dates: dates.filter((date) => availableDates.has(date) && closedDates.has(date)),
      matched_days: dates.filter((date) => availableDates.has(date) && closedDates.has(date)).length,
      revenue_without_expense: dates.filter((date) => availableDates.has(date) && !closedDates.has(date)),
      month_close_revision: closes.filter((row) => String(row.branch_id) === String(branch.id)).reduce((max, row) => Math.max(max, row.revision_number), 0) || null };
  });
  const matchedDates = new Map(completeness.map((row) => [String(row.branch_id), new Set(row.matched_dates)]));
  // Company days are the intersection. Branch totals retain each branch's own matched days.
  const companyDates = dates.filter((date) => completeness.length > 0 && completeness.every((row) => matchedDates.get(String(row.branch_id)).has(date)));
  const isMatched = (row, date) => matchedDates.get(String(row.branch_id))?.has(date) === true;
  const matchedReceipts = revenueRows.filter((row) => included(row) && (row.status === 'CLOSED' || row.source === 'POS_WITHOUT_RECEIPT') && isMatched(row, row.receipt_date));
  const matchedItems = [
    // Paid monthly amounts retain their full value; no estimated daily proration.
    ...importedItems,
    ...feeItems.filter((row) => isMatched(row, row.business_date)),
    ...lineItems.filter((row) => row.business_date.slice(0, 7) === month && isMatched(row, row.business_date)),
    ...movedIn.filter((row) => row.branch_id != null).map((row) => ({ ...row,
      amount: money(Math.round(cents(row.amount) * (matchedDates.get(String(row.branch_id))?.size || 0) / monthRange(month).days)) })),
    ...manualItems.map((row) => ({ ...row, amount: money(Math.round(cents(row.amount)
      * (row.branch_id == null ? companyDates.length : matchedDates.get(String(row.branch_id))?.size || 0) / monthRange(month).days)) }))
  ];
  const rows = [...categories.map((category) => ({ ...category, code: category.code })),
    { code: 'UNCATEGORIZED', name: 'ยังไม่จัดหมวด', is_cogs: false }].map((category) => {
    const matching = allItems.filter((row) => !row.excluded && (row.category_code || 'UNCATEGORIZED') === category.code);
    const matched = matchedItems.filter((row) => !row.excluded && (row.category_code || 'UNCATEGORIZED') === category.code);
    return { ...category, matched: { amount: money(matched.reduce((sum, row) => sum + cents(row.amount), 0)),
      branches: Object.fromEntries(buckets.map((bucket) => [bucket.key, money(matched.filter((row) => bucketFor(row) === bucket.key).reduce((sum, row) => sum + cents(row.amount), 0))])) }, amount: money(matching.reduce((sum, row) => sum + cents(row.amount), 0)),
      count: matching.length, branches: Object.fromEntries(buckets.map((bucket) => [bucket.key,
        money(matching.filter((row) => bucketFor(row) === bucket.key).reduce((sum, row) => sum + cents(row.amount), 0))])) };
  });
  const totals = (key, matched = false) => {
    const revenue = (matched ? matchedReceipts : revenueRows).filter((row) => included(row) && (key == null || String(row.branch_id) === key))
      .reduce((sum, row) => sum + cents(row.gross_sales_expected), 0);
    const sourceRows = (matched ? matchedReceipts : revenueRows).filter((row) => included(row) && (key == null || String(row.branch_id) === key));
    const posAmount = sourceRows.filter((row) => row.source === 'POS_WITHOUT_RECEIPT').reduce((sum, row) => sum + cents(row.gross_sales_expected), 0);
    const expenses = (matched ? matchedItems : allItems).filter((row) => !row.excluded && (key == null || bucketFor(row) === key));
    const cogs = expenses.filter((row) => categories.find((category) => category.code === row.category_code)?.is_cogs)
      .reduce((sum, row) => sum + cents(row.amount), 0);
    const opex = expenses.reduce((sum, row) => sum + cents(row.amount), 0) - cogs;
    return { revenue: money(revenue), receipt_revenue: money(revenue - posAmount), pos_without_receipt_revenue: money(posAmount), pos_without_receipt_days: sourceRows.filter((row) => row.source === 'POS_WITHOUT_RECEIPT').length, cogs: money(cogs), gross_profit: money(revenue - cogs), opex: money(opex),
      net_profit: money(revenue - cogs - opex), margin_pct: revenue > 0 ? (revenue - cogs - opex) / revenue * 100 : null };
  };
  const extraRounds = rounds.filter((row) => row.business_date?.slice(0, 7) === month && row.status === 'closed' && included(row));
  return { month, moved_in: movement(movedIn), moved_out: movement(movedOut), totals: totals(), totals_matched: totals(null, true), matched_days: companyDates.length, matched_dates: companyDates,
    matched_unassigned_excluded_total: money(lineItems.filter((row) => !row.excluded && row.branch_id == null).reduce((sum, row) => sum + cents(row.amount), 0)),
    expense_missing_revenue_days: new Set(completeness.flatMap((row) => row.revenue_without_expense)).size, category_rows: rows, branch_columns: buckets.map((row) => ({ ...row, ...totals(row.key), matched: totals(row.key, true),
      matched_days: row.key === 'CENTRAL' ? companyDates.length : matchedDates.get(row.key)?.size || 0 })),
    completeness, hrms_possible_overlap_total: money([...lineItems, ...manualItems].filter((row) => !row.excluded && row.category_code === 'STAFF').reduce((sum, row) => sum + cents(row.amount), 0)), cashflow_expenses: feeItems, cashflow_fee_total: money(feeItems.reduce((sum, row) => sum + cents(row.amount), 0)), hrms_expenses: importedItems, hrms_total: money(importedItems.reduce((sum, row) => sum + cents(row.amount), 0)), revenue_pos_without_receipt: supplement, revenue_receipts: receipts.filter(included), items: lineItems, manual_expenses: manualItems,
    manual_total: money(manualItems.reduce((sum, row) => sum + cents(row.amount), 0)),
    excluded_total: money(lineItems.filter((row) => row.excluded).reduce((sum, row) => sum + cents(row.amount), 0)),
    reimbursement_count: extraRounds.reduce((sum, row) => sum + (Number(row.reimbursement_count) || 0), 0),
    incoming_transfer_count: extraRounds.reduce((sum, row) => sum + (Number(row.incoming_transfer_count) || 0), 0) };
};

export const loadReportData = async (connection, month) => {
  const { from, to } = monthRange(month);
  const queries = {
    branches: ['SELECT id, code, name, clickhouse_branch_id FROM branches ORDER BY id', []],
    categories: ['SELECT * FROM pnl_categories ORDER BY sort_order, code', []],
    receipts: ['SELECT id, branch_id, receipt_date, gross_sales_expected, status FROM daily_receipts WHERE receipt_date BETWEEN ? AND ?', [from, to]],
    fees: [`SELECT l.id, dr.branch_id, dr.receipt_date, dr.status, pc.code AS channel_code,
      r.fee_amount, r.settlement_batch_key, r.settlement_batch_allocated_fee_amount
      FROM daily_receipt_lines l JOIN daily_receipts dr ON dr.id=l.receipt_id
      JOIN payment_channels pc ON pc.id=l.payment_channel_id
      LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id=l.id
      WHERE dr.status='CLOSED' AND dr.receipt_date BETWEEN ? AND ?`, [from, to]],
    rounds: [`SELECT r.* FROM pnl_expense_rounds r WHERE r.business_date BETWEEN ? AND ? OR
      (r.status='closed' AND EXISTS (SELECT 1 FROM pnl_expense_items i JOIN pnl_item_overrides o ON o.stable_key=i.stable_key
        WHERE i.round_id=r.id AND o.period_month=?))`, [from, to, from]],
    items: [`SELECT i.* FROM pnl_expense_items i JOIN pnl_expense_rounds r ON r.id=i.round_id
      LEFT JOIN pnl_item_overrides o ON o.stable_key=i.stable_key
      WHERE r.status='closed' AND (i.business_date BETWEEN ? AND ? OR o.period_month=?)`, [from, to, from]],
    rules: ['SELECT * FROM pnl_category_rules ORDER BY priority, id', []],
    overrides: ['SELECT o.* FROM pnl_item_overrides o JOIN pnl_expense_items i ON i.stable_key=o.stable_key WHERE i.business_date BETWEEN ? AND ? OR o.period_month=?', [from, to, from]],
    manual: ['SELECT * FROM pnl_manual_expenses WHERE month_start=? AND deleted_at IS NULL', [from]],
    closes: ['SELECT branch_id, revision_number FROM monthly_sales_closes WHERE month_start=?', [from]],
    sync: ['SELECT * FROM pnl_sync_runs WHERE month_start=? ORDER BY id DESC LIMIT 1', [from]]
  };
  const data = {};
  // One read transaction gives the report a consistent view across an atomic round replacement.
  await connection.beginTransaction();
  try {
    for (const [key, [sql, params]] of Object.entries(queries)) [data[key]] = await connection.query(sql, params);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  return data;
};
