import { useEffect, useState } from 'react';
import { receivingAdminAPI as api } from '../../../api/receiving-admin';
import { qtyText } from '../../receiving/review-a';
import { thaiUnit } from '../../receiving/receiving-utils';
import { normalizeReceivingUnit } from '../../receiving/receiving-status';
import { ledgerNumber } from './receiving-ledger';

// Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": lines staff received before their product existed. Accounting picks the
// product here; the server then posts stock and the receipt order exactly as confirm would have, and can remember
// the shop's bill wording. Add a missing product first in the shop page (สินค้าของร้าน), then link it here.
const failure = error => error?.response?.data?.message || 'ผูกสินค้าไม่สำเร็จ กรุณาลองใหม่';
// Staff counted in the bill's unit; a product counted in another unit needs the quantity in that unit (server rule too).
export const sameUnit = (line, product) => Boolean(line.unit_id && product.unit_id && Number(line.unit_id) === Number(product.unit_id))
  || (Boolean(normalizeReceivingUnit(line.unit_text)) && normalizeReceivingUnit(line.unit_text) === normalizeReceivingUnit(product.unit_name));

function WaitingLine({ doc, line, onLinked }) {
  // Start from what the bill says; the server also finds catalogue names contained in it.
  const [query, setQuery] = useState(() => String(line.bill_text || '').slice(0, 100));
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('');
  const [chosen, setChosen] = useState(null);
  const [remember, setRemember] = useState(true);
  const [converted, setConverted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canRemember = Boolean(doc.supplier_master_id || doc.product_group_id);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setStatus(''); return; }
    const controller = new AbortController();
    setStatus('กำลังค้นหา…');
    const timer = setTimeout(() => {
      api.lateLinkProducts(doc.id, q, controller.signal)
        .then(items => { setResults(Array.isArray(items) ? items.slice(0, 8) : []); setStatus(items?.length ? '' : 'ไม่พบ · ลองคำสั้นลง หรือเพิ่มสินค้าที่หน้าร้านค้า'); })
        .catch(err => { if (err?.name !== 'CanceledError') { setResults([]); setStatus('ค้นหาไม่สำเร็จ · ลองอีกครั้ง'); } });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [doc.id, query]);
  const otherUnit = Boolean(chosen) && !sameUnit(line, chosen);
  const convertedOk = /^\d+(\.\d{1,2})?$/.test(converted.trim()) && Number(converted) > 0;
  const productUnit = chosen ? thaiUnit(chosen.unit_name) || chosen.unit_name || 'หน่วยของสินค้า' : '';
  const link = async () => {
    if (!chosen || busy || (otherUnit && !convertedOk)) return;
    setBusy(true); setError('');
    try { await api.linkLineProduct(doc.id, line.id, { product_id: chosen.id, remember_alias: canRemember && remember, ...(otherUnit ? { quantity_received: converted.trim() } : {}) }); onLinked(); }
    catch (err) { setError(failure(err)); }
    finally { setBusy(false); }
  };
  return <article className="ra-late-line" aria-label={`รอผูกสินค้า ${line.bill_text || ''}`}>
    <header><strong className="receiving-bill-text">{line.bill_text || 'ไม่ระบุชื่อในบิล'}</strong>
      <span>รับ {qtyText(line.quantity_received)} {thaiUnit(line.unit_text) || 'หน่วย'} · {line.unit_price ? `${ledgerNumber(line.unit_price)} บาท/หน่วย` : 'ไม่มีราคา'}</span></header>
    <label>ค้นหาสินค้าในระบบ<input type="search" value={query} maxLength={100} disabled={busy} onChange={event => { setQuery(event.target.value); setChosen(null); }} /></label>
    {status && <p className="ra-note" role="status">{status}</p>}
    {results.length > 0 && <ul className="ra-late-results" aria-label="สินค้าในระบบ">{results.map(product => <li key={product.id}>
      <button type="button" aria-pressed={chosen?.id === product.id} disabled={busy} onClick={() => { setChosen(product); setConverted(''); }}>
        <span>{product.name}</span><small>{product.unit_name || 'ไม่ระบุหน่วย'}</small></button></li>)}</ul>}
    {otherUnit && <label className="ra-late-convert">นับได้ {qtyText(line.quantity_received)} {thaiUnit(line.unit_text) || line.unit_text || 'หน่วย'} · คิดเป็น {productUnit}
      <input type="text" inputMode="decimal" value={converted} disabled={busy} aria-invalid={converted !== '' && !convertedOk} onChange={event => setConverted(event.target.value)} /></label>}
    <div className="ra-late-actions">
      {canRemember && <label className="ra-late-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />จำชื่อในบิลนี้ของร้าน</label>}
      <button type="button" className="ra-primary" disabled={!chosen || busy || (otherUnit && !convertedOk)} onClick={link}>{busy ? 'กำลังผูกสินค้า…' : !chosen ? 'เลือกสินค้าก่อน' : otherUnit && !convertedOk ? `ใส่จำนวนเป็น ${productUnit}` : `ผูกกับ ${chosen.name} และลงคลัง`}</button>
    </div>
    {error && <p role="alert" className="ra-problem">{error}</p>}
  </article>;
}

export function LateProductLink({ doc, onLinked }) {
  const waiting = doc.status === 'confirmed' ? (doc.lines || []).filter(line => line.review_decision === 'receive_unmatched' && !line.product_id) : [];
  if (!waiting.length) return null;
  return <section className="ra-panel ra-late-panel" aria-labelledby="ra-late-title">
    <h3 id="ra-late-title">รอผูกสินค้า · {waiting.length} รายการ</h3>
    <p className="ra-note">พนักงานรับของไปก่อนเพราะยังไม่มีสินค้าในระบบ · ยังไม่ลงคลัง จนกว่าจะผูกสินค้า</p>
    {waiting.map(line => <WaitingLine key={line.id} doc={doc} line={line} onLinked={onLinked} />)}
  </section>;
}
