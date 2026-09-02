import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalRevision,
  createAccountingExportHandlers,
} from '../../src/accountingExportReceivables.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(
  here,
  '../../../../management-accounting/docs/contracts/general-cashflow/fixtures/source',
);

export const ACCOUNTING_EXPORT_FIXTURE_TOKEN = 'local-accounting-export-fixture-token';
export const ACCOUNTING_EXPORT_FIXTURE_HOST = '127.0.0.1';

const ENDPOINTS = Object.freeze({
  '/accounting-export/daily-sales': 'pos_daily_sale',
  '/accounting-export/daily-receipts': 'receipt_day',
  '/accounting-export/daily-receipt-lines': 'receipt_expectation',
  '/accounting-export/settlements': 'cash_settlement',
  '/accounting-export/payment-channels': 'payment_channel',
  '/accounting-export/receiving-accounts': 'receiving_account',
});

export const ACCOUNTING_EXPORT_ENDPOINTS = ENDPOINTS;

const fixtureFilesBySourceType = Object.freeze({
  pos_daily_sale: ['daily-sale-closed.json'],
  receipt_day: ['closed-receipt.json', 'closed-revision.json', 'open-status-only.json'],
  receipt_expectation: ['unknown-mapping.json'],
  cash_settlement: [
    'card-fee.json',
    'cash-closed.json',
    'cross-day-partial.json',
    'grab-payout.json',
    'qr-next-day.json',
    'unknown-account.json',
  ],
  receiving_account: ['privacy-masked-account.json'],
});

const readFixture = (name) => {
  const file = path.join(fixtureDir, name);
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fixture.schema_version !== '1.0' || fixture.source !== 'GENERAL_CASHFLOW') {
    throw new Error(`Invalid accounting fixture metadata: ${name}`);
  }
  if (!Array.isArray(fixture.data)) throw new Error(`Invalid accounting fixture data: ${name}`);
  return fixture;
};

const rowsFrom = (sourceType, fixtureNames) => fixtureNames.flatMap((name) => {
  const fixture = readFixture(name);
  if (fixture.source_type !== sourceType) {
    throw new Error(`Fixture source type mismatch: ${name}`);
  }
  // Revision snapshots are intentionally kept in the fixture as source rows;
  // they prove that a replay can retain both the old and replacement snapshot.
  const snapshots = Array.isArray(fixture.snapshots) ? fixture.snapshots : [];
  return [...fixture.data, ...snapshots].map((row) => ({ ...row }));
});

const buildPaymentChannelRows = (allRows) => {
  const seen = new Map();
  for (const row of allRows) {
    const code = row.channel_code;
    if (!code || seen.has(code)) continue;
    seen.set(code, {
      source_id: `gc:payment-channel:${String(code).toLowerCase()}`,
      source_channel_id: `gc-channel-${String(code).toLowerCase()}`,
      code,
      label: row.channel_label || code,
      kind: row.channel_kind || (code === 'CASH' ? 'CASH' : 'NON_CASH'),
      provider: row.provider ?? null,
      is_active: true,
      updated_at: '2026-08-01T09:00:00+07:00',
    });
  }
  return [...seen.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((row) => ({ ...row, revision: canonicalRevision(row), revision_of: null }));
};

export const loadAccountingExportFixtures = () => {
  const rows = new Map();
  for (const [sourceType, names] of Object.entries(fixtureFilesBySourceType)) {
    rows.set(sourceType, rowsFrom(sourceType, names));
  }
  const channelInputs = [
    ...rows.get('receipt_expectation'),
    ...rows.get('cash_settlement'),
  ];
  rows.set('payment_channel', buildPaymentChannelRows(channelInputs));
  return rows;
};

const unauthorized = () => {
  const error = new Error('Accounting export credentials are required.');
  error.code = 'ACCOUNTING_EXPORT_UNAUTHORIZED';
  error.statusCode = 401;
  return error;
};

const makeAuthenticator = (token) => async (req) => {
  const authorization = String(req.headers?.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const alternate = String(req.headers?.['x-accounting-sync-token'] || '');
  if (bearer !== token && alternate !== token) throw unauthorized();
};

const responseAdapter = (res) => ({
  status(code) {
    res.statusCode = code;
    return this;
  },
  json(body) {
    const payload = JSON.stringify(body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(payload);
    return this;
  },
});

const normalizePort = (port) => {
  if (port === undefined) return 0;
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new RangeError('Fixture server port must be an integer from 0 to 65535.');
  }
  return value;
};

/**
 * Create an ephemeral, local-only HTTP source for the six accounting exports.
 * No environment variables, source tokens, database clients, or network
 * clients are read by this helper. Call start() before using the baseUrl and
 * always await stop() in the test finally/after hook.
 */
export const createAccountingExportFixtureServer = (options = {}) => {
  const token = options.token === undefined ? ACCOUNTING_EXPORT_FIXTURE_TOKEN : String(options.token);
  if (!token) throw new TypeError('Fixture server token must not be empty.');
  const fixtureRows = options.rows instanceof Map ? options.rows : loadAccountingExportFixtures();
  const handlers = createAccountingExportHandlers({
    loadRows: async ({ sourceType }) => (fixtureRows.get(sourceType) || []).map((row) => ({ ...row })),
    authenticate: makeAuthenticator(token),
  });
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const sourceType = ENDPOINTS[requestUrl.pathname];
    if (!sourceType) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Accounting export route not found.' } }));
      return;
    }
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Accounting export is read-only.' } }));
      return;
    }
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    handlers[sourceType]({ method: req.method, headers: req.headers, query }, responseAdapter(res));
  });

  let listening = false;
  let startPromise = null;
  let stopPromise = null;
  const start = () => {
    if (listening) return Promise.resolve(api);
    if (startPromise) return startPromise;
    startPromise = new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Fixture server did not expose a TCP address.'));
          return;
        }
        listening = true;
        api.address = address;
        api.baseUrl = `http://${ACCOUNTING_EXPORT_FIXTURE_HOST}:${address.port}`;
        resolve(api);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      // Host is deliberately constant: this harness must never bind LAN or
      // public interfaces, even if a caller supplies unrelated options.
      server.listen({ host: ACCOUNTING_EXPORT_FIXTURE_HOST, port: normalizePort(options.port) });
    }).finally(() => {
      startPromise = null;
    });
    return startPromise;
  };

  const stop = () => {
    if (stopPromise) return stopPromise;
    if (!listening && !server.listening) return Promise.resolve();
    stopPromise = new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        listening = false;
        api.address = null;
        api.baseUrl = null;
        resolve();
      });
    }).finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  };

  const api = {
    server,
    token,
    rows: fixtureRows,
    start,
    stop,
    address: null,
    baseUrl: null,
  };
  return api;
};

export const startAccountingExportFixtureServer = async (options = {}) => {
  const fixtureServer = createAccountingExportFixtureServer(options);
  await fixtureServer.start();
  return fixtureServer;
};
