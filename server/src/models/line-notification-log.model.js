import pool from '../config/database.js';

const ensureColumn = async (columnName, definition) => {
  const [rows] = await pool.query(
    'SHOW COLUMNS FROM line_notification_logs LIKE ?',
    [columnName]
  );
  if (rows.length === 0) {
    await pool.query(
      `ALTER TABLE line_notification_logs ADD COLUMN ${columnName} ${definition}`
    );
  }
};

const ensureIndex = async (indexName, definition) => {
  const [rows] = await pool.query(
    'SHOW INDEX FROM line_notification_logs WHERE Key_name = ?',
    [indexName]
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE line_notification_logs ADD ${definition}`);
  }
};

const ensureTable = async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS line_notification_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      order_id INT NULL,
      group_id VARCHAR(64),
      group_name VARCHAR(255),
      access_token_hash VARCHAR(128),
      status ENUM('success', 'failed', 'skipped') NOT NULL,
      message TEXT,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_event_type (event_type),
      INDEX idx_order_id (order_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      INDEX idx_access_token_hash (access_token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('access_token_hash', 'VARCHAR(128) NULL');
  await ensureIndex('idx_access_token_hash', 'INDEX idx_access_token_hash (access_token_hash)');
};

export const logLineNotification = async ({
  eventType,
  orderId,
  groupId,
  groupName,
  accessTokenHash,
  status,
  message,
  errorMessage
}) => {
  await ensureTable();
  await pool.query(
    `INSERT INTO line_notification_logs
      (event_type, order_id, group_id, group_name, access_token_hash, status, message, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventType,
      orderId || null,
      groupId || null,
      groupName || null,
      accessTokenHash || null,
      status,
      message || null,
      errorMessage || null
    ]
  );
};

export const countTokenUsageThisMonth = async (accessTokenHash, date = new Date()) => {
  if (!accessTokenHash) return 0;
  await ensureTable();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM line_notification_logs
     WHERE status = 'success'
       AND access_token_hash = ?
       AND YEAR(created_at) = ?
       AND MONTH(created_at) = ?`,
    [accessTokenHash, year, month]
  );
  return Number(rows?.[0]?.count || 0);
};
