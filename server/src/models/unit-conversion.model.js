import pool from '../config/database.js';

const ensureUnitConversionTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS unit_conversions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      from_unit_id INT NOT NULL,
      to_unit_id INT NOT NULL,
      multiplier DECIMAL(16,6) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_conversion (from_unit_id, to_unit_id),
      FOREIGN KEY (from_unit_id) REFERENCES units(id),
      FOREIGN KEY (to_unit_id) REFERENCES units(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getConversions = async () => {
  await ensureUnitConversionTable();
  const [rows] = await pool.query(
    `SELECT uc.id, uc.from_unit_id, uc.to_unit_id, uc.multiplier,
            uf.name as from_unit_name, uf.abbreviation as from_unit_abbr,
            ut.name as to_unit_name, ut.abbreviation as to_unit_abbr
     FROM unit_conversions uc
     LEFT JOIN units uf ON uc.from_unit_id = uf.id
     LEFT JOIN units ut ON uc.to_unit_id = ut.id
     ORDER BY uf.name, ut.name`
  );
  return rows;
};

export const getConversionsRaw = async () => {
  await ensureUnitConversionTable();
  const [rows] = await pool.query(
    `SELECT from_unit_id, to_unit_id, multiplier
     FROM unit_conversions`
  );
  return rows;
};

export const findConversionByPair = async (fromUnitId, toUnitId) => {
  await ensureUnitConversionTable();
  const [rows] = await pool.query(
    'SELECT id, multiplier FROM unit_conversions WHERE from_unit_id = ? AND to_unit_id = ? LIMIT 1',
    [fromUnitId, toUnitId]
  );
  return rows[0] || null;
};

export const countActiveUnits = async (unitIds) => {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM units WHERE is_active = true AND id IN (?)',
    [unitIds]
  );
  return Number(rows?.[0]?.total || 0);
};

// Upserts (used internally when product purchase units are configured).
export const createConversion = async (fromUnitId, toUnitId, multiplier) => {
  await ensureUnitConversionTable();
  const [result] = await pool.query(
    `INSERT INTO unit_conversions (from_unit_id, to_unit_id, multiplier)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier)`,
    [fromUnitId, toUnitId, multiplier]
  );
  return { id: result.insertId, from_unit_id: fromUnitId, to_unit_id: toUnitId, multiplier };
};

export const updateConversion = async (id, multiplier) => {
  await ensureUnitConversionTable();
  const [result] = await pool.query(
    'UPDATE unit_conversions SET multiplier = ? WHERE id = ?',
    [multiplier, id]
  );
  if (result.affectedRows === 0) return null;
  return { id, multiplier };
};

export const deleteConversion = async (id) => {
  await ensureUnitConversionTable();
  const [result] = await pool.query(
    'DELETE FROM unit_conversions WHERE id = ?',
    [id]
  );
  if (result.affectedRows === 0) return null;
  return { id };
};
