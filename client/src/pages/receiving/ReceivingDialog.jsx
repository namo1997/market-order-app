import { Sheet } from '../../design';
import { useEffect, useRef } from 'react';
import { billViewerHistory } from './bill-viewer-history';

export function ReceivingDialog({ title, children, onClose, busy, actions, className = '', backDismiss = false }) {
  const navigation = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!backDismiss) return;
    let active = true;
    let handle;
    Promise.resolve().then(() => {
      if (active) { handle = billViewerHistory(window, () => close.current()); navigation.current = handle; }
    });
    return () => { active = false; handle?.dispose(); };
  }, [backDismiss]);
  return <Sheet open title={title} onDismiss={() => { if (!busy) { const handle = navigation.current; if (backDismiss && handle?.isActive?.() !== false) handle?.close(); else onClose(); } }} actions={actions} className={`rc-sheet ${className}`}>
    {children}
  </Sheet>;
}
