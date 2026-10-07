// ตรรกะล้วน (pure) ของ ledger สต็อก — แยกออกจาก model เพื่อให้ทดสอบได้โดยไม่ต้องต่อ DB
// inventory_transactions.created_at เก็บเป็น UTC (MySQL บน Railway) ส่วนวันที่ทางธุรกิจเป็นเวลาไทย
import { addDaysToDateKey, isDateKey } from './bangkok-date.js';

const BANGKOK_UTC_OFFSET_HOURS = 7;

// ปัดเศษกัน float noise (คอลัมน์ใน DB เป็น DECIMAL ทศนิยมน้อยกว่านี้อยู่แล้ว)
export const roundQty = (value) => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// INV-01: รายการนับสต็อกเป็นยอด "สัมบูรณ์"
// ---------------------------------------------------------------------------

// รายการ adjustment จาก stock_check คือ "ยอดนับจริง ณ เวลานั้น" ค่าที่เชื่อถือได้คือ balance_after
// (applyStockAdjustment ตั้ง balance_after = ยอดนับ) ส่วน quantity เป็นเพียงส่วนต่างที่คำนวณ ณ ตอน apply
export const isStockCheckAbsoluteRow = (row) =>
  String(row?.reference_type || '') === 'stock_check' &&
  String(row?.transaction_type || '') === 'adjustment' &&
  row?.balance_after !== null &&
  row?.balance_after !== undefined &&
  Number.isFinite(Number(row.balance_after));

/**
 * คำนวณ balance_before/after ของ ledger ใหม่ตามลำดับ (เรียงตาม created_at, id มาแล้ว)
 * - รายการปกติ: balance_after = balance_before + quantity
 * - รายการ stock_check (absolute): balance_after คงที่ = ยอดนับ แล้วคำนวณ quantity = ยอดนับ - balance_before
 *   ทำให้การแทรกรายการย้อนหลัง (ขายตามสูตร, แปรรูป ฯลฯ) ก่อนเวลานับ ไม่ทำให้ยอดหลังนับเพี้ยน
 * ถ้ามีรายการนับหลายรายการ ตัวสุดท้ายตามลำดับเวลาชนะโดยธรรมชาติ (แต่ละตัวตั้งยอดสัมบูรณ์ต่อกัน)
 * คืน { rows: [{ id, quantity, balance_before, balance_after }], balance, lastTransactionId }
 */
export const reflowLedgerRows = (orderedRows = []) => {
  let running = 0;
  const rows = [];
  for (const row of orderedRows) {
    const balanceBefore = running;
    let quantity;
    let balanceAfter;
    if (isStockCheckAbsoluteRow(row)) {
      balanceAfter = roundQty(row.balance_after);
      quantity = roundQty(balanceAfter - balanceBefore);
    } else {
      quantity = roundQty(row.quantity || 0);
      balanceAfter = roundQty(balanceBefore + quantity);
    }
    rows.push({ id: row.id, quantity, balance_before: roundQty(balanceBefore), balance_after: balanceAfter });
    running = balanceAfter;
  }
  return {
    rows,
    balance: running,
    lastTransactionId: orderedRows.length > 0 ? orderedRows[orderedRows.length - 1].id : null
  };
};

// ---------------------------------------------------------------------------
// INV-04: reference_id ของ stock_check
//   ปัจจุบัน  `${date}:${id}`
//   เก่า      `${date}:${id}:<timestamp>`
//   apply ซ้ำ `${date}:${id}:reapply:<ms>`
// ---------------------------------------------------------------------------

export const parseStockCheckReferenceId = (referenceId) => {
  const match = /^(\d{4}-\d{2}-\d{2}):(\d+)(?::(.*))?$/.exec(String(referenceId ?? ''));
  if (!match) return null;
  const suffix = match[3];
  return {
    date: match[1],
    stockCheckId: Number(match[2]),
    kind: suffix === undefined ? 'current' : suffix.startsWith('reapply:') ? 'reapply' : 'legacy'
  };
};

// ตรงกับ SQL: reference_id = 'date:id' OR reference_id LIKE 'date:id:%'
export const isStockCheckReferenceFor = (referenceId, date, stockCheckId) => {
  const parsed = parseStockCheckReferenceId(referenceId);
  return Boolean(parsed) && parsed.date === date && parsed.stockCheckId === Number(stockCheckId);
};

// ตรงกับ SQL: reference_id >= 'YYYY-MM-DD' (วันถัดไป) — เทียบกับวันถัดไป ไม่ใช่ `${date}:`
// เพราะ '2026-02-23:369' > '2026-02-23:' เป็น true (รายการวันเดียวกันจะบล็อกตัวเอง)
export const isStockCheckReferenceNewerThanDate = (referenceId, date) => {
  const nextDay = addDaysToDateKey(date, 1);
  if (!nextDay) return false;
  return String(referenceId ?? '') >= nextDay;
};

// ---------------------------------------------------------------------------
// INV-05: วันที่ไทย → ช่วงเวลา UTC ของ created_at
// ---------------------------------------------------------------------------

const toMysqlUtc = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

// เที่ยงคืนเวลาไทยของ dateKey เป็น UTC string ('2026-10-07' → '2026-10-06 17:00:00')
export const bangkokDateStartToUtc = (dateKey) => {
  if (!isDateKey(dateKey)) return null;
  const ms = Date.parse(`${String(dateKey).trim()}T00:00:00Z`) - BANGKOK_UTC_OFFSET_HOURS * 3600 * 1000;
  return Number.isNaN(ms) ? null : toMysqlUtc(new Date(ms));
};

/**
 * ช่วง created_at (UTC) ที่ครอบคลุมวันที่ไทย startDate..endDate รวมปลายทาง
 * ใช้ `created_at >= startUtc AND created_at < endUtcExclusive` (index-friendly)
 */
export const bangkokDateRangeToUtc = (startDate, endDate = startDate) => {
  const startUtc = bangkokDateStartToUtc(startDate);
  const endNext = addDaysToDateKey(String(endDate ?? '').trim(), 1);
  const endUtcExclusive = endNext ? bangkokDateStartToUtc(endNext) : null;
  if (!startUtc || !endUtcExclusive) {
    const error = new Error('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
    error.statusCode = 400;
    throw error;
  }
  return { startUtc, endUtcExclusive };
};

// SQL fragment สำหรับกรอง created_at ตามวันที่ไทย (ใส่ params ตามลำดับ: start, endExclusive)
// column ต้องเป็นชื่อคอลัมน์ที่โค้ดกำหนดเอง ไม่ใช่ input ผู้ใช้
export const buildBangkokDateRangeSql = (column, startDate, endDate = startDate) => {
  const { startUtc, endUtcExclusive } = bangkokDateRangeToUtc(startDate, endDate);
  return { sql: `${column} >= ? AND ${column} < ?`, params: [startUtc, endUtcExclusive] };
};

// แปลง created_at (UTC) เป็นเวลาไทยใน SQL โดยไม่พึ่งตาราง timezone ของ MySQL
export const BANGKOK_CONVERT_TZ = (column) => `CONVERT_TZ(${column}, '+00:00', '+07:00')`;
