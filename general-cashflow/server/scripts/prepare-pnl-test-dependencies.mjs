// Existing Cashflow contract tests depend on untracked, frozen accounting assets.
// Copy exact read-only dependencies into a verified SSD simulation, never a checkout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertSSDPath } from '/Users/surachart/.solao-tools/ssd-workspace.mjs';
const destination = path.resolve(process.cwd(), '../..');
assertSSDPath(destination);
if (!/\/runs\/[^/]+\/source$/.test(destination)) throw new Error('Run through ssd-workspace in general-cashflow/server');
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw new Error('Supply the read-only canonical workspace path');
const dependencies = [
  'management-accounting/server/src/receivables-normalization.js',
  'management-accounting/docs/contracts/general-cashflow/fixtures/source',
  'management-accounting/docs/contracts/general-cashflow/fixtures/accounting/phase-4'
];
const hashes = [];
const copy = (relative) => {
  const origin = path.join(source, relative); const target = path.join(destination, relative);
  const stat = fs.lstatSync(origin);
  if (stat.isSymbolicLink()) throw new Error('Dependency symlinks are not allowed');
  if (stat.isDirectory()) { for (const name of fs.readdirSync(origin).sort()) copy(path.join(relative, name)); return; }
  if (!/\.(json|js)$/.test(relative)) throw new Error('Unexpected test asset type');
  const content = fs.readFileSync(origin);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Existing source in the snapshot must match; never overwrite it.
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(content)) throw new Error('Snapshot dependency differs from canonical asset');
  } else fs.writeFileSync(target, content, { flag: 'wx' });
  hashes.push({ path: relative, sha256: crypto.createHash('sha256').update(content).digest('hex'), bytes: content.length });
};
for (const dependency of dependencies) copy(dependency);
fs.writeFileSync(path.join(destination, '../reports/external-test-dependencies.json'), JSON.stringify({ source, dependencies: hashes }, null, 2), { flag: 'wx' });
console.log(`Prepared ${hashes.length} existing read-only contract test dependencies on SSD`);
