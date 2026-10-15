import { Icon } from '../icons';

export function PrimaryAction({ children, icon = 'check', busy = false, disabled, className = '', type = 'button', ...props }) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`sg-primary sg-press ${className}`}>
    {busy ? <span className="sg-spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
    <span>{children}</span>
  </button>;
}

export function IconButton({ label, icon, className = '', type = 'button', ...props }) {
  return <button {...props} type={type} aria-label={label} title={label}
    className={`sg-icon-button sg-press ${className}`}><Icon name={icon} /></button>;
}

export function GlassBar({ children, label = 'การรับสินค้า', className = '', inline = false, ...props }) {
  return <div {...props} role="group" aria-label={label}
    className={`sg-glass sg-bar ${inline ? 'sg-bar-inline' : ''} ${className}`}>{children}</div>;
}
