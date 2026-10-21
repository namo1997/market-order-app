import { useRef, useState } from 'react';
import { NumberField } from '../../design';
import { normalizeNumberEntry, numberError } from './receiving-validation';
import { decimalEntryValid, decimalEntryMessageFor, rejectDecimalEntry } from './decimal-entry';

export function ReceivingNumberField({ value, onValueChange, error, validationKey = 'quantity_received', ...props }) {
  const [entryError, setEntryError] = useState('');
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const selectOnTap = useRef(false);
  const [compositionValue, setCompositionValue] = useState(null);
  const pendingDecimal = focused && normalizeNumberEntry(value) !== value;
  const fieldError = pendingDecimal ? numberError(normalizeNumberEntry(value), validationKey) : error;
  return <NumberField {...props} value={compositionValue ?? value} error={entryError || fieldError}
    onFocus={event => {
      setFocused(true);
      // Tapping a filled count must replace it: a caret before "25" turned a typed 2 into 225 on device.
      // Android places the caret when the tap ends, so select again on that first pointer-up.
      const input = event?.target;
      selectOnTap.current = Boolean(input?.value);
      if (input?.value) setTimeout(() => { if (input.ownerDocument?.activeElement === input) input.select?.(); }, 0);
      props.onFocus?.(event);
    }}
    onPointerUp={event => {
      if (selectOnTap.current) { selectOnTap.current = false; event.preventDefault?.(); event.target?.select?.(); }
      props.onPointerUp?.(event);
    }}
    onBlur={event => { setFocused(false); setEntryError(''); const next = normalizeNumberEntry(value); if (next !== value) onValueChange(next); props.onBlur?.(event); }}
    onCompositionStart={event => { composing.current = true; setCompositionValue(event.target.value); }}
    onCompositionEnd={event => {
      composing.current = false; setCompositionValue(null);
      if (decimalEntryValid(event.target.value)) onValueChange(event.target.value);
      else setEntryError(decimalEntryMessageFor(event.target.value));
    }}
    onChangeCapture={event => {
      if (composing.current || event.nativeEvent?.isComposing) return;
      // The hint stays until the field is left or emptied, so the next digit cannot hide it.
      const raw = event.target.value;
      if (rejectDecimalEntry(event, String(value ?? ''))) setEntryError(decimalEntryMessageFor(raw));
      else if (!raw) setEntryError('');
    }}
    onValueChange={next => {
      if (composing.current) { setCompositionValue(next); return; }
      if (!decimalEntryValid(next)) { setEntryError(decimalEntryMessageFor(next)); return; }
      onValueChange(next);
    }} />;
}
