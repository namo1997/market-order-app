import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushBridge } from './push.mjs';
import { createSessionStore } from './session.mjs';

test('push bridge: native sync/stop/tap, bounded IDs and web stays inactive', async () => {
  const calls = []; let id = '9';
  const native = { sync: async () => calls.push('sync'), stop: async () => calls.push('stop'), consumeTap: async () => ({ followup_id: id }) };
  const bridge = createPushBridge({ capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true }, native });
  await bridge.sync(); await bridge.stop(); assert.deepEqual(calls, ['sync', 'stop']);
  assert.equal(await bridge.consumeTap(), '9');
  for (const invalid of ['', '-1', '0', '1/other', '9999999999']) { id = invalid; assert.equal(await bridge.consumeTap(), null); }
  const web = createPushBridge({ capacitor: { getPlatform: () => 'web' }, native: {} });
  await web.sync(); await web.stop(); assert.equal(await web.consumeTap(), null);
});
test('push session lifecycle: persist before sync, stop before clear, native failures cannot retain login', async () => {
  const calls = [];
  const prefs = { set: async () => calls.push('save'), remove: async () => calls.push('clear') };
  const sessions = createSessionStore(prefs, { afterSave: async () => { calls.push('sync'); throw Error('mock native failure'); },
    beforeClear: async () => { calls.push('stop'); throw Error('mock native failure'); } });
  await sessions.save('https://example.invalid', 'synthetic-session', { id: 7, role: 'accounting' });
  await sessions.clear(); assert.deepEqual(calls, ['save', 'sync', 'stop', 'clear']);
});
