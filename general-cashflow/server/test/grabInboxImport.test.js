import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grabAttachmentMessageId, withGrabInboxImport } from '../src/grabInboxImport.js';

const checksumA = 'a'.repeat(64), checksumB = 'b'.repeat(64);
const fixturePool = (existing = new Map(), options = {}) => {
  const calls = [], held = new Set();
  const pool = { getConnection: async () => {
    let currentLock;
    return {
      async query(sql, params) {
        calls.push([sql, params]);
        if (sql.includes('GET_LOCK')) {
          if (options.busy || held.has(params[0])) return [[{ acquired: 0 }]];
          held.add(params[0]); currentLock = params[0]; return [[{ acquired: 1 }]];
        }
        if (sql.includes('RELEASE_LOCK')) {
          if (options.releaseError) throw new Error('connection lost');
          held.delete(params[0]); return [[{ released: 1 }]];
        }
        if (sql.includes('SELECT id, status')) return [[...(existing.has(params[0]) ? [existing.get(params[0])] : [])]];
        throw new Error('Unexpected SQL');
      },
      async beginTransaction() { calls.push(['begin']); },
      async commit() { calls.push(['commit']); },
      async rollback() { calls.push(['rollback']); if (options.rollbackError) throw new Error('connection lost'); },
      release() { calls.push(['release']); },
      destroy() { held.delete(currentLock); calls.push(['destroy']); }
    };
  } };
  return { pool, calls, held, existing };
};

test('different attachments from one message have distinct bounded identities', () => {
  assert.notEqual(grabAttachmentMessageId('mail-1', checksumA), grabAttachmentMessageId('mail-1', checksumB));
  assert.equal(grabAttachmentMessageId('mail-1', checksumA), grabAttachmentMessageId('mail-1', checksumA));
  assert.ok(grabAttachmentMessageId('m'.repeat(160), checksumA).length <= 160);
});

test('legacy checksum duplicate is returned without altering history or financial data', async () => {
  const record = { id: 7, status: 'AUTO_LINKED', source_message_id: 'legacy-mail' };
  const db = fixturePool(new Map([[checksumA, record]]));
  const result = await withGrabInboxImport({ pool: db.pool, messageId: 'forwarded-mail', checksum: checksumA }, () => assert.fail('must not import'));
  assert.equal(result.duplicate, true); assert.equal(result.data, record);
  assert.equal(record.source_message_id, 'legacy-mail');
  assert.ok(!db.calls.some(([sql]) => sql === 'begin'));
  assert.equal(db.held.size, 0);
});

test('multiple attachments commit independently and a repeated request is a duplicate', async () => {
  const db = fixturePool(); let imports = 0;
  const run = (checksum) => withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum }, async (_connection, id) => {
    const row = { id: ++imports, status: 'PENDING_REVIEW', source_message_id: id };
    db.existing.set(checksum, row); return row;
  });
  assert.equal((await run(checksumA)).duplicate, false);
  assert.equal((await run(checksumB)).duplicate, false);
  assert.equal((await run(checksumA)).duplicate, true);
  assert.equal(imports, 2);
  assert.equal(db.calls.filter(([sql]) => sql === 'commit').length, 2);
});

test('concurrent duplicate cannot enter financial callback while the first holds the lock', async () => {
  const db = fixturePool(); let unblock; let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const first = withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum: checksumA }, async () => {
    entered(); await new Promise((resolve) => { unblock = resolve; }); return { id: 1 };
  });
  await started;
  await assert.rejects(withGrabInboxImport({ pool: db.pool, messageId: 'mail-2', checksum: checksumA }, () => assert.fail('concurrent import')), { statusCode: 503 });
  unblock(); await first; assert.equal(db.held.size, 0);
});

test('parser/audit/transaction failure rolls back and always releases lock and connection', async () => {
  const db = fixturePool(); const error = Object.assign(new Error('invalid report'), { statusCode: 422 });
  await assert.rejects(withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum: checksumA }, async () => { throw error; }), error);
  assert.ok(db.calls.some(([sql]) => sql === 'rollback'));
  assert.ok(!db.calls.some(([sql]) => sql === 'commit'));
  assert.equal(db.calls.at(-1)[0], 'release'); assert.equal(db.held.size, 0);
});

test('FAILED legacy row is never acknowledged as a successful duplicate', async () => {
  const db = fixturePool(new Map([[checksumA, { id: 8, status: 'FAILED' }]]));
  await assert.rejects(withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum: checksumA }, () => assert.fail('no implicit repair')), { statusCode: 409 });
});

test('connection with an uncertain lock release is destroyed instead of pooled', async () => {
  const db = fixturePool(new Map([[checksumA, { id: 7, status: 'PENDING_REVIEW' }]]), { releaseError: true });
  const result = await withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum: checksumA }, () => assert.fail());
  assert.equal(result.duplicate, true); assert.equal(db.calls.at(-1)[0], 'destroy');
  assert.ok(!db.calls.some(([sql]) => sql === 'release'));
});

test('connection with a failed rollback is destroyed instead of retaining an uncertain transaction', async () => {
  const db = fixturePool(new Map(), { rollbackError: true });
  await assert.rejects(withGrabInboxImport({ pool: db.pool, messageId: 'mail-1', checksum: checksumA }, async () => {
    throw new Error('audit failed');
  }), /audit failed/);
  assert.equal(db.calls.at(-1)[0], 'destroy'); assert.equal(db.held.size, 0);
  assert.ok(!db.calls.some(([sql]) => sql === 'release'));
});
