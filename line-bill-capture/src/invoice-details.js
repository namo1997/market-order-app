// หน้าบิลและตารางสินค้าเป็นหลักฐานเสริม ไม่สร้างรายการจ่ายหรือแก้ยอดต้นฉบับ
import { createHash } from 'node:crypto';
import { normalizeInvoiceLineItemsResult } from './invoice-line-items.js';
import { expenseClassificationSuggestions } from './expense-classification-suggestions.js';

const parse = value => { try { const data = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } };
const text = value => typeof value === 'string' ? value.trim() : '';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
const pageNumber = value => Number.isSafeInteger(value) && value > 0 && value <= 100 ? value : null;
const query = (db, sql, params) => { const s = db.prepare(sql, params); try { const rows = []; while (s.step()) rows.push(s.getAsObject()); return rows; } finally { s.free(); } };
const invoiceDate = row => {
  const value = text(parse(row.ai_result_json).invoice_date);
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { const d = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/); if (d) { let y=Number(d[3]); if (y<100) y+=y>50?2500:2000; if(y>2400)y-=543; m=['',String(y),d[2].padStart(2,'0'),d[1].padStart(2,'0')]; } }
  if (!m) return null;
  if(Number(m[1])>2400)m[1]=String(Number(m[1])-543);
  const date=`${m[1]}-${m[2]}-${m[3]}`;
  return !Number.isNaN(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date ? date : null;
};
const sameVendor = (a,b) => {
  const taxA=text(a.vendor_tax_id),taxB=text(b.vendor_tax_id);
  if(taxA && taxB) return taxA===taxB;
  const name = r => text(r.vendor_name || r.supplier_name).toLocaleLowerCase();
  return Boolean(name(a)) && name(a)===name(b);
};

export const buildInvoiceDetails = (item, candidates = []) => {
  if (!['bill','bill_page'].includes(item.category) || ['unsent','duplicate'].includes(item.status)) return {applicable:false};
  const warnings=[],ref=text(item.doc_ref),date=invoiceDate(item);
  let scoped=[item];
  if (ref) scoped=candidates.filter(row=>row.source_type===item.source_type && row.source_id===item.source_id
    && text(row.doc_ref)===ref && ['bill','bill_page'].includes(row.category) && !['unsent','duplicate'].includes(row.status)
    && sameVendor(item,row) && (Number(row.id)===Number(item.id) || date && invoiceDate(row)===date));
  if (!scoped.some(row=>Number(row.id)===Number(item.id))) scoped.push(item);
  // ไม่รวมหน้าอื่นด้วยเลขใบกำกับอย่างเดียว ถ้าไม่มีวันที่เอกสารที่เชื่อถือได้
  if (!date && Number(item.page_count)>1) warnings.push('ยังยืนยันวันที่บิลไม่ได้ กรุณาตรวจหน้าประกอบ');
  scoped.sort((a,b)=> (pageNumber(a.page_no)||101)-(pageNumber(b.page_no)||101) || Number(a.id)-Number(b.id));
  const seenHashes=new Set(),pages=[]; let duplicate=false;
  for(const row of scoped) {
    const hash=/^[a-f0-9]{64}$/i.test(row.file_sha256||'') ? row.file_sha256.toLowerCase() : null;
    if(hash && seenHashes.has(hash)) { duplicate=true; continue; }
    if(hash) seenHashes.add(hash);
    pages.push(row);
  }
  if(duplicate)warnings.push('พบรูปหน้าเดิมซ้ำ แสดงและรวมสินค้าครั้งเดียว');
  const tooMany=pages.length>30; const selected=pages.slice(0,30);
  if(tooMany)warnings.push('มีหน้าบิลเกินขอบเขตที่แสดง กรุณาตรวจต้นฉบับ');
  const counts=[...new Set(selected.map(row=>pageNumber(row.page_count)).filter(Boolean))];
  const count=counts.length===1?counts[0]:null;
  const numbered=new Map();
  selected.forEach(row=> { const p=pageNumber(row.page_no); if(p)numbered.set(p,[...(numbered.get(p)||[]),row]); });
  const conflicting=[...numbered].filter(([,rows])=>rows.length>1).map(([p])=>p);
  const invalidPages=selected.some(row=>!pageNumber(row.page_no) || count && row.page_no>count);
  const missing=count ? Array.from({length:count},(_,i)=>i+1).filter(p=>!numbered.has(p)):[];
  const multi=(count||Number(item.page_count))>1;
  const completeness=tooMany || counts.length>1 || conflicting.length || (multi && invalidPages) ? 'ambiguous'
    : missing.length ? 'missing' : count && !invalidPages ? 'complete' : 'unknown';
  if(missing.length)warnings.push(`ขาดหน้าบิล ${missing.join(', ')} · รายการสินค้าอาจยังไม่ครบ`);
  if(conflicting.length)warnings.push(`พบรูปต่างกันสำหรับหน้า ${conflicting.join(', ')} · ยังไม่รวมสินค้าจากหน้าที่ซ้ำ`);
  if(counts.length>1)warnings.push('จำนวนหน้าที่ OCR อ่านไม่ตรงกัน');
  const lineItems=[]; let unread=false,partial=false;
  for(const row of selected) {
    if(conflicting.includes(pageNumber(row.page_no))) {partial=true;continue;}
    const analysis=parse(row.ai_result_json),normalized=normalizeInvoiceLineItemsResult(analysis.line_items);
    if(!Array.isArray(analysis.line_items) || analysis.line_items_complete!==true)unread=true;
    if(normalized.truncated || normalized.invalid_count || analysis.line_items_truncated || analysis.line_items_invalid_count>0)partial=true;
    lineItems.push(...normalized.items.map(line=>({item_id:Number(row.id),page_no:pageNumber(row.page_no),...line})));
  }
  const limited=lineItems.slice(0,2000); if(lineItems.length>2000)partial=true;
  if(partial)warnings.push('OCR อ่านรายการสินค้าได้ไม่ครบหรือมีข้อมูลที่ต้องตรวจ');
  if(unread && limited.length)warnings.push('ยังยืนยันไม่ได้ว่า OCR อ่านสินค้าครบทุกหน้า');
  const lineStatus=!limited.length ? 'not_read' : partial || unread || completeness!=='complete' ? 'partial' : 'available';
  const analysis=parse(item.ai_result_json),gross=number(analysis.bill_subtotal_value),discount=number(analysis.discount_value),net=number(item.bill_total_value);
  // รวมได้เมื่อครบทุกหน้า/ทุกจำนวนเงินเท่านั้น และคำนวณเป็นสตางค์เพื่อเลี่ยง floating point
  let sum=null;
  if(lineStatus==='available' && limited.every(line=>number(line.amount)!==null)) {
    let cents=0,safe=true;
    for(const line of limited) { const value=Math.round(line.amount*100); cents+=value; if(!Number.isSafeInteger(value)||!Number.isSafeInteger(cents)){safe=false;break;} }
    if(safe)sum=cents/100;
    else warnings.push('ยอดสินค้าเกินขอบเขตคำนวณ กรุณาตรวจต้นฉบับ');
  }
  const expected=gross!==null ? gross : net!==null && discount!==null ? net+discount : null;
  const reconciliation=sum!==null && expected!==null ? Math.abs(sum-expected)<=0.02?'matches':'mismatch':'unknown';
  if(reconciliation==='mismatch')warnings.push('ยอดรายการสินค้าไม่ตรงกับยอดก่อนส่วนลด อาจอ่านไม่ครบหรือมีภาษีต่างฐาน · ไม่เปลี่ยนยอดบิล');
  if(gross!==null && discount!==null && net!==null && Math.abs(gross-discount-net)>0.02)warnings.push('ยอดก่อนส่วนลด หักส่วนลดแล้วไม่ตรงยอดสุทธิ · กรุณาเทียบต้นฉบับ');
  const result={applicable:true,primary_item_id:Number(item.id),doc_ref:ref||null,invoice_date:date,page_count:count,pages:selected.map(row=>({item_id:Number(row.id),page_no:pageNumber(row.page_no),page_count:pageNumber(row.page_count),has_image:Boolean(row.storage_relative_path),file_sha256:row.file_sha256||null})),completeness,missing_pages:missing,line_items:limited,line_items_status:lineStatus,warnings,totals:{gross,discount,net,product_sum:sum,reconciliation}};
  result.context_token=createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return result;
};

