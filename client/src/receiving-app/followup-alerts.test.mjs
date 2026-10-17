import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollowupAlerts } from './followup-alerts.mjs';
function fixture() {
  const values = new Map(), calls = [];
  const preferences = { get: async ({ key }) => ({ value: values.get(key) }), set: async ({ key, value }) => { values.set(key, value); } };
  const options = { preferences, notifyUrgent: async alert => { calls.push(alert); } };
  const event = { user: { id: 7, role: 'accounting' }, origin: 'https://example.test', items: [{ id: 1, status: 'open', supplier_name: 'ร้านไก่' }] };
  return { values, calls, options, event, alerts: createFollowupAlerts(options) };
}
test('followup alerts: persists IDs; repeated refresh, concurrent focus and process restart notify once', async () => {
  const f = fixture();
  await Promise.all([f.alerts.receive(f.event), f.alerts.receive(f.event)]);
  await createFollowupAlerts(f.options).receive(f.event);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].data, { kind: 'followup', followup_ids: ['1'] });
  assert.match(f.calls[0].body, /ร้านไก่/);
  await f.alerts.receive({ ...f.event, items: [...f.event.items, { id: 2, status: 'open' }] });
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].data.followup_ids, ['2']);
  assert.deepEqual(JSON.parse([...f.values.values()][0]), ['1', '2']);
});
for (const role of ['admin', 'super_admin', 'accounting', 'accountant', 'user', 'manager', undefined]) {
  test(`followup alerts: role gate ${role}`, async () => {
    const f = fixture(); await f.alerts.receive({ ...f.event, user: { id: 7, role } });
    assert.equal(f.calls.length, ['admin', 'super_admin', 'accounting', 'accountant'].includes(role) ? 1 : 0);
  });
}
test('followup alerts: logout, web, resolved/acknowledged and malformed records do not notify', async () => {
  const f = fixture();
  await f.alerts.receive({ ...f.event, user: null });
  await createFollowupAlerts({ ...f.options, supported: () => false }).receive(f.event);
  await f.alerts.receive({ ...f.event, items: [null, {}, { id: 1, status: 'acknowledged' }, { id: 2, status: 'resolved' }, { id: -1, status: 'open' }] });
  assert.equal(f.calls.length, 0); assert.equal(f.values.size, 0);
});
test('followup alerts: user and API origin have independent persistent IDs; re-opened same ID stays silent', async () => {
  const f = fixture(); await f.alerts.receive(f.event);
  await f.alerts.receive({ ...f.event, user: { id: 8, role: 'admin' } });
  await f.alerts.receive({ ...f.event, origin: 'https://other.test' });
  await f.alerts.receive({ ...f.event, items: [{ id: 1, status: 'resolved' }] });
  await f.alerts.receive(f.event);
  assert.equal(f.calls.length, 3); assert.equal(f.values.size, 3);
});
test('followup alerts: denied notification releases reservation and retries; failed storage never posts', async () => {
  const f = fixture(); let denied = true;
  const alerts = createFollowupAlerts({ ...f.options, notifyUrgent: async a => { if (denied) throw Error('denied'); f.calls.push(a); } });
  await assert.rejects(alerts.receive(f.event), /denied/);
  denied = false; await alerts.receive(f.event); await alerts.receive(f.event); assert.equal(f.calls.length, 1);
  const broken = createFollowupAlerts({ ...f.options, preferences: { ...f.options.preferences, set: async () => { throw Error('storage'); } } });
  await assert.rejects(broken.receive({ ...f.event, origin: 'https://new.test' }), /storage/); assert.equal(f.calls.length, 1);
});
test('followup alerts: stale user while Preferences is pending cannot ring or consume IDs', async () => {
  const f = fixture(); let active = true;
  const alerts = createFollowupAlerts({ ...f.options, preferences: { ...f.options.preferences, get: async () => { active = false; return {}; } } });
  await alerts.receive({ ...f.event, isCurrent: () => active });
  assert.equal(f.calls.length, 0); assert.equal(f.values.size, 0);
});
test('followup alerts: a batch rings once, ignores duplicate IDs and bounds notification data', async () => {
  const f = fixture(); const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, status: 'open' }));
  await f.alerts.receive({ ...f.event, items: [...items, items[0]] });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].data.followup_ids.length, 50);
  assert.equal(JSON.parse([...f.values.values()][0]).length, 100);
});
test('followup alerts: corrupt Preferences fails closed without repeat sound', async () => {
  const f = fixture(); await f.alerts.receive(f.event); f.calls.length = 0;
  f.values.set([...f.values.keys()][0], 'broken-json');
  await assert.rejects(f.alerts.receive(f.event)); assert.equal(f.calls.length, 0);
});
