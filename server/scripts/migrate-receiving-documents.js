import pool from '../src/config/database.js';
import { ensureReceivingDocumentsTables } from '../src/models/receiving-documents-schema.js';

const run = async () => {
  try {
    console.log('Running additive migration for receiving-documents tables...');
    await ensureReceivingDocumentsTables(pool, { force: true });
    console.log('✅ receiving-documents tables and precision upgrades applied.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();
