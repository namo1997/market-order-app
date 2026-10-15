// Build a self-contained browser regression harness on SSD, then open index.html.
// No server, credentials, real API or Playwright install is needed.
// node tests/receiving-layout.browser.mjs <absolute SSD output directory>
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.resolve(process.argv[2] || '');
const root = fileURLToPath(new URL('..', import.meta.url));
if (!output.startsWith('/Volumes/SSD Files/SOLAO/')) throw Error('Browser fixtures must be generated on SSD');
await mkdir(output, { recursive: true });

const items = Array.from({ length: 10 }, (_, index) => ({ order_item_id: index + 1, product_id: index + 1,
  product_name: `ผัก ${index + 1}`, quantity_ordered: '20', received_quantity: '0', unit_name: 'กิโลกรัม' }));
const group = { supplier_key: 'pg:1', supplier_name: 'ร้านทดสอบ', items };
await build({
  absWorkingDir: root, bundle: true, format: 'iife', jsx: 'automatic', outdir: output,
  entryNames: 'fixture', loader: { '.svg': 'file', '.webp': 'dataurl', '.woff2': 'dataurl' },
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import './src/design/styles.css';
    import { Receiving } from './src/pages/receiving/Receiving.jsx';
    import { CreateDocument } from './src/pages/receiving/CreateDocument.jsx';
    const params = new URLSearchParams(location.search);
    const kind = params.get('kind');
    const group = ${JSON.stringify(group)};
    const partial = kind === 'create-partial';
    if (partial) group.items[0].received_quantity = '5';
    window.fixtureGroup = group;
    document.documentElement.style.fontSize = params.get('scale') === '125' ? '20px' : '16px';
    document.documentElement.dataset.theme = 'light';
    const app = kind.startsWith('create') ? <div className="solao rc-app" lang="th"><CreateDocument group={group}
      date="2026-10-16" user={{id:1,role:'receiver'}} onClose={() => {}} onCreated={() => {}} /></div> : <Receiving />;
    createRoot(document.getElementById('root')).render(app);
    const frame = () => new Promise(requestAnimationFrame);
    const checks = [];
    const check = (ok, message) => { checks.push({ok:!!ok,message}); };
    const rect = element => element.getBoundingClientRect();
    const textRect = element => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect(); };
    const run = async () => {
      for (let attempt=0; attempt<120 && !document.querySelector(kind.startsWith('create') ? '.rc-check' : '.rc-choice'); attempt++) await frame();
      await document.fonts.ready;
      await frame(); await frame();
      check(document.fonts.check('400 16px "IBM Plex Sans Thai"'), 'local Thai font loaded');
      let metrics = {};
      if (kind.startsWith('create')) {
        const warning = () => [...document.querySelectorAll('.sg-status[data-status="review"]')];
        check(warning().length === (partial ? 1 : 0), 'amber only for a selected partial receipt');
        check(!document.body.textContent.includes('ตรวจยอดคงเหลือ'), 'no unexplained balance badge');
        if (partial) {
          check(warning()[0]?.textContent.includes('เคยรับบางส่วนแล้ว') && warning()[0]?.textContent.includes('ให้ตรวจจำนวนรับจริงเทียบยอดที่ยังขาด'), 'warning states reason and next action');
          const checkbox = document.querySelector('.rc-check input');
          checkbox.click(); await frame(); await frame();
          check(warning().length === 0, 'deselecting the partial item clears warning');
          checkbox.click(); await frame(); await frame();
          check(warning().length === 1, 'reselecting restores warning');
        }
        check(document.querySelector('dialog').open, 'create sheet is open');
      } else {
        if (kind === 'selected') { document.querySelector('.rc-choice input').click(); await frame(); await frame(); }
        const bar = document.querySelector('.rc-receiving-actions');
        const buttons = [...bar.querySelectorAll('button')];
        const options = buttons.find(button => button.getAttribute('aria-label') === 'ตัวเลือก');
        const label = options.querySelector('span');
        const primary = bar.querySelector('.sg-primary');
        const primaryLabel = primary.querySelector('span');
        const bounds = rect(bar), labelBounds = textRect(label);
        check(primary.textContent === (kind === 'selected' ? 'รับจากร้านนี้' : 'สร้างใบรับอิสระ'), 'correct primary action');
        check(getComputedStyle(options).whiteSpace === 'nowrap', 'Thai options never wrap');
        check(rect(label).height <= parseFloat(getComputedStyle(label).lineHeight) + 1, 'options occupy one text line');
        check(rect(options.querySelector('svg')).bottom <= labelBounds.top + 2, 'options label sits below icon');
        check(bounds.height <= (params.get('scale') === '125' ? 120 : 92), 'bar stays compact');
        check(bounds.left >= 0 && bounds.right <= innerWidth, 'bar stays inside viewport');
        for (const [index, button] of buttons.entries()) {
          const box = rect(button);
          check(box.width >= 48 && box.height >= 48, 'touch target ' + index + ' remains at least 48px');
          check(box.left >= bounds.left && box.right <= bounds.right, 'button ' + index + ' stays in bar');
          if (index) check(rect(buttons[index-1]).right <= box.left, 'button ' + index + ' does not overlap');
        }
        for (const [name, element, button] of [['options',label,options],['primary',primaryLabel,primary]]) {
          const text = textRect(element), box = rect(button);
          check(text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom, name + ' text is visible inside its button');
        }
        metrics = { width:innerWidth, barHeight:bounds.height, optionsWidth:rect(options).width,
          labelHeight:labelBounds.height, primaryWidth:rect(primary).width, primaryText:primary.textContent };
      }
      parent.postMessage({type:'receiving-layout-result',id:params.get('id'),checks,metrics}, '*');
    };
    run().catch(error => parent.postMessage({type:'receiving-layout-result',id:params.get('id'),checks:[...checks,{ok:false,message:error.message}]}, '*'));
  ` },
  plugins: [{ name: 'local-receiving-browser-fixture', setup(builder) {
    builder.onResolve({ filter: /^\/fonts\// }, args => ({ path: path.join(root, 'public', args.path) }));
    builder.onResolve({ filter: /\/api\/|AuthContext|react-router-dom/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('AuthContext')
      ? 'export const useAuth=()=>({user:{id:1,role:"receiver",branch_id:1,department_id:1,branch:"สาขาทดสอบ",department:"ครัว"},isAdmin:false});'
      : args.path.includes('react-router-dom') ? 'export const Link="a";'
        : 'export const receivingDocumentsAPI={expected:async()=>[window.fixtureGroup],list:async()=>[]}; export const masterAPI={}; export const productsAPI={};' }));
  } }],
});

const fixture = '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="fixture.js"></script></html>';
await writeFile(path.join(output, 'case.html'), fixture);
const cases = [360, 390, 412].flatMap(width => [100, 125].flatMap(scale => ['home', 'selected'].map(kind => ({ width, scale, kind }))));
cases.push(...[360, 390, 412].flatMap(width => ['create-new', 'create-partial'].map(kind => ({ width, scale: 100, kind }))));
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="th"><meta charset="utf-8"><title>Receiving layout regression</title>
<style>body{font:16px sans-serif;background:#eee}iframe{height:800px;border:1px solid #aaa}article{display:inline-block;vertical-align:top;margin:8px}#summary{position:sticky;top:0;background:white;padding:16px}pre{white-space:pre-wrap}</style>
<h1>Receiving layout regression</h1><p id="summary" role="status">กำลังทดสอบ 18 cases</p><button id="download" disabled>บันทึกผล JSON</button><div id="results"></div><div id="frames"></div>
<script>
const cases=${JSON.stringify(cases)}, results=new Map(), frames=new Map();
for(const [id,item] of cases.entries()){
  const article=document.createElement('article'), label=document.createElement('h2'), frame=document.createElement('iframe');
  label.textContent=id+': '+item.width+'px '+item.kind+' '+item.scale+'%'; frame.width=item.width; frame.title=label.textContent;
  frame.src='case.html?'+new URLSearchParams({...item,id}); frames.set(String(id),frame); article.append(label,frame); document.querySelector('#frames').append(article);
}
window.addEventListener('message',event=>{
  const data=event.data; if(data?.type!=='receiving-layout-result'||frames.get(data.id)?.contentWindow!==event.source)return;
  results.set(data.id,data); const ordered=[...results.values()].sort((a,b)=>Number(a.id)-Number(b.id));
  const failed=ordered.filter(result=>result.checks.some(check=>!check.ok));
  document.querySelector('#summary').textContent=results.size+'/'+cases.length+' cases; pass '+(results.size-failed.length)+'; fail '+failed.length;
  document.querySelector('#results').replaceChildren(...ordered.map(result=>{const row=document.createElement('pre');row.textContent=JSON.stringify({case:cases[result.id],...result},null,2);return row;}));
  window.layoutResults={cases:ordered.length,pass:ordered.length-failed.length,fail:failed.length,results:ordered};
  document.querySelector('#download').disabled=results.size!==cases.length;
});
document.querySelector('#download').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(window.layoutResults,null,2)],{type:'application/json'}));a.download='receiving-layout-results.json';a.click();URL.revokeObjectURL(a.href);};
</script></html>`);
// Record exactly which production source the fixture includes, without touching server/.
await writeFile(path.join(output, 'README.txt'), 'Open index.html in Chrome. All API/auth data is synthetic. 18 cases: 360/390/412px, both primary actions at 100%/125% text, new/partial create sheets.\n' + await readFile(new URL('../src/design/fonts.css', import.meta.url), 'utf8'));
console.log(path.join(output, 'index.html'));
