import dotenv from 'dotenv';

// Standalone app: only ever reads its own general-cashflow/server/.env.
// Must never fall back to the market-order app's env vars or config.
dotenv.config();

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
  seed: {
    adminUsername: process.env.CASHFLOW_ADMIN_USERNAME || 'admin',
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
  uploadDir: process.env.CASHFLOW_UPLOAD_DIR || 'uploads'
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
