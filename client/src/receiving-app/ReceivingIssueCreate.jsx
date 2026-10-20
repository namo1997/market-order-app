import {useRef,useState} from 'react';
import {issueTypes,localDue} from './issue-labels.mjs';
export function ReceivingIssueCreate({api,onCreated,onCancel,onDirtyChange}) {
  const [docId,setDocId]=useState('');const [doc,setDoc]=useState(null);const [line,setLine]=useState('');
  const [type,setType]=useState('return');const [quantity,setQuantity]=useState('');const [amount,setAmount]=useState('');
  const [note,setNote]=useState('');const [due,setDue]=useState(localDue(Date.now()+86400000));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const key=useRef(crypto.randomUUID());
  const lock=useRef(false);
  async function load(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setDoc(null);
    try {const result=await api.sourceDocument(docId);if(result.status!=='confirmed')throw Error();setDoc(result);setLine('');}
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
    <fieldset disabled={busy}><label>เลขที่เอกสารรับสินค้า<input type="number" min="1" value={docId} onChange={e=>{setDocId(e.target.value);setDoc(null);}} required /></label>
      <button type="button" disabled={busy||!docId} onClick={load}>โหลดเอกสาร</button>
      {doc&&<><p>เอกสาร #{doc.id} · {doc.supplier_name_text} · สาขา {doc.branch_id}</p>
        <label>บรรทัดอ้างอิง<select className="receiving-bill-text" value={line} onChange={e=>setLine(e.target.value)}><option value="">ทั้งเอกสาร</option>{doc.lines.map(item=><option key={item.id} value={item.id}>{item.line_no}. {item.product_name || item.bill_text}</option>)}</select></label>
        <label>ประเภท<select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(issueTypes).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <div className="ri-fields"><label>จำนวน<input inputMode="decimal" value={quantity} pattern="[0-9]+([.][0-9]{1,2})?" required onChange={e=>setQuantity(e.target.value)} /></label>
          <label>มูลค่า (บาท)<input inputMode="decimal" value={amount} pattern="[0-9]+([.][0-9]{1,2})?" onChange={e=>setAmount(e.target.value)} /></label></div>
        <label>กำหนดตาม (เวลาไทย)<input type="datetime-local" required value={due} onChange={e=>setDue(e.target.value)} /></label>
        <label>รายละเอียด<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} /></label>
        <button disabled={busy}>{busy?'กำลังสร้างเรื่อง…':'สร้างเรื่อง'}</button></>}
      <button type="button" className="ri-secondary" onClick={onCancel}>กลับรายการ</button>
    </fieldset>{error&&<p role="alert">{error}</p>}
  </form>;
}
