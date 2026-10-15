import { useEffect, useMemo, useState } from 'react';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { MemoryRouter } from 'react-router-dom';
import { Receiving } from '../pages/receiving/Receiving';
import { ReceivingAuth } from './runtime.mjs';
import { setApiClient } from './client.mjs';
import { createTransport } from './transport.mjs';
import { createReceivingApi, normalizeBase } from './api.mjs';
import './style.css';
import { signInGoogle, signOutGoogle } from './google-auth.mjs';

const URL_KEY = 'receiving.apiBaseUrl';
const transport = createTransport({ isNative: () => Capacitor.isNativePlatform(), nativeRequest: options => CapacitorHttp.request(options) });

export function ReceivingApp() {
  const [base, setBase] = useState('');
  const [draftBase, setDraftBase] = useState('');
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const api = useMemo(() => createReceivingApi(base, transport, () => setUser(null)), [base]);
  useEffect(() => {
    let alive = true;
    Preferences.get({ key: URL_KEY }).then(({ value }) => {
      if (!alive) return;
      try { const url = normalizeBase(value || ''); setBase(url); setDraftBase(url); setSettings(!url); }
      catch { setSettings(true); }
      setReady(true);
    }).catch(() => { if (alive) { setSettings(true); setReady(true); } });
    let listener;
    Network.getStatus().then(s => { if (alive) setOnline(s.connected); });
    Network.addListener('networkStatusChange', s => { if (alive) setOnline(s.connected); }).then(handle => {
      if (alive) listener = handle; else handle.remove();
    });
    return () => { alive = false; listener?.remove(); };
  }, []);
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function saveSettings(event) {
    event.preventDefault();
    await run(async () => {
      const url = normalizeBase(draftBase);
      await Preferences.set({ key: URL_KEY, value: url });
      api.logout(); setUser(null); await signOutGoogle();
      setBase(url); setDraftBase(url); setSettings(!url);
    });
  }
  async function login(event) {
    event.preventDefault();
    await run(async () => { const idToken = await signInGoogle(); const nextUser = await api.loginGoogle(idToken); setApiClient(api.client); setUser(nextUser); });
  }
  if (!ready) return <main className="apk-shell"><p>กำลังเปิดแอป…</p></main>;
  return <><main className="apk-shell">
    <header><div className="mark" aria-hidden="true">ส</div><div><small>SOLAO · DEBUG</small><h1>รับสินค้า โซลาว</h1></div></header>
    <nav><span className={online ? 'online' : 'offline'}>{online ? '● ออนไลน์' : '● ออฟไลน์'}</span>
      <button className="secondary" disabled={busy} onClick={() => { setError(''); setSettings(!settings); }}>ตั้งค่า API</button></nav>
    {error && <p role="alert" className="error">{error}</p>}
    {settings ? <section><h2>เชื่อมต่อเซิร์ฟเวอร์</h2><p>ระบุที่อยู่ API ของระบบทดสอบ รวมพอร์ตถ้ามี โดยไม่ใส่ /api</p>
      <form onSubmit={saveSettings}><label>ที่อยู่ API<input type="url" value={draftBase} onChange={e => setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="http://192.168.1.10:3000" /></label>
      <p className="hint">HTTP ใช้ทดสอบ LAN ใน debug เท่านั้น</p><button disabled={busy}>บันทึกการตั้งค่า</button></form></section>
    : !user ? <section><h2>เข้าสู่ระบบ</h2><p>ใช้บัญชี Google ที่ผู้ดูแลเพิ่มสิทธิ์ให้ สาขาและแผนกจะมาจากบัญชีพนักงาน</p>
      {!import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID && <p role="alert">ผู้ดูแลต้องตั้งค่า Google Client ID ก่อนสร้างแอป</p>}
      <form onSubmit={login}><button disabled={busy || !base || !online || !import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID}>{busy ? 'กำลังเชื่อมต่อ…' : 'เข้าสู่ระบบด้วย Google'}</button></form></section>
    : <nav><span>{user.branch} · {user.department}</span><button className="secondary" disabled={busy} onClick={() => run(async () => { api.logout(); setUser(null); await signOutGoogle(); })}>ออกจากระบบ</button></nav>}
  </main>
  {user && <div hidden={settings}><ReceivingAuth value={{ user, isAdmin: ['admin', 'super_admin'].includes(user.role) }}>
    <MemoryRouter initialEntries={['/receiving']}><Receiving /></MemoryRouter>
  </ReceivingAuth></div>}
  </>;
}

