import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

const TABLES = ['doc', 'docdetail', 'docpayment'];
const MAX_BYTES = 2_000_000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value);
const REQUIRED = {doc:['shopid','docno','docdatetime','transflag','iscancel','totalamount'], docdetail:['shopid','docno','line_number','barcode','itemname','qty','price','sumamount'], docpayment:['shopid','docno','description','amount']};
const OPTIONAL = {doc:['paycashamount','paytype','deliverycode','discountamount','vatamount'], docdetail:['unitcode','unitname','discountamount','vatamount','transflag','iscancel'], docpayment:[]};
const NUMBERS = new Set(['totalamount','paycashamount','paytype','discountamount','vatamount','line_number','qty','price','sumamount','amount','transflag','iscancel']);
const branchExpr = columns => columns.has('guidbranch') ? "coalesce(nullIf(guidbranch,''),nullIf(branchid,''),'')" : 'branchid';
const projection = (columns, names) => names.map(name => !columns.has(name) ? `NULL AS ${name}` : NUMBERS.has(name) ? `toString(${name}) AS ${name}` : name).join(', ');
const pick = (row, names) => Object.fromEntries(names.map(name=>[name,row[name]??null]));
const safeDescription = value => value==null?null:String(value).replace(/\b\d{8,}\b/g,'[redacted-number]');

export function loadPosConfig(env) {
  if (!env.BUSINESS_POS_CLICKHOUSE_URL) return null;
  const url = new URL(env.BUSINESS_POS_CLICKHOUSE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('POS ClickHouse URL must be HTTPS origin without credentials');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(env.BUSINESS_POS_CLICKHOUSE_DATABASE || '') || !id(env.BUSINESS_POS_SHOP_ID) || !env.BUSINESS_POS_CLICKHOUSE_USER || !env.BUSINESS_POS_CLICKHOUSE_PASSWORD || (env.BUSINESS_POS_CURSOR_KEY || '').length < 32) throw new Error('POS read-only binding incomplete');
  let classification = [];
  try { classification = JSON.parse(env.BUSINESS_POS_CLASSIFICATION_JSON || '[]'); } catch { throw new Error('Invalid POS classification mapping'); }
  if (!Array.isArray(classification) || classification.length > 100 || classification.some(x => !['STOREFRONT','DELIVERY'].includes(x.classification) || typeof x.deliverycode !== 'string' || x.deliverycode.length > 64 || !/^-?\d{1,5}$/.test(x.paytype) || !text(x.evidence))) throw new Error('Invalid POS classification mapping');
  if (new Set(classification.map(x=>`${x.deliverycode}\0${x.paytype}`)).size !== classification.length) throw new Error('Duplicate POS classification mapping');
  return {url:url.toString(), database:env.BUSINESS_POS_CLICKHOUSE_DATABASE, shop:env.BUSINESS_POS_SHOP_ID, user:env.BUSINESS_POS_CLICKHOUSE_USER, password:env.BUSINESS_POS_CLICKHOUSE_PASSWORD, cursorKey:env.BUSINESS_POS_CURSOR_KEY, classification};
}

