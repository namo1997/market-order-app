import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const handlers = Object.freeze({ importGrabReports:'grab', importKplusShopReports:'kplus', importScbBusinessAnywhereReports:'scb', importKrungsriReports:'krungsri', importKrungthaiBusinessReports:'krungthai' });
export function rewriteCashflowHandlers(source) {
  let output = source;
  for (const [name, provider] of Object.entries(handlers)) {
    const pattern = new RegExp('^function ' + name + '\\(\\) \\{[\\s\\S]*?^\\}', 'gm');
    assert.equal([...output.matchAll(pattern)].length, 1, `Expected exactly one ${name} declaration`);
    output = output.replace(pattern, `function ${name}() {\n  return cashflowMailRun_('${provider}');\n}`);
  }
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {assertSSDPath} = await import('/Users/surachart/.solao-tools/ssd-workspace.mjs');
  const output = assertSSDPath(process.argv[3]);
  const source = await fs.readFile(process.argv[2], 'utf8');
  await fs.writeFile(output, rewriteCashflowHandlers(source), { mode:0o600, flag:'wx' });
  console.log(JSON.stringify({ handlers:5, output, credentialsPrinted:false }));
}
