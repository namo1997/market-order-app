import { Icon } from '../../design';
import { thaiDate } from './receiving-status';

// Keep the native calendar and ISO value, while rendering a stable Thai label
// even on Android devices whose system date editor uses an English locale.
export function ThaiDateField({ value, onChange }) {
  return <label className="rc-thai-date">วันที่<span className="rc-thai-date-control">
    <span aria-hidden="true">{thaiDate(value)}</span><Icon name="calendar" />
    <input type="date" aria-label={`วันที่ ${thaiDate(value)}`} value={value} onChange={event => { if (event.target.value) onChange(event.target.value); }} />
  </span></label>;
}
