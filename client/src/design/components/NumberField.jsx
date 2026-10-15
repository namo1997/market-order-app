import { useId } from 'react';

/** Keep decimals as text. The API/business layer owns precision and validation. */
export function NumberField({ label, value, onValueChange, unit, error, hint, id, className = '', ...props }) {
  const generated = useId();
  const inputId = id || generated;
  const describedBy = [unit && `${inputId}-unit`, (error || hint) && `${inputId}-hint`, props['aria-describedby']].filter(Boolean).join(' ');
  return <div className={`sg-number-field ${className}`}>
    <label htmlFor={inputId}>{label}</label>
    <div className="sg-number-input-wrap"><input {...props} id={inputId} type="text" inputMode="decimal"
      autoComplete="off" value={value} onChange={event => onValueChange?.(event.target.value)}
      aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} />
      {unit && <span id={`${inputId}-unit`} className="sg-number-unit">{unit}</span>}
    </div>
    {(error || hint) && <p id={`${inputId}-hint`} className="sg-field-hint" data-error={Boolean(error)}>{error || hint}</p>}
  </div>;
}
