import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPosConfig,createPosReader,queryPos} from '../src/pos.mjs';
import {createService} from '../src/service.mjs';
import {createBusinessServer} from '../src/server.mjs';
import {createMcpHandler} from '@modelcontextprotocol/server';

const binding=loadPosConfig({BUSINESS_POS_CLICKHOUSE_URL:'https://example.invalid/',BUSINESS_POS_CLICKHOUSE_DATABASE:'dedebi',BUSINESS_POS_SHOP_ID:'SHOP',BUSINESS_POS_CLICKHOUSE_USER:'readonly_fixture',BUSINESS_POS_CLICKHOUSE_PASSWORD:'fixture-not-real',BUSINESS_POS_CURSOR_KEY:'fixture-key-not-real-xxxxxxxxxxxxxxxx'});
const required={doc:['shopid','docno','docdatetime','transflag','iscancel','totalamount','branchid','guidbranch','deliverycode','paytype'],docdetail:['shopid','docno','line_number','barcode','itemname','qty','price','sumamount','branchid'],docpayment:['shopid','docno','description','amount','branchid']};
const columns=Object.entries(required).flatMap(([table,names])=>names.map(name=>({table,name,type:'String'})));
const engines=Object.keys(required).map(name=>({name,engine:'ReplacingMergeTree',sorting_key:'fixture',primary_key:'fixture'}));
const branch={code:'KK',clickhouse_branch_id:'BRANCH'};
const period={from:'2026-10-07',to:'2026-10-07'};
const headers=[{shopid:'SHOP',bank_account:'private-fixture-must-not-pass',docno:'R1',instant:'1791306000000000000',totalamount:'10.10',deliverycode:'',paytype:'1'},{shopid:'SHOP',docno:'R2',instant:'1791306100000000000',totalamount:'20.20',deliverycode:'D',paytype:'2'}];
function fixture(options={}) {
  const calls=[];
  const query=async (_b,sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('system.columns')) return options.columns??columns;
    if(sql.includes('system.tables')) return options.engines??engines;
    if(sql.includes('HAVING n>1')) return options.duplicates??[];
    if(sql.startsWith('SELECT count()')) return [{n:options.reused?'2':'1'}];
    if(sql.includes('FROM `dedebi`.docdetail') && !sql.includes(' AS sold_at_bangkok')) return options.lines??[{shopid:'SHOP',docno:'R1',line_number:'1',barcode:'P1',itemname:'fixture',qty:'1.000',price:'10.10',sumamount:'10.10'},{shopid:'SHOP',docno:'R1',line_number:'2',barcode:'P2',itemname:'fixture',qty:'1.000',price:'0.00',sumamount:'0.00'}];
    if(sql.includes('FROM `dedebi`.docpayment') && !sql.includes(' AS sold_at_bangkok')) return [{shopid:'SHOP',docno:'R1',description:'cash',amount:options.changed?'11.10':'10.10'}];
    if(sql.includes('LIMIT 2')) return [{...headers[0],docno:params.docno}];
    return params.after?[headers[1]]:headers;
  };
  return {query,calls,options};
}
test('binding rejects insecure URL and incomplete secrets; missing binding is closed',async()=>{
  assert.throws(()=>loadPosConfig({BUSINESS_POS_CLICKHOUSE_URL:'http://example.invalid/'}),/HTTPS/);
  assert.throws(()=>loadPosConfig({BUSINESS_POS_CLICKHOUSE_URL:'https://example.invalid/'}),/incomplete/);
  await assert.rejects(createPosReader({}).list({limit:1},branch,period,'owner'),/binding missing/);
});
test('GET transport bounds resources, binds malicious values and never leaks upstream body',async()=>{
  const malicious="x' OR 1=1 --";
  await queryPos(binding,'SELECT docno FROM doc WHERE docno={docno:String}',{docno:malicious},async(u,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    const url=new URL(u); assert.equal(url.searchParams.get('readonly'),'1');assert.equal(url.searchParams.get('param_docno'),malicious);
    assert.ok(!url.searchParams.get('query').includes(malicious));assert.ok(!url.toString().includes('fixture-not-real'));
    return new Response(JSON.stringify({data:[]}),{status:200});
  });
  await assert.rejects(queryPos(binding,'SELECT 1',{},async()=>new Response('password secret SQL detail',{status:403})),e=>e.message==='POS upstream HTTP 403');
  await assert.rejects(queryPos(binding,'SELECT 1',{},async()=>new Response('',{headers:{'content-length':'2000001'}})),/too large/);
});
test('header keyset pagination preserves source decimals and binds date/branch/time/filter',async()=>{
  const f=fixture();const reader=createPosReader({pos:binding},f.query);
  const input={limit:1,time_from:'12:00:00',product_barcode:"P'1"};
  const first=await reader.list(input,branch,period,'owner');
  assert.equal(first.status,'PARTIAL');assert.equal(first.receipts[0].totalamount,'10.10');assert.equal(first.receipts[0].classification,'UNCLASSIFIED');assert.equal(first.receipts[0].seller,null);
  assert.equal(first.receipts[0].bank_account,undefined);assert.equal(first.receipts[0].discountamount,null);assert.equal(first.source_updated_at,null);assert.equal(first.receipts[0].instant,undefined);
  const second=await reader.list({...input,cursor:first.next_cursor},branch,period,'owner');
  assert.equal(second.receipts[0].docno,'R2');assert.equal(second.next_cursor,null);
  const call=f.calls.at(-1);assert.equal(call.params.branch,'BRANCH');assert.equal(call.params.from,period.from);assert.equal(call.params.product_barcode,"P'1");assert.ok(call.sql.includes('{product_barcode:String}'));assert.ok(call.sql.includes('Asia/Bangkok'));assert.ok(call.sql.includes('FINAL'));assert.ok(call.sql.includes('UInt64'));
  await assert.rejects(reader.list({...input,cursor:first.next_cursor},branch,period,'other-client'),/cursor/);
  await assert.rejects(reader.list({...input,cursor:first.next_cursor},branch,{...period,to:'2026-10-08'},'owner'),/cursor/);
  await assert.rejects(reader.list({...input,cursor:first.next_cursor+'x'},branch,period,'owner'),/cursor/);
});
test('classification remains closed without explicit mapping, valid mapping uses exact raw codes',async()=>{
  const f=fixture(); await assert.rejects(createPosReader({pos:binding},f.query).list({classification:'STOREFRONT'},branch,period,'owner'),/not verified/);
  const mapped={...binding,classification:[{deliverycode:'',paytype:'1',classification:'STOREFRONT',evidence:'operator-reviewed-fixture'}]};
  const result=await createPosReader({pos:mapped},f.query).list({classification:'STOREFRONT'},branch,period,'owner');
  assert.equal(result.receipts[0].classification,'STOREFRONT');assert.equal(result.receipts[1].classification,'UNCLASSIFIED');
  assert.ok(f.calls.at(-1).sql.includes('deliverycode={dc0:String}'));
});
test('schema drift/engines and duplicate IDs fail before misleading data',async()=>{
  for(const options of [{columns:columns.filter(x=>x.name!=='line_number')},{engines:engines.map(x=>({...x,engine:'CollapsingMergeTree'}))},{duplicates:[{docno:'R1',n:2}]}]) {
    const f=fixture(options);await assert.rejects(createPosReader({pos:binding},f.query).list({limit:1},branch,period,'owner'),/schema|ambiguous/);
  }
});
test('receipt detail avoids line/payment multiplication; revision/scope invalidates cursor',async()=>{
  const f=fixture();const reader=createPosReader({pos:binding},f.query);const args={docno:'R1',limit:1};
  const result=await reader.detail(args,branch,period,'owner');
  assert.equal(result.lines.length,1);assert.equal(result.payments.length,1);assert.equal(result.coverage.line_count,2);assert.equal(result.payments[0].amount,'10.10');assert.equal(result.lines[0].shopid,undefined);
  assert.ok(f.calls.every(x=>!x.sql.includes(' JOIN ')));
  const next=await reader.detail({...args,cursor:result.next_cursor},branch,period,'owner');assert.equal(next.lines[0].line_number,'2');assert.equal(next.payments.length,0);assert.equal(next.status,'OK');
  f.options.changed=true;await assert.rejects(reader.detail({...args,cursor:result.next_cursor},branch,period,'owner'),/changed/);
  await assert.rejects(reader.detail({...args,docno:'R2',cursor:result.next_cursor},branch,period,'owner'),/cursor/);
});
test('reused docno and duplicate line identity are rejected; page/time bounds are validated',async()=>{
  for(const options of [{reused:true},{lines:[{line_number:'1'},{line_number:'1'}]}]) {const f=fixture(options);await assert.rejects(createPosReader({pos:binding},f.query).detail({docno:'R1'},branch,period,'owner'),/unsafe|ambiguous/);}
  const reader=createPosReader({pos:binding},fixture().query);
  await assert.rejects(reader.list({limit:101},branch,period,'owner'),/limit/);
  await assert.rejects(reader.list({time_from:'23:00:00',time_to:'01:00:00'},branch,period,'owner'),/midnight/);
});
test('service enforces branch/date/POS permission before source probes',async()=>{
  let calls=0;const config={pos:binding,branches:[branch]};const client={name:'owner',branches:['KK'],min_date:'2026-10-01',max_date:'2026-10-08'};
  const readers={queryPos:async()=>{calls++;throw new Error('unexpected');}};
  const s=createService(config,client,readers);
  await assert.rejects(s.posList({branch:'KK',...period}),/outside client scope/);
  await assert.rejects(s.posList({branch:'SK',...period}),/Branch/);
  await assert.rejects(s.posList({branch:'KK',from:'2026-02-30',to:'2026-03-01'}),/calendar/);
  await assert.rejects(s.posList({branch:'KK',from:'2026-09-30',to:'2026-10-01'}),/Date outside/);assert.equal(calls,0);
});
test('MCP initialize/list/call retains 15 existing tools plus 2 POS tools and read annotations',async()=>{
  const f=fixture();const config={pos:binding,branches:[branch]};const client={name:'owner',branches:['KK'],allow_pos_details:true};
  const handler=createMcpHandler(()=>createBusinessServer(config,client,{queryPos:f.query}),{responseMode:'json'});
  const send=async(id,method,params)=>{
    const response=await handler.fetch(new Request('https://example.invalid/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}));
    const body=await response.text();return JSON.parse(body.startsWith('event:')||body.startsWith('data:')?body.split('\n').filter(x=>x.startsWith('data:')).at(-1).slice(5):body);
  };
  try {
    const init=await send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});assert.equal(init.result.serverInfo.name,'solao-business-mcp');
    const listed=await send(2,'tools/list',{});assert.equal(listed.result.tools.length,17);assert.equal(listed.result.tools.filter(x=>x.name.startsWith('business_hr_')).length,5);assert.ok(listed.result.tools.every(x=>x.annotations.readOnlyHint));
    const args={branch:'KK',...period,limit:1};const result=await send(3,'tools/call',{name:'business_pos_list_receipts',arguments:args});assert.equal(result.result.structuredContent.receipts[0].docno,'R1');
    const detail=await send(4,'tools/call',{name:'business_pos_read_receipt',arguments:{...args,docno:'R1'}});assert.equal(detail.result.structuredContent.lines[0].line_number,'1');
    const denied=await send(5,'tools/call',{name:'business_pos_list_receipts',arguments:{...args,branch:'SK'}});assert.equal(denied.result.isError,true);
    const bad=await send(6,'tools/call',{name:'business_pos_list_receipts',arguments:{...args,limit:101}});assert.ok(bad.error||bad.result?.isError);
  } finally {await handler.close();}
});
