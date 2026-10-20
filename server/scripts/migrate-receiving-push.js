// Owner-run release step only. Never imported by tests or startup.
import pool from '../src/config/database.js';
import { PUSH_DDL } from '../src/models/receiving-push-schema.js';
try {
  for (const sql of PUSH_DDL) await pool.query(sql);
  console.info('Receiving push additive tables ready');
} catch { console.error('Receiving push migration failed'); process.exitCode = 1; }
finally { await pool.end(); }
