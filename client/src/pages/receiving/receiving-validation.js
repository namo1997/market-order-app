import { lineAmount, scaledInteger, sumLines } from './receiving-utils.js';

export const headerMoneyFields = ['subtotal', 'discount', 'vat', 'total'];
export const lineNumberFields = ['quantity_received', 'quantity_billed', 'unit_price', 'amount'];

export function numberError(value, key) {
  if (value == null || value === '') return key === 'quantity_received' ? 'กรอกจำนวนรับจริง' : '';
  try {
    const places = key === 'unit_price' ? 6 : 2;
    const amount = scaledInteger(value, places);
    const limit = key.startsWith('quantity_') ? 9999999999n : key === 'unit_price' ? 999999999999n : key === 'amount' ? 99999999999n : 99999999999999n;
    return amount > limit ? 'ตัวเลขสูงเกินกำหนด' : '';
  } catch (error) { return error.message; }
}

export function lineErrors(line, kind) {
  const errors = Object.fromEntries(lineNumberFields.map(key => [key, numberError(line[key], key)]));
  if (!errors.amount) {
    try { if (lineAmount(line) > 99999999999n) errors.amount = 'ยอดบรรทัดสูงเกินกำหนด'; }
    catch { /* ข้อผิดพลาดจำนวน/ราคาจะแสดงข้างช่องต้นเหตุ */ }
  }
  if (kind === 'bill' && !line.product_id) errors.product_id = 'เลือกสินค้าให้รายการนี้';
  return errors;
}

export function headerErrors(doc) {
  const errors = Object.fromEntries(headerMoneyFields.map(key => [key, numberError(doc[key], key)]));
  if (!errors.discount && !errors.vat) {
    try {
      if (sumLines(doc.lines) - scaledInteger(doc.discount || '0') + scaledInteger(doc.vat || '0') < 0n) errors.discount = 'ส่วนลดมากกว่ายอดรวมและภาษี';
    } catch { /* ให้ชี้ช่องจำนวน/ราคาต้นเหตุแทน */ }
  }
  return errors;
}

export function firstDocumentError(doc, { requireProducts = false } = {}) {
  for (let index = 0; index < doc.lines.length; index++) {
    const errors = lineErrors(doc.lines[index], doc.kind);
    const field = [...lineNumberFields, ...(requireProducts ? ['product_id'] : [])].find(key => errors[key]);
    if (field) return { index, field, id: `line-${index}-${field}` };
  }
  const errors = headerErrors(doc);
  const field = headerMoneyFields.find(key => errors[key]);
  if (field) return { field, id: `header-${field}` };
  return null;
}

export function focusField(id, root = document) {
  const input = root.getElementById(id);
  if (!input) return;
  const disclosure = input.closest('details');
  if (disclosure) disclosure.open = true;
  input.focus({ preventScroll: true });
  const row = input.closest('.rc-compact-item');
  (row || input).scrollIntoView?.({ block: 'center', behavior: 'instant' });
  const view = root.defaultView;
  const rect = (row || input).getBoundingClientRect?.();
  if (!view || !rect || input.closest('dialog')) return;
  const viewport = view.visualViewport;
  const bar = root.querySelector?.('.rc-document .sg-bar:not(.sg-bar-inline)')?.getBoundingClientRect();
  const helper = root.querySelector?.('.rc-review-toolbar')?.getBoundingClientRect();
  const shell = root.querySelector?.('.rc-shell-header, .rc-topbar')?.getBoundingClientRect();
  const top = Math.max(viewport?.offsetTop || 0, helper?.bottom || 0, shell?.bottom || 0) + 8;
  const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || view.innerHeight), bar?.top ?? view.innerHeight);
  if (rect.height > bottom - top) {
    const field = input.getBoundingClientRect();
    if (field.bottom > bottom) view.scrollBy?.({ top: field.bottom - bottom, behavior: 'instant' });
    else if (field.top < top) view.scrollBy?.({ top: field.top - top, behavior: 'instant' });
    return;
  }
  if (rect.bottom > bottom) view.scrollBy?.({ top: rect.bottom - bottom, behavior: 'instant' });
  else if (rect.top < top) view.scrollBy?.({ top: rect.top - top, behavior: 'instant' });
}
