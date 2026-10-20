import { parseCsv } from './csv.js';

export const isUnitInactive = (unit) => Number(unit.is_active) === 0;
export const normalizeUnitText = (value) => String(value ?? '').trim().replace(/\s+/gu, ' ');
export const unitNameKey = (name) => normalizeUnitText(name).toLowerCase();
export const unitErrorMessage = (error, fallback) => error?.response?.data?.message
    || (error?.isAxiosError ? fallback : error?.message) || fallback;

const usageLabels = {
    products_active: 'สินค้า', products_inactive: 'สินค้าปิดใช้',
    purchase_unit_links: 'หน่วยซื้อ', stock_templates: 'แบบเช็คสต๊อก',
    menu_recipe_items: 'สูตร', production_ingredients: 'วัตถุดิบแปรรูป', unit_conversions: 'ตัวแปลงหน่วย'
};
export const unitUsageItems = (unit) => Object.entries(usageLabels)
    .map(([key, label]) => ({ key, label, count: Number(unit.usage?.[key]) || 0 }))
    .filter(({ count }) => count > 0);
export const unitDeleteReason = (unit) => {
    const items = unitUsageItems(unit);
    return items.length ? `ลบไม่ได้: ${items.map(({ label, count }) => `${label} ${count} รายการ`).join(' · ')}` : '';
};

// เก็บเลขบรรทัดจริง แม้มีบรรทัดว่างหรือข้อความหลายบรรทัดในช่องที่ครอบด้วยเครื่องหมายคำพูด
export const parseUnitImportCsv = (text) => {
    const source = text.replace(/^\uFEFF/, '');
    const records = [];
    let start = 0;
    let line = 1;
    let startLine = 1;
    let inQuotes = false;
    for (let i = 0; i < source.length; i += 1) {
        if (source[i] === '"') {
            if (inQuotes && source[i + 1] === '"') i += 1;
            else inQuotes = !inQuotes;
        } else if (source[i] === '\n') {
            if (!inQuotes) {
                records.push({ text: source.slice(start, i), line: startLine });
                start = i + 1;
                startLine = line + 1;
            }
            line += 1;
        }
    }
    if (inQuotes) throw new Error(`แถว ${startLine}: เครื่องหมายคำพูดใน CSV ไม่ครบคู่`);
    if (start < source.length) records.push({ text: source.slice(start), line: startLine });
    const header = records.shift()?.text || '';
    const { headers } = parseCsv(header);
    if (!headers.includes('name') || !headers.includes('abbreviation')) {
        throw new Error('ไฟล์ CSV ต้องมีหัวคอลัมน์ name และ abbreviation');
    }
    return records.flatMap((record) => {
        const row = parseCsv(`${header}\n${record.text}`).rows[0];
        return row ? [{ row, line: record.line }] : [];
    });
};
