// วันที่ทางธุรกิจของร้านใช้เวลาไทยเสมอ ไม่ขึ้นกับ TZ ของเครื่อง (Railway ใช้ UTC)
// ห้ามแก้ปัญหาวันที่ด้วยการตั้ง TZ=Asia/Bangkok เพราะ mysql2 คืนคอลัมน์ DATE
// เป็นเที่ยงคืนตาม TZ ของเครื่อง และโค้ดเดิมหลายจุดพึ่งค่านั้นอยู่
export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDateKey = (value) => DATE_KEY_PATTERN.test(String(value ?? '').trim());

export const toBangkokDateKey = (value = new Date()) => {
  if (typeof value === 'string' && isDateKey(value)) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

export const getBangkokDateKey = () => toBangkokDateKey(new Date());

// บวก/ลบวันจาก date key โดยคำนวณบน UTC ล้วน จึงไม่เลื่อนตาม TZ ของเครื่อง
export const addDaysToDateKey = (dateKey, days) => {
  if (!isDateKey(dateKey)) return null;
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};
