import { canReceiveBranch } from './receiving-branch';
import { BranchDocumentEditor } from './BranchDocumentEditor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { masterAPI } from '../../api/master';
import { bangkokDate, errorText, formatBaht, scaledInteger } from './receiving-utils';
import { ThaiDateField } from './ThaiDateField';
import { CreateDocument } from './CreateDocument';
import { reusableDraft } from './draft-reuse';
import { startReceiving } from './start-receiving';
import { useReceivingBack } from './use-receiving-back';
import { DocumentEditor } from './DocumentEditor';
import { GlassBar, PrimaryAction, IconButton, Icon, Segmented, EmptyState, Toast, MotionSwitch, useMotionPreference } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { ReceivingIllustration } from './ReceivingIllustration';
import { queueDisplayState } from './receiving-illustration-state';
import { thaiDate } from './receiving-status';
import './receiving.css';
import { ShopWorkspace } from './ShopWorkspace';
import { receivingFollowupsAPI as followupAPI } from '../../api/receiving-followups';
import { FollowupBell, FollowupDialog } from './FollowupBell';
import { SupplierLeadSettings } from './SupplierLeadSettings';
import { canManageFollowups, followupTime, hasPendingQuantity, shortShopName, sortShops } from './receiving-queue';
import { ReceivingInstallHint } from './ReceivingInstallHint';
import { readThemePreference, saveThemePreference, browserThemeStorage, applyThemePreference, readRootThemePreference, themeChangeEvent } from '../../design/theme-preference';

const statusLabels = { draft: 'ยังไม่เสร็จ', confirmed: 'ยืนยันแล้ว', void: 'ยกเลิก' };


