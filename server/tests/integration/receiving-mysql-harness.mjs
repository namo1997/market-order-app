import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import mysql from 'mysql2/promise';
import { LEGACY_FIXTURE_DDL } from './legacy-receiving-schema.mjs';

export const FIXED_NOW = '2026-10-15T03:00:00.000Z';
export const DATE = '2026-10-15';
export const ACTORS = Object.fromEntries([1, 2, 3, 4].map(id => [id, {
  id, name: `IT user ${id}`, branch_id: 1, department_id: 1, role: 'user'
}]));
const serverRoot = fileURLToPath(new URL('../../', import.meta.url));

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return new Date(FIXED_NOW).getTime(); }
}

// Replace ONLY environment-owned database/auth adapters. Every receiving, order,
// inventory, route and controller implementation is loaded unchanged at its path.
// Authentication is fixture identity injection, not a JWT/auth acceptance test.
export async function loadReceivingSourceModules(pool) {
  const context = vm.createContext({
    console, Buffer, URL, URLSearchParams, Date: FixedDate, setTimeout, clearTimeout,
    AbortController, TextEncoder, TextDecoder,
    process: { env: { NODE_ENV: 'test', AUTO_ENSURE_RECEIVING_TABLES: 'true' } },
    fetch: () => { throw new Error('Network/AI calls are forbidden in MySQL integration'); }
  });
  const modules = new Map();
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  async function moduleFor(id) {
    if (modules.has(id)) return modules.get(id);
    // Store promises to avoid duplicate reads during cyclic graph linking.
    const pending = (async () => {
      if (id === `${serverRoot}src/config/database.js`) return synthetic({ default: pool });
      if (id === `${serverRoot}src/middleware/auth.js`) return synthetic({
        authenticate(req, res, next) {
          const actor = ACTORS[req.itActor];
          if (!actor) return res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
          req.user = { ...actor };
          return next();
        }
      });
      if (!path.isAbsolute(id)) {
        if (id === 'dotenv') throw new Error('dotenv loading forbidden');
        const native = await import(id);
        // Stop accidental outbound requests from legacy notification dependencies.
        if (['https', 'http', 'node:https', 'node:http'].includes(id)) {
          const blocked = () => { throw new Error('Outbound network forbidden'); };
          return synthetic({ ...native, default: { ...native.default, request: blocked, get: blocked },
            request: blocked, get: blocked });
        }
        return synthetic(native);
      }
      if (!id.startsWith(`${serverRoot}src/`)) throw new Error('Import outside source tree');
      return new vm.SourceTextModule(await readFile(id, 'utf8'), {
        context, identifier: id,
        initializeImportMeta(meta) { meta.url = pathToFileURL(id).href; }
      });
    })();
    modules.set(id, pending);
    return pending;
  }
  const root = new vm.SourceTextModule(`
    export * as model from './models/receiving-documents.model.js';
    export * as schema from './models/receiving-documents-schema.js';
    export * as order from './models/order.model.js';
    export * as inventory from './models/inventory.model.js';
    export * as ocr from './services/receiving-ocr.service.js';
    export { default as router } from './routes/receiving-documents.routes.js';
    export { default as legacyRouter } from './routes/orders.routes.js';
  `, { context, identifier: `${serverRoot}src/integration-entry.js` });
  await root.link((specifier, referring) => moduleFor(specifier.startsWith('.')
    ? path.resolve(path.dirname(referring.identifier), specifier) : specifier));
  await root.evaluate();
  return root.namespace;
}

