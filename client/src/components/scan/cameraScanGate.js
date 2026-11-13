// กันกล้องส่งผลรัว: สติกเกอร์ติดกันเป็นม้วน กล้องเห็นหลายดวงพร้อมกันแล้วสลับ A, B, A, B ทุกเฟรม
// 1) ดวงที่ยังอยู่ในภาพ ไม่ส่งซ้ำ จนกว่าจะหายจากภาพเกิน holdMs
// 2) เว้นระยะระหว่างผลอย่างน้อย minGapMs (ดวงที่ถูกเลื่อนไว้ยังส่งได้ทีหลัง)
// 3) เห็นหลายดวง → เลือกดวงที่ใกล้กลางภาพที่สุด และไม่นับดวงที่อยู่ขอบภาพ
export const SEEN_HOLD_MS = 2500;
export const MIN_GAP_MS = 900;
export const CENTER_REGION = 0.7; // ยอมรับเฉพาะดวงที่จุดกลางอยู่ใน 70% กลางภาพ

export const createScanGate = ({ holdMs = SEEN_HOLD_MS, minGapMs = MIN_GAP_MS, now = () => Date.now() } = {}) => {
  const seen = new Map();
  let lastEmitAt = -Infinity;
  return (code) => {
    const at = now();
    const previous = seen.get(code);
    if (previous !== undefined && at - previous < holdMs) {
      seen.set(code, at); // ยังเห็นอยู่ ต่อเวลา
      return false;
    }
    if (at - lastEmitAt < minGapMs) return false; // ยังไม่จำว่าเห็น ให้ส่งได้เมื่อพ้นช่วงเว้น
    seen.set(code, at);
    lastEmitAt = at;
    return true;
  };
};

const inCenterRegion = (x, y, width, height, region = CENTER_REGION) => {
  if (!(width > 0) || !(height > 0)) return true;
  const marginX = (width * (1 - region)) / 2;
  const marginY = (height * (1 - region)) / 2;
  return x >= marginX && x <= width - marginX && y >= marginY && y <= height - marginY;
};

// ผลจาก BarcodeDetector: [{ rawValue, boundingBox: { x, y, width, height } }]
export const pickCenteredCode = (results = [], frameWidth = 0, frameHeight = 0) => {
  let best = null;
  let bestDistance = Infinity;
  for (const result of results) {
    const box = result?.boundingBox;
    const code = String(result?.rawValue || '').trim();
    if (!code) continue;
    if (!box || !(frameWidth > 0) || !(frameHeight > 0)) {
      if (!best) best = code;
      continue;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    if (!inCenterRegion(cx, cy, frameWidth, frameHeight)) continue;
    const distance = Math.hypot(cx - frameWidth / 2, cy - frameHeight / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = code;
    }
  }
  return best;
};

// ผลจาก zxing: จุดอ้างอิงของบาร์โค้ด [{ x, y }] → ใช้จุดกลางตัดสินว่าอยู่กลางภาพไหม
export const isPointsCentered = (points = [], frameWidth = 0, frameHeight = 0) => {
  const valid = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (valid.length === 0) return true;
  const cx = valid.reduce((sum, point) => sum + point.x, 0) / valid.length;
  const cy = valid.reduce((sum, point) => sum + point.y, 0) / valid.length;
  return inCenterRegion(cx, cy, frameWidth, frameHeight);
};
