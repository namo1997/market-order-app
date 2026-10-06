import { roundMoney, sumMoney } from './money.js';

// Problems staff report against a day's money, e.g. a Grab order that was
// cancelled but never voided in POS. An issue explains part of the over/short;
// it never changes the closing snapshot or any received amount.
export const ISSUE_CATEGORIES = {
  GRAB_NOT_CANCELLED: 'ลืมยกเลิกออเดอร์ Grab ใน POS',
  POS_BILL_ERROR: 'บิล POS ผิด/ซ้ำ/ไม่ได้ยกเลิก',
  WRONG_CHANNEL: 'กดช่องทางชำระเงินผิด',
  CASH_COUNT: 'เงินสดนับผิด/ทอนผิด',
  DEPOSIT: 'มัดจำหรือจ่ายล่วงหน้า',
  REFUND: 'คืนเงินลูกค้า',
  OTHER: 'อื่นๆ'
};
export const ISSUE_DIRECTIONS = { SHORT: 'ทำให้เงินขาด', OVER: 'ทำให้เงินเกิน' };

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

export function validateIssue(input = {}) {
  const category = String(input.category || '');
  if (!ISSUE_CATEGORIES[category]) fail('เลือกประเภทปัญหา');
  const direction = String(input.direction || '');
  if (!ISSUE_DIRECTIONS[direction]) fail('เลือกว่าปัญหาทำให้เงินขาดหรือเกิน');
  const raw = String(input.amount ?? '').replaceAll(',', '').trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) fail('ระบุจำนวนเงินมากกว่า 0 ไม่เกิน 2 ตำแหน่ง');
  const note = String(input.note || '').trim();
  if (!note || note.length > 1000) fail('กรุณาระบุหมายเหตุไม่เกิน 1,000 ตัวอักษร');
  const channel = input.payment_channel_id === undefined || input.payment_channel_id === null || input.payment_channel_id === '' ? null : Number(input.payment_channel_id);
  if (channel !== null && (!Number.isSafeInteger(channel) || channel <= 0)) fail('ช่องทางไม่ถูกต้อง');
  // Stored with the sign of the over/short it explains: short is negative.
  const amount = roundMoney(direction === 'SHORT' ? -Number(raw) : Number(raw));
  return { category, amount, note, paymentChannelId: channel };
}

export function summarizeIssues(issues = [], variance = null) {
  const active = issues.filter((issue) => issue.status !== 'VOID');
  const explained = sumMoney(active.map((issue) => issue.amount));
  return {
    issue_count: active.length,
    open_issue_count: active.filter((issue) => issue.status === 'OPEN').length,
    issue_explained: active.length ? explained : 0,
    variance_unexplained: variance === null || variance === undefined ? null : roundMoney(Number(variance) - explained)
  };
}

export const issueLabel = (issue) => `${ISSUE_CATEGORIES[issue.category] || issue.category} ${Number(issue.amount) < 0 ? 'ขาด' : 'เกิน'} ${Math.abs(Number(issue.amount)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
