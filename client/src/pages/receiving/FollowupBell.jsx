import { useCallback, useEffect, useRef, useState } from 'react';
import { receivingFollowupsAPI as api } from '../../api/receiving-followups';
import { PrimaryAction, Toast } from '../../design';
import { ReceivingDialog } from './ReceivingDialog';
import { errorText } from './receiving-utils';
import { followupTime, canManageFollowups } from './receiving-queue';
import { useAuth } from '../../contexts/AuthContext';

// Notification DTO is transport-neutral: {items, pending_count, notification}.
// Poll/focus can later be invalidated by push without changing the inbox interface.
export function FollowupBell({ onOpenIssue } = {}) {
  const { user } = useAuth();
  const [inbox, setInbox] = useState({ items: [], pending_count: 0 });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lock = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try { const result = await api.followups('pending'); if (id === request.current) { setInbox(result); setLoaded(true); setError('');
      if (canManageFollowups(user)) window.dispatchEvent(new CustomEvent('receiving:followups', { detail: { items: result.items } })); } }
    catch (failure) { if (id === request.current) setError(errorText(failure)); }
  }, [user]);
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval?.(refresh, 30000);
    return () => { request.current++; window.removeEventListener('focus', refresh); if (timer) window.clearInterval(timer); };
  }, [refresh]);
  const change = async (id, status) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await api.followupStatus(id, status); await refresh(); }
    catch (failure) { setError(errorText(failure)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <button type="button" className="rc-followup-bell rc-text-action" aria-label={`แจ้งเตือนตามของ ${loaded ? inbox.pending_count : 'กำลังโหลด'} เรื่อง`} onClick={() => { setOpen(true); refresh(); }}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 20h4" /></svg>
      <span aria-live="polite">{error ? '!' : loaded ? inbox.pending_count : '…'}</span>
    </button>
    {open && <ReceivingDialog title="เรื่องตามของ" onClose={() => setOpen(false)}>
      <div className="rc-stack">{error && <Toast status="error">{error}</Toast>}
        <button type="button" className="rc-text-action" onClick={refresh}>โหลดเรื่องตามของ</button>
        {loaded && !error && !inbox.items.length && <p>ไม่มีเรื่องค้าง</p>}
        {inbox.items.map(item => <article key={item.id} className="rc-followup-item">
          <strong>{item.supplier_name}</strong><p className="rc-muted">สาขา {item.branch_id} / แผนก {item.department_id} · {item.pending_items.length} รายการ</p>
          <p>{item.source === 'overdue' ? 'เลยกำหนด' : item.actor_name} · {followupTime(item.created_at)}</p>
          {item.note && <p>{item.note}</p>}
          <details><summary>รายการค้าง</summary><ul>{item.pending_items.map(line => <li key={line.order_item_id}>{line.product_name} · ค้าง {line.remaining_quantity} {line.unit_name}</li>)}</ul></details>
          <div className="rc-queue-actions">{item.pending_items.some(line => line.issue_id) && <button type="button" onClick={() => { const id = item.pending_items.find(line => line.issue_id).issue_id; setOpen(false); if (onOpenIssue) onOpenIssue(id); else window.dispatchEvent(new CustomEvent('receiving:open-issue', { detail: { id } })); }}>เปิดปัญหารับของเพื่อบันทึกทางจบ</button>}{item.status === 'open' ? <button type="button" disabled={busy} onClick={() => change(item.id, 'acknowledged')} aria-label={`รับทราบ ${item.supplier_name}`}>รับทราบ</button> : <span>รับทราบแล้ว</span>}
            {!item.pending_items.some(line => line.issue_id) && <button type="button" disabled={busy} onClick={() => change(item.id, 'resolved')} aria-label={`ปิดเรื่อง ${item.supplier_name}`}>ปิดเรื่อง</button>}</div>
        </article>)}
      </div>
    </ReceivingDialog>}
  </>;
}

export function FollowupDialog({ group, onClose, onSave, busy, error }) {
  const [note, setNote] = useState('');
  return <ReceivingDialog title={`ตามของ ${group.supplier_name}`} busy={busy} onClose={onClose}
    actions={<PrimaryAction disabled={busy} onClick={() => onSave(note)}>แจ้งบัญชี</PrimaryAction>}>
    <label>หมายเหตุ (ไม่บังคับ)<input value={note} maxLength={300} onChange={event => setNote(event.target.value)} /></label>
    {error && <Toast status="error">{error}</Toast>}
  </ReceivingDialog>;
}
