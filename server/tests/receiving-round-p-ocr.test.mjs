import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeOcrPayload, BILL_OCR_JSON_SCHEMA, BILL_OCR_SYSTEM_PROMPT,
  extractBillWithVision, setCustomOcrProvider, resetOcrRateLimit, billBranchMismatch } from '../src/services/receiving-ocr.service.js';
import { createReceivingHarness, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';

const user = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
const bill = (extra = {}) => ({ doc_kind: 'bill', confidence: 0.99, subtotal: '2,863.56', discount: 100,
  vat: 193.45, total: '2,957.01', lines: [{ bill_text: 'ก๊าซ 48 กก.', quantity_billed: 2,
    unit_price: 1431.78, amount: 2863.56, confidence: 0.99 }], ...extra });
afterEach(() => { setCustomOcrProvider(null); resetOcrRateLimit(); });

test('P1 gas bill keeps discount and VAT separately; exact cent equations and line flags lower confidence', () => {
  const good = normalizeOcrPayload(bill());
  assert.deepEqual([good.subtotal, good.discount, good.vat, good.total], [2863.56, 100, 193.45, 2957.01]);
  assert.equal(good.warnings.includes('BILL_TOTAL_MISMATCH'), false);
  assert.equal(good.confidence, 0.99);
  const badTotal = normalizeOcrPayload(bill({ total: 2957.02 }));
  assert.ok(badTotal.warnings.includes('BILL_TOTAL_MISMATCH'));
  assert.ok(badTotal.confidence <= 0.6);
  const badLine = normalizeOcrPayload(bill({ lines: [{ bill_text: 'แก๊ส', quantity_billed: 2, unit_price: 1431.78, amount: 2863.57, confidence: 0.99 }] }));
  assert.ok(badLine.warnings.includes('LINE_AMOUNT_MISMATCH'));
  assert.deepEqual(badLine.lines[0].flags, ['LINE_AMOUNT_MISMATCH']);
  assert.ok(badLine.lines[0].confidence <= 0.4);
  assert.ok(badLine.confidence <= 0.6);
  assert.equal(badLine.lines[0].bill_read.amount, 2863.57, 'preserve the printed amount');
});

test('P1 exact decimal multiplication and missing legacy optional fields stay backward compatible', () => {
  for (const [quantity, price, amount] of [[3, 0.1, 0.3], [0.1, 3, 0.3], [1.25, 0.123456, 0.15], [0, 100, 0]]) {
    const result = normalizeOcrPayload({ total: amount, lines: [{ bill_text: 'ทดสอบ', quantity_billed: quantity, unit_price: price, amount }] });
    assert.deepEqual(result.lines[0].flags, []);
    assert.equal(result.ship_to, null); assert.equal(result.addressee, null); assert.equal(result.supplier_code, null);
    assert.equal(result.warnings.includes('BILL_TOTAL_MISMATCH'), false);
  }
  const missing = normalizeOcrPayload(bill({ discount: null, vat: null }));
  assert.equal(missing.discount, null); assert.equal(missing.vat, null);
  assert.equal(missing.warnings.includes('BILL_TOTAL_MISMATCH'), false, 'unknown fields never become zero');
});

test('P1 schema, shared provider prompt and untrusted text omit private numbers and unexpected properties', async () => {
  for (const field of ['ship_to', 'addressee', 'supplier_code']) {
    assert.deepEqual(BILL_OCR_JSON_SCHEMA.schema.properties[field].type, ['string', 'null']);
    assert.ok(BILL_OCR_SYSTEM_PROMPT.includes(field));
  }
  assert.match(BILL_OCR_SYSTEM_PROMPT, /quantity_billed × unit_price = amount/);
  assert.match(BILL_OCR_SYSTEM_PROMPT, /ห้ามอ่านหรือส่งคืนเลขบัญชีธนาคาร เลขผู้เสียภาษี เบอร์โทรศัพท์/);
  const raw = bill({ ship_to: 'สาขาที่ 00002 (ร้านโซลาวบ้านแจ้)\nโทร 081-234-5678',
    addressee: 'ร้านโซลาว\nเลขผู้เสียภาษี 1234567890123\nบัญชีธนาคาร 123-4-56789-0',
    supplier_code: 'AP-008', bank_account: '1234567890', phone: '0812345678' });
  let request;
  const normalized = await extractBillWithVision({ apiKey: 'mock-only', images: [{ image_data_url: makeJpegDataUrl() }],
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(raw) } }] }) }; } });
  assert.equal(request.messages[0].content, BILL_OCR_SYSTEM_PROMPT);
  assert.equal(normalized.ship_to, 'สาขาที่ 00002 (ร้านโซลาวบ้านแจ้)');
  assert.equal(normalized.addressee, 'ร้านโซลาว'); assert.equal(normalized.supplier_code, 'AP-008');
  assert.doesNotMatch(JSON.stringify(normalized), /081|123456789|123-4-56789/);
  assert.equal(normalized.bank_account, undefined);
  assert.equal(normalizeOcrPayload(bill({ doc_ref: 12345 })).doc_ref, '12345');
  assert.equal(normalizeOcrPayload(bill({ doc_ref: 'INV-'.padEnd(150, '9') })).doc_ref.length, 100);
  assert.equal(normalizeOcrPayload(bill({ supplier_code: '1234567890123' })).supplier_code, null);
});

