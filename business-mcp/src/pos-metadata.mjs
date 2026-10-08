import {queryPos} from './pos.mjs';
import {runtimeHashes} from './runtime-hashes.mjs';
const TABLES=['doc','docdetail','docpayment'];
const READ_ACCESS=new Set(['SELECT','SHOW DATABASES','SHOW TABLES','SHOW COLUMNS','SHOW DICTIONARIES']);
const str=value=>typeof value==='string'&&value.length<=1024;

// Diagnostic binding never enables the separate POS data binding or permission.
export function loadPosMetadataConfig(env,clients) {
  if(env.BUSINESS_POS_METADATA_ENABLED!=='true')return null;
  const name=env.BUSINESS_POS_METADATA_CLIENT_NAME;
  if(!clients.some(x=>x.name===name))return {clientName:null,configurationError:'METADATA_OPERATOR_UNAVAILABLE'};
  const get=key=>env[`BUSINESS_POS_METADATA_CLICKHOUSE_${key}`];
  const host=get('HOST'),port=get('PORT'),secure=get('SECURE'),database=get('DATABASE');
  if(!/^[A-Za-z0-9.-]+$/.test(host||'')||!/^\d{1,5}$/.test(port||'')||Number(port)>65535||Number(port)<1||!['true','false'].includes(secure)||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(database||'')||!get('USER')||!get('PASSWORD'))return {clientName:name,configurationError:'METADATA_BINDING_INCOMPLETE'};
  return {clientName:name,url:`${secure==='true'?'https':'http'}://${host}:${port}/`,database,user:get('USER'),password:get('PASSWORD'),transportHttps:secure==='true'};
}

export async function readPosMetadata(binding,query=queryPos) {
  if(binding.configurationError)return {status:'UNAVAILABLE',read_only:true,business_rows_requested:false,reader_eligibility:'UNVERIFIED',runtime_files:await runtimeHashes(),missing_coverage:[{check:'binding',reason:binding.configurationError}]};
  const report={runtime_files:await runtimeHashes(),status:'OK',read_only:true,business_rows_requested:false,as_of:new Date().toISOString(),transport_https:binding.transportHttps,session_readonly:null,columns:null,engines:null,reader_eligibility:'UNVERIFIED',grant_review:null,missing_coverage:[],limitations:['Metadata only; no receipt, line, payment or person rows','Session readonly=1 does not establish permanent account privileges','Inherited roles and effective grants require review; no automatic detail enablement','Source transport preserved from its existing binding; data adapter requires HTTPS']};
  const run=async(name,sql)=>{
    try{return await query(binding,sql,{db:binding.database});}
    catch(error){report.status='PARTIAL';report.missing_coverage.push({check:name,reason:/^POS upstream HTTP \d{3}$/.test(error.message)?error.message:'METADATA_READ_FAILED'});return null;}
  };
  const columns=await run('columns',"SELECT table,name,type FROM system.columns WHERE database={db:String} AND table IN ('doc','docdetail','docpayment') ORDER BY table,name");
  if(columns)report.columns=columns.filter(x=>TABLES.includes(x.table)&&str(x.name)&&str(x.type)).map(x=>({table:x.table,name:x.name,type:x.type}));
  const engines=await run('engines',"SELECT name,engine,sorting_key,primary_key FROM system.tables WHERE database={db:String} AND name IN ('doc','docdetail','docpayment') ORDER BY name");
  if(engines)report.engines=engines.filter(x=>TABLES.includes(x.name)&&str(x.engine)&&str(x.sorting_key)&&str(x.primary_key)).map(x=>({name:x.name,engine:x.engine,sorting_key:x.sorting_key,primary_key:x.primary_key}));
  const session=await run('session',"SELECT getSetting('readonly') AS readonly");
  if(session)report.session_readonly=String(session[0]?.readonly)==='1'?1:null;
  const grants=await run('direct_grants',"SELECT access_type,is_partial_revoke FROM system.grants WHERE user_name=currentUser()");
  const roles=await run('roles',"SELECT count() AS n FROM system.role_grants WHERE user_name=currentUser()");
  const inherited=roles&&/^\d{1,9}$/.test(String(roles[0]?.n))?Number(roles[0].n):null;
  report.grant_review={direct_select_observed:grants?grants.some(x=>x.access_type==='SELECT'&&Number(x.is_partial_revoke)===0):null,direct_non_read_grant_observed:grants?grants.some(x=>!READ_ACCESS.has(x.access_type)&&Number(x.is_partial_revoke)===0):null,inherited_role_count:inherited,effective_grants_verified:false};
  if(report.session_readonly!==1){report.status='PARTIAL';report.missing_coverage.push({check:'readonly',reason:'READONLY_SESSION_NOT_VERIFIED'});}
  if(!report.columns?.length||!report.engines?.length)report.status='PARTIAL';
  return report;
}
