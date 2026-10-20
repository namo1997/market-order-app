import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as crypto from 'node:crypto';
import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import * as model from '../src/models/receiving-ap-export.model.js';
import { exportDocument, exportLine, bangkokTimestamp } from '../src/models/receiving-ap-export-values.js';

// Synthetic authorization lives only in memory. No env file, database, network,
// OCR provider or messaging client is loaded by this harness.
const auth = () => ['synthetic', 'export', 'credential'].join('-');
const epoch = value => String(new Date(value).getTime() / 1000);
const first = epoch('2026-10-20T16:59:59Z'), second = epoch('2026-10-20T17:00:00Z');
const doc = (id, extra = {}) => ({ id, status: 'confirmed', kind: 'bill', branch_id: 3, department_id: 12,
  receiving_scope: 'department', supplier_master_id: 7, product_group_id: null, supplier_name_text: 'ร้านทดสอบ',
  branch_code: 'TEST', branch_name: 'สาขาทดสอบ', department_name: 'ครัวทดสอบ',
  updated_epoch: first, confirmed_epoch: first, voided_epoch: null,
  receipt_date: '2026-10-20', export_doc_date: '2026-10-19', doc_ref: 'SYNTHETIC-INV',
  subtotal: '0.30', discount: '0.00', vat: '0.00', total: '0.30', master_ap_code: 'AP-TEST', image_count: 1, ...extra });
const line = (document_id, extra = {}) => ({ id: document_id * 10, document_id, product_id: 55,
  product_name: 'สินค้าทดสอบ', item_code: null, bill_text: 'ข้อความสินค้าทดสอบ',
  quantity_received: '0.30', unit_text: 'ถุง', unit_multiplier: '1.0000', unit_price: '1.000000',
  base_unit_price: '1.000000', review_decision: 'accept', ...extra });

