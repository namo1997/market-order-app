import pool from '../config/database.js';
import { convertUsageToBase } from '../utils/usage-unit-rules.js';

let usageTableReady = false;

// หน่วยใช้ต่อสินค้า (หนึ่งสินค้าหนึ่งหน่วยใช้) ใช้ตอนกรอกวัตถุดิบในหน้าแปรรูป
export const ensureProductUsageUnitTable = async () => {
  if (usageTableReady) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS product_usage_units (
      product_id INT PRIMARY KEY,
      usage_unit_id INT NOT NULL,
      usage_per_base DECIMAL(16,6) NOT NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_product_usage_units_product FOREIGN KEY (product_id) REFERENCES products(id),
      CONSTRAINT fk_product_usage_units_unit FOREIGN KEY (usage_unit_id) REFERENCES units(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  usageTableReady = true;
};

// db = pool หรือ connection; value = null คือเลิกใช้หน่วยใช้
export const saveProductUsageUnit = async (db, productId, value, updatedBy = null) => {
  if (!value) {
    await db.query('DELETE FROM product_usage_units WHERE product_id = ?', [productId]);
    return;
  }
  const [unitRows] = await db.query('SELECT id FROM units WHERE id = ? AND is_active = true', [value.usage_unit_id]);
  if (!unitRows[0]) {
    const error = new Error('ไม่พบหน่วยใช้ที่เลือก');
    error.statusCode = 400;
    throw error;
  }
  await db.query(
    `INSERT INTO product_usage_units (product_id, usage_unit_id, usage_per_base, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE usage_unit_id = VALUES(usage_unit_id),
       usage_per_base = VALUES(usage_per_base), updated_by = VALUES(updated_by)`,
    [productId, value.usage_unit_id, value.usage_per_base, updatedBy]
  );
};

// แปลงจำนวนวัตถุดิบที่กรอกเป็นหน่วยใช้ ให้เป็นหน่วยฐานก่อนตัดสต๊อก
// ingredients = [{ product_id, quantity, input_unit_id? }] → [{ product_id, quantity, input? }]
export const convertIngredientsToBase = async (ingredients = []) => {
  const rows = Array.isArray(ingredients) ? ingredients : [];
  if (!rows.some((row) => row?.input_unit_id)) return rows;
  await ensureProductUsageUnitTable();
  const ids = [...new Set(rows.map((row) => Number(row?.product_id)).filter((id) => id > 0))];
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.unit_id AS base_unit_id, puu.usage_unit_id, puu.usage_per_base
     FROM products p
     LEFT JOIN product_usage_units puu ON puu.product_id = p.id
     WHERE p.id IN (?)`,
    [ids.length ? ids : [0]]
  );
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return rows.map((row) => {
    const product = byId.get(Number(row?.product_id));
    const result = convertUsageToBase({
      quantity: row?.quantity,
      inputUnitId: row?.input_unit_id,
      product,
      productName: product?.name || `#${row?.product_id}`
    });
    if (result.error) {
      const error = new Error(result.error);
      error.statusCode = 400;
      throw error;
    }
    return { product_id: Number(row.product_id), quantity: result.quantity, input: result.input };
  });
};
