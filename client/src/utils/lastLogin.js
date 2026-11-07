// จำสาขา/แผนกที่เข้าล่าสุดของเครื่องนี้ (เจ้าของสั่ง 2026-11-07) ให้หน้า login แตะครั้งเดียวเข้าได้
// เก็บแค่ id/ชื่อ ไม่เก็บ token — ปิดแท็บแล้วยังต้องกดเข้าใหม่เหมือนเดิม
const KEY = 'lastLogin';

const pick = (value) => (value && value.id !== undefined && value.id !== null
  ? { id: value.id, name: String(value.name || ''), ...(value.code ? { code: String(value.code) } : {}) }
  : null);

export const saveLastLogin = (branch, department, storage = globalThis.localStorage) => {
  const entry = { branch: pick(branch), department: pick(department) };
  if (!entry.branch || !entry.department) return;
  try { storage?.setItem(KEY, JSON.stringify(entry)); } catch { /* ไม่มีที่เก็บก็แค่ไม่จำ */ }
};

export const clearLastLogin = (storage = globalThis.localStorage) => {
  try { storage?.removeItem(KEY); } catch { /* ignore */ }
};

// คืนค่าเฉพาะเมื่อสาขายังอยู่ในรายการที่เปิดให้เลือก (ใช้ข้อมูลสาขาล่าสุดจาก API)
export const readLastLogin = (branches = [], storage = globalThis.localStorage) => {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(KEY) || 'null'); } catch { return null; }
  const department = pick(saved?.department);
  const branch = branches.find((item) => String(item?.id) === String(saved?.branch?.id));
  return branch && department ? { branch, department } : null;
};
