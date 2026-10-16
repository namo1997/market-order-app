import { useState } from 'react';
import { NumberField } from '../../design';
import { normalizeNumberEntry, numberError } from './receiving-validation';
import { decimalEntryValid, decimalEntryMessage, rejectDecimalEntry } from './decimal-entry';

export function ReceivingNumberField({ value, onValueChange, error, validationKey = 'quantity_received', ...props }) {
  const [entryError, setEntryError] = useState('');
  const [focused, setFocused] = useState(false);
  const pendingDecimal = focused && normalizeNumberEntry(value) !== value;
  const fieldError = pendingDecimal ? numberError(normalizeNumberEntry(value), validationKey) : error;
  return <NumberField {...props} value={value} error={entryError || fieldError}
    onFocus={() => setFocused(true)}
    onBlur={() => { setFocused(false); const next = normalizeNumberEntry(value); if (next !== value) onValueChange(next); }}
    onChangeCapture={event => {
      if (rejectDecimalEntry(event, String(value ?? ''))) setEntryError(decimalEntryMessage);
      else setEntryError('');
    }}
    onValueChange={next => {
      if (!decimalEntryValid(next)) { setEntryError(decimalEntryMessage); return; }
      setEntryError(''); onValueChange(next);
    }} />;
}
