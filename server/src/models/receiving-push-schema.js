// Additive; production requires an explicit, owner-run migration.
export const PUSH_DDL = [
  `CREATE TABLE IF NOT EXISTS receiving_push_devices (
    token_hash CHAR(64) PRIMARY KEY,
    token VARCHAR(4096) NOT NULL,
    user_id INT NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    INDEX idx_push_user (user_id,updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS receiving_push_deliveries (
    followup_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    state ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    next_at DATETIME(3) NOT NULL,
    PRIMARY KEY (followup_id,token_hash),
    INDEX idx_push_retry (state,next_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
export async function ensurePushTables(db, env = process.env) {
  if (env.AUTO_ENSURE_RECEIVING_TABLES === 'false' ||
      (env.NODE_ENV === 'production' && env.AUTO_ENSURE_RECEIVING_TABLES !== 'true')) return;
  for (const sql of PUSH_DDL) await db.query(sql);
}
