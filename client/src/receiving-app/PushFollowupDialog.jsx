import { useEffect, useRef, useState } from 'react';

export function PushFollowupDialog({ id, api, onClose }) {
  const dialog = useRef(null);
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    dialog.current.showModal();
    api.client.get(`/receiving-push/followups/${encodeURIComponent(id)}`).then(result => {
      if (active) setRow(result.data.data);
    }).catch(() => { if (active) setError('เปิดเรื่องไม่ได้ กรุณาตรวจสิทธิ์หรือเข้าสู่ระบบใหม่'); });
    return () => { active = false; dialog.current?.close(); };
  }, [id, api]);
  return <dialog className="apk-menu apk-shell" ref={dialog} aria-labelledby="push-followup-title" onCancel={onClose}>
    <h2 id="push-followup-title">เรื่องตามของ #{id}</h2>
    {error ? <p role="alert">{error}</p> : !row ? <p role="status">กำลังโหลดเรื่อง…</p> : <>
      <h3>{row.supplier_name}</h3><p>{row.status === 'open' ? 'ยังไม่รับทราบ' : row.status === 'resolved' ? 'ปิดเรื่องแล้ว' : 'รับทราบแล้ว'}</p>
      {row.note && <p>{row.note}</p>}
      <ul>{row.pending_items.map(item => <li key={item.order_item_id}>{item.product_name} · ค้าง {item.remaining_quantity} {item.unit_name}</li>)}</ul>
    </>}
    <button className="secondary" onClick={onClose}>ปิด</button>
  </dialog>;
}
