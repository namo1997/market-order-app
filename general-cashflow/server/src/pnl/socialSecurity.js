import { amountInput, monthRange, pnlError, cents, money } from './domain.js';

export const SOCIAL_SECURITY_SOURCES = new Set(['HRMS_SOCIAL_SECURITY_EMPLOYEE', 'HRMS_SOCIAL_SECURITY_EMPLOYER']);
const paidDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw pnlError('INVALID_SSO_PAYMENT_DATE');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw pnlError('INVALID_SSO_PAYMENT_DATE');
  return value;
};
export const socialSecurityInput = (body, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())) => {
  const month_start = monthRange(body.month).from;
  const payroll_month = monthRange(body.payroll_month).from;
  const payment_date = paidDate(body.payment_date);
  if (payment_date.slice(0, 7) !== body.month || payment_date > today || payroll_month > month_start) throw pnlError('INVALID_SSO_PAYMENT_DATE');
  if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) throw pnlError('INVALID_TEXT');
  const note = body.note.trim().replace(/(?:\d[ -]?){9,}/g, '[ปกปิดเลข]');
  return { month_start, payroll_month, payment_date, amount: amountInput(body.amount), note };
};

export const socialSecurityForReport = ({ month, payments = [], hrmsExpenses = [] }) => {
  const active = payments.filter(row => !row.deleted_at && row.month_start?.slice(0, 7) === month);
  if (active.length > 1) throw pnlError('PNL_SSO_PAYMENT_CONFLICT');
  if (!active.length) return { hrmsExpenses, expenses: [], payment: null };
  const row = active[0];
  const input = socialSecurityInput({ month, payroll_month: row.payroll_month?.slice(0, 7), payment_date: row.payment_date, amount: row.amount, note: row.note });
  const payment = { id: row.id, ...input, replaced_hrms_amount: money(hrmsExpenses.filter(item => SOCIAL_SECURITY_SOURCES.has(item.source)).reduce((sum, item) => sum + cents(item.amount), 0)) };
  return { payment, hrmsExpenses: hrmsExpenses.filter(item => !SOCIAL_SECURITY_SOURCES.has(item.source)),
    expenses: [{ stable_key: `cashflow:sso:${row.id}`, source: 'CASHFLOW_SOCIAL_SECURITY_PAYMENT', category_code: 'STAFF',
      branch_id: null, bucket: 'CENTRAL', business_date: input.payment_date, amount: Number(input.amount), excluded: false,
      description: `ประกันสังคมนำส่งจริง · รอบ ${input.payroll_month.slice(0, 7)}`, note: input.note }] };
};

export const registerSocialSecurityRoutes = ({ router, handler, query, mutate, audit }) => {
  router.get('/social-security-payment', handler(async req => {
    const { from } = monthRange(req.query.month);
    const rows = await query('SELECT * FROM pnl_social_security_payments WHERE month_start=? AND deleted_at IS NULL', [from]);
    return rows[0] || null;
  }));
  router.put('/social-security-payment', handler(req => {
    const input = socialSecurityInput(req.body);
    return mutate(req, async connection => {
      const [[old]] = await connection.query('SELECT * FROM pnl_social_security_payments WHERE month_start=? FOR UPDATE', [input.month_start]);
      const [created] = await connection.query(`INSERT INTO pnl_social_security_payments
        (month_start, payroll_month, payment_date, amount, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE payroll_month=VALUES(payroll_month),
        payment_date=VALUES(payment_date), amount=VALUES(amount), note=VALUES(note), deleted_at=NULL, updated_by=VALUES(created_by), updated_at=NOW()`,
      [input.month_start, input.payroll_month, input.payment_date, input.amount, input.note, req.user.id]);
      const after = { id: old?.id || created.insertId, ...input };
      await audit(connection, req, 'pnl_social_security_payments', after.id, old ? 'pnl.sso.update' : 'pnl.sso.create', old, after);
      return after;
    });
  }));
  router.delete('/social-security-payment', handler(req => {
    const { from } = monthRange(req.query.month);
    return mutate(req, async connection => {
      const [[old]] = await connection.query('SELECT * FROM pnl_social_security_payments WHERE month_start=? AND deleted_at IS NULL FOR UPDATE', [from]);
      if (!old) throw pnlError('SSO_PAYMENT_NOT_FOUND', 404);
      await connection.query('UPDATE pnl_social_security_payments SET deleted_at=NOW(), updated_by=?, updated_at=NOW() WHERE id=?', [req.user.id, old.id]);
      await audit(connection, req, 'pnl_social_security_payments', old.id, 'pnl.sso.delete', old, { ...old, deleted: true });
      return { id: old.id };
    });
  }));
};
