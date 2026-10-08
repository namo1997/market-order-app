// อ่านรายการที่สั่งไว้เพื่อเสนอให้เทียบกับบิลเท่านั้น ไม่ยืนยันรับของหรือเขียนระบบสั่งของ
const id = value => Number.isSafeInteger(value) && value > 0;
const text = (value,max=500) => typeof value==='string' ? value.trim().slice(0,max) : null;
const normalized = value => String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
const quantity = value => typeof value==='number' && Number.isFinite(value) && value>=0 ? value:null;
const validDate = value => typeof value==='string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const orderReferenceConfig = (env=process.env) => {
  let branches={};try{const parsed=JSON.parse(env.BILL_ORDER_REFERENCE_BRANCH_MAP||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))branches=Object.fromEntries(Object.entries(parsed).filter(([label,value])=>label.trim()&&id(value)));}catch{}
  let base=null;try{const url=new URL(env.BILL_ORDER_REFERENCE_BASE_URL);const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    const protocol=env.SOLAO_LOCAL_SIMULATION==='1' ? local && ['http:','https:'].includes(url.protocol) : url.protocol==='https:';
    if(!url.username&&!url.password&&!url.search&&!url.hash&&protocol)base=url;}catch{}
  return {base,token:text(env.BILL_ORDER_REFERENCE_TOKEN,1000),branches};
};
export const matchOrderedProducts = (invoice,lines,{complete=false}={}) => (invoice.line_items||[]).map(row=> {
  const name=normalized(row.description),code=text(row.product_code,100);
  const candidates=[];
  for(const candidate of lines) {
    const other=normalized(candidate.product_name);
    const external=code && [candidate.supplier_item_id,candidate.barcode].filter(Boolean).some(value=>value===code);
    const same=name&&other&&(name===other || Math.min(name.length,other.length)>=6&&(name.includes(other)||other.includes(name)));
    if(!external&&!same)continue;
    candidates.push({...candidate,match_basis:external?'external_code':'name'});
  }
  // ไม่ลดหลายใบสั่งเหลือรายการเดียว แม้ product_id เดียวกัน
  return {item_id:row.item_id,page_no:row.page_no,line_no:row.line_no,description:row.description,
    status:candidates.length>1?'ambiguous':candidates.length===1?'suggested':complete?'not_found':'unavailable',
    candidates:candidates.slice(0,5),candidate_count:candidates.length};
});
export const readOrderProductReference = async ({invoice,branch,date=null,env=process.env,fetchImpl=fetch}={}) => {
  const config=orderReferenceConfig(env),scope={date:date||invoice?.invoice_date||null,branch_name:text(branch,200)};
  const empty=(status,message)=>({status,complete:false,scope,warnings:[message],rows:[]});
  if(!invoice?.applicable || !invoice.line_items?.length)return empty('scope_required','ยังไม่มีรายการสินค้าจาก OCR ให้เทียบ');
  if(!validDate(invoice?.invoice_date)||!validDate(scope.date)||!scope.branch_name)return empty('scope_required','เลือกสาขาและตรวจวันที่บิลก่อนเทียบรายการสั่ง');
  if(Math.abs(Date.parse(scope.date)-Date.parse(invoice.invoice_date))>7*86400000)return empty('scope_required','เลือกวันรายการสั่งภายใน 7 วันก่อนหรือหลังวันที่บิล');
  if(!config.base||!config.token||!Object.keys(config.branches).length)return empty('unconfigured','ยังไม่ได้เชื่อมข้อมูลรายการสั่งของตลาดสด');
  const branchId=config.branches[scope.branch_name];if(!id(branchId))return empty('scope_required','สาขานี้ยังไม่ได้ผูกกับสาขาในระบบสั่งของ');
  const url=new URL('/api/bill-order-reference/lines',config.base);url.searchParams.set('date',scope.date);url.searchParams.set('branch_id',String(branchId));
  try{
    const response=await fetchImpl(url,{method:'GET',headers:{'x-bill-order-reference-token':config.token},redirect:'error',signal:AbortSignal.timeout(4000)});
    if(!response.ok)return empty('unavailable','อ่านรายการสั่งไม่ได้ กรุณาลองใหม่ภายหลัง');
    const raw=await response.text();if(raw.length>2_000_000)return empty('unavailable','ข้อมูลรายการสั่งเกินขอบเขตที่อ่านได้');
    const result=JSON.parse(raw),data=result.data;
    if(result.success!==true || !data || data.scope?.date!==scope.date || data.scope?.branch_id!==branchId || !Array.isArray(data.lines)||data.lines.length>1000)return empty('unavailable','ข้อมูลรายการสั่งไม่ตรงกับสาขาหรือวันที่ที่เลือก');
    const lines=[];let invalid=false;
    for(const row of data.lines) {
      if(!id(row.product_id)||!id(row.order_id)||!id(row.order_item_id)||row.branch_id!==branchId||row.order_date!==scope.date||row.order_source!=='orders'||!text(row.product_name)){invalid=true;continue;}
      lines.push({order_source:'orders',order_id:row.order_id,order_number:text(row.order_number,100),order_item_id:row.order_item_id,order_date:row.order_date,
        branch_id:branchId,branch_name:text(row.branch_name,200),product_id:row.product_id,product_code:text(row.product_code,100),product_name:text(row.product_name),
        supplier_item_id:text(row.supplier_item_id,100),barcode:text(row.barcode,100),ordered_quantity:quantity(row.ordered_quantity),unit:text(row.unit,80)});
    }
    const complete=data.complete===true&&data.truncated!==true&&!invalid;
    const warnings=['เทียบเฉพาะสาขาและวันรายการสั่งที่เลือก ไม่รวมใบสั่งวันอื่นหรือใบสั่ง PO', 'ข้อเสนอจากรายการสั่ง · ยังไม่ยืนยันว่าได้รับสินค้าแล้ว · จำนวนสั่งและจำนวนในบิลอาจใช้คนละหน่วย'];
    if(env.SOLAO_LOCAL_SIMULATION==='1' && data.simulated===true)warnings.unshift('ใบสั่งในชุดนี้เป็นข้อมูลจำลองเพื่อทดสอบ ไม่ใช่ใบสั่งจริง');
    if(!complete)warnings.push('ข้อมูลรายการสั่งที่อ่านได้ยังไม่ครบ จึงยังสรุปไม่ได้ว่าไม่มีรายการสั่ง');
    return {status:'available',complete,scope,warnings,rows:matchOrderedProducts(invoice,lines,{complete})};
  }catch{return empty('unavailable','เชื่อมระบบสั่งของไม่ได้ กรุณาลองใหม่ภายหลัง');}
};
