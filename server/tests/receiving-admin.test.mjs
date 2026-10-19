import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import * as model from '../src/models/receiving-admin.model.js';
import * as ocr from '../src/services/receiving-ocr.service.js';
import { toBangkokDateKey } from '../src/utils/bangkok-date.js';
import { createReceivingHarness, makePngDataUrl, makeJpegDataUrl } from './helpers/receiving-fake-db.mjs';
const roles = ['admin', 'super_admin', 'accounting', 'accountant'];
function database() {
  const sql = [];
  return { sql, async query(query, values = []) {
    assert.match(query.trim(), /^SELECT /); // Read-only includes absence of lazy CREATE/ALTER.
    sql.push({ query, values });
    if (query.includes('AS ledger_document_id')) return [[{ledger_document_id:7,id:1,total:'0.30',quantity_received:'0.30',quantity_billed:'0.30',unit_price:'1.00',amount:'0.30'}]];
    if (query.includes('WHERE line.document_id IN')) return [[{document_id:7,id:1,quantity_received:'0.30',quantity_billed:'0.30',unit_price:'1.00',amount:'0.30'}]];
    if (query.includes('AS pending_issue_count')) return [[{pending_issue_count:3}]];
    if (query.includes('AS total_count')) return [[{ total_count: 3, today_count: 1, draft_count: 1, confirmed_total: '0.30', unknown_total_count: 1 }]];
    if (query.includes('AS has_discrepancy')) return [[{ id: 7, branch_id: 2, department_id: 20, status: 'confirmed', receiving_scope: 'branch', total: '0.30', delivery_date: '2026-10-18', has_discrepancy: 1, branch_name: 'สาขาสอง' }]];
    if (query.includes('FROM receiving_documents rd')) return values[0] === 999 ? [[]] : [[{ id: 7, branch_id: 2, department_id: 20, status: 'void', receiving_scope: 'branch', total: '0.30', voided_at: '2026-10-18 12:00:00', void_reason: 'ซ้ำ', receiver_signature: Buffer.from('never select'), has_receiver_signature: 1 }]];
    if (query.includes('FROM receiving_document_lines')) return [[{ id: 1, line_no: 1, quantity_received: '0.30', counted_quantity: '0.20', quantity_ordered: '1.00' }, { id: 2, line_no: 2, quantity_received: '0.00', quantity_ordered: null }]];
    if (query.includes('FROM receiving_document_images')) return [[{ id: 11, page_no: 1 }]];
    if (query.includes('FROM receiving_issues')) return [[]];
    if (query.includes('FROM receiving_document_audits')) return [[{ id: 1, action: 'void', actor_name: 'บัญชี', created_at: '2026-10-18 12:00:00' }]];
    if (query.includes('FROM branches')) return [[{ id: 2, name: 'สาขาสอง' }]];
    if (query.includes('FROM departments')) return [[{ id: 20, branch_id: 2, name: 'ครัว' }]];
    throw new Error('Unexpected SQL');
  } };
}
async function api() {
  const db = database(), context = vm.createContext({ console: { error() {} } }), retained = [];
  const synth = values => { const mod = new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context }); retained.push(mod); return mod; };
  const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const errors = new vm.SourceTextModule(await read('controllers/receiving-documents.controller.js'), { context });
  await errors.link(name => synth(name.endsWith('/receiving-ocr.service.js') ? ocr : {})); await errors.evaluate();
  const controller = new vm.SourceTextModule(await read('controllers/receiving-admin.controller.js'), { context });
  await controller.link(name => name.endsWith('/database.js') ? synth({ default: db }) : name.endsWith('/receiving-admin.model.js') ? synth(model) : errors);
  await controller.evaluate();
  const auth = new vm.SourceTextModule(await read('middleware/auth.js'), { context });
  await auth.link(() => synth({ verifyToken: value => {
    if (!roles.includes(value) && value !== 'user') throw new Error('Fixture invalid');
    return { id: 12, role: value, branch_id: 1, department_id: 10 };
  } })); await auth.evaluate();
  const router = new vm.SourceTextModule(await read('routes/receiving-admin.routes.js'), { context });
  await router.link(name => name === 'express' ? synth({ default: express }) : name.endsWith('/auth.js') ? auth : controller);
  await router.evaluate();
  const app = express(); app.use('/api/receiving-admin', router.namespace.default);
  const request = (url, role, method = 'GET') => new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket()); req.url = `/api/receiving-admin${url}`; req.method = method;
    req.headers = role ? { authorization: `Bearer ${role}` } : {};
    const res = new ServerResponse(req);
    res.end = data => { resolve({ status: res.statusCode, body: data ? JSON.parse(String(data)) : null, headers: res.getHeaders() }); return res; };
    app.handle(req, res, error => error ? reject(error) : resolve({ status: 404 })); req.push(null);
  });
  return { request, db, retained };
}
test('admin API: every route uses real authenticate for absent/invalid/expired sessions; staff gets 403 without SQL', async () => {
  const h = await api();
  for (const path of ['/', '/options', '/issues-summary', '/7']) {
    for (const role of [undefined, 'invalid', 'expired']) assert.equal((await h.request(path, role)).status, 401);
    assert.equal((await h.request(path, 'user')).status, 403);
  }
  assert.equal(h.db.sql.length, 0);
});
test('admin API: all four roles can read across branches/departments; private responses, decimal totals, no binary/metadata leakage', async () => {
  const h = await api();
  for (const role of roles) {
    const list = await h.request('/?page=2&page_size=1', role);
    assert.equal(list.status, 200); assert.equal(list.body.data.items[0].branch_id, 2);
    assert.equal(list.body.data.items[0].scope, 'branch'); assert.equal(list.body.data.items[0].has_discrepancy, true);
    assert.deepEqual(list.body.data.pagination, { page: 2, page_size: 1, total: 3, total_pages: 3 });
    assert.equal(list.body.data.summary.confirmed_total, '0.30'); assert.equal(list.body.data.summary.unknown_total_count, 1);
    assert.equal(list.body.data.summary.received_known_total,'0.30');
    const summary=await h.request('/issues-summary',role);assert.equal(summary.status,200);
    assert.equal(summary.body.data.pending_issue_count,3);assert.equal(summary.headers['cache-control'],'private, no-store');
    assert.equal(list.headers['cache-control'], 'private, no-store');
    assert.equal((await h.request('/options', role)).body.data.departments[0].branch_id, 2);
    const detail = await h.request('/7', role);
    assert.equal(detail.status, 200); assert.equal(detail.body.data.lines[0].counted_quantity, '0.2');
    assert.equal(detail.body.data.lines[1].counted_quantity, null); assert.equal(detail.body.data.lines[1].quantity_ordered, null);
    assert.equal(detail.body.data.audits[0].action, 'void'); assert.equal(detail.body.data.void_reason, 'ซ้ำ');
    assert.equal(detail.body.data.receiver_signature, undefined);
    assert.equal(detail.headers['cache-control'], 'private, no-store');
  }
});
test('admin API: date/branch/department/scope/shop/status/discrepancy filters and stable pagination are parameterized', async () => {
  const h = await api();
  const res = await h.request('/?date_from=2026-10-01&date_to=2026-10-18&branch_id=2&department_id=20&scope=department&supplier=O%27Reilly%25_&status=draft&discrepancy=yes&page=3&page_size=10', 'accountant');
  assert.equal(res.status, 200);
  const statement = h.db.sql.find(item=>item.query.includes('LIMIT ? OFFSET ?'));
  assert.deepEqual([...statement.values], ['2026-10-01', '2026-10-18', 2, 20, 'department', 'draft', "O'Reilly%_", 10, 20]);
  assert.match(statement.query, /quantity_billed IS NOT NULL/); assert.match(statement.query, /quantity_received <> problem.quantity_billed/);
  assert.match(statement.query, /ORDER BY rd.delivery_date DESC, rd.id DESC LIMIT \? OFFSET \?/);
  assert.ok(!statement.query.includes("O'Reilly")); assert.match(statement.query, /LOCATE\(\?, rd.supplier_name_text\)/);
  assert.match(model.ledgerFilters({ discrepancy: 'no' }).where, /NOT EXISTS/);
});
test('admin API: all malformed filters reject 422 before SQL; missing detail 404; no write routes', async () => {
  const h = await api();
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1000001', 'page_size=101', 'branch_id=1%20OR%201=1', 'department_id=-2',
    'date_from=2026-02-30', 'date_from=2569-10-18', 'date_from=2026-10-19&date_to=2026-10-18', 'scope=all', 'status=deleted', 'discrepancy=true',
    'supplier=x&supplier=y', 'branch_id[a]=1', `supplier=${'x'.repeat(256)}`]) {
    assert.equal((await h.request(`/?${query}`, 'admin')).status, 422, query);
  }
  assert.equal(h.db.sql.length, 0);
  assert.equal((await h.request('/999', 'admin')).status, 404);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await h.request('/7', 'admin', method)).status, 404);
});
test('admin summary: Bangkok date changes at UTC 17:00, not UTC midnight', async () => {
  assert.equal(toBangkokDateKey('2026-10-17T16:59:59Z'), '2026-10-17');
  const today = toBangkokDateKey('2026-10-17T17:00:00Z'); assert.equal(today, '2026-10-18');
  const db = database(); await model.listLedger(db, { user: { role: 'admin' }, today });
  assert.equal(db.sql[0].values[0], '2026-10-18');
});
test('accounting binary reads: existing endpoints allow cross-branch image/signature only; staff IDOR and accounting writes remain blocked', async () => {
  const h = await createReceivingHarness();
  const owner = { id: 12, name: 'ผู้รับ', role: 'user', branch_id: 1, department_id: 10 };
  const created = await h.invoke('createDocument', { user: owner, body: { client_uuid: 'admin-read-only', delivery_date: h.today, kind: 'manual_receipt' } });
  const id = created.body.data.id;
  const uploaded = await h.invoke('uploadImage', { user: owner, params: { id }, body: { page_no: 1, image_data_url: makeJpegDataUrl() } });
  assert.equal(uploaded.statusCode, 201);
  await h.invoke('addSignature', { user: owner, params: { id }, body: { role: 'receiver', image_data_url: makePngDataUrl() } });
  for (const role of ['accounting', 'accountant']) {
    const user = { ...owner, role, branch_id: 2, department_id: 20 };
    for (const status of ['draft', 'confirmed', 'void']) {
      h.state.documents[0].status = status;
      const before = structuredClone(h.state);
      const image = await h.invoke('getImageBinary', { user, params: { id, imageId: uploaded.body.data.image_id } });
      assert.equal(image.statusCode, 200);
      assert.equal(image.headers['cache-control'], 'private, no-store');
      assert.equal((await h.invoke('getSignatureBinary', { user, params: { id, role: 'receiver' } })).statusCode, 200);
      assert.deepEqual(structuredClone(h.state), before);
    }
    h.state.documents[0].status = 'draft';
    for (const name of ['updateDocument', 'confirmDocument', 'voidDocument', 'addSignature', 'runOcr']) {
      const result = await h.invoke(name, { user, params: { id }, body: { reason: 'wrong', role: 'receiver', image_data_url: makePngDataUrl() } });
      assert.equal(result.statusCode, 403, name);
    }
    assert.equal((await h.invoke('getImageBinary', { user, params: { id, imageId: 999 } })).statusCode, 404);
  }
  for (const foreign of [{ branch_id: 2, department_id: 20 }, { branch_id: 1, department_id: 30 }]) {
    const user = { ...owner, ...foreign };
    assert.equal((await h.invoke('getImageBinary', { user, params: { id, imageId: uploaded.body.data.image_id } })).statusCode, 403);
    assert.equal((await h.invoke('getSignatureBinary', { user, params: { id, role: 'receiver' } })).statusCode, 403);
  }
});

