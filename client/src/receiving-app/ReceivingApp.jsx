import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { MemoryRouter } from 'react-router-dom';
import { Receiving } from '../pages/receiving/Receiving';
import { ReceivingAuth } from './runtime.mjs';
import { setApiClient } from './client.mjs';
import { createTransport } from './transport.mjs';
import { createReceivingApi, normalizeBase } from './api.mjs';
import { signInGoogle, signOutGoogle } from './google-auth.mjs';
import { PilotLogin } from './PilotLogin';
import { LeaveDialog } from './LeaveDialog';
import { createLeaveGuard } from './leave-guard.mjs';
import { connectShellTheme } from './shell-theme.mjs';
import { exitReceivingApp, setBackHandlerReady, setSystemTheme } from './native-shell.mjs';
import { browserThemeStorage, readThemePreference } from '../design/theme-preference.js';
import appIcon from '../assets/brand/app-icon-1024.png';
import './style.css';

const URL_KEY = 'receiving.apiBaseUrl';
const pilot = import.meta.env.VITE_RECEIVING_AUTH_MODE === 'pilot';
const transport = createTransport({ isNative: () => Capacitor.isNativePlatform(), nativeRequest: options => CapacitorHttp.request(options) });

function ShellMenu({ user, busy, theme, onTheme, onSettings, onLogout, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => { ref.current?.close(); previous?.focus?.(); };
  }, []);
  return <dialog className="apk-menu apk-shell" ref={ref} aria-labelledby="apk-menu-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="apk-menu-title">เมนูแอป</h2>
    <label>ธีม<select value={theme} onChange={event => onTheme(event.target.value)}>
      <option value="auto">อัตโนมัติ</option><option value="light">สว่าง</option><option value="dark">มืด</option>
    </select></label>
    <div className="apk-actions">
      <button className="secondary" disabled={busy} onClick={onSettings}>ตั้งค่า API</button>
      {user && <button className="secondary" disabled={busy} onClick={onLogout}>ออกจากระบบ</button>}
    </div>
    <details><summary>ข้อมูลแอป</summary><p>รุ่น 0.6.5-debug (14)</p><p>{pilot ? 'โหมดเลือกสาขาและแผนก' : 'โหมดบัญชี Google'}</p></details>
    <button className="secondary" onClick={onClose}>ปิดเมนู</button>
  </dialog>;
}

