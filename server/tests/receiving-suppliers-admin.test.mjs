import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import express from 'express';
import * as model from '../src/models/receiving-suppliers-admin.model.js';
import * as ocr from '../src/services/receiving-ocr.service.js';
import { expressRequest } from './helpers/express-request.mjs';
import { createReceivingHarness, makeJpegDataUrl, read } from './helpers/receiving-fake-db.mjs';
import { fetchSupplierConfirmedAliases } from '../src/models/receiving-documents-alias.js';

const roles = ['admin', 'super_admin', 'accounting', 'accountant'];
const norm = sql => sql.replace(/\s+/g, ' ').trim();

// Stateful in-memory stand-in for exactly the SQL this feature issues. Transactions
// snapshot/restore state so rollback behaviour is real, not assumed.
function createDb() {
  const state = {
    masters: [{ id: 1, code: 'SYN-SM-1', name: 'ร้านทดสอบ A', is_active: 1 }],
    groups: [{ id: 2, code: 'SYN-PG-2', name: 'กลุ่มทดสอบ B', is_active: 1 }, { id: 3, code: 'SYN-PG-3', name: 'ร้าน 100%_ตรง', is_active: 0 }],
    products: [{ id: 10, name: 'อกไก่', code: 'P10', unit_id: 1, is_active: 1 }, { id: 11, name: 'ขา B', code: 'P11', unit_id: 1, is_active: 1 },
      { id: 12, name: 'ปิดใช้งาน', code: 'P12', unit_id: 1, is_active: 0 }],
    links: [{ product_id: 10, supplier_master_id: 1 }],
    units: [{ id: 1, name: 'กก.' }],
    users: [{ id: 12, name: 'บัญชีทดสอบ' }],
    aliases: [
      { id: 1, supplier_key: 'sm:1', bill_text: 'ต.ไก่', normalized_bill_text: 'ต ไก่', unit_text: 'กก.', normalized_unit_text: 'กก', product_id: 10,
        unit_multiplier: '1.0000', last_unit_price: '80.000000', confirm_count: 3, is_active: 1, updated_at: new Date('2026-10-18T05:00:00Z'), updated_by_user_id: 12 },
      { id: 2, supplier_key: 'sm:1', bill_text: 'ทB', normalized_bill_text: 'ทb', unit_text: '', normalized_unit_text: '', product_id: 11,
        unit_multiplier: '1.0000', last_unit_price: null, confirm_count: 1, is_active: 0, updated_at: new Date('2026-10-18T06:00:00Z'), updated_by_user_id: null },
      { id: 3, supplier_key: 'pg:2', bill_text: 'อื่น', normalized_bill_text: 'อื่น', unit_text: '', normalized_unit_text: '', product_id: 11,
        unit_multiplier: '1.0000', last_unit_price: null, confirm_count: 1, is_active: 1, updated_at: new Date('2026-10-18T06:00:00Z'), updated_by_user_id: null }],
    profiles: [{ supplier_key: 'sm:1', ordering_mode: 'system', branches_note: 'ทุกสาขา', bill_format_note: 'ใบส่งของเขียนมือ', ordering_note: null, updated_at: new Date('2026-10-18T05:00:00Z') }],
    branchCodes: [], audits: [], docs: [{ supplier_key: 'sm:1', branch_id: 2, branch_name: 'สาขาสอง' }, { supplier_key: 'sm:1', branch_id: 1, branch_name: 'สาขาหนึ่ง' }],
    nextAlias: 10, nextAudit: 1, sql: [], failAudit: false
  };
  const product = id => state.products.find(row => row.id === Number(id));
  const aliasRow = row => row && ({ ...row, product_name: product(row.product_id)?.name ?? null,
    unit_name: state.units.find(unit => unit.id === product(row.product_id)?.unit_id)?.name ?? null,
    updated_by_name: state.users.find(user => user.id === row.updated_by_user_id)?.name ?? null });
  let snapshot = null;
  async function query(sql, params = []) {
    const q = norm(sql);
    state.sql.push({ q, params });
    if (/^(CREATE|SHOW|ALTER)/.test(q)) return [[]];
    if (q.startsWith('SELECT sm.id, sm.code, sm.name, sm.is_active FROM supplier_masters')) return [state.masters.filter(row => row.id === params[0])];
    if (q.startsWith('SELECT pg.id, pg.code, pg.name, pg.is_active FROM product_groups')) return [state.groups.filter(row => row.id === params[0])];
    if (/^SELECT sm\.id AS master_id, pg\.id AS group_id/.test(q)) {
      const out = [];
      for (const master of state.masters.filter(row => row.is_active && row.name.trim())) {
        for (const group of state.groups.filter(row => row.name.trim() === master.name.trim())) out.push({ master_id: master.id, group_id: group.id, group_name: group.name, group_code: group.code });
      }
      return [out];
    }
    if (q.startsWith('SELECT DISTINCT supplier_key FROM receiving_supplier_branch_codes')) {
      return [[...new Set(state.branchCodes.filter(row => row.is_active && (row.supplier_code.includes(params[0]) || String(row.branch_note || '').includes(params[1]))).map(row => row.supplier_key))].map(supplier_key => ({ supplier_key }))];
    }
    if (q.startsWith('SELECT supplier_key, supplier_code, branch_note FROM receiving_supplier_branch_codes')) {
      return [state.branchCodes.filter(row => row.is_active && params.includes(row.supplier_key)).sort((a, b) => a.supplier_code.localeCompare(b.supplier_code))];
    }
    if (q.startsWith('SELECT supplier_code, branch_note, is_active FROM receiving_supplier_branch_codes')) {
      return [state.branchCodes.filter(row => row.supplier_key === params[0]).sort((a, b) => a.supplier_code.localeCompare(b.supplier_code))];
    }
    if (q.startsWith('UPDATE receiving_supplier_branch_codes SET is_active = 0')) {
      Object.assign(state.branchCodes.find(row => row.supplier_key === params[1] && row.supplier_code === params[2]), { is_active: 0 });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO receiving_supplier_branch_codes')) {
      const [supplier_key, supplier_code, branch_note] = params;
      const old = state.branchCodes.find(row => row.supplier_key === supplier_key && row.supplier_code === supplier_code);
      if (old) Object.assign(old, { branch_note, is_active: 1 }); else state.branchCodes.push({ supplier_key, supplier_code, branch_note, is_active: 1 });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT supplier_key, kind, id, code, name, is_active FROM (')) {
      let list = [...state.masters.map(row => ({ ...row, supplier_key: `sm:${row.id}`, kind: 'master' })),
        ...state.groups.map(row => ({ ...row, supplier_key: `pg:${row.id}`, kind: 'group' }))];
      const values = [...params]; values.pop();
      const marks = text => (text.match(/\?/g) || []).length;
      if (q.includes('kind = ?')) { const kind = values.shift(); list = list.filter(row => row.kind === kind); }
      if (q.includes("NOT (kind = 'group' AND id IN (")) {
        const hidden = values.splice(0, marks(/NOT \(kind = 'group' AND id IN \(([^)]*)\)/.exec(q)[1]));
        list = list.filter(row => !(row.kind === 'group' && hidden.includes(row.id)));
      }
      if (q.includes('LOCATE(?, name)')) {
        const [needle] = values.splice(0, 2), extra = values.splice(0, q.includes('OR supplier_key IN (') ? marks(/OR supplier_key IN \(([^)]*)\)/.exec(q)[1]) : 0);
        list = list.filter(row => row.name.includes(needle) || String(row.code || '').includes(needle) || extra.includes(row.supplier_key));
      }
      return [list.sort((a, b) => (b.kind === 'master') - (a.kind === 'master') || a.name.localeCompare(b.name))];
    }
    if (q.includes('FROM receiving_supplier_profiles WHERE supplier_key IN')) return [state.profiles.filter(row => params.includes(row.supplier_key))];
    if (q.includes('FROM receiving_supplier_profiles WHERE supplier_key = ?')) return [state.profiles.filter(row => row.supplier_key === params[0])];
    if (q.startsWith('SELECT supplier_key, normalized_bill_text, normalized_unit_text, product_id, is_active FROM supplier_product_aliases WHERE supplier_key IN')) {
      return [state.aliases.filter(row => params.includes(row.supplier_key))];
    }
    if (q.includes('FROM receiving_documents rd LEFT JOIN branches')) return [state.docs.filter(row => params.includes(row.supplier_key))];
    if (q.startsWith('SELECT p.id, p.name, p.unit_id FROM products p')) return [state.products.filter(row => row.id === params[0] && row.is_active)];
    if (q.startsWith('SELECT p.id, p.name, p.code, u.name AS unit_name,')) {
      const needle = q.includes('LOCATE(?, p.name)') ? params.at(-2) : '';
      return [state.products.filter(row => row.is_active && (!needle || row.name.includes(needle) || row.code.includes(needle))).map(row => ({
        ...row, unit_name: 'กก.', is_supplier_product: state.links.some(link => link.product_id === row.id && link.supplier_master_id === params[0]) ? 1 : 0 }))];
    }
    if (q.startsWith('SELECT a.id, a.supplier_key')) {
      if (q.includes('WHERE a.id = ? LIMIT 1')) return [state.aliases.filter(row => row.id === params[0]).map(aliasRow)];
      if (q.includes('WHERE a.id = ? AND a.supplier_key IN (') && q.endsWith('FOR UPDATE')) return [state.aliases.filter(row => row.id === params[0] && params.slice(1).includes(row.supplier_key)).map(aliasRow)];
      if (q.includes('AND a.normalized_bill_text = ?')) {
        const [bill, unit, productId] = params.slice(-3), keys = params.slice(0, -3);
        return [state.aliases.filter(row => keys.includes(row.supplier_key) && row.normalized_bill_text === bill && row.normalized_unit_text === unit && row.product_id === productId).map(aliasRow)];
      }
      return [state.aliases.filter(row => params.includes(row.supplier_key)).sort((a, b) => a.normalized_bill_text.localeCompare(b.normalized_bill_text) || a.normalized_unit_text.localeCompare(b.normalized_unit_text) || a.id - b.id).map(aliasRow)];
    }
    if (q.startsWith('SELECT id FROM supplier_product_aliases WHERE supplier_key IN')) {
      const keyCount = (/supplier_key IN \(([^)]*)\)/.exec(q)[1].match(/\?/g) || []).length, keys = params.slice(0, keyCount);
      const [bill, unit] = params.slice(keyCount, keyCount + 2), except = params.slice(keyCount + 2);
      return [state.aliases.filter(row => keys.includes(row.supplier_key) && row.normalized_bill_text === bill && row.normalized_unit_text === unit && !except.includes(row.id))];
    }
    if (q.startsWith('SELECT id, alias_id, action')) return [state.audits.filter(row => params.includes(row.supplier_key)).sort((a, b) => b.id - a.id)];
    if (q.startsWith('INSERT INTO supplier_product_aliases')) {
      const [supplier_key, supplier_master_id, product_group_id, supplier_name_text, bill_text, normalized_bill_text, unit_text, normalized_unit_text, product_id, unit_id, updated_by_user_id] = params;
      if (state.aliases.some(row => row.supplier_key === supplier_key && row.normalized_bill_text === normalized_bill_text && row.normalized_unit_text === normalized_unit_text)) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
      const row = { id: state.nextAlias++, supplier_key, supplier_master_id, product_group_id, supplier_name_text, bill_text, normalized_bill_text, unit_text,
        normalized_unit_text, product_id, unit_id, unit_multiplier: '1.0000', last_unit_price: null, confirm_count: 1, is_active: 1,
        updated_at: new Date('2026-10-20T00:00:00Z'), updated_by_user_id };
      state.aliases.push(row); return [{ insertId: row.id }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET bill_text')) {
      const row = state.aliases.find(item => item.id === params[10] && item.supplier_key === params[11]);
      Object.assign(row, { bill_text: params[0], normalized_bill_text: params[1], unit_text: params[2], normalized_unit_text: params[3], product_id: params[4],
        unit_id: params[5], unit_multiplier: params[6], candidate_product_id: params[7], candidate_confirm_count: params[8], updated_by_user_id: params[9] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE supplier_product_aliases SET is_active')) {
      Object.assign(state.aliases.find(row => row.id === params[2] && row.supplier_key === params[3]), { is_active: params[0], updated_by_user_id: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO receiving_supplier_admin_audits')) {
      if (state.failAudit) throw new Error('audit write failed: secret SQL detail');
      const [supplier_key, alias_id, action, actor_user_id, actor_name, actor_role, before_json, after_json] = params;
      state.audits.push({ id: state.nextAudit++, supplier_key, alias_id, action, actor_user_id, actor_name, actor_role, before_json, after_json, created_at: new Date('2026-10-20T01:00:00Z') });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO receiving_supplier_profiles')) {
      const [supplier_key, ordering_mode, branches_note, bill_format_note, ordering_note] = params;
      const next = { supplier_key, ordering_mode, branches_note, bill_format_note, ordering_note, updated_at: new Date('2026-10-20T00:00:00Z') };
      const at = state.profiles.findIndex(row => row.supplier_key === supplier_key);
      if (at >= 0) state.profiles[at] = next; else state.profiles.push(next);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${q.slice(0, 120)}`);
  }
  const connection = { query,
    async beginTransaction() { snapshot = structuredClone({ aliases: state.aliases, profiles: state.profiles, audits: state.audits, branchCodes: state.branchCodes }); },
    async commit() { snapshot = null; },
    async rollback() { if (snapshot) Object.assign(state, structuredClone(snapshot)); snapshot = null; },
    release() {} };
  return { state, query, async getConnection() { return connection; } };
}

async function api(db = createDb()) {
  const context = vm.createContext({ console: { error() {}, log() {} }, Buffer, process: { env: {} } });
  const retained = [];
  const synth = values => { const mod = new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context }); retained.push(mod); return mod; };
  const src = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const ensured = { count: 0 };
  const errors = new vm.SourceTextModule(await src('controllers/receiving-documents.controller.js'), { context });
  await errors.link(name => synth(name.endsWith('/receiving-ocr.service.js') ? ocr : {})); await errors.evaluate();
  const controller = new vm.SourceTextModule(await src('controllers/receiving-suppliers-admin.controller.js'), { context });
  await controller.link(name => name.endsWith('/database.js') ? synth({ default: db })
    : name.endsWith('/receiving-suppliers-admin.model.js') ? synth(model)
      : name.endsWith('/receiving-documents-schema.js') ? synth({ ensureReceivingDocumentsTables: async () => { ensured.count++; } }) : errors);
  await controller.evaluate();
  const auth = new vm.SourceTextModule(await src('middleware/auth.js'), { context });
  await auth.link(() => synth({ verifyToken: value => {
    if (!roles.includes(value) && value !== 'user') throw new Error('Fixture invalid');
    return { id: 12, name: 'บัญชีทดสอบ', role: value, branch_id: 1, department_id: 10 };
  } })); await auth.evaluate();
  const router = new vm.SourceTextModule(await src('routes/receiving-admin.routes.js'), { context });
  const noop = (_req, res) => res.status(204).end();
  await router.link(name => name === 'express' ? synth({ default: express }) : name.endsWith('/middleware/auth.js') ? auth
    : name.endsWith('/receiving-suppliers-admin.controller.js') ? controller
      : synth({ list: noop, options: noop, detail: noop, issuesSummary: noop }));
  await router.evaluate();
  const app = express(); app.use('/api/receiving-admin', router.namespace.default);
  const call = async (path, { role, method = 'GET', body, raw } = {}) => {
    const response = await expressRequest(app, `/api/receiving-admin${path}`, { method,
      headers: { ...(role ? { authorization: `Bearer ${role}` } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
  };
  return { call, db, ensured, retained };
}
const sqlCount = h => h.db.state.sql.length;
const lastAudit = h => h.db.state.audits.at(-1);

afterEach(() => ocr.setCustomOcrProvider(null));

test('suppliers admin API: absent/invalid sessions get 401 and non-accounting roles get 403 on every route with zero SQL and no schema ensure', async () => {
  const h = await api();
  const routes = [['GET', '/suppliers'], ['GET', '/suppliers/sm:1'], ['GET', '/suppliers/sm:1/product-search?q=ก'],
    ['PUT', '/suppliers/sm:1/profile', { ordering_mode: 'mixed' }], ['POST', '/suppliers/sm:1/aliases', { bill_text: 'x', product_id: 10 }],
    ['PUT', '/suppliers/sm:1/aliases/1', { bill_text: 'y' }], ['POST', '/suppliers/sm:1/aliases/1/disable'], ['POST', '/suppliers/sm:1/aliases/1/enable']];
  for (const [method, path, body] of routes) {
    for (const role of [undefined, 'invalid', 'expired']) assert.equal((await h.call(path, { role, method, body })).status, 401, `${method} ${path}`);
    const denied = await h.call(path, { role: 'user', method, body });
    assert.equal(denied.status, 403, `${method} ${path}`); assert.equal(denied.body.code, 'FORBIDDEN');
  }
  assert.equal(sqlCount(h), 0); assert.equal(h.ensured.count, 0); assert.equal(h.db.state.audits.length, 0);
});

test('suppliers admin API: all four roles list suppliers with ordering mode, branches, alias counts; private response and literal search', async () => {
  const h = await api();
  for (const role of roles) {
    const list = await h.call('/suppliers', { role });
    assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'private, no-store');
    const [a, b] = list.body.data.items;
    assert.deepEqual([a.supplier_key, a.kind, a.code, a.name, a.ordering_mode, a.bill_format_note], ['sm:1', 'master', 'SYN-SM-1', 'ร้านทดสอบ A', 'system', 'ใบส่งของเขียนมือ']);
    assert.deepEqual(a.branches_seen, ['สาขาสอง', 'สาขาหนึ่ง']); assert.equal(a.alias_active_count, 1); assert.equal(a.alias_disabled_count, 1);
    assert.equal(b.supplier_key, 'pg:2'); assert.equal(b.ordering_mode, null); assert.equal(b.alias_active_count, 1);
    assert.deepEqual(list.body.data.ordering_modes, ['system', 'walk_in_phone', 'mixed']);
  }
  assert.equal(h.ensured.count, 4);
  assert.deepEqual((await h.call('/suppliers?kind=master', { role: 'admin' })).body.data.items.map(i => i.supplier_key), ['sm:1']);
  assert.deepEqual((await h.call(`/suppliers?q=${encodeURIComponent('ทดสอบ')}`, { role: 'admin' })).body.data.items.map(i => i.supplier_key), ['sm:1', 'pg:2']);
  // % and _ are literal characters, never SQL wildcards.
  assert.deepEqual((await h.call(`/suppliers?q=${encodeURIComponent('%')}`, { role: 'admin' })).body.data.items.map(i => i.supplier_key), ['pg:3']);
  assert.equal((await h.call('/suppliers?kind=bad', { role: 'admin' })).status, 422);
  assert.equal((await h.call(`/suppliers?q=${'ก'.repeat(101)}`, { role: 'admin' })).status, 422);
  assert.equal((await h.call('/suppliers?q=a&q=b', { role: 'admin' })).status, 422);
});

test('suppliers admin API: detail returns all aliases (including disabled), audits and decimal strings; bad key 422 before SQL, unknown 404', async () => {
  const h = await api();
  const detail = (await h.call('/suppliers/sm:1', { role: 'accountant' })).body.data;
  assert.equal(detail.name, 'ร้านทดสอบ A'); assert.equal(detail.branches_note, 'ทุกสาขา'); assert.deepEqual(detail.branches_seen, ['สาขาสอง', 'สาขาหนึ่ง']);
  assert.deepEqual(detail.aliases.map(a => [a.id, a.bill_text, a.product_name, a.is_active]), [[1, 'ต.ไก่', 'อกไก่', true], [2, 'ทB', 'ขา B', false]]);
  assert.equal(detail.aliases[0].last_unit_price, '80.000000'); assert.equal(detail.aliases[0].updated_by_name, 'บัญชีทดสอบ');
  assert.ok(!detail.aliases.some(a => a.bill_text === 'อื่น'), 'aliases of another supplier must not leak');
  const before = sqlCount(h);
  for (const key of ['sm:0', 'xx:1', 'sm:1;DROP', 'sm:01', 'sm:99999999999', '1', 'sm:-1', 'pg:1.5']) {
    assert.equal((await h.call(`/suppliers/${encodeURIComponent(key)}`, { role: 'admin' })).status, 422, key);
  }
  assert.equal(sqlCount(h), before);
  const missing = await h.call('/suppliers/sm:999', { role: 'admin' });
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'NOT_FOUND');
  assert.equal((await h.call('/suppliers/pg:999/product-search', { role: 'admin' })).status, 404);
});

test('suppliers admin API: product search is bound-parameter, supplier products first, active products only', async () => {
  const h = await api();
  const all = (await h.call('/suppliers/sm:1/product-search', { role: 'admin' })).body.data.items;
  assert.deepEqual(all.map(p => [p.id, p.is_supplier_product]), [[10, true], [11, false]]);
  const found = (await h.call(`/suppliers/sm:1/product-search?q=${encodeURIComponent('ขา')}`, { role: 'admin' })).body.data.items;
  assert.deepEqual(found.map(p => p.id), [11]);
  const injected = "x' OR 1=1 --";
  await h.call(`/suppliers/sm:1/product-search?q=${encodeURIComponent(injected)}`, { role: 'admin' });
  assert.ok(h.db.state.sql.every(entry => !entry.q.includes('OR 1=1')));
  assert.equal((await h.call('/suppliers/sm:1/product-search?q[]=a', { role: 'admin' })).status, 422);
});

test('suppliers admin API: create alias stores normalized text, links product unit, audits actor in one transaction', async () => {
  const h = await api();
  const created = await h.call('/suppliers/sm:1/aliases', { role: 'accounting', method: 'POST', body: { bill_text: '  ป.บน  ', unit_text: ' กก. ', product_id: 11 } });
  assert.equal(created.status, 201, created.text);
  const alias = created.body.data;
  assert.deepEqual([alias.bill_text, alias.unit_text, alias.product_id, alias.product_name, alias.is_active], ['ป.บน', 'กก.', 11, 'ขา B', true]);
  const row = h.db.state.aliases.find(item => item.id === alias.id);
  assert.deepEqual([row.supplier_key, row.supplier_master_id, row.product_group_id, row.normalized_bill_text, row.normalized_unit_text, row.unit_id, row.confirm_count],
    ['sm:1', 1, null, ocr.normalizeMatchText('ป.บน'), ocr.normalizeMatchText('กก.'), 1, 1]);
  const audit = lastAudit(h);
  assert.deepEqual([audit.action, audit.supplier_key, audit.alias_id, audit.actor_user_id, audit.actor_name, audit.actor_role], ['alias_create', 'sm:1', alias.id, 12, 'บัญชีทดสอบ', 'accounting']);
  assert.equal(audit.before_json, null); assert.deepEqual(JSON.parse(audit.after_json), { bill_text: 'ป.บน', unit_text: 'กก.', product_id: 11, product_name: 'ขา B', is_active: true });
  const group = await h.call('/suppliers/pg:2/aliases', { role: 'admin', method: 'POST', body: { bill_text: 'หลอดใหญ่', product_id: '10' } });
  assert.equal(group.status, 201);
  assert.deepEqual([h.db.state.aliases.at(-1).supplier_master_id, h.db.state.aliases.at(-1).product_group_id], [null, 2]);
});

test('suppliers admin API: create alias validation and conflicts; nothing written on rejection', async () => {
  const h = await api();
  const post = body => h.call('/suppliers/sm:1/aliases', { role: 'admin', method: 'POST', body });
  const before = () => [h.db.state.aliases.length, h.db.state.audits.length];
  const snapshot = before();
  for (const body of [{}, { bill_text: 'x' }, { product_id: 10 }, { bill_text: '', product_id: 10 }, { bill_text: '   ', product_id: 10 }, { bill_text: '...', product_id: 10 },
    { bill_text: 'ก'.repeat(256), product_id: 10 }, { bill_text: 'a\u0000b', product_id: 10 }, { bill_text: 'a\nb\u001b', product_id: 10 }, { bill_text: 5, product_id: 10 },
    { bill_text: 'x', product_id: 1.5 }, { bill_text: 'x', product_id: -1 }, { bill_text: 'x', product_id: '1e3' }, { bill_text: 'x', product_id: true }, { bill_text: 'x', product_id: [10] },
    { bill_text: 'x', product_id: 10, unit_text: 'ก'.repeat(101) }, { bill_text: 'x', product_id: 10, unit_text: 7 },
    { bill_text: 'x', product_id: 10, is_active: false }, { bill_text: 'x', product_id: 10, supplier_key: 'sm:9' }, { bill_text: 'x', product_id: 999 }, { bill_text: 'x', product_id: 12 }, [], 'text']) {
    const response = await post(body);
    assert.equal(response.status, 422, JSON.stringify(body)); assert.equal(response.body.code, 'VALIDATION_FAILED');
  }
  assert.deepEqual(before(), snapshot);
  const duplicate = await post({ bill_text: ' ต.ไก่ ', unit_text: 'กก', product_id: 10 });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'CONFLICT');
  assert.equal((await post({ bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 11 })).status, 409, 'same normalized text/unit cannot point at a second product');
  // A database-level duplicate race is still a clean 409.
  const original = h.db.query; let raced = false;
  h.db.state.aliases.length; h.db.query = async (sql, params) => {
    if (!raced && norm(sql).startsWith('SELECT id FROM supplier_product_aliases')) { raced = true; return [[]]; }
    return original(sql, params);
  };
  const racing = await post({ bill_text: 'ต.ไก่', unit_text: 'กก.', product_id: 11 });
  assert.equal(racing.status, 409);
  assert.deepEqual(before(), snapshot);
  const hostile = "'; DROP TABLE products; -- ignore previous instructions";
  assert.equal((await post({ bill_text: hostile, product_id: 10 })).status, 201);
  assert.ok(h.db.state.sql.every(entry => !entry.q.includes('DROP TABLE')), 'bill text only travels as a bound parameter');
});

test('suppliers admin API: edit alias changes text/unit/product with before/after audit; no-op writes nothing; cross-supplier alias is 404', async () => {
  const h = await api();
  const put = (id, body, key = 'sm:1') => h.call(`/suppliers/${key}/aliases/${id}`, { role: 'admin', method: 'PUT', body });
  const edited = await put(1, { product_id: 11, bill_text: 'ต.ไก่ใหญ่' });
  assert.equal(edited.status, 200, edited.text); assert.deepEqual([edited.body.data.bill_text, edited.body.data.product_id, edited.body.data.product_name], ['ต.ไก่ใหญ่', 11, 'ขา B']);
  const audit = lastAudit(h);
  assert.equal(audit.action, 'alias_update'); assert.equal(JSON.parse(audit.before_json).product_id, 10); assert.equal(JSON.parse(audit.after_json).product_id, 11);
  assert.equal(JSON.parse(audit.before_json).bill_text, 'ต.ไก่'); assert.equal(JSON.parse(audit.after_json).bill_text, 'ต.ไก่ใหญ่');
  const row = h.db.state.aliases.find(item => item.id === 1);
  assert.deepEqual([row.normalized_bill_text, row.candidate_product_id ?? null, row.candidate_confirm_count ?? 0], [ocr.normalizeMatchText('ต.ไก่ใหญ่'), null, 0]);
  const audits = h.db.state.audits.length;
  assert.equal((await put(1, { bill_text: 'ต.ไก่ใหญ่', product_id: 11 })).status, 200);
  assert.equal(h.db.state.audits.length, audits, 'unchanged edit is not audited');
  assert.equal((await put(2, { bill_text: 'ต.ไก่ใหญ่', unit_text: 'กก.' })).status, 409);
  assert.equal((await put(2, { unit_text: 'ชิ้น' })).status, 200);
  assert.equal((await put(3, { bill_text: 'z' })).status, 404, 'alias of pg:2 is not editable through sm:1');
  assert.equal((await put(999, { bill_text: 'z' })).status, 404);
  for (const [id, body] of [['abc', { bill_text: 'z' }], [1.5, { bill_text: 'z' }], [1, {}], [1, { bill_text: '' }], [1, { product_id: 12 }], [1, { product_id: 999 }], [1, { is_active: false }]]) {
    assert.equal((await put(id, body)).status, 422, `${id} ${JSON.stringify(body)}`);
  }
});

test('suppliers admin API: disable/enable is audited, idempotent, and a disabled alias drops out of OCR hints', async () => {
  const h = await api();
  const action = (id, name, key = 'sm:1') => h.call(`/suppliers/${key}/aliases/${id}/${name}`, { role: 'accountant', method: 'POST' });
  const off = await action(1, 'disable');
  assert.equal(off.status, 200); assert.equal(off.body.data.is_active, false);
  assert.deepEqual([lastAudit(h).action, JSON.parse(lastAudit(h).before_json).is_active, JSON.parse(lastAudit(h).after_json).is_active], ['alias_disable', true, false]);
  const count = h.db.state.audits.length;
  assert.equal((await action(1, 'disable')).status, 200); assert.equal(h.db.state.audits.length, count);
  assert.equal((await action(2, 'enable')).body.data.is_active, true); assert.equal(lastAudit(h).action, 'alias_enable');
  assert.equal((await action(3, 'enable')).status, 404); assert.equal((await action('x', 'enable')).status, 422);
  assert.equal(h.db.state.aliases.find(item => item.id === 1).is_active, 0, 'alias is kept for history, not deleted');
  const sql = []; const rows = await fetchSupplierConfirmedAliases({ async query(text, params) { sql.push(norm(text)); return [[{ bill_text: 'ต.ไก่', product_name: 'อกไก่' }]]; } }, 'sm:1');
  assert.match(sql[0], /spa\.is_active = 1/); assert.equal(rows.length, 1);
});

test('suppliers admin API: profile save validates ordering mode and notes, audits before/after, partial update keeps other fields', async () => {
  const h = await api();
  const put = body => h.call('/suppliers/pg:2/profile', { role: 'admin', method: 'PUT', body });
  const saved = await put({ ordering_mode: 'walk_in_phone', bill_format_note: ' บิลเงินสดเขียนมือ ' });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body.data, { ordering_mode: 'walk_in_phone', branches_note: null, bill_format_note: 'บิลเงินสดเขียนมือ', ordering_note: null, changed: true });
  assert.deepEqual([lastAudit(h).action, lastAudit(h).supplier_key, lastAudit(h).actor_role], ['profile_update', 'pg:2', 'admin']);
  assert.equal(JSON.parse(lastAudit(h).before_json).ordering_mode, null); assert.equal(JSON.parse(lastAudit(h).after_json).ordering_mode, 'walk_in_phone');
  const second = await put({ branches_note: 'คันคลอง' });
  assert.deepEqual([second.body.data.ordering_mode, second.body.data.bill_format_note, second.body.data.branches_note], ['walk_in_phone', 'บิลเงินสดเขียนมือ', 'คันคลอง']);
  const count = h.db.state.audits.length;
  assert.equal((await put({ branches_note: 'คันคลอง' })).body.data.changed, false); assert.equal(h.db.state.audits.length, count);
  const cleared = await put({ ordering_mode: null, branches_note: '' });
  assert.deepEqual([cleared.body.data.ordering_mode, cleared.body.data.branches_note], [null, null]);
  for (const body of [{ ordering_mode: 'fax' }, { ordering_mode: 3 }, { branches_note: 'ก'.repeat(501) }, { bill_format_note: 'ก'.repeat(2001) }, { ordering_note: {} },
    { bill_format_note: 'a\u0000b' }, {}, { supplier_key: 'sm:1' }, { name: 'rename' }, []]) {
    assert.equal((await put(body)).status, 422, JSON.stringify(body));
  }
  assert.equal((await h.call('/suppliers/sm:999/profile', { role: 'admin', method: 'PUT', body: { ordering_mode: 'mixed' } })).status, 404);
  const detail = (await h.call('/suppliers/pg:2', { role: 'admin' })).body.data;
  assert.equal(detail.audits[0].action, 'profile_update'); assert.equal(detail.audits[0].actor_name, 'บัญชีทดสอบ');
});

test('suppliers admin API: audit failure rolls the alias change back and the error is sanitized; malformed JSON is 422', async () => {
  const h = await api();
  h.db.state.failAudit = true;
  const snapshot = JSON.stringify(h.db.state.aliases);
  const failed = await h.call('/suppliers/sm:1/aliases', { role: 'admin', method: 'POST', body: { bill_text: 'ใหม่', product_id: 10 } });
  assert.equal(failed.status, 500); assert.equal(failed.body.code, 'INTERNAL_ERROR'); assert.ok(!failed.text.includes('secret SQL'));
  assert.equal(JSON.stringify(h.db.state.aliases), snapshot);
  const toggle = await h.call('/suppliers/sm:1/aliases/1/disable', { role: 'admin', method: 'POST' });
  assert.equal(toggle.status, 500); assert.equal(h.db.state.aliases[0].is_active, 1);
  const edit = await h.call('/suppliers/sm:1/aliases/1', { role: 'admin', method: 'PUT', body: { product_id: 11 } });
  assert.equal(edit.status, 500); assert.equal(h.db.state.aliases[0].product_id, 10);
  h.db.state.failAudit = false;
  const bad = await h.call('/suppliers/sm:1/aliases', { role: 'admin', method: 'POST', raw: '{"bill_text":' });
  assert.equal(bad.status, 422); assert.equal(bad.body.code, 'VALIDATION_FAILED');
  const huge = await h.call('/suppliers/sm:1/profile', { role: 'admin', method: 'PUT', body: { bill_format_note: 'ก'.repeat(20000) } });
  assert.equal(huge.status, 413);
});

test('suppliers admin: schema adds profile/audit tables and alias is_active additively without touching existing tables', async () => {
  const executed = [];
  const db = { async query(sql, params = []) {
    const q = norm(sql); executed.push(q);
    if (q.startsWith('SHOW COLUMNS')) return [params[0] === 'unit_price' ? [{ Type: 'decimal(12,6)' }] : []];
    return [[]];
  } };
  // The schema module imports the real pool; link a synthetic one so no connection is ever attempted.
  const context = vm.createContext({ console });
  const module = new vm.SourceTextModule(await read('../src/models/receiving-documents-schema.js'), { context });
  await module.link(specifier => {
    if (!specifier.endsWith('/database.js')) throw new Error(`Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(['default'], function () { this.setExport('default', db); }, { context });
  });
  await module.evaluate();
  const schema = module.namespace;
  await schema.ensureReceivingDocumentsTables(db, { force: true });
  await schema.ensureReceivingDocumentsTables(db, { force: true });
  const ddl = schema.RECEIVING_DOCUMENT_TABLES_DDL;
  assert.match(ddl.receiving_supplier_profiles, /CREATE TABLE IF NOT EXISTS receiving_supplier_profiles/);
  assert.match(ddl.receiving_supplier_profiles, /UNIQUE KEY uq_receiving_supplier_profile_key \(supplier_key\)/);
  assert.match(ddl.receiving_supplier_profiles, /ordering_mode ENUM\('system', 'walk_in_phone', 'mixed'\) NULL/);
  assert.match(ddl.receiving_supplier_admin_audits, /CREATE TABLE IF NOT EXISTS receiving_supplier_admin_audits/);
  assert.match(ddl.supplier_product_aliases, /is_active TINYINT\(1\) NOT NULL DEFAULT 1/);
  assert.ok(executed.includes('ALTER TABLE supplier_product_aliases ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER candidate_confirm_count'));
  for (const forbidden of ['order_items', 'inventory_balance', 'inventory_transactions', 'products', 'supplier_masters', 'product_groups']) {
    assert.ok(!executed.some(q => q.startsWith('ALTER TABLE') && q.includes(forbidden)), forbidden);
  }
  assert.ok(!executed.some(q => /\bDROP\s+(TABLE|COLUMN|INDEX)|DELETE\s+FROM|TRUNCATE\s+TABLE/i.test(q)));
});

test('suppliers admin: every statement uses placeholders only and there is no delete path for aliases', async () => {
  const source = await read('../src/models/receiving-suppliers-admin.model.js');
  assert.ok(!/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE/i.test(source));
  const routes = await read('../src/routes/receiving-admin.routes.js');
  assert.ok(!/router\.delete/.test(routes));
  for (const match of source.matchAll(/\$\{([^}]+)\}/g)) {
    assert.match(match[1], /^(label|row\.branch_id|PROFILE_LIMITS\[field\]|marks|link|aliasSelect|needle \? .*|clauses\.length \? .*|clauses\.join\(' AND '\))$/, `unexpected interpolation ${match[1]}`);
  }
});

test('suppliers admin: OCR alias matching ignores disabled aliases and keeps enabled ones', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-18' });
  const actor = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
  const name = h.state.orderItems.find(row => row.id === 50).product_name;
  const base = { id: 1, supplier_key: 'pg:3', bill_text: 'ทB', normalized_bill_text: 'ทb', product_id: 7, unit_id: 2, unit_multiplier: 1, confirm_count: 2, updated_at: new Date('2026-10-18') };
  const run = async (alias, uuid) => {
    h.state.aliases.length = 0; h.state.aliases.push(alias);
    const created = await h.invoke('createDocument', { user: actor, body: { client_uuid: uuid, delivery_date: h.today, product_group_id: 3 } });
    const id = created.body.data.id;
    await h.invoke('uploadImage', { user: actor, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
    let hints;
    ocr.setCustomOcrProvider(async ({ knownAliases }) => { hints = knownAliases; return { doc_kind: 'bill', total: '0.30', doc_date: '18/10/2569', confidence: 0.99,
      lines: [{ bill_text: 'ทB', quantity_billed: '5', unit_text: 'กก.', unit_price: '0.06', amount: '0.30', confidence: 0.99 }] }; });
    ocr.resetOcrRateLimit();
    const result = await h.invoke('runOcr', { user: actor, params: { id }, body: {} });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    return { source: result.body.data.lines[0].match.source, hints };
  };
  const enabled = await run({ ...base, is_active: 1 }, 'alias-on');
  assert.equal(enabled.source, 'alias'); assert.deepEqual(enabled.hints.map(item => item.bill_text), ['ทB']);
  const disabled = await run({ ...base, is_active: 0 }, 'alias-off');
  assert.notEqual(disabled.source, 'alias'); assert.deepEqual(disabled.hints, []);
});

// ---- round N2: one row per shop (supplier master + legacy group twin), stable alias order, per-branch AP codes ----
// SYNTHETIC: pg:4 is the legacy product group of the same shop as sm:1 (same TRIM name) and carries mirrored aliases.
function twinHarness() {
  return api().then(h => {
    const state = h.db.state;
    state.groups.push({ id: 4, code: 'SYN-PG-4', name: '  ร้านทดสอบ A ', is_active: 1 });
    const mirror = (row, patch) => ({ ...row, ...patch });
    state.aliases.push(mirror(state.aliases[0], { id: 4, supplier_key: 'pg:4', supplier_master_id: null, product_group_id: 4 }),
      mirror(state.aliases[1], { id: 5, supplier_key: 'pg:4', supplier_master_id: null, product_group_id: 4 }),
      { id: 6, supplier_key: 'pg:4', bill_text: 'ปีก', normalized_bill_text: 'ปีก', unit_text: '', normalized_unit_text: '', product_id: 11,
        unit_multiplier: '1.0000', last_unit_price: null, confirm_count: 2, is_active: 1, updated_at: new Date('2026-10-19T06:00:00Z'), updated_by_user_id: null });
    state.profiles.push({ supplier_key: 'pg:4', ordering_mode: 'walk_in_phone', branches_note: 'เก่า', bill_format_note: null, ordering_note: null, updated_at: new Date('2026-10-17T05:00:00Z') });
    state.docs.push({ supplier_key: 'pg:4', branch_id: 2, branch_name: 'สาขาสอง' }, { supplier_key: 'pg:4', branch_id: 3, branch_name: 'สาขาสาม' });
    state.nextAlias = 20;
    return h;
  });
}

test('N2 list: a group that is the same shop as a supplier master is shown once, through the master, with both keys merged', async () => {
  const h = await twinHarness();
  const list = (await h.call('/suppliers', { role: 'accounting' })).body.data.items;
  assert.deepEqual(list.map(item => item.supplier_key), ['sm:1', 'pg:2', 'pg:3'], 'pg:4 is hidden, unmatched groups still listed');
  const shop = list[0];
  assert.deepEqual([shop.alias_active_count, shop.alias_disabled_count], [2, 1], 'mirrored aliases count once; pg-only alias counts');
  assert.deepEqual(shop.branches_seen, ['สาขาสอง', 'สาขาหนึ่ง', 'สาขาสาม'].filter(name => shop.branches_seen.includes(name)));
  assert.equal(new Set(shop.branches_seen).size, 3); assert.equal(shop.ordering_mode, 'system', 'master profile wins over the legacy one');
  assert.deepEqual(shop.branch_codes, []);
  assert.deepEqual((await h.call('/suppliers?kind=group', { role: 'admin' })).body.data.items.map(item => item.supplier_key), ['pg:2', 'pg:3']);
  assert.deepEqual((await h.call('/suppliers?kind=master', { role: 'admin' })).body.data.items.map(item => item.supplier_key), ['sm:1']);
  assert.deepEqual((await h.call('/suppliers?q=SYN-PG-4', { role: 'admin' })).body.data.items.map(item => item.supplier_key), ['sm:1'], 'found through the twin group code');
  // The legacy profile is only a fallback while the master has none.
  h.db.state.profiles.splice(0, 1);
  assert.equal((await h.call('/suppliers', { role: 'admin' })).body.data.items[0].ordering_mode, 'walk_in_phone');
});

test('N2 list: a group with a different name, or whose master is disabled, is not merged', async () => {
  const h = await twinHarness();
  h.db.state.masters[0].is_active = 0;
  assert.deepEqual((await h.call('/suppliers', { role: 'admin' })).body.data.items.map(item => item.supplier_key).sort(), ['pg:2', 'pg:3', 'pg:4', 'sm:1']);
  const sql = h.db.state.sql.filter(entry => entry.q.includes('JOIN product_groups pg ON TRIM(pg.name) = TRIM(sm.name)'));
  assert.ok(sql.length > 0 && sql.every(entry => entry.q.includes('sm.is_active = true') && entry.params.length === 0));
});

test('N2 detail: both keys give one canonical shop with deduplicated aliases that remember where they live', async () => {
  const h = await twinHarness();
  for (const key of ['sm:1', 'pg:4']) {
    const detail = (await h.call(`/suppliers/${key}`, { role: 'accountant' })).body.data;
    assert.equal(detail.supplier_key, 'sm:1'); assert.equal(detail.kind, 'master'); assert.deepEqual(detail.merged_keys, ['sm:1', 'pg:4']);
    assert.deepEqual(detail.aliases.map(a => [a.bill_text, a.is_active, a.source_keys, a.alias_ids]),
      [['ต.ไก่', true, ['sm:1', 'pg:4'], [1, 4]], ['ทB', false, ['sm:1', 'pg:4'], [2, 5]], ['ปีก', true, ['pg:4'], [6]]]);
    assert.deepEqual(detail.branches_seen.slice().sort(), ['สาขาสอง', 'สาขาสาม', 'สาขาหนึ่ง'].sort());
  }
  const plain = (await h.call('/suppliers/pg:2', { role: 'admin' })).body.data;
  assert.equal(plain.supplier_key, 'pg:2'); assert.equal(plain.merged_keys, undefined, 'unmatched group keeps the old response shape');
  assert.equal((await h.call('/suppliers/pg:999', { role: 'admin' })).status, 404);
});

test('N2 alias order does not depend on is_active, so disabling never moves a row', async () => {
  const h = await api();
  const order = async () => (await h.call('/suppliers/sm:1', { role: 'admin' })).body.data.aliases.map(a => a.id);
  const before = await order();
  assert.equal((await h.call('/suppliers/sm:1/aliases/1/disable', { role: 'admin', method: 'POST' })).status, 200);
  assert.deepEqual(await order(), before);
  assert.equal((await h.call('/suppliers/sm:1/aliases/2/enable', { role: 'admin', method: 'POST' })).status, 200);
  assert.deepEqual(await order(), before);
  const source = await read('../src/models/receiving-suppliers-admin.model.js');
  assert.ok(!/ORDER BY a\.is_active/.test(source));
});

test('N2 toggle/edit/create on a merged shop keep every key in step, audit once under the master key, and work from either key', async () => {
  const h = await twinHarness();
  const state = h.db.state;
  const off = await h.call('/suppliers/sm:1/aliases/1/disable', { role: 'admin', method: 'POST' });
  assert.equal(off.status, 200); assert.deepEqual(state.aliases.filter(a => [1, 4].includes(a.id)).map(a => a.is_active), [0, 0]);
  assert.deepEqual([state.audits.length, lastAudit(h).supplier_key, lastAudit(h).action], [1, 'sm:1', 'alias_disable']);
  // An alias that only lives under the legacy key is reachable (and editable) through the shop page.
  const edit = await h.call('/suppliers/sm:1/aliases/6', { role: 'admin', method: 'PUT', body: { bill_text: 'ปีกบน' } });
  assert.equal(edit.status, 200, edit.text); assert.equal(state.aliases.find(a => a.id === 6).bill_text, 'ปีกบน');
  assert.equal(lastAudit(h).supplier_key, 'sm:1');
  const viaGroup = await h.call('/suppliers/pg:4/aliases/6/disable', { role: 'admin', method: 'POST' });
  assert.equal(viaGroup.status, 200); assert.equal(state.aliases.find(a => a.id === 6).is_active, 0);
  // Edit of a mirrored alias updates both rows to the same value.
  const both = await h.call('/suppliers/sm:1/aliases/2', { role: 'admin', method: 'PUT', body: { product_id: 10 } });
  assert.equal(both.status, 200); assert.deepEqual(state.aliases.filter(a => [2, 5].includes(a.id)).map(a => a.product_id), [10, 10]);
  // Create: written under every key (OCR reads the key of the document), conflicts when ANY key already has it.
  const created = await h.call('/suppliers/pg:4/aliases', { role: 'admin', method: 'POST', body: { bill_text: 'ใหม่', product_id: 11 } });
  assert.equal(created.status, 201, created.text);
  const rows = state.aliases.filter(a => a.bill_text === 'ใหม่');
  assert.deepEqual(rows.map(a => [a.supplier_key, a.supplier_master_id, a.product_group_id]).sort(), [['pg:4', null, 4], ['sm:1', 1, null]].sort());
  assert.equal(created.body.data.id, rows.find(a => a.supplier_key === 'sm:1').id);
  const before = state.aliases.length;
  const dup = await h.call('/suppliers/sm:1/aliases', { role: 'admin', method: 'POST', body: { bill_text: 'ปีกบน', product_id: 10 } });
  assert.equal(dup.status, 409, 'exists only under pg:4 but is still a duplicate for the shop'); assert.equal(state.aliases.length, before);
  // Another shop's alias stays unreachable.
  assert.equal((await h.call('/suppliers/sm:1/aliases/3/disable', { role: 'admin', method: 'POST' })).status, 404);
});

test('N2 profile save on a merged shop writes the master key only; product search also credits the twin group links', async () => {
  const h = await twinHarness();
  const saved = await h.call('/suppliers/pg:4/profile', { role: 'admin', method: 'PUT', body: { bill_format_note: 'บิลพิมพ์' } });
  assert.equal(saved.status, 200); assert.deepEqual(h.db.state.profiles.map(p => p.supplier_key).sort(), ['pg:4', 'sm:1']);
  assert.equal(lastAudit(h).supplier_key, 'sm:1'); assert.equal(h.db.state.profiles.find(p => p.supplier_key === 'sm:1').bill_format_note, 'บิลพิมพ์');
  assert.equal(h.db.state.profiles.find(p => p.supplier_key === 'pg:4').bill_format_note, null, 'legacy profile untouched');
  const found = await h.call('/suppliers/pg:4/product-search?q=%E0%B8%82', { role: 'admin' });
  assert.equal(found.status, 200); assert.ok(h.db.state.sql.some(entry => entry.q.includes('product_group_links g WHERE g.product_id = p.id AND g.product_group_id IN (?)')));
});

test('N2 branch codes: saved, listed, searchable, audited, soft-removed and validated', async () => {
  const h = await twinHarness();
  const put = body => h.call('/suppliers/pg:4/profile', { role: 'accounting', method: 'PUT', body });
  const saved = await put({ branch_codes: [{ code: ' AP-049 ', branch_note: 'สันกำแพง' }, { code: 'AP-003' }] });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body.data.branch_codes, [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003', branch_note: null }]);
  assert.equal(saved.body.data.changed, true);
  assert.deepEqual(h.db.state.branchCodes.map(row => row.supplier_key), ['sm:1', 'sm:1'], 'stored under the canonical master key');
  const audit = lastAudit(h);
  assert.equal(audit.action, 'profile_update'); assert.equal(audit.supplier_key, 'sm:1');
  assert.deepEqual(JSON.parse(audit.before_json).branch_codes, []); assert.equal(JSON.parse(audit.after_json).branch_codes.length, 2);
  assert.deepEqual(JSON.parse(audit.after_json).ordering_mode, 'system');
  const detail = (await h.call('/suppliers/sm:1', { role: 'admin' })).body.data;
  assert.deepEqual(detail.branch_codes, [{ code: 'AP-003', branch_note: null }, { code: 'AP-049', branch_note: 'สันกำแพง' }]);
  assert.deepEqual((await h.call('/suppliers', { role: 'admin' })).body.data.items[0].branch_codes.map(c => c.code), ['AP-003', 'AP-049']);
  for (const q of ['AP-049', 'สันกำแพง']) assert.deepEqual((await h.call(`/suppliers?q=${encodeURIComponent(q)}`, { role: 'admin' })).body.data.items.map(i => i.supplier_key), ['sm:1'], q);
  assert.deepEqual((await h.call('/suppliers?q=AP-999', { role: 'admin' })).body.data.items, []);
  // Saving the same list is a no-op (no audit); removing one soft-disables it and keeps the row.
  const count = h.db.state.audits.length;
  assert.equal((await put({ branch_codes: [{ code: 'AP-049', branch_note: 'สันกำแพง' }, { code: 'AP-003' }] })).body.data.changed, false);
  assert.equal(h.db.state.audits.length, count);
  const removed = await put({ branch_codes: [{ code: 'AP-049', branch_note: 'บ้านแจ้' }] });
  assert.deepEqual(removed.body.data.branch_codes, [{ code: 'AP-049', branch_note: 'บ้านแจ้' }]);
  assert.deepEqual(h.db.state.branchCodes.map(row => [row.supplier_code, row.is_active, row.branch_note]), [['AP-049', 1, 'บ้านแจ้'], ['AP-003', 0, null]]);
  assert.deepEqual((await h.call('/suppliers?q=AP-003', { role: 'admin' })).body.data.items, [], 'removed codes are not searchable');
  const back = await put({ branch_codes: [{ code: 'AP-003', branch_note: 'อีกสาขา' }, { code: 'AP-049', branch_note: 'บ้านแจ้' }] });
  assert.equal(back.status, 200); assert.equal(h.db.state.branchCodes.length, 2); assert.equal(h.db.state.branchCodes.find(r => r.supplier_code === 'AP-003').is_active, 1);
  // Partial profile saves leave codes alone and do not echo them.
  const partial = await h.call('/suppliers/sm:1/profile', { role: 'admin', method: 'PUT', body: { ordering_note: 'x' } });
  assert.equal(partial.body.data.branch_codes, undefined); assert.equal(h.db.state.branchCodes.filter(r => r.is_active).length, 2);
});

test('N2 branch codes: rejects bank, tax-id and phone-like numbers, bad shapes, duplicates and too many entries; nothing is written', async () => {
  const h = await twinHarness();
  const put = body => h.call('/suppliers/sm:1/profile', { role: 'admin', method: 'PUT', body });
  const bad = [{ branch_codes: 'AP-1' }, { branch_codes: {} }, { branch_codes: [null] }, { branch_codes: ['AP-1'] }, { branch_codes: [{}] }, { branch_codes: [{ code: '' }] },
    { branch_codes: [{ code: 5 }] }, { branch_codes: [{ code: 'AP 049' }] }, { branch_codes: [{ code: '-AP' }] }, { branch_codes: [{ code: 'A'.repeat(31) }] },
    { branch_codes: [{ code: '0812345678' }] }, { branch_codes: [{ code: '1234567890123' }] }, { branch_codes: [{ code: 'AP-1', branch_note: '081-234-5678' }] },
    { branch_codes: [{ code: 'AP-1', branch_note: 'โอน 123 456 7890' }] }, { branch_codes: [{ code: 'AP-1', branch_note: 'ก'.repeat(101) }] },
    { branch_codes: [{ code: 'AP-1', branch_note: 'a\u0000b' }] }, { branch_codes: [{ code: 'AP-1', branch_note: 7 }] }, { branch_codes: [{ code: 'AP-1', extra: 1 }] },
    { branch_codes: [{ code: 'AP-1' }, { code: 'ap-1' }] }, { branch_codes: Array.from({ length: 21 }, (_, i) => ({ code: `AP-${i + 1}` })) }];
  for (const body of bad) {
    const response = await put(body);
    assert.equal(response.status, 422, JSON.stringify(body).slice(0, 80)); assert.equal(response.body.code, 'VALIDATION_FAILED');
  }
  assert.deepEqual([h.db.state.branchCodes.length, h.db.state.audits.length], [0, 0]);
  assert.equal((await put({ branch_codes: Array.from({ length: 20 }, (_, i) => ({ code: `AP-${i + 1}`, branch_note: `สาขา ${i + 1}` })) })).status, 200);
  assert.equal((await put({ branch_codes: [] })).body.data.branch_codes.length, 0);
  assert.ok(h.db.state.branchCodes.every(row => row.is_active === 0));
  // An audit failure rolls the codes back too.
  h.db.state.failAudit = true;
  assert.equal((await put({ branch_codes: [{ code: 'AP-5' }] })).status, 500);
  assert.ok(h.db.state.branchCodes.every(row => row.is_active === 0));
});

test('N2 schema: branch code table is additive (CREATE TABLE IF NOT EXISTS, unique per shop+code, soft removal column)', async () => {
  const context = vm.createContext({ console });
  const module = new vm.SourceTextModule(await read('../src/models/receiving-documents-schema.js'), { context });
  await module.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', {}); }, { context }));
  await module.evaluate();
  const ddl = module.namespace.RECEIVING_DOCUMENT_TABLES_DDL.receiving_supplier_branch_codes;
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS receiving_supplier_branch_codes/);
  assert.match(ddl, /UNIQUE KEY uq_receiving_supplier_branch_code \(supplier_key, supplier_code\)/);
  assert.match(ddl, /is_active TINYINT\(1\) NOT NULL DEFAULT 1/);
  assert.ok(!/DROP|DELETE|ALTER/i.test(ddl));
});
