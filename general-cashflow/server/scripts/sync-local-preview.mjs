import mysql from 'mysql2/promise';

const sourceUrl = String(process.env.CASHFLOW_PREVIEW_SOURCE_URL || '').trim();
if (!sourceUrl) throw new Error('Set CASHFLOW_PREVIEW_SOURCE_URL to a read-only production MySQL URL');
if (!process.argv.includes('--confirm-production-read')) {
  throw new Error('Refusing to read production without --confirm-production-read');
}

const destination = {
  host: process.env.CASHFLOW_DB_HOST || '127.0.0.1', port: Number(process.env.CASHFLOW_DB_PORT || 3317),
  user: process.env.CASHFLOW_DB_USER || 'cashflow_preview', password: process.env.CASHFLOW_DB_PASSWORD || 'cashflow-preview',
  database: process.env.CASHFLOW_DB_NAME || 'general_cashflow_preview'
};
if (!['127.0.0.1', 'localhost', '::1'].includes(destination.host)) {
  throw new Error('Preview destination must be loopback; refusing to replace a remote database');
}

process.env.CASHFLOW_DB_HOST = destination.host;
process.env.CASHFLOW_DB_PORT = String(destination.port);
process.env.CASHFLOW_DB_USER = destination.user;
process.env.CASHFLOW_DB_PASSWORD = destination.password;
process.env.CASHFLOW_DB_NAME = destination.database;
process.env.CASHFLOW_SEED_DEMO_USERS = 'true';
const { migrateDatabase, getPool } = await import('../src/db.js');
await migrateDatabase();

const source = await mysql.createConnection(sourceUrl);
const target = getPool();
const [receiptRows] = await source.query(`SELECT id FROM daily_receipts WHERE receipt_date >= CURDATE() - INTERVAL 60 DAY`);
const receiptIds = receiptRows.map((row) => Number(row.id));
const placeholders = (rows) => rows.length ? rows.map(() => '?').join(',') : 'NULL';
const filters = {
  daily_receipts: [`id IN (${placeholders(receiptIds)})`, receiptIds],
  daily_receipt_lines: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  receipt_misc_items: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  attachments: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  statement_imports: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  statement_transactions: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  audit_logs: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  morning_briefs: [`brief_date >= CURDATE() - INTERVAL 60 DAY`, []],
  bank_inbox_imports: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  decision_events: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  shadow_predictions: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  decision_followups: [`created_at >= NOW() - INTERVAL 60 DAY`, []]
};
const fullTables = ['branches','payment_channels','payment_channel_mappings','receiving_accounts','receiving_account_channels','receiving_account_channel_branches','branch_grab_stores','bank_merchant_mappings'];
const ordered = [...fullTables,'daily_receipts','daily_receipt_lines','receipt_line_reconciliations','statement_imports','statement_transactions','bank_inbox_imports','bank_inbox_transactions','receipt_misc_items','attachments','audit_logs','morning_briefs','decision_events','shadow_predictions','decision_followups'];

const lineRows = await source.query(`SELECT id FROM daily_receipt_lines WHERE receipt_id IN (${placeholders(receiptIds)})`, receiptIds).then(([rows]) => rows);
filters.receipt_line_reconciliations = [`receipt_line_id IN (${placeholders(lineRows.map((row) => Number(row.id)))})`, lineRows.map((row) => Number(row.id))];
const bankImportRows = await source.query(`SELECT id FROM bank_inbox_imports WHERE created_at >= NOW() - INTERVAL 60 DAY`).then(([rows]) => rows);
filters.bank_inbox_transactions = [`import_id IN (${placeholders(bankImportRows.map((row) => Number(row.id)))})`, bankImportRows.map((row) => Number(row.id))];

await target.query('SET FOREIGN_KEY_CHECKS=0');
try {
  for (const table of [...ordered].reverse()) await target.query(`TRUNCATE TABLE \`${table}\``);
  for (const table of ordered) {
    const [rows, fields] = fullTables.includes(table)
      ? await source.query(`SELECT * FROM \`${table}\``)
      : await source.query(`SELECT * FROM \`${table}\` WHERE ${filters[table]?.[0] || '1=0'}`, filters[table]?.[1] || []);
    if (!rows.length) continue;
    if (table === 'daily_receipts') rows.forEach((row) => { row.submitted_by = null; row.checked_by = null; row.closed_by = null; row.table_check_acknowledged_by = null; row.cashier_variance_acknowledged_by = null; });
    if (table === 'attachments') rows.forEach((row) => { row.uploaded_by = null; });
    if (table === 'receipt_misc_items') rows.forEach((row) => { row.created_by = null; });
    if (table === 'audit_logs') rows.forEach((row) => { row.actor_user_id = null; });
    if (table === 'decision_events') rows.forEach((row) => { row.actor_user_id = null; });
    if (table === 'decision_followups') rows.forEach((row) => { row.answered_by = null; });
    const columns = fields.map((field) => field.name);
    const values = rows.map((row) => columns.map((column) => row[column]));
    await target.query(`INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES ?`, [values]);
    console.log(`${table}: ${rows.length}`);
  }
} finally {
  await target.query('SET FOREIGN_KEY_CHECKS=1');
  await source.end(); await target.end();
}
console.log(`Local preview synced: ${receiptIds.length} receipts from the last 60 days`);
