import { readFile } from 'node:fs/promises';
import { reports, root, ssdDir, command, cleanEnv, json } from './common.mjs';

const file = process.argv[2];
if (!file?.startsWith(`${reports}/receiving-pilot-`) || !file.endsWith('/prepared.json') || file.includes('/../')) throw new Error('Pass prepared.json on SSD');
const prepared = JSON.parse(await readFile(file, 'utf8'));
if (!prepared.run?.startsWith(`${root}/runs/receiving-pilot-`) || prepared.run.includes('/../')) throw new Error('Invalid snapshot');
await ssdDir(prepared.run);
const evidence = await ssdDir(`${prepared.evidence}/verification-${Date.now()}`);
const env = cleanEnv(`${prepared.run}/tmp`);
const results = [];
for (let round = 1; round <= 2; round++) {
  for (const suite of ['regression', 'pilot']) {
    const log = `${evidence}/${suite}-${round}.tap`;
    let rc = 0;
    try {
      await command('/bin/sh', ['-c', suite === 'regression'
        ? 'node --experimental-vm-modules --test --test-reporter=tap tests/*.test.mjs'
        : 'node --experimental-vm-modules --test --test-reporter=tap ../pilot/*.test.mjs'],
      { cwd: `${prepared.run}/source/server`, env, log });
    } catch { rc = 1; }
    const output = await readFile(log, 'utf8');
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(k => [k,
      Number(output.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? -1)]));
    if (counts.tests < 1 || counts.fail !== 0 || counts.skipped !== 0) rc = 1;
    results.push({ suite, round, rc, ...counts, log });
    process.stdout.write(`${suite} round ${round}: ${JSON.stringify(counts)} rc=${rc}\n`);
  }
}
await json(`${evidence}/result.json`, { snapshot: prepared.run, results });
process.stdout.write(`Evidence: ${evidence}\n`);
process.exitCode = results.some(r => r.rc) ? 1 : 0;
