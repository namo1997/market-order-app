import { useId } from 'react';
import { Icon } from '../icons';

/** Native radios provide Tab + arrow-key navigation without a custom roving focus. */
export function Segmented({ label, options, value, onChange, disabled = false, className = '' }) {
  const name = useId();
  return <div role="radiogroup" aria-label={label} className={`sg-glass sg-segmented ${className}`}>
    {options.map(option => <label className="sg-segment" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value}
        disabled={disabled || option.disabled} onChange={() => onChange?.(option.value)} />
      <span>{option.icon && <Icon name={option.icon} size={20} />}{option.label}</span>
    </label>)}
  </div>;
}
