import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import mysql from 'mysql2/promise';

const DEFAULT_SYNC_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 4000;
const DEFAULT_COMMAND_TIMEOUT_MS = 8 * 60 * 1000;

const parseMysqlUrl = (url) => {
  const parsed = new URL(url);
  const database = parsed.pathname?.replace(/^\//, '') || '';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryConfig = () => ({
  retries: Math.max(1, Number(process.env.RAILWAY_SYNC_MAX_RETRIES || DEFAULT_SYNC_RETRIES)),
  retryDelayMs: Math.max(1000, Number(process.env.RAILWAY_SYNC_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS))
});

const getCommandTimeoutMs = () =>
  Math.max(30_000, Number(process.env.RAILWAY_SYNC_COMMAND_TIMEOUT_MS || DEFAULT_COMMAND_TIMEOUT_MS));

const normalizeErrorMessage = (error) => String(error?.message || error || '').trim();

const isTransientRailwayError = (error) => {
  const text = normalizeErrorMessage(error).toLowerCase();
  const patterns = [
    'getaddrinfo',
    'unknown mysql server host',
    'temporary failure in name resolution',
    'name or service not known',
    'eai_again',
    'enotfound',
    'econnrefused',
    'econnreset',
    'etimedout',
    'timed out',
    "can't connect to mysql server",
    'lost connection to mysql server',
    'server has gone away',
    'connection refused'
  ];
  return patterns.some((pattern) => text.includes(pattern));
};

const createTemporaryRailwayError = (error) => {
  const wrapped = new Error(
    `โหลดข้อมูลจาก Railway ไม่ได้ชั่วคราว: ${normalizeErrorMessage(error) || 'Unknown error'}`
  );
  wrapped.code = 'RAILWAY_TEMP_UNAVAILABLE';
  wrapped.cause = error;
  return wrapped;
};

const withRailwayRetry = async (work, label) => {
  const { retries, retryDelayMs } = getRetryConfig();
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      const transient = isTransientRailwayError(error);

      if (isLastAttempt || !transient) {
        break;
      }

      const waitMs = retryDelayMs * attempt;
      console.warn(
        `[Railway Sync] ${label} failed (attempt ${attempt}/${retries}): ${normalizeErrorMessage(error)}`
      );
      await sleep(waitMs);
    }
  }

  if (isTransientRailwayError(lastError)) {
    throw createTemporaryRailwayError(lastError);
  }
  throw lastError;
};

const verifySourceConnection = async (sourceConfig) => {
  const connection = await mysql.createConnection({
    host: sourceConfig.host,
    user: sourceConfig.user,
    password: sourceConfig.password,
    port: sourceConfig.port || 3306,
    database: sourceConfig.database,
    connectTimeout: 10_000
  });

  try {
    await connection.query('SELECT 1');
  } finally {
    await connection.end();
  }
};

const dumpDatabase = async (sourceConfig, dumpPath) => {
  const env = { ...process.env };
  if (sourceConfig.password) {
    env.MYSQL_PWD = sourceConfig.password;
  }

  await fsPromises.mkdir(path.dirname(dumpPath), { recursive: true });
  const outStream = fs.createWriteStream(dumpPath);

  await new Promise((resolve, reject) => {
    const args = [
      '-h',
      sourceConfig.host,
      '-P',
      String(sourceConfig.port || 3306),
      '-u',
      sourceConfig.user,
      '--single-transaction',
      '--skip-lock-tables',
      '--no-tablespaces',
      sourceConfig.database
    ];
    const commandTimeoutMs = getCommandTimeoutMs();
    const child = spawn('mysqldump', args, { env });
    let stderr = '';
    const timeoutId = setTimeout(() => {
      stderr += `\nmysqldump timed out after ${Math.floor(commandTimeoutMs / 1000)}s`;
      child.kill('SIGKILL');
    }, commandTimeoutMs);

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.stdout.pipe(outStream);
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      outStream.close();
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || 'mysqldump failed'));
      }
    });
  });
};

const stripDefinerClauses = async (dumpPath) => {
  const original = await fsPromises.readFile(dumpPath, 'utf8');
  const sanitized = original
    // mysqldump versioned comments used by views/triggers/procs
    .replace(/\/\*!\d+\s+DEFINER=`[^`]+`@`[^`]+`\s*\*\//g, '')
    // plain DEFINER clause
    .replace(/DEFINER=`[^`]+`@`[^`]+`\s+/g, '');

  if (sanitized !== original) {
    await fsPromises.writeFile(dumpPath, sanitized, 'utf8');
  }
};

const resetTargetDatabase = async (targetConfig) => {
  const connection = await mysql.createConnection({
    host: targetConfig.host,
    user: targetConfig.user,
    password: targetConfig.password,
    port: targetConfig.port || 3306,
    multipleStatements: true
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${targetConfig.database}\`;`);
    await connection.query(
      `CREATE DATABASE \`${targetConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } finally {
    await connection.end();
  }
};

const importDatabase = async (targetConfig, dumpPath) => {
  const env = { ...process.env };
  if (targetConfig.password) {
    env.MYSQL_PWD = targetConfig.password;
  }

  await new Promise((resolve, reject) => {
    const args = [
      '-h',
      targetConfig.host,
      '-P',
      String(targetConfig.port || 3306),
      '-u',
      targetConfig.user,
      targetConfig.database
    ];
    const commandTimeoutMs = getCommandTimeoutMs();
    const child = spawn('mysql', args, { env, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    const timeoutId = setTimeout(() => {
      stderr += `\nmysql import timed out after ${Math.floor(commandTimeoutMs / 1000)}s`;
      child.kill('SIGKILL');
    }, commandTimeoutMs);

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    fs.createReadStream(dumpPath).pipe(child.stdin);
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || 'mysql import failed'));
      }
    });
  });
};

export const syncDatabaseFromRailway = async ({ sourceUrl, targetConfig }) => {
  if (!sourceUrl) {
    throw new Error('RAILWAY_DB_URL is not configured');
  }

  const sourceConfig = parseMysqlUrl(sourceUrl);
  if (!sourceConfig.database) {
    throw new Error('Invalid Railway DB URL (missing database name)');
  }

  const dumpPath = path.join(os.tmpdir(), `railway_dump_${Date.now()}.sql`);

  try {
    await withRailwayRetry(() => verifySourceConnection(sourceConfig), 'verify-source-connection');
    await withRailwayRetry(() => dumpDatabase(sourceConfig, dumpPath), 'dump-database');
    await stripDefinerClauses(dumpPath);
    await resetTargetDatabase(targetConfig);
    await importDatabase(targetConfig, dumpPath);
  } finally {
    try {
      await fsPromises.unlink(dumpPath);
    } catch (error) {
      // ignore cleanup errors
    }
  }
};
