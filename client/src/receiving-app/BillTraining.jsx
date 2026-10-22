import { useEffect, useRef, useState } from 'react';
import { receivingAdminAPI as api } from '../api/receiving-admin';
import { receivingDocumentsAPI } from '../api/receiving-documents';
// Same capture as receiving a bill: Google document scanner (crop/flatten), camera fallback.
// Loaded on tap so the shell (and its tests) never load the native scanner plugin up front.
const loadCapture = async () => (await import('./native-capture.mjs')).captureImage;
import { compressImage } from '../pages/receiving/image-utils';
import { createPayload } from '../pages/receiving/start-receiving';
import { bangkokDate } from './api.mjs';

// Owner 2026-10-22 "หน้าเทรนการอ่านบิล" (MVP): teach a shop's printed names/codes -> products so the
// bill reader (sent as known_aliases, matched by item_code) makes fewer mistakes. Uses the existing
// accounting/admin alias endpoints only; no OCR call, no bill images.
export const canTrainBills = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);

const message = error => error?.response?.data?.message || error?.message || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง';
const kindLabel = { slip: 'สลิปโอนเงิน', statement: 'ใบวางบิล/ใบสรุป', other: 'ไม่ใช่บิล' };
const qualityLabel = { blur: 'เบลอ', dark: 'มืด', glare: 'แสงสะท้อน' };
const sourceLabel = { alias: 'จับคู่จากที่สอนไว้', item_code: 'จับคู่จากรหัส', ai: 'AI เดา', order: 'จากใบสั่ง', manual: 'คนเลือก', none: 'ยังไม่รู้จัก' };

// "ทดสอบสแกนบิล": a real read (one paid OCR call per tap) on a test receipt in the trainer's own
// department. The receipt stays a draft (no stock/order change); counting every row as 0 opens
// the full read so the trainer sees printed text, codes and the match. The draft is the record.
// Receiving-admin options list the departments that actually receive goods.
const docs = { ...receivingDocumentsAPI, options: () => api.options(), supplierProducts: (key, q) => api.supplierProducts(key, q) };

// A shop can only be received where its products are scoped. Use the trainer's own department when
// the shop is receivable there, otherwise the first department that can receive it (admins only).
export async function findTestScope(d, user, detail) {
  const canReceive = async scope => ((await d.suppliers({ q: detail.code || detail.name, ...scope })) || [])
    .some(row => row.supplier_key === detail.supplier_key);
  const own = { branch_id: Number(user.branch_id), department_id: Number(user.department_id) };
  if (await canReceive(own)) return own;
  if (!['admin', 'super_admin'].includes(user.role)) return null;
  const { branches = [], departments = [] } = await d.options() || {};
  for (const department of departments) {
    const scope = { branch_id: Number(department.branch_id), department_id: Number(department.id) };
    const branch = branches.find(row => Number(row.id) === scope.branch_id);
    if (await canReceive(scope)) return { ...scope, label: `${branch?.name || 'สาขา'} / ${department.name}` };
  }
  return null;
}

export async function testScanBill({ file, detail, user, api: d = docs, compress = compressImage, uuid = () => crypto.randomUUID(), today = bangkokDate }) {
  const image = await compress(file);
  const scope = await findTestScope(d, user, detail);
  if (!scope) throw new Error('ร้านนี้ยังไม่มีแผนกที่รับของได้ ต้องผูกสินค้ากับสาขาก่อน');
  const identity = detail.kind === 'master' ? { supplier_master_id: Number(detail.id) } : { product_group_id: Number(detail.id) };
  const doc = await d.create({ ...createPayload({ kind: 'bill', date: today(), user: { ...user, ...scope, receiving_scope: 'department' }, name: detail.name, ids: [], identity }),
    resume_draft: false, client_uuid: uuid() });
  await d.uploadImage(doc.id, 1, image.dataUrl);
  const read = await d.ocr(doc.id);
  const rows = (read?.lines || []).filter(line => Number(line.id) > 0);
  if (rows.length) await d.count(doc.id, { client_uuid: doc.client_uuid, lines: rows.map(line => ({ id: line.id, counted_quantity: '0' })) });
  else {
    // Nothing read: count one taught product as 0 so the receipt opens and the trainer can see the read.
    const placeholder = (detail.aliases || []).find(alias => alias.is_active && alias.product_id)?.product_id
      || (await d.supplierProducts(detail.supplier_key, ''))?.items?.[0]?.id;
    if (placeholder) await d.count(doc.id, { client_uuid: doc.client_uuid, lines: [{ product_id: placeholder, unit_text: '', counted_quantity: '0' }] });
  }
  const full = await d.get(doc.id);
  const lines = (full.lines || []).filter(line => !(line.match?.source === 'manual' && !line.bill_text));
  return { id: full.id, scope: scope.label || null, kind: full.ocr?.doc_kind || null, notes: (full.warnings || []).map(warning => warning.message).filter(Boolean), addressee: full.ocr?.addressee || null, shipToMismatch: !!full.ocr?.ship_to_mismatch, early: read?.early_read || null, lines, total: full.total ?? null, doc_ref: full.doc_ref ?? null,
    quality: (image.quality?.warnings || []).map(code => qualityLabel[code] || code), enhanced: !!image.enhanced };
}
const empty = { bill_text: '', item_code: '', unit_text: '', multiplier: '', byWeight: false, q: '', products: [], product: null };

