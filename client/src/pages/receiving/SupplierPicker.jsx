import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

// Walkthrough 2026-10-24: the shop a department receives from every morning should be one tap away.
// Recent shops live on this device only (identity fields, no counts or prices); storage failures are ignored.
export const RECENT_SUPPLIERS_KEY = 'solao.receiving.recent-suppliers.v1';
const RECENT_LIMIT = 4;
function storage() { try { return window.localStorage; } catch { return undefined; } }
export function readRecentSuppliers(user, store = storage()) {
  try {
    const all = JSON.parse(store?.getItem(RECENT_SUPPLIERS_KEY) || '{}');
    const rows = all[`${user?.branch_id}:${user?.department_id}`];
    return Array.isArray(rows) ? rows.filter(row => row && row.supplier_key && row.name).slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}
export function rememberRecentSupplier(user, supplier, store = storage()) {
  if (!supplier?.supplier_key || !supplier.name || supplier.isNew) return;
  try {
    const all = JSON.parse(store?.getItem(RECENT_SUPPLIERS_KEY) || '{}');
    const scope = `${user?.branch_id}:${user?.department_id}`;
    const row = { supplier_key: supplier.supplier_key, name: supplier.name, code: supplier.code ?? null,
      supplier_master_id: supplier.supplier_master_id ?? null, product_group_id: supplier.product_group_id ?? null };
    all[scope] = [row, ...(Array.isArray(all[scope]) ? all[scope] : []).filter(item => item?.supplier_key !== row.supplier_key)].slice(0, RECENT_LIMIT);
    store?.setItem(RECENT_SUPPLIERS_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: no recents */ }
}

export function SupplierPicker({ name, selected, onChange, user, disabled = false }) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
  const [recent] = useState(() => readRecentSuppliers(user));
  const branch = user.branch_id, department = user.department_id;
  useEffect(() => {
    if (disabled) return;
    let active = true;
    setStatus('loading'); setResults([]);
    const timer = setTimeout(async () => {
      try {
        const rows = await api.suppliers({ q: name.trim().slice(0, 100), branch_id: Number(branch), department_id: Number(department) });
        if (active) { setResults(rows); setStatus('ready'); }
      } catch { if (active) setStatus('error'); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [name, branch, department, retry, disabled]);
  // Owner 2026-10-28: the search also finds a shop by the goods it sends; the card names the product that matched.
  return <div className="rc-stack">
    <label>ผู้ส่งของ<input type="search" maxLength={255} value={name} disabled={disabled} placeholder="ชื่อร้าน หรือ ชื่อสินค้า" onChange={event => onChange(event.target.value, null)} /></label>
    {/* Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the field already shows the chosen shop; only a new shop gets a status line. */}
    {/* Phone test 2026-10-26: the new-shop state was said twice; the field already shows the name. */}
    {selected ? <div>{selected.isNew && <p role="status">ร้านใหม่ รอบัญชีตรวจ · ยังไม่เพิ่มเข้าทะเบียนซัพ</p>}<button type="button" className="rc-text-action" disabled={disabled} onClick={() => onChange('', null)}>เปลี่ยนร้าน</button></div> : <>
      {status === 'loading' && <p role="status">กำลังค้นหาร้าน…</p>}
      {status === 'error' && <div role="alert"><p>ค้นหาร้านไม่ได้ กรุณาลองใหม่ก่อนเลือกชื่อร้าน</p><button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>ค้นหาร้านอีกครั้ง</button></div>}
      {!name.trim() && recent.length > 0 && <div className="rc-search-results rc-recent-suppliers" aria-label="ร้านที่รับล่าสุด">
        <p className="rc-muted">รับล่าสุด</p>
        {recent.map(row => <button className="rc-option-card rc-recent-card" type="button" disabled={disabled} key={`recent-${row.supplier_key}`} onClick={() => onChange(row.name, { ...row, isNew: false })}><span>{row.name}</span></button>)}
      </div>}
      {status === 'ready' && <div className="rc-search-results" aria-label="ร้านในทะเบียน">
        {/* Phone test 2026-10-26: a recent shop was listed twice (รับล่าสุด and again below). */}
        {results.filter(row => name.trim() || !recent.some(item => item.supplier_key === row.supplier_key)).map(row => <button className="rc-option-card" type="button" disabled={disabled} key={row.supplier_key} onClick={() => onChange(row.name, row)}><span>{row.name}</span>{row.matched_product && <small>มี {row.matched_product}</small>}</button>)}
        {!results.length && <p>ไม่พบร้านในทะเบียน</p>}
        {/* Device test 072s: typing a registered code (e.g. SUP016) must not offer that code as a new shop name. */}
        {name.trim() && !results.some(row => [row.code, row.name].some(value => String(value || '').trim().toLowerCase() === name.trim().toLowerCase())) && <button type="button" className="rc-text-action" disabled={disabled} onClick={() => onChange(name.trim(), { name: name.trim(), isNew: true })}>ใช้ชื่อ “{name.trim()}” · ร้านใหม่ รอบัญชีตรวจ</button>}
      </div>}
    </>}
  </div>;
}
