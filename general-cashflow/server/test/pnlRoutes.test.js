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
 const calls=[];const audits=[];let committed=0;let rolledBack=0;
 const old={id:1,month_start:'2026-10-01',branch_id:null,category_code:'OTHER',description:'เก่า',amount:'10.00'};
 const connection={release(){},async beginTransaction(){calls.push(['BEGIN']);},async commit(){committed++;},async rollback(){rolledBack++;},async query(sql,args){calls.push([sql,args]);
 if(sql.startsWith('SELECT code'))return [[{code:'OTHER'}]];
 if(sql.includes('SELECT * FROM pnl_manual_expenses'))return [[old]];
 if(sql.includes('SELECT * FROM pnl_expense_items'))return [[{stable_key:'bill:1',supplier_name:'ร้าน ทดสอบ'}]];
 if(sql.includes('SELECT * FROM pnl_item_overrides'))return [[{stable_key:'bill:1',category_code:null,excluded:null}]];
 if(sql.includes('SELECT * FROM pnl_category_rules'))return [[{id:1,match_field:'supplier',pattern:'ทดสอบ',category_code:'OTHER'}]];
 if(sql.startsWith('SELECT id FROM pnl_category_rules'))return [[]];
 if(sql.startsWith('INSERT'))return [{insertId:1}];
 return [[]];}};
 const pool={...connection,async getConnection(){return connection;}};
 const h=await start({getPool:()=>pool,logAudit:async(args)=>{assert.equal(args.connection,connection);audits.push(args);}});
 try{const payload={month:'2026-10',category_code:'OTHER',description:'ค่าเช่า',amount:'20.25'};
 for(const [method,path,body]of [['POST','/manual-expenses',payload],['PUT','/manual-expenses/1',payload],['DELETE','/manual-expenses/1'],['POST','/rules',{match_field:'supplier',pattern:'ร้าน ทดสอบ',category_code:'OTHER'}],['DELETE','/rules/1'],['PUT','/items/bill%3A1/override',{category_code:'OTHER',excluded:false,create_rule:'supplier'}]])assert.equal((await h.call(method,path,body)).status,200);
 assert.equal(committed,6);assert.equal(rolledBack,0);assert.equal(audits.length,7);
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
