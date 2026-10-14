// กติกาหน่วยสินค้า (pure functions — ไม่แตะ DB เพื่อให้ unit test ได้)

const toPositiveId = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// UNIT-01: หาแถวผลลัพธ์ของสินค้าจาก list (listProductUnitSettings คืน array ไม่ใช่ [rows])
export const findSettingsRow = (rows, productId) => {
  const id = Number(productId);
  const list = Array.isArray(rows) ? rows : [];
  return list.find((row) => Number(row?.id) === id) || null;
};

// UNIT-02: มีตัวแปลงใน unit_conversions (ทิศใดทิศหนึ่ง) หรือไม่
export const hasUnitConversion = (fromUnitId, toUnitId, conversions = []) => {
  const from = toPositiveId(fromUnitId);
  const to = toPositiveId(toUnitId);
  if (!from || !to) return false;
  if (from === to) return true;
  return (Array.isArray(conversions) ? conversions : []).some((row) => {
    const f = Number(row?.from_unit_id);
    const t = Number(row?.to_unit_id);
    const m = Number(row?.multiplier);
    if (!(m > 0)) return false;
    return (f === from && t === to) || (f === to && t === from);
  });
};

// UNIT-02: คืนข้อความ error ภาษาไทยเมื่อหน่วยของวัตถุดิบในสูตรไม่ตรงหน่วยฐานและไม่มีตัวแปลง; ปกติคืน null
export const getRecipeUnitMismatchMessage = ({
  productName,
  productUnitId,
  productUnitName,
  unitId,
  unitName,
  conversions
}) => {
  const baseId = toPositiveId(productUnitId);
  const chosenId = toPositiveId(unitId);
  if (!baseId || !chosenId || baseId === chosenId) return null;
  if (hasUnitConversion(chosenId, baseId, conversions)) return null;
  return `หน่วยในสูตร "${unitName || chosenId}" ไม่ตรงกับหน่วยฐานของสินค้า "${productName || ''}" ` +
    `("${productUnitName || baseId}") และยังไม่มีตัวแปลงหน่วย ${unitName || chosenId} ↔ ${productUnitName || baseId} ` +
    'ในตารางแปลงหน่วย กรุณาใช้หน่วยฐานหรือเพิ่มตัวแปลงหน่วยก่อน';
};

const REF_LABELS = [
  ['inventory_transactions', 'รายการเคลื่อนไหวสต๊อก'],
  ['inventory_balance', 'ยอดคงเหลือที่ไม่เป็นศูนย์'],
  ['menu_recipe_items', 'วัตถุดิบในสูตร'],
  ['stock_checks', 'ผลนับสต๊อก'],
  ['purchase_unit_links', 'หน่วยซื้อของซัพพลายเออร์'],
  ['open_po_items', 'รายการ PO ที่ยังไม่ปิด']
];

// UNIT-05: สรุปสิ่งที่อ้างอิงหน่วยฐานเดิม; คืน [] ถ้าไม่มี
export const summarizeUnitReferences = (counts = {}) =>
  REF_LABELS
    .map(([key, label]) => ({ key, label, count: Number(counts[key]) || 0 }))
    .filter((item) => item.count > 0);

export const buildBaseUnitChangeMessage = (productName, refs) => {
  if (!refs || refs.length === 0) return null;
  const detail = refs.map((r) => `${r.label} ${r.count} รายการ`).join(', ');
  return `สินค้า "${productName || ''}" มีข้อมูลที่อ้างอิงหน่วยฐานเดิม (${detail}) ` +
    'การเปลี่ยนหน่วยฐานจะไม่แปลงจำนวนสต๊อก/สูตร/ตัวคูณเดิมให้อัตโนมัติ ' +
    'หากต้องการเปลี่ยนจริงให้ยืนยันซ้ำ (force_unit_change)';
};

export const isForceUnitChange = (value) =>
  value === true || value === 'true' || value === 1 || value === '1';

// ตรวจว่าหน่วยฐานเปลี่ยนจริงหรือไม่
export const isBaseUnitChanging = (currentUnitId, nextUnitId) => {
  if (nextUnitId === undefined || nextUnitId === null || nextUnitId === '') return false;
  return Number(currentUnitId) !== Number(nextUnitId);
};
