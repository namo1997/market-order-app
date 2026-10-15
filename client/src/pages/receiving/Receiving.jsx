import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { masterAPI } from '../../api/master';
import { bangkokDate, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { CreateDocument } from './CreateDocument';
import { DocumentEditor } from './DocumentEditor';
import { GlassBar, PrimaryAction, IconButton, Icon, Segmented, ListCard, StatusPill, EmptyState, Toast } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { quantityStatus, thaiDate } from './receiving-status';
import './receiving.css';

const statusLabels = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };


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
  const [tab, setTab] = useState('expected');
  const [selected, setSelected] = useState('');
  const [settings, setSettings] = useState(false);
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
  const selectedGroup = groups.find((group) => group.supplier_key === selected);
  const selectedDocument = visible.find((item) => String(item.id) === selected);
  const primary = () => {
    if (tab === 'documents' && selectedDocument) open(selectedDocument.id);
    else setCreating({ group: tab === 'expected' ? selectedGroup || null : null });
  };
  return <div className="solao rc-app sg-with-bar" data-theme="auto" lang="th">
    <header className="rc-topbar"><span className="rc-brand">SOLAO</span><span>{scopeUser.branch} / {scopeUser.department}</span></header>
    <main className="rc-main rc-stack">
      {!online && <Toast status="review">ออฟไลน์ เปิดหน้านี้ไว้เพื่อส่งซ้ำ</Toast>}
      {doc ? <DocumentEditor key={doc.id} initialDocument={doc} user={scopeUser} onChanged={changed} onBack={() => { setDoc(null); refresh(); window.scrollTo(0, 0); }} /> : <>
        <header className="rc-heading"><div><p className="rc-muted">{thaiDate(date)}</p><h1>รับสินค้า</h1></div><span className="rc-metric">{loading ? '—' : waiting}<small>รอรับ</small></span></header>
        <Segmented label="รายการรับสินค้า" value={tab} disabled={opening} onChange={(value) => { setTab(value); setSelected(''); }}
          options={[{ value: 'expected', label: 'รอรับ', icon: 'box' }, { value: 'documents', label: 'เอกสาร', icon: 'receipt' }]} />
        {error && <Toast status="error">{error}</Toast>}
        {(loading || opening) && <p role="status" className="rc-muted">{opening ? 'กำลังเปิด' : 'กำลังโหลด'}</p>}
        {!scopeReady && <EmptyState title="เลือกพื้นที่" description="เปิดตัวเลือกเพื่อเลือกสาขาและแผนก" icon="supplier" />}
        {!loading && scopeReady && (tab === 'expected' ? <div className="rc-stack">
          {!groups.length && <EmptyState title="ไม่มีรายการรอรับ" icon="box" />}
          {groups.map((group) => <ListCard key={group.supplier_key} title={<label className="rc-choice"><input type="radio" name="supplier" checked={selected === group.supplier_key} onChange={() => setSelected(group.supplier_key)} />{group.supplier_name}</label>} subtitle={`${group.items.length} รายการ`} leading={<Icon name="supplier" />}>
            <ul className="rc-item-list">{group.items.map((item) => {
              const state = quantityStatus({ ...item, quantity_received: item.received_quantity || '0', unit_text: item.unit_name }, [{ ...item, received_quantity: '0' }]);
              return <li key={item.order_item_id}><span>{item.product_name}<small>{item.received_quantity || '0'} / {item.quantity_ordered} {item.unit_name}</small></span><StatusPill status={state.status}>{state.label}</StatusPill></li>;
            })}</ul>
          </ListCard>)}
        </div> : <div className="rc-stack">
          <Segmented label="สถานะเอกสาร" value={filter} onChange={(value) => { setFilter(value); setSelected(''); }} options={[{ value: '', label: 'ทั้งหมด' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
          {!visible.length && <EmptyState title="ยังไม่มีเอกสาร" />}
          {visible.map((item) => <ListCard key={item.id} title={<label className="rc-choice"><input type="radio" name="document" checked={selected === String(item.id)} onChange={() => setSelected(String(item.id))} />{item.supplier_name_text || 'ไม่ระบุผู้ส่ง'}</label>}
            subtitle={`#${item.id} ${item.doc_ref || ''}`} leading={<Icon name="receipt" />} trailing={<span>{statusLabels[item.status]}</span>}>
            <strong className="rc-money">{item.total == null ? '—' : formatBaht(scaledInteger(item.total))} บาท</strong>
          </ListCard>)}
        </div>)}
        <GlassBar>
          <IconButton icon="edit" label="ตัวเลือก" disabled={opening} onClick={() => setSettings(true)} />
          <IconButton icon="retry" label="โหลดใหม่" disabled={loading || opening} onClick={refresh} />
          <PrimaryAction icon={tab === 'documents' && selectedDocument ? 'receipt' : 'plus'} disabled={opening || !scopeReady || loading} onClick={primary}>
            {tab === 'documents' && selectedDocument ? 'เปิดเอกสาร' : selectedGroup && tab === 'expected' ? 'รับสินค้า' : 'สร้างใบรับ'}
          </PrimaryAction>
        </GlassBar>
      </>}
    </main>
    {settings && <ReceivingDialog title="ตัวเลือก" onClose={() => setSettings(false)} actions={<PrimaryAction onClick={() => setSettings(false)}>เสร็จ</PrimaryAction>}>
      <div className="rc-stack"><label>วันที่<input type="date" value={date} onChange={(event) => { if (event.target.value) { setDate(event.target.value); setSelected(''); } }} /></label>
        {isAdmin && <><label>สาขา<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setDepartmentId(''); setDepartments([]); setSelected(''); }}>
          <option value="">เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>แผนก<select value={departmentId} disabled={!branchId} onChange={(event) => { setDepartmentId(event.target.value); setSelected(''); }}>
            <option value="">เลือกแผนก</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {scopeError && <Toast status="error">{scopeError}</Toast>}
          {scopeError && <IconButton icon="retry" label="โหลดพื้นที่" onClick={() => setScopeRetry((current) => current + 1)} />}</>}
        <p>{user.name}</p>{!scopeError && <Link to="/apps" className="rc-nav-link"><Icon name="back" />กลับเมนู</Link>}
      </div>
    </ReceivingDialog>}
    {creating && <CreateDocument group={creating.group} date={date} user={scopeUser} onClose={() => setCreating(null)} onCreated={(next) => {
      changed(next); setDoc(next); setCreating(null); window.scrollTo(0, 0);
    }} />}
  </div>;
}
