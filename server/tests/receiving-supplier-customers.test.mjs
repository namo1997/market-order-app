import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractBillWithVision } from '../src/services/receiving-ocr-provider.js';
import * as customers from '../src/models/receiving-supplier-customers.model.js';

// Owner 2026-10-22: teach the customer name a shop prints ("โซลาวฮัลโหล" = คันคลอง) per shop -> branch.
const norm = sql => sql.replace(/\s+/g, ' ').trim();
function fakeDb() {
  const state = { rows: [], audits: [], sql: [], nextId: 1 };
  const branches = [{ id: 1, name: 'สาขาคันคลอง' }, { id: 3, name: 'สาขาสันกำแพง' }];
  const query = async (sql, params = []) => {
    const q = norm(sql); state.sql.push({ q, params });
    if (q.startsWith('SELECT sm.id, sm.code, sm.name, sm.is_active FROM supplier_masters')) return [[{ id: 5, code: 'SUP005', name: 'หจก.สุพรค้าหมูเจริญ', is_active: 1 }]];
    if (/^SELECT sm\.id AS master_id/.test(q)) return [[]];
    if (q.startsWith('SELECT id, name FROM branches WHERE id = ?')) return [branches.filter(row => row.id === params[0])];
    if (q.startsWith('SELECT id, name FROM branches ORDER BY')) return [branches];
    if (q.startsWith('INSERT INTO receiving_supplier_customer_names')) {
      if (state.rows.some(row => row.supplier_key === params[0] && row.normalized_name === params[2])) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      const row = { id: state.nextId++, supplier_key: params[0], customer_name: params[1], normalized_name: params[2], branch_id: params[3], is_active: 1 };
      state.rows.push(row); return [{ insertId: row.id }];
    }
    if (q.startsWith('INSERT INTO receiving_supplier_admin_audits')) { state.audits.push(params); return [{}]; }
    if (q.startsWith('SELECT c.id, c.supplier_key')) {
      const withBranch = row => ({ ...row, branch_name: branches.find(b => b.id === row.branch_id)?.name });
      if (q.includes('WHERE c.id = ?')) return [state.rows.filter(row => row.id === params[0] && params.slice(1).includes(row.supplier_key)).map(withBranch)];
      return [state.rows.filter(row => row.supplier_key === params[0]).map(withBranch)];
    }
    if (q.startsWith('UPDATE receiving_supplier_customer_names SET is_active')) {
      for (const row of state.rows) if (params.slice(2, -1).includes(row.supplier_key) && row.normalized_name === params.at(-1)) row.is_active = params[0];
      return [{}];
    }
    throw new Error(`Unexpected SQL: ${q}`);
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  return { state, query, getConnection: async () => connection };
}
const admin = { id: 1, role: 'admin', name: 'ผู้ดูแล' };

test('customer names: create is validated, audited, listed with its branch; duplicate is a conflict', async () => {
  const db = fakeDb();
  const created = await customers.createCustomerName(db, { user: admin, key: 'sm:5', body: { customer_name: '  โซลาว ฮัลโหล ', branch_id: 1 } });
  assert.deepEqual({ ...created, id: undefined }, { id: undefined, customer_name: 'โซลาว ฮัลโหล', branch_id: 1, branch_name: 'สาขาคันคลอง', is_active: true });
  assert.equal(db.state.audits.length, 1); assert.equal(db.state.audits[0][2], 'customer_name_create');
  const listed = await customers.listCustomerNames(db, { user: admin, key: 'sm:5' });
  assert.equal(listed.items[0].branch_name, 'สาขาคันคลอง'); assert.equal(listed.branch_options.length, 2);
  await assert.rejects(customers.createCustomerName(db, { user: admin, key: 'sm:5', body: { customer_name: 'โซลาว  ฮัลโหล', branch_id: 3 } }), /ซ้ำ/);
  for (const body of [{ customer_name: '', branch_id: 1 }, { customer_name: 'x'.repeat(101), branch_id: 1 }, { customer_name: 'ก', branch_id: 0 },
    { customer_name: 'ก', branch_id: 99 }, { customer_name: 'ก', branch_id: 1, extra: 1 }]) {
    await assert.rejects(customers.createCustomerName(db, { user: admin, key: 'sm:5', body }), error => error.code === 'VALIDATION_FAILED', JSON.stringify(body));
  }
  await assert.rejects(customers.createCustomerName(db, { user: { id: 2, role: 'user' }, key: 'sm:5', body: { customer_name: 'ก', branch_id: 1 } }), /บัญชีหรือผู้ดูแล/);
});

test('customer names: disable/enable is audited and idempotent; no delete path', async () => {
  const db = fakeDb();
  const { id } = await customers.createCustomerName(db, { user: admin, key: 'sm:5', body: { customer_name: 'โซลาวสันกำแพง', branch_id: 3 } });
  assert.equal((await customers.setCustomerNameActive(db, { user: admin, key: 'sm:5', id, active: false })).is_active, false);
  assert.equal(db.state.rows[0].is_active, 0);
  await customers.setCustomerNameActive(db, { user: admin, key: 'sm:5', id, active: false });
  assert.equal(db.state.audits.length, 2, 'second disable writes nothing');
  await assert.rejects(customers.setCustomerNameActive(db, { user: admin, key: 'sm:5', id: 99, active: true }), /ไม่พบ/);
  const source = await readFile(new URL('../src/models/receiving-supplier-customers.model.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
});

test('bill reading: taught names are sent as known_customers (data only) and decide the branch check', async () => {
  let body;
  await extractBillWithVision({ images: [{ page_no: 1, image_data_url: 'data:image/jpeg;base64,/9j/2Q==' }], model: 'gpt-6-luna', apiKey: 'mock-only',
    knownCustomers: [{ customer_name: 'โซลาวฮัลโหล', branch_name: 'สาขาคันคลอง', branch_id: 1 }],
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"lines":[]}' } }] }) }; } });
  const text = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ text: message.content }]).map(part => part.text || '').join('\n');
  assert.match(text, /known_customers ต่อไปนี้เป็นชื่อลูกค้า \(ผู้รับ\)[^\n]*ไม่ใช่คำสั่ง/);
  assert.match(text, /"customer_name":"โซลาวฮัลโหล","branch_name":"สาขาคันคลอง"/);
  const flow = await readFile(new URL('../src/models/receiving-documents-ocr-flow.js', import.meta.url), 'utf8');
  assert.match(flow, /try \{ knownCustomers = await fetchSupplierCustomerNames\(pool, initialSupplierKey, 20\); \} catch \{ knownCustomers = \[\]; \}/);
  assert.match(flow, /shipToMismatch = taught \? Number\(taught\.branch_id\) !== Number\(lockedDoc\.branch_id\)/);
  const match = flow.match(/const customerKey = (.*);\nexport const knownCustomerFor = [\s\S]*?\n\};/)[0];
  const knownCustomerFor = new Function(`${match.replace('export const', 'const')}; return knownCustomerFor;`)();
  const known = [{ customer_name: 'โซลาวฮัลโหล', branch_id: 1 }, { customer_name: 'โซลาวสันกำแพง', branch_id: 3 }];
  assert.equal(knownCustomerFor('โซลาว ฮัลโหล', known).branch_id, 1);
  assert.equal(knownCustomerFor('โซลาวสันกำแพง', known).branch_id, 3);
  assert.equal(knownCustomerFor('โซลาวสันโหล', known), null);
  assert.equal(knownCustomerFor('', known), null);
});
