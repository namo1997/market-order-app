import { cents, money, monthRange, classify } from './domain.js';
export const elapsedDates = (month, now = new Date()) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const { days } = monthRange(month);
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`).filter((date) => date < today);
};
export const buildReport = ({ month, branches = [], categories = [], receipts = [], rounds = [], items = [], rules = [], overrides = [], manual = [], closes = [], branchId = null, now }) => {
  const dates = elapsedDates(month, now);
  const included = (row) => branchId == null || String(row.branch_id) === String(branchId);
  const overrideMap = new Map(overrides.map((row) => [row.stable_key, row]));
  const closedIds = new Set(rounds.filter((row) => row.status === 'closed').map((row) => String(row.id)));
  const lineItems = items.filter((row) => closedIds.has(String(row.round_id)) && included(row))
    .map((row) => classify(row, rules, overrideMap.get(row.stable_key)));
  const manualItems = manual.filter((row) => !row.deleted_at && included(row)).map((row) => ({ ...row, manual: true, excluded: false }));
  const allItems = [...lineItems, ...manualItems];
  const buckets = [...branches.map((row) => ({ key: String(row.id), name: row.name })),
    { key: 'UNASSIGNED', name: 'ไม่ระบุสาขา' }, { key: 'CENTRAL', name: 'ส่วนกลาง' }]
    .filter((row) => branchId == null || row.key === String(branchId));
  const bucketFor = (row) => row.branch_id == null ? (row.manual ? 'CENTRAL' : 'UNASSIGNED') : String(row.branch_id);
  const rows = [...categories.map((category) => ({ ...category, code: category.code })),
    { code: 'UNCATEGORIZED', name: 'ยังไม่จัดหมวด', is_cogs: false }].map((category) => {
    const matching = allItems.filter((row) => !row.excluded && (row.category_code || 'UNCATEGORIZED') === category.code);
    return { ...category, amount: money(matching.reduce((sum, row) => sum + cents(row.amount), 0)),
      count: matching.length, branches: Object.fromEntries(buckets.map((bucket) => [bucket.key,
        money(matching.filter((row) => bucketFor(row) === bucket.key).reduce((sum, row) => sum + cents(row.amount), 0))])) };
  });
  const totals = (key) => {
    const revenue = receipts.filter((row) => included(row) && (key == null || String(row.branch_id) === key))
      .reduce((sum, row) => sum + cents(row.gross_sales_expected), 0);
    const expenses = allItems.filter((row) => !row.excluded && (key == null || bucketFor(row) === key));
    const cogs = expenses.filter((row) => categories.find((category) => category.code === row.category_code)?.is_cogs)
      .reduce((sum, row) => sum + cents(row.amount), 0);
    const opex = expenses.reduce((sum, row) => sum + cents(row.amount), 0) - cogs;
    return { revenue: money(revenue), cogs: money(cogs), gross_profit: money(revenue - cogs), opex: money(opex),
      net_profit: money(revenue - cogs - opex), margin_pct: revenue > 0 ? (revenue - cogs - opex) / revenue * 100 : null };
  };
  const completeness = branches.filter((row) => branchId == null || String(row.id) === String(branchId)).map((branch) => {
    const receiptDates = new Set(receipts.filter((row) => String(row.branch_id) === String(branch.id) && row.status === 'CLOSED').map((row) => row.receipt_date));
    const branchRounds = rounds.filter((row) => String(row.branch_id) === String(branch.id));
    // Multiple LINE groups mapped to one branch count as one complete day only if all observed rounds are closed.
    const closedDates = new Set(branchRounds.filter((row) => row.status === 'closed'
      && !branchRounds.some((other) => other.business_date === row.business_date && other.status !== 'closed')).map((row) => row.business_date));
    return { branch_id: branch.id, name: branch.name, days_expected: dates.length,
      revenue_days: dates.filter((date) => receiptDates.has(date)).length,
      expense_days: dates.filter((date) => closedDates.has(date)).length,
      revenue_missing: dates.filter((date) => !receiptDates.has(date)), expense_missing: dates.filter((date) => !closedDates.has(date)),
      month_close_revision: closes.filter((row) => String(row.branch_id) === String(branch.id)).reduce((max, row) => Math.max(max, row.revision_number), 0) || null };
  });
  const extraRounds = rounds.filter((row) => row.status === 'closed' && included(row));
  return { month, totals: totals(), category_rows: rows, branch_columns: buckets.map((row) => ({ ...row, ...totals(row.key) })),
    completeness, revenue_receipts: receipts.filter(included), items: lineItems, manual_expenses: manualItems,
    manual_total: money(manualItems.reduce((sum, row) => sum + cents(row.amount), 0)),
    excluded_total: money(lineItems.filter((row) => row.excluded).reduce((sum, row) => sum + cents(row.amount), 0)),
    reimbursement_count: extraRounds.reduce((sum, row) => sum + (Number(row.reimbursement_count) || 0), 0),
    incoming_transfer_count: extraRounds.reduce((sum, row) => sum + (Number(row.incoming_transfer_count) || 0), 0) };
};

export const loadReportData = async (connection, month) => {
  const { from, to } = monthRange(month);
  const queries = {
    branches: ['SELECT id, code, name FROM branches ORDER BY id', []],
    categories: ['SELECT * FROM pnl_categories ORDER BY sort_order, code', []],
    receipts: ['SELECT id, branch_id, receipt_date, gross_sales_expected, status FROM daily_receipts WHERE receipt_date BETWEEN ? AND ?', [from, to]],
    rounds: ['SELECT * FROM pnl_expense_rounds WHERE business_date BETWEEN ? AND ?', [from, to]],
    items: [`SELECT i.* FROM pnl_expense_items i JOIN pnl_expense_rounds r ON r.id=i.round_id
      WHERE r.status='closed' AND i.business_date BETWEEN ? AND ?`, [from, to]],
    rules: ['SELECT * FROM pnl_category_rules ORDER BY priority, id', []],
    overrides: ['SELECT o.* FROM pnl_item_overrides o JOIN pnl_expense_items i ON i.stable_key=o.stable_key WHERE i.business_date BETWEEN ? AND ?', [from, to]],
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
