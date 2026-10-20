// Additive only. Explicit migration is required in production.
export const QUEUE_DDL = [
  `CREATE TABLE IF NOT EXISTS receiving_supplier_leads (
    supplier_key VARCHAR(120) PRIMARY KEY,
    lead_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    updated_by_user_id INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_followup_locks (
    scope_key VARCHAR(180) PRIMARY KEY
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_followups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_key VARCHAR(120) NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    branch_id INT NOT NULL,
    department_id INT NOT NULL,
    pending_items_json LONGTEXT NOT NULL,
    actor_user_id INT NULL,
    actor_name VARCHAR(255) NOT NULL DEFAULT '',
    note VARCHAR(300) NOT NULL DEFAULT '',
    source ENUM('manual','overdue') NOT NULL,
    auto_key CHAR(64) NULL,
    status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    updated_by_user_id INT NULL,
    UNIQUE KEY uq_receiving_followup_auto (auto_key),
    INDEX idx_followup_dedupe (branch_id,department_id,supplier_key,created_at),
    INDEX idx_followup_status (status,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
let pending;
export async function ensureQueueTables(db, { force = false, env = globalThis.process?.env || {} } = {}) {
  if (!force && (env.AUTO_ENSURE_RECEIVING_TABLES === 'false' ||
    (env.NODE_ENV === 'production' && env.AUTO_ENSURE_RECEIVING_TABLES !== 'true'))) return;
  if (pending?.db === db && !force) return pending.promise;
  const promise = (async () => { for (const sql of QUEUE_DDL) await db.query(sql); })();
  pending = { db, promise };
  try { await promise; } catch (error) { pending = null; throw error; }
}
