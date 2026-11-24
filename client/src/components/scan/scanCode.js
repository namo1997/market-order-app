// เครื่องยิงบาร์โค้ด (USB/Bluetooth) ส่ง "ปุ่ม" ไม่ใช่ตัวอักษร: ถ้าเครื่องตั้งแป้นพิมพ์ภาษาไทย (เกษมณี)
// ตัวเลขแถวบนจะกลายเป็นตัวไทย เช่น 001462910002 → "จจๅภุ/ตๅจจจ/" (เจ้าของลองยิงบน Mac 24 พ.ย. 2569)
// แปลงกลับเป็นตัวเลขทั้งในช่องสแกนและตัวฟังปุ่มรวม

// แถวตัวเลขของแป้นเกษมณี (ไม่กด Shift): 1 2 3 4 5 6 7 8 9 0
const KEDMANEE_DIGITS = {
  'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0'
};
const THAI_NUMERAL_ZERO = 0x0e50; // ๐..๙
const THAI_CHAR = /[฀-๿]/;

const charToDigit = (char, kedmanee) => {
  if (/^\d$/.test(char)) return char;
  const code = char.charCodeAt(0);
  if (code >= THAI_NUMERAL_ZERO && code <= THAI_NUMERAL_ZERO + 9) return String(code - THAI_NUMERAL_ZERO);
  if (kedmanee && KEDMANEE_DIGITS[char]) return KEDMANEE_DIGITS[char];
  return '';
};

/**
 * ข้อความจากช่องสแกน/เครื่องยิง → ตัวเลขล้วน
 * ใช้ตาราง / → 2, - → 3 เฉพาะเมื่อข้อความมีตัวไทย (แป้นไทยแน่นอน) ไม่งั้นแค่ตัดตัวที่ไม่ใช่ตัวเลข
 */
export const normalizeScanCode = (raw) => {
  const text = String(raw ?? '');
  const kedmanee = THAI_CHAR.test(text);
  let digits = '';
  for (const char of text) digits += charToDigit(char, kedmanee);
  return digits;
};

/**
 * ตัวเลขของปุ่มที่กด (keydown) ไม่ขึ้นกับภาษาแป้นพิมพ์: ใช้ event.code (Digit0–9 / Numpad0–9) ก่อน
 * ถ้าไม่มี code (บางเครื่อง) ค่อยแปลงจาก event.key ตามตารางแป้นไทย; ไม่ใช่ตัวเลข → ''
 */
export const keyEventToDigit = (event) => {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(String(event?.code || ''));
  if (match) return match[1];
  const key = String(event?.key || '');
  return [...key].length === 1 ? charToDigit(key, true) : '';
};
