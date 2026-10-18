import {useEffect,useRef,useState} from 'react';
import { Icon } from '../design';
import {ReturnEvidenceForm} from './ReturnEvidenceForm';
import {issueTypeLabel,issueStatuses,issueResolutions,issueTime,issueAmount,localDue,canManageIssues,issueQuantity,receiptExplanation,canAttachIssue,evidenceAction} from './issue-labels.mjs';
function ProofImage({api,issueId,proof,kind}) {
  const [url,setUrl]=useState('');const [error,setError]=useState(false);
  useEffect(()=>{let active=true;let objectUrl;
    api.binary(issueId,proof.id,kind).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(active)setError(true);});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[api,issueId,proof.id,kind]);
  return url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={kind==='signature'?'ลายเซ็นคนมารับคืน':'หลักฐานที่บันทึกแล้ว'} /></a>:<p role="status">{error?'โหลดหลักฐานไม่ได้':'กำลังโหลดหลักฐาน…'}</p>;
}
const actionNames={created:'เปิดเรื่อง',auto_created:'สร้างอัตโนมัติ',updated:'อัปเดตเรื่อง',evidence_added:'แนบหลักฐาน',reminded:'แจ้งเตือนเลยกำหนด'};
export function ReceivingIssueDetail({id,user,api,onBack,onDirtyChange}) {
  const [assignees,setAssignees]=useState([]);
  useEffect(()=>{if(!canManageIssues(user))return;let active=true;api.assignees().then(result=>{if(active)setAssignees(result.items);}).catch(()=>{if(active)setError('โหลดผู้รับผิดชอบไม่ได้ กรุณาโหลดหน้าใหม่');});return()=>{active=false;};},[api,user]);
  const [row,setRow]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const formDirty=useRef(false);const proofDirty=useRef(false);
  const markProof=value=>{proofDirty.current=value;onDirtyChange?.(value||formDirty.current);};
  const [form,setForm]=useState({});const [evidence,setEvidence]=useState(false);const lock=useRef(false);
  async function refresh(preserveForm=false){const next=await api.detail(id);setRow(next);if(!preserveForm)setForm({status:next.status,resolution:next.resolution||'redelivered',resolution_amount:next.resolution_amount??next.amount,resolution_ref:next.resolution_ref||'',owner_user_id:next.owner_user_id??'',due_at:localDue(next.due_at),note:next.note});}
  useEffect(()=>{let active=true;api.detail(id).then(next=>{if(active){setRow(next);setForm({status:next.status,resolution:next.resolution||'redelivered',resolution_amount:next.resolution_amount??next.amount,resolution_ref:next.resolution_ref||'',owner_user_id:next.owner_user_id??'',due_at:localDue(next.due_at),note:next.note});}}).catch(()=>{if(active)setError('โหลดเรื่องไม่ได้ กรุณาตรวจสิทธิ์และลองใหม่');});return()=>{active=false;};},[id,api]);
  const change=(key,value)=>{formDirty.current=true;setForm(old=>({...old,[key]:value}));onDirtyChange?.(true);};
  async function save(event){
    event.preventDefault();if(lock.current)return;if(proofDirty.current){setError('กรุณาบันทึกหรือยกเลิกหลักฐานที่กำลังกรอกก่อนอัปเดตเรื่อง');return;}lock.current=true;setBusy(true);setError('');
    try {const body={version:row.version,status:form.status,note:form.note,owner_user_id:form.owner_user_id?Number(form.owner_user_id):null,due_at:`${form.due_at}:00+07:00`};
      if(form.status==='resolved')Object.assign(body,{resolution:form.resolution,resolution_amount:form.resolution_amount,resolution_ref:form.resolution_ref});
      await api.update(id,body);formDirty.current=false;onDirtyChange?.(proofDirty.current);await refresh();
    }catch(failure){setError(failure.response?.status===409?'เรื่องเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก':'บันทึกไม่ได้ ตรวจทางจบ เลขที่เอกสาร เหตุผล และหลักฐานคืนของ');}
    finally{lock.current=false;setBusy(false);}
  }
  if(!row)return <section><button onClick={onBack}>กลับรายการ</button><p role={error?'alert':'status'}>{error||'กำลังโหลดเรื่อง…'}</p></section>;
  const closed=['resolved','cancelled'].includes(row.status);
  return <section className="ri-detail"><button className="ri-secondary" onClick={onBack}>กลับรายการ</button>
    <h2>เรื่อง #{row.id} · {issueTypeLabel(row)}</h2><p className="ri-badge">{issueStatuses[row.status]}</p>
    <p>{row.supplier_name} · สาขา {row.branch_id} · เอกสาร #{row.document_id}</p>
    <h3 className="receiving-bill-text">{row.product_name||'ทั้งเอกสาร'}</h3>{row.bill_text && row.bill_text !== row.product_name && <p className="ri-muted receiving-bill-text">ชื่อในบิล: {row.bill_text}</p>}<p className="ri-muted">เปิดเรื่อง {issueTime(row.created_at)}</p><p>จำนวน {issueQuantity(row)} · มูลค่า {issueAmount(row)}</p>
    <p>ผู้รับผิดชอบ: {row.owner_user_id?`#${row.owner_user_id}`:'ยังไม่มอบหมาย'} · กำหนดตาม {issueTime(row.due_at)}</p>
    {receiptExplanation(row)&&<p>{receiptExplanation(row)}</p>}
    {row.request_items&&<ul className="receiving-bill-text">{row.request_items.map((item,index)=><li key={index}>{item.product_name} · {issueQuantity(item)}</li>)}</ul>}
    {row.receipt_line?.return_status&&<p>{row.receipt_line.return_status==='collected'?'ร้านมารับแล้ว · กรุณาแนบหลักฐาน':'รอร้านมารับคืน'}</p>}
    {row.note&&!(row.receipt_line&&/^(เทียบบิล:|ตรวจสินค้าไม่ตรงจากใบรับ:|ไม่รับ · คืนร้าน|ไม่มีในบิล)/.test(row.note))&&!row.request_items&&<p className="receiving-bill-text">{row.note}</p>}{row.resolution&&<p>ทางจบ: {issueResolutions[row.resolution]} · {row.resolution_amount} บาท · {row.resolution_ref}</p>}
    {!closed&&canAttachIssue(user,row)&&<button type="button" onClick={()=>{if(evidence&&proofDirty.current&&!window.confirm('มีหลักฐานยังไม่บันทึก ต้องการยกเลิกการกรอกหรือไม่?'))return;if(evidence)markProof(false);setEvidence(value=>!value);}}>{evidenceAction(row)}</button>}
    {evidence&&!closed&&<ReturnEvidenceForm issue={row} api={api} onSaved={()=>refresh(true)} onDirtyChange={markProof} />}
    <details><summary>หลักฐาน {row.evidence.length} ชุด</summary><div className="ri-proof-grid">{row.evidence.map(proof=><article key={proof.id}>
      <p>ผู้มารับ: {proof.collector_name||'ไม่ได้ระบุ'} · {issueTime(proof.created_at)}</p><p>{proof.note}</p>
      <ProofImage api={api} issueId={row.id} proof={proof} kind="image" />{proof.has_signature&&<ProofImage api={api} issueId={row.id} proof={proof} kind="signature" />}
    </article>)}</div></details>
    {canManageIssues(user)&&!closed&&<form onSubmit={save}><h3>ติดตามและปิดเรื่อง</h3><fieldset disabled={busy}>
      <div className="ri-fields"><label>ผู้รับผิดชอบ<select value={form.owner_user_id} onChange={e=>change('owner_user_id',e.target.value)}><option value="">ยังไม่มอบหมาย</option>{assignees.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>กำหนดตาม (เวลาไทย)<input type="datetime-local" required value={form.due_at} onChange={e=>change('due_at',e.target.value)} /></label></div>
      <label>สถานะ<select value={form.status} onChange={e=>change('status',e.target.value)}>{Object.entries(issueStatuses).filter(([v])=>!(row.status==='waiting_supplier'&&v==='open')).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      {form.status==='resolved'&&<><label>ทางจบ<select value={form.resolution} onChange={e=>change('resolution',e.target.value)}>{Object.entries(issueResolutions).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <div className="ri-fields"><label>มูลค่าที่ตกลง (บาท)<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.resolution_amount} onChange={e=>change('resolution_amount',e.target.value)} /></label>
        <label>เลขที่บิลใหม่ / ใบลดหนี้<input maxLength={255} required={['new_bill','credit_note'].includes(form.resolution)} value={form.resolution_ref} onChange={e=>change('resolution_ref',e.target.value)} /></label></div>
        <p>เก็บข้อตกลงและหลักฐานไว้เพื่อตรวจบัญชี ยังไม่มีการลงบัญชีเจ้าหนี้อัตโนมัติ</p></>}
      <label>รายละเอียด / เหตุผล<textarea maxLength={1000} required={form.status==='cancelled'||(form.status==='resolved'&&form.resolution==='written_off')} value={form.note} onChange={e=>change('note',e.target.value)} /></label>
      <button disabled={busy}>{busy?'กำลังบันทึก…':form.status==='resolved'?'บันทึกทางจบและปิดเรื่อง':'บันทึกการติดตาม'}</button>
    </fieldset></form>}
    {error&&<p role="alert">{error}</p>}<button className="ri-secondary ri-refresh" aria-label="รีเฟรช" title="รีเฟรช" disabled={busy} onClick={()=>{if(formDirty.current||proofDirty.current){setError('บันทึกหรือยกเลิกข้อมูลที่กำลังกรอกก่อนรีเฟรช');return;}refresh().catch(()=>setError('รีเฟรชไม่สำเร็จ'));}}><Icon name="retry" /></button>
    <details><summary>ประวัติ {row.history.length} รายการ</summary><ol>{row.history.map(event=><li key={event.id}>{issueTime(event.created_at)} · {actionNames[event.action]||'เปลี่ยนแปลง'} · ผู้ใช้ {event.actor_user_id||'ระบบ'}
      {event.details.to&&` → ${issueStatuses[event.details.to]}`}{event.details.resolution&&` · ${issueResolutions[event.details.resolution]}`}{event.details.note&&<p>{event.details.note}</p>}</li>)}</ol></details>
  </section>;
}
