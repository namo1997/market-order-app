// Entry validation only; precision and rounding remain in the existing business layer.
export const decimalEntryValid = value => /^\d*(?:\.\d*)?$/.test(value);
export const decimalEntryMessage = 'ใช้ตัวเลขตั้งแต่ 0';
// Device test 2026-10-21: the Samsung number pad has a "," key; "2,5" silently became "25".
// Name the exact mistake so the hint is not mistaken for a generic error.
export function decimalEntryMessageFor(raw = '') {
  if (raw.includes(',')) return 'ทศนิยมใช้จุด (.) ไม่ใช่จุลภาค (,)';
  if ((raw.match(/\./g) || []).length > 1) return 'ใส่จุดทศนิยมได้ครั้งเดียว';
  return decimalEntryMessage;
}

export function rejectDecimalEntry(event, previous) {
  const input = event.target;
  if (decimalEntryValid(input.value)) return false;
  const caret = Math.max(0, (input.selectionStart ?? previous.length) - Math.max(0, input.value.length - previous.length));
  event.stopPropagation?.();
  input.value = previous;
  input.setSelectionRange?.(caret, caret);
  return true;
}
