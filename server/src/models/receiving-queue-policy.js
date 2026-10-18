import { addDaysToDateKey, toBangkokDateKey } from '../utils/bangkok-date.js';
import { formatQuantity } from '../services/receiving-ocr.service.js';

export const lookbackDays = (value) => {
  const days = Number(value ?? 7);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 7;
};
const hundredths = value => {
  const [whole, fraction = ''] = formatQuantity(value ?? 0, { allowNull: false }).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const quantity = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export function groupQueue(rows, targetDate, leads = []) {
  const leadMap = new Map(leads.map(row => [row.supplier_key, Number(row.lead_days)]));
  const groups = new Map();
  const shopKey = row => `${row.branch_id}:${row.department_id}:${row.product_group_id ? `pg:${Number(row.product_group_id)}` : 'none'}`;
  // Include fully received sibling orders when deciding if a shop is partially received.
  const receivedShops = new Set(rows.filter(row => hundredths(row.received_quantity) > 0n).map(shopKey));
  for (const row of rows) {
    const ordered = hundredths(row.quantity_ordered);
    const received = hundredths(row.received_quantity);
    if (ordered <= received) continue;
    const supplier_key = row.product_group_id ? `pg:${Number(row.product_group_id)}` : 'none';
    const key = `${row.branch_id}:${row.department_id}:${supplier_key}`;
    const lead_days = leadMap.get(supplier_key) || 0;
    const order_date = toBangkokDateKey(row.order_date) || targetDate;
    const due_date = addDaysToDateKey(order_date, lead_days);
    const due_status = due_date < targetDate ? 'overdue' : due_date === targetDate ? 'due_today' : 'upcoming';
    if (!groups.has(key)) groups.set(key, { supplier_key,
      supplier_name: String(row.product_group_name || 'ไม่ระบุซัพพลายเออร์'),
      branch_id: Number(row.branch_id), department_id: Number(row.department_id),
      lead_days, items: [], due_date, due_status, has_partial: false });
    const group = groups.get(key);
    if (due_date < group.due_date) { group.due_date = due_date; group.due_status = due_status; }
    group.has_partial ||= receivedShops.has(key);
    group.items.push({ order_item_id: Number(row.order_item_id), product_id: Number(row.product_id),
      department_name: row.department_name || '', unit_id: row.unit_id ?? null,
      product_name: String(row.product_name || ''), unit_name: row.unit_name || null,
      quantity_ordered: formatQuantity(row.quantity_ordered, { allowNull: false }),
      received_quantity: formatQuantity(row.received_quantity, { allowNull: true }),
      // A short receipt remains pending even if the legacy received flag is true.
      is_received: false, remaining_quantity: quantity(ordered - received), order_date, due_date, due_status });
  }
  const rank = { overdue: 0, due_today: 1, partial: 2, upcoming: 3 };
  return [...groups.values()].map(group => ({ ...group,
    status: group.due_status === 'upcoming' && group.has_partial ? 'partial' : group.due_status,
    overdue_days: Math.max(0, Math.round((Date.parse(targetDate) - Date.parse(group.due_date)) / 86400000))
  })).sort((a, b) => rank[a.status] - rank[b.status] || a.due_date.localeCompare(b.due_date) || a.supplier_name.localeCompare(b.supplier_name, 'th'));
}
