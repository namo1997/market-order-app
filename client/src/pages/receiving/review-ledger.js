import { scaledInteger, lineAmount } from './receiving-utils.js';

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
    const outsideBill = ['missing_bill', 'not_received'].includes(line.review_decision) || billed === null;
    const amount = outsideBill ? 0n : lineAmount(line);
    billedLines += amount;
    let received = 0n;
    if (quantity === 0n) received = 0n;
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
