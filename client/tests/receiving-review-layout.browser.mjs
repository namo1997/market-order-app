// Generate a local-only, synthetic API browser fixture. All outputs stay on SSD.
// node tests/receiving-review-layout.browser.mjs <absolute SSD output directory>
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.resolve(process.argv[2] || '');
const root = fileURLToPath(new URL('..', import.meta.url));
if (!output.startsWith('/Volumes/SSD Files/SOLAO/')) throw Error('Browser fixtures must be generated on SSD');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, bundle: true, format: 'iife', jsx: 'automatic', outdir: output,
  entryNames: 'fixture', loader: { '.svg': 'file', '.webp': 'dataurl', '.woff2': 'dataurl' },
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import './src/design/styles.css';
    import './src/pages/receiving/receiving.css';
    import { Receiving } from './src/pages/receiving/Receiving.jsx';
    import { DocumentEditor } from './src/pages/receiving/DocumentEditor.jsx';
    const params = new URLSearchParams(location.search);
    const code = params.get('warning') || 'NOT_A_BILL';
    document.documentElement.dataset.theme = params.get('theme') || 'light';
    document.documentElement.style.fontSize = params.get('scale') === '200' ? '32px' : '16px';
    const lines = Array.from({length:56}, (_, i) => ({id:i+1,line_no:i+1,product_id:i+1,order_item_id:i+1,
      product_name:(i===55?'ผักชีใบเลื่อยปลอดสารพิษ':'ผักทดสอบ')+' '+(i+1),bill_text:'ผักทดสอบ '+(i+1),unit_text:'กก.',quantity_received:'0.2',quantity_billed:'0.2',unit_price:'10',amount:'2',match:{source:'order'}}));
    const group = {supplier_key:'pg:1',supplier_name:'ร้านทดสอบ',items:lines.map(line => ({order_item_id:line.id,product_id:line.id,product_name:line.product_name,quantity_ordered:'0.2',received_quantity:'0',unit_name:'กก.'}))};
    const initial = {id:5,status:'draft',kind:'bill',supplier_name_text:'ร้านทดสอบ',delivery_date:'2026-10-16',
      receiver_name:'ผู้รับทดสอบ',receiver_user_id:1,created_at:'2026-10-16T01:00:00+07:00',total:'112',discount:'0',vat:'0',has_receiver_signature:false,images:[{id:1,page_no:1}],lines:params.has('zero')?[]:lines,
      ocr:{status:'done',warnings:code==='none'?[]:[code]},warnings:params.has('warnings')?[{code:'LOW_CONFIDENCE',line_no:3}]:[]};
    window.fixtureDocument = initial;
    window.fixtureCalls = [];
    window.fixtureApi = {
      expected:async()=>[group], list:async()=>[initial,{...initial,id:6,status:'confirmed'},{...initial,id:7,status:'void'}],
      get:async(id)=>{window.fixtureCalls.push(['get',id]);return {...window.fixtureDocument,id};},
      update:async(id,body)=>{window.fixtureCalls.push(['update',id]);return window.fixtureDocument={...window.fixtureDocument,...body};},
      signature:async(id)=>{window.fixtureCalls.push(['signature',id]);window.fixtureDocument={...window.fixtureDocument,has_receiver_signature:true};},
      confirm:async(id)=>{window.fixtureCalls.push(['confirm',id]);return window.fixtureDocument={...window.fixtureDocument,status:'confirmed',confirmed_at:'2026-10-16T01:00:00+07:00'};},
      image:async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="white"/><text x="16" y="40" font-size="20">SYNTHETIC BILL</text><path d="M16 80H224M16 120H224M16 160H224M16 200H224M16 240H224" stroke="#1e3168"/></svg>'],{type:'image/svg+xml'}), ocr:async()=>window.fixtureDocument,
    };
    const user = {id:1,name:'ผู้รับทดสอบ',role:'receiver',branch_id:1,department_id:1};
    const app = params.has('overview') ? <Receiving/> : <div className="solao rc-app sg-with-bar" data-motion="reduce" lang="th" style={{'--sg-safe-bottom':params.get('safe')==='yes'?'24px':'0px'}}><main className="rc-main rc-stack"><DocumentEditor initialDocument={initial} user={user}
      onBack={()=>{window.fixtureBack=true;}} onChanged={()=>{}}/></main></div>;
    createRoot(document.getElementById('root')).render(app);
    const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.runReviewLayoutChecks=async()=>{
      const checks=[]; const check=(ok,message)=>{checks.push({ok:!!ok,message});if(!ok)throw Error(message);};
      const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
      const rect=el=>el.getBoundingClientRect();
      const step=document.querySelector('input[value="lines"]');step.click();await tick();
      check(document.querySelectorAll('.rc-compact-item').length===56,'56 compact rows render without automatic acceptance');
      check(!document.querySelector('.rc-bulk-check input:checked'),'nothing preselected');
      check(button('ค้างตรวจ 56').getAttribute('aria-pressed')==='true','needs filter is default');
      const root=document.querySelector('.rc-document');
      check(document.documentElement.scrollWidth<=innerWidth,'no page horizontal overflow');
      for(const el of document.querySelectorAll('.rc-bulk-check'))check(rect(el).width>=48&&rect(el).height>=48,'checkbox target >=48px');
      for(const el of document.querySelectorAll('.rc-inline-number input'))check(rect(el).height>=48,'quantity target >=48px');
      const last=document.querySelector('.rc-compact-item:last-child');
      window.scrollTo(0,document.documentElement.scrollHeight);await tick();
      let bar=document.querySelector('.sg-bar:not(.sg-bar-inline)');
      check(rect(last).bottom<=rect(bar).top,'last row clears normal bar at end of scroll');
      check(rect(document.querySelector('.rc-review-toolbar')).top>=0,'review helper remains in viewport');
      check(rect(document.querySelector('.rc-review-toolbar')).bottom<rect(bar).top,'review helper does not cover bottom action');
      const metrics={width:innerWidth,scale:document.documentElement.style.fontSize,lastBottom:rect(last).bottom,barTop:rect(bar).top,barHeight:rect(bar).height,firstRowHeight:rect(document.querySelector('.rc-compact-item')).height};
      document.querySelector('#line-0-review').click();document.querySelector('#line-1-review').click();await tick();
      bar=document.querySelector('.rc-bulk-bar');
      check(!!bar,'explicit selection reveals bulk actions');
      check(Math.abs(parseFloat(getComputedStyle(root).getPropertyValue('--rc-bar-height'))-rect(bar).height)<2,'reserve measured bulk bar height');
      window.scrollTo(0,document.documentElement.scrollHeight);await tick();
      check(rect(last).bottom<=rect(bar).top,'last row clears wrapped bulk bar');
      for(const el of bar.querySelectorAll('button'))check(rect(el).height>=48&&rect(el).width>=48,'bulk target >=48px');
      button('ยังไม่รับ (0)').click();await tick();
      check(document.querySelector('dialog[open]').textContent.includes('0.2 → 0'),'bulk preview shows actual before and after');
      check(document.querySelector('.rc-review-counts').textContent.includes('ตรวจแล้ว 0/56'),'preview does not acknowledge');
      button('ยืนยันค่าที่เลือก').click();await tick();
      check(document.querySelector('.rc-review-counts').textContent.includes('ตรวจแล้ว 2/56'),'only confirmed rows reviewed');
      button('ย้อนกลับ').click();await tick();
      check(document.querySelector('.rc-review-counts').textContent.includes('ตรวจแล้ว 0/56'),'undo restores pending reviews');
      check(document.querySelector('#line-0-inline').value==='0.2','undo restores quantity');
      check(window.fixtureCalls.length===0,'review is local until explicit API save');
      window.scrollTo(0,0);await tick();
      return window.reviewLayoutResult={checks,metrics,pass:checks.filter(item=>item.ok).length,fail:checks.filter(item=>!item.ok).length};
    };

  ` },
  plugins: [{ name: 'r3-synthetic-surfaces', setup(builder) {
    builder.onResolve({ filter: /^\/fonts\// }, args => ({ path: path.join(root, 'public', args.path) }));
    builder.onResolve({ filter: /\/api\/|AuthContext|react-router-dom/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.includes('AuthContext')
      ? 'export const useAuth=()=>({user:{id:1,name:"ผู้รับทดสอบ",role:"receiver",branch_id:1,department_id:1,branch:"สาขาทดสอบ",department:"ครัว"},isAdmin:false});'
      : args.path.includes('react-router-dom') ? 'export const Link="a";'
        : 'export const receivingDocumentsAPI=new Proxy({}, {get:(_,key)=>(...args)=>window.fixtureApi[key](...args)}); export const masterAPI={}; export const productsAPI={getProducts:async()=>({data:[]})};' }));
  } }],
});
await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receiving review — 56 synthetic lines</title><link rel="stylesheet" href="fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="fixture.js"></script></html>');
console.log(path.join(output, 'index.html'));
