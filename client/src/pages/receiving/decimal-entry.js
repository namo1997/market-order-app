// Entry validation only; precision and rounding remain in the existing business layer.
export const decimalEntryValid = value => /^\d*(?:\.\d*)?$/.test(value);
export const decimalEntryMessage = 'ใช้ตัวเลขตั้งแต่ 0';

export function rejectDecimalEntry(event, previous) {
  const input = event.target;
  if (decimalEntryValid(input.value)) return false;
  const caret = Math.max(0, (input.selectionStart ?? previous.length) - Math.max(0, input.value.length - previous.length));
  event.stopPropagation?.();
  input.value = previous;
  input.setSelectionRange?.(caret, caret);
  return true;
}
