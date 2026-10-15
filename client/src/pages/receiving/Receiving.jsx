import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { masterAPI } from '../../api/master';
import { bangkokDate, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { CreateDocument } from './CreateDocument';
import { DocumentEditor } from './DocumentEditor';
import { GlassBar, PrimaryAction, IconButton, Icon, Segmented, ListCard, StatusPill, EmptyState, Toast, MotionSwitch, useMotionPreference } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { quantityStatus, thaiDate } from './receiving-status';
import './receiving.css';
import { readThemePreference, saveThemePreference, browserThemeStorage } from '../../design/theme-preference';

const statusLabels = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };


export function Receiving() {
  const [motion, setMotion] = useMotionPreference();
  const [theme, setTheme] = useState(() => readThemePreference(browserThemeStorage()));
  const changeTheme = (value) => { setTheme(value); saveThemePreference(browserThemeStorage(), value); };
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
  const [settingsDraft, setSettingsDraft] = useState({});
  const optionsBranch = settings ? settingsDraft.branchId : branchId;
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failedDocumentId, setFailedDocumentId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [creating, setCreating] = useState(null);
  const [doc, setDoc] = useState(null);
  const [opening, setOpening] = useState(false);
  const requestId = useRef(0);
  const openLock = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setFailedDocumentId(null);
    if (isAdmin && (!branchId || !departmentId)) {
      setGroups([]); setDocuments([]); setLoading(false); return;
    }
    try {
      const scope = isAdmin ? { branch_id: Number(branchId), department_id: Number(departmentId) } : {};
      const [expected, list] = await Promise.all([api.expected(date, scope), api.list({ date, ...scope })]);
      if (id === requestId.current) { setGroups(expected); setDocuments(list); setLoaded(true); }
    } catch (failure) { if (id === requestId.current) setError(errorText(failure)); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [date, isAdmin, branchId, departmentId]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    Promise.all([masterAPI.getBranches(), optionsBranch ? masterAPI.getDepartmentsByBranch(optionsBranch) : Promise.resolve([])])
      .then(([nextBranches, nextDepartments]) => {
        if (active) { setBranches(nextBranches); setDepartments(nextDepartments); setScopeError(''); }
      }).catch(() => { if (active) setScopeError('โหลดสาขา / แผนกไม่ได้ กรุณาลองใหม่'); });
    return () => { active = false; };
  }, [isAdmin, optionsBranch, scopeRetry]);
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
    catch (failure) { setError(errorText(failure)); setFailedDocumentId(id); }
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
  return <div className="solao rc-app sg-with-bar" data-theme={theme} data-motion={motion} lang="th">
    <header className="rc-topbar"><span className="rc-brand">SOLAO</span><span>{scopeUser.branch} / {scopeUser.department}</span></header>

    <main className="rc-main rc-stack">
      {doc ? <DocumentEditor key={doc.id} initialDocument={doc} user={scopeUser} online={online} onChanged={changed} onBack={() => { setDoc(null); refresh(); window.scrollTo(0, 0); }} /> : <>
        <header className="rc-heading"><div><p className="rc-muted">{thaiDate(date)}</p><h1>รับสินค้า</h1></div><span className="rc-metric">{loading ? '—' : waiting}<small>รอรับ</small></span></header>
        <Segmented label="รายการรับสินค้า" value={tab} disabled={opening} onChange={(value) => { setTab(value); setSelected(''); }}
          options={[{ value: 'expected', label: 'รอรับ', icon: 'box' }, { value: 'documents', label: 'เอกสาร', icon: 'receipt' }]} />
        {!online ? <ReceivingIllustration state="offline" eager /> : error ? <ReceivingIllustration state="error" description={error} eager />
          : !loaded && loading ? <ReceivingIllustration state="welcome" pending eager /> : !scopeReady ? <ReceivingIllustration state="welcome" description="เปิดตัวเลือกเพื่อเลือกสาขาและแผนก" eager /> : null}
        {((loading && loaded) || opening) && <p role="status" className="rc-muted">{opening ? 'กำลังเปิด' : 'กำลังโหลด'}</p>}
        {!loading && !error && online && scopeReady && (tab === 'expected' ? <div className="rc-stack">
          {!groups.length && (documents.length === 0 ? <ReceivingIllustration state="empty-today" eager title={date === bangkokDate() ? undefined : 'ยังไม่มีของเข้าในวันที่เลือก'} /> : <EmptyState title="ไม่มีรายการรอรับ" icon="box" />)}
          {groups.map((group) => <ListCard key={group.supplier_key} title={<label className="rc-choice"><input type="radio" name="supplier" checked={selected === group.supplier_key} onChange={() => setSelected(group.supplier_key)} />{group.supplier_name}</label>} subtitle={`${group.items.length} รายการ`} leading={<Icon name="supplier" />}>
            <ul className="rc-item-list">{group.items.map((item) => {
              const state = quantityStatus({ ...item, quantity_received: item.received_quantity || '0', unit_text: item.unit_name }, [{ ...item, received_quantity: '0' }]);
              return <li key={item.order_item_id}><span>{item.product_name}</span><span className="rc-ledger-number">{item.received_quantity || '0'} / {item.quantity_ordered} {item.unit_name}<small><StatusPill status={state.status}>{state.label}</StatusPill></small></span></li>;
            })}</ul>
          </ListCard>)}
        </div> : <div className="rc-stack">
          <Segmented label="สถานะเอกสาร" value={filter} onChange={(value) => { setFilter(value); setSelected(''); }} options={[{ value: '', label: 'ทั้งหมด' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
          {!visible.length && (documents.length === 0 ? <ReceivingIllustration state="empty-today" eager title={date === bangkokDate() ? undefined : 'ยังไม่มีของเข้าในวันที่เลือก'} /> : <EmptyState title="ไม่มีเอกสารในสถานะนี้" />)}
          {visible.map((item) => <ListCard key={item.id} title={<label className="rc-choice"><input type="radio" name="document" checked={selected === String(item.id)} onChange={() => setSelected(String(item.id))} />{item.supplier_name_text || 'ไม่ระบุผู้ส่ง'}</label>}
            subtitle={`#${item.id} ${item.doc_ref || ''}`} leading={<Icon name="receipt" />} trailing={<span>{statusLabels[item.status]}</span>}>
            <strong className="rc-money">{item.total == null ? '—' : formatBaht(scaledInteger(item.total))} บาท</strong>
          </ListCard>)}
        </div>)}
        <GlassBar>
          <IconButton icon="edit" label="ตัวเลือก" disabled={opening} onClick={() => { setSettingsDraft({ date, branchId, departmentId }); setSettings(true); }} />
          {!error && online && <IconButton icon="retry" label="โหลดใหม่" disabled={loading || opening} onClick={refresh} />}
          <PrimaryAction icon={error || !online ? 'retry' : tab === 'documents' && selectedDocument ? 'receipt' : 'plus'} disabled={opening || !scopeReady || loading} onClick={error || !online ? () => failedDocumentId ? open(failedDocumentId) : refresh() : primary}>
            {error || !online ? 'ลองใหม่' : tab === 'documents' && selectedDocument ? 'เปิดเอกสาร' : selectedGroup && tab === 'expected' ? 'รับสินค้า' : 'สร้างใบรับ'}
          </PrimaryAction>
        </GlassBar>
      </>}
    </main>
    {settings && <ReceivingDialog title="ตัวเลือก" onClose={() => setSettings(false)} actions={<PrimaryAction onClick={() => { setDate(settingsDraft.date); setBranchId(settingsDraft.branchId); setDepartmentId(settingsDraft.departmentId); setSelected(''); setSettings(false); }}>ใช้ข้อมูล</PrimaryAction>}>
      <div className="rc-stack"><label>วันที่<input type="date" value={settingsDraft.date} onChange={(event) => { if (event.target.value) setSettingsDraft({ ...settingsDraft, date: event.target.value }); }} /></label>
        {isAdmin && <><label>สาขา<select value={settingsDraft.branchId} onChange={(event) => { setSettingsDraft({ ...settingsDraft, branchId: event.target.value, departmentId: '' }); setDepartments([]); }}>
          <option value="">เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>แผนก<select value={settingsDraft.departmentId} disabled={!settingsDraft.branchId} onChange={(event) => setSettingsDraft({ ...settingsDraft, departmentId: event.target.value })}>
            <option value="">เลือกแผนก</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {scopeError && <Toast status="error">{scopeError}</Toast>}
          {scopeError && <IconButton icon="retry" label="โหลดพื้นที่" onClick={() => setScopeRetry((current) => current + 1)} />}</>}
        <details className="sg-display-settings"><summary>การแสดงผล</summary><div className="rc-stack">
          <Segmented label="ธีม" value={theme} onChange={changeTheme} options={[{ value: 'auto', label: 'อัตโนมัติ' }, { value: 'light', label: 'สว่าง' }, { value: 'dark', label: 'มืด' }]} />
          <MotionSwitch value={motion} onChange={setMotion} />
        </div></details><p>{user.name}</p>{!scopeError && <Link to="/apps" className="rc-nav-link"><Icon name="back" />กลับเมนู</Link>}
      </div>
    </ReceivingDialog>}
    {creating && <CreateDocument online={online} group={creating.group} date={date} user={scopeUser} onClose={() => setCreating(null)} onCreated={(next) => {
      changed(next); setDoc(next); setCreating(null); window.scrollTo(0, 0);
    }} />}
  </div>;
}
