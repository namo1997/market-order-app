import {useEffect,useRef,useState} from 'react';
import {issueTypes,localDue} from './issue-labels.mjs';
// 2026-10-21 -> 21 ต.ค. 2569 (date-only; no timezone math needed).
const MONTHS=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
export const thaiDay=value=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));return m?`${Number(m[3])} ${MONTHS[Number(m[2])-1]} ${Number(m[1])+543}`:'';};
export function ReceivingIssueCreate({api,onCreated,onCancel,onDirtyChange}) {
  const [docId,setDocId]=useState('');const [doc,setDoc]=useState(null);const [line,setLine]=useState('');
  const [type,setType]=useState('return');const [quantity,setQuantity]=useState('');const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');const [due,setDue]=useState(localDue(Date.now()+86400000));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const key=useRef(crypto.randomUUID());
  const lock=useRef(false);
  const [recent,setRecent]=useState([]);
  useEffect(()=>{let live=true;Promise.resolve(api.recentDocuments?.()).then(rows=>{if(live&&Array.isArray(rows))setRecent(rows.slice(0,8));}).catch(()=>{});return()=>{live=false;};},[api]);
  async function load(id=docId){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setDoc(null);
    try {const result=await api.sourceDocument(id);if(result.status!=='confirmed')throw Error();setDoc(result);setLine('');}
    catch {setError('เปิดเอกสารไม่ได้ ตรวจเลขที่ สิทธิ์ และสถานะยืนยันแล้ว');}
    finally {lock.current=false;setBusy(false);}
  }
  async function submit(event){
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {const result=await api.create({client_uuid:key.current,document_id:doc.id,line_id:line?Number(line):null,type,quantity,amount:amount||'0',note,due_at:`${due}:00+07:00`});await onCreated(result.issue.id);}
    catch {setError('สร้างเรื่องไม่ได้ ตรวจข้อมูล หรือลองส่งคำขอเดิมซ้ำ');}
    finally {lock.current=false;setBusy(false);}
  }
  return <form onChange={()=>onDirtyChange?.(true)} onSubmit={submit} className="ri-create"><h2>เปิดเรื่องปัญหารับของ</h2>
    <fieldset disabled={busy}>
      {!doc&&recent.length>0&&<div className="ri-recent" role="group" aria-label="ใบรับล่าสุด"><p>เลือกใบรับที่มีปัญหา</p>
        {recent.map(item=><button type="button" key={item.id} className="ri-recent-doc" onClick={()=>{setDocId(String(item.id));load(item.id);}}>
          <strong>{item.supplier_name_text||'ไม่ระบุผู้ส่ง'}</strong><small>ใบรับ #{item.id} · {thaiDay(item.delivery_date)}</small></button>)}</div>}
      <label>{recent.length>0&&!doc?'หรือพิมพ์เลขที่ใบรับ':'เลขที่ใบรับ'}<input type="number" min="1" value={docId} onChange={e=>{setDocId(e.target.value);setDoc(null);}} required /></label>
      <button type="button" disabled={busy||!docId} onClick={()=>load()}>โหลดเอกสาร</button>
      {doc&&<><p>เอกสาร #{doc.id} · {doc.supplier_name_text} {doc.branch_name ? ` · ${doc.branch_name}` : ''}</p>
        <label>สินค้าที่มีปัญหา<select className="receiving-bill-text" value={line} onChange={e=>setLine(e.target.value)}><option value="">ทั้งเอกสาร</option>{doc.lines.map(item=><option key={item.id} value={item.id}>{item.line_no}. {item.product_name || item.bill_text}</option>)}</select></label>
        <label>ประเภท<select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(issueTypes).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <div className="ri-fields"><label>จำนวน<input inputMode="decimal" value={quantity} pattern="[0-9]+([.][0-9]{1,2})?" required onChange={e=>setQuantity(e.target.value)} /></label>
          <label>มูลค่า (บาท)<input inputMode="decimal" value={amount} pattern="[0-9]+([.][0-9]{1,2})?" onChange={e=>setAmount(e.target.value)} /></label></div>
        <label>ต้องตามภายใน<input type="datetime-local" required value={due} onChange={e=>setDue(e.target.value)} /></label>
        <label>รายละเอียด<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} /></label>
        <button disabled={busy}>{busy?'กำลังสร้างเรื่อง…':'สร้างเรื่อง'}</button></>}
      <button type="button" className="ri-secondary" onClick={onCancel}>กลับรายการ</button>
    </fieldset>{error&&<p role="alert">{error}</p>}
  </form>;
}
