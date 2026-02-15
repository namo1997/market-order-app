import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DB_RETRY_ATTEMPTS = 3;
const DEFAULT_DB_RETRY_DELAY_MS = 500;

const RETRYABLE_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_QUERY_TIMEOUT',
  'ER_SERVER_SHUTDOWN'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAttempts = () => Math.max(1, Number(process.env.DB_RETRY_ATTEMPTS || DEFAULT_DB_RETRY_ATTEMPTS));
const getRetryDelayMs = () => Math.max(100, Number(process.env.DB_RETRY_DELAY_MS || DEFAULT_DB_RETRY_DELAY_MS));

const isRetryableDatabaseError = (error) => {
  if (!error) return false;
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) return true;

  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('too many connections') ||
    message.includes('server has gone away') ||
    message.includes('lost connection') ||
    message.includes('connection refused') ||
    message.includes('connection reset')
  );
};

const runWithRetry = async (operation, label) => {
  const attempts = getRetryAttempts();
  const baseDelay = getRetryDelayMs();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && isRetryableDatabaseError(error);
      if (!canRetry) break;

      const waitMs = baseDelay * attempt;
      console.warn(`[DB retry] ${label} failed (${attempt}/${attempts}): ${error.code || error.message}`);
      await sleep(waitMs);
    }
  }

  throw lastError;
};

// สร้าง raw connection pool
const rawPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 20),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});

// Wrapper ให้เรียกแบบ pool.query เดิมได้ แต่มี retry อัตโนมัติในกรณีชั่วคราว
const pool = {
  query: (...args) => runWithRetry(() => rawPool.query(...args), 'query'),
  execute: (...args) => runWithRetry(() => rawPool.execute(...args), 'execute'),
  getConnection: (...args) => runWithRetry(() => rawPool.getConnection(...args), 'getConnection'),
  end: (...args) => rawPool.end(...args)
};

// ทดสอบการเชื่อมต่อ
rawPool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

export default pool;
