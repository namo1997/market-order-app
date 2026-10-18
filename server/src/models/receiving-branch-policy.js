import { createReceivingError, formatQuantity, validateQuantityOrNull, validateMoneyOrNull, validateUnitPriceOrNull } from '../services/receiving-ocr.service.js';

// Legacy /orders/receiving has authenticate only, with no role restriction.
export const canReceiveBranch = user => Number.isSafeInteger(Number(user?.id)) && Number(user.id) > 0;
export const receivingScope = value => {
  const scope = value ?? 'department';
  if (!['department', 'branch'].includes(scope)) throw createReceivingError('VALIDATION_FAILED', 'scope ต้องเป็น department หรือ branch');
  return scope;
};
const cents = value => {
  const [whole, fraction = ''] = formatQuantity(value ?? 0, { allowNull: false }).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const decimal = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
const sum = values => decimal(values.reduce((total, value) => total + cents(value), 0n));

// Same ordered-quantity proportions as legacy; largest remainder preserves the exact total.
// Stable tie break: order_item_id, then line id. Equal split if all weights are zero.
export function allocateBranchQuantity(total, rows, field = 'quantity_received') {
  if (field === 'amount') validateMoneyOrNull(total, field);
  else validateQuantityOrNull(total, 'quantity_received', { allowNull: false });
  if (!rows.length) throw createReceivingError('VALIDATION_FAILED', 'ไม่พบแผนกสำหรับกระจายสินค้า');
  let weights = rows.map(row => cents(row.branch_weight ?? row.quantity_ordered ?? row.quantity ?? 0));
  let divisor = weights.reduce((a, b) => a + b, 0n);
  if (divisor === 0n) { weights = rows.map(() => 1n); divisor = BigInt(rows.length); }
  const units = cents(total);
  const allocations = rows.map((row, i) => ({ i, units: units * weights[i] / divisor,
    remainder: units * weights[i] % divisor, key: Number(row.order_item_id ?? row.id) }));
  let rest = units - allocations.reduce((a, row) => a + row.units, 0n);
  const ranked = [...allocations].sort((a, b) => a.remainder === b.remainder ? a.key - b.key : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) { if (rest === 0n) break; row.units++; rest--; }
  return allocations.map(row => decimal(row.units));
}
const groupKey = row => row.product_id ? `${row.product_id}:${row.unit_id ?? ''}` : `line:${row.id}`;
export function branchLineGroups(rows) {
  const groups = new Map();
  for (const row of [...rows].sort((a, b) => Number(a.id ?? a.order_item_id) - Number(b.id ?? b.order_item_id))) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}
export function initialBranchAmounts(items) {
  const result = new Map();
  for (const parts of branchLineGroups(items)) {
    const priced = parts.flatMap(row => {
      const price = validateUnitPriceOrNull(row.actual_price ?? row.requested_price);
      if (price === null) { result.set(Number(row.order_item_id), null); return []; }
      const remaining = cents(row.quantity_ordered) - cents(row.received_quantity);
      const exact = (remaining > 0n ? remaining : 0n) * BigInt(price.toFixed(6).replace('.', ''));
      return [{ id: Number(row.order_item_id), units: exact / 1000000n, remainder: exact % 1000000n, exact }];
    });
    const total = (priced.reduce((value, row) => value + row.exact, 0n) + 500000n) / 1000000n;
    let rest = total - priced.reduce((value, row) => value + row.units, 0n);
    for (const row of [...priced].sort((a, b) => a.remainder === b.remainder ? a.id - b.id : a.remainder > b.remainder ? -1 : 1)) {
      if (rest === 0n) break;
      row.units++; rest--;
    }
    for (const row of priced) result.set(row.id, decimal(row.units));
  }
  return result;
}
export function aggregateBranchLines(rows) {
  return branchLineGroups(rows).map(parts => ({ ...parts[0],
    quantity_received: sum(parts.map(row => row.quantity_received)),
    quantity_billed: parts.every(row => row.quantity_billed == null) ? null : sum(parts.map(row => row.quantity_billed)),
    amount: parts.every(row => row.amount == null) ? null : sum(parts.map(row => row.amount)),
    departments: parts.map(row => ({ order_item_id: Number(row.order_item_id),
      department_id: Number(row.branch_department_id), department_name: row.branch_department_name || '',
      quantity_ordered: formatQuantity(row.branch_weight, { allowNull: false }),
      quantity_received: formatQuantity(row.quantity_received, { allowNull: false }) }))
  }));
}
export function expandBranchUpdate(body, rows) {
  if (body.lines != null && !Array.isArray(body.lines) || body.deleted_line_ids != null && !Array.isArray(body.deleted_line_ids)) {
    throw createReceivingError('VALIDATION_FAILED', 'lines และ deleted_line_ids ต้องเป็น array');
  }
  const groups = branchLineGroups(rows);
  const byAnchor = new Map(groups.map(parts => [Number(parts[0].id), parts]));
  const seen = new Set();
  const expanded = [];
  for (const input of body.lines || []) {
    if (!input || typeof input !== 'object') throw createReceivingError('VALIDATION_FAILED', 'บรรทัดรวมไม่ถูกต้อง');
    const parts = byAnchor.get(Number(input.id));
    if (!parts || seen.has(Number(input.id))) throw createReceivingError('VALIDATION_FAILED', 'รายการสาขาต้องอ้างอิงบรรทัดรวมเดิมและไม่ซ้ำ');
    seen.add(Number(input.id));
    if (input.product_id !== undefined && Number(input.product_id) !== Number(parts[0].product_id) ||
        input.order_item_id !== undefined && Number(input.order_item_id) !== Number(parts[0].order_item_id) ||
        input.unit_id !== undefined && Number(input.unit_id) !== Number(parts[0].unit_id)) {
      throw createReceivingError('VALIDATION_FAILED', 'ห้ามเปลี่ยนสินค้า หน่วย หรือใบสั่งของบรรทัดรวมสาขา');
    }
    // Round the aggregate amount once before allocating cents across departments.
    // Rounding each physical line independently can create or lose a cent.
    let aggregateAmount = input.amount;
    const price = validateUnitPriceOrNull(input.unit_price === undefined ? parts[0].unit_price : input.unit_price);
    if (aggregateAmount === null && price !== null) {
      const base = input.quantity_billed ?? (input.quantity_billed === undefined && parts.some(row => row.quantity_billed != null)
        ? sum(parts.map(row => row.quantity_billed)) : input.quantity_received ?? sum(parts.map(row => row.quantity_received)));
      validateQuantityOrNull(base, 'quantity_received', { allowNull: false });
      const micros = BigInt(price.toFixed(6).replace('.', ''));
      aggregateAmount = decimal((cents(base) * micros + 500000n) / 1000000n);
    }
    const split = key => {
      if (key === 'amount' && aggregateAmount !== undefined) {
        if (aggregateAmount === null) return parts.map(() => null);
        const quantities = billed.some(value => value != null) ? billed : received;
        return allocateBranchQuantity(aggregateAmount, parts.map((part, i) => ({ ...part, branch_weight: quantities[i] ?? 0 })), key);
      }
      if (input[key] === undefined) return parts.map(row => row[key]);
      if (input[key] === null) return parts.map(() => null);
      if (key === 'amount') validateMoneyOrNull(input[key], key);
      return allocateBranchQuantity(input[key], parts, key);
    };
    const received = split('quantity_received'), billed = split('quantity_billed'), amounts = split('amount');
    parts.forEach((part, i) => expanded.push({ ...input, id: part.id, line_no: part.line_no,
      product_id: part.product_id, order_item_id: part.order_item_id, unit_id: part.unit_id,
      quantity_received: received[i], quantity_billed: billed[i], amount: amounts[i] }));
  }
  const deleted = (body.deleted_line_ids || []).flatMap(id => {
    const parts = byAnchor.get(Number(id));
    if (!parts || seen.has(Number(id))) throw createReceivingError('VALIDATION_FAILED', 'รายการลบไม่ถูกต้อง');
    seen.add(Number(id));
    return parts.map(part => part.id);
  });
  return { ...body, ...(Array.isArray(body.lines) ? { lines: expanded } : {}), deleted_line_ids: deleted };
}

export function aggregateBranchQueue(groups, contextRows = []) {
  const shops = new Map();
  for (const group of groups) {
    const key = `${group.branch_id}:${group.supplier_key}`;
    if (!shops.has(key)) shops.set(key, { ...group, scope: 'branch', department_id: null, items: [] });
    const shop = shops.get(key);
    if (group.due_date < shop.due_date) { shop.due_date = group.due_date; shop.due_status = group.due_status; shop.status = group.status; }
    shop.has_partial ||= group.has_partial;
    shop.overdue_days = Math.max(shop.overdue_days, group.overdue_days);
    shop.items.push(...group.items.map(item => ({ ...item, branch_department_id: group.department_id,
      branch_department_name: item.department_name || '', branch_weight: item.quantity_ordered })));
  }
  // Keep completed siblings of pending products in the allocation basis, as legacy does.
  // Their historical due dates must not make a pending shop overdue.
  for (const row of contextRows) {
    const supplier = row.product_group_id ? `pg:${Number(row.product_group_id)}` : 'none';
    const shop = shops.get(`${row.branch_id}:${supplier}`);
    if (!shop || !shop.items.some(item => groupKey(item) === groupKey(row)) || shop.items.some(item => item.order_item_id === Number(row.order_item_id))) continue;
    shop.has_partial ||= cents(row.received_quantity) > 0n;
    shop.items.push({ order_item_id: Number(row.order_item_id), product_id: Number(row.product_id),
      unit_id: row.unit_id ?? null, product_name: row.product_name, unit_name: row.unit_name,
      quantity_ordered: row.quantity_ordered, received_quantity: row.received_quantity,
      remaining_quantity: '0.00', branch_department_id: Number(row.department_id),
      branch_department_name: row.department_name || '' });
  }
  return [...shops.values()].map(shop => ({ ...shop, status: shop.due_status === 'upcoming' && shop.has_partial ? 'partial' : shop.due_status, items: branchLineGroups(shop.items).map(parts => ({ ...parts[0],
    is_received: false, order_item_ids: parts.map(row => row.order_item_id), quantity_ordered: sum(parts.map(row => row.quantity_ordered)),
    received_quantity: sum(parts.map(row => row.received_quantity)), remaining_quantity: sum(parts.map(row => row.remaining_quantity)),
    departments: parts.map(row => ({ department_id: row.branch_department_id, department_name: row.branch_department_name,
      quantity_ordered: row.quantity_ordered, received_quantity: row.received_quantity })) })).filter(item => cents(item.remaining_quantity) > 0n) })).filter(shop => shop.items.length);
}