export async function openHarness() {
  const socket = process.env.RECEIVING_IT_MYSQL_SOCKET;
  const database = process.env.RECEIVING_IT_MYSQL_DATABASE || 'receiving_it';
  assert.match(socket || '', /^\/Volumes\/SSD Files\/SOLAO\/market-order-system\/runs\/mysql-it-[^/]+\/m\.sock$/);
  assert.equal(database, 'receiving_it', 'Only disposable integration schema is allowed');
  assert.equal(await realpath(path.dirname(socket)), path.dirname(socket));
  const raw = mysql.createPool({ socketPath: socket, user: 'root', database,
    connectionLimit: 8, waitForConnections: true, connectTimeout: 2000, timezone: 'Z' });
  raw.on('connection', c => {
    c.query("SET SESSION time_zone = '+00:00'");
    c.query(`SET SESSION timestamp = ${Date.parse(FIXED_NOW) / 1000}`);
    c.query('SET SESSION innodb_lock_wait_timeout = 5');
  });
  try {
    const [[identity]] = await raw.query('SELECT @@datadir AS datadir, @@skip_networking AS skip_networking, VERSION() AS version, DATABASE() AS db');
    assert.equal(path.resolve(identity.datadir), `${path.dirname(socket)}/data`);
    assert.equal(Number(identity.skip_networking), 1);
    assert.equal(identity.db, database);
    assert.match(identity.version, /^9\.5\./);
    let gate = null;
    const sqlErrors = [];
    const activeIds = new Set();
    const observeError = e => { sqlErrors.push(e.code); throw e; };
    const pool = {
      query: (...args) => raw.query(...args).catch(observeError),
      async getConnection() {
        const c = await raw.getConnection();
        return {
          async query(sql, params) {
            if (gate && gate.match.test(sql)) await gate.arrive(c.threadId);
            return c.query(sql, params).catch(observeError);
          },
          async beginTransaction() { activeIds.add(c.threadId); return c.beginTransaction(); },
          commit: () => c.commit(), rollback: () => c.rollback(), release: () => c.release()
        };
      }
    };
    const app = await loadReceivingSourceModules(pool);
    // Even custom-provider code runs with an explicit mock; no keys are read.
    app.ocr.setCustomOcrProvider(async () => { throw new Error('Unexpected OCR in SQL test'); });
    return {
      raw, app, identity, sqlErrors, activeIds,
      async setup() {
        for (const ddl of LEGACY_FIXTURE_DDL) await raw.query(ddl);
        await app.order.ensureOrderReceivingColumns();
        await app.inventory.ensureInventoryTables();
        await app.schema.ensureReceivingDocumentsTables(pool, { force: true });
      },
      async reset() {
        for (const table of [
          'receiving_document_audits', 'supplier_product_alias_events', 'supplier_product_aliases',
          'receiving_document_images', 'receiving_document_lines', 'receiving_documents',
          'inventory_transactions', 'inventory_balance', 'order_items', 'orders', 'product_group_links',
          'products', 'product_groups', 'users', 'departments', 'branches', 'units'
        ]) await raw.query(`DELETE FROM ${table}`); // Closed, code-owned identifier list.
        await raw.query("INSERT INTO branches (id,name,code) VALUES (1,'IT branch','IT')");
        await raw.query("INSERT INTO departments (id,branch_id,name) VALUES (1,1,'IT department')");
        for (const actor of Object.values(ACTORS)) {
          await raw.query('INSERT INTO users (id,department_id,name) VALUES (?,1,?)', [actor.id, actor.name]);
        }
        await raw.query("INSERT INTO units (id,name,abbreviation) VALUES (1,'kg','kg')");
        await raw.query("INSERT INTO product_groups (id,name,code) VALUES (1,'IT supplier','IT-SUP')");
        for (const id of [1, 2]) {
          await raw.query('INSERT INTO products (id,name,code,unit_id,product_group_id,default_price) VALUES (?,?,?,1,1,10)',
            [id, `IT product ${id}`, `IT-${id}`]);
          await raw.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,1,true)', [id]);
        }
        activeIds.clear(); sqlErrors.length = 0;
      },
      async concurrent(match, work) {
        assert.equal(gate, null);
        const ids = new Set();
        let release;
        const ready = new Promise(resolve => { release = resolve; });
        const timer = setTimeout(() => release(), 10000);
        gate = { match, async arrive(id) {
          ids.add(id);
          if (ids.size === 2) release();
          await ready;
          assert.equal(ids.size, 2, 'Both real connections must reach SQL barrier');
        } };
        try { const value = await work(); assert.equal(ids.size, 2); return value; }
        finally { clearTimeout(timer); gate = null; }
      },
      request(method, url, body = {}, actor = 1) {
        const legacy = url.startsWith('/api/orders');
        const prefix = legacy ? '/api/orders' : '/api/receiving-documents';
        const parsed = new URL(url, 'http://integration.invalid');
        // Invoke actual Express router in process: no TCP listener or auth tokens.
        return new Promise((resolve, reject) => {
          const req = { method, url: parsed.pathname.slice(prefix.length) + parsed.search || '/',
            originalUrl: url, headers: {}, query: Object.fromEntries(parsed.searchParams),
            body, _body: true, itActor: actor, baseUrl: prefix };
          const res = { statusCode: 200, headers: {},
            status(code) { this.statusCode = code; return this; },
            set(k, v) { this.headers[k] = v; return this; },
            json(value) { resolve({ status: this.statusCode, body: value }); return this; },
            send(value) { resolve({ status: this.statusCode, body: value, headers: this.headers }); return this; }
          };
          (legacy ? app.legacyRouter : app.router).handle(req, res, error =>
            reject(error || new Error(`Unmatched route ${method} ${url}`)));
        });
      },
      close: () => raw.end()
    };
  } catch (e) { await raw.end(); throw e; }
}
