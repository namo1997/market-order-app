import { scaledInteger } from './receiving-utils.js';
export const hasPendingQuantity = item => {
  try { return scaledInteger(item.quantity_ordered) > scaledInteger(item.received_quantity || '0'); }
  catch { return !item.is_received; }
};
export const queueStatus = group => group.status || 'due_today';
export function sortShops(groups) {
  const rank = { overdue: 0, due_today: 1, partial: 2, upcoming: 3 };
  return [...groups].sort((a,b) => (rank[queueStatus(a)] ?? 3) - (rank[queueStatus(b)] ?? 3) ||
    (a.due_date || '').localeCompare(b.due_date || '') || a.supplier_name.localeCompare(b.supplier_name, 'th'));
}
export function shopStatusLabel(group) {
  if (queueStatus(group) === 'overdue') return `เลยกำหนด ${group.overdue_days || 1} วัน`;
  if (queueStatus(group) === 'partial') return 'รับไปบางส่วน';
  if (queueStatus(group) === 'upcoming' && group.due_date) return `ถึง ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).format(new Date(`${group.due_date}T12:00:00+07:00`))}`;
  return 'ควรถึงวันนี้';
}
export const followupTime = value => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
export const canManageFollowups = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
