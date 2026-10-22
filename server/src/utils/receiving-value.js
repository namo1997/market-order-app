// คำนวณด้วยจำนวนเต็มทั้งจำนวนสินค้าและเงิน ปัด half-up ที่ขอบเขตสตางค์
export function scaledInteger(value, places = 2) {
  const text = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('กรอกตัวเลขตั้งแต่ 0 ขึ้นไป');
  const [whole, fraction = ''] = text.split('.');
  const padded = fraction.padEnd(places + 1, '0');
  const result = BigInt(whole) * 10n ** BigInt(places)
    + BigInt(padded.slice(0, places) || '0') + (padded[places] >= '5' ? 1n : 0n);
  if (result > 99999999999999n) throw new Error('ตัวเลขสูงเกินกำหนด');
  return result;
}
export function decimalString(value) {
  const number = BigInt(value);
  const sign = number < 0n ? '-' : '';
  const absolute = number < 0n ? -number : number;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
export const moneyString = (value) => value === '' || value == null ? null : decimalString(scaledInteger(value));
export function lineAmount(line) {
  if (line.amount !== '' && line.amount != null) return scaledInteger(line.amount);
  if (line.unit_price === '' || line.unit_price == null) return 0n;
  const quantity = scaledInteger(line.quantity_billed === '' || line.quantity_billed == null
    ? line.quantity_received ?? '0' : line.quantity_billed);
  // ราคาใน API อาจมี 6 ตำแหน่ง คงความละเอียดก่อนปัดยอดบรรทัด
  const price = scaledInteger(line.unit_price, 6);
  return (quantity * price + 500000n) / 1000000n;
}


const present = value => value != null && value !== '';
const extended = (quantity, price) => (quantity * price + 500000n) / 1000000n;

// Known bill value + explained adjustments = known received value. Unknown
// prices stay separate, so a missing bill row cannot hide a known shortage.
export function reviewLedger(doc) {
  let billedLines = 0n;
  const adjustments = [], pendingPrices = [];
  for (const line of doc.lines) {
    const quantity = scaledInteger(line.quantity_received ?? 0);
    const billed = present(line.quantity_billed) ? scaledInteger(line.quantity_billed) : null;
    const hasPrice = present(line.unit_price);
    // Missing-bill rows contribute no value to the supplier's bill.
    // Priced by weight: the amount covers the pieces received unless the bill's own piece count differs.
    const weighed = Boolean(line.price_by_weight) && present(line.amount);
    const outsideBill = ['missing_bill', 'not_received'].includes(line.review_decision) || (billed === null && !weighed);
    const amount = outsideBill ? 0n : lineAmount(line);
    billedLines += amount;
    let received = 0n;
    if (quantity === 0n) received = 0n;
    else if (weighed && !outsideBill && (billed === null || billed === quantity)) received = amount;
    else if (hasPrice) received = extended(quantity, scaledInteger(line.unit_price, 6));
    else if (!outsideBill && present(line.amount) && (billed === quantity || scaledInteger(line.amount) === 0n)) received = amount;
    else if (!outsideBill && billed > 0n && present(line.amount)) received = (amount * quantity + billed / 2n) / billed;
    else {
      pendingPrices.push({ id: line.id, name: line.product_name, quantity: line.quantity_received, unit: line.unit_text, outsideBill });
      // Unpriced billed goods remain in the bill baseline until pricing is known.
      received = amount;
    }
    if (received !== amount) adjustments.push({ id: line.id, name: line.product_name, amount: received - amount,
      reason: quantity === 0n ? 'ไม่รับ / คืนร้าน' : outsideBill ? 'รับของไม่มีในบิล (ทราบราคา)' : quantity < billed ? 'หักขาดจากบิล' : quantity > billed ? 'รับเกินบิล' : 'ส่วนต่างราคากับยอดบรรทัด' });
  }
  const discount = scaledInteger(doc.discount || 0), vat = scaledInteger(doc.vat || 0);
  const net = billedLines - discount + vat;
  const hasBillTotal = present(doc.total);
  const bill = hasBillTotal ? scaledInteger(doc.total) : net;
  // Keep header/line mismatches explicit instead of silently changing the bill.
  const reconciliation = net - bill;
  const decisionAdjustment = adjustments.reduce((sum, row) => sum + row.amount, 0n);
  const adjustment = decisionAdjustment + reconciliation;
  return { bill, hasBillTotal, billedLines, net, discount, vat, adjustments, decisionAdjustment,
    reconciliation, adjustment, received: billedLines + decisionAdjustment, receivedNet: bill + adjustment, pendingPrices, missingPrice: pendingPrices.length > 0 };
}