// GET only. No caller-supplied SQL, identifiers, connection URL or settings.
export async function queryPos(binding, sql, params = {}, fetchImpl = fetch) {
  if (!binding) throw new Error('POS read-only ClickHouse binding missing');
  const url = new URL(binding.url);
  Object.entries({database:binding.database, readonly:'1', max_execution_time:'5', max_rows_to_read:'1000000', max_result_rows:'1002', result_overflow_mode:'throw', output_format_json_quote_64bit_integers:'1', query:`${sql} FORMAT JSON`, ...Object.fromEntries(Object.entries(params).map(([k,v])=>[`param_${k}`,String(v)]))}).forEach(([k,v])=>url.searchParams.set(k,v));
  let response;
  try { response = await fetchImpl(url, {method:'GET', redirect:'error', signal:AbortSignal.timeout(10000), headers:{accept:'application/json','X-ClickHouse-User':binding.user,'X-ClickHouse-Key':binding.password}}); } catch { throw new Error('POS upstream connection failed'); }
  if (!response.ok) throw new Error(`POS upstream HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('POS response too large');
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('POS response too large');
  let result; try {result = JSON.parse(body);} catch {throw new Error('Unexpected POS upstream response');}
  if (!Array.isArray(result.data) || result.data.length > 1002) throw new Error('Unexpected POS upstream response');
  return result.data;
}

function encode(binding, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256',binding.cursorKey).update(body).digest('base64url')}`;
}
function decode(binding, token, scope) {
  try {
    const [body,signature,...extra] = token.split('.');
    if (extra.length || token.length > 4000) throw new Error();
    const expected = createHmac('sha256',binding.cursorKey).update(body).digest();
    const actual = Buffer.from(signature,'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) throw new Error();
    const value = JSON.parse(Buffer.from(body,'base64url').toString());
    if (value.scope !== scope || !Number.isSafeInteger(value.exp) || value.exp < Date.now()) throw new Error();
    return value;
  } catch {throw new Error('Invalid or expired POS cursor');}
}
function validateInput(input) {
  if (!Number.isInteger(input.limit ?? 20) || (input.limit ?? 20) < 1 || (input.limit ?? 20) > 100) throw new Error('Invalid POS page limit');
  for (const key of ['product_barcode','payment_description','docno']) if (input[key] != null && !text(input[key])) throw new Error(`Invalid POS ${key}`);
  for (const key of ['time_from','time_to']) if (input[key] != null && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(input[key])) throw new Error('Invalid POS time');
  if (input.time_from && input.time_to && input.time_from > input.time_to) throw new Error('POS time range must not wrap midnight');
  if (input.classification != null && !['ALL','STOREFRONT','DELIVERY','UNCLASSIFIED'].includes(input.classification)) throw new Error('Invalid POS classification');
  if (input.cancel_status != null && !['ALL','ACTIVE','CANCELLED'].includes(input.cancel_status)) throw new Error('Invalid POS cancellation filter');
}

export function createPosReader(config, query = queryPos) {
  const binding = config.pos;
  async function schema() {
    if (!binding) throw new Error('POS read-only ClickHouse binding missing');
    const params = {db:binding.database};
    const rows = await query(binding,"SELECT table, name, type FROM system.columns WHERE database={db:String} AND table IN ('doc','docdetail','docpayment')",params);
    const engines = await query(binding,"SELECT name, engine, sorting_key, primary_key FROM system.tables WHERE database={db:String} AND name IN ('doc','docdetail','docpayment')",params);
    const result = {};
    for (const table of TABLES) {
      const columns = new Set(rows.filter(row=>row.table===table).map(row=>row.name));
      const engine = engines.find(row=>row.name===table);
      if (!engine || !/^(Replacing)?MergeTree$/.test(engine.engine) || REQUIRED[table].some(name=>!columns.has(name)) || !columns.has('branchid')) throw new Error(`Unsupported POS ${table} schema or engine`);
      result[table] = {columns, engine, from:`\`${binding.database}\`.${table}${engine.engine==='ReplacingMergeTree'?' FINAL':''}`};
    }
    return result;
  }
  function classify(row) {
    if (row.deliverycode == null || row.paytype == null) return 'UNCLASSIFIED';
    return binding.classification.find(x=>x.deliverycode===row.deliverycode && x.paytype===String(row.paytype))?.classification || 'UNCLASSIFIED';
  }
  function filters(input, branch, period, meta) {
    if (!id(branch.clickhouse_branch_id)) throw new Error('POS verified branch binding missing');
    const params = {shop:binding.shop, branch:branch.clickhouse_branch_id, from:period.from, to:period.to};
    const where = ["shopid={shop:String}",`${branchExpr(meta.doc.columns)}={branch:String}`,"transflag=44","toDate(toTimeZone(docdatetime,'Asia/Bangkok')) BETWEEN {from:Date} AND {to:Date}"];
    if (input.cancel_status !== 'ALL') where.push(`iscancel=${input.cancel_status==='CANCELLED'?'1':'0'}`);
    for (const [key,op] of [['time_from','>='],['time_to','<=']]) if (input[key]) {params[key]=input[key]; where.push(`formatDateTime(docdatetime,'%H:%i:%S','Asia/Bangkok')${op}{${key}:String}`);}
    if (input.docno) {params.docno=input.docno; where.push('docno={docno:String}');}
    for (const [key,table,column] of [['product_barcode','docdetail','barcode'],['payment_description','docpayment','description']]) if (input[key]) {
      params[key]=input[key]; where.push(`docno IN (SELECT docno FROM ${meta[table].from} WHERE shopid={shop:String} AND ${branchExpr(meta[table].columns)}={branch:String} AND ${column}={${key}:String})`);
    }
    const classification = input.classification || 'ALL';
    if (classification !== 'ALL') {
      if (!meta.doc.columns.has('deliverycode') || !meta.doc.columns.has('paytype') || !binding.classification.length) throw new Error('POS storefront classification not verified');
      const mappings = classification==='UNCLASSIFIED'?binding.classification:binding.classification.filter(x=>x.classification===classification);
      if (!mappings.length) throw new Error('POS requested classification not verified');
      const predicates = mappings.map((x,i)=>{params[`dc${i}`]=x.deliverycode;params[`pt${i}`]=x.paytype;return `(deliverycode={dc${i}:String} AND toString(paytype)={pt${i}:String})`;});
      const disjunction = `(${predicates.join(' OR ')})`;
      where.push(classification==='UNCLASSIFIED'?`NOT coalesce(${disjunction},false)`:disjunction);
    }
    return {params,where:where.join(' AND ')};
  }
  function envelope(branch, period, meta) {
    return {schema_version:'1.0',read_only:true,source:'CLICKHOUSE_POS_DIRECT',branch:branch.code,period:{kind:'SALE_DATE',timezone:'Asia/Bangkok',...period},as_of:new Date().toISOString(),source_updated_at:null,basis:'SOURCE_FIELDS_AS_REPORTED',read_consistency:'LIVE_PAGES_MAY_CHANGE',provenance:{database:binding.database,shop_id:binding.shop,branch_id:branch.clickhouse_branch_id,engines:Object.fromEntries(TABLES.map(t=>[t,meta[t].engine])),available_fields:Object.fromEntries(TABLES.map(t=>[t,[...REQUIRED[t],...OPTIONAL[t]].filter(x=>meta[t].columns.has(x))])),classification_evidence:binding.classification.map(x=>x.evidence)},limitations:['transflag=44 only; other flags and refund semantics not verified','Amounts and quantities are source strings; no recomputation of net, VAT or discounts','No equivalence to stored Cash Flow POS or the legacy sales report','No verified seller-to-receipt relation; seller is unknown','Payments omit bank/account/contact/evidence fields; cash amount remains on header','Schema/version freshness is the read time, not POS ingestion time']};
  }
  async function list(input, branch, period, clientName) {
    validateInput(input);
    const meta = await schema();
    const {where,params} = filters(input,branch,period,meta);
    const scope = hash({operation:'list',clientName,branch:branch.code,nativeBranch:branch.clickhouse_branch_id,shop:binding.shop,database:binding.database,classification:binding.classification,period,filters:{...input,cursor:undefined,limit:undefined}});
    const cursor = input.cursor?decode(binding,input.cursor,scope):null;
    if (cursor && (!text(cursor.docno) || !/^\d+$/.test(cursor.instant))) throw new Error('Invalid POS cursor');
    const duplicates = await query(binding,`SELECT docno, count() AS n FROM ${meta.doc.from} WHERE shopid={shop:String} AND ${branchExpr(meta.doc.columns)}={branch:String} AND docno IN (SELECT docno FROM ${meta.doc.from} WHERE ${where}) GROUP BY docno HAVING n>1 LIMIT 1`,params);
    if (duplicates.length) throw new Error('POS receipt identity ambiguous in requested window');
    const pageWhere = cursor ? `${where} AND (toUnixTimestamp64Nano(toDateTime64(docdatetime,9)),docno)>({instant:UInt64},{after:String})` : where;
    const rows = await query(binding,`SELECT ${projection(meta.doc.columns,[...REQUIRED.doc,...OPTIONAL.doc])}, toString(toUnixTimestamp64Nano(toDateTime64(docdatetime,9))) AS instant, formatDateTime(docdatetime,'%Y-%m-%dT%H:%i:%S','Asia/Bangkok') AS sold_at_bangkok FROM ${meta.doc.from} WHERE ${pageWhere} ORDER BY toUnixTimestamp64Nano(toDateTime64(docdatetime,9)),docno LIMIT {page:UInt32}`,{...params,page:(input.limit??20)+1,...(cursor?{instant:cursor.instant,after:cursor.docno}:{})});
    if (rows.some(row=>!text(row.docno)||!/^\d+$/.test(row.instant))) throw new Error('Invalid POS receipt identity');
    const page = rows.slice(0,input.limit??20);
    if (new Set(page.map(row=>row.docno)).size!==page.length) throw new Error('Duplicate POS receipt identity');
    const last = page.at(-1);
    const next = rows.length>page.length?encode(binding,{scope,instant:last.instant,docno:last.docno,exp:Date.now()+900000}):null;
    return {...envelope(branch,period,meta),status:next?'PARTIAL':'OK',receipts:page.map(row=>({...pick(row,[...REQUIRED.doc,...OPTIONAL.doc,'sold_at_bangkok'].filter(x=>x!=='shopid')),classification:classify(row),seller:null})),next_cursor:next,coverage:{complete:next===null,classification_verified:binding.classification.length>0,cancel_status:input.cancel_status||'ACTIVE',seller:'UNVERIFIED'}};
  }
  async function detail(input, branch, period, clientName) {
    validateInput(input);
    if (!text(input.docno)) throw new Error('POS docno required');
    const meta = await schema();
    const {params,where} = filters({...input,cancel_status:'ALL'},branch,period,meta);
    const headers = await query(binding,`SELECT ${projection(meta.doc.columns,[...REQUIRED.doc,...OPTIONAL.doc])}, formatDateTime(docdatetime,'%Y-%m-%dT%H:%i:%S','Asia/Bangkok') AS sold_at_bangkok FROM ${meta.doc.from} WHERE ${where} LIMIT 2`,params);
    if (!headers.length) throw new Error('POS receipt not found in authorized scope');
    if (headers.length!==1 || !text(headers[0].docno) || headers[0].docno!==input.docno) throw new Error('POS receipt identity ambiguous');
    // Children do not carry a verified sale timestamp. Refuse a reused docno across time.
    const identity = await query(binding,`SELECT count() AS n FROM ${meta.doc.from} WHERE shopid={shop:String} AND ${branchExpr(meta.doc.columns)}={branch:String} AND docno={docno:String}`,params);
    if (String(identity[0]?.n)!=='1') throw new Error('POS receipt identity reused across dates; child join unsafe');
    const children = {};
    for (const table of ['docdetail','docpayment']) {
      const filter = `shopid={shop:String} AND ${branchExpr(meta[table].columns)}={branch:String} AND docno={docno:String}${meta[table].columns.has('transflag')?' AND transflag=44':''}`;
      // No cartesian lines x payments join. Project only reviewed business fields.
      children[table] = await query(binding,`SELECT ${projection(meta[table].columns,[...REQUIRED[table],...OPTIONAL[table]])} FROM ${meta[table].from} WHERE ${filter} ORDER BY ${table==='docdetail'?'line_number':'description,amount'} LIMIT 1001`,params);
      if (children[table].length>1000) throw new Error('POS receipt exceeds safe detail bound');
    }
    if (children.docdetail.some(row=>row.line_number==null) || new Set(children.docdetail.map(row=>row.line_number)).size!==children.docdetail.length) throw new Error('POS line identity ambiguous');
    const revision = hash({header:headers[0],...children});
    const scope = hash({operation:'detail',clientName,branch:branch.code,nativeBranch:branch.clickhouse_branch_id,shop:binding.shop,database:binding.database,classification:binding.classification,period,docno:input.docno});
    const cursor = input.cursor?decode(binding,input.cursor,scope):{offset:0,revision};
    if (cursor.revision!==revision) throw new Error('POS receipt changed; restart detail pagination');
    if (!Number.isInteger(cursor.offset)||cursor.offset<0||cursor.offset>1000) throw new Error('Invalid POS cursor');
    const limit=input.limit??20;
    const slice = (rows, table)=>rows.slice(cursor.offset,cursor.offset+limit).map(row=>{const result=pick(row,[...REQUIRED[table],...OPTIONAL[table]].filter(x=>!['shopid','docno'].includes(x)));if(table==='docpayment') result.description=safeDescription(result.description);return result;});
    const nextOffset=cursor.offset+limit;
    const more=nextOffset<Math.max(children.docdetail.length,children.docpayment.length);
    const header=pick(headers[0],[...REQUIRED.doc,...OPTIONAL.doc,'sold_at_bangkok'].filter(x=>x!=='shopid'));
    return {...envelope(branch,period,meta),status:more?'PARTIAL':'OK',header:{...header,classification:classify(header),seller:null},lines:slice(children.docdetail,'docdetail'),payments:slice(children.docpayment,'docpayment'),revision,next_cursor:more?encode(binding,{scope,revision,offset:nextOffset,exp:Date.now()+900000}):null,coverage:{complete:!more,line_count:children.docdetail.length,payment_entry_count:children.docpayment.length,seller:'UNVERIFIED'}};
  }
  return {list,detail};
}
