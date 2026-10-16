import { decimalString, scaledInteger, lineAmount } from './receiving-utils.js';

const quantityText = (value) => decimalString(value).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
const problem = (label) => ({ status: 'error', label });

// Compare only quantities in a known common unit; never infer an alias multiplier.
export function quantityStatus(line, expectedItems, lines = [line], kind = 'bill') {
  try {
    const received = scaledInteger(line.quantity_received);
    if (line.unit_multiplier != null && (!Number.isFinite(Number(line.unit_multiplier)) || Number(line.unit_multiplier) <= 0 || Number(line.unit_multiplier) > 10000)) return problem('ตรวจหน่วย');
    if (received > 9999999999n) return problem('จำนวนเกิน');
    if (line.quantity_billed != null && line.quantity_billed !== '' && scaledInteger(line.quantity_billed) > 9999999999n) return problem('จำนวนเกิน');
    if (line.unit_price != null && line.unit_price !== '' && scaledInteger(line.unit_price, 6) > 999999999999n) return problem('ราคาเกิน');
    if (lineAmount(line) > 99999999999n) return problem('ยอดเกิน');
    if (!line.product_id) return { status: kind === 'bill' ? 'error' : 'review', label: 'เลือกสินค้า' };
    const expected = expectedItems?.find((item) => Number(item.order_item_id) === Number(line.order_item_id));
    if (!expected || !line.order_item_id) return { status: 'review', label: 'ไม่มีใบสั่ง' };
    if (expected.product_id && Number(expected.product_id) !== Number(line.product_id)) return problem('สินค้าไม่ตรง');
    if (line.match?.source === 'alias' && line.unit_multiplier == null) return { status: 'review', label: 'ตรวจหน่วย' };
    const related = lines.filter((item) => Number(item.order_item_id) === Number(line.order_item_id));
    if (related.some((item) => !item.unit_text || item.unit_text !== expected.unit_name || (item.unit_multiplier != null && Number(item.unit_multiplier) !== 1))) {
      return { status: 'review', label: 'ตรวจหน่วย' };
    }
    const remaining = scaledInteger(expected.quantity_ordered) - scaledInteger(expected.received_quantity || '0');
    const actual = related.reduce((sum, item) => sum + scaledInteger(item.quantity_received), 0n);
    const delta = actual - (remaining > 0n ? remaining : 0n);
    return delta === 0n ? { status: 'ok', label: 'ครบ' }
      : { status: 'review', label: `${delta < 0n ? 'ขาด' : 'เกิน'} ${quantityText(delta < 0n ? -delta : delta)} ${expected.unit_name || 'หน่วย'}`, direction: delta < 0n ? 'short' : 'over' };
  } catch { return problem('ตรวจตัวเลข'); }
}

// Waiting work is neutral; only a recorded receipt needs a short/over check.
export function expectedQuantityStatus(item) {
  const unit = ({ 'กิโลกรัม': 'กก.', 'กรัม': 'ก.' })[item.unit_name] || item.unit_name || 'หน่วย';
  try {
    const ordered = scaledInteger(item.quantity_ordered);
    const received = scaledInteger(item.received_quantity || '0');
    const summary = `รับแล้ว ${quantityText(received)} / สั่ง ${quantityText(ordered)} ${unit}`;
    const delta = received - ordered;
    if (received === 0n && !item.is_received) return { status: 'waiting', label: `รอรับ ${quantityText(ordered)} ${unit}`, summary };
    return { status: delta === 0n ? 'ok' : 'review', label: delta === 0n ? 'ครบแล้ว' : `${delta < 0n ? 'ขาด' : 'เกิน'} ${quantityText(delta < 0n ? -delta : delta)} ${unit}`, summary };
  } catch { return { ...problem('ตรวจตัวเลข'), summary: 'ตรวจจำนวนรับ / สั่ง' }; }
}

export function isPartialReceipt(item) {
  try {
    const received = scaledInteger(item.received_quantity || '0');
    return received > 0n && received < scaledInteger(item.quantity_ordered);
  } catch { return false; }
}

export function moneyStatus(lines, discount, vat, billTotal, subtotal) {
  try {
    const total = lines.reduce((sum, line) => sum + lineAmount(line), 0n);
    const adjusted = total - scaledInteger(discount || '0') + scaledInteger(vat || '0');
    if (adjusted < 0n) return problem('ตรวจส่วนลด');
    if (billTotal == null || billTotal === '') return { status: 'review', label: 'ไม่มียอดบิล', total, adjusted, billTotal: null };
    const bill = scaledInteger(billTotal);
    const delta = bill - adjusted;
    if (subtotal != null && subtotal !== '' && scaledInteger(subtotal) - scaledInteger(discount || '0') + scaledInteger(vat || '0') !== bill) {
      return { status: 'review', label: 'ตรวจยอดก่อนหัก', total, adjusted, billTotal: bill };
    }
    return { status: delta === 0n ? 'ok' : 'review', label: delta === 0n ? 'ตรงยอดบิล' : `ต่าง ${quantityText(delta < 0n ? -delta : delta)} บาท`, total, adjusted, billTotal: bill };
  } catch { return problem('ตรวจตัวเลข'); }
}

export function thaiDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'ไม่ระบุวันที่';
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T12:00:00+07:00`));
}
