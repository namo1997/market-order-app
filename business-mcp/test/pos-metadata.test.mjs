import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPosMetadataConfig,readPosMetadata} from '../src/pos-metadata.mjs';
import {createService} from '../src/service.mjs';
import {createBusinessServer} from '../src/server.mjs';
import {createMcpHandler} from '@modelcontextprotocol/server';
const env={BUSINESS_POS_METADATA_ENABLED:'true',BUSINESS_POS_METADATA_CLIENT_NAME:'owner',BUSINESS_POS_METADATA_CLICKHOUSE_HOST:'example.invalid',BUSINESS_POS_METADATA_CLICKHOUSE_PORT:'8443',BUSINESS_POS_METADATA_CLICKHOUSE_SECURE:'true',BUSINESS_POS_METADATA_CLICKHOUSE_DATABASE:'fixture',BUSINESS_POS_METADATA_CLICKHOUSE_USER:'fixture-user',BUSINESS_POS_METADATA_CLICKHOUSE_PASSWORD:'fixture-secret'};
const client={name:'owner',branches:['KK']};
const binding=loadPosMetadataConfig(env,[client]);
function fixture() {
  const calls=[];
  const query=async(b,sql,params)=>{
    calls.push({b,sql,params});
    if(sql.includes('system.columns'))return [{table:'doc',name:'docno',type:'String',sample:'do-not-print'},{table:'other_table',name:'phone',type:'String'}];
    if(sql.includes('system.tables'))return [{name:'doc',engine:'ReplacingMergeTree',sorting_key:'shopid,docno',primary_key:'shopid,docno',endpoint:'do-not-print'}];
    if(sql.includes('getSetting'))return [{readonly:1}];
    if(sql.includes('system.grants'))return [{access_type:'SELECT',is_partial_revoke:0,user_name:'do-not-print',database:'private-other-db'},{access_type:'INSERT',is_partial_revoke:0}];
    if(sql.includes('system.role_grants'))return [{n:'2',granted_role_name:'do-not-print'}];
    throw new Error('Unexpected SQL');
  };return {query,calls};
}
test('metadata binding is default closed, operator-specific and separate from POS data',()=>{
  assert.equal(loadPosMetadataConfig({},[client]),null);
  assert.equal(loadPosMetadataConfig({...env,BUSINESS_POS_METADATA_CLIENT_NAME:'unknown'},[client]).clientName,null);
  assert.equal(loadPosMetadataConfig({...env,BUSINESS_POS_METADATA_CLICKHOUSE_HOST:'evil/path'},[client]).configurationError,'METADATA_BINDING_INCOMPLETE');
  assert.equal(binding.transportHttps,true);
  assert.equal(loadPosMetadataConfig({...env,BUSINESS_POS_METADATA_CLICKHOUSE_SECURE:'false'},[client]).transportHttps,false);
});
test('diagnostic executes only fixed metadata SELECTs and publishes schemas/summary rather than credentials/raw grants',async()=>{
  const f=fixture();const result=await readPosMetadata(binding,f.query);
  assert.equal(result.status,'OK');assert.equal(result.reader_eligibility,'UNVERIFIED');assert.equal(result.business_rows_requested,false);
  assert.deepEqual(result.columns,[{table:'doc',name:'docno',type:'String'}]);assert.equal(result.session_readonly,1);
  assert.equal(result.grant_review.direct_non_read_grant_observed,true);assert.equal(result.grant_review.inherited_role_count,2);assert.equal(result.grant_review.effective_grants_verified,false);
  const raw=JSON.stringify(result);for(const value of ['fixture-secret','fixture-user','example.invalid','private-other-db','do-not-print','INSERT'])assert.ok(!raw.includes(value));
  assert.equal(f.calls.length,5);assert.ok(f.calls.every(c=>c.sql.startsWith('SELECT ')&&(c.sql.includes('system.')||c.sql.includes('getSetting'))));
});
test('unavailable privilege metadata stays partial and never authorizes table reads',async()=>{
  const f=fixture();const result=await readPosMetadata(binding,async(b,sql,p)=>{if(sql.includes('system.grants'))throw new Error('credential and URL must not print');return f.query(b,sql,p);});
  assert.equal(result.status,'PARTIAL');assert.equal(result.grant_review.direct_select_observed,null);assert.equal(result.reader_eligibility,'UNVERIFIED');assert.deepEqual(result.missing_coverage,[{check:'direct_grants',reason:'METADATA_READ_FAILED'}]);
});
test('existing describe_sources signature triggers diagnostic only for authenticated configured operator; POS detail remains closed',async()=>{
  const f=fixture();const config={branches:[{code:'KK'}],posMetadata:binding};
  const other=createService(config,{name:'other',branches:['KK']},{queryPos:f.query});
  assert.equal((await other.describe()).pos_connection,undefined);assert.equal(f.calls.length,0);
  const bad=createService({...config,posMetadata:{clientName:'owner',configurationError:'METADATA_BINDING_INCOMPLETE'}},client,{queryPos:f.query});assert.equal((await bad.describe()).pos_connection.status,'UNAVAILABLE');assert.equal(f.calls.length,0);
  const service=createService(config,client,{queryPos:f.query});
  assert.equal((await service.describe()).pos_connection.status,'OK');
  await assert.rejects(service.posList({branch:'KK',from:'2026-10-07',to:'2026-10-07'}),/outside client scope/);
  const handler=createMcpHandler(()=>createBusinessServer(config,client,{queryPos:f.query}),{responseMode:'json'});
  const send=async(id,method,params)=>{
    const r=await handler.fetch(new Request('https://example.invalid/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})}));const text=await r.text();return JSON.parse((r.headers.get('content-type')||'').includes('text/event-stream')?text.split('\n').filter(x=>x.startsWith('data:')).at(-1).slice(5):text);
  };
  try {await send(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});const result=await send(2,'tools/call',{name:'business_describe_sources',arguments:{}});assert.equal(result.result.structuredContent.pos_connection.read_only,true);}finally{await handler.close();}
});
