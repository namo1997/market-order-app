// เชื่อมข้อมูลจริงในสำเนากับใบสั่งจำลองเท่านั้น ไม่เรียกระบบสั่งของ Production
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {storage} from './ssd-storage.mjs';
import {case3972Lines} from './invoice-case-fixture.mjs';
storage.assertSSD();assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');
const token='invoice-order-local-fixture-only';
const mock=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||url.pathname!=='/api/bill-order-reference/lines'||req.headers['x-bill-order-reference-token']!==token){res.writeHead(401);res.end();return;}
  const date=url.searchParams.get('date'),branch_id=Number(url.searchParams.get('branch_id'));
  const lines=case3972Lines.slice(0,10).map((row,i)=>({order_source:'orders',order_id:90001,order_number:'ใบสั่งจำลอง-90001',order_item_id:91000+i,order_date:date,branch_id,branch_name:'คันคลอง',product_id:92000+i,product_code:`SIM-${i+1}`,product_name:row.description,supplier_item_id:null,barcode:null,ordered_quantity:row.quantity,unit:'EACH'}));
  lines.push({...lines[0],order_id:90002,order_number:'ใบสั่งจำลอง-90002',order_item_id:91999});
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,data:{scope:{date,branch_id},complete:true,truncated:false,lines,simulated:true}}));
});mock.listen(0,'127.0.0.1');await once(mock,'listening');
const child=spawn(process.execPath,['scripts/expense-real-week-preview.mjs',process.argv[2]],{cwd:process.cwd(),env:{...process.env,BILL_ORDER_REFERENCE_BASE_URL:`http://127.0.0.1:${mock.address().port}`,BILL_ORDER_REFERENCE_TOKEN:token,BILL_ORDER_REFERENCE_BRANCH_MAP:'{"คันคลอง":3}'},stdio:['ignore','pipe','inherit']});
let buffer='',seeded=false;
child.stdout.on('data',chunk=>{buffer+=chunk;const parts=buffer.split('\n');buffer=parts.pop();for(const entry of parts){try{const r=JSON.parse(entry);if(r.report&&!seeded){seeded=true;const seed=spawn(process.execPath,['scripts/invoice-preview-seed.mjs',r.report],{cwd:process.cwd(),env:process.env,stdio:['ignore','inherit','inherit']});seed.on('exit',code=>{if(code)child.kill();else console.log(JSON.stringify({...r,simulated_order_reference:true,case_url:r.base_url+'/admin?view=day&date=2026-09-29&group=C92c8a7b4a5099db619f6464e10eefab5&bucket=done&item=3970'}));});}}catch{process.stdout.write(entry+'\n');}}});
process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGTERM'));await once(child,'exit');mock.close();
