import { Icon } from '../icons';

const states = {
  ok: { icon: 'check', label: 'ครบแล้ว' },
  review: { icon: 'warning', label: 'รอตรวจ' },
  error: { icon: 'error', label: 'มีปัญหา' },
};

export function StatusPill({ status = 'review', children, className = '' }) {
  const state = states[status] || states.review;
  return <span className={`sg-status ${className}`} data-status={states[status] ? status : 'review'}>
    <Icon name={state.icon} size={18} />{children || state.label}
  </span>;
}

export function ListCard({ title, subtitle, leading, trailing, children, className = '', ...props }) {
  return <article {...props} className={`sg-card ${className}`}>
    <div className="sg-card-row">{leading && <span className="sg-card-leading">{leading}</span>}
      <div className="sg-card-copy"><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{trailing}
    </div>{children && <div className="sg-card-body">{children}</div>}
  </article>;
}

export function EmptyState({ title = 'ยังไม่มีบิล', description, icon = 'receipt', action }) {
  return <div className="sg-empty"><span className="sg-empty-icon"><Icon name={icon} size={40} /></span>
    <h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

/** Persistent by default: important feedback must not disappear before it is read. */
export function Toast({ open = true, status = 'ok', children, onDismiss, className = '' }) {
  const state = states[status] || states.ok;
  if (!open) return null;
  return <div className={`sg-toast ${className}`} data-status={states[status] ? status : 'ok'}>
    <div className="sg-toast-message" role={status === 'error' ? 'alert' : 'status'} aria-atomic="true">
      <Icon name={state.icon} /><span>{children || state.label}</span>
    </div>
    {onDismiss && <button type="button" className="sg-icon-button sg-press" aria-label="ปิดแจ้งเตือน" title="ปิดแจ้งเตือน" onClick={onDismiss}><Icon name="close" /></button>}
  </div>;
}
