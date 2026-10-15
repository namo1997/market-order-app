import { Sheet } from '../../design';

export function ReceivingDialog({ title, children, onClose, busy, actions }) {
  return <Sheet open title={title} onDismiss={() => { if (!busy) onClose(); }} actions={actions} className="rc-sheet">
    {children}
  </Sheet>;
}
