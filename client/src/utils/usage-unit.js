// หน่วยใช้ของวัตถุดิบในหน้าแปรรูป (ต้องปัดแบบเดียวกับ server/src/utils/usage-unit-rules.js)

export const roundBaseQuantity = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// ingredient.usage_unit = { id, name, abbr, per_base } หรือ null
export const usageUnitOf = (ingredient) =>
  ingredient?.usage_unit && Number(ingredient.usage_unit.per_base) > 0 ? ingredient.usage_unit : null;

export const inputUnitLabel = (ingredient) => {
  const usage = usageUnitOf(ingredient);
  if (usage) return usage.abbr || usage.name || '';
  return ingredient?.unit_abbr || ingredient?.unit_name || '';
};

// จำนวนหน่วยฐานที่จะตัดสต๊อกจริง (ไม่มีหน่วยใช้ = จำนวนเดิม)
export const toBaseQuantity = (ingredient, quantity) => {
  const usage = usageUnitOf(ingredient);
  const qty = Number(quantity);
  if (!usage || !Number.isFinite(qty)) return qty;
  return roundBaseQuantity(qty / Number(usage.per_base));
};

export const formatNumber = (value) => Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 4 });
