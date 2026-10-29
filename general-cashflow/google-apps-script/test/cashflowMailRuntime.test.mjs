import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source = fs.readFileSync(new URL('../CashflowMailRuntime.gs', import.meta.url), 'utf8');
const auditSource = fs.readFileSync(new URL('../CashflowMailAudit.gs', import.meta.url), 'utf8');
const encode = value => Buffer.from(value).toString('base64url');
const mail = (id, overrides = {}) => ({ id, internalDate: '1793232000000', payload: {
  headers: [{ name: 'From', value: 'KPLUSSHOP@kasikornbank.com' }, { name: 'Subject', value: 'daily' }],
  parts: [{ mimeType: 'text/plain', body: { data: encode('รหัสร้านค้า: KB000001927650\nยอดเงินจำนวน (บาท): 123.45') } }]
}, ...overrides });

function harness({ pages = [{ messages: [{ id: 'a' }] }], messages = { a: mail('a') }, post, gmail } = {}) {
  const values = new Map(), calls = [], logs = []; let now = 1793246400000, locked = false;
  const props = { getProperty: key => values.get(key) || null, setProperty(key, value) { values.set(key, value); }, getProperties: () => Object.fromEntries(values) };
  const response = (status, body) => ({ getResponseCode: () => status, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => ({}) });
  const blob = (bytes, type, name) => ({ bytes: Array.from(bytes), type, name, getDataAsString: () => Buffer.from(bytes).toString('utf8'), getBytes: () => Array.from(Buffer.from(bytes)) });
  const context = vm.createContext({ console: { log: value => logs.push(value) }, CONFIG: { IMPORT_TOKEN: 'fixture-only' },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock() { if (locked) return false; locked = true; return true; }, releaseLock() { locked = false; } }) },
    ScriptApp: { getOAuthToken: () => 'fixture-oauth-only' },
    Utilities: { newBlob: blob, base64DecodeWebSafe: value => Array.from(Buffer.from(value, 'base64url')),
      DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value)).digest()),
      formatDate: date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10), sleep() {} },
    UrlFetchApp: { fetch(url, options) {
      calls.push({ url, options });
      if (url.startsWith('https://gmail.googleapis.com/')) {
        if (gmail) { const answer = gmail(url, calls); if (answer) return response(...answer); }
        if (url.endsWith('/profile')) return response(200, { emailAddress: 'solao.acc@gmail.com' });
        if (url.includes('/attachments/')) return response(200, { data: encode('original-pdf') });
        const found = url.match(/\/messages\/([^?]+)\?format=full/);
        if (found) return response(200, messages[decodeURIComponent(found[1])]);
        const p = new URL(url); return response(200, pages[Number(p.searchParams.get('pageToken') || 0)]);
      }
      return post ? response(...post(url, options, calls)) : response(201, { success: true, data: { id: 12, status: 'AUTO_LINKED' } });
    } }
  });
  vm.runInContext(source, context);
  vm.runInContext(auditSource, context);
  return { context, values, calls, logs, run: (name = 'kplus', options) => context.cashflowMailRun_(name, options), advance: ms => { now += ms; } };
}

test('resumes saved message IDs and page tokens without dropping a partial page', () => {
  const h = harness({ pages: [{ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: '1' }, { messages: [{ id: 'c' }] }], messages: { a: mail('a'), b: mail('b'), c: mail('c') } });
  assert.equal(h.run('kplus', { maxMessages: 1 }).scanComplete, false);
  assert.equal(h.run('kplus', { maxMessages: 1 }).scanComplete, false);
  assert.equal(h.run('kplus', { maxMessages: 1 }).scanComplete, true);
  assert.equal(h.calls.filter(c => c.url.includes('?format=full')).length, 3);
  assert.equal(h.calls.filter(c => c.url.includes('messages?')).length, 2);
  assert.equal(h.calls.filter(c => c.url.includes('/api/inbox-imports/')).length, 3);
  assert.equal(JSON.parse(h.values.get('cashflow:mail:v3:state:kplus')).scan, null);
});

test('same-subject messages in the same Gmail thread are processed separately', () => {
  const a = mail('a'), b = mail('b'); a.threadId = b.threadId = 'shared';
  const h = harness({ pages: [{ messages: [{ id: 'a', threadId: 'shared' }, { id: 'b', threadId: 'shared' }] }], messages: { a, b } });
  assert.equal(h.run().imported, 2);
  assert.equal(h.calls.some(c => c.url.includes('/threads')), false);
});

test('normal polling returns before Gmail calls and overlap skips acknowledged MIME bodies', () => {
  const h = harness(); h.run(); const before = h.calls.length;
  assert.equal(h.run().skipped, 'NOT_DUE'); assert.equal(h.calls.length, before);
  h.advance(900001); const r = h.run();
  assert.equal(r.messagesRead, 0); assert.equal(r.skipped, 1);
  assert.equal(h.calls.filter(c => c.url.includes('?format=full')).length, 1);
  assert.equal(h.calls.filter(c => c.url.includes('/api/inbox-imports/')).length, 1);
});

test('query window is frozen through pagination and watermark advances only when complete', () => {
  const h = harness({ pages: [{ messages: [{ id: 'a' }], nextPageToken: '1' }, { messages: [] }] });
  h.run('kplus', { maxMessages: 1 }); h.advance(3600000); h.run();
  const qs = h.calls.filter(c => c.url.includes('messages?')).map(c => new URL(c.url).searchParams.get('q'));
  assert.equal(qs[0], qs[1]); assert.match(qs[0], /after:\d+ before:\d+/);
});

