export function fillReceiptDraftField(current: string, draftValue: unknown, edited: boolean) {
  if (edited || current.trim()) return current;
  return String(draftValue ?? '');
}
