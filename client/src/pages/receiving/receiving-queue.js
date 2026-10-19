import { scaledInteger } from './receiving-utils.js';
export const hasPendingQuantity = item => {
  if (typeof item.has_pending === 'boolean') return item.has_pending;
  try {
    if (Array.isArray(item.order_item_ids)) return scaledInteger(item.remaining_quantity ?? '0') > 0n;
    return scaledInteger(item.quantity_ordered) > scaledInteger(item.received_quantity || '0'); }
  catch { return !item.is_received; }
};
export const queueStatus = (group, referenceDate) => {
  if (typeof referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) && /^\d{4}-\d{2}-\d{2}$/.test(group.due_date || '')) {
    if (group.due_date < referenceDate) return 'overdue';
    if (group.due_date === referenceDate) return 'due_today';
    return group.has_partial ? 'partial' : 'upcoming';
  }
  return group.status || 'due_today';
};
export function sortShops(groups, referenceDate) {
  const rank = { overdue: 0, due_today: 1, partial: 2, upcoming: 3 };
  return [...groups].sort((a,b) => (rank[queueStatus(a, referenceDate)] ?? 3) - (rank[queueStatus(b, referenceDate)] ?? 3) ||
    (a.due_date || '').localeCompare(b.due_date || '') || a.supplier_name.localeCompare(b.supplier_name, 'th'));
}
export function shopStatusLabel(group, referenceDate) {
  if (queueStatus(group, referenceDate) === 'overdue') {
    const days = typeof referenceDate === 'string' ? Math.round((Date.parse(referenceDate) - Date.parse(group.due_date)) / 86400000) : group.overdue_days;
    return `เลยกำหนด ${days || 1} วัน`;
  }
  if (queueStatus(group, referenceDate) === 'partial') return 'รับไปบางส่วน';
  if (queueStatus(group, referenceDate) === 'upcoming' && group.due_date) return `ถึง ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).format(new Date(`${group.due_date}T12:00:00+07:00`))}`;
  return 'ควรถึงวันนี้';
}
export const followupTime = value => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
export const canManageFollowups = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
