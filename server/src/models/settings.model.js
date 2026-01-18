import pool from '../config/database.js';

const ensureSettingsTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value VARCHAR(100) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
};

export const getSetting = async (key, defaultValue = '') => {
  await ensureSettingsTable();
  const [rows] = await pool.query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );

  if (rows.length === 0) {
    await pool.query(
      'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, String(defaultValue)]
    );
    return String(defaultValue);
  }

  return rows[0].setting_value;
};

export const setSetting = async (key, value) => {
  await ensureSettingsTable();
  const stringValue = String(value);
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, stringValue]
  );
  return { setting_key: key, setting_value: stringValue };
};
