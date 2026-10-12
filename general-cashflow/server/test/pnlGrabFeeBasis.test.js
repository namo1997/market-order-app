import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authenticate, requirePermission, signToken } from '../src/auth.js';
import { createPnlRouter } from '../src/pnl/routes.js';
import { buildCashflowFees } from '../src/pnl/cashflowFees.js';
import { grabFeeSource } from '../src/pnl/grabFeeBasis.js';
import { buildReport } from '../src/pnl/report.js';

const row = (id = 10, adjustment = 70) => ({ id, branch_id: 2, branch_code: 'SK', receipt_date: '2026-09-04', status: 'CLOSED',
  channel_code: 'GRAB', cashier_amount: 1000, expected_gross_amount: 1000, expected_net_amount: 800 + adjustment,
  fee_amount: 200 - adjustment, grab_report_identity: { transaction_id: 8, import_id: 3, checksum: 'a'.repeat(64) },
  grab_report_payload: { cashier_amount: 1000, net_amount: 800 + adjustment, commission_and_tax_amount: 120,
    additional_commission_amount: 30, marketing_fee_amount: 40, merchant_delivery_discount_amount: 10, income_adjustment_amount: adjustment } });
const preference = (r, treatment) => ({ receipt_line_id: r.id, branch_id: r.branch_id, treatment,
  source_fingerprint: grabFeeSource(r).fingerprint, version: 1, reason: 'ตรวจสูตรแล้ว', reference: 'ชีทตัวอย่าง DV9' });

test('positive adjustments may use different audited sheet bases on the same branch; no month/sign heuristic', () => {
  const august = { ...row(10), receipt_date: '2026-08-18' }, september = row(11);
  const rows = [august, september, { ...row(12, -5), branch_id: 1, branch_code: 'KK' }];
  const preferences = [preference(august, 'net'), preference(september, 'before_adjustment')];
  const before = structuredClone({ rows, preferences });
  const sheet = buildCashflowFees(rows, { basis: 'sheet', preferences });
  assert.deepEqual(sheet.cashflowExpenses.map((r) => r.amount), [130, 200, 200]);
  assert.deepEqual(sheet.cashflowFeeStatus.grab_income_adjustments.map((r) => r.treatment), ['netted_fee', 'outside_profit', 'outside_profit']);
  assert.deepEqual(buildCashflowFees(rows, { preferences }).cashflowExpenses.map((r) => r.amount), [130, 130, 205]);
  assert.deepEqual({ rows, preferences }, before);
  const report = buildReport({ month: '2026-09', now: new Date('2026-10-13'), branches: [{ id: 2 }], categories: [{ code: 'MARKETING' }],
    receipts: [{ id: 1, branch_id: 2, receipt_date: september.receipt_date, status: 'CLOSED', gross_sales_expected: 1000 }],
    rounds: [{ id: 1, branch_id: 2, business_date: september.receipt_date, status: 'closed' }],
    cashflowExpenses: buildCashflowFees([september], { basis: 'sheet', preferences }).cashflowExpenses });
  assert.equal(report.totals.opex, 200); assert.equal(report.totals.net_profit, 800);
  assert.equal(report.totals_matched.opex, 200);
});

test('same money from a replacement import invalidates the choice; formatting differences alone do not', () => {
  const original = row(), saved = preference(original, 'before_adjustment');
  const replacement = { ...original, grab_report_identity: { ...original.grab_report_identity, import_id: 4 } };
  const result = buildCashflowFees([replacement], { basis: 'sheet', preferences: [saved] });
  assert.equal(result.cashflowExpenses[0].amount, 130);
  assert.equal(result.cashflowFeeStatus.status, 'partial');
  assert.deepEqual(result.cashflowFeeStatus.stale_grab_sheet_basis_line_ids, [10]);
  assert.equal(result.cashflowFeeStatus.grab_sheet_basis_rows[0].preference_status, 'stale');
  assert.equal(grabFeeSource({ ...original, grab_report_payload: JSON.stringify(original.grab_report_payload),
    grab_report_identity: JSON.stringify(original.grab_report_identity) }).fingerprint, grabFeeSource(original).fingerprint);
});

