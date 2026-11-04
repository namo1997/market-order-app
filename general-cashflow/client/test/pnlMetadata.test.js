import assert from 'node:assert/strict';
import test from 'node:test';
import { createPnlMetadataCache } from '../src/pnlMetadata.js';

test('metadata is reused across report filters but explicit refresh and expiry discover changes', async () => {
  const calls = []; let clock = 0;
  const cache = createPnlMetadataCache(async path => { calls.push(path); return [{ revision: calls.length }]; }, () => clock);
  const first = await cache.read();
  assert.equal(await cache.read(), first);
  assert.equal(calls.length, 2);
  assert.notEqual(await cache.read({ force: true }), first);
  assert.equal(calls.length, 4);
  clock = 300_001;
  await cache.read();
  assert.equal(calls.length, 6);
});

test('failed metadata refresh does not replace cached metadata', async () => {
  let fail = false;
  const cache = createPnlMetadataCache(async () => { if (fail) throw new Error('metadata offline'); return ['known']; });
  const original = await cache.read();
  fail = true;
  await assert.rejects(cache.read({ force: true }), /metadata offline/);
  assert.equal(await cache.read(), original);
});

test('aborted metadata requests cannot populate cache with obsolete results', async () => {
  const controller = new AbortController(); let calls = 0;
  const cache = createPnlMetadataCache(async () => { calls++; return ['known']; });
  controller.abort();
  await assert.rejects(cache.read({ signal: controller.signal }), { name: 'AbortError' });
  await cache.read();
  assert.equal(calls, 4);
});
