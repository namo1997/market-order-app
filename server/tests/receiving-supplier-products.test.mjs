import test from 'node:test';
import assert from 'node:assert/strict';
import * as ocr from '../src/services/receiving-ocr.service.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import express from 'express';
import { productModules, productDb } from './helpers/supplier-products-harness.mjs';
import { expressRequest } from './helpers/express-request.mjs';
import { matchOcrLinesToCatalog } from '../src/services/receiving-ocr-matcher.js';
const plain = value => JSON.parse(JSON.stringify(value));
const user = { id: 7, name: 'SYNTHETIC บัญชี', role: 'accounting' };
const body = (patch = {}) => ({ rows: [{ name: 'ไข่ SYNTHETIC', unit: 'แผง', price: '139.10', bill_text: 'ไข่', item_code: 'SYN-5002', group: '' }], department_ids: [1], default_group_id: 1, is_countable: true, allow_pending_carryover: true, ...patch });
async function fixture() { const db = productDb(); const modules = await productModules(db); return { db, ...modules, input: { user, key: 'sm:1', body: body() } }; }
async function request(h, patch = {}) { const input = { ...h.input, ...patch }; const checked = await h.model.previewSupplierProducts(h.db, input); return { ...input, body: { ...input.body, preview_hash: checked.preview_hash, request_id: randomUUID() } }; }

test('products: canonical model writes product, both links, department, stock template, mirrored aliases and audit in ONE transaction', async () => {
  const h = await fixture(); const req = await request(h);
  const result = await h.model.importSupplierProducts(h.db, req);
  assert.equal(result.count, 1); const p = h.db.state.products[0];
  assert.deepEqual([p.name, p.default_price, p.unit_id, p.product_group_id, p.supplier_master_id, p.is_countable, p.allow_pending_carryover], ['ไข่ SYNTHETIC', '139.10', 1, 1, 1, 1, 1]);
  assert.match(p.code, /^PRD-/); assert.equal(h.db.state.links.length, 1); assert.equal(h.db.state.masterLinks.length, 1);
  assert.equal(h.db.state.departments[0][1], p.id); assert.equal(h.db.state.stock[0][1], p.id);
  assert.deepEqual(h.db.state.aliases.map(a => [a.supplier_key, a.product_id, a.item_code]), [['sm:1', p.id, 'SYN-5002'], ['pg:1', p.id, 'SYN-5002']]);
  assert.deepEqual(h.db.state.audits.map(a => a[2]), ['alias_create', 'products_create']);
  assert.equal(h.db.state.imports.length, 1);
  assert.ok(h.db.state.queries.some(q => /supplier_masters WHERE id = \? FOR UPDATE/.test(q.q)));
  const promptHints = h.db.state.aliases.filter(a => a.supplier_key === 'sm:1').map(a => ({ ...a, product_name: p.name }));
  const match = matchOcrLinesToCatalog({ ocrLines: [{ bill_text: 'โฟมเบอร์ 1', item_code: 'SYN-5002', unit_text: 'แผง' }],
    supplierKey: 'sm:1', aliases: promptHints, products: [{ ...p, unit_name: 'แผง' }] });
  assert.equal(match[0].product_id, p.id, 'printed code wins over OCR typo');
});

