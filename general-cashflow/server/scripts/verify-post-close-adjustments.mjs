import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { createPostCloseAdjustment, loadPostCloseAdjustments } from '../src/postCloseAdjustments.js';
import { receiptConfirmationFields } from '../src/domain/receiptClosing.js';
import { signToken } from '../src/auth.js';

const pool = mysql.createPool({ host: '127.0.0.1', port: 3317, user: 'cashflow_preview', password: 'cashflow-preview', database: 'general_cashflow_preview', dateStrings: true });
const api = 'http://127.0.0.1:8100/api';
const code = `ADJUST_${crypto.randomBytes(4).toString('hex')}`;
let branchId;
const receipts = [];
try {
  const [[actor]] = await pool.query("SELECT id,username,full_name,role FROM users WHERE role='admin' LIMIT 1");
  const [[qr]] = await pool.query("SELECT id FROM payment_channels WHERE code='QR_KPLUS'");
  const [branch] = await pool.query('INSERT INTO branches (code,name,clickhouse_branch_id) VALUES (?,?,?)', [code, `ทดสอบปรับปรุงหลังปิด ${code} (ข้อมูลจำลอง)`, code]);
  branchId = branch.insertId;
  const lineIds = [];
  for (const status of ['CLOSED', 'SUBMITTED']) {
    const [r] = await pool.query('INSERT INTO daily_receipts (branch_id,receipt_date,status,gross_sales_expected,closed_by,closed_at,closed_reconciliation_snapshot) VALUES (?,?,?,1000,?,NOW(),?)',
      [branchId, status === 'CLOSED' ? '2026-08-01' : '2026-08-02', status, actor.id, JSON.stringify({ version: 1, reconciled_total: 950, variance_total: -50 })]);
    receipts.push(r.insertId);
    const [line] = await pool.query('INSERT INTO daily_receipt_lines (receipt_id,payment_channel_id,cashier_amount,statement_amount,reconciliation_adjustment_amount) VALUES (?,?,1000,940,10)', [r.insertId, qr.id]);
    lineIds.push(line.insertId);
  }
  const readProtected = async () => {
    const [rows] = await pool.query('SELECT * FROM daily_receipts WHERE branch_id=? ORDER BY id', [branchId]);
    const [lines] = await pool.query('SELECT * FROM daily_receipt_lines WHERE receipt_id IN (?) ORDER BY id', [receipts]);
    return { rows, lines };
  };
  const before = await readProtected();
  const payload = (patch = {}) => ({ receipt_line_id: lineIds[0], amount: '50.00', reason: 'Integration adjustment', expected_revision: 0, request_id: crypto.randomUUID(), ...patch });
  const call = (input, receiptId = receipts[0], user = actor) => createPostCloseAdjustment(pool, { receiptId, input, actor: user });
  await assert.rejects(call(payload(), receipts[0], { ...actor, role: 'cashier' }), { statusCode: 403 });
  await assert.rejects(call(payload(), receipts[1]), { statusCode: 409 });
  await assert.rejects(call(payload({ receipt_line_id: lineIds[1] })), { statusCode: 400 });
  await assert.rejects(call(payload({ reason: ' ' })), { statusCode: 400 });
  const first = payload();
  assert.equal((await call(first)).duplicate, false);
  assert.equal((await call(first)).duplicate, true);
  await assert.rejects(call({ ...first, amount: '60.00' }), { statusCode: 409 });
  await assert.rejects(call(payload()), { statusCode: 409 });
  const concurrent = await Promise.allSettled([
    call(payload({ expected_revision: 1, amount: '-10.00' })),
    call(payload({ expected_revision: 1, amount: '-10.00' }))
  ]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find((r) => r.status === 'rejected').reason.statusCode, 409);
  const notes = await loadPostCloseAdjustments(pool, receipts[0]);
  assert.equal(notes.length, 2);
  assert.equal(Number(notes[1].variance_total_after), -10);
  const failingPool = { getConnection: async () => {
    const connection = await pool.getConnection();
    return {
      beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(),
      rollback: () => connection.rollback(), release: () => connection.release(),
      query: (sql, values) => {
        if (/INSERT INTO audit_logs/.test(sql)) throw new Error('deliberate audit failure');
        return connection.query(sql, values);
      }
    };
  } };
  await assert.rejects(createPostCloseAdjustment(failingPool, { receiptId: receipts[0], actor, input: payload({ expected_revision: 2 }) }), /deliberate audit failure/);
  assert.equal((await loadPostCloseAdjustments(pool, receipts[0])).length, 2);
  assert.equal(receiptConfirmationFields({ ...before.rows[0], post_close_adjustments: notes }).confirmed_reconciled_total, 990);
  assert.deepEqual(await readProtected(), before);
  const [[audit]] = await pool.query("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=? AND entity_type='daily_receipt' AND action='post_close_adjustment'", [receipts[0]]);
  assert.equal(audit.n, 2);
  const headers = { Authorization: `Bearer ${signToken(actor)}`, 'Content-Type': 'application/json' };
  const post = async (input, user = actor) => {
    const auth = { ...headers, Authorization: `Bearer ${signToken(user)}` };
    const context = await fetch(`${api}/decision-contexts`, { method: 'POST', headers: auth,
      body: JSON.stringify({ action_key: 'receipt.post_close_adjustment', entity_type: 'daily-receipts', entity_id: String(receipts[0]), context_snapshot: { test: true } }) }).then((r) => r.json());
    return fetch(`${api}/daily-receipts/${receipts[0]}/post-close-adjustments`, { method: 'POST',
      headers: { ...auth, 'x-decision-id': context.data.id, 'x-decision-reason-code': 'other', 'x-decision-reason-text': 'Local integration test' }, body: JSON.stringify(input) });
  };
  const detail = await fetch(`${api}/daily-receipts/${receipts[0]}`, { headers }).then((r) => r.json());
  assert.equal(detail.data.confirmed_variance_total, -10);
  assert.equal(detail.data.lines[0].post_close_adjustment_amount, 40);
  const list = await fetch(`${api}/daily-receipts?branch_id=${branchId}`, { headers }).then((r) => r.json());
  assert.equal(list.data.find((r) => r.id === receipts[0]).confirmed_variance_total, -10);
  const denied = await post(payload(), { ...actor, role: 'cashier' });
  assert.equal(denied.status, 403);
  const posted = await post(payload({ expected_revision: 2, amount: '10.00' }));
  assert.equal(posted.status, 201);
  const final = await posted.json();
  assert.equal(final.data.confirmed_variance_total, 0);
  assert.equal(final.data.post_close_adjustment_count, 3);
  assert.deepEqual(await readProtected(), before);
  console.log(JSON.stringify({ result: 'PASS', originalDataUnchanged: true, reasonsRequired: true, retrySafe: true, concurrencyChecked: true, permissionsChecked: true, auditFailureRolledBack: true, apiAndCalendarAgree: true }));
} finally {
  if (process.argv.includes('--keep')) {
    console.log(JSON.stringify({ testBranchId: branchId, testBranchCode: code, testReceiptIds: receipts }));
  } else {
  for (const id of receipts) {
    await pool.query("DELETE FROM decision_events WHERE entity_type='daily-receipts' AND entity_id=?", [String(id)]);
    await pool.query('DELETE FROM receipt_post_close_adjustments WHERE receipt_id=?', [id]);
    await pool.query("DELETE FROM audit_logs WHERE entity_type='daily_receipt' AND entity_id=?", [id]);
    await pool.query('DELETE FROM daily_receipts WHERE id=?', [id]);
  }
  if (branchId) await pool.query('DELETE FROM branches WHERE id=?', [branchId]);
  }
  await pool.end();
}
