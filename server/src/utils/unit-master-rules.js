const cleanText = (value) => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';

export const normalizeUnitInput = (input = {}) => {
    const name = cleanText(input?.name);
    const abbreviation = cleanText(input?.abbreviation);
    if (!name) return { error: 'กรุณากรอกชื่อหน่วยนับ' };
    if (!abbreviation) return { error: 'กรุณากรอกตัวย่อ' };
    if ([...name].length > 50) return { error: 'ชื่อหน่วยนับต้องไม่เกิน 50 ตัวอักษร' };
    if ([...abbreviation].length > 10) return { error: 'ตัวย่อต้องไม่เกิน 10 ตัวอักษร' };
    return { value: { name, abbreviation } };
};

const usageLabels = {
    products_active: 'สินค้า',
    products_inactive: 'สินค้าปิดใช้',
    purchase_unit_links: 'หน่วยซื้อ',
    stock_templates: 'แบบเช็คสต๊อก',
    menu_recipe_items: 'สูตร',
    production_ingredients: 'วัตถุดิบแปรรูป',
    unit_conversions: 'ตัวแปลงหน่วย'
};

export const summarizeUnitUsage = (counts = {}) => Object.entries(usageLabels)
    .map(([key, label]) => ({ key, label, count: Number(counts?.[key]) || 0 }))
    .filter(({ count }) => count > 0);

export const getUnitUsageTotal = (counts) => summarizeUnitUsage(counts)
    .reduce((total, { count }) => total + count, 0);

export const buildUnitDeleteBlockedMessage = (unitName, counts) => {
    const usage = summarizeUnitUsage(counts);
    if (!usage.length) return null;
    return `ไม่สามารถลบหน่วยนับ "${unitName}" เพราะใช้อยู่ใน${usage.map(({ label, count }) => `${label} ${count} รายการ`).join(' · ')}`;
};

export const findUnitNameConflict = (units, name, excludeId) => {
    const target = cleanText(name).toLowerCase();
    return (units || []).find((unit) => (
        (excludeId == null || String(unit.id) !== String(excludeId))
        && cleanText(unit.name).toLowerCase() === target
    )) || null;
};

export const buildUnitNameConflictMessage = (unit) => Number(unit.is_active) === 0
    ? `มีหน่วยนับชื่อ "${unit.name}" ที่ถูกลบแล้ว กรุณากด "กู้คืน" เพื่อใช้หน่วยเดิม`
    : `มีหน่วยนับชื่อ "${unit.name}" อยู่แล้ว กรุณาใช้ชื่ออื่น`;