test('missing/stale source and allocated batches retain known fees and flag stale preferences', () => {
  const original = row(), saved = preference(original, 'before_adjustment');
  for (const change of [{ grab_report_payload: null }, { grab_report_payload: '{' }, { expected_gross_amount: 1001 },
    { grab_report_identity: { import_id: 4 } }, { settlement_batch_key: 'batch', settlement_batch_allocated_fee_amount: 25 }]) {
    const r = buildCashflowFees([{ ...original, ...change }], { basis: 'sheet', preferences: [saved] });
    assert.equal(r.cashflowExpenses[0].amount, change.settlement_batch_key ? 25 : 130);
    assert.deepEqual(r.cashflowFeeStatus.stale_grab_sheet_basis_line_ids, [10]);
  }
  const missing = buildCashflowFees([{ ...original, fee_amount: null }], { basis: 'sheet', preferences: [saved] });
  assert.equal(missing.cashflowExpenses.length, 0);
  assert.equal(missing.cashflowFeeStatus.grab_sheet_basis_rows[0].net_fee, null);
  const unreviewedMissing = buildCashflowFees([{ ...original, grab_report_payload: null }], { basis: 'sheet' });
  assert.equal(unreviewedMissing.cashflowExpenses[0].amount, 130);
  assert.equal(unreviewedMissing.cashflowFeeStatus.status, 'partial');
  assert.deepEqual(unreviewedMissing.cashflowFeeStatus.missing_grab_report_line_ids, [10]);
  assert.equal(unreviewedMissing.cashflowFeeStatus.grab_sheet_basis_rows[0].source_fingerprint, null);
  const kkMissing = buildCashflowFees([{ ...original, branch_code: 'KK', grab_report_payload: null }], { basis: 'sheet' });
  assert.equal(kkMissing.cashflowFeeStatus.grab_sheet_basis_rows[0].treatment, 'net');
  assert.equal(kkMissing.cashflowFeeStatus.grab_sheet_basis_rows[0].net_fee, kkMissing.cashflowExpenses[0].amount);
});

test('zero-net fees still expose adjustment controls; preferences and warnings obey branch/closed filters', () => {
  const zero = row(10, 200), other = { ...row(11), branch_id: 1, branch_code: 'KK' };
  const preferences = [preference(zero, 'net'), preference(other, 'before_adjustment')];
  const result = buildCashflowFees([zero, other], { basis: 'sheet', branchId: 2, preferences });
  assert.equal(result.cashflowExpenses.length, 0); assert.equal(result.cashflowFeeStatus.grab_sheet_basis_rows.length, 1);
  assert.equal(result.cashflowFeeStatus.grab_sheet_basis_rows[0].before_adjustment_fee, 200);
  assert.equal(result.cashflowFeeStatus.status, 'available');
  const open = buildCashflowFees([{ ...zero, status: 'OPEN' }, other], { basis: 'sheet', branchId: 2, preferences });
  assert.equal(open.cashflowExpenses.length, 0);
  assert.deepEqual(open.cashflowFeeStatus.unavailable_grab_sheet_basis_line_ids, [10]);
  assert.equal(open.cashflowFeeStatus.status, 'partial');
  assert.equal(buildCashflowFees([row()], { basis: 'sheet' }).cashflowFeeStatus.status, 'partial');
});

