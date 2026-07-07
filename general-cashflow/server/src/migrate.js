import { migrateDatabase, closePool } from './db.js';

try {
  await migrateDatabase();
  console.log('general_cashflow_db migration complete');
} finally {
  await closePool();
}