test('unknown/missing K SHOP fields never create a zero or a success marker', () => {
  const broken = mail('a'); broken.payload.parts[0].body.data = encode('รหัสร้านค้า: KB123');
  const h = harness({ messages: { a: broken } }); const r = h.run();
  assert.equal(r.failed, 1); assert.equal(r.unresolved, 1);
  assert.equal(h.calls.some(c => c.url.includes('/api/inbox-imports/')), false);
  assert.equal(h.values.has('cashflow:mail:v3:done:kplus:a'), false);
});

test('a failed PDF does not block other messages; retry retains successful attachment markers', () => {
  let failing = true;
  const pdf = id => mail(id, { payload: { headers: [{ name: 'From', value: 'no-reply@grab.com' }], parts: [
    { partId: '1', filename: 'first.pdf', mimeType: 'application/pdf', body: { data: encode('first') } },
    { partId: '2', filename: 'second.pdf', mimeType: 'application/pdf', body: { data: encode('second') } }
  ] } });
  const h = harness({ messages: { a: pdf('a') }, post: (_, opts) => opts.payload.file.name === 'second.pdf' && failing ? [422, { success: false }] : [201, { success: true, data: { id: 1 } }] });
  assert.equal(h.run('grab').failed, 1); failing = false; h.advance(900001);
  const r = h.run('grab'); assert.equal(r.unresolved, 0);
  assert.equal(h.calls.filter(c => c.options.payload?.file?.name === 'first.pdf').length, 1);
  assert.equal(h.calls.filter(c => c.options.payload?.file?.name === 'second.pdf').length, 2);
});

test('Gmail daily quota pauses all sources before any further mail calls and releases the lock', () => {
  const h = harness({ gmail: () => [403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }] });
  assert.throws(() => h.run(), /GMAIL_API_403_dailyLimitExceeded/); const before = h.calls.length;
  assert.equal(h.run('scb').skipped, 'MAIL_QUOTA_BACKOFF'); assert.equal(h.calls.length, before);
  h.advance(21600001); assert.throws(() => h.run(), /GMAIL_API_403_dailyLimitExceeded/);
});

test('permission failure stops without falling back to a broad GmailApp scan', () => {
  const h = harness({ gmail: () => [403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }] });
  assert.throws(() => h.run(), /GMAIL_API_403_accessNotConfigured/);
  assert.equal(h.calls.length, 1); assert.equal(h.values.has('cashflow:mail:v3:done:kplus:a'), false);
});

test('malformed success response is not acknowledged and its failure remains durable', () => {
  const h = harness({ post: () => [200, '<html>not JSON</html>'] });
  assert.equal(h.run().unresolved, 1); assert.equal(h.values.has('cashflow:mail:v3:done:kplus:a'), false);
  assert.equal(h.logs.some(s => s.includes('fixture-only') || s.includes('<html>')), false);
});

test('server duplicate acknowledgement is counted separately and does not overwrite legacy history', () => {
  const h = harness({ post: () => [200, { success: true, duplicate: true, data: { id: 44, status: 'AUTO_LINKED' } }] });
  h.values.set('cashflow:kplus:a', 'legacy-time');
  const r = h.run(); assert.equal(r.duplicate, 1); assert.equal(r.imported, 0);
  assert.equal(h.values.get('cashflow:kplus:a'), 'legacy-time');
});

test('K SHOP source date is previous Bangkok day and source amount remains a string', () => {
  const h = harness(); h.run(); const req = h.calls.find(c => c.url.includes('/api/inbox-imports/'));
  const body = JSON.parse(req.options.payload); assert.equal(body.source_date, '2026-10-28'); assert.equal(body.amount, '123.45');
});

test('account probe checks the intended mailbox without importing or modifying messages', () => {
  const h = harness(); assert.equal(h.context.probeCashflowMailApi().mailApi, 'READY');
  assert.equal(h.calls.length, 1); assert.match(h.calls[0].url, /\/profile$/);
});

test('checkpoint audit is read-only and whitelists evidence metadata without exposing unrelated properties', () => {
  const h = harness(); h.run();
  h.values.set('private-credential', 'must-never-appear-in-logs');
  h.values.set('cashflow:mail:v3:file:grab:fixture', JSON.stringify({ checksum: 'fixture-sha', importId: 42, token: 'secret-field' }));
  const before = JSON.stringify([...h.values]), callCount = h.calls.length;
  const result = h.context.inspectCashflowMailStatus();
  assert.equal(h.calls.length, callCount); assert.equal(JSON.stringify([...h.values]), before);
  assert.equal(result.mailStatus.find(r => r.source === 'kplus').acknowledgedMessages, 1);
  assert.equal(result.mailStatus.find(r => r.source === 'kplus').scanPending, false);
  assert.equal(result.mailStatus.find(r => r.source === 'grab').acknowledgedFiles, 1);
  assert.equal(result.propertyCount, h.values.size); assert.ok(result.propertyBytes > 0);
  const logs = h.logs.join('\n'); assert.match(logs, /fixture-sha/);
  assert.doesNotMatch(logs, /must-never-appear-in-logs|secret-field|fixture-only/);
});
