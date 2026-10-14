import pool from '../config/database.js';

let ensured = false;

const ensureTable = async () => {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS line_group_message_archive (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(120) NOT NULL UNIQUE,
      group_id VARCHAR(120) NOT NULL,
      group_name VARCHAR(255) NOT NULL,
      sender_user_id VARCHAR(120) NULL,
      sender_display_name VARCHAR(255) NULL,
      message_type VARCHAR(30) NOT NULL,
      text_content MEDIUMTEXT NULL,
      event_timestamp DATETIME(3) NOT NULL,
      event_json JSON NULL,
      content_type VARCHAR(120) NULL,
      content_size_bytes BIGINT UNSIGNED NULL,
      content_data LONGBLOB NULL,
      content_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable',
      content_error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_line_archive_group_time (group_id, event_timestamp),
      INDEX idx_line_archive_group_name_time (group_name, event_timestamp),
      INDEX idx_line_archive_sender_time (sender_user_id, event_timestamp),
      INDEX idx_line_archive_message_type (message_type, event_timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
};

export const upsertMessage = async ({
  messageId,
  groupId,
  groupName,
  senderUserId = null,
  senderDisplayName = null,
  messageType,
  textContent = null,
  eventTimestamp,
  eventJson,
  contentStatus = 'not_applicable'
}) => {
  await ensureTable();
  await pool.query(
    `INSERT INTO line_group_message_archive
      (message_id, group_id, group_name, sender_user_id, sender_display_name,
       message_type, text_content, event_timestamp, event_json, content_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       group_name = VALUES(group_name),
       sender_user_id = VALUES(sender_user_id),
       sender_display_name = COALESCE(VALUES(sender_display_name), sender_display_name),
       text_content = VALUES(text_content),
       event_timestamp = VALUES(event_timestamp),
       event_json = VALUES(event_json),
       content_status = IF(content_status = 'stored', content_status, VALUES(content_status))`,
    [
      messageId,
      groupId,
      groupName,
      senderUserId,
      senderDisplayName,
      messageType,
      textContent,
      eventTimestamp,
      eventJson,
      contentStatus
    ]
  );
};

export const storeContent = async ({ messageId, content, contentType, sizeBytes }) => {
  await ensureTable();
  await pool.query(
    `UPDATE line_group_message_archive
     SET content_data = ?,
         content_type = ?,
         content_size_bytes = ?,
         content_status = 'stored',
         content_error = NULL
     WHERE message_id = ?`,
    [content, contentType, sizeBytes, messageId]
  );
};

export const markContentError = async ({ messageId, errorMessage }) => {
  await ensureTable();
  await pool.query(
    `UPDATE line_group_message_archive
     SET content_status = 'error', content_error = ?
     WHERE message_id = ? AND content_status <> 'stored'`,
    [String(errorMessage || 'unknown image capture error'), messageId]
  );
};

