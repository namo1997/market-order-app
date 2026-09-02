import { getPool } from '../src/db.js';
import { recalculateReceipts } from '../src/recalculateReceipts.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--dry-run'].includes(arg)) || args.length > 1) {
  throw new Error('Usage: node scripts/recalculate-receipts.mjs [--dry-run|--apply]');
}
const pool = getPool();
try {
  const result = await recalculateReceipts(pool, { apply: args.includes('--apply') });
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} finally {
  await pool.end();
}