export function ReceivingApp() {
  const [base, setBase] = useState('');
  const [draftBase, setDraftBase] = useState('');
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(null);
  const [pageVersion, setPageVersion] = useState(0);
  const [theme, setTheme] = useState(() => readThemePreference(browserThemeStorage()));
  const themeController = useRef(null);
  const leaveAction = useRef(null);
  const unauthorized = useRef(null);
  const backAction = useRef(null);
  const runLock = useRef(false);
  const guardRef = useRef(null);
  if (!guardRef.current) guardRef.current = createLeaveGuard({ onPrompt: setPending, onLeave: action => leaveAction.current(action) });
  const guard = guardRef.current;
  const onDirtyChange = useCallback(value => guard.setDirty(value), [guard]);
  const api = useMemo(() => createReceivingApi(base, transport, () => unauthorized.current?.()), [base]);

  async function run(action) {
    if (runLock.current) return;
    runLock.current = true; setBusy(true); setError('');
    try { await action(); } catch { setError('ดำเนินการไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่'); }
    finally { runLock.current = false; setBusy(false); }
  }
  leaveAction.current = async action => {
    if (action.type === 'exit') { await exitReceivingApp(); return; }
    if (action.type === 'settings') {
      setPageVersion(value => value + 1); setSettings(true); setError(''); return;
    }
    // Persist a valid new origin before clearing the existing in-memory session.
    if (action.type === 'server') await Preferences.set({ key: URL_KEY, value: action.url });
    api.logout(); setUser(null); setApiClient(null);
    if (action.type === 'server') {
      setBase(action.url); setDraftBase(action.url); setSettings(!action.url);
    }
    await signOutGoogle();
  };
  unauthorized.current = () => {
    // The API already revoked its bearer. Keep unsent editor state mounted until
    // the employee explicitly leaves; a 401 must not silently erase their work.
    setError('หมดเวลาเข้าใช้งาน ข้อมูลที่ยังไม่ส่งยังอยู่ในหน้านี้ กรุณาออกแล้วเข้าใช้งานใหม่');
  };
  backAction.current = () => {
    if (busy || runLock.current) return;
    if (pending) { guard.stay(); return; }
    if (menu) { setMenu(false); return; }
    if (settings && base) { closeSettings(); return; }
    void run(() => guard.request({ type: 'exit' }));
  };

  useEffect(() => {
    themeController.current = connectShellTheme({ onTheme: (value, preference) => {
      setTheme(preference);
      void setSystemTheme(value).catch(() => setError('ปรับแถบระบบไม่สำเร็จ กรุณาเปิดแอปใหม่'));
    } });
    const back = () => backAction.current?.();
    const beforeUnload = event => { if (guard.isDirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('receivingBack', back);
    window.addEventListener('beforeunload', beforeUnload);
    void setBackHandlerReady(true).catch(() => setError('เชื่อมปุ่มย้อนกลับไม่สำเร็จ กรุณาเปิดแอปใหม่'));
    return () => {
      themeController.current?.destroy();
      window.removeEventListener('receivingBack', back);
      window.removeEventListener('beforeunload', beforeUnload);
      void setBackHandlerReady(false).catch(() => {});
    };
  }, [guard]);
  useEffect(() => {
    let alive = true;
    Preferences.get({ key: URL_KEY }).then(({ value }) => {
      if (!alive) return;
      try { const url = normalizeBase(value || ''); setBase(url); setDraftBase(url); setSettings(!url); }
      catch { setSettings(true); }
      setReady(true);
    }).catch(() => { if (alive) { setSettings(true); setReady(true); } });
    let listener;
    Network.getStatus().then(s => { if (alive) setOnline(s.connected); }).catch(() => { if (alive) setOnline(false); });
    Network.addListener('networkStatusChange', s => { if (alive) setOnline(s.connected); }).then(handle => {
      if (alive) listener = handle; else handle.remove();
    }).catch(() => { if (alive) setOnline(false); });
    return () => { alive = false; listener?.remove(); };
  }, []);

  function requestLeave(type) {
    setMenu(false);
    void run(() => guard.request({ type }));
  }
  function closeSettings() {
    guard.setDirty(Boolean(user));
    setPageVersion(value => value + 1);
    setDraftBase(base); setSettings(false); setError('');
  }
  async function saveSettings(event) {
    event.preventDefault();
    let url;
    try { url = normalizeBase(draftBase); }
    catch (failure) { setError(failure.message); return; }
    await run(() => guard.request({ type: 'server', url }));
  }
  function loggedIn(nextUser) {
    setApiClient(api.client);
    guard.setDirty(true); // Safe fallback for a page that ignores onDirtyChange.
    setUser(nextUser);
  }
  async function login(event) {
    event.preventDefault();
    await run(async () => { const idToken = await signInGoogle(); loggedIn(await api.loginGoogle(idToken)); });
  }
  if (!ready) return <main className="apk-shell"><p role="status">กำลังเปิดแอป…</p></main>;
  return <>
    <div className="apk-shell">
      <header className="apk-header"><img className="mark" src={appIcon} width="40" height="40" alt="SOLAO" />
        <div className="apk-identity"><h1>รับสินค้า</h1><small className="pilot-notice">ทดลองภายใน</small>
          {user && <p className="apk-scope">{user.branch} / {user.department}</p>}</div>
        <button className="secondary apk-menu-toggle" aria-label="เมนูแอป" aria-haspopup="dialog" aria-expanded={menu}
          disabled={busy} onClick={() => setMenu(true)}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14" /></svg></button>
      </header>
      {!online && <p className="offline" role="status">ออฟไลน์ ตรวจการเชื่อมต่อก่อนส่งข้อมูล</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {settings ? <section aria-labelledby="apk-settings-title"><h2 id="apk-settings-title">เชื่อมต่อเซิร์ฟเวอร์</h2><p>ระบุที่อยู่ API ของระบบทดสอบ</p>
        <form onSubmit={saveSettings}><label>ที่อยู่ API<input type="url" value={draftBase} onChange={e => setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="http://192.168.1.10:3000" /></label>
          <p className="hint">ไม่เติม /api ใช้ HTTP ได้เฉพาะเครือข่ายทดสอบ</p><button disabled={busy}>บันทึกการตั้งค่า</button></form>
        {base && <button className="secondary apk-cancel" disabled={busy} onClick={closeSettings}>กลับ</button>}
      </section>
      : !user && (pilot ? <PilotLogin key={base} api={api} online={online} busy={busy} onBusy={setBusy} onLogin={loggedIn} />
        : <section><h2>เข้าใช้งาน</h2><p>ใช้บัญชี Google ที่ผู้ดูแลเพิ่มสิทธิ์ให้</p>
          <form onSubmit={login}><button disabled={busy || !base || !online}>{busy ? 'กำลังเชื่อมต่อ…' : 'เข้าใช้งาน'}</button></form></section>)}
    </div>
    {user && <div hidden={settings}><ReceivingAuth value={{ user, isAdmin: ['admin', 'super_admin'].includes(user.role) }}>
      <MemoryRouter initialEntries={['/receiving']}><Receiving key={pageVersion} chrome="embedded" onDirtyChange={onDirtyChange} /></MemoryRouter>
    </ReceivingAuth></div>}
    {menu && <ShellMenu user={user} busy={busy} theme={theme} onTheme={value => { themeController.current?.set(value); setTheme(value); }}
      onSettings={() => requestLeave('settings')} onLogout={() => requestLeave('logout')} onClose={() => setMenu(false)} />}
    {pending && <LeaveDialog busy={busy} onStay={() => guard.stay()} onDiscard={() => run(() => guard.discard())} />}
  </>;
}
