import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as crypto from 'node:crypto';
const root = fileURLToPath(new URL('../../src/', import.meta.url));
export async function productModules(db) {
  const context = vm.createContext({ console: { error() {}, warn() {} }, Buffer, process: { env: {} } });
  const modules = new Map();
  const synth = exports => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
  }, { context });
  async function load(id) {
    if (modules.has(id)) return modules.get(id);
    const pending = (async () => {
      if (id.endsWith('/config/database.js')) return synth({ default: db });
      if (id === 'node:crypto') return synth(crypto);
      if (!id.startsWith(root)) throw new Error(`Forbidden test import ${id}`);
      return new vm.SourceTextModule(await readFile(id, 'utf8'), { context, identifier: id });
    })();
    modules.set(id, pending); return pending;
  }
  const entry = new vm.SourceTextModule(`export * as model from './models/receiving-supplier-products.model.js';
    export * as catalog from './models/receiving-supplier-catalog.js';
    export * as departments from './models/department-products.model.js';
    export * as products from './models/product.model.js';
    export * as stock from './models/stock-check.model.js';`, { context, identifier: path.join(root, 'test-entry.js') });
  await entry.link((spec, parent) => load(spec.startsWith('.') ? path.resolve(path.dirname(parent.identifier), spec) : spec));
  await entry.evaluate(); return entry.namespace;
}
export function productDb() {
  const state = { products: [], aliases: [], departments: [], stock: [], audits: [], imports: [], links: [], masterLinks: [], queries: [], next: 10, fail: '' };
  const units = [{ id: 1, name: 'แผง', abbreviation: 'ผ.' }];
  const groups = [{ id: 1, name: 'กลุ่มทดสอบ', code: 'SYN-G1', is_active: 1 }];
  const suppliers = [{ id: 1, name: 'กลุ่มทดสอบ', code: 'SYN-S1', is_active: 1 }];
  const deps = [{ id: 1, name: 'ครัว', branch_id: 1, branch_name: 'สาขาทดสอบ' }];
  const scopes = [];
  const aliasView = a => ({ ...a, product_name: state.products.find(p => p.id === a.product_id)?.name });
  async function query(sql, args = []) {
    const q = sql.replace(/\s+/g, ' ').trim(); state.queries.push({ q, args });
    if (state.fail && q.includes(state.fail)) throw new Error('SYNTHETIC SQL internal failure');
    if (q === "SHOW COLUMNS FROM products LIKE 'supplier_id'") return [[]];
    if (q.startsWith('SHOW')) return [[{ exists: 1 }]];
    if (q.startsWith('CREATE') || q.startsWith('ALTER') || q.startsWith('INSERT IGNORE')) return [{}];
    if (q.startsWith('SELECT id, branch_id FROM departments')) return [deps.filter(d => d.id === args[0])];
    if (q.startsWith('SELECT sm.id, sm.name FROM supplier_masters')) return [suppliers.filter(s => s.id === args[0])];
    if (q.startsWith('SELECT COUNT(*) AS total FROM information_schema')) return [[{ total: 1 }]];
    if (q.startsWith('SELECT product_id FROM department_products')) return [state.departments.filter(d => d[0] === args[0]).map(d => ({ product_id: d[1] }))];
    // Owner 2026-10-24: suggestions = history/alias first, then products linked to the shop (master link rows are [product_id, supplier_master_id]).
    if (q.startsWith('SELECT x.id, x.name')) { const master = Number(args[3]); const used = p => state.aliases.some(a => a.product_id === p.id && a.supplier_key === args[0]);
      const listed = p => state.masterLinks.some(link => Number(link[0]) === p.id && Number(link[1]) === master);
      return [state.products.filter(p => used(p) || listed(p)).sort((a, b) => Number(used(b)) - Number(used(a))).map(p => ({ ...p, unit_name: units[0].name }))]; }
    if (q.startsWith('SELECT p.id, p.name, p.unit_id, u.name AS unit_name FROM products p')) return [state.products.filter(p => state.aliases.some(a => a.product_id === p.id && a.supplier_key === args[2])).map(p => ({ ...p, unit_name: units[0].name }))];
    if (q.startsWith('SELECT p.id, p.name, p.code, p.barcode, p.qr_code, p.unit_id')) return [state.products.filter(p => p.name.includes(args[0].slice(1, -1))).map(p => ({ ...p, unit_name: units[0].name }))];
    if (q.startsWith('SELECT p.id, p.name, p.code, p.supplier_item_id')) return [state.products];
    if (q.startsWith('SELECT st.id, st.department_id')) return [state.stock.filter(s => s[0] === args[0]).map(s => ({ product_id: s[1], product_name: state.products.find(p => p.id === s[1]).name }))];
    if (q.startsWith('SELECT sm.id, sm.code')) return [suppliers.filter(s => s.id === args[0])];
    if (q.startsWith('SELECT pg.id, pg.code')) return [groups.filter(g => g.id === args[0])];
    if (q.startsWith('SELECT sm.id AS master_id')) return [[{ master_id: 1, group_id: 1 }]];
    if (q.startsWith('SELECT id, name, abbreviation')) return [units];
    if (q.startsWith('SELECT id, name, code FROM product_groups')) return [groups];
    if (q.startsWith('SELECT d.id, d.name')) return [deps];
    if (q.startsWith('SELECT product_group_id, branch_id')) return [scopes];
    if (q.startsWith('SELECT id, name FROM products')) return [state.products];
    if (q.startsWith('SELECT id FROM supplier_masters WHERE id = ? FOR UPDATE') || q.startsWith('SELECT id FROM product_groups WHERE id = ? FOR UPDATE')) return [[{ id: args[0] }]];
    if (q.startsWith('SELECT actor_user_id, supplier_key')) return [state.imports.filter(i => i.request_id === args[0])];
    if (q.startsWith('SELECT supplier_key, normalized_bill_text')) return [state.aliases.filter(a => args[0].includes(a.supplier_key))];
    if (q.startsWith('SELECT id FROM product_groups WHERE is_active')) return [groups.filter(g => args[0].includes(g.id))];
    if (q.startsWith('SELECT id FROM supplier_masters WHERE is_active')) return [suppliers.filter(g => args[0].includes(g.id))];
    if (q.startsWith('INSERT INTO products')) {
      const [name, code, , , , , price, countable, carryover, unit_id, product_group_id, supplier_master_id] = args;
      const id = ++state.next; state.products.push({ id, name, code, default_price: price, is_countable: countable, allow_pending_carryover: carryover, unit_id, product_group_id, supplier_master_id, is_active: 1 });
      return [{ insertId: id }];
    }
    if (q.startsWith('DELETE FROM product_group_links') || q.startsWith('DELETE FROM product_supplier_master_links')) return [{}];
    if (q.startsWith('INSERT INTO product_group_links')) { state.links.push(...args[0]); return [{}]; }
    if (q.startsWith('INSERT INTO product_supplier_master_links')) { state.masterLinks.push(...args[0]); return [{}]; }
    if (q.startsWith('SELECT id, is_active FROM department_products')) return [[]];
    if (q.startsWith('INSERT INTO department_products')) { state.departments.push(args); return [{ insertId: 1 }]; }
    if (q.startsWith('SELECT id, daily_required')) return [[]];
    if (q.startsWith('INSERT INTO stock_templates')) { state.stock.push(args); return [{ insertId: 1 }]; }
    if (q.startsWith('SELECT p.id, p.name, p.unit_id FROM products')) return [state.products.filter(p => p.id === args[0])];
    if (q.startsWith('SELECT id FROM supplier_product_aliases') || q.startsWith('SELECT a.id FROM supplier_product_aliases')) return [[]];
    if (q.startsWith('INSERT INTO supplier_product_aliases')) {
      const [supplier_key, supplier_master_id, product_group_id, , bill_text, normalized_bill_text, unit_text, normalized_unit_text, product_id, unit_id, , item_code] = args;
      const id = state.aliases.length + 1;
      state.aliases.push({ id, supplier_key, supplier_master_id, product_group_id, bill_text, normalized_bill_text, unit_text, normalized_unit_text, product_id, unit_id, item_code, confirm_count: 1, is_active: 1 });
      return [{ insertId: id }];
    }
    if (q.startsWith('SELECT a.id, a.supplier_key')) return [state.aliases.filter(a => a.id === args[0]).map(aliasView)];
    if (q.startsWith('INSERT INTO receiving_supplier_admin_audits')) { state.audits.push(args); return [{}]; }
    if (q.startsWith('INSERT INTO receiving_supplier_product_imports')) { const [request_id, supplier_key, actor_user_id, fingerprint, result_json] = args; state.imports.push({ request_id, supplier_key, actor_user_id, fingerprint, result_json }); return [{}]; }
    throw new Error(`Unhandled fixture SQL: ${q}`);
  }
  let tail = Promise.resolve();
  return { state, units, groups, suppliers, deps, scopes, query, async getConnection() {
    let snapshot, unlock;
    return { query, async beginTransaction() {
      const prior = tail; tail = new Promise(r => { unlock = r; }); await prior;
      snapshot = structuredClone(Object.fromEntries(Object.entries(state).filter(([k]) => !['queries', 'fail'].includes(k))));
    }, async commit() { snapshot = null; unlock(); }, async rollback() { if (snapshot) Object.assign(state, snapshot); unlock(); }, release() {} };
  } };
}
