import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let build = { commit: process.env.CASHFLOW_BUILD_COMMIT || 'development' };
try { build = JSON.parse(fs.readFileSync(new URL('../build-info.json', import.meta.url), 'utf8')); } catch { /* local development */ }
// Attest the source files actually running, including CLI releases without Git metadata.
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = [];
const walk = (dir) => {
  if (!fs.existsSync(path.join(root, dir))) return;
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(name);
    else if (entry.isFile()) files.push(name);
  }
};
walk('server/src'); walk('client/src');
const digest = crypto.createHash('sha256');
for (const name of files.sort()) digest.update(name + '\0').update(fs.readFileSync(path.join(root, name))).update('\0');
build.source_sha256 = digest.digest('hex');
build.source_file_count = files.length;
export const buildInfo = Object.freeze(build);
