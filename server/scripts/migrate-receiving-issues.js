import pool from '../src/config/database.js';
import { ensureIssueTables } from '../src/models/receiving-issues-schema.js';
import { ensureQueueTables } from '../src/models/receiving-queue-schema.js';
try {
  await ensureQueueTables(pool,{force:true});
  await ensureIssueTables(pool,{force:true});
  console.info('Receiving issue tables ready');
} catch { console.error('Receiving issue migration failed'); process.exitCode=1; }
finally { await pool.end(); }
