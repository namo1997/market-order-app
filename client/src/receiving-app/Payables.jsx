import { useEffect, useRef, useState } from 'react';
import { receivingPayablesAPI as payablesAPI } from '../api/receiving-payables';
import { receivingAdminAPI } from '../api/receiving-admin';
import { compressImage } from '../pages/receiving/image-utils';
import { baht, billState, currentPeriod, formBody, lineText, message, rateLimited } from './payables-logic.mjs';
// Same capture as receiving and bill training: Google document scanner (crop/flatten), camera fallback. Loaded on tap.
const loadCapture = async () => (await import('./native-capture.mjs')).captureImage;

// Owner 2026-11-02 "ระบบรวบรวมเจ้าหนี้ … 1.เลือกซัพ 2.ถ่ายรูปบิล 3.ai ประมวลผลพร้อมจำนวนราคาเลย เพื่อความรวดเร็ว":
// accounting only. Photograph → read with prices → check → save, then straight to the next bill of the same shop.
// Home shows what is owed per supplier for the month. Nothing here touches receipts or stock.
export { canCollectPayables } from './payables-logic.mjs';
const formOf = bill => ({ doc_ref: bill?.doc_ref || '', doc_date: bill?.doc_date || '', total: bill?.total === null || bill?.total === undefined ? '' : String(bill.total) });

function BillPage({ id, page, label }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true; let made = '';
    payablesAPI.page(id, page).then(blob => { if (!alive) return; made = URL.createObjectURL(blob); setUrl(made); }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id, page]);
  return url ? <a className="ap-page" href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} /></a> : <span className="ap-page ap-page-empty">{label}</span>;
}

