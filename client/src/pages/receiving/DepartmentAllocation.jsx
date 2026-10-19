import { qtyText } from './review-a';
import { scaledInteger, decimalString } from './receiving-utils';

// Display the saved server allocation, including manually preserved proportions.
// The client must not independently redistribute an unsaved aggregate quantity.
export function DepartmentAllocation({ line, showProduct = false }) {
  if (!line.departments?.length) return null;
  const unit = line.unit_text || line.ordered_unit || 'หน่วย';
  const departments = new Map();
  let complete = true;
  let total = 0n;
  for (const part of line.departments) {
    const key = part.department_id;
    if (!departments.has(key)) departments.set(key, {
      name: part.department_name || `แผนก #${key}`, quantity: 0n, known: true,
    });
    const department = departments.get(key);
    try {
      if (part.quantity_received == null || part.quantity_received === '') throw new Error('Missing allocation');
      const quantity = scaledInteger(part.quantity_received);
      department.quantity += quantity;
      total += quantity;
    } catch { complete = false; department.known = false; }
  }
  let pending = false;
  try { pending = complete && total !== scaledInteger(line.quantity_received); }
  catch { pending = true; }
  const breakdown = [...departments.values()].map(part =>
    `${part.name} ${part.known ? qtyText(decimalString(part.quantity)) : '—'} ${unit}`).join(' · ');
  const prefix = showProduct ? `${line.product_name || 'สินค้า'} ${qtyText(line.quantity_received)} ${unit} → ` : 'แยกแผนก · ';
  const text = pending ? 'บันทึกการตัดสินใจเพื่ออัปเดตจำนวนแบ่งแผนก' : breakdown;
  if (showProduct) return <p className="ra-allocation">{prefix}{text}</p>;
  return <details className="ra-allocation"><summary>{prefix}{text}</summary>
    <p>แบ่งตามสัดส่วนใบสั่ง · ใช้จำนวนแบ่งแผนกที่บันทึกล่าสุด</p>
    {!pending && line.departments.map(part => <p key={part.order_item_id}>
      {part.department_name || `แผนก #${part.department_id}`} · สั่ง {qtyText(part.quantity_ordered)} · รับ {qtyText(part.quantity_received)} {unit}
    </p>)}
  </details>;
}
