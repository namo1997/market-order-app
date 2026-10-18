import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as store from '../src/models/receiving-issues-store.js';
import * as schema from '../src/models/receiving-issues-schema.js';
import * as queue from '../src/models/receiving-queue-schema.js';
import * as errors from '../src/services/receiving-ocr.service.js';
import {issueDb} from './helpers/receiving-issues-db.mjs';
import {makeJpegDataUrl} from './helpers/receiving-fake-db.mjs';
const staff={id:12,role:'user',branch_id:1,department_id:10};const manager={...staff,role:'accounting'};
async function harness(){
  const {db,state}=issueDb();const context=vm.createContext({console,Date});const retained=[];
  const synth=values=>{const m=new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});retained.push(m);return m;};
  const controller=new vm.SourceTextModule(await readFile(new URL('../src/controllers/receiving-issues.controller.js',import.meta.url),'utf8'),{context});
  await controller.link(name=>{
    if(name.endsWith('/database.js'))return synth({default:db});
    if(name.endsWith('/receiving-documents-helpers.js'))return synth({resolveActorScope:async(_,user)=>({branchId:user.branch_id,departmentId:user.department_id})});
    if(name.endsWith('/receiving-issues-schema.js'))return synth(schema);
    if(name.endsWith('/receiving-queue-schema.js'))return synth(queue);
    if(name.endsWith('/receiving-issues-store.js'))return synth(store);
    if(name.endsWith('/receiving-ocr.service.js'))return synth(errors);
    throw Error(name);
  });await controller.evaluate();
  const auth=new vm.SourceTextModule(await readFile(new URL('../src/middleware/auth.js',import.meta.url),'utf8'),{context});
  await auth.link(()=>synth({verifyToken:()=>{throw Error('invalid/expired');}}));await auth.evaluate();
  const middleware=[],routes=[],parsers=[];const router={use:fn=>middleware.push(fn)};
  for(const verb of ['get','post','put'])router[verb]=(path,...handlers)=>routes.push({verb,path,handlers});
  const routesMod=new vm.SourceTextModule(await readFile(new URL('../src/routes/receiving-issues.routes.js',import.meta.url),'utf8'),{context});
  await routesMod.link(name=>name==='express'?synth({default:{Router:()=>router,json:options=>{parsers.push(options.limit);return ()=>{};}}}):name.endsWith('/auth.js')?auth:controller);await routesMod.evaluate();
  async function invoke(name,{user=staff,body={},params={},query={}}={}){
    const result={status:200,headers:{}};const res={set(k,v){result.headers[k]=v;return this;},status(code){result.status=code;return this;},json(data){result.body=data;return this;},send(data){result.binary=data;return this;}};
    await controller.namespace[name]({user,body,params,query},res);return result;
  }
  return {state,invoke,routes,parsers,middleware,auth,controller,retained};
}
test('all eight issue routes: authenticate 401 missing/invalid/expired before bounded parsing; route-local evidence limit',async()=>{
  const h=await harness();assert.equal(h.middleware[0],h.auth.namespace.authenticate);
  assert.deepEqual(h.routes.map(r=>`${r.verb} ${r.path}`),['get /','get /assignees','get /documents/:documentId','get /:id','get /:id/evidence/:evidenceId','post /:id/evidence','post /','put /:id']);assert.deepEqual(h.parsers,['9mb','16kb','16kb']);
  for(const route of h.routes)for(const authorization of [undefined,'Bearer invalid','Bearer expired']){
    let status,reached=false;h.middleware[0]({headers:{authorization}},{status(code){status=code;return this;},json(){}},()=>{reached=true;});assert.equal(status,401,route.path);assert.equal(reached,false);
  }
});
test('issue controllers: create/list/detail/update/evidence/binary success and 422/403/404/409, private no-store, safe failures',async()=>{
  const h=await harness();const body={client_uuid:'endpoint-fixture-0001',document_id:1,line_id:11,type:'return',quantity:'1',amount:'2'};
  const created=await h.invoke('create',{body});assert.equal(created.status,201);assert.match(created.headers['Cache-Control'],/no-store/);
  assert.equal((await h.invoke('create',{body})).status,200);assert.equal((await h.invoke('create',{body:{...body,quantity:'-1'}})).status,422);
  assert.equal((await h.invoke('create',{body:{...body,document_id:2,line_id:21}})).status,403);
  assert.equal((await h.invoke('create',{body:{...body,document_id:999}})).status,404);
  h.state.docs[0].status='draft';assert.equal((await h.invoke('create',{body})).status,409);h.state.docs[0].status='confirmed';
  assert.equal((await h.invoke('sourceDocument',{params:{documentId:2}})).status,403);assert.equal((await h.invoke('sourceDocument',{user:manager,params:{documentId:2}})).status,200);assert.equal((await h.invoke('sourceDocument',{params:{documentId:999}})).status,404);assert.equal((await h.invoke('sourceDocument',{params:{documentId:'bad'}})).status,422);
  assert.equal((await h.invoke('assignees')).status,403);assert.equal((await h.invoke('assignees',{user:manager})).status,200);
  assert.equal((await h.invoke('list')).body.data.items.length,1);assert.equal((await h.invoke('list',{query:{type:'bad'}})).status,422);assert.equal((await h.invoke('list',{user:{...staff,branch_id:null}})).status,403);
  assert.equal((await h.invoke('detail',{params:{id:1}})).status,200);assert.equal((await h.invoke('detail',{params:{id:999}})).status,404);assert.equal((await h.invoke('detail',{params:{id:'bad'}})).status,422);assert.equal((await h.invoke('detail',{user:{...staff,branch_id:2},params:{id:1}})).status,403);
  const update={version:1,status:'waiting_supplier'};
  assert.equal((await h.invoke('update',{params:{id:1},body:update})).status,403);assert.equal((await h.invoke('update',{user:manager,params:{id:999},body:update})).status,404);
  assert.equal((await h.invoke('update',{user:manager,params:{id:1},body:{...update,status:'bad'}})).status,422);
  assert.equal((await h.invoke('update',{user:manager,params:{id:1},body:update})).status,200);assert.equal((await h.invoke('update',{user:manager,params:{id:1},body:update})).status,409);
  const proof={client_uuid:'endpoint-proof-0001',image_data_url:makeJpegDataUrl(),collector_name:'สมชาย'};
  assert.equal((await h.invoke('attach',{params:{id:1},body:proof})).status,201);assert.equal((await h.invoke('attach',{params:{id:1},body:proof})).status,200);
  assert.equal((await h.invoke('attach',{params:{id:999},body:proof})).status,404);assert.equal((await h.invoke('attach',{user:{...staff,branch_id:2},params:{id:1},body:proof})).status,403);
  assert.equal((await h.invoke('attach',{params:{id:1},body:{...proof,image_data_url:'bad'}})).status,422);
  const image=await h.invoke('binary',{params:{id:1,evidenceId:1}});assert.equal(image.status,200);assert.equal(image.headers['Content-Type'],'image/jpeg');assert.equal(image.headers['X-Content-Type-Options'],'nosniff');assert.ok(image.binary.length);
  assert.equal((await h.invoke('binary',{params:{id:1,evidenceId:999}})).status,404);assert.equal((await h.invoke('binary',{params:{id:1,evidenceId:'bad'}})).status,422);assert.equal((await h.invoke('binary',{user:{...staff,branch_id:2},params:{id:1,evidenceId:1}})).status,403);
  await h.invoke('update',{user:manager,params:{id:1},body:{version:2,status:'resolved',resolution:'returned'}});
  assert.equal((await h.invoke('attach',{params:{id:1},body:{...proof,client_uuid:'closed-proof-0001'}})).status,409);
  h.state.fail='FROM receiving_issues';const failed=await h.invoke('list');assert.equal(failed.status,500);assert.doesNotMatch(JSON.stringify(failed.body),/SQL|secret|stack|base64/);
  for(const [error,expected] of [[{type:'entity.too.large'},413],[{type:'entity.parse.failed'},422],[{code:'ER_NO_SUCH_TABLE'},503],[{code:'ER_DUP_ENTRY'},409]]){
    let code;h.controller.namespace.safeIssueError(error,{status(n){code=n;return this;},json(){}});assert.equal(code,expected);
  }
});
