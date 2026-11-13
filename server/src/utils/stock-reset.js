// เริ่มใช้สต็อกจริง: ตั้งยอดทุกคู่ (สินค้า, แผนก) เป็น 0 ณ เวลาเดียวกัน (เจ้าของเลือก 13 พ.ย. 2569)
// ตรรกะล้วนของ scripts/reset-stock-balances-to-zero.mjs

const UTC_TEXT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;
const toUtcText = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * เวลารีเซ็ต (UTC 'YYYY-MM-DD HH:mm:ss') — ไม่ใส่ = ตอนนี้; ห้ามเป็นอนาคต
 * (แถวในอนาคตทำให้รายการที่เกิดก่อนถึงเวลานั้นถูกลบล้างทีหลัง และ createTransaction ต่อท้ายผิดลำดับ)
 */
export const resolveResetAt = (value, nowMs = Date.now()) => {
  if (value === undefined || value === null || value === '') return toUtcText(nowMs);
  const text = String(value).trim();
  const match = UTC_TEXT.exec(text);
  const ms = match ? Date.parse(`${match[1]}T${match[2]}Z`) : NaN;
  if (Number.isNaN(ms)) throw new Error('--at ต้องเป็นเวลา UTC รูปแบบ "YYYY-MM-DD HH:mm:ss"');
  if (ms > nowMs + 60 * 1000) throw new Error('--at ต้องไม่เป็นเวลาในอนาคต');
  return text;
};

// reference_id ของแถวรีเซ็ต ผูกกับเวลา → รันซ้ำด้วย --at เดิมจะข้ามคู่ที่ทำไปแล้ว
export const buildResetLabel = (atUtc) => `go-live-zero:${String(atUtc).replace(/\D/g, '')}`;

/**
 * คู่ที่ต้องรีเซ็ต = ทุกคู่ที่มีประวัติใน ledger + คู่ที่มียอดค้างใน inventory_balance แต่ไม่มีประวัติ
 * ข้ามคู่ที่มีแถวรีเซ็ต label นี้แล้ว; เรียง (แผนก, สินค้า) ตามลำดับล็อกมาตรฐาน กัน deadlock
 */
export const planResetPairs = ({ ledgerPairs = [], balanceRows = [], donePairs = [] }) => {
  const key = (row) => `${Number(row.department_id)}:${Number(row.product_id)}`;
  const done = new Set(donePairs.map(key));
  const pairs = new Map();
  for (const row of ledgerPairs) pairs.set(key(row), row);
  for (const row of balanceRows) {
    if (Math.abs(Number(row.quantity) || 0) > 0.0000005) pairs.set(key(row), row);
  }
  return Array.from(pairs.entries())
    .filter(([k]) => !done.has(k))
    .map(([, row]) => ({ productId: Number(row.product_id), departmentId: Number(row.department_id) }))
    .filter((pair) => Number.isFinite(pair.productId) && Number.isFinite(pair.departmentId))
    .sort((a, b) => a.departmentId - b.departmentId || a.productId - b.productId);
};
