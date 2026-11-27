import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { reusableDraft } from '../src/pages/receiving/draft-reuse.js';

// start-receiving.js uses extension-less imports (Vite), so bundle it for Node.
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/pages/receiving/start-receiving.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node' });
const module_ = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module_, module_.exports);
const { groupIdentity } = module_.exports;

// Owner 2026-11-27: catch-all groups are split per real supplier in the queue (`pg:<group>:sm:<supplier>`).
const user = { id: 12, role: 'user', branch_id: 4, department_id: 20, receiving_scope: 'department' };
const draft = patch => ({ id: 5, status: 'draft', delivery_date: '2026-11-27', branch_id: 4, department_id: 20, product_group_id: 17, ...patch });

test('split key creates the receipt for both the group and the real supplier', () => {
  assert.deepEqual(groupIdentity({ supplier_key: 'pg:17:sm:13' }), { product_group_id: 17, supplier_master_id: 13 });
  assert.deepEqual(groupIdentity({ supplier_key: 'pg:17' }), { product_group_id: 17 });
  assert.deepEqual(groupIdentity({ supplier_key: 'sm:13' }), { supplier_master_id: 13 });
  assert.deepEqual(groupIdentity({ supplier_key: 'none' }), {});
});

test('draft reuse never mixes split shops of the same group', () => {
  const options = key => ({ group: { supplier_key: key }, date: '2026-11-27', user });
  const betagro = draft({ supplier_master_id: 13 }), suporn = draft({ id: 6, supplier_master_id: 5 }), plain = draft({ id: 7 });
  assert.equal(reusableDraft([plain, suporn, betagro], options('pg:17:sm:13')).id, 5);
  assert.equal(reusableDraft([plain, suporn, betagro], options('pg:17:sm:5')).id, 6);
  assert.equal(reusableDraft([betagro, suporn, plain], options('pg:17')).id, 7);
  assert.equal(reusableDraft([betagro], options('pg:17:sm:9')), null);
});
