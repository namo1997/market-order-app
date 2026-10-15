// Deterministic, offline review artifact. This is NOT proof of a MySQL import or localhost API.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSnapshot, compileSnapshot } from '../src/ap/snapshot.js';
import { buildApReport } from '../src/ap/report.js';
import { build } from '../../client/node_modules/esbuild/lib/main.js';
import { apOfflineFontPlugin } from '../../client/scripts/apOfflineFonts.js';
const [snapshot, output] = process.argv.slice(2);
if (!output?.startsWith('/Volumes/SSD Files/SOLAO/cashflow/') || !(await fs.realpath(output)).startsWith('/Volumes/SSD Files/SOLAO/cashflow/')) throw new Error('SSD_OUTPUT_REQUIRED');
const bundle = compileSnapshot(await readSnapshot(snapshot), '2026-09');
const reports = Object.fromEntries(['', ...bundle.metadata.branches.map(b=>b.code)].map(branch=>[branch,buildApReport(bundle,{month:'2026-09',branch})]));
await fs.writeFile(path.join(output,'ap-report-from-snapshot.json'),JSON.stringify(reports[''],null,2));
const client = path.resolve(import.meta.dirname,'../../client');
const result = await build({ absWorkingDir: client, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ApLedger from './src/ApLedger.jsx'; const reports = JSON.parse(document.getElementById('ap-data').textContent); const loadReport = async params => { if(params.get('month') !== '2026-09') throw new Error('MONTH_NOT_EXPORTED'); return reports[params.get('branch') || '']; }; createRoot(document.getElementById('root')).render(<ApLedger preview="offline" loadReport={loadReport}/>);`, resolveDir: client, loader:'jsx' }, bundle: true, write: false, format: 'iife', minify:true, outfile:'review.js', jsx:'automatic', loader:{'.woff2':'dataurl'}, plugins:[apOfflineFontPlugin(client)], define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_CASHFLOW_API_URL':'undefined'} });
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text, css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const json=JSON.stringify(reports).replaceAll('<','\\u003c');
await fs.writeFile(path.join(output,'REVIEW.html'),`<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:;"><title>เจ้าหนี้ กันยายน 2569 ตัวอย่างบน SSD</title><style>body{margin:0}${css}</style></head><body><div id="root"></div><script id="ap-data" type="application/json">${json}</script><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`);
console.log(JSON.stringify({ fingerprint:bundle.fingerprint, sources:bundle.sources.length, journals:bundle.journals.length, statements:bundle.statements.length, balance:reports[''].balance, branchRows:reports[''].branchRows }));
