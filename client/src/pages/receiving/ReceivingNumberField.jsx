import { useState } from 'react';
import { NumberField } from '../../design';
import { decimalEntryValid, decimalEntryMessage, rejectDecimalEntry } from './decimal-entry';

export function ReceivingNumberField({ value, onValueChange, error, ...props }) {
  const [entryError, setEntryError] = useState('');
  return <NumberField {...props} value={value} error={entryError || error}
    onChangeCapture={event => {
      if (rejectDecimalEntry(event, String(value ?? ''))) setEntryError(decimalEntryMessage);
      else setEntryError('');
    }}
    onValueChange={next => {
      if (!decimalEntryValid(next)) { setEntryError(decimalEntryMessage); return; }
      setEntryError(''); onValueChange(next);
    }} />;
}