export function BillTraining({ onBack, user }) {
  const [q, setQ] = useState('');
  const [suppliers, setSuppliers] = useState(null);
  const [key, setKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [test, setTest] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [formatNote, setFormatNote] = useState(null);
  const [refPattern, setRefPattern] = useState({ value: '', saved: '', unavailable: false });
  const [customer, setCustomer] = useState({ name: '', branch: '' });
  const filePick = useRef(null);

  const run = async fn => {
    setBusy(true); setError(''); setDone('');
    try { await fn(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  // Customer names are a newer endpoint: an older server must not break teaching product names.
  const load = next => run(async () => {
    const shop = await api.supplier(next); setDetail(shop); setFormatNote(shop.bill_format_note || '');
    try { setCustomers(await api.customerNames(next)); } catch { setCustomers({ items: [], branch_options: [], unavailable: true }); }
    try { const saved = (await api.billRefPattern(next)).ref_pattern || ''; setRefPattern({ value: saved, saved, unavailable: false }); }
    catch { setRefPattern({ value: '', saved: '', unavailable: true }); }
  });
  useEffect(() => { if (key) load(key); }, [key]);

  const searchShops = event => { event.preventDefault(); run(async () => setSuppliers((await api.suppliers({ q: q.trim() })).items || [])); };
  const searchProducts = event => { event.preventDefault(); run(async () => {
    const result = await api.supplierProducts(key, form.q.trim());
    setForm(current => ({ ...current, products: result.items || [], product: null }));
  }); };
  const save = event => { event.preventDefault(); run(async () => {
    const body = { bill_text: form.bill_text.trim(), product_id: form.product.id };
    if (form.item_code.trim()) body.item_code = form.item_code.trim();
    if (form.unit_text.trim()) body.unit_text = form.unit_text.trim();
    if (form.byWeight) body.price_by_weight = true;
    else if (form.multiplier.trim() && Number(form.multiplier) !== 1) body.unit_multiplier = form.multiplier.trim();
    await api.createAlias(key, body);
    setDone(`สอนแล้ว: ‘${body.bill_text}’ = ${form.product.name}`); setForm(empty);
    setDetail(await api.supplier(key));
  }); };
  const runTest = file => run(async () => {
    if (!file) return;
    setTest({ pending: true });
    try { setTest(await testScanBill({ file, detail, user })); } catch (err) { setTest(null); throw err; }
  });
  const scan = async () => {
    let file = null;
    try {
      const captureImage = await loadCapture();
      if (!captureImage) { filePick.current?.click(); return; }
      file = await captureImage();
    } catch (err) { setError(message(err)); return; }
    runTest(file);
  };
  const teach = line => setForm({ ...empty, bill_text: line.bill_text || '', item_code: line.item_code || '', unit_text: line.unit_text || '' });
  const saveCustomer = event => { event.preventDefault(); run(async () => {
    const body = { customer_name: customer.name.trim(), branch_id: Number(customer.branch) };
    const saved = await api.createCustomerName(key, body);
    setDone(`สอนแล้ว: ลูกค้า ‘${saved.customer_name}’ = ${saved.branch_name}`); setCustomer({ name: '', branch: '' });
    setCustomers(await api.customerNames(key));
  }); };
  const saveFormatNote = event => { event.preventDefault(); run(async () => {
    await api.saveSupplierProfile(key, { bill_format_note: formatNote.trim() || null });
    setDone('บันทึกรูปแบบบิลแล้ว · ใช้ตอนอ่านบิลครั้งต่อไป'); setDetail(await api.supplier(key));
  }); };
  const saveRefPattern = event => { event.preventDefault(); run(async () => {
    const saved = (await api.saveBillRefPattern(key, refPattern.value.trim() || null)).ref_pattern || '';
    setRefPattern({ value: saved, saved, unavailable: false });
    setDone(saved ? `บันทึกรูปแบบเลขที่บิลแล้ว: ${saved}` : 'ล้างรูปแบบเลขที่บิลแล้ว');
  }); };
  const toggleCustomer = row => run(async () => { await api.setCustomerNameActive(key, row.id, !row.is_active); setCustomers(await api.customerNames(key)); });
  const toggle = alias => run(async () => { await api.setAliasActive(key, alias.id, !alias.is_active); setDetail(await api.supplier(key)); });

  const aliases = detail?.aliases || [];
  return <section className="bt-page" aria-labelledby="bt-title">
    <header className="bt-head"><h2 id="bt-title">สอนอ่านบิล</h2><button type="button" className="secondary" disabled={busy} onClick={key ? () => { setKey(null); setDetail(null); setCustomers(null); setTest(null); setForm(empty); } : onBack}>{key ? 'เลือกร้านอื่น' : 'กลับ'}</button></header>
    {error && <p role="alert" className="error">{error}</p>}
    {done && <p role="status" className="bt-done">{done}</p>}
    {!key && <>
      <p>เลือกร้าน แล้วสอนว่าชื่อหรือรหัสที่พิมพ์ในบิลคือสินค้าตัวไหน ระบบจะใช้ช่วยอ่านบิลร้านนี้ครั้งต่อไป</p>
      <form onSubmit={searchShops}><label>ค้นหาร้าน<input value={q} onChange={event => setQ(event.target.value)} placeholder="ชื่อร้านหรือรหัสซัพ" /></label><button disabled={busy}>ค้นหา</button></form>
      {suppliers && (suppliers.length ? <ul className="bt-list">{suppliers.map(shop => <li key={shop.supplier_key}>
        <button type="button" className="secondary" disabled={busy} onClick={() => setKey(shop.supplier_key)}>{shop.name}<small>{shop.code} · สอนแล้ว {shop.alias_active_count} ชื่อ</small></button>
      </li>)}</ul> : <p>ไม่พบร้าน</p>)}
    </>}
    {key && detail && <>
      <h3>{detail.name} <small>{detail.code}</small></h3>
      <div className="bt-test">
        <button type="button" disabled={busy} onClick={scan}>ทดสอบสแกนบิล</button>
        <input ref={filePick} type="file" accept="image/*" capture="environment" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; runTest(file); }} />
        <small>อ่านบิลจริง 1 ครั้งต่อการกด · เก็บเป็นใบทดสอบในแผนกนี้ ไม่ตัดสต็อก</small>
        {test?.pending && <p role="status">กำลังอ่านบิล… (10–30 วินาที)</p>}
        {test && !test.pending && <div className="bt-result" aria-label="ผลทดสอบอ่านบิล">
          {test.quality.length > 0 && <p className="error">รูปนี้ระบบตรวจว่า: {test.quality.join(' · ')} — ผลอ่านอาจเพี้ยน</p>}
          <p>ใบทดสอบ #{test.id}{test.scope ? ` (${test.scope})` : ''}{test.enhanced ? ' · ปรับแสงให้แล้ว' : ''} · อ่านได้ {test.lines.length} รายการ{test.doc_ref ? ` · เลขที่ ${test.doc_ref}` : ''}{test.total != null ? ` · ยอด ${test.total}` : ''}</p>
          <p>ชื่อลูกค้าที่อ่านได้: <strong>{test.addressee || '—'}</strong>{test.shipToMismatch && <span className="error"> · ระบบเตือนว่าอาจส่งผิดสาขา</span>}
            {test.addressee && <button type="button" className="secondary" disabled={busy} onClick={() => setCustomer({ name: test.addressee, branch: '' })}>สอนชื่อลูกค้านี้</button>}</p>
          {test.lines.length ? <ul className="bt-aliases">{test.lines.map(line => <li key={line.id} data-known={!!line.product_id}>
            <span><strong>{line.bill_text || '—'}</strong>{line.item_code && <small>รหัส {line.item_code}</small>}</span>
            <span>{line.product_name ? `= ${line.product_name}` : 'ยังไม่รู้จัก'}<small>{sourceLabel[line.match?.source] || line.match?.source}</small>
              {!line.product_id && line.suggested_product_name && <small>AI เสนอ: {line.suggested_product_name}{line.suggestion_reason ? ` · ${line.suggestion_reason}` : ''}</small>}</span>
            <button type="button" className="secondary" disabled={busy || !line.bill_text} onClick={() => teach(line)}>{line.product_id ? 'จับคู่ผิด? แก้' : 'สอนว่าคือสินค้าไหน'}</button>
          </li>)}</ul> : <p>ไม่พบรายการในบิล{test.kind && test.kind !== 'bill' ? ` (AI มองว่าเป็น ${kindLabel[test.kind] || test.kind})` : ''} ลองถ่ายใหม่ให้ชัด เห็นทั้งใบ</p>}
          {test.notes.length > 0 && <ul className="bt-notes">{[...new Set(test.notes)].map(note => <li key={note}>{note}</li>)}</ul>}
        </div>}
      </div>
      <form onSubmit={save} className="bt-form" aria-label="สอนชื่อใหม่">
        <label>ชื่อในบิล (พิมพ์ตามบิล เช่น บดB)<input required maxLength={255} value={form.bill_text} onChange={event => setForm({ ...form, bill_text: event.target.value })} /></label>
        <label>รหัสสินค้าในบิล (ถ้ามี)<input maxLength={40} inputMode="text" value={form.item_code} onChange={event => setForm({ ...form, item_code: event.target.value })} /></label>
        <div className="bt-unit">
          <label>หน่วยในบิล (ถ้าต่างจากในระบบ เช่น ลัง)<input maxLength={100} value={form.unit_text} onChange={event => setForm({ ...form, unit_text: event.target.value })} /></label>
          {!form.byWeight && <label>1 หน่วยในบิล = กี่{form.product?.unit_name || 'หน่วยในระบบ'}<input inputMode="decimal" maxLength={10} placeholder="1" value={form.multiplier} onChange={event => setForm({ ...form, multiplier: event.target.value })} /></label>}
        </div>
        <label className="bt-check"><input type="checkbox" checked={form.byWeight} onChange={event => setForm({ ...form, byWeight: event.target.checked, multiplier: '' })} />ร้านคิดเงินเป็น กก. แต่เราสั่งและรับเป็น{form.product?.unit_name || 'ตัว'} (ไม่เทียบน้ำหนักกับจำนวนที่นับ)</label>
        {form.product ? <p className="bt-picked">สินค้า: <strong>{form.product.name}</strong> ({form.product.unit_name}) <button type="button" className="secondary" disabled={busy} onClick={() => setForm({ ...form, product: null })}>เปลี่ยน</button></p>
          : <div className="bt-product">
            <label>ค้นหาสินค้าในระบบ<input value={form.q} onChange={event => setForm({ ...form, q: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') searchProducts(event); }} /></label>
            <button type="button" className="secondary" disabled={busy} onClick={searchProducts}>ค้นหาสินค้า</button>
            {form.products.length > 0 && <ul className="bt-list">{form.products.map(product => <li key={product.id}>
              <button type="button" className="secondary" disabled={busy} onClick={() => setForm({ ...form, product })}>{product.name}<small>{product.code} · {product.unit_name}{product.is_supplier_product ? ' · สินค้าของร้านนี้' : ''}</small></button>
            </li>)}</ul>}
          </div>}
        <button disabled={busy || !form.bill_text.trim() || !form.product}>บันทึกการสอน</button>
      </form>
      <h3>รูปแบบบิลของร้านนี้</h3>
      <form onSubmit={saveFormatNote} className="bt-form" aria-label="รูปแบบบิล">
        <label>บอก AI ว่าช่องสำคัญอยู่ตรงไหน หน้าตาแบบไหน<textarea maxLength={2000} rows={3} value={formatNote ?? ''} placeholder="เช่น เลขที่บิลอยู่ซ้ายบนใต้ที่อยู่ เป็นตัวเลข 10 หลักขึ้นต้น 0100 ไม่มีตัวอักษร" onChange={event => setFormatNote(event.target.value)} /></label>
        <button disabled={busy || formatNote === (detail.bill_format_note || '')}>บันทึกรูปแบบบิล</button>
      </form>
      {!refPattern.unavailable && <form onSubmit={saveRefPattern} className="bt-form" aria-label="รูปแบบเลขที่บิล">
        <label>รูปแบบเลขที่บิล (# = ตัวเลข 1 หลัก)<input maxLength={40} inputMode="text" autoCapitalize="characters" value={refPattern.value} placeholder="เช่น 0100######" onChange={event => setRefPattern({ ...refPattern, value: event.target.value })} /></label>
        <p className="bt-hint">ระบบลบเลขยาวที่อาจเป็นเบอร์โทร/เลขบัญชีทิ้งเสมอ ยกเว้นเลขที่บิลที่ตรงรูปแบบนี้</p>
        <button disabled={busy || refPattern.value.trim() === refPattern.saved}>บันทึกรูปแบบเลขที่บิล</button>
      </form>}
      <h3>ชื่อลูกค้าในบิล → สาขา</h3>
      <p className="bt-hint">ชื่อร้านเราที่ร้านนี้พิมพ์ในช่อง "ชื่อลูกค้า" เช่น โซลาวฮัลโหล = สาขาคันคลอง</p>
      {customers?.unavailable ? <p className="error">เซิร์ฟเวอร์นี้ยังไม่รองรับการสอนชื่อลูกค้า (รออัปเดต)</p> : <>
      <form onSubmit={saveCustomer} className="bt-form" aria-label="สอนชื่อลูกค้า">
        <label>ชื่อลูกค้าในบิล (พิมพ์ตามบิล)<input required maxLength={100} value={customer.name} onChange={event => setCustomer({ ...customer, name: event.target.value })} /></label>
        <label>คือสาขา<select required value={customer.branch} onChange={event => setCustomer({ ...customer, branch: event.target.value })}>
          <option value="">เลือกสาขา</option>{(customers?.branch_options || []).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>
        <button disabled={busy || !customer.name.trim() || !customer.branch}>บันทึกชื่อลูกค้า</button>
      </form>
      {customers?.items?.length ? <ul className="bt-aliases">{customers.items.map(row => <li key={row.id} data-active={row.is_active}>
        <span><strong>{row.customer_name}</strong></span>
        <span>= {row.branch_name}{!row.is_active && <small>ปิดใช้</small>}</span>
        <button type="button" className="secondary" disabled={busy} onClick={() => toggleCustomer(row)}>{row.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
      </li>)}</ul> : <p>ยังไม่เคยสอนชื่อลูกค้าของร้านนี้</p>}
      </>}
      <h3>สอนไว้แล้ว {aliases.filter(alias => alias.is_active).length} ชื่อ</h3>
      {aliases.length ? <ul className="bt-aliases">{aliases.map(alias => <li key={alias.id} data-active={alias.is_active}>
        <span><strong>{alias.bill_text}</strong>{alias.item_code && <small>รหัส {alias.item_code}</small>}{Number(alias.unit_multiplier) > 0 && Number(alias.unit_multiplier) !== 1 && <small>1 {alias.unit_text || 'หน่วยบิล'} = {Number(alias.unit_multiplier)} {alias.unit_name || ''}</small>}{alias.price_by_weight && <small>คิดเงินตามน้ำหนัก · รับเป็น{alias.unit_name || 'ตัว'}</small>}</span>
        <span>= {alias.product_name}{!alias.is_active && <small>ปิดใช้</small>}</span>
        <button type="button" className="secondary" disabled={busy} onClick={() => toggle(alias)}>{alias.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
      </li>)}</ul> : <p>ยังไม่เคยสอนร้านนี้</p>}
    </>}
  </section>;
}
