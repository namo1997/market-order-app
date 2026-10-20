import pool from '../config/database.js';

// หนึ่งคำสั่ง GROUP BY ต่อตาราง ไม่เพิ่มจำนวน query ตามจำนวนหน่วย
const usageQueries = [
    `SELECT unit_id, SUM(is_active = 1) AS products_active,
        SUM(COALESCE(is_active, 0) <> 1) AS products_inactive
     FROM products WHERE unit_id IS NOT NULL GROUP BY unit_id`,
    `SELECT purchase_unit_id AS unit_id, COUNT(*) AS purchase_unit_links
     FROM product_supplier_master_links WHERE purchase_unit_id IS NOT NULL GROUP BY purchase_unit_id`,
    `SELECT check_input_unit_id AS unit_id, COUNT(*) AS stock_templates
     FROM stock_templates WHERE check_input_unit_id IS NOT NULL GROUP BY check_input_unit_id`,
    `SELECT unit_id, COUNT(*) AS menu_recipe_items
     FROM menu_recipe_items WHERE unit_id IS NOT NULL GROUP BY unit_id`,
    `SELECT input_unit_id AS unit_id, COUNT(*) AS production_ingredients
     FROM production_transform_config_required_ingredients WHERE input_unit_id IS NOT NULL GROUP BY input_unit_id`,
    `SELECT usage_unit_id AS unit_id, COUNT(*) AS usage_units
     FROM product_usage_units GROUP BY usage_unit_id`,
    // คู่ที่ต้นทางและปลายทางเหมือนกันนับเป็นหนึ่งรายการ
    `SELECT u.id AS unit_id, COUNT(*) AS unit_conversions
     FROM unit_conversions c JOIN units u ON u.id = c.from_unit_id OR u.id = c.to_unit_id
     GROUP BY u.id`,
    // ตารางของระบบรับสินค้า (ไม่มี FK) ลบหน่วยแล้วจะเหลือ unit_id ค้าง; ถ้ายังไม่ได้สร้างตาราง ตัวกัน
    // ข้ามด้วย ER_NO_SUCH_TABLE ด้านล่าง
    `SELECT unit_id, COUNT(*) AS receiving_document_lines
     FROM receiving_document_lines WHERE unit_id IS NOT NULL GROUP BY unit_id`,
    `SELECT unit_id, COUNT(*) AS receiving_aliases
     FROM supplier_product_aliases WHERE unit_id IS NOT NULL GROUP BY unit_id`,
    `SELECT unit_id, COUNT(*) AS receiving_alias_events
     FROM supplier_product_alias_events WHERE unit_id IS NOT NULL GROUP BY unit_id`
];

export const emptyUnitUsage = () => ({
    products_active: 0, products_inactive: 0, purchase_unit_links: 0,
    stock_templates: 0, menu_recipe_items: 0, production_ingredients: 0, usage_units: 0, unit_conversions: 0,
    receiving_document_lines: 0, receiving_aliases: 0, receiving_alias_events: 0
});

export const loadUnitUsage = async () => {
    const groups = await Promise.all(usageQueries.map(async (sql) => {
        try {
            const [rows] = await pool.query(sql);
            return rows;
        } catch (error) {
            // ตาราง/คอลัมน์ lazy (เช่น purchase_unit_id) อาจยังไม่ถูก ensure จึงยังไม่มีอ้างอิง
            if (error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146
                || error?.code === 'ER_BAD_FIELD_ERROR' || error?.errno === 1054) return [];
            throw error;
        }
    }));
    const usage = new Map();
    for (const rows of groups) {
        for (const { unit_id, ...counts } of rows) {
            const key = String(unit_id);
            const entry = usage.get(key) || emptyUnitUsage();
            for (const [name, count] of Object.entries(counts)) entry[name] = Number(count) || 0;
            usage.set(key, entry);
        }
    }
    return usage;
};
