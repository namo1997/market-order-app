import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivingHarness, deltaActor as user, makePngDataUrl } from './helpers/receiving-fake-db.mjs';
import { settleVoidedReceiptIssues } from '../src/models/receiving-void-issues.js';

// Bug hunt 2026-10-24 (pilot, NewStar bill #4106 counted 20 of 21): voiding the confirmed receipt left the
// auto-opened shortage open, so accounting would chase a receipt that no longer counts.
async function confirmed() {
  const h = await createReceivingHarness({ prepareCount: false });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'void-issues', kind: 'manual_receipt', delivery_date: h.today, product_group_id: 3, order_item_ids: [50, 51] } });
  const doc = created.body.data, params = { id: String(doc.id) };
  await h.invoke('saveCount', { user, params, body: { client_uuid: doc.client_uuid, lines: doc.lines.map((line, i) => ({ id: line.id, counted_quantity: i ? '0' : '4.50' })) } });
  await h.invoke('addSignature', { user, params, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  assert.equal((await h.invoke('confirmDocument', { user, params })).statusCode, 200);
  return { h, doc, params };
}

test('voiding a confirmed receipt withdraws its untouched auto issues and flags the rest', async () => {
  const { h, doc, params } = await confirmed();
  const issue = (id, patch) => ({ id, document_id: doc.id, status: 'open', auto_key: `auto-${doc.id}-${id}-shortage`, ...patch });
  h.state.issues = [issue(1), issue(2), issue(3, { status: 'waiting_supplier' }), issue(4, { auto_key: null }), issue(5, { status: 'resolved' }),
    issue(6, { document_id: doc.id + 1 })];
  h.state.issueEvidence = [{ id: 9, issue_id: 2 }];
  const voided = await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params, body: { reason: 'ถ่ายบิลผิดใบ' } });
  assert.equal(voided.statusCode, 200);
  assert.deepEqual(h.state.issues.map(row => row.status), ['cancelled', 'open', 'waiting_supplier', 'open', 'resolved', 'open']);
  assert.deepEqual(h.state.issueRemindersClosed, [1]);
  assert.deepEqual(h.state.issueHistory.map(row => [row.issue_id, row.action]), [[1, 'updated'], [2, 'document_voided'], [3, 'document_voided'], [4, 'document_voided']]);
  assert.match(h.state.issueHistory[0].details.note, /ใบรับ #\d+ ถูกยกเลิก: ถ่ายบิลผิดใบ/);
  assert.equal(h.state.issueHistory[0].details.to, 'cancelled');
  const audit = h.state.audits.filter(row => row.action === 'void').at(-1);
  assert.deepEqual(audit.details.issues, { cancelled: [1], kept: [2, 3, 4] });
});

test('a receipt with no issues voids exactly as before', async () => {
  const { h, params } = await confirmed();
  assert.equal((await h.invoke('voidDocument', { user: { ...user, role: 'admin' }, params, body: { reason: 'ทดสอบ' } })).statusCode, 200);
  assert.equal(h.state.issueHistory, undefined);
});

test('the settle step only reads issues of the voided receipt', async () => {
  const calls = [];
  const conn = { query: async (sql, params) => { calls.push([sql.replace(/\s+/g, ' ').trim(), params]); return [[]]; } };
  assert.deepEqual(await settleVoidedReceiptIssues(conn, { docId: 7, reason: 'x', now: new Date('2026-10-24T05:00:00Z') }), { cancelled: [], kept: [] });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0][1], [7]); assert.match(calls[0][0], /status IN \('open','waiting_supplier'\).*FOR UPDATE/);
});
