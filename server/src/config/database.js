import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DB_RETRY_ATTEMPTS = 3;
const DEFAULT_DB_RETRY_DELAY_MS = 500;
// ป้องกัน query ค้าง (เช่น รอ table lock) จนกิน connection ใน pool หมดทั้งระบบ
const DEFAULT_DB_QUERY_TIMEOUT_MS = 30000;
// จำนวน request ที่รอ connection ได้สูงสุด เกินนี้ตอบ 503 ทันทีแทนการค้างไม่มีกำหนด
const DEFAULT_DB_QUEUE_LIMIT = 200;
// เวลารอ connection ว่างจาก pool สูงสุด
const DEFAULT_DB_ACQUIRE_TIMEOUT_MS = 15000;

// error ระดับการเชื่อมต่อ ถ้าเกิดตอนขอ connection (คำสั่งยังไม่ถูกส่ง) -> retry ได้ปลอดภัยทุกคำสั่ง
const CONNECT_PHASE_ERROR_CODES = new Set([
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ER_CON_COUNT_ERROR'
]);

// error ที่อาจเกิดระหว่างคำสั่งกำลังทำงาน -> retry ได้เฉพาะคำสั่งอ่าน
// (คำสั่งเขียนอาจสำเร็จไปแล้วฝั่ง DB ถ้า retry จะเกิดข้อมูลซ้ำ)
const MID_QUERY_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_SERVER_SHUTDOWN'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAttempts = () => Math.max(1, Number(process.env.DB_RETRY_ATTEMPTS || DEFAULT_DB_RETRY_ATTEMPTS));
const getRetryDelayMs = () => Math.max(100, Number(process.env.DB_RETRY_DELAY_MS || DEFAULT_DB_RETRY_DELAY_MS));
const readPositiveMs = (raw, fallback) => {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const getQueryTimeoutMs = () => readPositiveMs(process.env.DB_QUERY_TIMEOUT_MS, DEFAULT_DB_QUERY_TIMEOUT_MS);
const getAcquireTimeoutMs = () => readPositiveMs(process.env.DB_ACQUIRE_TIMEOUT_MS, DEFAULT_DB_ACQUIRE_TIMEOUT_MS);

const READ_ONLY_SQL_PATTERN = /^\s*(\/\*[\s\S]*?\*\/\s*)?\(?\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i;

const getSqlText = (args) => {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first.sql === 'string') return first.sql;
  return '';
};

const isReadOnlySql = (sql) => READ_ONLY_SQL_PATTERN.test(sql) && !/\bFOR\s+UPDATE\b/i.test(sql);

// error ที่เกิดระหว่างรอ connection จาก pool (คำสั่งยังไม่ถูกส่งไป DB แน่นอน)
const acquirePhaseErrors = new WeakSet();

const isRetryableDatabaseError = (error, { readOnly = false } = {}) => {
  if (!error) return false;
  if (error.code && CONNECT_PHASE_ERROR_CODES.has(error.code)) {
    // คำสั่งเขียน retry ได้เฉพาะเมื่อมั่นใจว่ายังไม่ถูกส่งไป DB
    if (readOnly || acquirePhaseErrors.has(error) || String(error.code).startsWith('PROTOCOL_ENQUEUE')) {
      return true;
    }
  }
  if (!readOnly) return false;
  if (error.code && MID_QUERY_ERROR_CODES.has(error.code)) return true;

  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('too many connections') ||
    message.includes('server has gone away') ||
    message.includes('lost connection') ||
    message.includes('connection refused') ||
    message.includes('connection reset')
  );
};

export const isDatabaseUnavailableError = (error) => {
  if (!error) return false;
  if (error.code && (CONNECT_PHASE_ERROR_CODES.has(error.code) || MID_QUERY_ERROR_CODES.has(error.code))) {
    return true;
  }
  if (['PROTOCOL_SEQUENCE_TIMEOUT', 'ER_QUERY_TIMEOUT', 'DB_POOL_ACQUIRE_TIMEOUT'].includes(error.code)) {
    return true;
  }
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('queue limit reached') ||
    message.includes('too many connections') ||
    message.includes('server has gone away') ||
    message.includes('connection refused')
  );
};

// ใส่ timeout ให้ทุก query ที่ไม่ได้กำหนดเอง
const withQueryTimeout = (args) => {
  const timeout = getQueryTimeoutMs();
  if (!timeout) return args;
  const [first, ...rest] = args;
  if (typeof first === 'string') return [{ sql: first, timeout }, ...rest];
  if (first && typeof first === 'object' && typeof first.sql === 'string' && first.timeout === undefined) {
    return [{ ...first, timeout }, ...rest];
  }
  return args;
};

const runWithRetry = async (operation, label, { readOnly = false } = {}) => {
  const attempts = getRetryAttempts();
  const baseDelay = getRetryDelayMs();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && isRetryableDatabaseError(error, { readOnly });
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
  queueLimit: Math.max(0, Number(process.env.DB_QUEUE_LIMIT ?? DEFAULT_DB_QUEUE_LIMIT)),
  enableKeepAlive: true,
  // ตรวจจับ connection ที่ตายเงียบ (เช่น proxy ตัดทิ้ง) ภายในไม่กี่สิบวินาที แทนค่า default ของ OS (~2 ชม.)
  keepAliveInitialDelay: 30000,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});

// รอ connection จาก pool แบบมีกำหนดเวลา (mysql2 ไม่มี acquire timeout ในตัว)
// ถ้าหมดเวลา connection ที่ได้มาทีหลังจะถูกคืน pool ทันทีโดยไม่รันคำสั่งใดๆ
const acquireConnection = async () => {
  const timeoutMs = getAcquireTimeoutMs();
  const pending = rawPool.getConnection().catch((error) => {
    if (error && typeof error === 'object') acquirePhaseErrors.add(error);
    throw error;
  });
  if (!timeoutMs) return pending;

  let timer;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new Error('Timed out waiting for a free database connection');
      error.code = 'DB_POOL_ACQUIRE_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
    if (timedOut) {
      pending.then((connection) => connection.release()).catch(() => {});
    }
  }
};

const runQuery = (method, args) => {
  const readOnly = isReadOnlySql(getSqlText(args));
  const finalArgs = withQueryTimeout(args);
  return runWithRetry(async () => {
    const connection = await acquireConnection();
    let destroyed = false;
    try {
      return await connection[method](...finalArgs);
    } catch (error) {
      // query หมดเวลาแต่ยังทำงานค้างอยู่บน connection -> ทิ้ง connection นี้ไม่ให้คืนเข้า pool
      if (error?.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
        destroyed = true;
        connection.destroy();
      }
      throw error;
    } finally {
      if (!destroyed) connection.release();
    }
  }, method, { readOnly });
};

// Wrapper ให้เรียกแบบ pool.query เดิมได้ แต่มี retry อัตโนมัติในกรณีชั่วคราว
const pool = {
  query: (...args) => runQuery('query', args),
  execute: (...args) => runQuery('execute', args),
  getConnection: () => runWithRetry(() => acquireConnection(), 'getConnection'),
  end: (...args) => rawPool.end(...args)
};

// สถานะ pool สำหรับ health check / วิเคราะห์ปัญหา connection ค้าง
export const getPoolStats = () => {
  const core = rawPool.pool;
  return {
    total: core?._allConnections?.length ?? null,
    free: core?._freeConnections?.length ?? null,
    queued: core?._connectionQueue?.length ?? null,
    limit: core?.config?.connectionLimit ?? null
  };
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
