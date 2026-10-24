import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const runtime = fs.readFileSync(new URL('../../google-apps-script/monthly-daily-sheet-sync/src/GrabInboxRuntime.js', import.meta.url), 'utf8');
const standalone = fs.readFileSync(new URL('../../google-apps-script/GrabGmailImport.gs', import.meta.url), 'utf8');
const combined = fs.readFileSync(new URL('../../google-apps-script/monthly-daily-sheet-sync/src/InboxImports.js', import.meta.url), 'utf8');
const fixture = (options = {}) => {
  let now = Date.parse('2026-10-24T12:00:00Z');
  const values = new Map([['CASHFLOW_GMAIL_INBOX_TOKEN', 'TEST_CREDENTIAL_DO_NOT_LOG']]);
  const posts = [], sleeps = [], searches = [], labels = new Set();
  const threads = [], responses = [...(options.responses || [])];
  let released = 0;
  let resolutionFailures = options.resolutionFailures || 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, Math,
    LockService: { getScriptLock: () => ({ tryLock: () => !options.busy, releaseLock: () => { released++; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => values.get(key) || null,
      setProperty: (key, value) => {
        if (key.includes(':failure:') && JSON.parse(value).state === 'RESOLVED' && resolutionFailures-- > 0) throw new Error('temporary property write failure');
        values.set(key, String(value));
      }, deleteProperty: (key) => values.delete(key) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value)).digest()),
      sleep: (ms) => { sleeps.push(ms); now += ms; } },
    GmailApp: { search: (query, offset, limit) => {
      searches.push({ query, offset, limit });
      const before = Number(query.match(/before:(\d+)/)[1]) * 1000;
      const after = Number(query.match(/after:(\d+)/)[1]) * 1000;
      return threads.filter((thread) => thread.messages.some((m) => m.getDate().getTime() < before && m.getDate().getTime() > after))
        .sort((a, b) => b.messages[0].getDate() - a.messages[0].getDate()).slice(offset, offset + limit);
    }, getUserLabelByName: (name) => labels.has(name) ? name : null,
    createLabel: (name) => { labels.add(name); return name; } },
    UrlFetchApp: { fetch: (url, request) => {
      posts.push({ url, payload: request.payload });
      const step = responses.shift() ?? 200;
      if (step instanceof Error) throw step;
      const status = typeof step === 'number' ? step : step.status;
      return { getResponseCode: () => status,
        getContentText: () => typeof step === 'object' && step.body !== undefined ? step.body : JSON.stringify({ success: status >= 200 && status < 300 }),
        getAllHeaders: () => step.headers || {} };
    } }
  });
  vm.runInContext(runtime, context); vm.runInContext(standalone, context);
  const add = (id, files = [{ name: `${id}.pdf`, data: id }], ageMs = 60000) => {
    const date = new Date(now - ageMs);
    const message = { getId: () => id, getFrom: () => 'Grab <no-reply@grab.com>', getSubject: () => 'daily report', getDate: () => date,
      getAttachments: () => files.map((f) => ({ getName: () => f.name, copyBlob: () => ({
        setName() { return this; }, getBytes: () => Array.from(Buffer.from(f.data)) }) })) };
    const thread = { messages: [message], applied: new Set(), getMessages: () => [message],
      addLabel(label) { this.applied.add(label); }, removeLabel(label) { this.applied.delete(label); } };
    threads.push(thread); return thread;
  };
  const run = (config = {}) => context.runGrabInboxImport_(Object.assign({ API_URL: 'https://example.test/api/inbox-imports/grab',
    SEARCH: 'from:no-reply@grab.com has:attachment' }, config));
  return { values, posts, sleeps, searches, add, run, context, advance: (ms) => { now += ms; }, released: () => released };
};
const records = (f, type) => [...f.values.entries()].filter(([key]) => key.includes(`:grab:${type}:v2:`));

test('Grab continues after a bad PDF, persists its failure and never marks its message/thread done', () => {
  const f = fixture({ responses: [422, 200, 200] });
  const bad = f.add('mail-1', [{ name: 'bad.pdf', data: 'bad' }, { name: 'valid.pdf', data: 'valid' }], 60000);
  const good = f.add('mail-2', undefined, 120000);
  assert.throws(() => f.run(), /GRAB_IMPORT_INCOMPLETE failed=1/);
  assert.equal(f.posts.length, 3); assert.equal(f.sleeps.length, 0);
  assert.equal(records(f, 'file').length, 2); assert.equal(records(f, 'failure').length, 1);
  assert.equal(f.values.has('cashflow:grab:mail-1'), false);
  assert.ok(bad.applied.has('Cashflow/Failed Grab')); assert.ok(!bad.applied.has('Cashflow/Imported Grab'));
  assert.ok(good.applied.has('Cashflow/Imported Grab')); assert.equal(f.released(), 1);
  assert.throws(() => f.run(), /pending=1/); // cooldown stays visibly incomplete
  assert.equal(f.posts.length, 3);
});

test('per-attachment checksum handles repeated names and repeat runs without duplicates', () => {
  const f = fixture(); f.add('mail-1', [{ name: 'report.pdf', data: 'one' }, { name: 'report.pdf', data: 'two' }]);
  f.run(); f.run(); assert.equal(f.posts.length, 2); assert.equal(records(f, 'file').length, 2);
});

