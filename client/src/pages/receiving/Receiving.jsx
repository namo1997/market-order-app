import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { masterAPI } from '../../api/master';
import { bangkokDate, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { CreateDocument } from './CreateDocument';
import { DocumentEditor } from './DocumentEditor';
import { GlassBar, PrimaryAction, IconButton, Icon, Segmented, EmptyState, Toast, MotionSwitch, useMotionPreference } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { thaiDate } from './receiving-status';
import './receiving.css';
import { ShopWorkspace } from './ShopWorkspace';
import { receivingFollowupsAPI as followupAPI } from '../../api/receiving-followups';
import { FollowupBell, FollowupDialog } from './FollowupBell';
import { SupplierLeadSettings } from './SupplierLeadSettings';
import { canManageFollowups, followupTime, hasPendingQuantity, sortShops } from './receiving-queue';
import { ReceivingInstallHint } from './ReceivingInstallHint';
import { readThemePreference, saveThemePreference, browserThemeStorage, applyThemePreference, readRootThemePreference, themeChangeEvent } from '../../design/theme-preference';

const statusLabels = { draft: 'ร่าง', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };


export function Receiving({ onDirtyChange, chrome = 'standalone' }) {
  const [motion, setMotion] = useMotionPreference();
  const [theme, setTheme] = useState(readRootThemePreference);
  const changeTheme = (value) => { setTheme(value); saveThemePreference(browserThemeStorage(), value); };
  useEffect(() => {
    applyThemePreference(theme);
  }, [theme]);
  useEffect(() => {
    const update = (event) => setTheme(event.type === themeChangeEvent ? event.detail : readThemePreference(browserThemeStorage()));
    window.addEventListener(themeChangeEvent, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(themeChangeEvent, update); window.removeEventListener('storage', update); };
  }, []);
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
  const [following, setFollowing] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followMessage, setFollowMessage] = useState('');
  const followLock = useRef(false);
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
  useEffect(() => { if (!doc && !creating) onDirtyChange?.(false); }, [doc, creating, onDirtyChange]);
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
  const changed = (next) => {
    setDocuments((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    // Confirmation (including recovery via reload) invalidates the old queue immediately.
    if (next.status === 'confirmed') refresh();
  };
  const pendingGroups = sortShops(groups.filter(group => group.items.some(hasPendingQuantity)));
  const waiting = pendingGroups.reduce((sum, group) => sum + group.items.filter(hasPendingQuantity).length, 0);
  const visible = documents.filter((item) => !filter || item.status === filter);
  const scopeReady = !isAdmin || (!!branchId && !!departmentId);
  const scopeUser = isAdmin ? { ...user, branch_id: branchId, department_id: departmentId,
    branch: branches.find((item) => String(item.id) === branchId)?.name || user.branch,
    department: departments.find((item) => String(item.id) === departmentId)?.name || user.department } : user;
  const selectedGroup = pendingGroups.find((group) => group.supplier_key === selected) || pendingGroups[0];
  const additionalGroups = settings && settingsDraft.date === date && settingsDraft.branchId === branchId && settingsDraft.departmentId === departmentId ? groups : [];
  const additionalGroup = additionalGroups.find(group => group.supplier_key === settingsDraft.additionalSupplier);
  const primary = () => {
    setTab(tab === 'expected' ? 'documents' : 'expected');
  };
  const applySettings = () => {
    setDate(settingsDraft.date); setBranchId(settingsDraft.branchId); setDepartmentId(settingsDraft.departmentId); setSelected(''); setSettings(false);
  };
  const follow = async note => {
    if (followLock.current) return;
    followLock.current = true; setFollowBusy(true); setFollowError('');
    try {
      const result = await followupAPI.followup({ supplier_key: following.supplier_key,
        branch_id: Number(branchId), department_id: Number(departmentId), note });
      setFollowMessage(result.created ? 'แจ้งบัญชีแล้ว' : `แจ้งไปแล้ว เวลา ${followupTime(result.followup.created_at)}`);
      setFollowing(null);
      window.dispatchEvent(new CustomEvent('focus'));
    } catch (failure) { setFollowError(errorText(failure)); }
    finally { followLock.current = false; setFollowBusy(false); }
  };
  const nextShop = () => {
    const currentKey = doc.product_group_id ? `pg:${doc.product_group_id}` : doc.supplier_master_id ? `sm:${doc.supplier_master_id}`
      : groups.find(group => group.supplier_name === doc.supplier_name_text)?.supplier_key || selected;
    const next = pendingGroups.find(group => group.supplier_key !== currentKey);
    setSelected(next?.supplier_key || ''); setTab('expected'); setDoc(null); refresh(); window.scrollTo(0, 0);
  };
  return <div className="solao rc-app sg-with-bar" data-chrome={chrome} data-motion={motion} lang="th">
    {chrome === 'standalone' && !doc && <header className="rc-topbar"><div className="rc-identity"><span className="rc-brand">SOLAO</span></div></header>}

    <main className="rc-main rc-stack">
      {chrome === 'standalone' && <ReceivingInstallHint />}
      {doc ? <DocumentEditor key={doc.id} initialDocument={doc} onDirtyChange={onDirtyChange} user={scopeUser} online={online} onChanged={changed} onNextShop={nextShop}
        nextShopStatus={loading ? 'loading' : error ? 'error' : pendingGroups.length ? 'pending' : 'complete'} onRefreshQueue={refresh}
        onBack={() => { setDoc(null); refresh(); window.scrollTo(0, 0); }} /> : <>
        <div className="rc-morning">{canManageFollowups(user) && <FollowupBell />}<h1>รอรับ {loading ? '—' : pendingGroups.length} ร้าน</h1><p>{thaiDate(date)}</p></div>
        <Segmented label="รายการรับสินค้า" value={tab} disabled={opening} onChange={(value) => { setTab(value); setSelected(''); }}
          options={[{ value: 'expected', label: 'รอรับ', icon: 'box' }, { value: 'documents', label: 'เอกสาร', icon: 'receipt' }]} />
        {!online ? <ReceivingIllustration state="offline" eager /> : error ? <ReceivingIllustration state="error" description={error} eager />
          : !loaded && loading ? <ReceivingIllustration state="welcome" pending eager /> : !scopeReady ? <ReceivingIllustration state="welcome" description="เปิดตัวเลือกเพื่อเลือกสาขาและแผนก" eager /> : null}
        {((loading && loaded) || opening) && <p role="status" className="rc-muted">{opening ? 'กำลังเปิด' : 'กำลังโหลด'}</p>}
        {!loading && !error && online && scopeReady && (tab === 'expected' ? <div className="rc-stack">
          {!pendingGroups.length && <ReceivingIllustration state="empty-today" eager title="รับครบทุกร้านแล้ว" description={date === bangkokDate() ? '' : 'ยังไม่มีของเข้าในวันที่เลือก'} />}
          {!!pendingGroups.length && <ShopWorkspace groups={pendingGroups} current={selected ? selectedGroup : null} waiting={waiting} onChoose={setSelected}
            onReceive={group => { setSelected(group.supplier_key); setCreating({ group }); }}
            onFollowup={group => { setFollowError(''); setFollowing(group); }} busy={followBusy} followupEnabled={date === bangkokDate()} />}
        </div> : <div className="rc-stack">
          <Segmented label="สถานะเอกสาร" value={filter} onChange={(value) => { setFilter(value); setSelected(''); }} options={[{ value: '', label: 'ทั้งหมด' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
          {!visible.length && (documents.length === 0 ? <ReceivingIllustration state="empty-today" eager title={date === bangkokDate() ? undefined : 'ยังไม่มีของเข้าในวันที่เลือก'} /> : <EmptyState title="ไม่มีเอกสารในสถานะนี้" />)}
          {visible.map((item) => <button key={item.id} type="button" className="rc-document-card" disabled={opening}
            aria-label={`เปิดเอกสาร #${item.id} ${item.supplier_name_text || 'ไม่ระบุผู้ส่ง'} ${statusLabels[item.status]}`} onClick={() => open(item.id)}>
            <span className="rc-document-heading"><Icon name="receipt" /><strong>{item.supplier_name_text || 'ไม่ระบุผู้ส่ง'}</strong><span>{statusLabels[item.status]}</span></span>
            <span className="rc-muted">#{item.id} {item.doc_ref || ''}</span>
            <span className="rc-money">{item.total == null ? '—' : formatBaht(scaledInteger(item.total))} บาท</span>
          </button>)}
        </div>)}
        {followMessage && <Toast>{followMessage}</Toast>}
        <GlassBar className="rc-receiving-actions">
          <IconButton icon="options" showLabel label="ตัวเลือก" disabled={opening} onClick={() => { setSettingsDraft({ date, branchId, departmentId }); setSettings(true); }} />
          {!error && online && <IconButton icon="retry" label="โหลดใหม่" disabled={loading || opening} onClick={refresh} />}
          <PrimaryAction icon={error || !online ? 'retry' : tab === 'expected' ? 'receipt' : 'box'} disabled={opening || !scopeReady || loading} onClick={error || !online ? () => failedDocumentId ? open(failedDocumentId) : refresh() : primary}>
            {error || !online ? 'ลองใหม่' : tab === 'expected' ? 'ดูเอกสาร' : 'ดูคิวรอรับ'}
          </PrimaryAction>
        </GlassBar>
      </>}
    </main>
    {following && <FollowupDialog group={following} busy={followBusy} error={followError} onSave={follow} onClose={() => { if (!followBusy) setFollowing(null); }} />}
    {settings && <ReceivingDialog title="ตัวเลือก" onClose={() => setSettings(false)} actions={<PrimaryAction onClick={applySettings}>ใช้ข้อมูล</PrimaryAction>}>
      <div className="rc-stack"><p className="rc-scope">{scopeUser.branch} / {scopeUser.department}</p><label>วันที่<input type="date" value={settingsDraft.date} onChange={(event) => { if (event.target.value) setSettingsDraft({ ...settingsDraft, date: event.target.value }); }} /></label>
        {isAdmin && <><label>สาขา<select value={settingsDraft.branchId} onChange={(event) => { setSettingsDraft({ ...settingsDraft, branchId: event.target.value, departmentId: '' }); setDepartments([]); }}>
          <option value="">เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>แผนก<select value={settingsDraft.departmentId} disabled={!settingsDraft.branchId} onChange={(event) => setSettingsDraft({ ...settingsDraft, departmentId: event.target.value })}>
            <option value="">เลือกแผนก</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {scopeError && <Toast status="error">{scopeError}</Toast>}
          {scopeError && <IconButton icon="retry" label="โหลดพื้นที่" onClick={() => setScopeRetry((current) => current + 1)} />}</>}
        {!!additionalGroups.length && <label>รับเพิ่มจากร้าน<select value={additionalGroup?.supplier_key || ''} onChange={event => setSettingsDraft({ ...settingsDraft, additionalSupplier: event.target.value })}>
          <option value="">ไม่อ้างอิงใบสั่ง</option>{additionalGroups.map(group => <option key={group.supplier_key} value={group.supplier_key}>{group.supplier_name}</option>)}
        </select></label>}
        <button type="button" className="rc-text-action" disabled={!online || (isAdmin && (!settingsDraft.branchId || !settingsDraft.departmentId))} onClick={() => { applySettings(); setCreating({ group: additionalGroup || null }); }}>{additionalGroup ? 'รับสินค้าเพิ่มจากร้านนี้' : 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'}</button>
        {isAdmin && <SupplierLeadSettings groups={additionalGroups} onSaved={refresh} />}
        <details className="sg-display-settings"><summary>การแสดงผล</summary><div className="rc-stack">
          <Segmented label="ธีม" value={theme} onChange={changeTheme} options={[{ value: 'auto', label: 'อัตโนมัติ' }, { value: 'light', label: 'สว่าง' }, { value: 'dark', label: 'มืด' }]} />
          <MotionSwitch value={motion} onChange={setMotion} />
        </div></details><p>{user.name}</p>{!scopeError && <Link to="/apps" className="rc-nav-link"><Icon name="back" />กลับเมนู</Link>}
      </div>
    </ReceivingDialog>}
    {creating && <CreateDocument online={online} onDirtyChange={onDirtyChange} group={creating.group} date={date} user={scopeUser} onClose={() => setCreating(null)} onCreated={(next) => {
      changed(next); setDoc(next); setCreating(null); window.scrollTo(0, 0);
    }} />}
  </div>;
}
