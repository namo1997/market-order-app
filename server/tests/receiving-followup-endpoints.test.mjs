import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as store from '../src/models/receiving-followups-store.js';
import * as schema from '../src/models/receiving-queue-schema.js';
import * as ocr from '../src/services/receiving-ocr.service.js';
import { queueDb } from './helpers/receiving-queue-db.mjs';

const user = { id:12,name:'ผู้รับ',role:'user',branch_id:1,department_id:10 };
const admin = {...user,role:'admin'};
const g = {supplier_key:'pg:3',supplier_name:'ร้านผัก',branch_id:1,department_id:10,
  items:[{order_item_id:50,product_name:'มะนาว',remaining_quantity:'1.00',due_status:'overdue'}]};
async function controllers() {
  const {db,state} = queueDb(); let groups=[g];
  const context = vm.createContext({console}); const retained=[];
  const synthetic = values => { const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});retained.push(m);return m; };
  const mod = new vm.SourceTextModule(await readFile(new URL('../src/controllers/receiving-followups.controller.js',import.meta.url),'utf8'),{context});
  await mod.link(name => {
    if(name.endsWith('/database.js'))return synthetic({default:db});
    if(name.endsWith('/receiving-documents.model.js'))return synthetic({getExpectedItems:async args => {assert.equal(args.autoFollowup,false); return groups;}});
    if(name.endsWith('/receiving-documents-helpers.js'))return synthetic({resolveActorScope:async (_db,u) => ({branchId:u.branch_id,departmentId:u.department_id,userId:u.id,userName:u.name,isAdmin:['admin','super_admin'].includes(u.role)})});
    if(name.endsWith('/receiving-queue-schema.js'))return synthetic(schema);
    if(name.endsWith('/receiving-followups-store.js'))return synthetic(store);
    if(name.endsWith('/receiving-ocr.service.js'))return synthetic(ocr);
    if(name.endsWith('/receiving-documents.controller.js'))return synthetic({handleReceivingError:(err,res) => res.status(err.statusCode||500).json({success:false,code:err.code||'INTERNAL_ERROR',message:err.statusCode?err.message:'เกิดข้อผิดพลาดภายในระบบ'})});
    throw new Error(name);
  }); await mod.evaluate();
  async function invoke(handler,{actor=user,body={},params={},query={}}={}) {
    const result={status:200};const res={status(code){result.status=code;return this;},json(payload){result.body=payload;return this;}};
    await mod.namespace[handler]({user:actor,body,params,query},res,()=>{});return result;
  }
  return {state,invoke,setGroups:next=>{groups=next;},retained};
}

test('POST followup: trusted pending snapshot, 201/200, optional note, 422, scope 403, missing shop 404',async()=>{
  const h=await controllers();const body={supplier_key:'pg:3',note:'ตามมะนาว',pending_items:[{order_item_id:999}]};
  const first=await h.invoke('create',{body});assert.equal(first.status,201);assert.equal(first.body.data.followup.pending_items[0].order_item_id,50);
  assert.equal(h.state.rows[0].actor_user_id,user.id);
  const repeat=await h.invoke('create',{body});assert.equal(repeat.status,200);assert.equal(repeat.body.data.created,false);assert.equal(repeat.body.data.message,'แจ้งไปแล้ว');
  for(const bad of [{supplier_key:'pg:3 OR 1=1'},{supplier_key:'pg:3',note:'x'.repeat(301)}])assert.equal((await h.invoke('create',{body:bad})).status,422);
  for(const scope of [{branch_id:2},{department_id:20}])assert.equal((await h.invoke('create',{body:{...body,...scope}})).status,403);
  h.setGroups([]);assert.equal((await h.invoke('create',{body})).status,404);
});

test('inbox endpoints: 403 for staff, successful list/update, 404/409/422; lead settings admin only and persisted',async()=>{
  const h=await controllers();await h.invoke('create',{body:{supplier_key:'pg:3'}});
  for(const handler of ['list','update','leads','setLead'])assert.equal((await h.invoke(handler)).status,403);
  assert.equal((await h.invoke('list',{actor:admin,query:{status:'open'}})).body.data.pending_count,1);
  assert.equal((await h.invoke('update',{actor:admin,params:{id:1},body:{status:'acknowledged'}})).status,200);
  assert.equal((await h.invoke('update',{actor:admin,params:{id:1},body:{status:'resolved'}})).status,200);
  assert.equal((await h.invoke('update',{actor:admin,params:{id:1},body:{status:'acknowledged'}})).status,409);
  assert.equal((await h.invoke('update',{actor:admin,params:{id:999},body:{status:'resolved'}})).status,404);
  assert.equal((await h.invoke('update',{actor:admin,params:{id:1},body:{status:'bogus'}})).status,422);
  assert.equal((await h.invoke('list',{actor:admin,query:{status:'bad'}})).status,422);
  assert.equal((await h.invoke('setLead',{actor:admin,params:{supplierKey:'pg:3'},body:{lead_days:2}})).status,200);
  assert.equal((await h.invoke('setLead',{actor:admin,params:{supplierKey:'pg:999'},body:{lead_days:2}})).status,404);
  assert.equal((await h.invoke('leads',{actor:admin})).body.data.items[0].lead_days,2);
  assert.equal((await h.invoke('setLead',{actor:admin,params:{supplierKey:'pg:3'},body:{lead_days:-1}})).status,422);
  assert.equal((await h.invoke('setLead',{actor:{...admin,role:'accounting'},params:{supplierKey:'pg:3'},body:{lead_days:2}})).status,403);
});

test('all followup routes authenticate missing/invalid/expired credentials before 8kb body parsing',async()=>{
  const context=vm.createContext({});const retained=[];
  const synth=values=>{const m=new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});retained.push(m);return m;};
  const auth=new vm.SourceTextModule(await readFile(new URL('../src/middleware/auth.js',import.meta.url),'utf8'),{context});
  await auth.link(()=>synth({verifyToken:()=>{throw new Error('invalid/expired');}}));await auth.evaluate();
  const registered=[];const middleware=[];const router={use:fn=>middleware.push(fn)};
  for(const verb of ['get','post','put','patch'])router[verb]=(path,fn)=>registered.push({verb,path,fn});
  const controller=Object.fromEntries(['leads','setLead','list','create','update','handleReceivingError'].map(k=>[k,()=>{}]));
  const routes=new vm.SourceTextModule(await readFile(new URL('../src/routes/receiving-followups.routes.js',import.meta.url),'utf8'),{context});
  await routes.link(name=>name==='express'?synth({default:{Router:()=>router,json:options=>{assert.equal(options.limit,'8kb');return ()=>{};}}}):name.endsWith('/auth.js')?auth:synth(controller));await routes.evaluate();
  assert.equal(middleware[0],auth.namespace.authenticate);
  assert.deepEqual(registered.map(r=>`${r.verb} ${r.path}`),['get /lead-times','put /lead-times/:supplierKey','get /','post /','patch /:id']);
  for(const route of registered)for(const authorization of [undefined,'Bearer invalid','Bearer expired']){
    let code;let reached=false;
    middleware[0]({headers:{authorization}},{status(value){code=value;return this;},json(){}},()=>{reached=true;});
    assert.equal(code,401,`${route.verb} ${route.path}`);assert.equal(reached,false);
  }
});
