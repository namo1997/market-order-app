// Additive receiving-only schema. Production requires an explicit approved migration.
export const ISSUE_DDL = [
  `CREATE TABLE IF NOT EXISTS receiving_issue_scans (
    document_id INT PRIMARY KEY, scanned_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_issues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_uuid VARCHAR(100) NOT NULL,
    auto_key VARCHAR(120) NULL,
    type ENUM('shortage','damaged','wrong_item','return','over') NOT NULL,
    document_id INT NOT NULL,
    line_id INT NULL,
    branch_id INT NOT NULL,
    department_id INT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity DECIMAL(12,2) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    status ENUM('open','waiting_supplier','resolved','cancelled') NOT NULL DEFAULT 'open',
    resolution ENUM('redelivered','new_bill','credit_note','returned','written_off') NULL,
    resolution_amount DECIMAL(12,2) NULL,
    resolution_ref VARCHAR(255) NULL,
    note VARCHAR(1000) NOT NULL DEFAULT '',
    owner_user_id INT NULL,
    due_at DATETIME(3) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    closed_at DATETIME(3) NULL,
    UNIQUE KEY uq_issue_client (client_uuid),
    UNIQUE KEY uq_issue_auto (auto_key),
    INDEX idx_issue_due (status,due_at,id),
    INDEX idx_issue_branch (branch_id,status,id),
    INDEX idx_issue_document (document_id,line_id),
    INDEX idx_issue_owner (owner_user_id,status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_issue_evidence (
    id INT AUTO_INCREMENT PRIMARY KEY,
    issue_id INT NOT NULL,
    client_uuid VARCHAR(100) NOT NULL,
    image_data MEDIUMBLOB NOT NULL,
    mime_type VARCHAR(40) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    signature_data MEDIUMBLOB NULL,
    collector_name VARCHAR(255) NULL,
    note VARCHAR(1000) NOT NULL DEFAULT '',
    created_by INT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_issue_evidence_client (issue_id,client_uuid),
    INDEX idx_issue_evidence (issue_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_issue_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    issue_id INT NOT NULL,
    action VARCHAR(40) NOT NULL,
    actor_user_id INT NULL,
    details_json TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX idx_issue_history (issue_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_issue_reminders (
    issue_id INT NOT NULL,
    due_at DATETIME(3) NOT NULL,
    followup_id INT NOT NULL,
    PRIMARY KEY (issue_id,due_at),
    INDEX idx_issue_reminder_followup (followup_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
let pending;
export async function ensureIssueTables(db, { force = false, env = globalThis.process?.env || {} } = {}) {
  if (!force && (env.AUTO_ENSURE_RECEIVING_TABLES === 'false' ||
    (env.NODE_ENV === 'production' && env.AUTO_ENSURE_RECEIVING_TABLES !== 'true'))) return;
  if (pending?.db === db && !force) return pending.promise;
  const promise = (async () => { for (const ddl of ISSUE_DDL) await db.query(ddl); })();
  pending = { db, promise };
  try { await promise; } catch (error) { pending = null; throw error; }
}