function database({ rows = [doc(1), doc(2), doc(3, { updated_epoch: second })], lines = rows.map(row => line(row.id)),
  issues = [], followups = [], failure } = {}) {
  const calls = [], events = [];
  return { calls, events, rows, async getConnection() { events.push('acquire'); return this; },
    async query(sql, params = []) {
      calls.push({ sql, params: [...params] });
      if (sql.startsWith('SET TRANSACTION')) { events.push('isolation'); return [[]]; }
      if (sql.startsWith('START TRANSACTION')) { events.push('snapshot'); return [[]]; }
      assert.match(sql, /^SELECT /);
      if (failure) throw Object.assign(new Error('SYNTHETIC private SQL/stack'), { code: failure });
      if (sql.includes('FROM receiving_documents d')) {
        let result = rows.filter(row => ['confirmed','void'].includes(row.status));
        let offset = 0;
        if (sql.includes('d.updated_at >= FROM_UNIXTIME(?)')) {
          const since = Number(params[offset++]);
          result = result.filter(row => Number(row.updated_epoch) >= since);
        }
        if (sql.includes('d.id > ?')) {
          const time = Number(params[offset]), id = params[offset + 2];
          offset += 3;
          result = result.filter(row => Number(row.updated_epoch) > time || Number(row.updated_epoch) === time && row.id > id);
        }
        assert.equal(params.length, offset + 1);
        return [[...result].sort((a,b) => Number(a.updated_epoch) - Number(b.updated_epoch) || a.id-b.id).slice(0,params.at(-1))];
      }
      if (sql.includes('FROM receiving_document_lines WHERE')) return [lines.filter(row => params.includes(Number(row.document_id)))];
      if (sql.includes('FROM receiving_issues i')) return [issues.filter(row => params.includes(Number(row.document_id)) && ['open','waiting_supplier','resolved'].includes(row.status))];
      if (sql.includes('FROM receiving_followups')) return [followups];
      throw new Error('Unexpected SQL');
    }, async commit() { events.push('commit'); }, async rollback() { events.push('rollback'); }, release() { events.push('release'); } };
}
async function api(options = {}) {
  const db = database(options), config = options.disabled ? {} : { RECEIVING_EXPORT_TOKEN: options.blank ? '   ' : auth() };
  const context = vm.createContext({ Buffer, Date, process: { env: {} } }), retained = [];
  const synth = values => { const result = new vm.SyntheticModule(Object.keys(values), function() {
    for (const [key,value] of Object.entries(values)) this.setExport(key,value);
  }, { context }); retained.push(result); return result; };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/routes/receiving-ap-export.routes.js', import.meta.url), 'utf8'), { context });
  await module.link(name => synth(name === 'express' ? { default: express } : name === 'node:crypto' ? crypto
    : name.endsWith('/database.js') ? { default: db } : model));
  await module.evaluate();
  const app = express(); app.use('/api/receiving-export', module.namespace.createReceivingApExportRouter({ db,
    env: () => config, now: () => new Date('2026-10-20T17:00:00Z') }));
  function request(query = '', authorization = `Bearer ${auth()}`, method = 'GET', path = '/ap/v1/documents') {
    return new Promise((resolve,reject) => {
      const req = new IncomingMessage(new Socket()); req.url = `/api/receiving-export${path}${query}`; req.method = method;
      req.headers = authorization === null ? {} : { authorization };
      const res = new ServerResponse(req);
      res.end = data => { resolve({ status: res.statusCode, headers: res.getHeaders(), body: data ? JSON.parse(String(data)) : null }); return res; };
      app.handle(req,res,error => error ? reject(error) : resolve({ status: 404 })); req.push(null);
    });
  }
  return { db, request, retained };
}
test('AP export authentication: unset/blank config 503; absent, malformed, wrong and employee sessions 401 before SQL', async () => {
  const off = await api({ disabled: true });
  const res = await off.request(); assert.equal(res.status,503); assert.equal(res.body.code,'EXPORT_DISABLED');
  assert.equal(off.db.calls.length,0); assert.equal(off.db.events.length,0);
  assert.equal((await (await api({blank:true})).request()).body.code,'EXPORT_DISABLED');
  const h = await api();
  for (const header of [null, '', 'Basic synthetic', 'Bearer', 'Bearer wrong', 'Bearer synthetic-expired-session', 'Bearer employee-jwt', `Bearer ${auth()} extra`]) {
    const r = await h.request('',header); assert.equal(r.status,401); assert.equal(r.body.code,'UNAUTHORIZED');
    assert.equal(r.headers['cache-control'],'private, no-store');
  }
  assert.equal(h.db.events.length,0);
  assert.equal((await h.request('',`bearer ${auth()}`)).status,200);
  const source = await readFile(new URL('../src/routes/receiving-ap-export.routes.js',import.meta.url),'utf8');
  assert.match(source,/timingSafeEqual\(digest\(/);
});
test('AP export wire contract: exact allowlist, Thai identity, +07 timestamps, integer satang, decimal quantities and no raw/private fields', async () => {
  const h = await api({ rows:[doc(1,{ bank_account:'SYNTHETIC_PRIVATE',tax_id:'SYNTHETIC_PRIVATE',phone:'SYNTHETIC_PRIVATE',
    ocr_result_json:'SYNTHETIC_PRIVATE',receiver_signature:'SYNTHETIC_PRIVATE',audit_json:'SYNTHETIC_PRIVATE' })] });
  const r = await h.request(); assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.body),['version','generated_at','next_cursor','documents']);
  assert.equal(r.body.version,1); assert.equal(r.body.generated_at,'2026-10-21T00:00:00.000+07:00');
  assert.equal(r.body.next_cursor,null);
  assert.deepEqual(r.body.documents[0],{
    document_id:1,status:'confirmed',updated_at:'2026-10-20T23:59:59.000+07:00',confirmed_at:'2026-10-20T23:59:59.000+07:00',voided_at:null,
    receipt_date:'2026-10-20',branch:{id:3,code:'TEST',name:'สาขาทดสอบ'},department:{id:12,name:'ครัวทดสอบ'},receiving_scope:'department',
    supplier:{key:'sm:7',master_id:7,product_group_id:null,name:'ร้านทดสอบ',ap_code:'AP-TEST',ap_code_source:'master_code'},
    doc_kind:'bill',doc_ref:'SYNTHETIC-INV',doc_date:'2026-10-19',bill_totals_satang:{subtotal:30,discount:0,vat:0,total:30},
    received_value_satang:30,price_status:'from_bill',lines:[{line_id:10,product_id:55,product_name:'สินค้าทดสอบ',item_code:null,
      bill_text:'ข้อความสินค้าทดสอบ',quantity_received:'0.30',unit:'ถุง',unit_price_satang:100,amount_satang:30,decision:'accept'}],open_issues:[],image_count:1 });
  assert.ok(!JSON.stringify(r.body).includes('SYNTHETIC_PRIVATE'));
  const sql = h.db.calls.map(call => call.sql).join('\n');
  assert.doesNotMatch(sql,/SELECT\s+(?:\w+\.)?\*|image_data|signature|account_number|tax_id|phone|raw_read/);
  assert.match(sql,/JSON_EXTRACT\(d.ocr_result_json,'\$\.doc_kind'\)/);
  assert.deepEqual(h.db.events,['acquire','isolation','snapshot','commit','release']);
});
test('AP export keyset: tied timestamps, replay, page limits, empty/exact/end pages and draft exclusion', async () => {
  const h = await api({rows:[doc(3,{updated_epoch:second}),doc(2),doc(4,{status:'draft'}),doc(1)]});
  const page1 = await h.request('?limit=1'); const replay = await h.request('?limit=1');
  assert.deepEqual(page1.body,replay.body); assert.deepEqual(page1.body.documents.map(d=>d.document_id),[1]);
  const page2 = await h.request(`?limit=1&cursor=${page1.body.next_cursor}`);
  const page3 = await h.request(`?limit=1&cursor=${page2.body.next_cursor}`);
  assert.deepEqual(page2.body.documents.map(d=>d.document_id),[2]); assert.deepEqual(page3.body.documents.map(d=>d.document_id),[3]);
  assert.equal(page3.body.next_cursor,null);
  assert.equal((await h.request('?limit=3')).body.next_cursor,null);
  const empty = await api({rows:[]}); assert.deepEqual((await empty.request()).body.documents,[]);
  assert.equal((await empty.request()).body.next_cursor,null);
  const statements = h.db.calls.filter(c=>c.sql.includes('FROM receiving_documents d'));
  assert.match(statements[1].sql,/ORDER BY d.updated_at, d.id LIMIT \?/);
  assert.ok(statements.some(c=>c.sql.includes('d.id > ?') && c.params.at(-2)===1));
  assert.equal((await h.request('?limit=500')).status,200);
  assert.equal(h.db.calls.filter(c=>c.sql.includes('FROM receiving_documents d')).at(-1).params.at(-1),501);
});
test('AP export updated_since is inclusive, offset-equivalent and bound to its cursor; void replaces confirmed without losing history', async () => {
  const h = await api();
  const query = '?limit=1&updated_since=2026-10-20T23%3A59%3A59%2B07%3A00';
  const p1 = await h.request(query); assert.deepEqual(p1.body.documents.map(d=>d.document_id),[1]);
  const p2 = await h.request(`?limit=1&updated_since=2026-10-20T16%3A59%3A59Z&cursor=${p1.body.next_cursor}`);
  assert.deepEqual(p2.body.documents.map(d=>d.document_id),[2]);
  assert.equal((await h.request(`?cursor=${p1.body.next_cursor}`)).status,422);
  assert.deepEqual((await h.request('?updated_since=2026-10-20T17%3A00%3A00Z')).body.documents.map(d=>d.document_id),[3]);
  Object.assign(h.db.rows[0],{status:'void',updated_epoch:second,voided_epoch:second});
  const changed = (await h.request('?updated_since=2026-10-20T17%3A00%3A00Z')).body.documents;
  assert.equal(changed[0].document_id,1); assert.equal(changed[0].status,'void');
  assert.equal(changed[0].confirmed_at,'2026-10-20T23:59:59.000+07:00');
  assert.equal(changed[0].voided_at,'2026-10-21T00:00:00.000+07:00');
  assert.equal(changed[0].received_value_satang,30);
});
test('AP export rejects malformed query/cursor, injection, arrays, bad dates and out-of-range limit with 422 and no SQL', async () => {
  const h = await api();
  const curs = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const query of ['limit=0','limit=501','limit=-1','limit=1.5','limit=01','limit=1&limit=2','limit[x]=1',
    'updated_since=2026-02-30T00:00:00Z','updated_since=1969-10-20T00:00:00Z','updated_since=2026-10-20',
    'updated_since=2026-10-20T24:00:00Z','updated_since=2026-10-20T00:00:00','cursor=', 'cursor=not-json','cursor[]=bad',
    'limit=1%20OR%201=1','order_by=id','updated_since=x&updated_since=y',`cursor=${'x'.repeat(1025)}`,
    `cursor=${curs({v:2,since:null,after:[first,1]})}`,`cursor=${curs({v:1,since:null,after:[first,0]})}`,
    `cursor=${curs({v:1,since:null,after:['0 OR 1=1',1]})}`,`cursor=${curs({v:1,since:null,after:[first,1.5]})}`]) {
    assert.equal((await h.request(`?${query}`)).status,422,query);
  }
  assert.equal(h.db.calls.length,0); assert.equal(h.db.events.length,0);
});
test('AP export ap_code: explicit same-branch active binding precedes master; group code is never a master AP fallback', async () => {
  const h = await api({rows:[doc(1,{branch_ap_code:'AP-BRANCH'}),doc(2),doc(3,{supplier_master_id:null,product_group_id:9,master_ap_code:null})]});
  const documents = (await h.request()).body.documents;
  assert.deepEqual(documents.map(d=>[d.supplier.ap_code,d.supplier.ap_code_source]),[['AP-BRANCH','branch_code'],['AP-TEST','master_code'],[null,'none']]);
  assert.equal(documents[2].supplier.key,'pg:9');
  const sql = h.db.calls.find(c=>c.sql.includes('FROM receiving_documents d')).sql;
  assert.match(sql,/bc.is_active = 1 AND bc.branch_id = d.branch_id/); assert.match(sql,/bc.supplier_key = CASE/);
  assert.doesNotMatch(sql,/branch_note|pg.code/);
});
test('AP export no-bill, partial unknown prices, zero quantities and statement-only references never invent a purchase', async () => {
  const h = await api({rows:[doc(1,{kind:'manual_receipt',total:null,subtotal:null}),doc(2,{export_ocr_kind:'statement'}),
    doc(3,{kind:'manual_receipt'}),doc(4,{export_ocr_kind:'statement'}),doc(5)],
    lines:[line(1,{unit_price:null,base_unit_price:null}),line(3),line(4)]});
  const docs = (await h.request()).body.documents;
  assert.equal(docs[0].doc_kind,'no_bill'); assert.equal(docs[0].price_status,'needs_accounting_price');
  assert.equal(docs[0].received_value_satang,null); assert.equal(docs[0].bill_totals_satang.total,null);
  assert.equal(docs[0].lines[0].amount_satang,null); assert.equal(docs[0].lines[0].unit_price_satang,null);
  assert.equal(docs[1].doc_kind,'statement_only'); assert.equal(docs[1].received_value_satang,0); assert.deepEqual(docs[1].lines,[]);
  assert.equal(docs[2].doc_kind,'no_bill'); assert.equal(docs[2].received_value_satang,30);
  assert.equal(docs[3].doc_kind,'bill'); assert.equal(docs[4].received_value_satang,null);
  assert.equal(exportLine(line(1,{quantity_received:'0',base_unit_price:null,unit_price:null})).amount_satang,0);
  assert.equal(exportDocument(doc(1),[line(1),line(1,{id:11,base_unit_price:null,unit_price:null})],[]).received_value_satang,null);
});
test('AP export satang uses base bill price and six decimals before extension, stable half-up rounding and safe large totals', () => {
  assert.equal(exportLine(line(1,{quantity_received:'10',base_unit_price:'29.500000',unit_price:'354',unit_multiplier:'12'})).amount_satang,29500);
  assert.equal(exportLine(line(1,{quantity_received:'10',base_unit_price:null,unit_price:'354',unit_multiplier:'12'})).amount_satang,29500);
  assert.equal(exportLine(line(1,{quantity_received:'100',base_unit_price:'0.123456'})).amount_satang,1235);
  assert.equal(exportLine(line(1,{quantity_received:'0.50',base_unit_price:'0.010000'})).amount_satang,1);
  const result = exportDocument(doc(1),[line(1,{quantity_received:'0.1'}),line(1,{quantity_received:'0.2'})],[]);
  assert.equal(result.received_value_satang,30);
  assert.ok(Number.isSafeInteger(exportLine(line(1,{quantity_received:'9999999.99',base_unit_price:'999999.999999'})).amount_satang));
  assert.throws(()=>exportLine(line(1,{quantity_received:'99999999.99',base_unit_price:'999999.999999'})),/Invalid receiving line value/);
});
test('AP export issue projection maps shortage/waiting, bill and price followups, resolved credit ref; cancels and unrelated refs stay absent', async () => {
  const h = await api({rows:[doc(1)],issues:[{document_id:1,type:'shortage',status:'waiting_supplier'},
    {document_id:1,type:'return',status:'resolved',resolution:'credit_note',resolution_ref:'SYNTHETIC-CN'},
    {document_id:1,type:'wrong_item',export_type:'request_bill',status:'open'},
    {document_id:1,type:'return',status:'cancelled'}], followups:[{status:'acknowledged',pending_items_json:JSON.stringify([
      {document_id:1,review_decision:'price_review'},{document_id:1,review_decision:'missing_bill'},{document_id:999,review_decision:'price_review'}])}]});
  assert.deepEqual((await h.request()).body.documents[0].open_issues,[{type:'short',status:'open',credit_note_ref:null},
    {type:'return',status:'resolved',credit_note_ref:'SYNTHETIC-CN'},{type:'request_bill',status:'open',credit_note_ref:null},
    {type:'price_review',status:'open',credit_note_ref:null}]);
});
test('AP export safely reports unavailable schema/DB, rolls back snapshot and never returns SQL/stack', async () => {
  for (const [failure,status,code] of [['ER_NO_SUCH_TABLE',503,'RECEIVING_NOT_READY'],['ER_BAD_FIELD_ERROR',503,'RECEIVING_NOT_READY'],['ER_PARSE_ERROR',500,'EXPORT_FAILED']]) {
    const h = await api({failure}); const r = await h.request(); assert.equal(r.status,status); assert.equal(r.body.code,code);
    assert.ok(!JSON.stringify(r.body).includes('SYNTHETIC private')); assert.deepEqual(h.db.events,['acquire','isolation','snapshot','rollback','release']);
  }
});
test('AP export is GET-only and mounted under its own service prefix', async () => {
  const h = await api();
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await h.request('',undefined,method)).status,404);
  assert.equal(h.db.calls.length,0);
  const source = await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(source,/app.use\('\/api\/receiving-export', receivingApExportRoutes\)/);
  assert.equal(bangkokTimestamp(null),null);
});
test('AP export additive schema is idempotent and only adds branch binding/keyset indexes, without runtime migration', async () => {
  const source = await readFile(new URL('../src/models/receiving-documents-schema.js',import.meta.url),'utf8');
  const calls = [], columns = new Set(), indexes = new Set();
  const db = { async query(sql,params=[]) {
    calls.push(sql);
    if (sql.startsWith('SHOW COLUMNS')) return [columns.has(`${sql.split(' ')[3]}:${params[0]}`) ? [{Type:'decimal(12,6)'}] : []];
    if (sql.startsWith('SHOW INDEX')) return [indexes.has(`${sql.split(' ')[3]}:${params[0]}`) ? [{}] : []];
    const column = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/); if (column) columns.add(`${column[1]}:${column[2]}`);
    const index = sql.match(/ALTER TABLE (\w+) ADD (?:UNIQUE )?INDEX (\w+)/); if (index) indexes.add(`${index[1]}:${index[2]}`);
    return [{}];
  } };
  const context = vm.createContext({}), module = new vm.SourceTextModule(source,{context});
  await module.link(()=>new vm.SyntheticModule(['default'],function(){this.setExport('default',db);},{context})); await module.evaluate();
  await module.namespace.ensureReceivingDocumentsTables(db,{force:true});
  const before = calls.filter(c=>/ADD COLUMN branch_id|idx_receiving_documents_export|ADD UNIQUE INDEX uq_receiving_supplier_branch/.test(c) && c.startsWith('ALTER')).length;
  assert.equal(before,3);
  await module.namespace.ensureReceivingDocumentsTables(db,{force:true});
  assert.equal(calls.filter(c=>/ADD COLUMN branch_id|idx_receiving_documents_export|ADD UNIQUE INDEX uq_receiving_supplier_branch/.test(c) && c.startsWith('ALTER')).length,3);
  assert.ok(columns.has('receiving_supplier_branch_codes:branch_id'));
});
