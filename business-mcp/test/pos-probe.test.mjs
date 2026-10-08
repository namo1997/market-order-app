import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const script=readFileSync(new URL('../scripts/probe-pos-metadata.mjs',import.meta.url),'utf8');
const fixture={CLICKHOUSE_HOST:'example.invalid',CLICKHOUSE_PORT:'8443',CLICKHOUSE_SECURE:'true',CLICKHOUSE_DATABASE:'fixture',CLICKHOUSE_USER:'fixture-read-user',CLICKHOUSE_PASSWORD:'fixture-password-never-output'};
test('operator probe uses existing bound credential solely for fixed metadata GET SELECTs with readonly/resource limits',()=>{
  const harness=`globalThis.fetch=async(url,options)=>{const u=new URL(url);const q=u.searchParams.get('query');if(options.method!=='GET'||u.searchParams.get('readonly')!=='1'||u.searchParams.get('max_execution_time')!=='5'||u.searchParams.get('max_result_rows')!=='1000'||options.redirect!=='error')throw new Error('BAD_REQUEST');if(!q.startsWith('SELECT ')||(!q.includes('system.')&&!q.includes("getSetting('readonly')")))throw new Error('BUSINESS_OR_WRITE_SQL');if(u.toString().includes(process.env.CLICKHOUSE_PASSWORD)||options.headers['X-ClickHouse-Key']!==process.env.CLICKHOUSE_PASSWORD)throw new Error('SECRET_HANDLING');return new Response(JSON.stringify({data:q.includes('system.columns')?[{table:'doc',name:'docno',type:'String'}]:q.includes('system.tables')?[{name:'doc',engine:'ReplacingMergeTree',sorting_key:'shopid,docno',primary_key:'shopid,docno'}]:q.includes('readonly')?[{readonly:1}]:[]}));};\n${script}`;
  const run=spawnSync(process.execPath,['--input-type=module'],{input:harness,encoding:'utf8',env:{...process.env,...fixture}});
  assert.equal(run.status,0);assert.equal(run.stderr,'');const out=JSON.parse(run.stdout);
  assert.equal(out.business_rows_requested,false);assert.equal(out.no_secret_output,true);assert.equal(out.transport_https,true);assert.equal(out.session[0].readonly,1);assert.equal(out.columns[0].type,'String');assert.equal(out.grants_status,'REQUIRES_OWNER_REVIEW_INCLUDING_INHERITED_ROLES');
  for(const value of [fixture.CLICKHOUSE_HOST,fixture.CLICKHOUSE_USER,fixture.CLICKHOUSE_PASSWORD])assert.ok(!run.stdout.includes(value));
});
test('operator probe suppresses upstream error bodies and refuses absent source bindings',()=>{
  const run=spawnSync(process.execPath,['--input-type=module'],{input:`globalThis.fetch=async()=>new Response('secret SQL/password should never print',{status:403});\n${script}`,encoding:'utf8',env:{...process.env,...fixture}});
  assert.equal(run.status,1);const out=JSON.parse(run.stdout);assert.equal(out.columns.reason,'HTTP_403');assert.ok(!run.stdout.includes('secret SQL'));
  const missing=spawnSync(process.execPath,['--input-type=module'],{input:script,encoding:'utf8',env:{CLICKHOUSE_HOST:''}});assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).status,'SOURCE_BINDING_INVALID');
});
