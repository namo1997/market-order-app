// กติกา "หน่วยใช้" ต่อสินค้า (pure functions — ไม่แตะ DB เพื่อให้ unit test ได้)
// หน่วยใช้ = หน่วยที่พนักงานกรอกตอนแปรรูป เช่น มล. ส่วนสต๊อกยังเก็บเป็นหน่วยฐาน เช่น แกลลอน
// usage_per_base = 1 หน่วยฐาน เท่ากับกี่หน่วยใช้ (1 แกลลอน = 4500 มล.)

// inventory_transactions.quantity เป็น DECIMAL(10,2) จึงปัดหน่วยฐานเป็นทศนิยม 2 ตำแหน่ง
export const BASE_QUANTITY_DECIMALS = 2;

const toPositiveId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const roundBaseQuantity = (value) => {
  const factor = 10 ** BASE_QUANTITY_DECIMALS;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

// ตรวจค่าที่จะบันทึก; คืน { value: null } เมื่อเลิกใช้หน่วยใช้, { value } หรือ { error }
export const normalizeUsageUnitConfig = ({ usageUnitId, usagePerBase, baseUnitId }) => {
  const unitId = toPositiveId(usageUnitId);
  if (usageUnitId === undefined || usageUnitId === null || usageUnitId === '') return { value: null };
  if (!unitId) return { error: 'หน่วยใช้ไม่ถูกต้อง' };
  if (unitId === toPositiveId(baseUnitId)) return { value: null };
  const multiplier = Number(usagePerBase);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return { error: 'กรุณากรอกจำนวนหน่วยใช้ต่อ 1 หน่วยฐานให้มากกว่า 0' };
  }
  if (multiplier > 1000000) return { error: 'จำนวนหน่วยใช้ต่อ 1 หน่วยฐานต้องไม่เกิน 1,000,000' };
  return { value: { usage_unit_id: unitId, usage_per_base: multiplier } };
};

// แปลงจำนวนที่กรอกเป็นหน่วยฐาน
// product = { base_unit_id, usage_unit_id, usage_per_base } (usage_* เป็น null เมื่อไม่ได้ตั้ง)
// ไม่ส่ง inputUnitId หรือส่งหน่วยฐาน = จำนวนเป็นหน่วยฐานอยู่แล้ว; คืน { quantity, input } หรือ { error }
export const convertUsageToBase = ({ quantity, inputUnitId, product, productName = '' }) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return { error: `จำนวน "${productName}" ต้องมากกว่า 0` };
  const unitId = toPositiveId(inputUnitId);
  if (!unitId || unitId === toPositiveId(product?.base_unit_id)) return { quantity: qty, input: null };
  if (unitId !== toPositiveId(product?.usage_unit_id) || !(Number(product?.usage_per_base) > 0)) {
    return { error: `หน่วยที่กรอกของ "${productName}" ไม่ตรงกับหน่วยใช้ที่ตั้งไว้ กรุณาโหลดหน้าใหม่` };
  }
  const base = roundBaseQuantity(qty / Number(product.usage_per_base));
  if (base <= 0) {
    return { error: `จำนวน "${productName}" น้อยเกินไป (${qty} ต่ำกว่า 0.01 หน่วยฐาน)` };
  }
  return { quantity: base, input: { quantity: qty, unit_id: unitId } };
};
