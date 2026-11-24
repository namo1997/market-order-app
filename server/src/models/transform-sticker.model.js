import {
  decodeTransformStickerCode,
  getQuantityPerSticker,
  getStickerCopies
} from '../utils/transform-sticker-code.js';
import { getPackSize } from './product-pack-size.model.js';

// ค้นสติกเกอร์แปรรูปจากรหัสที่สแกน: เฉพาะแถวรับเข้าจากการแปรรูป (reference_type=production_transform, quantity>0)
// โหลด pool เมื่อใช้จริง (import ตอนโหลดไฟล์จะเปิด connection ค้างและทำให้เทสต์ไม่จบ)
const defaultDb = async () => (await import('../config/database.js')).default;

export const findTransformSticker = async (code, { db } = {}) => {
  const decoded = decodeTransformStickerCode(code);
  if (!decoded) return { status: 'invalid' };
  db = db || await defaultDb();

  const [rows] = await db.query(
    `SELECT it.id, it.reference_id, it.product_id, it.department_id, it.quantity, it.created_at,
            p.name AS product_name, p.code AS product_code,
            u.name AS unit_name, u.abbreviation AS unit_abbr,
            d.name AS department_name
       FROM inventory_transactions it
       JOIN products p ON p.id = it.product_id
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN departments d ON d.id = it.department_id
      WHERE it.id = ?
        AND it.reference_type = 'production_transform'
        AND it.quantity > 0
      LIMIT 1`,
    [decoded.transactionId]
  );
  const row = rows?.[0];
  if (!row) return { status: 'not_found', ...decoded };

  const quantity = Number(row.quantity);
  // แพ็คตามค่าที่ตั้งตอนนี้ (ถ้าเปลี่ยนค่าหลังพิมพ์ สติกเกอร์เก่าจะนับตามค่าใหม่)
  const pack = await getPackSize(row.product_id, { db });
  const packSize = pack?.pack_size || 0;
  const copies = getStickerCopies(quantity, packSize);
  return {
    status: 'ok',
    sticker: {
      code: decoded.code,
      transaction_id: Number(row.id),
      sequence: decoded.sequence,
      copies,
      sequence_valid: decoded.sequence <= copies,
      quantity_per_sticker: getQuantityPerSticker(quantity, packSize, decoded.sequence),
      pack_size: packSize || null,
      pack_unit_label: pack?.pack_unit_label || null,
      batch_quantity: quantity,
      reference_id: row.reference_id,
      produced_at: row.created_at,
      product_id: Number(row.product_id),
      product_name: row.product_name,
      product_code: row.product_code,
      unit_name: row.unit_name,
      unit_abbr: row.unit_abbr,
      department_id: Number(row.department_id),
      department_name: row.department_name
    }
  };
};