test('products: validation preview rejects missing units, duplicates, long numbers, bad price/flags/shape/scope with no writes', async () => {
  const h = await fixture();
  const valid = await h.model.previewSupplierProducts(h.db, h.input); assert.equal(valid.valid, true);
  for (const patch of [{ unit: 'ไม่มีหน่วย' }, { price: '0.001' }, { price: '1e2' }, { price: '-1' }, { price: '1000000' }, { price: '1,000' }, { price: '' }, { name: 'ติดต่อ 081-234-5678' }, { item_code: '1234567890123' }, { item_code: 'bad<>code' }, { unit: null }, { group: 'ไม่มี' }, { extra: true }]) {
    const checked = await h.model.previewSupplierProducts(h.db, { ...h.input, body: body({ rows: [{ ...body().rows[0], ...patch }] }) });
    assert.equal(checked.valid, false, JSON.stringify(patch)); assert.equal(checked.items[0].name, undefined, 'invalid row is redacted');
  }
  for (const patch of [{ rows: [] }, { rows: Array(101).fill(body().rows[0]) }, { department_ids: [] }, { department_ids: ['1'] }, { department_ids: [1, 1] }, { is_countable: 'true' }, { default_group_id: 0 }, { unknown: true }]) await assert.rejects(h.model.previewSupplierProducts(h.db, { ...h.input, body: body(patch) }), { code: 'VALIDATION_FAILED' });
  const duplicate = await h.model.previewSupplierProducts(h.db, { ...h.input, body: body({ rows: [body().rows[0], { ...body().rows[0] }] }) });
  assert.equal(duplicate.items[1].errors.length, 1);
  h.db.scopes.push({ product_group_id: 1, branch_id: 2, department_id: 2 });
  assert.equal((await h.model.previewSupplierProducts(h.db, h.input)).valid, false);
  assert.deepEqual([h.db.state.products.length, h.db.state.audits.length], [0, 0]);
});

test('products: exact cents, existing name/code/alias duplicates and inactive shop', async () => {
  const h = await fixture();
  for (const [value, expected] of [['0.10', '0.10'], [0.2, '0.20'], ['001.2', '1.20'], ['999999.99', '999999.99']]) assert.equal(h.model.productPrice(value), expected);
  assert.throws(() => h.model.productPrice(0.1 + 0.2), { code: 'VALIDATION_FAILED' });
  h.db.state.products.push({ id: 9, name: 'ไข่ SYNTHETIC' });
  assert.equal((await h.model.previewSupplierProducts(h.db, h.input)).valid, false);
  h.db.state.products = [];
  h.db.state.aliases.push({ supplier_key: 'pg:1', normalized_bill_text: 'อื่น', normalized_unit_text: '', item_code: 'SYN-5002' });
  assert.equal((await h.model.previewSupplierProducts(h.db, h.input)).valid, false);
  h.db.suppliers[0].is_active = 0;
  await assert.rejects(h.model.supplierProductOptions(h.db, h.input), { code: 'CONFLICT' });
});

for (const stage of ['INSERT INTO products', 'INSERT INTO product_group_links', 'INSERT INTO product_supplier_master_links', 'INSERT INTO department_products', 'INSERT INTO stock_templates', 'INSERT INTO supplier_product_aliases', 'INSERT INTO receiving_supplier_admin_audits', 'INSERT INTO receiving_supplier_product_imports']) {
  test(`products: rollback ALL writes if ${stage} fails`, async () => {
    const h = await fixture(); const req = await request(h); h.db.state.fail = stage;
    await assert.rejects(h.model.importSupplierProducts(h.db, req));
    for (const field of ['products', 'links', 'masterLinks', 'departments', 'stock', 'aliases', 'audits', 'imports']) assert.equal(h.db.state[field].length, 0, field);
  });
}

test('products: whole multi-row batch rolls back when second product fails', async () => {
  const h = await fixture(); const req = await request(h, { body: body({ rows: [body().rows[0], { ...body().rows[0], name: 'ข้าว SYNTHETIC', bill_text: 'ข้าว', item_code: 'SYN-2010' }] }) });
  const query = h.db.query; let inserts = 0;
  h.db.getConnection = async () => { let saved; return { beginTransaction: async () => { saved = structuredClone(h.db.state); }, query: async (sql, args) => {
    if (/INSERT INTO products/.test(sql) && ++inserts === 2) throw new Error('second row failure'); return query(sql, args);
  }, commit: async () => {}, rollback: async () => Object.assign(h.db.state, saved), release() {} }; };
  await assert.rejects(h.model.importSupplierProducts(h.db, req));
  for (const field of ['products', 'links', 'masterLinks', 'departments', 'stock', 'aliases', 'audits', 'imports']) assert.equal(h.db.state[field].length, 0);
});

