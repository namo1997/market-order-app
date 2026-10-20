import { createReceivingError, parseImageDataUrl } from '../services/receiving-ocr.service.js';
export const TYPES = ['shortage', 'damaged', 'wrong_item', 'return', 'over'];
export const RESOLUTIONS = ['redelivered', 'new_bill', 'credit_note', 'returned', 'written_off'];
export const manager = user => ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
export const fail = (message = 'ข้อมูลไม่ถูกต้อง', code = 'VALIDATION_FAILED') => { throw createReceivingError(code, message); };
export const idOf = value => {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('รหัสไม่ถูกต้อง');
  return Number(value);
};
export const text = (value, max = 1000, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail();
  return value.trim();
};
export const uuid = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) fail('รหัสคำขอไม่ถูกต้อง');
  return value;
};
export const stamp = date => new Date(date).toISOString().slice(0, 23).replace('T', ' ');
// DATETIME fields in this store are UTC wall-clock strings, independent of
// mysql2/host timezone. Preserve offsets already supplied by an API or test.
export const iso = value => {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).replace(' ', 'T');
  return new Date(/[Zz]$|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`).toISOString();
};
export const due = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('กำหนดตามต้องมีเขตเวลา');
  return stamp(value);
};
// Parse decimals as hundredths; no floating point multiplication or summation.
export const units = (value, positive = false) => {
  const s = String(value ?? '');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) fail('จำนวนหรือมูลค่ารองรับทศนิยม 2 ตำแหน่ง');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (n > 999999999999n || (positive && n === 0n)) fail('จำนวนหรือมูลค่าเกินขอบเขต');
  return n;
};
export const decimal = n => `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
export function assertAccess(user, row) {
  if (!row) fail('ไม่พบเรื่อง', 'NOT_FOUND');
  if (!manager(user) && (!user.branch_id || Number(row.branch_id) !== Number(user.branch_id))) fail('ไม่มีสิทธิ์ดูเรื่องต่างสาขา', 'FORBIDDEN');
}
export const assertManager = user => { if (!manager(user)) fail('เฉพาะบัญชีหรือผู้ดูแล', 'FORBIDDEN'); };
export const assertOpen = row => { if (['resolved', 'cancelled'].includes(row.status)) fail('เรื่องนี้ปิดแล้ว', 'NOT_DRAFT'); };
export function parseEvidence(body) {
  const image = parseImageDataUrl(body.image_data_url);
  const collector = body.collector_name == null ? null : text(body.collector_name, 255, true);
  const signature = body.signature_data_url == null ? null : parseImageDataUrl(body.signature_data_url, { allowedMimes: ['image/png'] });
  return { image, signature, collector, clientUuid: uuid(body.client_uuid), note: text(body.note ?? '') };
}
export function discrepancies(lines) {
  return lines.flatMap(line => {
    const expected = line.quantity_expected ?? line.quantity_billed;
    if (expected == null) return [];
    const delta = units(expected) - units(line.quantity_received ?? 0);
    if (delta === 0n) return [];
    const qty = delta > 0n ? delta : -delta;
    const priceText = String(line.unit_price ?? 0);
    if (!/^\d{1,10}(\.\d{1,6})?$/.test(priceText)) fail('ราคาต่อหน่วยไม่ถูกต้อง');
    const [priceWhole, priceFraction = ''] = priceText.split('.');
    const price = BigInt(priceWhole) * 1000000n + BigInt(priceFraction.padEnd(6, '0'));
    return [{ line_id: line.id, type: delta > 0n ? 'shortage' : 'over',
      product_name: String(line.product_name || line.bill_text || '').slice(0, 255),
      quantity: decimal(qty), amount: decimal((qty * price + 500000n) / 1000000n) }];
  });
}

export function confirmIssueCandidates(lines, scopedItems) {
  try {
    return lines.flatMap(line => {
      if (line.review_decision === 'not_delivered') return [];
      if (line.counted_quantity != null || line.review_decision != null) {
        // Concept A: the bill is the comparison basis. Order shortages remain
        // queue information and must not become a second supplier-bill claim.
        const displayQuantity = value => value == null ? 'ไม่ทราบจำนวน' : `${String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')} ${line.unit_text || 'หน่วย'}`;
        const explanation = `นับได้ ${displayQuantity(line.counted_quantity)} · รับจริง ${displayQuantity(line.quantity_received)} · ในบิล ${displayQuantity(line.quantity_billed)}`;
        const evidence = { unit_text: line.unit_text || 'หน่วย', return_status: line.review_decision === 'not_received' ? line.return_status || 'waiting' : null, comparison: 'bill', counted_quantity: line.counted_quantity ?? null,
          quantity_received: line.quantity_received, quantity_billed: line.quantity_billed,
          review_decision: line.review_decision ?? null };
        if (['missing_bill', 'not_received'].includes(line.review_decision)) {
          // Refused stock was counted physically but never added to inventory.
          const returning = line.review_decision === 'not_received';
          const quantity = returning ? line.counted_quantity : line.quantity_received;
          if (quantity == null || units(quantity) === 0n) return [];
          return [{ line_id: line.id, type: returning ? 'return' : 'wrong_item',
            product_name: String(line.product_name || line.bill_text || '').slice(0,255),
            quantity: decimal(units(quantity)), amount: null, ...evidence,
            note: returning ? `ไม่รับ · คืนร้าน ${quantity} ${line.unit_text || ''} (ไม่ได้เพิ่มคลัง) · ${line.return_status === 'collected' ? 'ร้านมารับแล้ว · รอหลักฐาน' : 'รอร้านมารับ'}`
              : `ไม่มีในบิล · ให้บัญชีขอบิลจากร้าน: รับ ${quantity} ${line.unit_text || ''} · รอตรวจราคา` }];
        }
        const issues = discrepancies([{ ...line, quantity_expected: line.quantity_billed }]);
        if (line.review_decision === 'wrong_product') {
          const quantity = line.quantity_received ?? line.counted_quantity ?? line.quantity_billed;
          if (quantity == null || units(quantity) === 0n) return [];
          return [{ line_id: line.id, type: 'wrong_item', product_name: String(line.product_name || line.bill_text || '').slice(0,255),
            quantity: decimal(units(quantity)), amount: null, ...evidence,
            note: `ตรวจสินค้าไม่ตรงจากใบรับ: ${explanation}` }];
        }
        return issues.map(issue => ({ ...issue, ...evidence,
          note: `เทียบบิล: ${explanation} · ${issue.type === 'shortage' ? 'แจ้งร้านว่าของขาด' : 'แจ้งร้านว่าของเกินบิล'}` }));
      }
      // Legacy receipts have no count/decision evidence: retain their frozen
      // outstanding-order behavior without inferring a count from the order.
      const expected = scopedItems.get(Number(line.order_item_id));
      const remaining = expected ? units(expected.quantity ?? 0) - units(expected.received_quantity ?? 0) : null;
      return discrepancies([{ ...line, quantity_expected: remaining !== null ? decimal(remaining > 0n ? remaining : 0n) : line.quantity_billed }]);
    });
  } catch { return null; } // Issue reconciliation must never invalidate an otherwise valid receipt.
}
