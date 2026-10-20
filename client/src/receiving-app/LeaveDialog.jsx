import { useEffect, useRef } from 'react';

export function LeaveDialog({ busy, onStay, onDiscard }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus?.(); };
  }, []);
  return <dialog className="apk-leave apk-shell" ref={ref} aria-labelledby="apk-leave-title" aria-describedby="apk-leave-description"
    onCancel={event => { event.preventDefault(); if (!busy) onStay(); }}>
    <h2 id="apk-leave-title">ยังมีข้อมูลค้าง</h2>
    <p id="apk-leave-description">มีข้อมูลหรือรูปที่ยังไม่ส่ง หรือกำลังบันทึก หากออกตอนนี้ ข้อมูลที่ยังไม่ส่งจะหาย</p>
    <div className="apk-actions"><button autoFocus disabled={busy} onClick={onStay}>อยู่ต่อ</button>
      <button className="destructive" disabled={busy} onClick={onDiscard}>{busy ? 'กำลังออก…' : 'ทิ้งและออก'}</button></div>
  </dialog>;
}
