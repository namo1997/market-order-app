import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { googleJwksFetch } from './google.mjs';

// Same receiving source as the snapshot, with ONLY database/auth adapters replaced.
// Do not import src/server.js: it loads dotenv, cron, and real integrations.
export async function loadApp(server, pool, { google = { enabled: false }, googleFetch = googleJwksFetch, now = Date.now, ocr = 'mock', ocrProvider } = {}) {
  if (!['mock', 'codex'].includes(ocr) || (ocr === 'codex' && typeof ocrProvider !== 'function')) throw new Error('Invalid pilot OCR configuration');
  const require = createRequire(`${server}/package.json`);
  const sessions = new Map();
  const denied = () => { throw new Error('PILOT_OUTBOUND_DISABLED'); };
  const authenticate = (req, res, next) => {
    const entry = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!entry || entry.expires <= now()) return res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
    req.user = { ...entry.user }; next();
  };
  const context = vm.createContext({
    // Never emit source error messages, stacks, SQL, payloads or signatures.
    console: { log() {}, info() {}, warn() {}, error() {} },
    Buffer, URL, URLSearchParams, Date, setTimeout, clearTimeout, AbortController, AbortSignal,
    TextEncoder, TextDecoder, fetch: denied,
    process: { env: { NODE_ENV: 'test', AUTO_ENSURE_RECEIVING_TABLES: 'true',
      RECEIVING_OCR_MODEL: 'SYNTHETIC-mock' } }
  });
  const modules = new Map();
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [k, value] of Object.entries(exports)) this.setExport(k, value);
  }, { context });
  async function moduleFor(id) {
    if (modules.has(id)) return modules.get(id);
    const pending = (async () => {
      if (id === `${server}/src/config/database.js`) return synthetic({ default: pool });
      if (id === `${server}/src/middleware/auth.js`) return synthetic({ authenticate });
      if (!path.isAbsolute(id)) {
        if (['dotenv', 'openai'].includes(id)) throw new Error('Forbidden pilot import');
        const native = ['express', 'jsonwebtoken'].includes(id) ? { default: require(id) } : await import(id);
        if (['http', 'https', 'node:http', 'node:https'].includes(id)) return synthetic({
          ...native, default: { ...native.default, request: denied, get: denied }, request: denied, get: denied
        });
        return synthetic(native);
      }
      if (!id.startsWith(`${server}/src/`)) throw new Error('Import outside snapshot source');
      return new vm.SourceTextModule(await readFile(id, 'utf8'), {
        context, identifier: id, initializeImportMeta(meta) { meta.url = pathToFileURL(id).href; }
      });
    })();
    modules.set(id, pending); return pending;
  }
  const entry = new vm.SourceTextModule(`
    export * as schema from './models/receiving-documents-schema.js';
    export * as order from './models/order.model.js';
    export * as inventory from './models/inventory.model.js';
    export * as ocr from './services/receiving-ocr.service.js';
    export * as googleId from './services/google-id-token.js';
    export * as googleAccounts from './models/google-accounts.model.js';
    export * as googleController from './controllers/google-auth.controller.js';
    export { default as router } from './routes/receiving-documents.routes.js';
  `, { context, identifier: `${server}/src/pilot-entry.js` });
  await entry.link((specifier, parent) => moduleFor(specifier.startsWith('.')
    ? path.resolve(path.dirname(parent.identifier), specifier) : specifier));
  await entry.evaluate();
  const source = entry.namespace;
  source.ocr.setCustomOcrProvider(ocrProvider || (async ({ document, expectedItems }) => ({
    model: 'SYNTHETIC-mock', supplier_name: document.supplier_name_text || 'SYNTHETIC supplier',
    doc_ref: `SYNTHETIC-${document.id}`, doc_date: document.delivery_date,
    subtotal: '25.00', discount: '0.00', vat: '0.00', total: '25.00', confidence: 1,
    lines: [{ bill_text: expectedItems[0]?.product_name || 'SYNTHETIC ผัก 01',
      unit_text: expectedItems[0]?.unit_name || 'กิโลกรัม', quantity_billed: '2.50',
      unit_price: '10.00', amount: '25.00', confidence: 1 }]
  })));
  const express = require('express');
  const app = express();
  app.disable('x-powered-by');
  const ok = (res, data) => res.json({ success: true, data });
  const fail = (res, code, status) => res.status(status).json({ success: false, code });
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const getUser = async id => {
    const [[row]] = await pool.query(`SELECT u.id,u.name,u.department_id,d.branch_id,
      d.name AS department,b.name AS branch FROM users u
      JOIN departments d ON d.id=u.department_id JOIN branches b ON b.id=d.branch_id WHERE u.id=?`, [id]);
    if (!row || ![1, 2].includes(Number(row.id))) return null;
    return { ...row, role: 'user', is_production_department: false, can_use_stock_check: false,
      can_view_stock_balance: false, can_view_product_group_orders: false, allowed_product_group_ids: [] };
  };
  const issueSession = user => {
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
    if (sessions.size >= 256) throw new source.googleId.GoogleAuthError(429, 'RATE_LIMITED');
    const token = randomUUID(); sessions.set(token, { user, expires: now() + 8 * 3600_000 });
    return token;
  };
  app.use((req, res, next) => {
    res.set('X-Solao-Pilot', 'SYNTHETIC');
    res.set('Cache-Control', 'no-store');
    // APK native transport does not require CORS; Capacitor WebView can use it too.
    const origin = req.headers.origin;
    if (['http://localhost', 'https://localhost', 'capacitor://localhost'].includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin); res.vary('Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (req, res) => ok(res, { pilot: 'SYNTHETIC', ocr, instance: path.basename(path.dirname(path.dirname(server))) }));
  app.get('/api/auth/branches', route(async (req, res) => ok(res, (await pool.query('SELECT * FROM branches ORDER BY id'))[0])));
  app.get('/api/auth/departments/:branchId', route(async (req, res) => ok(res,
    (await pool.query('SELECT * FROM departments WHERE branch_id=? ORDER BY id', [req.params.branchId]))[0])));
  app.get('/api/auth/line/super-admin/status', (req, res) => ok(res, { enabled: false }));
  app.get('/api/auth/google/status', (req, res) => ok(res, { enabled: google.enabled }));
  const googleHandlers = source.googleController.createGoogleAuthHandlers({
    verify: source.googleId.createGoogleIdTokenVerifier({ clientIds: () => google.enabled ? google.clientIds : '', fetcher: googleFetch, now }),
    store: source.googleAccounts.createGoogleAccountsStore(pool), getUserById: getUser,
    buildUserPayload: user => user, generateToken: issueSession,
  });
  app.post('/api/auth/google', source.googleController.googleLoginRateLimit({ now }), express.json({ limit: '20kb' }), googleHandlers.login);
  app.post('/api/auth/login', express.json({ limit: '8kb' }), route(async (req, res) => {
    const id = Number(req.body?.departmentId);
    if (![1, 2].includes(id)) return fail(res, 'VALIDATION_FAILED', 422);
    const user = await getUser(id);
    if (!user) return fail(res, 'UNAUTHORIZED', 401);
    // Opaque session lives in RAM only; no JWT secret, disk credential or real login.
    let token;
    try { token = issueSession(user); }
    catch (error) {
      if (error.code === 'RATE_LIMITED') return fail(res, 'RATE_LIMITED', 429);
      throw error;
    }
    ok(res, { token, user });
  }));
  app.get('/api/auth/me', authenticate, (req, res) => ok(res, req.user));
  app.use('/api/receiving-documents', source.router);
  app.use('/api/products', authenticate);
  app.get('/api/products/meta/product-groups', route(async (req, res) => ok(res, (await pool.query('SELECT * FROM product_groups ORDER BY id'))[0])));
  app.get('/api/products/meta/supplier-masters', (req, res) => ok(res, []));
  app.get('/api/products/meta/units', route(async (req, res) => ok(res, (await pool.query('SELECT * FROM units ORDER BY id'))[0])));
  app.get('/api/products', route(async (req, res) => ok(res, (await pool.query(`SELECT p.*,u.name AS unit_name,
    pg.name AS product_group_name FROM products p JOIN units u ON u.id=p.unit_id
    JOIN product_groups pg ON pg.id=p.product_group_id
    WHERE (? IS NULL OR p.product_group_id=?) AND p.name LIKE ? ORDER BY p.id`,
    [req.query.productGroupId || null, req.query.productGroupId || null, `%${String(req.query.search || '').slice(0, 100)}%`]))[0])));
  app.use((req, res) => fail(res, 'NOT_FOUND', 404));
  app.use((err, req, res, next) => fail(res, err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'PILOT_ERROR',
    err.type === 'entity.too.large' ? 413 : 500));
  return { app, source };
}
