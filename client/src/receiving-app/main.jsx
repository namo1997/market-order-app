import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { createReceivingApi, normalizeBase, bangkokDate } from './api.mjs';
import './style.css';

const URL_KEY = 'receiving.apiBaseUrl';
async function transport(options) {
  if (Capacitor.isNativePlatform()) return CapacitorHttp.request(options);
  const response = await fetch(options.url, {
    method: options.method, headers: options.headers,
    body: options.data ? JSON.stringify(options.data) : undefined,
    signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error',
  });
  return { status: response.status, data: await response.json() };
}

function ReceivingApp() {
  const [base, setBase] = useState('');
  const [draftBase, setDraftBase] = useState('');
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [user, setUser] = useState(null);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');
  const [groups, setGroups] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [preview, setPreview] = useState('');
  const fileInput = useRef(null);
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
  useEffect(() => {
    let alive = true;
    if (base) api.branches().then(data => { if (alive) setBranches(data); }).catch(() => {
      if (alive) setError('โหลดสาขาไม่สำเร็จ ตรวจสอบที่อยู่ API และเครือข่าย');
    });
    return () => { alive = false; };
  }, [base, api]);
  useEffect(() => {
    if (!preview.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message || 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function chooseBranch(id) {
    setBranch(id); setDepartment(''); setDepartments([]);
    if (id) await run(async () => setDepartments(await api.departments(id)));
  }
  async function loadExpected() {
    setLoaded(false); setGroups([]);
    const result = await api.expected();
    if (!Array.isArray(result) || result.some(g => !Array.isArray(g.items))) throw new Error('รูปแบบข้อมูลรับสินค้าไม่ถูกต้อง');
    setGroups(result); setLoaded(true);
  }
  async function saveSettings(event) {
    event.preventDefault();
    await run(async () => {
      const url = normalizeBase(draftBase);
      await Preferences.set({ key: URL_KEY, value: url });
      api.logout(); setUser(null); setGroups([]); setLoaded(false); setBranches([]);
      setDepartments([]); setBranch(''); setDepartment(''); setPreview('');
      setBase(url); setDraftBase(url); setSettings(!url);
    });
  }
  async function login(event) {
    event.preventDefault();
    await run(async () => { setUser(await api.login(Number(department))); await loadExpected(); });
  }
  async function takePhoto() {
    if (!Capacitor.isNativePlatform()) { fileInput.current.click(); return; }
    await run(async () => {
      const permission = await Camera.requestPermissions({ permissions: ['camera'] });
      if (permission.camera !== 'granted') throw new Error('กรุณาอนุญาตใช้กล้องในตั้งค่า Android');
      const photo = await Camera.getPhoto({ quality: 75, width: 1600, height: 1600,
        resultType: CameraResultType.Uri, source: CameraSource.Camera, saveToGallery: false });
      setPreview(photo.webPath || '');
    });
  }
  if (!ready) return <main><p>กำลังเปิดแอป…</p></main>;
  return <main>
    <header><div className="mark" aria-hidden="true">ส</div><div><small>SOLAO · DEBUG</small><h1>รับสินค้า โซลาว</h1></div></header>
    <nav><span className={online ? 'online' : 'offline'}>{online ? '● ออนไลน์' : '● ออฟไลน์'}</span>
      <button className="secondary" disabled={busy} onClick={() => { setError(''); setSettings(!settings); }}>ตั้งค่า API</button></nav>
    {error && <p role="alert" className="error">{error}</p>}
    {settings ? <section><h2>เชื่อมต่อเซิร์ฟเวอร์</h2><p>ระบุที่อยู่ API ของระบบทดสอบ รวมพอร์ตถ้ามี โดยไม่ใส่ /api</p>
      <form onSubmit={saveSettings}><label>ที่อยู่ API<input type="url" value={draftBase} onChange={e => setDraftBase(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="http://192.168.1.10:3000" /></label>
      <p className="hint">HTTP ใช้ทดสอบ LAN ใน debug เท่านั้น</p><button disabled={busy}>บันทึกการตั้งค่า</button></form></section>
    : !user ? <section><h2>เข้าสู่ระบบ</h2><p>เลือกสาขาและแผนกตามบัญชีระบบสั่งของเดิม</p><form onSubmit={login}>
      <label>สาขา<select required disabled={busy || !base} value={branch} onChange={e => chooseBranch(e.target.value)}><option value="">เลือกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>แผนก<select required disabled={busy || !branch} value={department} onChange={e => setDepartment(e.target.value)}><option value="">เลือกแผนก</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <button disabled={busy || !department || !online}>{busy ? 'กำลังเชื่อมต่อ…' : 'เข้าสู่ระบบ'}</button></form></section>
    : <><section><div className="section-heading"><h2>รายการรับของวันนี้</h2><button className="secondary" disabled={busy || !online} onClick={() => run(loadExpected)}>โหลดใหม่</button></div>
      <p>{bangkokDate()} · {user.branch} · {user.department}</p>
      {busy && <p role="status">กำลังโหลดข้อมูล…</p>}
      {loaded && !groups.length && <p>ไม่มีรายการที่ควรมาวันนี้</p>}
      {groups.map(group => <article key={group.supplier_key}><h3>{group.supplier_name}</h3><ul>{group.items.map(item => <li key={item.order_item_id}>
        <strong>{item.product_name}</strong><span>สั่ง {item.quantity_ordered} {item.unit_name} · รับแล้ว {item.received_quantity ?? '0'}{item.is_received ? ' ✓' : ''}</span>
      </li>)}</ul></article>)}
      <p className="hint">ต้นแบบเชื่อม API · หน้ารับของเต็มรูปแบบจะรวมในขั้นถัดไป</p></section>
      <section><h2>ทดลองกล้อง</h2><p>รูปตัวอย่างยังไม่ถูกอัปโหลดหรือบันทึกเข้าระบบ</p><button disabled={busy} onClick={takePhoto}>ถ่ายรูปบิล</button>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={e => {
          const file = e.target.files?.[0];
          if (file && file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024) { setPreview(URL.createObjectURL(file)); setError(''); }
          else if (file) setError('กรุณาเลือกรูปขนาดไม่เกิน 10 MB');
          e.target.value = '';
        }} />
        {preview && <><img className="preview" src={preview} alt="ตัวอย่างรูปบิลที่ถ่าย" /><button className="secondary" onClick={() => setPreview('')}>ล้างรูปตัวอย่าง</button></>}
      </section><button className="secondary" disabled={busy} onClick={() => { api.logout(); setUser(null); setGroups([]); setLoaded(false); setPreview(''); }}>ออกจากระบบ</button></>}
  </main>;
}

createRoot(document.getElementById('root')).render(<ReceivingApp />);