test('products: retry and simultaneous same request create once; UUID reuse with changed payload/actor/shop conflicts', async () => {
  const h = await fixture(); const req = await request(h);
  const results = await Promise.all([h.model.importSupplierProducts(h.db, req), h.model.importSupplierProducts(h.db, req)]);
  assert.deepEqual(plain(results[0]), plain(results[1])); assert.equal(h.db.state.products.length, 1);
  assert.deepEqual(plain(await h.model.importSupplierProducts(h.db, req)), plain(results[0]));
  for (const patch of [{ user: { ...user, id: 8 } }, { body: { ...req.body, is_countable: false } }]) await assert.rejects(h.model.importSupplierProducts(h.db, { ...req, ...patch }), { code: 'CONFLICT' });
  assert.equal(h.db.state.products.length, 1);
});

test('products: revalidate on commit; bad hash and duplicate from another request cannot write', async () => {
  const h = await fixture(); const req = await request(h);
  await assert.rejects(h.model.importSupplierProducts(h.db, { ...req, body: { ...req.body, preview_hash: '0'.repeat(64) } }), { code: 'CONFLICT' });
  await h.model.importSupplierProducts(h.db, req);
  await assert.rejects(h.model.importSupplierProducts(h.db, { ...req, body: { ...req.body, request_id: randomUUID() } }), { code: 'VALIDATION_FAILED' });
  assert.equal(h.db.state.products.length, 1);
});

test('products: admin/accounting allowed; staff rejected before queries; missing supplier 404; no-stock option honored', async () => {
  const h = await fixture();
  for (const role of ['admin', 'super_admin', 'accounting', 'accountant']) assert.ok(await h.model.supplierProductOptions(h.db, { ...h.input, user: { ...user, role } }));
  const count = h.db.state.queries.length;
  await assert.rejects(h.model.previewSupplierProducts(h.db, { ...h.input, user: { id: 2, role: 'user' } }), { code: 'FORBIDDEN' });
  assert.equal(h.db.state.queries.length, count);
  await assert.rejects(h.model.supplierProductOptions(h.db, { ...h.input, key: 'sm:999' }), { code: 'NOT_FOUND' });
  const req = await request(h, { key: 'pg:1', body: body({ is_countable: false, allow_pending_carryover: false }) });
  await h.model.importSupplierProducts(h.db, req);
  assert.equal(h.db.state.stock.length, 0); assert.equal(h.db.state.products[0].is_countable, 0);
  assert.equal(h.db.state.imports[0].supplier_key, 'sm:1');
});

