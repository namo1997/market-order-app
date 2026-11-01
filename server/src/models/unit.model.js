import pool from '../config/database.js';
import { httpError, optionalText, requireText, toDuplicateError } from '../utils/master-data-validation.js';

const UNIT_DUPLICATE_FIELDS = { name: 'ชื่อหน่วย' };

const normalizeUnitInput = (data = {}) => ({
    name: requireText(data.name, 'ชื่อหน่วย', 50),
    abbreviation: optionalText(data.abbreviation, 'ตัวย่อหน่วย', 10)
});

export const getAllUnits = async () => {
    const [rows] = await pool.query(
        'SELECT * FROM units WHERE is_active = true ORDER BY name'
    );
    return rows;
};

export const getUnitById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM units WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createUnit = async (data) => {
    const { name, abbreviation } = normalizeUnitInput(data);
    const [existing] = await pool.query(
        'SELECT id, is_active FROM units WHERE name = ? LIMIT 1',
        [name]
    );
    if (existing[0] && !Number(existing[0].is_active)) {
        // Re-adding a previously deleted unit name: reactivate it instead of failing on UNIQUE(name).
        await pool.query(
            'UPDATE units SET abbreviation = ?, is_active = true WHERE id = ?',
            [abbreviation, existing[0].id]
        );
        return { id: existing[0].id, name, abbreviation };
    }
    let result;
    try {
        [result] = await pool.query(
            'INSERT INTO units (name, abbreviation, is_active) VALUES (?, ?, true)',
            [name, abbreviation]
        );
    } catch (error) {
        throw toDuplicateError(error, UNIT_DUPLICATE_FIELDS);
    }
    return { id: result.insertId, name, abbreviation };
};

export const updateUnit = async (id, data) => {
    const { name, abbreviation } = normalizeUnitInput(data);
    let result;
    try {
        [result] = await pool.query(
            'UPDATE units SET name = ?, abbreviation = ? WHERE id = ?',
            [name, abbreviation, id]
        );
    } catch (error) {
        throw toDuplicateError(error, UNIT_DUPLICATE_FIELDS);
    }
    if (result.affectedRows === 0) {
        throw httpError('ไม่พบหน่วย', 404);
    }
    return { id, name, abbreviation };
};

export const getUnitUsage = async (id) => {
    const [[row]] = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM products WHERE unit_id = ? AND is_active = true) AS products,
            (SELECT COUNT(*)
               FROM product_supplier_master_links psml
               JOIN products p ON p.id = psml.product_id AND p.is_active = true
              WHERE psml.purchase_unit_id = ?) AS purchase_links,
            (SELECT COUNT(*)
               FROM stock_templates st
               JOIN products p ON p.id = st.product_id AND p.is_active = true
              WHERE st.check_input_unit_id = ?) AS stock_templates`,
        [id, id, id]
    );
    return {
        products: Number(row?.products || 0),
        purchaseLinks: Number(row?.purchase_links || 0),
        stockTemplates: Number(row?.stock_templates || 0)
    };
};

export const deleteUnit = async (id) => {
    const [existing] = await pool.query(
        'SELECT id FROM units WHERE id = ? AND is_active = true',
        [id]
    );
    if (existing.length === 0) {
        throw httpError('ไม่พบหน่วย', 404);
    }
    const usage = await getUnitUsage(id);
    const parts = [];
    if (usage.products > 0) parts.push(`สินค้าที่ใช้เป็นหน่วยหลัก ${usage.products} รายการ`);
    if (usage.purchaseLinks > 0) parts.push(`หน่วยซื้อของสินค้า ${usage.purchaseLinks} รายการ`);
    if (usage.stockTemplates > 0) parts.push(`หน่วยนับสต๊อก ${usage.stockTemplates} รายการ`);
    if (parts.length > 0) {
        throw httpError(`ลบหน่วยไม่ได้ เพราะยังถูกใช้งานอยู่: ${parts.join(', ')} กรุณาเปลี่ยนหน่วยของสินค้าก่อน`);
    }
    await pool.query(
        'UPDATE units SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};
