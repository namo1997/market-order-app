// Owner 2026-10-26 "ทำตามแนวทางที่เสนอ": a bill row with a known pack (the bill prints 4 ลัง, the product counts
// กระป๋อง, 1 ลัง = 24) is counted the way the bill prints it; what is saved is always in counting units.
import { validCount } from './review-a.js';

export const packOf = line => (line?.count_unit && Number(line.count_unit.size) > 1 && line.count_unit.unit ? line.count_unit : null);
// Counting units for a count typed in packs, to 2 decimals (the count field's own precision).
export const packTotal = (value, size) => String(Math.round(Number(value) * Number(size) * 100) / 100);
export const countsInPack = (line, mode) => Boolean(packOf(line)) && mode !== 'item';
export const countedForSave = (line, value, mode) =>
  countsInPack(line, mode) && value !== '' && value != null && validCount(value) ? packTotal(value, line.count_unit.size) : value;
// Switching unit keeps what was typed when it converts exactly; otherwise the field starts empty.
export function switchCountUnit(line, value, mode) {
  const pack = packOf(line);
  if (!pack || value === '' || value == null || !validCount(value)) return '';
  if (countsInPack(line, mode)) return packTotal(value, pack.size);
  const cents = Math.round(Number(value) * 100), per = Math.round(Number(pack.size) * 100);
  return per > 0 && cents % per === 0 ? String(cents / per) : '';
}