test('P1 recipient branch aliases match without assuming branch database IDs; generic addressee stays uncertain', () => {
  const branches = [{ id: 11, name: 'สาขาสันกำแพง' }, { id: 55, name: 'คันคลอง' }];
  for (const alias of ['บ้านแจ้', 'สันกำแพง', 'ต้นเปา', 'สาขาที่ 00002 (ร้านโซลาวบ้านแจ้)']) {
    assert.equal(billBranchMismatch(alias, null, 11, branches), false);
    assert.equal(billBranchMismatch(alias, null, 55, branches), true);
  }
  assert.equal(billBranchMismatch('คันคลอง', null, 11, branches), true);
  assert.equal(billBranchMismatch('บริษัท โซลาว จำกัด', null, 11, branches), false);
  assert.equal(billBranchMismatch(null, null, 11, branches), false);
  assert.equal(billBranchMismatch('บ้านแจ้', null, 99, branches), null);
});

test('P1 OCR metadata and warnings survive save, reload and cached retry without private fields', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  const created = await h.invoke('createDocument', { user, body: { client_uuid: 'p1-metadata', delivery_date: h.today, supplier_name_text: 'ร้านแก๊ส' } });
  assert.equal(created.statusCode, 201);
  const id = created.body.data.id;
  assert.equal((await h.invoke('uploadImage', { user, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } })).statusCode, 201);
  let calls = 0;
  setCustomOcrProvider(async () => { calls++; return bill({ ship_to: 'คำเที่ยง', addressee: 'ร้านโซลาว โทร 0812345678', supplier_code: 'AP-008', total: 2957.02 }); });
  const first = await h.invoke('runOcr', { user, params: { id } });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.ocr.ship_to, 'คำเที่ยง'); assert.equal(first.body.data.ocr.supplier_code, 'AP-008');
  assert.equal(first.body.data.ocr.ship_to_mismatch, true);
  for (const code of ['SHIP_TO_MISMATCH', 'BILL_TOTAL_MISMATCH']) assert.ok(first.body.data.ocr.warnings.includes(code));
  const second = await h.invoke('runOcr', { user, params: { id } });
  assert.equal(second.statusCode, 200); assert.equal(calls, 1);
  assert.equal(second.body.data.ocr.ship_to, 'คำเที่ยง');
  assert.ok(second.body.data.warnings.some(w => w.code === 'SHIP_TO_MISMATCH'));
  assert.doesNotMatch(h.state.documents[0].ocr_result_json, /0812345678/);
  assert.equal((await h.invoke('runOcr', { user: { ...user, branch_id: 2, department_id: 20 }, params: { id } })).statusCode, 403);
  assert.equal(calls, 1);
});

