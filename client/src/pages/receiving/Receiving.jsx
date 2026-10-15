import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { masterAPI } from '../../api/master';
import { bangkokDate, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { CreateDocument } from './CreateDocument';
import { DocumentEditor } from './DocumentEditor';
import { ReceivingIcon } from './ReceivingIcon';
import './receiving.css';

const statusLabels = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };
const FONT = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap';

export function Receiving() {
  const { user, isAdmin } = useAuth();
  const [branchId, setBranchId] = useState(String(user.branch_id || ''));
  const [departmentId, setDepartmentId] = useState(String(user.department_id || ''));
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [scopeError, setScopeError] = useState('');
  const [scopeRetry, setScopeRetry] = useState(0);
  const [date, setDate] = useState(() => bangkokDate());
  const [groups, setGroups] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [creating, setCreating] = useState(null);
  const [doc, setDoc] = useState(null);
  const [opening, setOpening] = useState(false);
  const requestId = useRef(0);
  const openLock = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError('');
    if (isAdmin && (!branchId || !departmentId)) {
      setGroups([]); setDocuments([]); setLoading(false); return;
    }
    try {
      const scope = isAdmin ? { branch_id: Number(branchId), department_id: Number(departmentId) } : {};
      const [expected, list] = await Promise.all([api.expected(date, scope), api.list({ date, ...scope })]);
      if (id === requestId.current) { setGroups(expected); setDocuments(list); }
    } catch (failure) { if (id === requestId.current) setError(errorText(failure)); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [date, isAdmin, branchId, departmentId]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    Promise.all([masterAPI.getBranches(), branchId ? masterAPI.getDepartmentsByBranch(branchId) : Promise.resolve([])])
      .then(([nextBranches, nextDepartments]) => {
        if (active) { setBranches(nextBranches); setDepartments(nextDepartments); setScopeError(''); }
      }).catch(() => { if (active) setScopeError('โหลดสาขา / แผนกไม่ได้ กรุณาลองใหม่'); });
    return () => { active = false; };
  }, [isAdmin, branchId, scopeRetry]);
  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    const previous = document.title;
    document.title = 'รับสินค้า | SOLAO';
    if (!document.querySelector(`link[href="${FONT}"]`)) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = FONT; document.head.appendChild(link);
    }
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); document.title = previous; };
  }, []);
  const open = async (id) => {
    if (openLock.current) return;
    openLock.current = true; setOpening(true); setError('');
    try { setDoc(await api.get(id)); window.scrollTo(0, 0); }
    catch (failure) { setError(errorText(failure)); }
    finally { openLock.current = false; setOpening(false); }
  };
  const changed = (next) => setDocuments((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  const waiting = groups.reduce((sum, group) => sum + group.items.filter((item) => !item.is_received).length, 0);
  const visible = documents.filter((item) => !filter || item.status === filter);
  const scopeReady = !isAdmin || (!!branchId && !!departmentId);
  const scopeUser = isAdmin ? { ...user, branch_id: branchId, department_id: departmentId,
    branch: branches.find((item) => String(item.id) === branchId)?.name || user.branch,
    department: departments.find((item) => String(item.id) === departmentId)?.name || user.department } : user;
  return <div className="rc-app">
    <header className="rc-topbar">{doc ? <span className="rc-brand">SOLAO<span>รับสินค้า</span></span> : <Link to="/apps" aria-label="กลับหน้าทางลัด SOLAO" className="rc-brand">SOLAO<span>รับสินค้า</span></Link>}
      <div><strong>{user.name}</strong><span>{scopeUser.branch} · {scopeUser.department}</span></div></header>
    <main className="rc-main">
      {!online && <div className="rc-offline" role="alert"><strong>ออฟไลน์ · ยังส่งข้อมูลไม่ได้</strong><p>เปิดหน้านี้ค้างไว้ รูปที่เลือกยังอยู่ ลองส่งใหม่เมื่อเชื่อมต่อ คำขอสร้างจะใช้รหัสเดิม</p></div>}
      {doc ? <DocumentEditor key={doc.id} initialDocument={doc} user={scopeUser} onChanged={changed} onBack={() => { setDoc(null); refresh(); window.scrollTo(0, 0); }} /> : <>
        <section className="rc-hero">
          <div><p className="rc-eyebrow">พร้อมรับของเข้าร้าน</p><h1>ของมาถึงแล้ว<br /><span>รับให้ครบ จบในที่เดียว</span></h1><p>ถ่ายบิล · ตรวจของ · เซ็นรับ</p></div>
          <ReceivingIcon name="box" large />
          <div className="rc-hero-stats"><div><strong>{loading ? '—' : waiting}</strong><span>รายการรอรับ</span></div>
            <div><strong>{loading ? '—' : documents.filter((item) => item.status === 'confirmed').length}</strong><span>เอกสารยืนยัน</span></div>
            <div><strong>{loading ? '—' : documents.filter((item) => item.status === 'draft').length}</strong><span>เอกสารร่าง</span></div></div>
        </section>
        {isAdmin && <section className="rc-panel rc-scope"><h2>พื้นที่รับสินค้า</h2><p className="rc-muted">เลือกสาขาและแผนกก่อนเริ่ม เพื่อผูกเอกสารและใบสั่งให้ตรงกัน</p>
          <div className="rc-form-grid"><label>สาขา<select value={branchId} disabled={opening} onChange={(event) => { setBranchId(event.target.value); setDepartmentId(''); setDepartments([]); }}>
            <option value="">เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>แผนก<select value={departmentId} disabled={opening || !branchId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">เลือกแผนก</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          {scopeError && <p className="rc-error" role="alert">{scopeError}<button type="button" onClick={() => setScopeRetry((current) => current + 1)}>ลองโหลดพื้นที่ใหม่</button></p>}
        </section>}
        <div className="rc-date-row"><label>วันที่รับสินค้า<input type="date" value={date} disabled={loading || opening} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label>
          <button type="button" disabled={loading || opening} onClick={refresh}>↻ โหลดใหม่</button></div>
        {error && <p className="rc-error" role="alert">{error}</p>}
        {loading && <p className="rc-info" role="status">กำลังโหลดรายการรับสินค้า…</p>}
        {opening && <p className="rc-info" role="status">กำลังเปิดเอกสาร…</p>}
        {!loading && <>
          <section className="rc-section"><div className="rc-section-heading"><h2>ของที่ควรมาส่ง</h2><span className="rc-count">{groups.length} กลุ่ม</span></div>
            <p className="rc-muted">จัดกลุ่มตามซัพพลายเออร์ / กลุ่มสินค้าในใบสั่ง</p>
            {!groups.length ? <div className="rc-empty rc-panel"><ReceivingIcon name="empty" large /><h3>{error ? 'ยังโหลดรายการไม่ได้' : 'ยังไม่มีรายการที่ควรมาส่ง'}</h3><p>สร้างใบรับของเองได้เมื่อมีของมาส่ง</p></div>
              : <div className="rc-supplier-grid">{groups.map((group) => <article className="rc-panel rc-supplier" key={group.supplier_key}>
                <div className="rc-section-heading"><h3><ReceivingIcon name="box" />{group.supplier_name}</h3><span className="rc-count">{group.items.length}</span></div>
                <ul>{group.items.map((item) => <li key={item.order_item_id}><div><strong>{item.product_name}</strong><small>สั่ง {item.quantity_ordered} {item.unit_name} · รับแล้ว {item.received_quantity || '0'}</small></div>
                  <span className={`rc-status ${item.is_received ? 'confirmed' : 'draft'}`}>{item.is_received ? 'รับแล้ว' : 'รอรับ'}</span></li>)}</ul>
                <button type="button" className="rc-secondary rc-wide" disabled={opening || !scopeReady} onClick={() => setCreating({ group })}>รับของกลุ่มนี้ →</button>
              </article>)}</div>}
          </section>
          <section className="rc-section"><div className="rc-section-heading"><h2>{date === bangkokDate() ? 'เอกสารของวันนี้' : 'เอกสารวันที่เลือก'}</h2><span className="rc-muted">{documents.length} ฉบับ</span></div>
            <div className="rc-tabs" role="group" aria-label="กรองสถานะเอกสาร">{[['', 'ทั้งหมด'], ...Object.entries(statusLabels)].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
            {!visible.length ? <div className="rc-empty rc-panel"><ReceivingIcon name="empty" large /><h3>ยังไม่มีเอกสาร{filter ? `สถานะ${statusLabels[filter]}` : ''}</h3><p>เริ่มรับสินค้าเพื่อเก็บบิลและหลักฐานไว้ที่เดียว</p></div>
              : <div className="rc-document-list">{visible.map((item) => <button type="button" className="rc-document-card" key={item.id} disabled={opening} onClick={() => open(item.id)}>
                <span className="rc-document-mark"><ReceivingIcon name={item.status === 'confirmed' ? 'success' : 'box'} /></span>
                <span className="rc-document-copy"><strong>{item.supplier_name_text || 'ไม่ระบุผู้ส่งของ'}</strong><small>#{item.id} · {item.doc_ref || (item.kind === 'bill' ? 'ยังไม่ระบุเลขบิล' : 'ใบรับของ')}</small>
                  <span className={`rc-status ${item.status}`}>{statusLabels[item.status]}</span></span>
                <strong className="rc-document-money">{item.total == null ? '—' : formatBaht(scaledInteger(item.total))}<small>บาท →</small></strong>
              </button>)}</div>}
          </section>
        </>}
        <p className="rc-footer-note">รับด้วยความใส่ใจ · เก็บหลักฐานครบทุกครั้ง</p>
        <div className="rc-bottom-bar"><div><span>{date === bangkokDate() ? 'รับสินค้าเข้าร้าน' : `วันที่ ${date}`}</span><strong>พร้อมเมื่อของมาถึง</strong></div>
          <button type="button" className="rc-primary" disabled={opening || !scopeReady} onClick={() => setCreating({ group: null })}>＋ เริ่มรับสินค้า</button></div>
      </>}
    </main>
    {creating && <CreateDocument group={creating.group} date={date} user={scopeUser} onClose={() => setCreating(null)} onCreated={(next) => {
      changed(next); setDoc(next); setCreating(null); window.scrollTo(0, 0);
    }} />}
  </div>;
}
