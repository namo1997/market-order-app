// Source/dependency validation only. This does not claim SQL integration coverage.
// Run from the SSD server snapshot with --experimental-vm-modules.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadReceivingSourceModules } from '../tests/integration/receiving-mysql-harness.mjs';

assert.ok(process.cwd().startsWith('/Volumes/SSD Files/SOLAO/market-order-system/runs/'));
const files = [
  'scripts/run-receiving-mysql-it.mjs', 'scripts/setup-receiving-mysql-it.mjs',
  'scripts/validate-receiving-mysql-it.mjs', 'tests/integration/legacy-receiving-schema.mjs',
  'tests/integration/receiving-mysql-harness.mjs', 'tests/integration/receiving-mysql.it.mjs'
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  assert.equal(result.status, 0, file);
}
assert.equal(spawnSync('/bin/sh', ['-n', 'scripts/start-test-mysql-on-ssd.sh']).status, 0);
const noDatabase = () => { throw new Error('Offline loader validation must not query a database'); };
const app = await loadReceivingSourceModules({ query: noDatabase, getConnection: noDatabase });
for (const name of ['createReceivingDocument', 'confirmReceivingDocument', 'voidReceivingDocument']) {
  assert.equal(typeof app.model[name], 'function');
}
assert.equal(typeof app.schema.ensureReceivingDocumentsTables, 'function');
assert.equal(typeof app.order.updateOrderItemReceivingWithInventory, 'function');
assert.equal(typeof app.router.handle, 'function');
assert.equal(typeof app.legacyRouter.handle, 'function');
app.ocr.setCustomOcrProvider(async () => { throw new Error('Mock provider only'); });
console.info('Validation: 6 JavaScript syntax checks, 1 shell syntax check, source graph/exports loaded; 0 database calls');
