import pool from '../config/database.js';
import { summarizeSalesSyncResult } from '../services/sales-sync-status.service.js';

let tableReady;

export const ensureTable = () => {
    if (!tableReady) {
        tableReady = pool.query(`CREATE TABLE IF NOT EXISTS sales_sync_runs (
            run_id CHAR(36) PRIMARY KEY,
            target_date DATE NOT NULL,
            source VARCHAR(32) NOT NULL,
            summary_json TEXT NOT NULL,
            result_json LONGTEXT NULL,
            completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY sales_sync_runs_target_date (target_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
            .catch((error) => {
                tableReady = null;
                throw error;
            });
    }
    return tableReady;
};

export const findCompletion = async (targetDate) => {
    const [rows] = await pool.query(
        'SELECT run_id, summary_json FROM sales_sync_runs WHERE target_date = ?', [targetDate]
    );
    return rows.length ? { run_id: rows[0].run_id, summary: JSON.parse(rows[0].summary_json) } : null;
};

// Called on the inventory transaction connection BEFORE COMMIT. A failed marker rolls
// back the stock changes too; the database can never commit stock without this marker.
export const recordCompletion = async (connection, { runId, targetDate, source, result }) => {
    await connection.query(
        `INSERT INTO sales_sync_runs (run_id, target_date, source, summary_json)
         VALUES (?, ?, ?, ?)`,
        [runId, targetDate, String(source).slice(0, 32), JSON.stringify(summarizeSalesSyncResult(result))]
    );
};

export const archiveResult = async (runId, result) => {
    await pool.query('UPDATE sales_sync_runs SET result_json = ? WHERE run_id = ?',
        [JSON.stringify(result), runId]);
};
