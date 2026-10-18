import { receivingFollowupsAPI } from '../api/receiving-followups';
import { FollowupBell } from '../pages/receiving/FollowupBell';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {receivingIssuesAPI as api} from '../api/receiving-issues';
import {ReceivingIssueCreate} from './ReceivingIssueCreate';
import {ReceivingIssueDetail} from './ReceivingIssueDetail';
import {issueTypes,issueStatuses,issueAge,issueTime,issueTypeLabel,issueAmount,issueQuantity,isBillRequest,canManageIssues} from './issue-labels.mjs';
import './receiving-issues.css';
export function ReceivingIssues({embedded=false,onDirtyChange,initialId=null}) {
  const {user}=useAuth();const [items,setItems]=useState([]);const [next,setNext]=useState(null);
  const [filters,setFilters]=useState({status:'pending',type:'',supplier:'',branch_id:'',min_age_days:'',overdue:''});
  const [selected,setSelected]=useState(initialId || new URLSearchParams(window.location?.search || '').get('issue'));const [create,setCreate]=useState(false);
  const [busy,setBusy]=useState(true);const [error,setError]=useState('');const [dirty,setDirty]=useState(false);
  const followupId = !embedded && new URLSearchParams(window.location?.search || '').get('followup_id');
  const [linkedFollowup,setLinkedFollowup]=useState(null);
  const simple = embedded || !canManageIssues(user);
  const request=useRef(0);const filterKey=JSON.stringify(filters);
  const scopedFilters = simple ? {status:filters.status, branch_id:user?.branch_id} : filters;
  const markDirty=value=>{setDirty(value);onDirtyChange?.(value);};
  async function load(more=false){
    const current=++request.current;setBusy(true);setError('');
    try{const result=await api.list({...scopedFilters,...(more?{before_id:next}:{})});if(current===request.current){setItems(old=>more?[...old,...result.items]:result.items);setNext(result.next_before_id);}}
    catch{if(current===request.current)setError('โหลดรายการไม่ได้ กรุณาตรวจการเชื่อมต่อหรือเข้าสู่ระบบใหม่');}
    finally{if(current===request.current)setBusy(false);}
  }
  useEffect(()=>{
    if (!followupId) return;
    let active=true;setLinkedFollowup({loading:true});
    receivingFollowupsAPI.followups('pending').then(result=>{
      if(!active)return;
      const row=result.items?.find(item=>String(item.id)===followupId);
      setLinkedFollowup(row?{row}:{error:true});
      const issue=row?.pending_items?.find(item=>item.issue_id)?.issue_id;
      if(issue)setSelected(issue);
    }).catch(()=>{if(active)setLinkedFollowup({error:true});});
    return()=>{active=false;};
  },[followupId]);
  useEffect(()=>{load();return()=>{request.current++;};},[filterKey]);
  useEffect(()=>{const handler=event=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  const leave=action=>{if(!dirty||window.confirm('มีข้อมูลยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?')){markDirty(false);action();}};
  const filter=(key,value)=>setFilters(old=>({...old,[key]:value}));
  return <main className={`solao ri-page ${embedded?'ri-embedded':''}`}>
    {!embedded&&<a href="/receiving">กลับหน้ารับสินค้า</a>}
    <header>{['admin','super_admin','accounting','accountant'].includes(user?.role)&&<FollowupBell onOpenIssue={id=>leave(()=>setSelected(id))} />}<div><h1>ติดตามปัญหารับของ</h1><p>{simple ? 'เรื่องค้างของสาขาฉัน' : 'ตามเรื่องค้าง เก็บหลักฐาน และบันทึกทางจบ'}</p></div>{!selected&&!create&&<button onClick={()=>setCreate(true)}>เปิดเรื่องใหม่</button>}</header>
    {!selected && linkedFollowup && <section aria-label="เรื่องตามของที่อ้างอิง">
      {linkedFollowup.loading?<p role="status">กำลังโหลดเรื่องตามของ…</p>:linkedFollowup.error?<p role="alert">ไม่พบเรื่องตามของค้างในสิทธิ์ของคุณ</p>:<>
        <h2>เรื่องตามของ #{linkedFollowup.row.id} · {linkedFollowup.row.supplier_name}</h2>
        <p>{linkedFollowup.row.note}</p><ul>{linkedFollowup.row.pending_items.map(item=><li key={item.order_item_id}>{item.product_name} · {item.quantity_received ?? item.remaining_quantity ?? '—'} {item.unit_name}</li>)}</ul>
      </>}
    </section>}
    {selected?<ReceivingIssueDetail key={selected} id={selected} user={user} api={api} onDirtyChange={markDirty} onBack={()=>leave(()=>{setSelected(null);load();})} />:
      create?<ReceivingIssueCreate api={api} onDirtyChange={markDirty} onCancel={()=>leave(()=>setCreate(false))} onCreated={id=>{markDirty(false);setCreate(false);setSelected(id);load();}} />:<>
      {simple ? <nav className="ri-tabs" aria-label="สถานะเรื่อง"><button aria-pressed={filters.status === 'pending'} onClick={()=>filter('status','pending')}>ค้าง</button><button aria-pressed={filters.status === 'closed'} onClick={()=>filter('status','closed')}>ปิดแล้ว</button></nav> : <form className="ri-filters" onSubmit={e=>{e.preventDefault();load();}}>
        <label>สถานะ<select value={filters.status} onChange={e=>filter('status',e.target.value)}><option value="pending">เรื่องค้างทั้งหมด</option><option value="all">ทุกสถานะ</option>{Object.entries(issueStatuses).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <label>ประเภท<select value={filters.type} onChange={e=>filter('type',e.target.value)}><option value="">ทุกประเภท</option>{Object.entries(issueTypes).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
        <label>ร้าน<input maxLength={255} placeholder="ค้นชื่อร้าน" value={filters.supplier} onChange={e=>filter('supplier',e.target.value)} /></label>
        <label>รหัสสาขา<input type="number" min="1" value={filters.branch_id} onChange={e=>filter('branch_id',e.target.value)} /></label>
        <label>อายุเรื่องอย่างน้อย (วัน)<input type="number" min="1" max="3650" value={filters.min_age_days} onChange={e=>filter('min_age_days',e.target.value)} /></label>
        <label>กำหนดตาม<select value={filters.overdue} onChange={e=>filter('overdue',e.target.value)}><option value="">ทั้งหมด</option><option value="true">เลยกำหนด</option></select></label>
        <button disabled={busy}>โหลดรายการ</button>
      </form>}
      {error&&<p role="alert">{error}</p>}{busy&&<p role="status">กำลังโหลดรายการ…</p>}{!busy&&!error&&!items.length&&<p role="status">ไม่มีเรื่องตามตัวกรองนี้</p>}
      {simple ? <section className="ri-cards" aria-label={`รายการปัญหารับของ ${items.length} เรื่องที่โหลดแล้ว`}>
        {items.map(item=><article className="ri-issue-card" key={item.id}>
          <div className="ri-card-heading"><h2 className="receiving-bill-text">{item.product_name || 'ทั้งเอกสาร'}</h2><span>#{item.id} · {issueTypeLabel(item)}</span></div>
          <p>{item.supplier_name}</p>
          {item.bill_text && item.bill_text !== item.product_name && <p className="ri-muted receiving-bill-text">ชื่อในบิล: {item.bill_text}</p>}
          <p>{issueQuantity(item)} · {issueAmount(item)}</p>
          {isBillRequest(item) && item.request_items && <p className="receiving-bill-text">{item.note}</p>}
          <p>{issueStatuses[item.status]} · {item.owner_user_id ? `ผู้รับผิดชอบ #${item.owner_user_id}` : 'ยังไม่มอบหมาย'}</p>
          <p className="ri-muted">เปิดเรื่อง {issueTime(item.created_at)}</p>
          <p className="ri-muted">กำหนดตาม {issueTime(item.due_at)}</p>
          <button className="ri-secondary ri-open-issue" onClick={()=>setSelected(item.id)} aria-label={`เปิดเรื่อง ${item.id}`}>ดูเรื่อง</button>
        </article>)}
      </section> : <div className="ri-table-wrap"><table><caption>รายการปัญหารับของ {items.length} เรื่องที่โหลดแล้ว</caption><thead><tr><th>เรื่อง / ประเภท</th><th>ร้าน / สินค้า</th><th>สาขา</th><th>จำนวน / มูลค่า</th><th>สถานะ / ผู้รับผิดชอบ</th><th>กำหนดตาม / อายุ</th><th>จัดการ</th></tr></thead>
        <tbody>{items.map(item=><tr key={item.id} className={Date.parse(item.due_at)<Date.now()&&!['resolved','cancelled'].includes(item.status)?'ri-overdue':''}>
          <td data-label="เรื่อง / ประเภท">#{item.id} · {issueTypeLabel(item)}</td><td data-label="ร้าน / สินค้า">{item.supplier_name}<small className="receiving-bill-text">{item.product_name}</small></td>
          <td data-label="สาขา">{item.branch_id}</td><td data-label="จำนวน / มูลค่า">{issueQuantity(item)}<small>{issueAmount(item)}</small></td>
          <td data-label="สถานะ / ผู้รับผิดชอบ">{issueStatuses[item.status]}<small>{item.owner_user_id?`ผู้รับผิดชอบ #${item.owner_user_id}`:'ยังไม่มอบหมาย'}</small></td>
          <td data-label="กำหนดตาม / อายุ">{issueTime(item.due_at)}<small>{issueAge(item.created_at)} วัน</small></td>
          <td data-label="จัดการ"><button className="ri-secondary" onClick={()=>setSelected(item.id)} aria-label={`เปิดเรื่อง ${item.id}`}>เปิดเรื่อง</button></td></tr>)}</tbody></table></div>}
      {next&&<button disabled={busy} onClick={()=>load(true)}>โหลดเรื่องก่อนหน้า</button>}
    </>}
  </main>;
}
