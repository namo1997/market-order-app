import pool from '../src/config/database.js';
import { ensureSettingsTable } from '../src/models/settings.model.js';
import { ensureTable } from '../src/models/sales-sync-run.model.js';

try {
    await ensureSettingsTable();
    // Upgrade legacy small columns once, without narrowing an existing MEDIUMTEXT/LONGTEXT.
    const [columns] = await pool.query(
        `SELECT CHARACTER_OCTET_LENGTH AS max_bytes
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings'
           AND COLUMN_NAME = 'setting_value'`
    );
    if (!columns.length) throw new Error('system_settings.setting_value is missing');
    if (Number(columns[0].max_bytes) < 65535) {
        await pool.query('ALTER TABLE system_settings MODIFY setting_value TEXT NOT NULL');
    }
    await ensureTable();
    console.log('Sales sync storage migration complete');
} catch (error) {
    console.error('Sales sync storage migration failed:', error.code || 'MIGRATION_FAILED');
    process.exitCode = 1;
} finally {
    await pool.end();
}
