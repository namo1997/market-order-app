import { cents, money, monthRange } from './domain.js';
const amount = (v) => {
  if (!['number', 'string'].includes(typeof v) || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 || !Number.isSafeInteger(cents(v))) throw new Error('Invalid HRMS amount');
  return cents(v);
};
// Owner confirmed on 2026-10-10 that HRMS amounts are paid. No bank verification implied.
export const buildHrmsExpenses = ({ month, run, advances, branches, branchMap, now = new Date() }) => {
  monthRange(month);
  if (advances?.paymentMonth !== month || advances.scope?.mode !== 'GLOBAL' || !Array.isArray(advances.employees)) throw new Error('Invalid advance scope');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const groups = new Map(); const unmapped = new Set();
  const add = (label, source, value, date = null) => {
    const total = amount(value); if (!total) return;
    const code = branchMap[label]; const branch = branches.find((r) => r.code === code);
    const bucket = ['CENTRAL', 'PRODUCTION'].includes(code) ? code : null;
    if (!branch && !bucket) unmapped.add(label || 'ไม่ระบุสาขา');
    const key = `${source}:${branch?.id ?? bucket ?? 'UNASSIGNED'}`;
    const row = groups.get(key) || { stable_key: `hrms:${month}:${key}`, branch_id: branch?.id ?? null,
      bucket: bucket || (branch ? null : 'UNASSIGNED'), category_code: 'STAFF', source,
      description: source === 'HRMS_NET_PAY' ? 'เงินเดือนสุทธิ' : 'เงินต้นเบิกกลางเดือน',
      business_date: date, period_month: month, date_basis: date ? 'SCHEDULED_ADVANCE_DATE' : 'PAYROLL_MONTH',
      payment_basis: 'OWNER_CONFIRMED_PAID', amount: 0, excluded: false };
    row.amount = money(cents(row.amount) + total); groups.set(key, row);
  };
  let payrollStatus = 'missing';
  if (run) {
    if (run.month !== month || !Array.isArray(run.items)) throw new Error('Invalid payroll month');
    payrollStatus = run.status === 'LOCKED' ? 'locked' : 'not_locked';
    if (run.status === 'LOCKED') {
      if (typeof run.period_end !== 'string' || run.period_end > today) throw new Error('Future payroll');
      const seen = new Set(); let net = 0;
      for (const item of run.items) {
        if (!item.id || seen.has(item.id) || item.item_status !== 'LOCKED') throw new Error('Invalid locked payroll');
        seen.add(item.id); net += amount(item.net_pay); add(item.branch, 'HRMS_NET_PAY', item.net_pay);
      }
      if (net !== amount(run.total_net)) throw new Error('Payroll total mismatch');
    }
  }
  if (`${month}-15` <= today) {
    const seen = new Set(); let principal = 0;
    for (const e of advances.employees) {
      if (!e.employeeId || seen.has(e.employeeId)) throw new Error('Duplicate advance employee');
      seen.add(e.employeeId); principal += amount(e.principal);
      add(e.branchName, 'HRMS_ADVANCE_PRINCIPAL', e.principal, `${month}-15`);
    }
    if (principal !== amount(advances.totals?.principal)) throw new Error('Advance total mismatch');
  }
  const expenses = [...groups.values()];
  return { hrmsExpenses: expenses, hrmsStatus: { status: 'available', payroll_status: payrollStatus,
    payment_basis: 'OWNER_CONFIRMED_PAID', payroll_date_basis: 'PAYROLL_MONTH',
    period_start: run?.period_start || null, period_end: run?.period_end || null,
    unmapped_branches: [...unmapped], matched_policy: 'FULL_MONTHLY_PAYMENT',
    net_pay: money(expenses.filter((r) => r.source === 'HRMS_NET_PAY').reduce((s, r) => s + cents(r.amount), 0)),
    advance_principal: money(expenses.filter((r) => r.source === 'HRMS_ADVANCE_PRINCIPAL').reduce((s, r) => s + cents(r.amount), 0)) } };
};
export const loadHrmsExpenses = async ({ month, branches, config = {}, fetchImpl = fetch }) => {
  const empty = (status, code) => ({ hrmsExpenses: [], hrmsStatus: { status, code } });
  if (!config.hrmsBaseUrl || !config.hrmsToken) return empty('not_configured', 'PNL_HRMS_NOT_CONFIGURED');
  try {
    // Upstream verifies the JWT signature. Reject restricted payroll roles here
    // so a filtered salary response cannot look like a complete company total.
    const tokenClaims = JSON.parse(Buffer.from(config.hrmsToken.split('.')[1] || '', 'base64url').toString('utf8'));
    if (tokenClaims.role !== 'ADMIN') throw new Error('ADMIN read credential required');
    const base = new URL(config.hrmsBaseUrl);
    if (base.username || base.password || base.search || base.hash) throw new Error('Invalid HRMS URL');
    if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new Error('HTTPS required');
    const branchMap = JSON.parse(config.hrmsBranchMap || '{}');
    if (!branchMap || Array.isArray(branchMap) || typeof branchMap !== 'object' || !Object.values(branchMap).every((v) => typeof v === 'string')) throw new Error('Invalid branch map');
    const get = async (path, missing = false) => {
      const response = await fetchImpl(new URL(path, base), { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${config.hrmsToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (missing && response.status === 404) return null;
      if (!response.ok) throw new Error('HRMS read failed');
      return response.json();
    };
    const [payroll, advances] = await Promise.all([get(`/api/payroll/runs/${month}`, true), get(`/api/advance-requests/summary?payment_month=${month}`)]);
    if (payroll && !payroll.run) throw new Error('Invalid payroll payload');
    return buildHrmsExpenses({ month, run: payroll?.run ?? null, advances, branches, branchMap });
  } catch { return empty('unavailable', 'PNL_HRMS_UNAVAILABLE'); }
};
