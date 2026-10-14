import pool from '../config/database.js';

let ensured = false;

const ensureTable = async () => {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatbot_memories (
      source_key VARCHAR(180) NOT NULL PRIMARY KEY,
      memory_json JSON NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chatbot_memories_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
};

export const getChatbotMemory = async (sourceKey) => {
  const key = String(sourceKey || '').trim();
  if (!key) return null;
  await ensureTable();
  const [rows] = await pool.query(
    `SELECT memory_json, updated_at
     FROM chatbot_memories
     WHERE source_key = ?
     LIMIT 1`,
    [key]
  );
  const row = rows?.[0];
  if (!row) return null;

  const memory = typeof row.memory_json === 'string'
    ? JSON.parse(row.memory_json)
    : row.memory_json;
  return {
    ...(memory || {}),
    persistedUpdatedAt: row.updated_at
  };
};

export const upsertChatbotMemory = async (sourceKey, memory) => {
  const key = String(sourceKey || '').trim();
  if (!key) return;
  await ensureTable();
  await pool.query(
    `INSERT INTO chatbot_memories (source_key, memory_json)
     VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       memory_json = VALUES(memory_json),
       updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(memory || {})]
  );
};
