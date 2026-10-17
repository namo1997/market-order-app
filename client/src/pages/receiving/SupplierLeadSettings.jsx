import { useState } from 'react';
import { receivingFollowupsAPI as api } from '../../api/receiving-followups';
import { Toast } from '../../design';
import { errorText } from './receiving-utils';

export function SupplierLeadSettings({ groups, onSaved }) {
  const [key, setKey] = useState('');
  const [days, setDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const choose = value => { setKey(value); setDays(String(groups.find(group => group.supplier_key === value)?.lead_days || 0)); setMessage(''); };
  const save = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await api.setLead(key, Number(days)); setMessage('บันทึกวันส่งแล้ว'); onSaved(); }
    catch (failure) { setMessage(errorText(failure)); }
    finally { setBusy(false); }
  };
  return <details><summary>วันส่งของแต่ละร้าน</summary><div className="rc-stack">
    <label>ร้าน<select value={key} disabled={busy} onChange={event => choose(event.target.value)}><option value="">เลือกร้าน</option>
      {groups.filter(group => /^pg:/.test(group.supplier_key)).map(group => <option key={group.supplier_key} value={group.supplier_key}>{group.supplier_name}</option>)}</select></label>
    {key && <><label>ส่งภายในกี่วัน<input type="number" min="0" max="90" step="1" value={days} disabled={busy} onChange={event => setDays(event.target.value)} /></label>
      <button type="button" className="rc-text-action" disabled={busy || days === '' || !Number.isInteger(Number(days)) || Number(days) < 0 || Number(days) > 90} onClick={save}>บันทึกวันส่ง</button></>}
    {message && <Toast>{message}</Toast>}
  </div></details>;
}
