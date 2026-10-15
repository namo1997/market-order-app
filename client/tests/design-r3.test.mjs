import test from 'node:test';
import assert from 'node:assert/strict';
import { readMotionPreference, saveMotionPreference, withSavingFeedback } from '../src/design/motion-preference.js';
import { validateSampleQuantity } from '../src/design/sample-quantity.js';

test('r3 motion: missing/invalid/blocked storage falls back to OS; persisted override roundtrips', () => {
  assert.equal(readMotionPreference(undefined), null);
  assert.equal(readMotionPreference({ getItem: () => 'invalid' }), null);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readMotionPreference(blocked), null);
  assert.doesNotThrow(() => saveMotionPreference(blocked, 'reduce'));
  let stored;
  const store = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  for (const choice of ['reduce', 'full']) { saveMotionPreference(store, choice); assert.equal(readMotionPreference(store), choice); }
});

test('r3 feedback: request starts now; success and failure wait for 400ms gate without retry', async () => {
  for (const fails of [false, true]) {
    let release, calls = 0, settled = false;
    const failure = Error('mock network');
    const work = withSavingFeedback(() => { calls++; if (fails) throw failure; return 'saved'; }, ms => {
      assert.equal(ms, 400); return new Promise(resolve => { release = resolve; });
    });
    const observed = work.then(value => { settled = true; return value; }, error => { settled = true; return error; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 1); assert.equal(settled, false);
    release(); assert.equal(await observed, fails ? failure : 'saved'); assert.equal(calls, 1);
  }
});

test('r3 feedback: slow network still gates completion after the request, not a fake success', async () => {
  let finish;
  const work = withSavingFeedback(() => new Promise(resolve => { finish = resolve; }), async ms => assert.equal(ms, 400));
  let done = false; work.then(() => { done = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(done, false);
  finish('actual response'); assert.equal(await work, 'actual response');
});

test('r3 sample quantity: short/over/match labels preserve integer precision', () => {
  assert.equal(validateSampleQuantity('11.99').label, 'ขาด 0.01 กก.');
  assert.equal(validateSampleQuantity('12.01').label, 'เกิน 0.01 กก.');
  assert.equal(validateSampleQuantity('12').status, 'ok');
  for (const input of ['-1', '0', '100000', '1.001', 'NaN']) assert.equal(validateSampleQuantity(input).status, 'error');
});