test('#8 receiving product search validates context and uses bound literal search across four identifiers', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  const captured = [];
  const db = { query: async (sql, args) => {
    captured.push({ sql, args });
    if (sql.includes('FROM departments')) return [[{ id: args[0], branch_id: 1 }]];
    return [[{ id: 77, name: 'สินค้านอกใบสั่ง', code: 'P-77', barcode: '885123', qr_code: 'QR-77', unit_id: 2, unit_name: 'กก.' }]];
  } };
  for (const q of ['สินค้านอกใบสั่ง', 'P-77', '885123', 'QR-77', "x%' OR 1=1 --_"]) {
    const rows = await h.catalog.searchReceivingProducts({ user, filters: { q }, db });
    assert.equal(rows[0].id, 77); assert.equal(rows[0].unit_name, 'กก.');
    const call = captured.at(-1);
    for (const field of ['name', 'code', 'barcode', 'qr_code']) assert.ok(call.sql.includes(`p.${field} LIKE ?`));
    assert.equal(call.sql.includes(q), false);
    const pattern = `%${q.replace(/[!%_]/g, c => `!${c}`)}%`;
    assert.deepEqual(Array.from(call.args), [pattern, pattern, pattern, pattern, 1]);
    assert.doesNotMatch(call.sql, /gs.department_id/);
    assert.match(call.sql, /gs.branch_id = \?/);
    assert.match(call.sql, /p.is_active = true/);
  }
  for (const [actor, filters, status] of [[user, { q: 'x', branch_id: 2 }, 403], [user, { q: 'x', department_id: 30 }, 403],
    [user, { q: '' }, 422], [user, { q: ['x'] }, 422], [user, { q: 'x'.repeat(101) }, 422], [undefined, { q: 'x' }, 401],
    [user, { q: 'x', branch_id: '1 OR 1=1' }, 422]]) {
    const response = await h.invoke('searchProducts', { user: actor, query: filters });
    assert.equal(response.statusCode, status, JSON.stringify(response.body));
  }
  const ok = await h.invoke('searchProducts', { user, query: { q: 'x' } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers['cache-control'], 'private, no-store');
  const admin = { ...user, role: 'admin' };
  await h.catalog.searchReceivingProducts({ user: admin, filters: { q: 'x', branch_id: 1, department_id: 30 }, db });
  assert.equal(captured.at(-1).args.at(-1), 1);
});

