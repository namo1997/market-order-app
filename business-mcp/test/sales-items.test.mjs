import test from 'node:test';
import assert from 'node:assert/strict';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {loadConfig} from '../src/config.mjs';
import {createService} from '../src/service.mjs';
import {createBusinessServer} from '../src/server.mjs';
import {readMarketItems} from '../src/sales-items.mjs';

const config = loadConfig({
  MARKET_ORDER_BASE_URL:'https://market.example',
  BUSINESS_BRANCH_MAP_JSON:JSON.stringify([{code:'KK',market_order_id:1},{code:'SK',market_order_id:3}]),
  BUSINESS_MCP_CLIENTS_JSON:JSON.stringify([{name:'owner',branches:['KK'],min_date:'2026-01-01',max_date:'2026-12-31'}])
});
const client = config.clients[0];
const scope = {branch:'KK',from:'2026-10-08',to:'2026-10-08'};
const item = (barcode, extra={}) => ({barcode,menu_name:'ข้าวผัด',group_name:'อาหาร',total_qty:'2.5',total_revenue:'125.50',...extra});
const service = rows => createService(config,client,{readMarketItems:async()=>({rows,source_limit_reached:rows.length===1000})});

test('item adapter bounds and checks the report scope and drops branch-wide sections', async () => {
  let calls = 0;
  const fakeFetch = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.pathname,'/api/public/reports/sales');
    assert.equal(parsed.searchParams.get('search'),'ข้าวผัด');
    assert.equal(parsed.searchParams.get('branch_id'),'1');
    assert.equal(parsed.searchParams.get('limit'),'1000');
    assert.equal(parsed.searchParams.get('start'),scope.from);
    assert.equal(parsed.searchParams.get('end'),scope.to);
    assert.equal(options.method,'GET');
    return new Response(JSON.stringify({success:true,data:{branch_id:1,start:scope.from,end:scope.to,items:[item('A01')],summary:{total_revenue:99999},daily:[{total_revenue:99999}],prev_items:[item('previous')]}}));
  };
  const result = await readMarketItems(config,config.branches[0],scope.from,scope.to,'ข้าวผัด',fakeFetch);
  assert.deepEqual(Object.keys(result),['rows','source_limit_reached']);
  assert.equal(JSON.stringify(result).includes('99999'),false);
  const malformed = overrides => async () => new Response(JSON.stringify({success:true,data:{branch_id:1,start:scope.from,end:scope.to,items:[],...overrides}}));
  for (const overrides of [{branch_id:3},{start:'2026-10-07'},{end:'2026-10-09'},{items:null}]) {
    await assert.rejects(readMarketItems(config,config.branches[0],scope.from,scope.to,'ข้าวผัด',malformed(overrides)),/scope or shape/);
  }
  await assert.rejects(readMarketItems(config,config.branches[0],scope.from,scope.to,"a' OR 1=1",fakeFetch),/Invalid item search/);
  assert.equal(calls,1);
});

test('search paginates beyond the report top 20 and keeps only fixed item projections', async () => {
  const rows = Array.from({length:31},(_,i)=>item(`A${String(i).padStart(2,'0')}`,{private_note:'not exposed'})).reverse();
  const api = service(rows);
  const first = await api.searchSalesItems({...scope,search:'ข้าว',limit:25});
  assert.equal(first.status,'PARTIAL');
  assert.equal(first.match_count_on_source_slice,31);
  assert.equal(first.search_complete,true);
  assert.equal(first.rows.length,25);
  assert.ok(first.next_cursor);
  const second = await api.searchSalesItems({...scope,search:'ข้าว',limit:25,cursor:first.next_cursor});
  assert.equal(second.status,'OK');
  assert.equal(second.rows.length,6);
  assert.equal(second.rows.at(-1).barcode,'A30');
  assert.equal(second.rows[0].quantity_as_reported,2.5);
  assert.equal(second.rows[0].sales_thb_as_reported,125.5);
  assert.equal(second.next_cursor,null);
  assert.equal(JSON.stringify(second).includes('private_note'),false);
  assert.equal(second.basis,'AS_REPORTED');
  assert.equal(second.freshness,null);
});

test('branch/date scope and unsafe searches are denied before reading the source', async () => {
  let calls = 0;
  const api = createService(config,client,{readMarketItems:async()=>{calls++;throw new Error('unexpected read');}});
  await assert.rejects(api.searchSalesItems({...scope,branch:'SK',search:'ข้าว'}),/outside/);
  await assert.rejects(api.searchSalesItems({...scope,from:'2025-10-08',to:'2025-10-08',search:'ข้าว'}),/Date outside/);
  await assert.rejects(api.readSalesItem({...scope,from:'2026-02-30',barcode:'A01'}),/Invalid calendar/);
  await assert.rejects(api.searchSalesItems({...scope,from:'2026-09-01',search:'ข้าว'}),/0-31 days/);
  for (const search of ["ข้าว'",'ข้าว\\ผัด','ข้าว\nผัด','x',' '.repeat(10),'x'.repeat(129)]) {
    await assert.rejects(api.searchSalesItems({...scope,search}),/Invalid item search/);
  }
  await assert.rejects(api.readSalesItem({...scope,barcode:"A\\'01"}),/Invalid item search/);
  await assert.rejects(api.searchSalesItems({...scope,search:'ข้าว',limit:101}),/page limit/);
  assert.equal(calls,0);
});

