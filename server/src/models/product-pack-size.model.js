// "บรรจุแพ็คละ" ต่อสินค้า เช่น ไก่บ้านหมักย่าง 5 ตัว/ถุง → สติกเกอร์ 1 ดวงต่อถุง, สแกน 1 ดวงนับ 5 ตัว
// ตารางใหม่แยกจากการตั้งค่าแปรรูปเดิม (ไม่แตะ schema เดิม)
const defaultDb = async () => (await import('../config/database.js')).default;

let tableEnsured = null;
export const ensureProductPackSizeTable = async (db) => {
  if (!tableEnsured) {
    tableEnsured = db.query(`
      CREATE TABLE IF NOT EXISTS product_pack_sizes (
        product_id INT PRIMARY KEY,
        pack_size DECIMAL(12,3) NOT NULL,
        pack_unit_label VARCHAR(30) NOT NULL DEFAULT 'ถุง',
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).catch((error) => {
      tableEnsured = null;
      throw error;
    });
  }
  return tableEnsured;
};

const toRow = (row) => ({
  product_id: Number(row.product_id),
  pack_size: Number(row.pack_size),
  pack_unit_label: row.pack_unit_label || 'ถุง'
});

export const listPackSizes = async ({ db } = {}) => {
  db = db || await defaultDb();
  await ensureProductPackSizeTable(db);
  const [rows] = await db.query('SELECT product_id, pack_size, pack_unit_label FROM product_pack_sizes ORDER BY product_id');
  return (rows || []).map(toRow);
};

export const getPackSize = async (productId, { db } = {}) => {
  db = db || await defaultDb();
  await ensureProductPackSizeTable(db);
  const [rows] = await db.query(
    'SELECT product_id, pack_size, pack_unit_label FROM product_pack_sizes WHERE product_id = ? LIMIT 1',
    [Number(productId)]
  );
  return rows?.[0] ? toRow(rows[0]) : null;
};

export const getPackSizeMap = async (productIds = [], { db } = {}) => {
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  db = db || await defaultDb();
  await ensureProductPackSizeTable(db);
  const [rows] = await db.query(
    `SELECT product_id, pack_size, pack_unit_label FROM product_pack_sizes WHERE product_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return new Map((rows || []).map((row) => [Number(row.product_id), toRow(row)]));
};

// pack_size ว่าง/0 = เลิกใช้แพ็ค (กลับไปดวงละ 1 หน่วย)
export const savePackSize = async ({ productId, packSize, packUnitLabel, userId, db }) => {
  db = db || await defaultDb();
  await ensureProductPackSizeTable(db);
  const id = Number(productId);
  const size = Number(packSize);
  if (!Number.isInteger(id) || id <= 0) return { status: 'invalid' };
  if (!packSize || !Number.isFinite(size) || size <= 0) {
    await db.query('DELETE FROM product_pack_sizes WHERE product_id = ?', [id]);
    return { status: 'ok', pack: null };
  }
  if (size > 10000) return { status: 'invalid' };
  const label = String(packUnitLabel || 'ถุง').trim().slice(0, 30) || 'ถุง';
  await db.query(
    `INSERT INTO product_pack_sizes (product_id, pack_size, pack_unit_label, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size), pack_unit_label = VALUES(pack_unit_label), updated_by = VALUES(updated_by)`,
    [id, size, label, userId || null]
  );
  return { status: 'ok', pack: { product_id: id, pack_size: size, pack_unit_label: label } };
};
