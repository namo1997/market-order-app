import { useEffect, useId, useRef } from 'react';
import { IconButton } from './actions';

/** Mount inside .solao so the top-layer dialog inherits the selected theme. */
export function Sheet({ open, onDismiss, title, children, actions, className = '' }) {
  const dialog = useRef(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [open]);
  return <dialog ref={dialog} aria-labelledby={heading} className={`sg-glass sg-sheet ${className}`}
    onCancel={event => { event.preventDefault(); onDismiss?.(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onDismiss?.();
    }}>
    <div className="sg-sheet-handle" aria-hidden="true" />
    <header className="sg-sheet-header"><h2 id={heading}>{title}</h2><IconButton label="ปิด" icon="close" onClick={onDismiss} /></header>
    <div className="sg-sheet-body">{children}</div>
    {actions && <footer className="sg-sheet-actions">{actions}</footer>}
  </dialog>;
}
