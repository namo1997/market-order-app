// Standalone operator read: do not import/start the application or print env/rows.
// Intended stdin command in the already authorized Market Order service runtime.
const names=['HOST','PORT','SECURE','DATABASE','USER','PASSWORD'];
const cfg=Object.fromEntries(names.map(k=>[k,process.env[`CLICKHOUSE_${k}`]]));
const database=cfg.DATABASE||'dedebi';
if (!cfg.HOST||!cfg.USER||!cfg.PASSWORD||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(database)||!/^[A-Za-z0-9.-]+$/.test(cfg.HOST)||!/^\d{1,5}$/.test(cfg.PORT||'8123')) {
  console.log(JSON.stringify({status:'SOURCE_BINDING_INVALID',no_secret_output:true}));process.exitCode=1;
} else {
  const origin=`${cfg.SECURE==='true'?'https':'http'}://${cfg.HOST}:${cfg.PORT||'8123'}/`;
  async function select(sql) {
    const url=new URL(origin);
    for(const [key,value]of Object.entries({database,readonly:'1',max_execution_time:'5',max_rows_to_read:'100000',max_result_rows:'1000',result_overflow_mode:'throw',query:`${sql} FORMAT JSON`,param_db:database}))url.searchParams.set(key,value);
    const response=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'X-ClickHouse-User':cfg.USER,'X-ClickHouse-Key':cfg.PASSWORD,accept:'application/json'}});
    if(!response.ok)throw new Error(`HTTP_${response.status}`);
    const body=await response.text();if(Buffer.byteLength(body)>1000000)throw new Error('METADATA_TOO_LARGE');
    const data=JSON.parse(body).data;if(!Array.isArray(data))throw new Error('BAD_METADATA');return data;
  }
  const checks=[
    ['columns',"SELECT table,name,type FROM system.columns WHERE database={db:String} AND table IN ('doc','docdetail','docpayment') ORDER BY table,name"],
    ['engines',"SELECT name,engine,sorting_key,primary_key FROM system.tables WHERE database={db:String} AND name IN ('doc','docdetail','docpayment') ORDER BY name"],
    ['session',"SELECT getSetting('readonly') AS readonly"],
    ['direct_grants',"SELECT access_type,database,table,is_partial_revoke FROM system.grants WHERE user_name=currentUser() ORDER BY access_type,database,table"],
    ['inherited_role_count',"SELECT count() AS n FROM system.role_grants WHERE user_name=currentUser()"]
  ];
  const report={check:'ACTUAL_POS_METADATA_READ',as_of:new Date().toISOString(),source_binding:'EXISTING_MARKET_ORDER_RUNTIME',transport_https:cfg.SECURE==='true',grants_status:'REQUIRES_OWNER_REVIEW_INCLUDING_INHERITED_ROLES',business_rows_requested:false,no_secret_output:true};
  for(const[name,sql]of checks){try{report[name]=await select(sql);}catch(e){report[name]={status:'UNAVAILABLE',reason:/^(HTTP_\d{3}|METADATA_TOO_LARGE|BAD_METADATA)$/.test(e.message)?e.message:'READ_FAILED'};}}
  if(report.columns?.status||report.engines?.status)process.exitCode=1;
  console.log(JSON.stringify(report,null,2));
}
