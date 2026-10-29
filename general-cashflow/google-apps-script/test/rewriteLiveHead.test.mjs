import test from 'node:test';
import assert from 'node:assert/strict';
import {handlers,rewriteCashflowHandlers} from '../rewrite-live-head.mjs';

test('only the five importer bodies change and repeated preparation is idempotent', () => {
  const prefix = "const CONFIG = {IMPORT_TOKEN: 'fixture-not-real'};\n\n";
  const functions = Object.keys(handlers).map(name=>`function ${name}() {\n  if (true) { oldCall(); }\n}\n\n`).join('');
  const suffix = "function createGrabTwiceDailyTriggers() {\n  keepSchedule();\n}\n\nfunction otherHelper() {\n  keepEverything();\n}\n";
  const result = rewriteCashflowHandlers(prefix+functions+suffix);
  assert.ok(result.startsWith(prefix)); assert.ok(result.endsWith(suffix));
  for (const provider of Object.values(handlers)) assert.ok(result.includes(`return cashflowMailRun_('${provider}');`));
  assert.equal(rewriteCashflowHandlers(result),result);
});

test('missing or duplicate importer declarations reject preparation before producing output', () => {
  assert.throws(()=>rewriteCashflowHandlers('function importGrabReports() {\n}\n'),/Expected exactly one/);
  const source=Object.keys(handlers).map(name=>`function ${name}() {\n}\n`).join('');
  assert.throws(()=>rewriteCashflowHandlers(source+source),/Expected exactly one/);
});
