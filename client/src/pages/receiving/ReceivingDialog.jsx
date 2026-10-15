import { useEffect, useRef } from 'react';

export function ReceivingDialog({ title, children, onClose, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="rc-dialog" aria-labelledby="rc-dialog-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="rc-section-heading"><h2 id="rc-dialog-title">{title}</h2>
      <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="ปิดหน้าต่าง">ปิด</button></div>
    {children}
  </dialog>;
}
