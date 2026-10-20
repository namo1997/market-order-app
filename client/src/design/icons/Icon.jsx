import sprite from './receiving.svg?url&no-inline';
import { iconNames } from './names';

/** Decorative by default; interactive parents must carry their own accessible name. */
export function Icon({ name, size = 24, label, className = '' }) {
  const safeName = iconNames.includes(name) ? name : 'box';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    className={`sg-icon ${className}`} role={label ? 'img' : undefined}
    aria-label={label || undefined} aria-hidden={label ? undefined : true} focusable="false">
    <use href={`${sprite}#${safeName}`} />
  </svg>;
}