const start = async ({ source = row(), guard } = {}) => {
  let stored, staged, auditFails = false, committed = 0, rolledBack = 0;
  const audits = [], writes = [];
  const connection = { release() {}, async beginTransaction() { staged = structuredClone(stored); },
    async commit() { stored = structuredClone(staged); committed++; }, async rollback() { staged = undefined; rolledBack++; },
    async query(sql, args) {
      if (sql.includes('FROM daily_receipt_lines l')) return [[source]];
      if (sql.startsWith('SELECT * FROM pnl_grab_fee_basis')) return [[...(staged ? [structuredClone(staged)] : [])]];
      if (sql.startsWith('INSERT INTO pnl_grab_fee_basis')) { writes.push(sql); staged = { receipt_line_id: args[0], treatment: args[1],
        source_fingerprint: args[2], reference: args[3], reason: args[4], version: args[5], deleted_at: null }; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('UPDATE pnl_grab_fee_basis SET deleted_at')) { writes.push(sql); staged = { ...staged, version: args[1], deleted_at: '2026-10-13' }; return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected query');
    } };
  const app = express(); app.use(express.json());
  app.use('/api/pnl', createPnlRouter({ getPool: () => ({ getConnection: async () => connection }), config: {}, authenticate, requirePermission,
    decisionReasonRequired: Boolean(guard), requireHumanDecision: guard, logAudit: async (value) => {
      assert.equal(value.connection, connection); assert.equal(value.entityId, 10);
      if (auditFails) throw new Error('audit unavailable'); audits.push(value);
    } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (method, body, role = 'admin') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/pnl/cashflow-fees/10/sheet-basis`, { method,
      headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${signToken({ id: 1, role })}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { source, audits, writes, call, get stored() { return stored; }, failAudit() { auditFails = true; },
    stats: () => ({ committed, rolledBack }), close: () => new Promise((resolve) => server.close(resolve)) };
};
const body = (r, expected_version = 0) => ({ treatment: 'before_adjustment', source_fingerprint: grabFeeSource(r).fingerprint,
  expected_version, reason: 'สูตรค่าธรรมเนียมไม่หักส่วนปรับรายได้', reference: 'ชีทตัวอย่าง DV9' });

test('native API saves/removes/restores a versioned report preference with audit, never money fields', async () => {
  const h = await start(), before = structuredClone(h.source);
  try {
    assert.equal((await h.call('PUT', body(h.source))).body.data.amount, 200);
    assert.equal((await h.call('PUT', body(h.source))).status, 409);
    assert.equal(h.stored.version, 1);
    assert.equal((await h.call('DELETE', { expected_version: 1, reason: 'กลับค่ามาตรฐาน' })).status, 200);
    assert.equal(h.stored.version, 2); assert.ok(h.stored.deleted_at);
    assert.equal((await h.call('PUT', body(h.source))).status, 409);
    assert.equal((await h.call('PUT', { ...body(h.source, 2), treatment: 'net' })).body.data.amount, 130);
    assert.equal(h.stored.version, 3); assert.equal(h.stored.deleted_at, null);
    assert.deepEqual(h.audits.map((a) => a.action), ['pnl.grab_fee_basis.save', 'pnl.grab_fee_basis.delete', 'pnl.grab_fee_basis.save']);
    assert.deepEqual(h.source, before);
    assert.ok(h.writes.every((sql) => /^(INSERT INTO|UPDATE) pnl_grab_fee_basis/.test(sql)));
  } finally { await h.close(); }
});

test('invalid/replaced/open/batch/unsupported sources cannot save; stale preference remains removable', async () => {
  for (const changes of [{ status: 'OPEN' }, { channel_code: 'CASH' }, { grab_report_payload: null },
    { grab_report_identity: null }, { settlement_batch_key: 'batch' }]) {
    const h = await start({ source: { ...row(), ...changes } });
    try { assert.ok([404, 409].includes((await h.call('PUT', body(row()))).status)); assert.equal(h.writes.length, 0); assert.equal(h.audits.length, 0); }
    finally { await h.close(); }
  }
  const h = await start();
  try {
    for (const change of [{ expected_version: '0' }, { treatment: 'arbitrary_amount' }, { reason: '' }, { reference: '' }, { source_fingerprint: 'x' }])
      assert.equal((await h.call('PUT', { ...body(h.source), ...change })).status, 422);
    assert.equal((await h.call('PUT', { ...body(h.source), source_fingerprint: 'f'.repeat(64) })).status, 409);
    assert.equal(h.writes.length, 0);
    assert.equal((await h.call('PUT', body(h.source))).status, 200);
    h.source.grab_report_payload = null;
    assert.equal((await h.call('DELETE', { expected_version: 1, reason: 'รายงานเก่าไม่พร้อม' })).status, 200);
  } finally { await h.close(); }
});

test('permission/decision guards precede DB; audit failure rolls back preference update', async () => {
  const actions = [], h = await start({ guard: (key) => (req, res) => { actions.push(key); res.status(422).json({ code: 'decision_required' }); } });
  try {
    for (const role of ['cashier', 'viewer', null]) assert.equal((await h.call('PUT', body(row()), role)).status, role ? 403 : 401);
    assert.deepEqual(actions, []);
    assert.equal((await h.call('PUT', body(row()))).status, 422);
    assert.equal((await h.call('DELETE', { expected_version: 0, reason: 'คืนค่ามาตรฐาน' })).status, 422);
    assert.deepEqual(actions, ['cashflow.put.pnl.cashflow-fees.:id.sheet-basis', 'cashflow.delete.pnl.cashflow-fees.:id.sheet-basis']);
    assert.equal(h.writes.length, 0);
  } finally { await h.close(); }
  const rollback = await start();
  try {
    assert.equal((await rollback.call('PUT', body(row()))).status, 200);
    rollback.failAudit();
    const old = console.error; console.error = () => {};
    try { assert.equal((await rollback.call('PUT', { ...body(row(), 1), treatment: 'net' })).status, 500); } finally { console.error = old; }
    assert.equal(rollback.stored.treatment, 'before_adjustment'); assert.equal(rollback.stored.version, 1);
    assert.deepEqual(rollback.stats(), { committed: 1, rolledBack: 1 });
  } finally { await rollback.close(); }
});