export function Payables({ onBack }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState('home');
  const [q, setQ] = useState('');
  const [shops, setShops] = useState(null);
  const [shop, setShop] = useState(null);
  const [bills, setBills] = useState(null);
  const [bill, setBill] = useState(null);
  const [form, setForm] = useState(formOf(null));
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [queue, setQueue] = useState(0);
  const [tick, setTick] = useState(0);
  const filePick = useRef(null);
  const afterPick = useRef(null);
  const reads = useRef(Promise.resolve());
  const queued = useRef(new Set());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  const loadSummary = () => run(async () => setSummary(await payablesAPI.summary(period)));
  useEffect(() => { loadSummary(); }, [period]);
  // Web fallback: closing the file picker without a photo resolves the capture with nothing.
  useEffect(() => {
    const input = filePick.current;
    const cancel = () => { afterPick.current?.(null); afterPick.current = null; };
    input?.addEventListener?.('cancel', cancel);
    return () => input?.removeEventListener?.('cancel', cancel);
  }, []);

  // A read finished in the background: refresh the totals and the open shop's list.
  useEffect(() => {
    if (!tick) return;
    payablesAPI.summary(period).then(setSummary).catch(() => {});
    if (view === 'shop' && shop) payablesAPI.bills({ period, supplier_key: shop.supplier_key }).then(result => setBills(result.items)).catch(() => {});
  }, [tick]);

  const showBill = next => { setBill(next); setForm(formOf(next)); setView('bill'); };
  // Capture a page: native scanner when present, otherwise the file picker (web / no plugin).
  const capture = async () => {
    try {
      const captureImage = await loadCapture();
      if (captureImage) return await captureImage();
    } catch (err) { setError(message(err)); return null; }
    return new Promise(resolve => { afterPick.current = resolve; filePick.current?.click(); });
  };
  const sendPage = async (target, pageNo) => {
    const file = await capture();
    if (!file) return null;
    setReading(true); setView('bill'); setBill(current => current || target);
    try {
      const image = await compressImage(file);
      await payablesAPI.uploadPage(target.id, pageNo, image.dataUrl);
      const read = await payablesAPI.read(target.id);
      showBill(read);
      return read;
    } finally { setReading(false); }
  };
  // A new bill for the shop: create, photograph, read. Cancelling the camera leaves nothing behind.
  const newBill = async picked => {
    setShop(picked);
    const created = await payablesAPI.create(picked.supplier_key);
    const read = await sendPage(created, 1);
    if (!read) { await payablesAPI.remove(created.id); setBill(null); setView(bills ? 'shop' : 'home'); }
  };
  // Reads run one at a time behind the camera, so photographing never waits for the AI.
  const readLater = id => {
    queued.current.add(id); setQueue(count => count + 1);
    reads.current = reads.current.then(async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try { await payablesAPI.read(id); return; } catch (err) {
          if (!rateLimited(err)) return;
          await new Promise(resolve => setTimeout(resolve, 20000));
        }
      }
    }).finally(() => { queued.current.delete(id); if (alive.current) { setQueue(count => count - 1); setTick(count => count + 1); } });
  };
  // Owner 2026-11-03 "เพิ่มปุ่มถ่ายบิลเพิ่ม": keep this bill as it is, then photograph more bills of the same shop one after
  // another until the camera is closed; each is read in the background and checked later from the shop's list.
  const captureMore = () => run(async () => {
    const target = shop || { supplier_key: bill.supplier_key, name: bill.supplier_name };
    if (bill && JSON.stringify(form) !== JSON.stringify(formOf(bill))) await payablesAPI.update(bill.id, formBody(form, bill.status));
    setShop(target); setBill(null); setDone('');
    setBills((await payablesAPI.bills({ period, supplier_key: target.supplier_key })).items); setView('shop');
    for (let count = 1; ; count += 1) {
      const file = await capture();
      if (!file) break;
      const created = await payablesAPI.create(target.supplier_key);
      try {
        const image = await compressImage(file);
        await payablesAPI.uploadPage(created.id, 1, image.dataUrl);
      } catch (err) { await payablesAPI.remove(created.id).catch(() => {}); throw err; }
      readLater(created.id);
      setDone(`ถ่ายแล้ว ${count} ใบ`);
    }
    setBills((await payablesAPI.bills({ period, supplier_key: target.supplier_key })).items);
  });
  const readNow = () => run(async () => {
    setReading(true);
    try { showBill(await payablesAPI.read(bill.id)); } finally { setReading(false); }
  });
  const startBill = picked => run(async () => { setDone(''); await newBill(picked); });
  const addPage = () => run(async () => { await sendPage(bill, (bill.pages?.length || 0) + 1); });
  const retake = () => run(async () => { await sendPage(bill, 1); });
  const save = next => run(async () => {
    const saved = await payablesAPI.update(bill.id, formBody(form, 'saved'));
    setDone(`บันทึกแล้ว · ${saved.supplier_name} ${baht(saved.total)}`);
    setSummary(await payablesAPI.summary(period));
    setBill(null);
    if (next) await newBill(shop || { supplier_key: saved.supplier_key, name: saved.supplier_name });
    else setView('home');
  });
  const remove = () => run(async () => {
    await payablesAPI.remove(bill.id);
    setDone('ลบบิลแล้ว'); setBill(null); setSummary(await payablesAPI.summary(period));
    if (shop && bills) setBills((await payablesAPI.bills({ period, supplier_key: shop.supplier_key })).items); setView(shop && bills ? 'shop' : 'home');
  });
  const searchShops = event => { event.preventDefault(); run(async () => setShops((await receivingAdminAPI.suppliers({ q: q.trim() })).items || [])); };
  const openShop = row => run(async () => {
    const picked = { supplier_key: row.supplier_key, name: row.supplier_name };
    setShop(picked); setBills((await payablesAPI.bills({ period, supplier_key: row.supplier_key })).items); setView('shop');
  });
  const openBill = id => run(async () => showBill(await payablesAPI.get(id)));
  const home = () => { setView('home'); setBill(null); setBills(null); setShop(null); setShops(null); setQ(''); };

  const head = (title, back) => <header className="bt-head"><h2 id="ap-title">{title}</h2><button type="button" className="secondary" disabled={busy || reading} onClick={back}>กลับ</button></header>;
  const recent = summary?.shops || [];
  return <section className="bt-page ap-page-root" aria-labelledby="ap-title">
    <input ref={filePick} type="file" accept="image/*" capture="environment" hidden onChange={event => { const file = event.target.files?.[0] || null; event.target.value = ''; afterPick.current?.(file); afterPick.current = null; }} />
    {view === 'home' && <>
      {head('รวบรวมเจ้าหนี้', onBack)}
      <label className="ap-month">เดือน<input type="month" value={period} disabled={busy} onChange={event => event.target.value && setPeriod(event.target.value)} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      {done && <p role="status" className="bt-done">{done}</p>}
      {queue > 0 && <p role="status" className="ap-queue">กำลังอ่าน {queue} ใบ</p>}
      <div className="ap-total" aria-label="ยอดค้างจ่ายรวม"><span>ค้างจ่ายรวม</span><strong>{baht(summary?.total ?? 0)}</strong><small>{summary?.bill_count ?? 0} บิล{summary?.draft_count ? ` · ยังไม่บันทึก ${summary.draft_count}` : ''}{summary?.missing_total_count ? ` · ไม่มียอด ${summary.missing_total_count}` : ''}</small></div>
      <button type="button" className="ap-primary" disabled={busy} onClick={() => { setShops(null); setQ(''); setView('pick'); }}>ถ่ายบิล</button>
      {recent.length ? <ul className="ap-shops">{recent.map(row => <li key={row.supplier_key}>
        <button type="button" className="secondary" disabled={busy} onClick={() => openShop(row)}><span>{row.supplier_name}<small>{row.bill_count} บิล{row.draft_count ? ` · ยังไม่บันทึก ${row.draft_count}` : ''}</small></span><strong>{baht(row.total)}</strong></button>
      </li>)}</ul> : summary && <p className="bt-hint">ยังไม่มีบิลเดือนนี้</p>}
    </>}
    {view === 'pick' && <>
      {head('เลือกร้าน', home)}
      {error && <p role="alert" className="error">{error}</p>}
      <form onSubmit={searchShops} className="ap-search"><input aria-label="ค้นหาร้าน" value={q} onChange={event => setQ(event.target.value)} placeholder="ชื่อร้านหรือรหัสซัพ" autoFocus /><button disabled={busy}>ค้นหา</button></form>
      {shops ? (shops.length ? <ul className="bt-list">{shops.map(row => <li key={row.supplier_key}>
        <button type="button" className="secondary" disabled={busy} onClick={() => startBill({ supplier_key: row.supplier_key, name: row.name })}>{row.name}<small>{row.code}</small></button>
      </li>)}</ul> : <p>ไม่พบร้าน</p>) : recent.length > 0 && <ul className="bt-list">{recent.map(row => <li key={row.supplier_key}>
        <button type="button" className="secondary" disabled={busy} onClick={() => startBill({ supplier_key: row.supplier_key, name: row.supplier_name })}>{row.supplier_name}<small>ร้านที่ถ่ายเดือนนี้</small></button>
      </li>)}</ul>}
    </>}
    {view === 'shop' && shop && <>
      {head(shop.name, home)}
      {error && <p role="alert" className="error">{error}</p>}
      {done && <p role="status" className="bt-done">{done}</p>}
      {queue > 0 && <p role="status" className="ap-queue">กำลังอ่าน {queue} ใบ</p>}
      <div className="ap-capture">
        <button type="button" className="ap-primary" disabled={busy} onClick={() => startBill(shop)}>ถ่ายบิลร้านนี้</button>
        <button type="button" className="secondary" disabled={busy} onClick={captureMore}>ถ่ายบิลเพิ่ม</button>
      </div>
      {bills?.length ? <ul className="ap-bills">{bills.map(row => <li key={row.id}>
        <button type="button" className="secondary" disabled={busy} onClick={() => openBill(row.id)}><span>{row.doc_ref || 'ไม่มีเลขที่'}<small>{row.doc_date || '—'}{billState(row) ? ` · ${billState(row)}` : ''}</small></span><strong>{baht(row.total)}</strong></button>
      </li>)}</ul> : <p className="bt-hint">ยังไม่มีบิล</p>}
    </>}
    {view === 'bill' && <>
      {head(bill?.supplier_name || shop?.name || 'บิล', () => { setBill(null); setView(shop && bills ? 'shop' : 'home'); })}
      {error && <p role="alert" className="error">{error}</p>}
      {reading && <div className="ap-reading" role="status" aria-busy="true"><span className="ap-reading-bill" aria-hidden="true"><span /></span>กำลังอ่านบิล</div>}
      {bill && !reading && <form className="ap-bill" onSubmit={event => { event.preventDefault(); save(true); }}>
        {bill.pages?.length > 0 && <div className="ap-pages">{bill.pages.map(page => <BillPage key={page.id} id={bill.id} page={page.page_no} label={`หน้า ${page.page_no}`} />)}</div>}
        {bill.pages?.length > 0 && ['none', 'failed'].includes(bill.ocr_status) && !queued.current.has(bill.id) && <button type="button" className="secondary" disabled={busy} onClick={readNow}>อ่านบิล</button>}
        {bill.warnings?.length > 0 && <ul className="ap-warnings">{bill.warnings.map((warning, index) => <li key={index} data-code={warning.code}>{warning.message}</li>)}</ul>}
        <div className="ap-fields">
          <label>เลขที่บิล<input value={form.doc_ref} maxLength={100} onChange={event => setForm({ ...form, doc_ref: event.target.value })} /></label>
          <label>วันที่<input type="date" value={form.doc_date} onChange={event => setForm({ ...form, doc_date: event.target.value })} /></label>
          <label className="ap-amount">ยอดรวม (บาท)<input inputMode="decimal" value={form.total} onChange={event => setForm({ ...form, total: event.target.value })} /></label>
        </div>
        {bill.lines?.length > 0 && <ul className="ap-lines" aria-label="รายการในบิล">{bill.lines.map(line => <li key={line.line_no}><span>{line.bill_text || '—'}<small>{lineText(line)}</small></span><strong>{baht(line.amount)}</strong></li>)}</ul>}
        <div className="ap-actions">
          <button className="ap-primary" disabled={busy || form.total.trim() === ''}>บันทึก · ถ่ายใบถัดไป</button>
          <button type="button" className="secondary" disabled={busy || form.total.trim() === ''} onClick={() => save(false)}>บันทึก</button>
          <button type="button" className="secondary" disabled={busy} onClick={captureMore}>ถ่ายบิลเพิ่ม</button>
          <div className="ap-more">
            <button type="button" className="secondary" disabled={busy} onClick={addPage}>เพิ่มหน้า</button>
            <button type="button" className="secondary" disabled={busy} onClick={retake}>ถ่ายใหม่</button>
            <button type="button" className="destructive" disabled={busy} onClick={remove}>ลบบิล</button>
          </div>
        </div>
      </form>}
    </>}
  </section>;
}