test('admin API: database failures are sanitized; absent schema returns 503 without attempting migration', async () => {
  const h = await api();
  h.db.query = async () => { throw Object.assign(new Error('private SQL detail'), { code: 'ER_BAD_FIELD_ERROR' }); };
  const error = await h.request('/', 'admin');
  assert.equal(error.status, 500); assert.equal(error.body.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(error.body).includes('private')); assert.equal(error.body.stack, undefined);
  const summary=await h.request('/issues-summary','accounting');
  assert.equal(summary.status,500);assert.equal(summary.body.code,'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(summary.body).includes('private'));assert.equal(summary.body.stack,undefined);
  h.db.query = async () => { throw Object.assign(new Error('private table name'), { code: 'ER_NO_SUCH_TABLE' }); };
  const absent = await h.request('/7', 'accounting');
  assert.equal(absent.status, 503); assert.equal(absent.body.code, 'RECEIVING_NOT_READY');
  assert.ok(!JSON.stringify(absent.body).includes('private table'));
});


test('integration blind ledger: all four roles redact uncounted drafts in list/detail; reveal only after count or confirmation', async () => {
  for (const role of roles) for (const status of ['draft', 'confirmed', 'void']) for (const counted of [null, '2026-10-18 01:00:00']) {
    const db = database(), query = db.query;
    db.query = async (sql, values) => {
      const [rows] = await query(sql, values);
      if (sql.includes('FROM receiving_documents rd') && !sql.includes('AS total_count')) return [rows.map(row => ({ ...row, status, counted_complete_at: counted, total: '98765', doc_ref: 'SECRET', ocr_result_json: JSON.stringify({ raw_read: { total: 98765 } }) }))];
      return [rows];
    };
    const list = await model.listLedger(db, { user: { role } });
    const detail = await model.ledgerDetail(db, { user: { role }, id: 7 });
    const locked = status === 'draft' && !counted;
    for (const result of [list.items[0], detail]) {
      assert.equal(result.total, locked ? null : '98765.00');
      if (locked) {
        assert.equal(result.blind, true); assert.doesNotMatch(JSON.stringify(result), /SECRET|98765/);
        for (const line of result.lines || []) for (const field of ['quantity_received','quantity_billed','quantity_ordered','unit_price','amount','bill_read','departments']) assert.equal(field in line, false, field);
      }
    }
    if (locked) assert.equal(list.items[0].has_discrepancy, null);
    assert.match(model.ledgerFilters({discrepancy:'yes'}).where, /counted_complete_at IS NOT NULL/);
  }
});
test('integration accounting image: cross-branch binary GET cannot reveal an uncounted draft', async () => {
  const h = await createReceivingHarness({prepareCount:false});
  const owner = {id:12,name:'ผู้รับ',role:'user',branch_id:1,department_id:10};
  const created = await h.invoke('createDocument',{user:owner,body:{client_uuid:'accounting-blind',delivery_date:h.today,kind:'manual_receipt'}});
  const id = created.body.data.id;
  const uploaded = await h.invoke('uploadImage',{user:owner,params:{id},body:{page_no:1,image_data_url:makeJpegDataUrl()}});
  for (const role of roles) {
    const reader = {...owner,role,branch_id:2,department_id:20};
    assert.equal((await h.invoke('getImageBinary',{user:reader,params:{id,imageId:uploaded.body.data.image_id}})).statusCode,409);
    assert.equal((await h.invoke('getSignatureBinary',{user:reader,params:{id,role:'receiver'}})).statusCode,409);
  }
});