test('#8 actual SELECT bypasses department only, filters foreign/inactive products, bounds results and treats SQL wildcards literally', async () => {
  const h = await createReceivingHarness({ testDate: '2026-10-20' });
  const sql = new DatabaseSync(':memory:');
  const db = { query: async (query, args = []) => [sql.prepare(query).all(...args)] };
  try {
    sql.exec(`CREATE TABLE departments(id INTEGER, branch_id INTEGER);
      CREATE TABLE units(id INTEGER, name TEXT);
      CREATE TABLE products(id INTEGER, name TEXT, code TEXT, barcode TEXT, qr_code TEXT, unit_id INTEGER, product_group_id INTEGER, is_active INTEGER);
      CREATE TABLE product_group_links(product_id INTEGER, product_group_id INTEGER);
      CREATE TABLE product_group_scopes(product_group_id INTEGER, branch_id INTEGER, department_id INTEGER);
      INSERT INTO departments VALUES(10,1),(30,1),(20,2);
      INSERT INTO units VALUES(2,'ถุง');
      INSERT INTO products VALUES(7,'น้ำแข็งกาแฟ','ICE-7','885001','QR-ICE',2,3,1),
        (8,'น้ำแข็งสาขาอื่น','ICE-8','885002','QR-OTHER',2,4,1),
        (9,'น้ำแข็งยกเลิก','ICE-9','885003','QR-INACTIVE',2,NULL,0),
        (10,'น้ำแข็งทั่วไป','ICE-10','885004','QR-GLOBAL',2,NULL,1),
        (11,'น้ำแข็ง primary ไม่มี link','ICE-11','885005','QR-PRIMARY',2,4,1);
      INSERT INTO product_group_links VALUES(7,3),(8,4);
      INSERT INTO product_group_scopes VALUES(3,1,30),(4,2,20);`);
    for (const q of ['กาแฟ', 'ICE-7', '885001', 'QR-ICE']) {
      const rows = await h.catalog.searchReceivingProducts({ user, filters: { q }, db });
      assert.deepEqual(Array.from(rows, row => row.id), [7]);
      assert.equal(rows[0].unit_name, 'ถุง');
    }
    // UX test 2026-10-23: a bill spelling without ร or tone marks still finds the catalogue name.
    sql.prepare('INSERT INTO products(id,name,is_active) VALUES(?,?,1)').run(12, 'ใบกระเพรา');
    for (const q of ['กะเพรา', 'ใบกะเพรา', 'ใบกระเพรา', 'กระเพรา']) assert.deepEqual(Array.from(await h.catalog.searchReceivingProducts({ user, filters: { q }, db }), row => row.id), [12], q);
    assert.equal((await h.catalog.searchReceivingProducts({ user, filters: { q: 'โหระพา' }, db })).length, 0);
    const all = await h.catalog.searchReceivingProducts({ user, filters: { q: 'น้ำแข็ง' }, db });
    assert.deepEqual(Array.from(all, row => row.id).sort(), [10,7]);
    for (const q of ['QR-OTHER', 'QR-PRIMARY', 'QR-INACTIVE', '%', '_', "' OR 1=1 --"]) {
      assert.equal((await h.catalog.searchReceivingProducts({ user, filters: { q }, db })).length, 0);
    }
    const admin = { ...user, role: 'admin' };
    assert.equal((await h.catalog.searchReceivingProducts({ user: admin, filters: { q: 'QR-OTHER', branch_id: 2, department_id: 20 }, db }))[0].id, 8);
    await assert.rejects(h.catalog.searchReceivingProducts({ user, filters: { q: 'QR-OTHER', branch_id: 2 }, db }), e => e.statusCode === 403);
    for (let id = 100; id < 125; id++) sql.prepare('INSERT INTO products(id,name,is_active) VALUES(?,?,1)').run(id, `limit-${id}`);
    assert.equal((await h.catalog.searchReceivingProducts({ user, filters: { q: 'limit-' }, db })).length, 20);
  } finally { sql.close(); }
});

test('#8 real authentication rejects missing, invalid and expired credentials before receiving product search', async () => {
  const context = vm.createContext({});
  const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const auth = new vm.SourceTextModule(await readFile(new URL('../src/middleware/auth.js', import.meta.url), 'utf8'), { context });
  await auth.link(() => synthetic({ verifyToken: () => { throw new Error('Invalid or expired mock'); } }));
  await auth.evaluate();
  const middleware = [], routes = [];
  const router = { use: fn => middleware.push(fn) };
  for (const method of ['get', 'post', 'put']) router[method] = (path, handler) => routes.push({ method, path, handler });
  let calls = 0; const searchProducts = () => { calls++; };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/routes/receiving-documents.routes.js', import.meta.url), 'utf8'), { context });
  await module.link(name => name === 'express' ? synthetic({ default: { Router: () => router, json: () => () => {} } })
    : name.endsWith('/auth.js') ? auth : synthetic({ searchProducts }));
  await module.evaluate();
  const route = routes.find(item => item.method === 'get' && item.path === '/products');
  assert.equal(route.handler, searchProducts);
  assert.ok(routes.indexOf(route) < routes.findIndex(item => item.path === '/:id'));
  for (const headers of [{}, { authorization: 'Bearer invalid-mock' }, { authorization: 'Bearer expired-mock' }]) {
    let status;
    middleware[0]({ headers }, { status(code) { status = code; return this; }, json() {} }, route.handler);
    assert.equal(status, 401);
  }
  assert.equal(calls, 0);
});
