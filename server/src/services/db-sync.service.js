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

const getFastSkipTablePatterns = () => {
  const configured = String(process.env.RAILWAY_SYNC_SKIP_TABLES || '').trim();
  if (['none', 'false', '0'].includes(configured.toLowerCase())) return [];
  const defaults = ['bkp_', 'backup_', 'tmp_', 'line_notification_logs'];
  return (configured ? configured.split(',') : defaults)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const shouldSkipTable = (tableName, patterns) =>
  patterns.some((pattern) => {
    if (pattern.endsWith('*')) return tableName.startsWith(pattern.slice(0, -1));
    if (pattern.endsWith('_')) return tableName.startsWith(pattern);
    return tableName === pattern;
  });

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

const listSourceTables = async (sourceConfig) => {
  const connection = await mysql.createConnection({
    host: sourceConfig.host,
    user: sourceConfig.user,
    password: sourceConfig.password,
    port: sourceConfig.port || 3306,
    database: sourceConfig.database,
    connectTimeout: 10_000
  });

  try {
    const [rows] = await connection.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    return rows
      .map((row) => Object.values(row)[0])
      .filter(Boolean);
  } finally {
    await connection.end();
  }
};

const dumpDatabase = async (sourceConfig, dumpPath, { ignoreTables = [], onBytes } = {}) => {
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
      '--quick',
      '--compress',
      '--skip-lock-tables',
      '--no-tablespaces',
      '--skip-comments',
      '--hex-blob',
      ...ignoreTables.flatMap((table) => [
        '--ignore-table',
        `${sourceConfig.database}.${table}`
      ]),
      sourceConfig.database
    ];
    const commandTimeoutMs = getCommandTimeoutMs();
    const child = spawn('mysqldump', args, { env });
    let stderr = '';
    let bytes = 0;
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
    if (typeof onBytes === 'function') {
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        try { onBytes(bytes); } catch { /* ignore */ }
      });
    }
    child.stdout.pipe(outStream);
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      outStream.close();
      if (code === 0) {
        resolve(bytes);
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

const STATS_PATH = path.join(process.cwd(), '.cache', 'sync-stats.json');

const readSyncStats = async () => {
  try {
    const raw = await fsPromises.readFile(STATS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastDumpBytes: Number(parsed.lastDumpBytes) || 0,
      lastImportMs: Number(parsed.lastImportMs) || 0
    };
  } catch {
    return { lastDumpBytes: 0, lastImportMs: 0 };
  }
};

const writeSyncStats = async (stats) => {
  try {
    await fsPromises.mkdir(path.dirname(STATS_PATH), { recursive: true });
    await fsPromises.writeFile(STATS_PATH, JSON.stringify(stats, null, 2), 'utf8');
  } catch {
    // ignore — stats file is optional
  }
};

// percent ranges per phase (sums to 100)
const PHASE_RANGES = {
  verify:    [0,   3],
  list:      [3,   5],
  dump:      [5,  65],
  strip:     [65, 70],
  reset:     [70, 73],
  import:    [73, 99],
  done:      [100, 100]
};

const lerpPhase = (phase, fraction) => {
  const [lo, hi] = PHASE_RANGES[phase] || [0, 0];
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(lo + (hi - lo) * f);
};

export const syncDatabaseFromRailway = async ({ sourceUrl, targetConfig, onProgress }) => {
  if (!sourceUrl) {
    throw new Error('RAILWAY_DB_URL is not configured');
  }

  const sourceConfig = parseMysqlUrl(sourceUrl);
  if (!sourceConfig.database) {
    throw new Error('Invalid Railway DB URL (missing database name)');
  }

  const report = (phase, fraction, status) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress({ phase, percent: lerpPhase(phase, fraction), status }); } catch { /* ignore */ }
  };

  const stats = await readSyncStats();
  const dumpPath = path.join(os.tmpdir(), `railway_dump_${Date.now()}.sql`);

  try {
    report('verify', 0, 'กำลังตรวจสอบการเชื่อมต่อ Railway...');
    await withRailwayRetry(() => verifySourceConnection(sourceConfig), 'verify-source-connection');
    report('verify', 1, 'เชื่อมต่อ Railway สำเร็จ');

    report('list', 0, 'กำลังอ่านรายการตาราง...');
    const skipPatterns = getFastSkipTablePatterns();
    const sourceTables = await withRailwayRetry(() => listSourceTables(sourceConfig), 'list-source-tables');
    const ignoreTables = sourceTables.filter((table) => shouldSkipTable(table, skipPatterns));
    if (ignoreTables.length > 0) {
      console.log(`[Railway Sync] fast skip tables: ${ignoreTables.join(', ')}`);
    }
    report('list', 1, `พบ ${sourceTables.length} ตาราง`);

    report('dump', 0, 'กำลังดาวน์โหลดข้อมูล...');
    const expectedDumpBytes = stats.lastDumpBytes || 0;
    const onDumpBytes = (bytes) => {
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      if (expectedDumpBytes > 0) {
        report('dump', bytes / expectedDumpBytes, `กำลังดาวน์โหลดข้อมูล (${mb} MB)`);
      } else {
        // ไม่มีข้อมูลขนาดครั้งก่อน → ใช้ asymptote เพื่อให้ % ค่อยๆ ขึ้น
        const fakeFraction = 1 - 1 / (1 + bytes / (5 * 1024 * 1024));
        report('dump', fakeFraction, `กำลังดาวน์โหลดข้อมูล (${mb} MB)`);
      }
    };
    let actualDumpBytes = 0;
    await withRailwayRetry(async () => {
      actualDumpBytes = await dumpDatabase(sourceConfig, dumpPath, { ignoreTables, onBytes: onDumpBytes });
    }, 'dump-database');
    report('dump', 1, `ดาวน์โหลดข้อมูลครบ (${(actualDumpBytes / (1024 * 1024)).toFixed(1)} MB)`);

    report('strip', 0, 'กำลังจัดการไฟล์ดัมพ์...');
    await stripDefinerClauses(dumpPath);
    report('strip', 1, 'จัดการไฟล์ดัมพ์เสร็จ');

    report('reset', 0, 'กำลังเตรียมฐานข้อมูลปลายทาง...');
    await resetTargetDatabase(targetConfig);
    report('reset', 1, 'เตรียมฐานข้อมูลปลายทางเสร็จ');

    report('import', 0, 'กำลังนำเข้าข้อมูล...');
    const importStart = Date.now();
    const expectedImportMs = stats.lastImportMs || 0;
    const importTicker = setInterval(() => {
      const elapsed = Date.now() - importStart;
      const fraction = expectedImportMs > 0
        ? elapsed / expectedImportMs
        : 1 - 1 / (1 + elapsed / 30000);
      report('import', fraction, 'กำลังนำเข้าข้อมูลลงฐานข้อมูล...');
    }, 500);
    try {
      await importDatabase(targetConfig, dumpPath);
    } finally {
      clearInterval(importTicker);
    }
    const importMs = Date.now() - importStart;
    report('import', 1, 'นำเข้าข้อมูลเสร็จ');

    await writeSyncStats({ lastDumpBytes: actualDumpBytes, lastImportMs: importMs });
    report('done', 1, 'ซิงค์ข้อมูลเรียบร้อยแล้ว');
  } finally {
    try {
      await fsPromises.unlink(dumpPath);
    } catch (error) {
      // ignore cleanup errors
    }
  }
};
