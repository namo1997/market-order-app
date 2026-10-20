import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {fileURLToPath} from 'node:url';
import {loadApp} from './app.mjs';
import {seed} from './seed.mjs';
const server=fileURLToPath(new URL('../server',import.meta.url));
function request(app,url,body,session){return new Promise((resolve,reject)=>{
  const req=new IncomingMessage(new Socket());req.method=body===undefined?'GET':'POST';req.url=url;
  const data=body===undefined?'':JSON.stringify(body);req.headers={'content-type':'application/json','content-length':Buffer.byteLength(data),...(session?{authorization:`Bearer ${session}`}:{})};
  const res=new ServerResponse(req);res.end=chunk=>{try{resolve({status:res.statusCode,body:JSON.parse(String(chunk))});}catch(e){reject(e);}return res;};
  app.handle(req,res,reject);req.push(data);req.push(null);
});}

test('D7 SYNTHETIC seed profiles create active accounting user without changing real auth/schema fixtures',async()=>{
  for(const profile of ['default','jae-waew','ice-vic']){
    const queries=[];const pool={query:async(sql,args=[])=>{queries.push({sql,args});return [{insertId:1}];}};
    const noop=async()=>{};
    const result=await seed(server,pool,{order:{ensureOrderReceivingColumns:noop},inventory:{ensureInventoryTables:noop},schema:{ensureReceivingDocumentsTables:noop},ocr:{buildSupplierKey:()=> 'pg:1',normalizeMatchText:s=>s}},{profile,date:'2026-10-18'});
    assert.equal(result.label,'SYNTHETIC');assert.equal(result.users,3);assert.equal(result.departments,3);
    assert.ok(queries.some(q=>q.sql.startsWith('INSERT INTO users (id,department_id,name,role)')&&q.args[0]==='SYNTHETIC บัญชี'&&q.args[1]==='accounting'));
    assert.match(queries.find(q=>q.sql.includes('CREATE TABLE IF NOT EXISTS users (')).sql,/role VARCHAR\(30\).*is_active BOOLEAN/);
  }
});

test('D7 pilot login cannot spoof roles; accounting reaches admin and issues routers, staff still denied admin; session required',async()=>{
  const queries=[];
  const pool={async query(sql,args=[]){queries.push(sql);
    if(sql.startsWith('SELECT u.id'))return [[{id:args[0],department_id:args[0],branch_id:args[0]===3?1:args[0],name:'SYNTHETIC test'}]];
    if(sql.startsWith('CREATE TABLE'))return [{}];
    return [[]];
  }};
  const {app}=await loadApp(server,pool);
  const accounting=await request(app,'/api/auth/login',{departmentId:3,role:'admin'});assert.equal(accounting.status,200);assert.equal(accounting.body.data.user.role,'accounting');assert.equal(accounting.body.data.user.branch_id,1);
  const session=accounting.body.data.token;assert.equal((await request(app,'/api/auth/me',undefined,session)).body.data.role,'accounting');
  for(const path of ['/api/receiving-admin','/api/receiving-issues']){
    const result=await request(app,path,undefined,session);assert.equal(result.status,200,path);
    assert.equal((await request(app,path)).status,401);
  }
  const staff=await request(app,'/api/auth/login',{departmentId:1,role:'accounting'});assert.equal(staff.body.data.user.role,'user');
  assert.equal((await request(app,'/api/receiving-admin',undefined,staff.body.data.token)).status,403);
  assert.equal((await request(app,'/api/auth/login',{departmentId:999,role:'accounting'})).status,422);
});
