import pool from '../config/database.js';

let ensureSettingsPromise;
const ensureSettingsTable = () => {
  if (ensureSettingsPromise) return ensureSettingsPromise;
  ensureSettingsPromise = (async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const [columns] = await pool.query("SHOW COLUMNS FROM system_settings LIKE 'setting_value'");
  // Existing TEXT/MEDIUMTEXT/LONGTEXT columns already accommodate the settings.
  // In particular, never narrow a wider column on an ordinary settings read.
  if (columns[0] && !/^(?:text|mediumtext|longtext)$/i.test(columns[0].Type || '')) {
    await pool.query(
      'ALTER TABLE system_settings MODIFY setting_value TEXT NOT NULL'
    );
  }
  })().catch((error) => {
    ensureSettingsPromise = undefined;
    throw error;
  });
  return ensureSettingsPromise;
};

// Fresh values on every call; only schema initialization is memoized.
export const getSettings = async (defaults = {}) => {
  const keys = Object.keys(defaults);
  if (keys.length === 0) return {};
  await ensureSettingsTable();
  const [rows] = await pool.query(
    'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?)',
    [keys]
  );
  const values = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const missing = keys.filter((key) => !values.has(key));
  if (missing.length > 0) {
    // A concurrent admin write wins over initialization of a missing default.
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ?
       ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)`,
      [missing.map((key) => [key, String(defaults[key])])]
    );
    const [initialized] = await pool.query(
      'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?)', [missing]
    );
    for (const row of initialized) values.set(row.setting_key, row.setting_value);
  }
  return Object.fromEntries(keys.map((key) => [key, values.has(key) ? values.get(key) : String(defaults[key])]));
};

export const getSetting = async (key, defaultValue = '') => (await getSettings({ [key]: defaultValue }))[key];

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
