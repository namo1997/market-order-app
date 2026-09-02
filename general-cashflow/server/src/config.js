import dotenv from 'dotenv';

// Standalone app: only ever reads its own general-cashflow/server/.env.
// Must never fall back to the market-order app's env vars or config.
dotenv.config();

const splitList = (value = '') => String(value)
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const adminUsername = process.env.CASHFLOW_ADMIN_USERNAME || 'admin';

export const config = {
  // Railway (and most PaaS hosts) inject PORT and require binding to it —
  // takes priority over the local-dev CASHFLOW_PORT override.
  port: Number(process.env.PORT || process.env.CASHFLOW_PORT || 8100),
  host: process.env.CASHFLOW_HOST || '0.0.0.0',
  corsOrigin: String(
    process.env.CASHFLOW_CORS_ORIGIN || 'http://localhost:5178,http://127.0.0.1:5178'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  db: {
    host: process.env.CASHFLOW_DB_HOST || 'localhost',
    port: Number(process.env.CASHFLOW_DB_PORT || 3306),
    user: process.env.CASHFLOW_DB_USER || 'root',
    password: process.env.CASHFLOW_DB_PASSWORD ?? '',
    database: process.env.CASHFLOW_DB_NAME || 'general_cashflow_db',
    connectionLimit: Number(process.env.CASHFLOW_DB_CONNECTION_LIMIT || 10)
  },
  jwt: {
    secret: process.env.CASHFLOW_JWT_SECRET || 'cashflow-local-secret',
    expiresIn: process.env.CASHFLOW_JWT_EXPIRES_IN || '12h'
  },
  googleLogin: {
    clientId: String(process.env.CASHFLOW_GOOGLE_CLIENT_ID || '').trim(),
    allowedEmails: splitList(process.env.CASHFLOW_GOOGLE_ALLOWED_EMAILS),
    appUsername: String(process.env.CASHFLOW_GOOGLE_APP_USERNAME || adminUsername).trim()
  },
  sheetsExportToken: process.env.CASHFLOW_SHEETS_EXPORT_TOKEN || '',
  accountingExportToken: process.env.CASHFLOW_ACCOUNTING_EXPORT_TOKEN || '',
  // Shared secret for the Google Apps Script that forwards bank-report ZIP files.
  // Keep it separate from browser login tokens because the script is unattended.
  gmailInboxToken: process.env.CASHFLOW_GMAIL_INBOX_TOKEN || '',
  // SCB Business Anywhere ZIP reports are encrypted with the registered document number.
  // Set only as a Railway secret; never send this value from Gmail or the browser.
  scbBusinessAnywhereZipPassword: process.env.CASHFLOW_SCB_ZIP_PASSWORD || '',
  // Krungthai Business historical-statement ZIP exports can use a separate password.
  // Leave blank when the bank export is not encrypted.
  krungthaiBusinessZipPassword: process.env.CASHFLOW_KRUNGTHAI_ZIP_PASSWORD || '',
  seed: {
    adminUsername,
    adminPassword: process.env.CASHFLOW_ADMIN_PASSWORD || 'admin12345',
    demoUsers: String(process.env.CASHFLOW_SEED_DEMO_USERS || 'true') === 'true'
  },
  // Read-only POS analytics source (see README). Kept as its own explicit
  // CASHFLOW_-prefixed copy so this app never depends on the market-order
  // app's env vars, even though both happen to read the same POS backend.
  clickhouse: {
    host: process.env.CASHFLOW_CLICKHOUSE_HOST,
    port: process.env.CASHFLOW_CLICKHOUSE_PORT || '8123',
    user: process.env.CASHFLOW_CLICKHOUSE_USER,
    password: process.env.CASHFLOW_CLICKHOUSE_PASSWORD,
    database: process.env.CASHFLOW_CLICKHOUSE_DATABASE || 'dedebi',
    secure: String(process.env.CASHFLOW_CLICKHOUSE_SECURE || 'false') === 'true',
    shopId: process.env.CASHFLOW_CLICKHOUSE_SHOP_ID || '2OJMVIo1Qi81NqYos3oDPoASziy',
    tzOffset: Number(process.env.CASHFLOW_CLICKHOUSE_TZ_OFFSET || 7)
  },
  uploadDir: process.env.CASHFLOW_UPLOAD_DIR || 'uploads',
  decisionReasonRequired: String(process.env.CASHFLOW_DECISION_REASON_REQUIRED ?? '1').trim() !== '0'
};

export const RECEIPT_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'CHECKED_OK',
  'CHECKED_VARIANCE',
  'NEEDS_CORRECTION',
  'CLOSED'
]);

export const USER_ROLES = new Set(['cashier', 'auditor', 'recorder', 'admin']);
