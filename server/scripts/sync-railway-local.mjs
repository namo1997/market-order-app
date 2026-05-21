import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { syncDatabaseFromRailway } from '../src/services/db-sync.service.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const execFileAsync = promisify(execFile);

const requiredCommands = ['mysql', 'mysqldump'];

const getSourceUrl = () =>
  process.env.RAILWAY_DB_URL ||
  process.env.RAILWAY_MYSQL_URL ||
  process.env.MYSQL_PUBLIC_URL ||
  process.env.RAILWAY_DATABASE_URL ||
  '';

const getTargetConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'market_order_db'
});

const assertLocalOnly = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refuse to sync in production NODE_ENV');
  }
};

const assertCommands = async () => {
  for (const command of requiredCommands) {
    await execFileAsync('/usr/bin/env', ['which', command]);
  }
};

const main = async () => {
  const checkOnly = process.argv.includes('--check-only');
  assertLocalOnly();
  await assertCommands();

  const sourceUrl = getSourceUrl();
  if (!sourceUrl) {
    throw new Error('RAILWAY_DB_URL is not configured');
  }

  const targetConfig = getTargetConfig();
  if (!targetConfig.database) {
    throw new Error('DB_NAME is not configured');
  }

  if (checkOnly) {
    console.log(
      `[Railway Sync] config OK: target=${targetConfig.host}:${targetConfig.port}/${targetConfig.database}`
    );
    return;
  }

  const startedAt = new Date();
  console.log(`[Railway Sync] start ${startedAt.toISOString()}`);
  await syncDatabaseFromRailway({ sourceUrl, targetConfig });
  console.log(`[Railway Sync] done ${new Date().toISOString()}`);
};

main().catch((error) => {
  console.error(`[Railway Sync] failed: ${error?.message || error}`);
  process.exit(1);
});
