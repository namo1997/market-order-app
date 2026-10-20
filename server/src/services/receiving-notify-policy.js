const cents = value => Math.round(Number(value || 0) * 100);
const quantity = value => String(value / 100);

export function buildReceivingVarianceItems(items = []) {
  return items.filter(item => item?.product_name).flatMap(item => {
    const diff = cents(item.received_quantity) - cents(item.quantity);
    return diff ? [{ ...item, diff, quantity: quantity(Math.abs(diff)) }] : [];
  });
}

// Orders compare the locked cumulative balance; bills compare this receipt only,
// with billed quantities converted to base units. Never label a manual line as
// an order variance when no original order exists.
export function documentNotificationPayload(doc, lines, scopedItems) {
  const orderItems = lines.filter(line => scopedItems.has(Number(line.order_item_id))).map(line => {
    const order = scopedItems.get(Number(line.order_item_id));
    return { product_name: line.product_name || line.bill_text, quantity: order.quantity,
      received_quantity: quantity(cents(order.received_quantity) + cents(line.quantity_received)),
      unit_name: line.unit || line.unit_text || '', receive_notes: line.note || '' };
  });
  const billItems = lines.filter(line => line.quantity_billed != null).map(line => ({
    product_name: line.product_name || line.bill_text,
    quantity: quantity(Math.round(cents(line.quantity_billed) * Number(line.unit_multiplier || 1))),
    received_quantity: line.quantity_received, unit_name: line.unit || line.unit_text || '', receive_notes: line.note || ''
  }));
  return { documentId: doc.id, branchId: doc.branch_id, departmentId: doc.department_id,
    deliveryDate: doc.delivery_date, sections: [
      ...(orderItems.length ? [{ basis: 'ใบสั่ง (ยอดรับสะสม)', items: orderItems }] : []),
      ...(billItems.length ? [{ basis: 'บิล (ใบรับนี้)', items: billItems }] : [])
    ], itemCount: lines.length };
}

export function receivingNotificationText({ documentId, sections, itemCount }, location, now = new Date()) {
  const date = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(now);
  const text = [`วันที่ ${date}`, `สาขา ${location.branchName} / ${location.departmentName} รับสินค้าทั้งหมด ${itemCount} รายการ${documentId ? ` (เอกสาร #${documentId})` : ''}`];
  if (!sections.length) text.push('บันทึกรับแล้ว (ไม่มีบิลหรือใบสั่งสำหรับเปรียบเทียบ)');
  for (const section of sections) {
    const variances = buildReceivingVarianceItems(section.items);
    text.push(`${section.basis}: ${variances.length ? '⚠️ ขาด/เกิน' : '✅ ครบทุกรายการ'}`);
    variances.forEach((item, index) => text.push(`${index + 1}. ${item.product_name} (${item.diff > 0 ? 'เกิน' : 'ขาด'}) ${item.diff > 0 ? '+' : '-'}${item.quantity} ${item.unit_abbr || item.unit_name || ''}${item.receive_notes ? ` เหตุผล: ${item.receive_notes}` : ''}`));
  }
  return text.join('\n');
}