export function Receiving({ onDirtyChange, onBackActionChange, onOpenIssues, chrome = 'standalone' }) {
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
  const [receiveScope, setReceiveScope] = useState('department');
  const branchScope = receiveScope === 'branch';
  const [branchId, setBranchId] = useState(String(user.branch_id || ''));
  const [departmentId, setDepartmentId] = useState(String(user.department_id || ''));
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [scopeError, setScopeError] = useState('');
  const [scopeRetry, setScopeRetry] = useState(0);
  const [date, setDate] = useState(() => bangkokDate());
  const [businessDate, setBusinessDate] = useState(() => bangkokDate());
  const [groups, setGroups] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [tab, setTab] = useState('expected');
  // Owner 2026-10-23 "เวอร์ชั่นแรกไม่ต้องขึ้นร้านที่ให้รับจากการสั่ง": staff start every receipt with "รับของใหม่";
  // the order queue keeps running in the background and shows only to administrators. One system setting, switchable.
  const [homeMode, setHomeMode] = useState('queue');
  const [homeModeBusy, setHomeModeBusy] = useState(false);
  const [homeModeMessage, setHomeModeMessage] = useState('');
  useEffect(() => {
    let alive = true;
    followupAPI.homeMode?.().then(result => { if (alive && result?.mode) setHomeMode(result.mode); }).catch(() => { /* keep the queue view */ });
    return () => { alive = false; };
  }, []);
  const newFirst = homeMode === 'new_first' && !isAdmin;
  const saveHomeMode = async value => {
    setHomeModeBusy(true); setHomeModeMessage('');
    try { const result = await followupAPI.setHomeMode(value); setHomeMode(result?.mode || value); setHomeModeMessage('บันทึกแล้ว · มีผลกับพนักงานทุกคนเมื่อเปิดแอปครั้งถัดไป'); }
    catch (failure) { setHomeModeMessage(errorText(failure)); }
    finally { setHomeModeBusy(false); }
  };
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
  const [queueError, setQueueError] = useState('');
  const [failedDocumentId, setFailedDocumentId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [creating, setCreating] = useState(null);
  const [doc, setDoc] = useState(null);
  const [opening, setOpening] = useState(false);
  const [scanEntry, setScanEntry] = useState(false);
  const [startError, setStartError] = useState('');
  const startLock = useRef(false);
  useReceivingBack(onBackActionChange, !doc && !creating && (settings || following) ? () => { setSettings(false); setFollowing(null); } : null, opening || followBusy);
  useEffect(() => { if (!doc && !creating) onDirtyChange?.(false); }, [doc, creating, onDirtyChange]);
  const requestId = useRef(0);
  const openLock = useRef(false);
  const queueRoot = useRef(null);
  // The selected shop name may wrap, especially with enlarged Thai text.
  useEffect(() => {
    const root = queueRoot.current;
    const bar = root?.querySelector?.('.rc-receiving-actions');
    if (!bar) return;
    // Owner 2026-10-24 "อย่าลืมปัจจัยคีย์บอร์ด": the home sheets (รับของใหม่, ตัวเลือก) also keep their
    // results and primary button above the on-screen keyboard on the web, where only the visual viewport shrinks.
    const viewport = window.visualViewport;
    const measure = () => {
      root.style.setProperty('--rc-queue-bar-height', `${bar.getBoundingClientRect().height}px`);
      root.style.setProperty('--rc-keyboard-offset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
      root.style.setProperty('--rc-visible-height', `${viewport?.height || window.innerHeight}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure); };
  }, [!!doc]);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true); setError(''); setQueueError(''); setStartError(''); setLoaded(false); setFailedDocumentId(null);
    if (isAdmin && (!branchId || (!branchScope && !departmentId))) {
      setGroups([]); setDocuments([]); setLoading(false); return;
    }
    try {
      const scope = { scope: receiveScope, ...(isAdmin ? { branch_id: Number(branchId), ...(!branchScope ? { department_id: Number(departmentId) } : {}) } : {}) };
      const [expected, list] = await Promise.all([api.expected(date, scope), api.list({ date, ...scope })]);
      if (id === requestId.current) { setGroups(expected); setDocuments(list); setLoaded(true); }
    } catch (failure) { if (id === requestId.current) setQueueError(errorText(failure)); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [date, isAdmin, branchId, departmentId, receiveScope, branchScope]);
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
    const updateDay = (forceRefresh = false) => {
      const today = bangkokDate();
      if (today !== businessDate) {
        setBusinessDate(today);
        // Follow the new day only when viewing today's live queue. Keep an
        // explicitly chosen historical date; its badges still use today's date.
        if (date === businessDate) { setDate(today); return; }
        refresh();
      } else if (forceRefresh) refresh();
    };
    const foreground = () => updateDay(true);
    const timer = setInterval(() => updateDay(), 30000);
    window.addEventListener('focus', foreground);
    document.addEventListener?.('visibilitychange', foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', foreground);
      document.removeEventListener?.('visibilitychange', foreground);
    };
  }, [businessDate, date, refresh]);
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
    try { setDoc(await api.get(id)); setScanEntry(false); window.scrollTo(0, 0); }
    catch (failure) { setError(errorText(failure)); setFailedDocumentId(id); }
    finally { openLock.current = false; setOpening(false); }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location?.search || '').get('document_id');
    if (/^[1-9]\d*$/.test(id || '') && Number.isSafeInteger(Number(id))) void open(id);
  }, []);
  const changed = (next) => {
    setDocuments((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    // Confirmation (including recovery via reload) invalidates the old queue immediately.
    if (next.status === 'confirmed') refresh();
  };
  const pendingGroups = sortShops(groups.filter(group => group.items.some(hasPendingQuantity)), businessDate);
  const waiting = pendingGroups.reduce((sum, group) => sum + group.items.filter(hasPendingQuantity).length, 0);
  const visible = documents.filter((item) => !filter || item.status === filter);
  const scopeReady = !isAdmin || (!!branchId && (branchScope || !!departmentId));
  const queueState = queueDisplayState({ loading, error: queueError, online, loaded, scopeReady });
  const queueReady = queueState === 'ready';
  const scopedUser = isAdmin ? { ...user, branch_id: branchId, department_id: departmentId,
    branch: branches.find((item) => String(item.id) === branchId)?.name || user.branch,
    department: departments.find((item) => String(item.id) === departmentId)?.name || user.department } : user;
  const scopeUser = { ...scopedUser, receiving_scope: receiveScope };
  const ReceiptEditor = doc?.scope === 'branch' ? BranchDocumentEditor : DocumentEditor;
  const selectedGroup = pendingGroups.find((group) => group.supplier_key === selected) || pendingGroups[0];
  const additionalGroups = settings && settingsDraft.date === date && settingsDraft.branchId === branchId && settingsDraft.departmentId === departmentId ? groups.filter(group => !group.summary_only) : [];
  const additionalGroup = additionalGroups.find(group => group.supplier_key === settingsDraft.additionalSupplier);
  // Scan-first: create the receipt with defaults (no setup sheet) and open the editor,
  // which starts the document scanner. An unsent request for another receipt falls back
  // to the setup sheet, which offers to resume it.
  const startShop = async (group, kind) => {
    if (startLock.current || opening) return;
    startLock.current = true; setOpening(true); setStartError(''); setError(''); setSelected(group.supplier_key);
    try {
      const result = await startReceiving({ api, group, kind, date, user: scopeUser, documents });
      if (result.needsSheet) { setCreating({ group }); return; }
      changed(result.document); setScanEntry(kind === 'bill'); setDoc(result.document); window.scrollTo(0, 0);
    } catch (failure) {
      setStartError(failure.response || failure.request ? errorText(failure) : 'สร้างเอกสารไม่ได้ เบราว์เซอร์ต้องรองรับ crypto.randomUUID และเปิดผ่าน HTTPS');
    } finally { startLock.current = false; setOpening(false); }
  };
  // The manual setup sheet stays available for the shop the footer would scan (item selection, shop name).
  const customGroup = settings && !additionalGroup && tab === 'expected' && selectedGroup && settingsDraft.date === date && settingsDraft.branchId === branchId && settingsDraft.departmentId === departmentId ? selectedGroup : null;
  // Owner 2026-10-22 (ก.): the big button always receives. With no shop chosen it starts a receipt from any
  // shop (no order, scan first); switching between queue and documents is the tabs' job only.
  // Each shop card scans its own bill; the footer only receives from a shop that is not in the queue.
  // A branch-wide receipt needs a queued shop, so there the footer still scans the chosen card.
  const primary = () => {
    if (branchScope && tab === 'expected' && selectedGroup) void startShop(selectedGroup, 'bill');
    else if (!branchScope) setCreating({ group: null, scanFirst: true });
    else setTab('expected');
  };
  const primaryLabel = newFirst ? 'รับของใหม่' : branchScope ? tab === 'expected' ? selectedGroup && queueReady ? `สแกนบิล ${selectedGroup.supplier_name}` : 'เลือกร้านที่จะรับก่อน' : 'ดูคิวรอรับ' : 'รับของจากร้านอื่น';
  const applySettings = () => {
    setDate(settingsDraft.date); setBranchId(settingsDraft.branchId); setDepartmentId(settingsDraft.departmentId); setSelected(''); setSettings(false);
  };
  const follow = async note => {
    if (followLock.current) return;
    followLock.current = true; setFollowBusy(true); setFollowError('');
    try {
      const result = await followupAPI.followup({ supplier_key: following.supplier_key,
        branch_id: Number(branchId), department_id: Number(departmentId), note });
      setFollowMessage(`${following.supplier_name} · ${result.created ? 'แจ้งบัญชีแล้ว' : `แจ้งไปแล้ว เวลา ${followupTime(result.followup.created_at)}`}`);
      setFollowing(null);
      window.dispatchEvent(new CustomEvent('focus'));
    } catch (failure) { setFollowError(errorText(failure)); }
    finally { followLock.current = false; setFollowBusy(false); }
  };
  // Owner 2026-10-23 UX test: "ไปร้านถัดไป" highlights the next card only; the details panel opens when the person taps a shop.
  const [focusOnly, setFocusOnly] = useState(false);
  const nextShopGroup = doc ? pendingGroups.find(group => group.supplier_key !== (doc.product_group_id ? `pg:${doc.product_group_id}` : doc.supplier_master_id ? `sm:${doc.supplier_master_id}` : '')) : null;
  const nextShop = () => {
    const currentKey = doc.product_group_id ? `pg:${doc.product_group_id}` : doc.supplier_master_id ? `sm:${doc.supplier_master_id}`
      : groups.find(group => group.supplier_name === doc.supplier_name_text)?.supplier_key || selected;
    const next = pendingGroups.find(group => group.supplier_key !== currentKey);
    setSelected(next?.supplier_key || ''); setFocusOnly(true); setTab('expected'); setDoc(null); setScanEntry(false); refresh(); window.scrollTo(0, 0);
  };
  return <div ref={queueRoot} className="solao rc-app sg-with-bar" data-queue-layout="compact" data-chrome={chrome} data-motion={motion} lang="th">
    {chrome === 'standalone' && !doc && <header className="rc-topbar"><div className="rc-identity"><span className="rc-brand">SOLAO</span></div></header>}

    <main className="rc-main rc-stack">
      {chrome === 'standalone' && <ReceivingInstallHint />}
      {doc ? <ReceiptEditor key={doc.id} initialDocument={doc} onDirtyChange={onDirtyChange} onBackActionChange={onBackActionChange} user={scopeUser} online={online} onChanged={changed} onNextShop={nextShop} nextShopName={nextShopGroup ? shortShopName(nextShopGroup.supplier_name) : ''}
        nextShopStatus={newFirst ? 'complete' : loading ? 'loading' : queueError ? 'error' : pendingGroups.length ? 'pending' : 'complete'} onRefreshQueue={refresh}
        onBack={() => { setDoc(null); setScanEntry(false); refresh(); window.scrollTo(0, 0); }} scanFirst={scanEntry} backLabel={newFirst ? 'หน้าแรก' : 'กลับคิว'} /> : <>
        <div className="rc-morning">{/* Review 2026-10-24: the heading keeps its own line; actions wrap below it on narrow phones instead of breaking the title. */}
          <h1>{newFirst ? 'รับสินค้า' : queueReady ? `รอรับ ${pendingGroups.length} ร้าน` : 'รอรับ'}</h1>
          <div className="rc-morning-actions">{canManageFollowups(user) && <FollowupBell onOpenIssue={chrome === 'embedded' ? undefined : id => { window.location.href = `/admin/receiving/issues?issue=${encodeURIComponent(id)}`; }} />}{chrome === 'embedded' && onOpenIssues && <button type="button" className="rc-text-action rc-issues-link" onClick={onOpenIssues}>ติดตามปัญหา / คืนของ</button>}{chrome !== 'embedded' && <a className="rc-text-action rc-issues-link" href="/admin/receiving/issues">ติดตามปัญหา / คืนของ</a>}</div>
          <p>{thaiDate(date)}</p></div>
        {followMessage && <div className="rc-followup-feedback"><Toast>{followMessage}</Toast></div>}
        {canReceiveBranch(user) && <Segmented className="rc-scope-filter" label="ขอบเขตรับสินค้า" value={receiveScope} disabled={opening || loading} onChange={value => { setReceiveScope(value); setSelected(''); setGroups([]); setDocuments([]); }}
          options={[{ value: 'department', label: 'แผนกของฉัน' }, { value: 'branch', label: 'ทั้งสาขา' }]} />}
        {!newFirst && <Segmented label="รายการรับสินค้า" value={tab} disabled={opening} onChange={(value) => { setTab(value); setSelected(''); }}
          options={[{ value: 'expected', label: 'รอรับ', icon: 'box' }, { value: 'documents', label: 'เอกสาร', icon: 'receipt' }]} />}
        {['error', 'offline'].includes(queueState) ? <div className="rc-queue-problem">
          <ReceivingIllustration state={queueState} title={queueState === 'error' ? 'โหลดคิวไม่สำเร็จ' : 'ยังเชื่อมต่อไม่ได้'} description={queueError || 'ตรวจการเชื่อมต่อก่อนรับสินค้า'} eager />
          <p>ยังไม่ทราบจำนวนร้านที่รอรับ</p>
          <button type="button" className="rc-text-action" disabled={loading || opening} onClick={refresh}>ลองโหลดอีกครั้ง</button>
        </div> : queueState === 'loading' ? (newFirst ? <p role="status" className="rc-muted">กำลังโหลด</p> : <ReceivingIllustration state="welcome" pending eager />) : queueState === 'scope' ? <ReceivingIllustration state="welcome" description="เปิดตัวเลือกเพื่อเลือกสาขาและแผนก" eager /> : null}
        {startError && <div className="rc-queue-problem" role="alert"><ReceivingIllustration state="error" title="เริ่มรับของไม่สำเร็จ" description={startError} eager /></div>}
        {error && <div className="rc-queue-problem"><ReceivingIllustration state="error" title="เปิดเอกสารไม่สำเร็จ" description={error} eager /><button type="button" className="rc-text-action" disabled={opening} onClick={() => open(failedDocumentId)}>ลองเปิดเอกสารอีกครั้ง</button></div>}
        {((loading && loaded) || opening) && <p role="status" className="rc-muted">{opening ? 'กำลังเปิด' : 'กำลังโหลด'}</p>}
        {newFirst && scopeReady && <div className="rc-home-new rc-stack" aria-label="รับของใหม่">
          <h2 className="rc-home-docs-title">{date === bangkokDate() ? 'ใบรับวันนี้' : `ใบรับ ${thaiDate(date)}`}{documents.length ? ` · ${documents.length} ใบ` : ''}</h2>
          {/* Owner 2026-10-24: an empty morning gets the same crate illustration as the queue, with one short line. */}
          {!documents.length && queueReady && <ReceivingIllustration state="empty-today" eager title="ยังไม่มีใบรับ" description="" />}
          {documents.length > 0 && <div className="rc-document-list">{documents.map((item) => <button key={item.id} type="button" className="rc-document-card" data-status={item.status} disabled={opening}
            aria-label={`เปิดเอกสาร #${item.id} ${item.supplier_name_text || 'ไม่ระบุผู้ส่ง'} ${statusLabels[item.status]}`} onClick={() => open(item.id)}>
            <span className="rc-document-heading"><strong>{shortShopName(item.supplier_name_text) || 'ไม่ระบุผู้ส่ง'}</strong><span className="rc-document-status">{statusLabels[item.status]}</span></span>
            <span className="rc-document-meta"><span className="rc-muted">#{item.id} · {item.kind === 'manual_receipt' ? 'ไม่มีบิล' : 'มีบิล'}{item.doc_ref ? ` · ${item.doc_ref}` : ''}</span>
            <span className="rc-money">{item.total == null ? 'ยังไม่มีราคา' : `${formatBaht(scaledInteger(item.total))} บาท`}</span></span>
            {item.status === 'draft' && <span className="rc-document-next" aria-hidden="true">ทำต่อ ›</span>}
          </button>)}</div>}
        </div>}
        {queueReady && !newFirst && (tab === 'expected' ? <div className="rc-stack">
          {!pendingGroups.length && <ReceivingIllustration state="empty-today" eager title={groups.length ? 'รับครบทุกร้านแล้ว' : date === bangkokDate() ? 'วันนี้ไม่มีคิวรับของ' : 'ยังไม่มีของเข้าในวันที่เลือก'} description={branchScope ? 'เปลี่ยนวันได้ในตัวเลือก หรือดูเอกสารที่แท็บด้านบน' : 'มีของมาส่งโดยไม่มีคิว กด “รับของจากร้านอื่น” ด้านล่างได้เลย'} />}
          {!!groups.length && <ShopWorkspace groups={groups} current={selected && !focusOnly ? selectedGroup : null} selectedKey={branchScope ? selectedGroup?.supplier_key : selected ? selectedGroup?.supplier_key : ''} waiting={waiting} onChoose={key => { setFocusOnly(false); setSelected(key); }} referenceDate={businessDate}
            onFollowup={group => { setFollowMessage(''); setFollowError(''); setFollowing(group); }} busy={followBusy}
            noBillGroup={selectedGroup} noBillDisabled={opening || !online || loading} onNoBill={group => void startShop(group, 'manual_receipt')} followupEnabled={!branchScope && date === bangkokDate()}
            onScan={group => void startShop(group, 'bill')} scanDisabled={opening || !online || loading} />}
        </div> : <div className="rc-stack">
          <Segmented label="สถานะเอกสาร" value={filter} onChange={(value) => { setFilter(value); setSelected(''); }} options={[{ value: '', label: 'ทั้งหมด' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
          {!visible.length && (documents.length === 0 ? <ReceivingIllustration state="empty-today" eager title={date === bangkokDate() ? undefined : 'ยังไม่มีของเข้าในวันที่เลือก'} /> : <EmptyState title="ไม่มีเอกสารในสถานะนี้" />)}
          {/* Owner 2026-10-22 redesign (mockup docs-A): compact rows in one list, short shop name, status as a coloured tag. */}
          {visible.length > 0 && <div className="rc-document-list">{visible.map((item) => <button key={item.id} type="button" className="rc-document-card" data-status={item.status} disabled={opening}
            aria-label={`เปิดเอกสาร #${item.id} ${item.supplier_name_text || 'ไม่ระบุผู้ส่ง'} ${statusLabels[item.status]}`} onClick={() => open(item.id)}>
            <span className="rc-document-heading"><strong>{shortShopName(item.supplier_name_text) || 'ไม่ระบุผู้ส่ง'}</strong><span className="rc-document-status">{statusLabels[item.status]}</span></span>
            <span className="rc-document-meta"><span className="rc-muted">#{item.id} · {item.kind === 'manual_receipt' ? 'ไม่มีบิล' : 'มีบิล'}{item.doc_ref ? ` · ${item.doc_ref}` : ''}</span>
            {/* Device test 072s: "— บาท" read as a broken amount; say plainly that no price is known yet. */}
            <span className="rc-money">{item.total == null ? 'ยังไม่มีราคา' : `${formatBaht(scaledInteger(item.total))} บาท`}</span></span>
            {item.status === 'draft' && <span className="rc-document-next" aria-hidden="true">ทำต่อ ›</span>}
          </button>)}</div>}
        </div>)}
        <GlassBar className="rc-receiving-actions">
          <IconButton icon="options" showLabel label="ตัวเลือก" disabled={opening} onClick={() => { setSettingsDraft({ date, branchId, departmentId }); setSettings(true); }} />
          {!queueError && !error && online && <IconButton icon="retry" showLabel className="rc-reload" label="โหลดใหม่" disabled={loading || opening} onClick={refresh} />}
          <PrimaryAction icon={error || queueError || !online ? 'retry' : !newFirst && branchScope && !(tab === 'expected' && selectedGroup) ? 'receipt' : 'scan'} disabled={opening || !scopeReady || (loading && !newFirst) || (!error && !queueError && online && branchScope && tab === 'expected' && !selectedGroup)} onClick={error || queueError || !online ? () => failedDocumentId ? open(failedDocumentId) : refresh() : primary}>
            {error || queueError || !online ? 'ลองใหม่' : primaryLabel}
          </PrimaryAction>
        </GlassBar>
      </>}
    </main>
    {following && <FollowupDialog group={following} busy={followBusy} error={followError} onSave={follow} onClose={() => { if (!followBusy) setFollowing(null); }} />}
    {settings && <ReceivingDialog title="ตัวเลือก" onClose={() => setSettings(false)} actions={<PrimaryAction onClick={applySettings}>ตกลง</PrimaryAction>}>
      <div className="rc-stack"><p className="rc-scope">{scopeUser.branch} / {scopeUser.department}</p><ThaiDateField value={settingsDraft.date} onChange={value => setSettingsDraft({ ...settingsDraft, date: value })} />
        {isAdmin && <><label>สาขา<select value={settingsDraft.branchId} onChange={(event) => { setSettingsDraft({ ...settingsDraft, branchId: event.target.value, departmentId: '' }); setDepartments([]); }}>
          <option value="">เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>แผนก<select value={settingsDraft.departmentId} disabled={!settingsDraft.branchId} onChange={(event) => setSettingsDraft({ ...settingsDraft, departmentId: event.target.value })}>
            <option value="">เลือกแผนก</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {scopeError && <Toast status="error">{scopeError}</Toast>}
          {scopeError && <IconButton icon="retry" label="โหลดพื้นที่" onClick={() => setScopeRetry((current) => current + 1)} />}</>}
        {!!additionalGroups.length && <label>รับเพิ่มจากร้าน<select value={additionalGroup?.supplier_key || ''} onChange={event => setSettingsDraft({ ...settingsDraft, additionalSupplier: event.target.value })}>
          <option value="">ไม่อ้างอิงใบสั่ง</option>{additionalGroups.map(group => <option key={group.supplier_key} value={group.supplier_key}>{shortShopName(group.supplier_name)}</option>)}
        </select></label>}
        {/* Owner 2026-10-24: in new_first mode the bottom bar's "รับของใหม่" already starts a receipt without an order. */}
        {!(newFirst && !additionalGroup) && <button type="button" className="rc-text-action" disabled={!online || (branchScope && !additionalGroup) || (isAdmin && (!settingsDraft.branchId || (!branchScope && !settingsDraft.departmentId)))} onClick={() => { applySettings(); setCreating({ group: additionalGroup || null, scanFirst: !additionalGroup }); }}>{additionalGroup ? 'รับสินค้าเพิ่มจากร้านนี้' : 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)'}</button>}
        {customGroup && <button type="button" className="rc-text-action" disabled={!online || opening} onClick={() => { setSettings(false); setCreating({ group: customGroup }); }}>ตั้งค่าใบรับเอง</button>}
        {customGroup && <p className="rc-muted">เลือกรายการเอง หรือแก้ชื่อร้าน · {customGroup.supplier_name}</p>}
        {branchScope && !additionalGroup && <p className="rc-muted">ใบรับทั้งสาขาต้องเลือกร้านและรายการใบสั่ง หากไม่มีใบสั่งให้เลือกแผนกของฉัน</p>}
        {isAdmin && <SupplierLeadSettings groups={additionalGroups} onSaved={refresh} />}
        {isAdmin && <details className="rc-home-mode"><summary>หน้าแรกของพนักงาน</summary><div className="rc-stack">
          <Segmented label="หน้าแรกของพนักงาน" value={homeMode} disabled={homeModeBusy} onChange={value => void saveHomeMode(value)}
            options={[{ value: 'new_first', label: 'รับของใหม่ก่อน' }, { value: 'queue', label: 'คิวจากใบสั่ง' }]} />
          <p className="rc-muted">{homeMode === 'new_first' ? 'พนักงานเห็นปุ่ม “รับของใหม่” กับใบรับวันนี้ · คิวจากใบสั่งทำงานเบื้องหลัง เห็นเฉพาะผู้ดูแล' : 'พนักงานเห็นการ์ดร้านที่รอรับจากใบสั่งเหมือนผู้ดูแล'}</p>
          {homeModeMessage && <p role="status">{homeModeMessage}</p>}
        </div></details>}
        <details className="sg-display-settings"><summary>การแสดงผล</summary><div className="rc-stack">
          <Segmented label="ธีม" value={theme} onChange={changeTheme} options={[{ value: 'auto', label: 'อัตโนมัติ' }, { value: 'light', label: 'สว่าง' }, { value: 'dark', label: 'มืด' }]} />
          <MotionSwitch value={motion} onChange={setMotion} />
        </div></details>{!scopeError && <Link to="/apps" className="rc-nav-link"><Icon name="back" />กลับเมนู</Link>}
      </div>
    </ReceivingDialog>}
    {creating && <CreateDocument online={online} onDirtyChange={onDirtyChange} onBackActionChange={onBackActionChange} existingDocument={reusableDraft(documents, { group: creating.group, date, user: scopeUser })} group={creating.group} groups={creating.group ? [] : pendingGroups} date={date} user={scopeUser} onClose={() => setCreating(null)} scanFirst={!!creating.scanFirst} onCreated={(next) => {
      changed(next); setScanEntry(!!creating.scanFirst && next.kind === 'bill'); setDoc(next); setCreating(null); window.scrollTo(0, 0);
    }} />}
  </div>;
}
