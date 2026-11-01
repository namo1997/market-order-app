// จำกัดการเดา PIN แบบง่ายในหน่วยความจำ (ต่อ IP + ประเภท PIN)
// PIN 4 หลักเดาครบได้ในไม่กี่วินาทีถ้าไม่จำกัด
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();

const getClientKey = (req, scope) => {
  // proxy (เช่น Railway) ต่อ IP จริงไว้ท้ายสุด; ค่าแรกๆ ผู้ใช้ปลอมได้
  const forwardedList = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const forwarded = forwardedList[forwardedList.length - 1] || '';
  const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${scope}:${ip}`;
};

const prune = (now) => {
  if (failures.size < 5000) return;
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
};

// คืนจำนวนวินาทีที่ต้องรอ ถ้าถูกล็อกอยู่ (0 = ลองได้)
export const getPinLockSeconds = (req, scope) => {
  const entry = failures.get(getClientKey(req, scope));
  const now = Date.now();
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.resetAt - now) / 1000) : 0;
};

export const recordPinFailure = (req, scope) => {
  const key = getClientKey(req, scope);
  const now = Date.now();
  prune(now);
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
};

export const clearPinFailures = (req, scope) => {
  failures.delete(getClientKey(req, scope));
};

export const sendPinLocked = (res, seconds) =>
  res.status(429).json({
    success: false,
    message: `กรอก PIN ผิดหลายครั้ง กรุณารอประมาณ ${Math.max(1, Math.ceil(seconds / 60))} นาทีแล้วลองใหม่`
  });
