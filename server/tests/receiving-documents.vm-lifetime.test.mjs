import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('VM harness retains synthetic modules across GC between linking and evaluation', () => {
  // Isolate the child so a native crash becomes a visible test failure with its
  // signal, rather than silently dropping the remaining validation tests.
  const child = spawnSync(process.execPath, [
    '--expose-gc', '--experimental-vm-modules', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { setImmediate } from 'node:timers/promises';
      import { createReceivingHarness, makePngDataUrl } from './tests/helpers/receiving-fake-db.mjs';
      const user = { id: 12, name: 'GC fixture', role: 'user', branch_id: 1, department_id: 10 };
      let collections = 0;
      const h = await createReceivingHarness({ beforeModuleEvaluate: async () => {
        await setImmediate();
        global.gc();
        collections++;
      } });
      assert.ok(collections > 0, 'GC must run between linking and evaluation');
      const missing = await h.invoke('updateDocument', {
        user, params: { id: '9999' }, body: { doc_ref: 'X' }
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.body.code, 'NOT_FOUND');
      const created = await h.invoke('createDocument', { user, body: {
        client_uuid: 'vm-gc-fixture', delivery_date: h.today, kind: 'manual_receipt'
      } });
      assert.equal(created.statusCode, 201);
      const id = String(created.body.data.id);
      const image_data_url = makePngDataUrl();
      const saved = await h.invoke('addSignature', {
        user, params: { id }, body: { role: 'receiver', image_data_url }
      });
      assert.equal(saved.statusCode, 200);
      const signature = await h.invoke('getSignatureBinary', { user, params: { id, role: 'receiver' } });
      assert.equal(signature.statusCode, 200);
      assert.deepEqual(signature.binaryBody, Buffer.from(image_data_url.split(',')[1], 'base64'));
      assert.equal(signature.headers['cache-control'], 'private, no-store');
      console.log('GC regression completed');
    `
  ], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 30_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null, `Child terminated by ${child.signal}: ${child.stderr}`);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /GC regression completed/);
});
