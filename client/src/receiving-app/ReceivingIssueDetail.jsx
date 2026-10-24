import {useEffect,useRef,useState} from 'react';
import { Icon } from '../design';
import { IssueCloseConfirmation } from './IssueCloseConfirmation';
import {ReturnEvidenceForm} from './ReturnEvidenceForm';
import {issueTypeLabel,issueStatuses,issueResolutions,issueTime,issueAmount,localDue,canManageIssues,issueQuantity,receiptFacts,canAttachIssue,evidenceAction,issueStatusLabel,awaitingIssueReview,issueBranchName,issueOwnerName,issueAgeLabel,issueNextAction,issueEvidenceLabel} from './issue-labels.mjs';
function ProofImage({api,issueId,proof,kind}) {
  const [url,setUrl]=useState('');const [error,setError]=useState(false);
  useEffect(()=>{let active=true;let objectUrl;
    api.binary(issueId,proof.id,kind).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(active)setError(true);});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[api,issueId,proof.id,kind]);
  return url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={kind==='signature'?'ลายเซ็นคนมารับคืน':'หลักฐานที่บันทึกแล้ว'} /></a>:<p role="status">{error?'โหลดหลักฐานไม่ได้':'กำลังโหลดหลักฐาน…'}</p>;
}
const actionNames={created:'เปิดเรื่อง',auto_created:'สร้างอัตโนมัติ',updated:'อัปเดตเรื่อง',evidence_added:'แนบหลักฐาน',reference_added:'เพิ่มเลขที่ใบลดหนี้',reminded:'แจ้งเตือนเลยกำหนด'};
export function ReceivingIssueDetail({id,user,api,onBack,onDirtyChange}) {
  const [assignees,setAssignees]=useState([]);
  const [confirmClose,setConfirmClose]=useState(false);const [reference,setReference]=useState('');
  useEffect(()=>{if(!canManageIssues(user))return;let active=true;api.assignees().then(result=>{if(active)setAssignees(result.items);}).catch(()=>{if(active)setError('โหลดผู้รับผิดชอบไม่ได้ กรุณาโหลดหน้าใหม่');});return()=>{active=false;};},[api,user]);
  const [reload,setReload]=useState(0);const [row,setRow]=useState(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const formDirty=useRef(false);const proofDirty=useRef(false);
  const markProof=value=>{proofDirty.current=value;onDirtyChange?.(value||formDirty.current);};
  const [form,setForm]=useState({});const [evidence,setEvidence]=useState(false);const lock=useRef(false);
  const evidenceId = `return-evidence-${id}`;
  useEffect(()=>{
    if (!evidence) return;
    const target = document.getElementById(evidenceId);
    target?.scrollIntoView({block:'start',behavior:'instant'});
    target?.focus({preventScroll:true});
  },[evidence,evidenceId]);
  async function refresh(preserveForm=false){const next=await api.detail(id);setRow(next);if(!preserveForm)setForm({status:next.status,resolution:next.resolution||'redelivered',resolution_amount:next.resolution_amount??next.amount,resolution_ref:next.resolution_ref||'',resolution_ref_pending:false,owner_user_id:next.owner_user_id??'',due_at:localDue(next.due_at),note:next.note});}
  useEffect(()=>{let active=true;api.detail(id).then(next=>{if(active){setRow(next);setForm({status:next.status,resolution:next.resolution||'redelivered',resolution_amount:next.resolution_amount??next.amount,resolution_ref:next.resolution_ref||'',resolution_ref_pending:false,owner_user_id:next.owner_user_id??'',due_at:localDue(next.due_at),note:next.note});}}).catch(()=>{if(active)setError('โหลดเรื่องไม่ได้ กรุณาตรวจสิทธิ์และลองใหม่');});return()=>{active=false;};},[id,api,reload]);
  const change=(key,value)=>{formDirty.current=true;setForm(old=>({...old,[key]:value}));onDirtyChange?.(true);};
  async function save(event){
    event.preventDefault();if(lock.current)return;
    if(proofDirty.current){setError('กรุณาบันทึกหรือยกเลิกหลักฐานที่กำลังกรอกก่อนอัปเดตเรื่อง');return;}
    if(form.status==='resolved'&&['new_bill','credit_note'].includes(form.resolution)&&!form.resolution_ref?.trim()&&!form.resolution_ref_pending){setError('กรุณาใส่เลขที่เอกสาร หรือเลือกยังไม่มีเลขที่สำหรับใบลดหนี้');return;}
    setError('');
    if(['resolved','cancelled'].includes(form.status)){setConfirmClose(true);return;}
    await persist();
  }
  async function persist(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {const body={version:row.version,status:form.status,note:form.note,owner_user_id:form.owner_user_id?Number(form.owner_user_id):null,due_at:`${form.due_at}:00+07:00`};
      if(form.status==='resolved' && form.resolution==='returned' && form.stock_return_quantity) body.stock_return_quantity = form.stock_return_quantity;
      if(form.status==='resolved')Object.assign(body,{resolution:form.resolution,resolution_amount:form.resolution_amount,resolution_ref:form.resolution_ref,resolution_ref_pending:form.resolution==='credit_note'&&form.resolution_ref_pending});
      await api.update(id,body);setConfirmClose(false);formDirty.current=false;onDirtyChange?.(proofDirty.current);await refresh();
    }catch(failure){setError(failure.response?.status===409?'เรื่องเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก':'บันทึกไม่ได้ ตรวจทางจบ เลขที่เอกสาร เหตุผล และหลักฐานคืนของ');}
    finally{lock.current=false;setBusy(false);}
  }
  async function saveReference(event){
    event.preventDefault();if(lock.current)return;
    if(!reference.trim()){setError('กรุณาใส่เลขที่ใบลดหนี้');return;}
    lock.current=true;setBusy(true);setError('');
    try{await api.update(id,{version:row.version,resolution_ref:reference.trim()});formDirty.current=false;onDirtyChange?.(false);setReference('');await refresh();}
    catch(failure){setError(failure.response?.status===409?'เรื่องเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก':'เพิ่มเลขที่ใบลดหนี้ไม่ได้ กรุณาลองใหม่');}
    finally{lock.current=false;setBusy(false);}
  }
  if(!row)return <section><button type="button" onClick={onBack}>กลับรายการ</button><p role={error?'alert':'status'}>{error||'กำลังโหลดเรื่อง…'}</p>{error&&<button type="button" className="ri-secondary" onClick={()=>{setError('');setReload(value=>value+1);}}>ลองโหลดเรื่องอีกครั้ง</button>}</section>;
  const closed=['resolved','cancelled'].includes(row.status);
  return <section className="ri-detail"><button type="button" className="ri-secondary" onClick={onBack}>กลับรายการ</button>
    <div className="ri-detail-heading"><span className="ri-type">{issueTypeLabel(row)}</span><h2>เรื่อง #{row.id} · {row.supplier_name || 'ยังไม่ระบุร้าน'}</h2><p className="ri-badge">{issueStatusLabel(row)}</p></div>
    <section className="ri-next-action" aria-label="งานถัดไป"><h3>งานถัดไป</h3><p>{issueNextAction(row,user)}</p><p className="ri-muted">{issueAgeLabel(row)} · ผู้รับผิดชอบ: {issueOwnerName(row)}</p><p className="ri-muted">กำหนดตาม {issueTime(row.due_at)}</p><p>{issueEvidenceLabel(row)}</p></section>
    {/* Walkthrough 2026-10-24: the action staff came for sits right under งานถัดไป, before the facts. */}
    {!closed&&canAttachIssue(user,row)&&<button type="button" aria-expanded={evidence} aria-controls={evidenceId} onClick={()=>{if(evidence&&proofDirty.current&&!window.confirm('มีหลักฐานยังไม่บันทึก ต้องการยกเลิกการกรอกหรือไม่?'))return;if(evidence)markProof(false);setEvidence(value=>!value);}}>{evidence?'ยกเลิกการกรอกหลักฐาน':evidenceAction(row)}</button>}
    <h3 className="receiving-bill-text">{row.product_name||'ทั้งเอกสาร'}</h3>{row.bill_text && row.bill_text !== row.product_name && <p className="ri-muted receiving-bill-text">ชื่อในบิล: {row.bill_text}</p>}
    <dl className="ri-facts">{[['ร้าน',row.supplier_name],['สาขา',issueBranchName(row)],['ใบรับ',row.document_id ? `#${row.document_id}` : 'ยังไม่ระบุ'],['เปิดเรื่อง',issueTime(row.created_at)],['จำนวน',issueQuantity(row)],['มูลค่า',issueAmount(row)],['ผู้รับผิดชอบ',issueOwnerName(row)],['กำหนดตาม',issueTime(row.due_at)],...receiptFacts(row)].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {row.request_items&&<ul className="receiving-bill-text">{row.request_items.map((item,index)=><li key={index}>{item.product_name} · {issueQuantity(item)}</li>)}</ul>}
    {!closed&&row.receipt_line?.return_status&&<p>{awaitingIssueReview(row)?'แนบหลักฐานแล้ว · รอบัญชีตรวจ':row.receipt_line.return_status==='collected'?'ร้านมารับแล้ว · กรุณาแนบหลักฐาน':'รอร้านมารับคืน'}</p>}
    {row.note&&!(row.receipt_line&&/^(เทียบบิล:|ตรวจสินค้าไม่ตรงจากใบรับ:|ไม่รับ · คืนร้าน|ไม่มีในบิล)/.test(row.note))&&!row.request_items&&<p className="receiving-bill-text">{row.note}</p>}{row.resolution&&<p>ทางจบ: {issueResolutions[row.resolution]} · {row.resolution_amount} บาท · {row.resolution_ref||(row.resolution==='credit_note'?'ยังไม่มีเลขที่ใบลดหนี้ · กรุณาใส่ภายหลัง':'—')}</p>}
    {evidence&&!closed&&<section id={evidenceId} className="ri-evidence-target" tabIndex={-1} aria-label="บันทึกหลักฐาน"><ReturnEvidenceForm issue={row} api={api} onSaved={()=>refresh(true)} onDirtyChange={markProof} /></section>}
    <details className="ri-evidence"><summary>หลักฐาน {row.evidence.length} ชุด · {row.type==='return'?'เปิดดูรูปและลายเซ็น':'เปิดดูหลักฐาน'}</summary>{!row.evidence.length&&<p className="ri-muted">ยังไม่มีหลักฐานที่บันทึก</p>}<div className="ri-proof-grid">{row.evidence.map(proof=><article key={proof.id}>
      <p>ผู้มารับ: {proof.collector_name||'ไม่ได้ระบุ'} · {issueTime(proof.created_at)}</p><p>{proof.note}</p>
      <ProofImage api={api} issueId={row.id} proof={proof} kind="image" />{proof.has_signature&&<ProofImage api={api} issueId={row.id} proof={proof} kind="signature" />}
    </article>)}</div></details>
    {canManageIssues(user)&&!closed&&<form className="ri-followup-form" onSubmit={save}><h3>ติดตามและปิดเรื่อง</h3><p className="ri-muted">ตรวจหลักฐานและเลือกทางจบก่อนยืนยันปิดเรื่อง</p><fieldset disabled={busy}>
      <div className="ri-fields"><label>ผู้รับผิดชอบ<select value={form.owner_user_id} onChange={e=>change('owner_user_id',e.target.value)}><option value="">ยังไม่มอบหมาย</option>{assignees.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label>ต้องตามภายใน<input type="datetime-local" required value={form.due_at} onChange={e=>change('due_at',e.target.value)} /></label></div>
      <label>สถานะ<select value={form.status} onChange={e=>change('status',e.target.value)}>{Object.entries(issueStatuses).filter(([v])=>!(row.status==='waiting_supplier'&&v==='open')).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      {form.status==='resolved'&&<><label>ทางจบ<select value={form.resolution} onChange={e=>{change('resolution',e.target.value);change('resolution_ref_pending',false);change('stock_return_quantity','');}}>{Object.entries(issueResolutions).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        {form.resolution==='returned' && <><p>ของที่ไม่เคยรับเข้าคลังไม่ต้องลดสต๊อก หากคืนของที่รับเข้าแล้ว ให้ระบุจำนวนหน่วยฐานด้านล่าง</p>
          <label>จำนวนคืนจากสต๊อก (หน่วยฐาน · เว้นว่างหากไม่ได้รับเข้าคลัง)<input inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.stock_return_quantity || ''} onChange={e=>change('stock_return_quantity',e.target.value)} /></label></>}
        <div className="ri-fields"><label>มูลค่าที่ตกลง (บาท)<input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.resolution_amount} onChange={e=>change('resolution_amount',e.target.value)} /></label>
        <label>เลขที่บิลใหม่ / ใบลดหนี้<input maxLength={255} disabled={form.resolution==='credit_note'&&form.resolution_ref_pending} value={form.resolution_ref} onChange={e=>change('resolution_ref',e.target.value)} /></label></div>
        {form.resolution==='credit_note'&&<><label className="ri-checkbox"><input type="checkbox" checked={form.resolution_ref_pending} onChange={e=>{change('resolution_ref_pending',e.target.checked);if(e.target.checked)change('resolution_ref','');}} />ยังไม่มีเลขที่ (ใส่ภายหลัง)</label>
          {form.resolution_ref_pending&&<p className="ri-warning" role="status">ปิดเรื่องตามข้อตกลงได้ แต่ยังขาดเลขที่ใบลดหนี้ เมื่อได้รับแล้วให้กลับมาใส่ในเรื่องนี้เพื่อให้บัญชีตรวจครบ</p>}</>}
        <p>เก็บข้อตกลงและหลักฐานไว้เพื่อตรวจบัญชี ยังไม่มีการลงบัญชีเจ้าหนี้อัตโนมัติ</p></>}
      <label>รายละเอียด / เหตุผล<textarea maxLength={1000} required={form.status==='cancelled'||(form.status==='resolved'&&form.resolution==='written_off')} value={form.note} onChange={e=>change('note',e.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy?'กำลังบันทึก…':form.status==='resolved'?'บันทึกทางจบและปิดเรื่อง':'บันทึกการติดตาม'}</button>
    </fieldset></form>}
    {closed&&row.status==='resolved'&&row.resolution==='credit_note'&&!row.resolution_ref&&<section aria-label="เลขที่ใบลดหนี้ที่ยังขาด"><p className="ri-warning">ยังขาดเลขที่ใบลดหนี้ กรุณาใส่ภายหลังเมื่อได้รับเอกสาร</p>
      {canManageIssues(user)&&<form onSubmit={saveReference}><label>เลขที่ใบลดหนี้<input maxLength={255} value={reference} onChange={e=>{setReference(e.target.value);formDirty.current=true;onDirtyChange?.(true);}} /></label><button type="submit" disabled={busy}>บันทึกเลขที่ใบลดหนี้</button></form>}</section>}
    {confirmClose&&<IssueCloseConfirmation issue={row} form={form} busy={busy} error={error} onCancel={()=>setConfirmClose(false)} onConfirm={persist} />}
    {error&&<p role="alert">{error}</p>}<button type="button" className="ri-secondary ri-refresh" aria-label="รีเฟรช" title="รีเฟรช" disabled={busy} onClick={()=>{if(formDirty.current||proofDirty.current){setError('บันทึกหรือยกเลิกข้อมูลที่กำลังกรอกก่อนรีเฟรช');return;}refresh().catch(()=>setError('รีเฟรชไม่สำเร็จ'));}}><Icon name="retry" /></button>
    <details><summary>ประวัติ {row.history.length} รายการ</summary><ol>{row.history.map(event=><li key={event.id}>{issueTime(event.created_at)} · {actionNames[event.action]||'เปลี่ยนแปลง'} · ผู้ใช้ {event.actor_user_id||'ระบบ'}
      {event.details.to&&` → ${issueStatuses[event.details.to]}`}{event.details.resolution&&` · ${issueResolutions[event.details.resolution]}`}{event.details.note&&<p>{event.details.note}</p>}</li>)}</ol></details>
  </section>;
}
