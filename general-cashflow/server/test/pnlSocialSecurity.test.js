import test from 'node:test';
import assert from 'node:assert/strict';
import { socialSecurityInput, socialSecurityForReport } from '../src/pnl/socialSecurity.js';
import { buildReport } from '../src/pnl/report.js';
const payment = { id: 1, month_start: '2026-08-01', payroll_month: '2026-07-01', payment_date: '2026-08-30', amount: '52520.00', note: 'ชีทคันคลอง 08.69 DM30 เจ้าของยืนยันเป็นเงินเดือนกรกฎาคม' };
const input = { month: '2026-08', payroll_month: '2026-07', payment_date: '2026-08-30', amount: '52520.00', note: payment.note };
const hrmsExpenses = [{ source: 'HRMS_NET_PAY', branch_id: 1, bucket: '1', amount: 1035262, category_code: 'STAFF' },
  { source: 'HRMS_ADVANCE_PRINCIPAL', branch_id: 1, bucket: '1', amount: 27000, category_code: 'STAFF' },
  { source: 'HRMS_SOCIAL_SECURITY_EMPLOYEE', branch_id: 1, bucket: '1', amount: 25335, category_code: 'STAFF' },
  { source: 'HRMS_SOCIAL_SECURITY_EMPLOYER', branch_id: 1, bucket: '1', amount: 25335, category_code: 'STAFF' }];
test('actual remittance replaces both HRMS SSO components once without altering net pay or advances', () => {
  const before = structuredClone(hrmsExpenses);
  const report = buildReport({ month: '2026-08', branches: [{ id: 1, name: 'KK' }], categories: [{ code: 'STAFF', is_cogs: false }], hrmsExpenses, socialSecurityPayments: [payment] });
  assert.equal(report.hrms_total, 1062262);
  assert.equal(report.social_security_total, 52520);
  assert.equal(report.social_security_payment.replaced_hrms_amount, 50670);
  assert.equal(report.totals.opex, 1114782);
  assert.equal(report.totals.net_profit, -1114782);
  assert.equal(report.totals_matched.net_profit, -1114782);
  assert.equal(report.category_rows.find(row => row.code === 'STAFF').branches.CENTRAL, 52520);
  assert.deepEqual(hrmsExpenses, before);
});
test('company remittance stays central under branch filters and soft removal restores the original HRMS source', () => {
  const data = { month: '2026-08', branches: [{ id: 1, name: 'KK' }], categories: [{ code: 'STAFF', is_cogs: false }], hrmsExpenses };
  const branch = buildReport({ ...data, branchId: 1, socialSecurityPayments: [payment] });
  assert.equal(branch.social_security_total, 0);
  assert.equal(branch.hrms_total, 1062262);
  assert.equal(branch.totals.opex, 1062262);
  const restored = buildReport({ ...data, socialSecurityPayments: [{ ...payment, deleted_at: '2026-10-11' }] });
  assert.equal(restored.hrms_total, 1112932);
  assert.equal(restored.social_security_total, 0);
  assert.equal(restored.social_security_payment, null);
  assert.equal(socialSecurityForReport({ month: '2026-09', payments: [payment], hrmsExpenses }).payment, null);
});
test('payment validation rejects wrong month, future or invalid dates, missing provenance, duplicate monthly rows and invalid cents', () => {
  assert.equal(socialSecurityInput(input, '2026-10-11').amount, '52520.00');
  for (const invalid of [{ payment_date: '2026-07-30' }, { payment_date: '2026-08-32' }, { payroll_month: '2026-09' }, { amount: '1.001' }, { amount: 0 }, { note: '' }]) assert.throws(() => socialSecurityInput({ ...input, ...invalid }, '2026-10-11'));
  assert.throws(() => socialSecurityInput(input, '2026-08-29'));
  assert.throws(() => socialSecurityForReport({ month: '2026-08', payments: [payment, payment], hrmsExpenses }));
  assert.equal(socialSecurityInput({ ...input, note: 'บัญชี 1234567890123' }, '2026-10-11').note, 'บัญชี [ปกปิดเลข]');
});