test('legacy single-file history is preserved, multi-file history cannot hide a missing attachment', () => {
  const f = fixture(); f.add('single'); f.add('multi', [{ name: 'one.pdf', data: '1' }, { name: 'two.pdf', data: '2' }]);
  f.values.set('cashflow:grab:single', 'legacy-time'); f.values.set('cashflow:grab:multi', 'legacy-time');
  f.run(); assert.equal(f.posts.length, 2); assert.equal(f.values.get('cashflow:grab:single'), 'legacy-time');
  assert.ok(f.values.has('cashflow:grab:multi'));
});

test('transient failure retries at most twice, with bounded waits and sanitized durable errors', () => {
  const f = fixture({ responses: [new Error('TEST_CREDENTIAL_DO_NOT_LOG'), 503, { status: 500, body: 'TEST_CREDENTIAL_DO_NOT_LOG' }, 200] });
  f.add('first'); f.add('second', undefined, 120000);
  assert.throws(() => f.run(), /failed=1/); assert.equal(f.posts.length, 4);
  assert.equal(f.sleeps.length, 2); assert.ok(f.sleeps.every((n) => n > 0 && n <= 10000));
  for (const [key, value] of f.values) if (key !== 'CASHFLOW_GMAIL_INBOX_TOKEN') assert.ok(!value.includes('TEST_CREDENTIAL_DO_NOT_LOG'));
});

test('Retry-After defers a throttled attachment without blocking the next one', () => {
  const f = fixture({ responses: [{ status: 429, headers: { 'Retry-After': '120' } }, 200] });
  f.add('first'); f.add('second', undefined, 120000);
  assert.throws(() => f.run(), /failed=1/); assert.equal(f.posts.length, 2); assert.equal(f.sleeps.length, 0);
  assert.ok(JSON.parse(records(f, 'failure')[0][1]).nextAttemptAt > Date.parse('2026-10-24T12:00:00Z'));
});

test('2xx without success, a FAILED duplicate and an invalid response are never acknowledged', () => {
  for (const body of ['not-json', JSON.stringify({ success: false }), JSON.stringify({ success: true, data: { status: 'FAILED' } })]) {
    const f = fixture({ responses: Array(3).fill({ status: 200, body }) }); f.add('mail-1');
    assert.throws(() => f.run(), /failed=1/); assert.equal(records(f, 'file').length, 0);
    assert.equal(f.posts.length, 3);
  }
});

test('a partial multi-attachment page resumes past completed files instead of starving', () => {
  const f = fixture(); const thread = f.add('mail-1', [{ name: 'one.pdf', data: '1' }, { name: 'two.pdf', data: '2' }, { name: 'three.pdf', data: '3' }]);
  for (let i = 0; i < 3; i++) f.run({ MAX_ATTACHMENTS: 1 });
  assert.equal(f.posts.length, 3); assert.equal(records(f, 'file').length, 3);
  assert.ok(thread.applied.has('Cashflow/Imported Grab'));
});

test('pagination freezes its date window across runs and the next scan picks up new arrivals', () => {
  const f = fixture(); f.add('old-1'); f.add('old-2', undefined, 120000);
  const limits = { PAGE_SIZE: 1, MAX_THREADS: 1 };
  f.run(limits); f.advance(300000); f.add('new'); f.run(limits); f.run(limits);
  assert.equal(f.posts.length, 2);
  assert.equal(f.searches[0].query, f.searches[1].query); assert.equal(f.searches[1].offset, 1);
  assert.equal(f.values.has('cashflow:grab:scan:v2'), false);
  f.run(limits); assert.equal(f.posts.length, 3);
  assert.notEqual(f.searches[0].query, f.searches.at(-1).query);
});

test('overlapping trigger exits without fetching or touching dedup state', () => {
  const f = fixture({ busy: true }); f.add('mail-1');
  assert.equal(f.run().skipped, 'LOCK_BUSY'); assert.equal(f.posts.length, 0); assert.equal(f.released(), 0);
});

test('standalone and combined entry points use the shared runtime without creating triggers', () => {
  for (const useCombined of [false, true]) {
    const f = fixture(); f.add('mail-1'); if (useCombined) vm.runInContext(combined, f.context);
    f.context.importGrabReports(); assert.equal(f.posts.length, 1);
  }
});

test('a repaired attachment resolves its durable failure and removes the failed label', () => {
  const f = fixture({ responses: [422, 200] }); const thread = f.add('mail-1');
  assert.throws(() => f.run(), /failed=1/); f.advance(3600001); f.run();
  assert.equal(JSON.parse(records(f, 'failure')[0][1]).state, 'RESOLVED');
  assert.equal(records(f, 'file').length, 1); assert.ok(thread.applied.has('Cashflow/Imported Grab'));
  assert.ok(!thread.applied.has('Cashflow/Failed Grab'));
});

test('saved success repairs an interrupted failure-ledger update without posting a duplicate', () => {
  const f = fixture({ responses: [422, 200], resolutionFailures: 1 }); f.add('mail-1');
  assert.throws(() => f.run(), /failed=1/); f.advance(3600001);
  assert.throws(() => f.run(), /failed=1/); assert.equal(f.posts.length, 2);
  f.run(); assert.equal(f.posts.length, 2);
  assert.equal(JSON.parse(records(f, 'failure')[0][1]).state, 'RESOLVED');
});
