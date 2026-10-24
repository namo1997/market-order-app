import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

// Bug hunt 2026-10-24: every focus/visibilitychange (camera, LINE, app switch) cleared the queue to the
// loading illustration and reloaded twice, also when the app went to the background.
const live = [];
afterEach(() => { for (const h of live.splice(0)) h.unmount(); });
const user = { id: 12, role: 'user', branch_id: 1, department_id: 10, name: 'ผู้รับ' };
const shop = { supplier_key: 'pg:3', supplier_name: 'ร้านทดสอบ', status: 'due_today', due_date: '2026-10-18', has_partial: false,
  items: [{ order_item_id: 50, product_id: 7, product_name: 'สินค้า 7', unit_name: 'กก.', has_pending: true }] };
function clock(instant) {
  let now = instant;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Date.parse(now); } }
  return { set: value => { now = value; }, runtime: { Date: FixedDate, setInterval: () => 1, clearInterval() {} } };
}

test('returning to the app reloads the queue quietly, once, and keeps it on screen', async () => {
  const c = clock('2026-10-18T03:00:00Z');
  let calls = 0; let hold = null;
  const h = await harness('Receiving', {}, { expected: async () => { calls += 1; if (hold) await hold.promise; return [shop]; } }, { user }, {}, c.runtime);
  live.push(h);
  assert.equal(calls, 1);
  assert.match(h.text(h.visible()), /ร้านทดสอบ/);

  c.set('2026-10-18T03:00:05Z');
  let release; hold = { promise: new Promise(resolve => { release = resolve; }) };
  h.dispatch({ type: 'focus' }); h.dispatch({ type: 'focus' });
  assert.equal(calls, 2, 'focus + visibilitychange on resume is one reload');
  assert.match(h.text(h.visible()), /ร้านทดสอบ/, 'the queue stays visible while it reloads');
  assert.doesNotMatch(h.text(h.visible()), /กำลังโหลด/);
  release(); hold = null; await h.settle();

  h.dispatch({ type: 'focus' });
  assert.equal(calls, 2, 'a second resume right after is skipped');

  c.set('2026-10-18T03:00:10Z');
  h.api.expected = async () => { calls += 1; throw Object.assign(new Error('offline'), { request: {} }); };
  h.dispatch({ type: 'focus' }); await h.settle();
  assert.equal(calls, 3);
  assert.match(h.text(h.visible()), /ร้านทดสอบ/, 'a failed quiet reload keeps the last queue');
  assert.doesNotMatch(h.text(h.visible()), /โหลดคิวไม่สำเร็จ/);
});

test('the reload button still shows loading and reports failures', async () => {
  const c = clock('2026-10-18T03:00:00Z');
  const h = await harness('Receiving', {}, { expected: async () => [shop] }, { user }, {}, c.runtime);
  live.push(h);
  h.api.expected = async () => { throw Object.assign(new Error('offline'), { request: {} }); };
  await h.click('โหลดใหม่');
  assert.match(h.text(h.visible()), /โหลดคิวไม่สำเร็จ/);
});