test('products: HTTP options/preview/create enforce auth, roles, errors and size; safe 500 hides SQL', async () => {
  const h = await fixture();
  const context = vm.createContext({ console: { error() {} } });
  const synth = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context });
  const read = p => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const controller = new vm.SourceTextModule(await read('controllers/receiving-suppliers-admin.controller.js'), { context });
  const errors = new vm.SourceTextModule(await read('controllers/receiving-documents.controller.js'), { context });
  await errors.link(spec => synth(spec.endsWith('/receiving-ocr.service.js') ? ocr : {})); await errors.evaluate();
  await controller.link(spec => spec.endsWith('/database.js') ? synth({ default: h.db })
    : spec.endsWith('/receiving-suppliers-admin.model.js') ? synth({ assertSupplierManager: user => { if (!['admin', 'accounting'].includes(user?.role)) { const e = new Error('forbidden'); e.statusCode = 403; throw e; } } })
    : spec.endsWith('/receiving-supplier-products.model.js') ? synth({ ...h.model, prepareSupplierProducts: async () => {} })
    : spec.endsWith('/receiving-documents-schema.js') ? synth({ ensureReceivingDocumentsTables: async () => {} }) : errors);
  await controller.evaluate();
  const router = new vm.SourceTextModule(await read('routes/receiving-admin.routes.js'), { context });
  await router.link(spec => spec === 'express' ? synth({ default: express })
    : spec.endsWith('/auth.js') ? synth({ authenticate: (req, res, next) => {
      const role = req.get('x-test-role'); if (!['admin', 'accounting', 'user'].includes(role)) return res.status(401).json({ code: 'UNAUTHORIZED' }); req.user = { ...user, role }; next();
    } }) : spec.endsWith('/receiving-suppliers-admin.controller.js') ? controller
      : synth({ list() {}, options() {}, detail() {}, issuesSummary() {} }));
  await router.evaluate();
  const app = express(); app.use('/api/receiving-admin', router.namespace.default);
  app.use((_error, _req, res, _next) => res.status(500).json({ code: 'INTERNAL_ERROR' }));
  const call = async (path, method = 'GET', data, role = 'accounting') => {
    const res = await expressRequest(app, `/api/receiving-admin/suppliers/${path}`, { method,
      headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  };
  const validRequest = (await request(h)).body;
  for (const [path, method] of [['sm:1/product-options', 'GET'], ['sm:1/products/preview', 'POST'], ['sm:1/products', 'POST']]) {
    assert.equal((await call(path, method, {}, null)).status, 401);
    assert.equal((await call(path, method, {}, 'invalid')).status, 401);
    assert.equal((await call(path, method, {}, 'user')).status, 403);
    assert.equal((await call(path.replace('sm:1', 'sm:999'), method, method === 'POST' && path.endsWith('/products') ? validRequest : body())).status, 404);
  }
  assert.equal((await call('sm:1/product-options')).status, 200);
  assert.equal((await call('sm:1/products/preview', 'POST', { huge: 'x'.repeat(140000) })).status, 413);
  assert.equal((await call('sm:1/products/preview', 'POST', body({ rows: [] }))).status, 422);
  const checked = await call('sm:1/products/preview', 'POST', body()); assert.equal(checked.status, 200);
  const data = { ...body(), preview_hash: checked.body.data.preview_hash, request_id: randomUUID() };
  // Create validates UUID before lookup: exercise unknown supplier with a complete request.
  assert.equal((await call('sm:999/products', 'POST', data)).status, 404);
  assert.equal((await call('sm:1/products', 'POST', { ...data, preview_hash: '0'.repeat(64) })).status, 409);
  h.db.state.fail = 'INSERT INTO receiving_supplier_admin_audits';
  const failed = await call('sm:1/products', 'POST', data); assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /SQL|stack|SYNTHETIC/);
  h.db.state.fail = '';
  assert.equal((await call('sm:1/products', 'POST', data)).status, 201);
  assert.equal((await call('sm:1/products', 'POST', data)).status, 201); assert.equal(h.db.state.products.length, 1);
});


test('products: created identity is returned by existing order catalogue, department list, supplier suggestions, off-order picker and stock form (mock SQL adapter)', async () => {
  const h = await fixture(); const req = await request(h); const created = await h.model.importSupplierProducts(h.db, req);
  const productId = created.products[0].id;
  const actor = { id: 1, name: 'SYNTHETIC ผู้รับ', role: 'user', branch_id: 1, department_id: 1 };
  assert.equal((await h.products.getAllProducts({ branchId: 1, departmentId: 1, supplierId: 1 }))[0].id, productId);
  assert.equal((await h.departments.getProductIdsByDepartmentId(1))[0].product_id, productId);
  const suggestions = await h.catalog.receivingSupplierProducts({ user: actor, supplierKey: 'sm:1', db: h.db });
  assert.equal(suggestions[0].id, productId); assert.equal(suggestions[0].unit_name, 'แผง'); assert.equal(suggestions[0].default_price, undefined, 'blind recommendations never include prices');
  assert.equal((await h.catalog.searchReceivingProducts({ user: actor, filters: { q: 'ไข่' }, db: h.db }))[0].id, productId);
  assert.equal((await h.stock.getTemplateByDepartmentId(1))[0].product_id, productId);
  const queries = h.db.state.queries.map(q => q.q);
  assert.ok(queries.some(q => q.includes('product_group_links pgl_filter')));
  assert.ok(queries.some(q => q.includes('a.confirm_count >= 1 AND a.is_active = 1')));
  // Product creation alone never fabricates purchase orders or inventory balances. Queue rows appear after an order is placed.
  assert.ok(!queries.some(q => /INSERT INTO (orders|order_items|inventory_balance|inventory_transactions)/.test(q)));
});