export const readInvoiceDetails = (db,item) => {
  if (!['bill','bill_page'].includes(item.category) || !text(item.doc_ref)) return buildInvoiceDetails(item,[item]);
  const rows=query(db,`SELECT * FROM capture_items WHERE source_type=? AND source_id=? AND trim(doc_ref)=? AND category IN ('bill','bill_page') AND status NOT IN ('unsent','duplicate') ORDER BY id LIMIT 101`,[item.source_type,item.source_id,text(item.doc_ref)]);
  return buildInvoiceDetails(item,rows);
};

// อ่านเฉพาะชื่อสินค้า ไม่ใช้ชื่อร้าน/หัวเอกสาร และไม่เปลี่ยนค่าที่ผู้ตรวจบันทึกไว้
export const invoiceClassificationSuggestions = details => {
  if(!details?.applicable || !details.line_items?.length || details.completeness!=='complete' || details.line_items_status!=='available')return {};
  const identified=details.line_items.map(line=> {
    if(/ไม้จิ้ม|ไม้เสียบ|ร่มค็อกเทล|ทิชชู่|บรรจุภัณฑ์|วัสดุสิ้นเปลือง/u.test(line.description))return 'packaging';
    if(/ขนมปัง|วิปปิ้งครีม|นมสด|นมพาส|กะทิ|มะพร้าว|เต้าหู้|น้ำจิ้ม|คอร์นเฟลก|ไซรัป/u.test(line.description))return 'ingredients';
    return expenseClassificationSuggestions({billDetail:line.description,isBill:true}).expense_category?.value || null;
  });
  const categories=[...new Set(identified.filter(Boolean))];
  if(categories.length>1)return {expense_category:{value:'mixed',reason:'รายการสินค้าจากทุกหน้ามีหลายหมวด ควรตรวจและแยกยอดภายหลัง'}};
  if(categories.length===1 && identified.every(Boolean))return {expense_category:{value:categories[0],reason:'รายการสินค้าจากทุกหน้าสอดคล้องกับหมวดนี้ · ยังต้องตรวจต้นฉบับ'}};
  return {};
};
