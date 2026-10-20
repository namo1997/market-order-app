import { useRef, useState } from 'react';
import { NumberField } from '../../design';
import { normalizeNumberEntry, numberError } from './receiving-validation';
import { decimalEntryValid, decimalEntryMessage, rejectDecimalEntry } from './decimal-entry';

export function ReceivingNumberField({ value, onValueChange, error, validationKey = 'quantity_received', ...props }) {
  const [entryError, setEntryError] = useState('');
  const [focused, setFocused] = useState(false);
  const composing = useRef(false);
  const [compositionValue, setCompositionValue] = useState(null);
  const pendingDecimal = focused && normalizeNumberEntry(value) !== value;
  const fieldError = pendingDecimal ? numberError(normalizeNumberEntry(value), validationKey) : error;
  return <NumberField {...props} value={compositionValue ?? value} error={entryError || fieldError}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }}
    onBlur={event => { setFocused(false); const next = normalizeNumberEntry(value); if (next !== value) onValueChange(next); props.onBlur?.(event); }}
    onCompositionStart={event => { composing.current = true; setCompositionValue(event.target.value); }}
    onCompositionEnd={event => {
      composing.current = false; setCompositionValue(null);
      if (decimalEntryValid(event.target.value)) { setEntryError(''); onValueChange(event.target.value); }
      else setEntryError(decimalEntryMessage);
    }}
    onChangeCapture={event => {
      if (composing.current || event.nativeEvent?.isComposing) return;
      if (rejectDecimalEntry(event, String(value ?? ''))) setEntryError(decimalEntryMessage);
      else setEntryError('');
    }}
    onValueChange={next => {
      if (composing.current) { setCompositionValue(next); return; }
      if (!decimalEntryValid(next)) { setEntryError(decimalEntryMessage); return; }
      setEntryError(''); onValueChange(next);
    }} />;
}
