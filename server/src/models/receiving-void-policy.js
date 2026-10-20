// Date keys are calendar days in Asia/Bangkok, supplied by the caller.
export function mayVoid({ isAdmin, role, isOwner, referenceDay, today }) {
  if (isAdmin) return true;
  const days = (Date.parse(today) - Date.parse(referenceDay)) / 86400000;
  return Number.isInteger(days) && days >= 0 &&
    ((role === 'accounting' && days <= 7) || (Boolean(isOwner) && days === 0));
}
export const receiptNote = (id, note) => `รับสินค้าตามเอกสาร #${id}${note ? `: ${note}` : ''}`;
export const appendReceiptNote = (previous, entry) => previous ? `${previous}\n${entry}` : entry;
export function removeReceiptNote(current, entry, previous = null) {
  if (current === entry) return previous;
  const padded = `\n${current || ''}\n`;
  const target = `\n${entry}\n`;
  if (!padded.includes(target)) return current;
  return padded.replace(target, '\n').slice(1, -1) || null;
}

// The nightly auto-receive job (order.model.js) marks receive_notes with a line starting with `marker`.
const isAutoLine = marker => line => String(line).startsWith(marker);
export const hasAutoReceiveNote = (notes, marker) => String(notes ?? '').split('\n').some(isAutoLine(marker));
// Notes without the auto-receive line(s); null when nothing else remains.
export const stripAutoReceiveNote = (notes, marker) =>
  String(notes ?? '').split('\n').filter(line => !isAutoLine(marker)(line)).join('\n') || null;
// The auto-receive line(s) only, used to restore the note on void.
export const pickAutoReceiveNote = (notes, marker) =>
  String(notes ?? '').split('\n').filter(isAutoLine(marker)).join('\n') || null;
