// Generate a local-only, synthetic API browser fixture. All outputs stay on SSD.
// node tests/receiving-device-r3.browser.mjs <absolute SSD output directory>
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
    const lines = Array.from({length:10}, (_, i) => ({id:i+1,line_no:i+1,product_id:i+1,order_item_id:i+1,
      product_name:'ผักทดสอบ '+(i+1),bill_text:'ผักทดสอบ '+(i+1),unit_text:'กก.',quantity_received:'0.2',quantity_billed:'0.2',unit_price:'10',amount:'2',match:{source:'order'}}));
    const group = {supplier_key:'pg:1',supplier_name:'ร้านทดสอบ',items:lines.map(line => ({order_item_id:line.id,product_id:line.id,product_name:line.product_name,quantity_ordered:'0.2',received_quantity:'0',unit_name:'กก.'}))};
    const initial = {id:5,status:'draft',kind:'bill',supplier_name_text:'ร้านทดสอบ',delivery_date:'2026-10-16',
      receiver_name:'ผู้รับทดสอบ',receiver_user_id:1,created_at:'2026-10-16T01:00:00+07:00',total:'20',discount:'0',vat:'0',has_receiver_signature:false,images:[{id:1,page_no:1}],lines:params.has('zero')?[]:lines,
      ocr:{status:'done',warnings:code==='none'?[]:[code]},warnings:lines.map(line=>({code:'LOW_CONFIDENCE',line_no:line.line_no}))};
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
    const app = params.has('overview') ? <Receiving/> : <div className="solao rc-app sg-with-bar" data-motion="reduce" lang="th"><main className="rc-main rc-stack"><DocumentEditor initialDocument={initial} user={user}
      onBack={()=>{window.fixtureBack=true;}} onChanged={()=>{}}/></main></div>;
    createRoot(document.getElementById('root')).render(app);
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
await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receiving device UX R3 — synthetic</title><link rel="stylesheet" href="fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="fixture.js"></script></html>');
console.log(path.join(output, 'index.html'));