test('cursors bind client, dates, search, page size and unchanged source results', async () => {
  const rows = [item('A01'),item('A02')];
  const first = await service(rows).searchSalesItems({...scope,search:'ข้าว',limit:1});
  const page = {...scope,search:'ข้าว',limit:1,cursor:first.next_cursor};
  for (const changed of [{search:'ข้าวผัด'},{from:'2026-10-07'},{limit:2}]) {
    await assert.rejects(service(rows).searchSalesItems({...page,...changed}),/cursor outside/);
  }
  const otherClient = createService(config,{...client,name:'other'},{readMarketItems:async()=>({rows,source_limit_reached:false})});
  await assert.rejects(otherClient.searchSalesItems(page),/cursor outside/);
  await assert.rejects(service([item('A01'),item('A02',{total_revenue:'999'})]).searchSalesItems(page),/changed between pages/);
  await assert.rejects(service(rows).searchSalesItems({...page,cursor:'malformed'}),/Invalid item cursor/);
});

test('exact barcode read does not combine substring neighbors or invent zero for missing/unknown rows', async () => {
  const api = service([item('A01',{total_qty:null,total_revenue:''}),item('A010',{total_revenue:'999'})]);
  const exact = await api.readSalesItem({...scope,barcode:'A01'});
  assert.equal(exact.status,'PARTIAL');
  assert.equal(exact.item.barcode,'A01');
  assert.equal(exact.item.quantity_as_reported,null);
  assert.equal(exact.item.sales_thb_as_reported,null);
  assert.equal(exact.summary,undefined);
  const missing = await service([item('A010')]).readSalesItem({...scope,barcode:'A01'});
  assert.equal(missing.status,'PARTIAL');
  assert.equal(missing.item,null);
  assert.match(missing.missing_coverage[0].reason,/zero sales are not established/);
  const zero = await service([item('A01',{total_qty:0,total_revenue:'0'})]).readSalesItem({...scope,barcode:'A01'});
  assert.equal(zero.status,'OK');
  assert.equal(zero.item.sales_thb_as_reported,0);
});

test('source caps, duplicate/conflicting IDs, wrong matches and malformed amounts are explicit', async () => {
  const capped = await service(Array.from({length:1000},(_,i)=>item(`A${String(i).padStart(4,'0')}`))).searchSalesItems({...scope,search:'ข้าว',limit:100});
  assert.equal(capped.search_complete,false);
  assert.equal(capped.status,'PARTIAL');
  assert.ok(capped.missing_coverage.some(row=>row.limit===1000));
  await assert.rejects(service([item('A01'),item('A01',{total_revenue:999})]).searchSalesItems({...scope,search:'ข้าว'}),/duplicate/);
  await assert.rejects(service([item('A01',{menu_name:'unrelated'})]).searchSalesItems({...scope,search:'ข้าว'}),/outside requested search/);
  for (const total_revenue of [true,{},'NaN','Infinity','12bad']) {
    await assert.rejects(service([item('A01',{total_revenue})]).readSalesItem({...scope,barcode:'A01'}),/Invalid source item amount/);
  }
});

test('source failure stays partial and unknown without leaking upstream errors', async () => {
  const api = createService(config,client,{readMarketItems:async()=>{throw new Error('sensitive upstream response');}});
  const result = await api.searchSalesItems({...scope,search:'ข้าว'});
  assert.equal(result.status,'PARTIAL');
  assert.equal(result.source_status,'UNAVAILABLE');
  assert.equal(result.search_complete,false);
  assert.equal(result.match_count_on_source_slice,null);
  assert.equal(JSON.stringify(result).includes('sensitive'),false);
  const detail = await api.readSalesItem({...scope,barcode:'A01'});
  assert.equal(detail.item,null);
  assert.equal(detail.status,'PARTIAL');
});

test('new tools are read-only and return structured item data through the MCP transport', async t => {
  const handler = createMcpHandler(()=>createBusinessServer(config,client,{readMarketItems:async()=>({rows:[item('A01')],source_limit_reached:false})}),{responseMode:'json'});
  t.after(()=>handler.close());
  const rpc = async (method, params, id) => {
    const response = await handler.fetch(new Request('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}));
    assert.equal(response.status,200);
    const body=await response.text();
    const payload=(response.headers.get('content-type') || '').includes('text/event-stream') ? body.split(/\r?\n/).filter(line=>line.startsWith('data:')).at(-1)?.slice(5).trim() : body;
    return JSON.parse(payload).result;
  };
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'item-test',version:'1'}},1);
  const list = await rpc('tools/list',{},2);
  assert.equal(list.tools.length,17);
  for (const name of ['business_search_sales_items','business_read_sales_item']) {
    assert.equal(list.tools.find(tool=>tool.name===name).annotations.readOnlyHint,true);
  }
  const result = await rpc('tools/call',{name:'business_read_sales_item',arguments:{...scope,barcode:'A01'}},3);
  assert.notEqual(result.isError,true);
  assert.equal(result.structuredContent.item.barcode,'A01');
  assert.equal(result.structuredContent.read_only,true);
  const denied = await rpc('tools/call',{name:'business_read_sales_item',arguments:{...scope,branch:'SK',barcode:'A01'}},4);
  assert.equal(denied.isError,true);
});
