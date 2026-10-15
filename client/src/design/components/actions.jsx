import { Icon } from '../icons';

export function PrimaryAction({ children, icon = 'check', busy = false, busyLabel, disabled, className = '', type = 'button', ...props }) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`sg-primary sg-press ${className}`}>
    {busy ? <span className="sg-spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
    <span aria-live="polite">{busy ? busyLabel || children : children}</span>
  </button>;
}

export function IconButton({ label, icon, showLabel = false, className = '', type = 'button', ...props }) {
  return <button {...props} type={type} aria-label={label} title={label}
    className={`sg-icon-button sg-press ${showLabel ? 'sg-labeled-button' : ''} ${className}`}><Icon name={icon} />{showLabel && <span>{label}</span>}</button>;
}

export function GlassBar({ children, label = 'การรับสินค้า', className = '', inline = false, ...props }) {
  return <div {...props} role="group" aria-label={label}
    className={`sg-bar ${inline ? 'sg-bar-inline' : 'sg-glass'} ${className}`}>{children}</div>;
}
