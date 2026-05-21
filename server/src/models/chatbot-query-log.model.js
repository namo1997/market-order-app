import pool from '../config/database.js';

let ensured = false;

const ensureTable = async () => {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatbot_query_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      channel VARCHAR(30) NOT NULL,
      source_type VARCHAR(30) NULL,
      source_id VARCHAR(120) NULL,
      question TEXT NOT NULL,
      intent VARCHAR(80) NULL,
      answer MEDIUMTEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'success',
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chatbot_logs_created_at (created_at),
      INDEX idx_chatbot_logs_channel_source (channel, source_type, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
};

export const logChatbotQuery = async ({
  channel = 'line',
  sourceType = null,
  sourceId = null,
  question,
  intent = null,
  answer = null,
  status = 'success',
  errorMessage = null
}) => {
  await ensureTable();
  await pool.query(
    `INSERT INTO chatbot_query_logs
      (channel, source_type, source_id, question, intent, answer, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      channel,
      sourceType,
      sourceId,
      String(question || ''),
      intent,
      answer,
      status,
      errorMessage
    ]
  );
};
