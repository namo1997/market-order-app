import mysql from 'mysql2/promise';

const sourceUrl = String(process.env.CASHFLOW_PREVIEW_SOURCE_URL || '').trim();
if (!sourceUrl) throw new Error('Set CASHFLOW_PREVIEW_SOURCE_URL to a read-only production MySQL URL');
const sourceDatabase = String(process.env.CASHFLOW_PREVIEW_SOURCE_DB || '').trim();
if (!process.argv.includes('--confirm-production-read')) {
  throw new Error('Refusing to read production without --confirm-production-read');
}

const destination = {
  host: process.env.CASHFLOW_DB_HOST || '127.0.0.1', port: Number(process.env.CASHFLOW_DB_PORT || 3317),
  user: process.env.CASHFLOW_DB_USER || 'cashflow_preview', password: process.env.CASHFLOW_DB_PASSWORD ?? 'cashflow-preview',
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
if (sourceDatabase) await source.changeUser({ database: sourceDatabase });
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
  receipt_post_close_adjustments: [`receipt_id IN (${placeholders(receiptIds)})`, receiptIds],
  audit_logs: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  morning_briefs: [`brief_date >= CURDATE() - INTERVAL 60 DAY`, []],
  bank_inbox_imports: [`created_at >= NOW() - INTERVAL 60 DAY`, []],
  decision_events: [`created_at >= NOW() - INTERVAL 60 DAY`, []]
};
const fullTables = ['branches','payment_channels','payment_channel_mappings','receiving_accounts','receiving_account_channels','receiving_account_channel_branches','branch_grab_stores','bank_merchant_mappings'];
const ordered = [...fullTables,'daily_receipts','daily_receipt_lines','receipt_line_reconciliations','receipt_post_close_adjustments','statement_imports','statement_transactions','bank_inbox_imports','bank_inbox_transactions','receipt_misc_items','reservation_deposits','reservation_deposit_applications','attachments','audit_logs','morning_briefs','decision_events'];

const lineRows = await source.query(`SELECT id FROM daily_receipt_lines WHERE receipt_id IN (${placeholders(receiptIds)})`, receiptIds).then(([rows]) => rows);
filters.receipt_line_reconciliations = [`receipt_line_id IN (${placeholders(lineRows.map((row) => Number(row.id)))})`, lineRows.map((row) => Number(row.id))];
const bankImportRows = await source.query(`SELECT id FROM bank_inbox_imports WHERE created_at >= NOW() - INTERVAL 60 DAY`).then(([rows]) => rows);
filters.bank_inbox_transactions = [`inbox_import_id IN (${placeholders(bankImportRows.map((row) => Number(row.id)))})`, bankImportRows.map((row) => Number(row.id))];
const applicationDepositRows = await source.query(
  `SELECT DISTINCT reservation_deposit_id AS id FROM reservation_deposit_applications WHERE receipt_id IN (${placeholders(receiptIds)})`,
  receiptIds
).then(([rows]) => rows);
const applicationDepositIds = applicationDepositRows.map((row) => Number(row.id));
const depositParams = [...receiptIds, ...applicationDepositIds];
const depositRows = await source.query(
  `SELECT id FROM reservation_deposits
   WHERE receipt_id IN (${placeholders(receiptIds)}) OR id IN (${placeholders(applicationDepositIds)})`,
  depositParams
).then(([rows]) => rows);
const depositIds = [...new Set(depositRows.map((row) => Number(row.id)))];
filters.reservation_deposits = [`id IN (${placeholders(depositIds)})`, depositIds];
filters.reservation_deposit_applications = [
  `reservation_deposit_id IN (${placeholders(depositIds)}) OR receipt_id IN (${placeholders(receiptIds)})`,
  [...depositIds, ...receiptIds]
];

const [[previewActor]] = await target.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
if (!previewActor?.id) throw new Error('Local preview admin user is required before syncing financial revisions');

await target.query('SET FOREIGN_KEY_CHECKS=0');
try {
  for (const table of [...ordered, 'monthly_sales_closes'].reverse()) await target.query(`TRUNCATE TABLE \`${table}\``);
  for (const table of ordered) {
    // A preview needs evidence metadata to explain a reconciliation, but
    // copying original BLOB documents can exceed the local MariaDB packet
    // limit and prevents all of the financial rows from loading. Keep the
    // immutable names/paths/statuses and deliberately leave the original
    // document bytes in Production.
    const attachmentColumns = `id, receipt_id, statement_import_id, attachment_type, original_name,
      stored_path, document_path, mime_type, document_mime_type, size_bytes, document_size_bytes,
      NULL AS file_data, NULL AS document_data,
      'preview_metadata_only' AS document_status,
      'ไฟล์ต้นฉบับอยู่ใน Production; Preview แสดงเฉพาะรายละเอียดไฟล์' AS document_error,
      uploaded_by, created_at`;
    const [rows, fields] = fullTables.includes(table)
      ? await source.query(`SELECT * FROM \`${table}\``)
      : table === 'attachments'
        ? await source.query(`SELECT ${attachmentColumns} FROM \`${table}\` WHERE ${filters[table]?.[0] || '1=0'}`, filters[table]?.[1] || [])
        : await source.query(`SELECT * FROM \`${table}\` WHERE ${filters[table]?.[0] || '1=0'}`, filters[table]?.[1] || []);
    if (!rows.length) continue;
    if (table === 'daily_receipts') rows.forEach((row) => { row.submitted_by = null; row.checked_by = null; row.closed_by = null; row.table_check_acknowledged_by = null; row.cashier_variance_acknowledged_by = null; });
    if (table === 'attachments') rows.forEach((row) => { row.uploaded_by = null; });
    if (table === 'receipt_misc_items') rows.forEach((row) => { row.created_by = null; });
    if (table === 'receipt_post_close_adjustments') rows.forEach((row) => { row.created_by = Number(previewActor.id); });
    if (table === 'reservation_deposits' || table === 'reservation_deposit_applications') rows.forEach((row) => { row.created_by = null; });
    if (table === 'audit_logs') rows.forEach((row) => { row.actor_user_id = null; });
    if (table === 'decision_events') rows.forEach((row) => { row.actor_user_id = null; });
    const columns = fields.map((field) => field.name);
    // mysql2 reads MySQL JSON columns as objects, while the MariaDB preview
    // database validates the inserted JSON text. Preserve dates and binary
    // attachments, but serialize JSON values before the bulk insert.
    const previewValue = (value) => {
      if (value === null || value === undefined || value instanceof Date || Buffer.isBuffer(value)) return value;
      return typeof value === 'object' ? JSON.stringify(value) : value;
    };
    const values = rows.map((row) => columns.map((column) => previewValue(row[column])));
    // Avoid a single oversized MariaDB packet when a statement contains many
    // transactions. Attachment document bytes are intentionally not copied.
    const chunkSize = 100;
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      await target.query(
        `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES ?`,
        [values.slice(offset, offset + chunkSize)]
      );
    }
    console.log(`${table}: ${rows.length}`);
  }
} finally {
  await target.query('SET FOREIGN_KEY_CHECKS=1');
  await source.end(); await target.end();
}
console.log(`Local preview synced: ${receiptIds.length} receipts from the last 60 days`);
