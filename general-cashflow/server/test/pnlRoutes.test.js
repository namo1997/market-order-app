import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { authenticate, requirePermission, signToken } from '../src/auth.js';
import { createPnlRouter } from '../src/pnl/routes.js';
const paths=[['GET','/report'],['GET','/items'],['POST','/sync'],['GET','/categories'],['PUT','/items/test/override'],['GET','/rules'],['POST','/rules'],['DELETE','/rules/1'],['GET','/manual-expenses'],['POST','/manual-expenses'],['PUT','/manual-expenses/1'],['DELETE','/manual-expenses/1']];
const start=async(options={})=>{
 const app=express();app.use(express.json());app.use('/api/pnl',createPnlRouter({getPool:()=>{throw new Error('Unexpected DB access');},config:{},authenticate,requirePermission,logAudit:async()=>{},...options}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const call=async(method,path,body,role='admin')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/pnl${path}`,{method,headers:{Authorization:`Bearer ${signToken({id:1,role})}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 return {call,close:()=>new Promise(resolve=>server.close(resolve))};
};
test('cashier/auditor/recorder get 403 on every P&L route before any DB access',async()=>{
 const h=await start();try{for(const role of ['cashier','auditor','recorder'])for(const [method,path]of paths){const response=await h.call(method,path,method==='GET'?null:{},role);assert.equal(response.status,403,`${role} ${method} ${path}`);}}finally{await h.close();}
});
test('admin validation responds 422 and absent integration responds 503 without secret errors',async()=>{
 const connection={query:async(sql)=>{if(sql.includes('pnl_categories'))return [[{code:'OTHER'}]];return [[]];},release(){}};
 const pool={...connection,async getConnection(){return connection;}};
 const h=await start({getPool:()=>pool});try{
 for(const [method,path,body]of [
 ['GET','/report?month=2026-13'],['GET','/items?month=no'],['POST','/sync',{month:'2026-00'}],
 ['PUT','/items/key/override',{excluded:'true'}],['PUT','/items/key/override',{create_rule:'wrong'}],
 ['POST','/rules',{match_field:'wrong'}],
 ['POST','/manual-expenses',{month:'2026-10',category_code:'OTHER',description:'ค่าเช่า',amount:'1.001'}],
 ['PUT','/manual-expenses/1',{month:'2026-10',category_code:'OTHER',description:'ค่าเช่า',amount:0}],
 ['POST','/manual-expenses',{month:'2026-10',category_code:'OTHER',description:'ค่าเช่า',amount:'1.00',branch_id:'x'}]
 ])assert.equal((await h.call(method,path,body)).status,422,`${method} ${path}`);
 assert.equal((await h.call('POST','/sync',{month:'2026-10'})).body.code,'PNL_NOT_CONFIGURED');
 }finally{await h.close();}
});
test('manual CRUD and rule/override writes audit before/after in same transaction; delete is soft',async()=>{
 const calls=[];const audits=[];let committed=0;let rolledBack=0;let ruleExists=false;
 const old={id:1,month_start:'2026-10-01',branch_id:null,category_code:'OTHER',description:'เก่า',amount:'10.00'};
 const connection={release(){},async beginTransaction(){calls.push(['BEGIN']);},async commit(){committed++;},async rollback(){rolledBack++;},async query(sql,args){calls.push([sql,args]);
 if(sql.startsWith('SELECT code'))return [[{code:'OTHER'}]];
 if(sql.includes('SELECT * FROM pnl_manual_expenses'))return [[old]];
 if(sql.includes('SELECT * FROM pnl_expense_items'))return [[{id:42,stable_key:'bill:1',supplier_name:'ร้าน ทดสอบ'}]];
 if(sql.includes('SELECT * FROM pnl_item_overrides'))return [[{stable_key:'bill:1',category_code:null,excluded:null}]];
 if(sql.includes('SELECT * FROM pnl_category_rules')) { if(sql.includes('match_field') && sql.includes('FOR UPDATE') && !ruleExists) {ruleExists=true;return [[]];} return [[{id:1,match_field:'supplier',pattern:'ทดสอบ',category_code:'OTHER'}]]; }
 if(sql.startsWith('SELECT id FROM pnl_category_rules'))return [[]];
 if(sql.startsWith('INSERT'))return [{insertId:1}];
 return [[]];}};
 const pool={...connection,async getConnection(){return connection;}};
 const h=await start({getPool:()=>pool,logAudit:async(args)=>{assert.equal(args.connection,connection);assert.ok(args.entityId == null || Number.isInteger(Number(args.entityId)));audits.push(args);}});
 try{const payload={month:'2026-10',category_code:'OTHER',description:'ค่าเช่า',amount:'20.25'};
 for(const [method,path,body]of [['POST','/manual-expenses',payload],['PUT','/manual-expenses/1',payload],['DELETE','/manual-expenses/1'],['POST','/rules',{match_field:'supplier',pattern:'ร้าน ทดสอบ',category_code:'OTHER'}],['DELETE','/rules/1'],['PUT','/items/bill%3A1/override',{category_code:'OTHER',excluded:false,create_rule:'supplier'}],['PUT','/items/bill%3A1/override',{category_code:'OTHER',create_rule:'supplier'}],['PUT','/items/bill%3A1/override',{excluded:true}]])assert.equal((await h.call(method,path,body)).status,200);
 assert.equal(committed,8);assert.equal(rolledBack,0);assert.equal(audits.length,10);
 assert.equal(audits.at(-1).entityId,42);assert.equal(audits.at(-1).afterPayload.stable_key,'bill:1');
 assert.equal(audits[5].entityId,1);assert.equal(audits[5].beforePayload,undefined);assert.equal(audits[7].entityId,1);assert.equal(audits[7].beforePayload.id,1);
 assert.equal(audits[1].beforePayload.description,'เก่า');assert.equal(audits[1].afterPayload.amount,'20.25');assert.equal(audits[0].actor.role,'admin');
 assert.ok(calls.some(([sql])=>sql.startsWith('UPDATE pnl_manual_expenses SET deleted_at=NOW()')));
 assert.ok(!calls.some(([sql])=>sql.startsWith('DELETE FROM pnl_manual_expenses')));
 }finally{await h.close();}
});

test('production decision guard remains after admin permission and skips reads',async()=>{
 let actions=[];
 const h=await start({decisionReasonRequired:true,requireHumanDecision:key=>(req,res)=>{actions.push(key);res.status(422).json({code:'decision_reason_required'});}});
 try{assert.equal((await h.call('POST','/sync',{month:'2026-10'},'cashier')).status,403);assert.deepEqual(actions,[]);
 assert.equal((await h.call('POST','/sync',{month:'2026-10'})).body.code,'decision_reason_required');
 assert.equal((await h.call('PUT','/manual-expenses/1',{})).status,422);
 assert.deepEqual(actions,['cashflow.post.pnl.sync','cashflow.put.pnl.manual-expenses.:id']);
 assert.equal((await h.call('GET','/report?month=invalid')).body.code,'INVALID_MONTH');
 }finally{await h.close();}
});


test('unexpected MySQL and plain errors are sanitized and safely logged; pnlError remains public',async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try {for(const failure of [Object.assign(new Error('secret SQL token'),{code:'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'}),new Error('private credentials'),Object.assign(new Error('spoof'),{code:'ER_PRIVATE',statusCode:422})]) {
 const h=await start({getPool:()=>({query:async()=>{throw failure;}})});
 try {const r=await h.call('GET','/categories');assert.equal(r.status,500);assert.equal(r.body.code,'PNL_REQUEST_FAILED');assert.equal(r.body.details.code,'PNL_REQUEST_FAILED');assert.ok(!JSON.stringify(r).includes('ER_'));} finally {await h.close();}
 } assert.equal(logs.length,3);assert.ok(!JSON.stringify(logs).includes('secret'));assert.ok(!JSON.stringify(logs).includes('credentials'));
 } finally {console.error=original;}
});
test('sync mutation audit uses the integer run ID',async()=>{
 const audits=[];const connection={release(){},async query(sql){
 if(sql.includes('GET_LOCK'))return [[{acquired:1}]];
 if(sql.startsWith('INSERT INTO pnl_sync_runs'))return [{insertId:7}];
 return [[]];}};
 const h=await start({getPool:()=>({getConnection:async()=>connection}),config:{baseUrl:'https://example.invalid',token:'fixture-only'},fetchImpl:async()=>({ok:true,json:async()=>({success:true,data:[],pagination:{next_offset:null}})}),logAudit:async(args)=>{assert.ok(args.entityId==null||Number.isInteger(Number(args.entityId)));audits.push(args);}});
 try {assert.equal((await h.call('POST','/sync',{month:'2026-09'})).status,200);assert.equal(audits[0].entityId,7);}finally{await h.close();}
});

test('period override API rejects invalid months, normalizes same month, preserves category/exclusion and audits integer IDs',async()=>{
 let stored={stable_key:'bill:1',category_code:'OTHER',excluded:true,note:'เดิม',period_month:null};
 const writes=[],audits=[];let rollbacks=0;
 const connection={release(){},async beginTransaction(){},async commit(){},async rollback(){rollbacks++;},async query(sql,args){
  if(sql.includes('SELECT * FROM pnl_expense_items'))return [[{id:42,stable_key:'bill:1',business_date:'2026-09-05'}]];
  if(sql.includes('SELECT * FROM pnl_item_overrides'))return [[{...stored}]];
  if(sql.startsWith('INSERT INTO pnl_item_overrides')) {writes.push(args);stored={stable_key:args[0],category_code:args[1],excluded:args[2],note:args[3],period_month:args[4]};}
  return [[]];
 }};
 const h=await start({getPool:()=>({getConnection:async()=>connection}),logAudit:async(args)=>audits.push(args)});
 try {
  for(const period_month of ['2026-10','2026-05','2026-13','2026-08-01',false]) {
   const r=await h.call('PUT','/items/bill%3A1/override',{period_month});assert.equal(r.status,422);assert.equal(r.body.code,'INVALID_PERIOD_MONTH');
  }
  assert.equal(writes.length,0);assert.equal(audits.length,0);assert.equal(rollbacks,5);
  for(const [period_month,expected] of [['2026-06','2026-06-01'],['2026-08','2026-08-01'],['2026-09',null],['2026-08','2026-08-01'],[null,null]]) {
   const r=await h.call('PUT','/items/bill%3A1/override',{period_month});assert.equal(r.status,200);assert.equal(r.body.data.period_month,expected);
   assert.equal(stored.category_code,'OTHER');assert.equal(stored.excluded,true);assert.equal(stored.note,'เดิม');
  }
  await h.call('PUT','/items/bill%3A1/override',{period_month:'2026-08'});
  await h.call('PUT','/items/bill%3A1/override',{excluded:false});assert.equal(stored.period_month,'2026-08-01');
  assert.equal(audits.at(-1).entityId,42);assert.equal(audits.at(-1).beforePayload.period_month,'2026-08-01');assert.equal(audits.at(-1).afterPayload.excluded,false);
 } finally {await h.close();}
});
