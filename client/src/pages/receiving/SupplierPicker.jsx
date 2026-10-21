import { useEffect, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

export function SupplierPicker({ name, selected, onChange, user, disabled = false }) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('loading');
  const [retry, setRetry] = useState(0);
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
  return <div className="rc-stack">
    <label>ผู้ส่งของ<input type="search" maxLength={255} value={name} disabled={disabled} placeholder="ค้นหาชื่อร้านหรือรหัสซัพ" onChange={event => onChange(event.target.value, null)} /></label>
    {selected ? <div><p role="status">{selected.isNew ? 'ร้านใหม่ รอบัญชีตรวจ' : 'เลือกร้านจากทะเบียนแล้ว'} · {selected.name}</p><button type="button" className="rc-text-action" disabled={disabled} onClick={() => onChange('', null)}>เปลี่ยนร้าน</button></div> : <>
      {status === 'loading' && <p role="status">กำลังค้นหาร้าน…</p>}
      {status === 'error' && <div role="alert"><p>ค้นหาร้านไม่ได้ กรุณาลองใหม่ก่อนเลือกชื่อร้าน</p><button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>ค้นหาร้านอีกครั้ง</button></div>}
      {status === 'ready' && <div className="rc-search-results" aria-label="ร้านในทะเบียน">
        {results.map(row => <button className="rc-option-card" type="button" disabled={disabled} key={row.supplier_key} onClick={() => onChange(row.name, row)}><span>{row.name}</span><small>{row.code} · {row.supplier_master_id ? 'ทะเบียนซัพ' : 'กลุ่มสินค้าเดิม'}</small></button>)}
        {!results.length && <p>ไม่พบร้านในทะเบียน</p>}
        {/* Device test 072s: typing a registered code (e.g. SUP016) must not offer that code as a new shop name. */}
        {name.trim() && !results.some(row => [row.code, row.name].some(value => String(value || '').trim().toLowerCase() === name.trim().toLowerCase())) && <button type="button" className="rc-text-action" disabled={disabled} onClick={() => onChange(name.trim(), { name: name.trim(), isNew: true })}>ใช้ชื่อ “{name.trim()}” · ร้านใหม่ รอบัญชีตรวจ</button>}
      </div>}
    </>}
    {selected?.isNew && <p className="rc-muted">ร้านใหม่ รอบัญชีตรวจ · ยังไม่เพิ่มเข้าทะเบียนซัพ</p>}
  </div>;
}
