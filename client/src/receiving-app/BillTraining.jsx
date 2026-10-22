import { useEffect, useState } from 'react';
import { receivingAdminAPI as api } from '../api/receiving-admin';

// Owner 2026-10-22 "หน้าเทรนการอ่านบิล" (MVP): teach a shop's printed names/codes -> products so the
// bill reader (sent as known_aliases, matched by item_code) makes fewer mistakes. Uses the existing
// accounting/admin alias endpoints only; no OCR call, no bill images.
export const canTrainBills = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);

const message = error => error?.response?.data?.message || 'ทำรายการไม่สำเร็จ ลองอีกครั้ง';
const empty = { bill_text: '', item_code: '', q: '', products: [], product: null };

export function BillTraining({ onBack }) {
  const [q, setQ] = useState('');
  const [suppliers, setSuppliers] = useState(null);
  const [key, setKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const run = async fn => {
    setBusy(true); setError(''); setDone('');
    try { await fn(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  const load = next => run(async () => setDetail(await api.supplier(next)));
  useEffect(() => { if (key) load(key); }, [key]);

  const searchShops = event => { event.preventDefault(); run(async () => setSuppliers((await api.suppliers({ q: q.trim() })).items || [])); };
  const searchProducts = event => { event.preventDefault(); run(async () => {
    const result = await api.supplierProducts(key, form.q.trim());
    setForm(current => ({ ...current, products: result.items || [], product: null }));
  }); };
  const save = event => { event.preventDefault(); run(async () => {
    const body = { bill_text: form.bill_text.trim(), product_id: form.product.id };
    if (form.item_code.trim()) body.item_code = form.item_code.trim();
    await api.createAlias(key, body);
    setDone(`สอนแล้ว: ‘${body.bill_text}’ = ${form.product.name}`); setForm(empty);
    setDetail(await api.supplier(key));
  }); };
  const toggle = alias => run(async () => { await api.setAliasActive(key, alias.id, !alias.is_active); setDetail(await api.supplier(key)); });

  const aliases = detail?.aliases || [];
  return <section className="bt-page" aria-labelledby="bt-title">
    <header className="bt-head"><h2 id="bt-title">สอนอ่านบิล</h2><button type="button" className="secondary" disabled={busy} onClick={key ? () => { setKey(null); setDetail(null); setForm(empty); } : onBack}>{key ? 'เลือกร้านอื่น' : 'กลับ'}</button></header>
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
      <form onSubmit={save} className="bt-form" aria-label="สอนชื่อใหม่">
        <label>ชื่อในบิล (พิมพ์ตามบิล เช่น บดB)<input required maxLength={255} value={form.bill_text} onChange={event => setForm({ ...form, bill_text: event.target.value })} /></label>
        <label>รหัสสินค้าในบิล (ถ้ามี)<input maxLength={40} inputMode="text" value={form.item_code} onChange={event => setForm({ ...form, item_code: event.target.value })} /></label>
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
      <h3>สอนไว้แล้ว {aliases.filter(alias => alias.is_active).length} ชื่อ</h3>
      {aliases.length ? <ul className="bt-aliases">{aliases.map(alias => <li key={alias.id} data-active={alias.is_active}>
        <span><strong>{alias.bill_text}</strong>{alias.item_code && <small>รหัส {alias.item_code}</small>}</span>
        <span>= {alias.product_name}{!alias.is_active && <small>ปิดใช้</small>}</span>
        <button type="button" className="secondary" disabled={busy} onClick={() => toggle(alias)}>{alias.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
      </li>)}</ul> : <p>ยังไม่เคยสอนร้านนี้</p>}
    </>}
  </section>;
}
