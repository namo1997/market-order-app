import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { reports, root, ssdDir, json, cleanEnv, command, bangkokDate } from './common.mjs';
import { requestJson, uploadAndVerifyImage } from './smoke-http.mjs';

const stateFile = process.argv[2] || `${reports}/current.json`;
if (!stateFile.startsWith(`${reports}/`) || stateFile.includes('/../')) throw new Error('Use pilot state JSON on SSD');
await ssdDir(reports);
const state = JSON.parse(await readFile(stateFile, 'utf8'));
if (!/^receiving-pilot-[A-Za-z0-9T-]+$/.test(state.run?.split('/').at(-1) || '') ||
    state.run !== `${root}/runs/${state.run.split('/').at(-1)}` || state.socket !== `${state.run}/m.sock` ||
    state.base !== `http://127.0.0.1:${state.port}`) throw new Error('Invalid pilot identity');
await ssdDir(state.run);
const out = await ssdDir(`${state.evidence}/smoke-${Date.now()}-${process.pid}`);
const mysql = createRequire(`${state.run}/source/server/package.json`)('mysql2/promise');
let pool;
let passed = 0;
let failed = 0;
const checks = [];
async function check(name, work) {
  try { await work(); checks.push({ name, pass: true }); passed++; process.stdout.write(`ok ${checks.length} - ${name}\n`); }
  catch (e) { checks.push({ name, pass: false }); failed++; throw new Error(`Check failed: ${name} (${e.code || e.name})`); }
}
const request = (...args) => requestJson(state.base, ...args);
async function rows(sql, params = []) { return (await pool.query(sql, params))[0]; }
async function count(sql, params = []) { return Number(Object.values((await rows(sql, params))[0])[0]); }
const api = '/api/receiving-documents';
let doc;
try {
  await check('health belongs to this SYNTHETIC mock instance', async () => {
    const health = await request('GET', '/health');
    assert.equal(health.pilot, 'SYNTHETIC'); assert.equal(health.ocr, 'mock');
    assert.equal(health.instance, state.run.split('/').at(-1));
  });
  pool = mysql.createPool({ socketPath: state.socket, user: 'root', database: 'receiving_pilot', connectionLimit: 2, timezone: 'Z' });
  await check('DB is socket-only SSD receiving_pilot', async () => {
    const [identity] = await rows('SELECT @@datadir AS datadir,@@skip_networking AS offline,DATABASE() AS db');
    assert.equal(identity.datadir.replace(/\/$/, ''), `${state.run}/data`);
    assert.equal(Number(identity.offline), 1); assert.equal(identity.db, 'receiving_pilot');
  });
  let bearer, other;
  await check('login both synthetic branches (sessions in RAM only)', async () => {
    bearer = (await request('POST', '/api/auth/login', { departmentId: 1 })).token;
    other = (await request('POST', '/api/auth/login', { departmentId: 2 })).token;
    assert.equal(typeof bearer, 'string'); assert.notEqual(bearer, other);
  });
  let group, item;
  await check('expected contains today orders', async () => {
    const groups = await request('GET', `${api}/expected?date=${bangkokDate()}`, undefined, bearer);
    group = groups.find(g => g.items.some(i => !i.is_received));
    assert.ok(group, 'Restart pilot for fresh orders if all items received');
    item = group.items.find(i => !i.is_received);
  });
  const [beforeOrder] = await rows('SELECT quantity,received_quantity,actual_price,is_received,receive_notes FROM order_items WHERE id=?', [item.order_item_id]);
  const balance = () => rows('SELECT quantity FROM inventory_balance WHERE product_id=? AND department_id=1', [item.product_id]);
  const beforeBalance = (await balance())[0]?.quantity || '0.00';
  const txBefore = await count('SELECT COUNT(*) FROM inventory_transactions');
  const body = { client_uuid: `SYNTHETIC-${randomUUID()}`, delivery_date: bangkokDate(), kind: 'bill',
    product_group_id: Number(group.supplier_key.split(':')[1]), supplier_name_text: group.supplier_name,
    order_item_ids: [item.order_item_id] };
  await check('create draft and concurrent duplicate UUID returns same document', async () => {
    const created = await Promise.all([201, 200].map(async () => {
      const response = await fetch(`${state.base}${api}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error' });
      assert.ok([200, 201].includes(response.status));
      const payload = await response.json(); assert.equal(payload.success, true); return payload.data;
    }));
    assert.equal(created[0].id, created[1].id); doc = created[0];
    assert.equal(await count('SELECT COUNT(*) FROM receiving_documents WHERE client_uuid=?', [body.client_uuid]), 1);
  });
  await check('all receiving routes reject missing session', async () => {
    for (const [method, suffix] of [['GET', '/expected'], ['GET', ''], ['POST', ''],
      ['GET', `/${doc.id}`], ['PUT', `/${doc.id}`], ['POST', `/${doc.id}/images`],
      ['GET', `/${doc.id}/images/1`], ['POST', `/${doc.id}/ocr`], ['POST', `/${doc.id}/signatures`],
      ['POST', `/${doc.id}/confirm`], ['POST', `/${doc.id}/void`]]) {
      await request(method, `${api}${suffix}`, method === 'GET' ? undefined : {}, undefined, 401);
    }
  });
  await check('validation 422 and missing document 404', async () => {
    await request('POST', api, {}, bearer, 422);
    await request('GET', `${api}/2147483647`, undefined, bearer, 404);
  });
  let imageId;
  await check('upload actual tiny JPEG and retrieve binary', async () => {
    // Real PNG -> macOS JPEG encoder. Generated fixtures stay on SSD.
    await writeFile(`${out}/synthetic.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f9sAAAAASUVORK5CYII=', 'base64'));
    await command('/usr/bin/sips', ['-s', 'format', 'jpeg', `${out}/synthetic.png`, '--out', `${out}/synthetic.jpg`],
      { cwd: out, env: cleanEnv(out), log: `${out}/sips.log` });
    const bytes = await readFile(`${out}/synthetic.jpg`);
    imageId = await uploadAndVerifyImage(state.base, `${api}/${doc.id}/images`, bytes, bearer);
  });
  await check('branch B cannot read/edit/OCR/sign/confirm/void/image A', async () => {
    const jpeg = `data:image/jpeg;base64,${(await readFile(`${out}/synthetic.jpg`)).toString('base64')}`;
    const png = `data:image/png;base64,${(await readFile(`${out}/synthetic.png`)).toString('base64')}`;
    for (const [method, suffix, data] of [['GET', '', undefined], ['PUT', '', {}], ['POST', '/ocr', {}],
      ['POST', '/images', { page_no: 1, image_data_url: jpeg }],
      ['POST', '/signatures', { role: 'receiver', image_data_url: png }],
      ['POST', '/confirm', {}], ['POST', '/void', { reason: 'SYNTHETIC forbidden' }],
      ['GET', `/images/${imageId}`, undefined]]) await request(method, `${api}/${doc.id}${suffix}`, data, other, 403);
  });
  await check('OCR custom mock completes without AI call', async () => {
    doc = await request('POST', `${api}/${doc.id}/ocr`, {}, bearer);
    assert.equal(doc.ocr.status, 'done'); assert.equal(doc.ocr.model, 'SYNTHETIC-mock');
    assert.ok(doc.lines.length > 0); assert.equal(doc.total, '25.00');
  });
  await check('edit receipt quantities and exact decimal amounts', async () => {
    const line = doc.lines.find(l => Number(l.order_item_id) === Number(item.order_item_id)) || doc.lines[0];
    doc = await request('PUT', `${api}/${doc.id}`, { subtotal: '25.00', total: '25.00', discount: '0.00', vat: '0.00',
      lines: [{ id: line.id, line_no: line.line_no, bill_text: item.product_name,
        product_id: item.product_id, order_item_id: item.order_item_id, unit_id: 1,
        unit_text: 'กิโลกรัม', quantity_billed: '2.50', quantity_received: '2.50',
        unit_price: '10.00', amount: '25.00', unit_multiplier: 1, match: { source: 'manual', confidence: 1 } }],
      deleted_line_ids: doc.lines.filter(l => l.id !== line.id).map(l => l.id) }, bearer);
    assert.equal(doc.total, '25.00'); assert.equal(doc.lines.length, 1);
  });
  await check('receiver and courier signatures saved', async () => {
    const image = `data:image/png;base64,${(await readFile(`${out}/synthetic.png`)).toString('base64')}`;
    for (const role of ['receiver', 'courier']) await request('POST', `${api}/${doc.id}/signatures`, {
      role, image_data_url: image, name: `SYNTHETIC ${role}` }, bearer);
    doc = await request('GET', `${api}/${doc.id}`, undefined, bearer);
    assert.equal(doc.has_receiver_signature, true); assert.equal(doc.has_courier_signature, true);
  });
  await check('concurrent confirm succeeds once, persists order + inventory + alias + audit', async () => {
    const results = await Promise.all([1, 2].map(async () => {
      const response = await fetch(`${state.base}${api}/${doc.id}/confirm`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: '{}', signal: AbortSignal.timeout(15000), redirect: 'error' });
      return { status: response.status, body: await response.json() };
    }));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    doc = results.find(r => r.status === 200).body.data; assert.equal(doc.status, 'confirmed');
    // Decimal arithmetic in SQL, no JS floating point expectations.
    const [row] = await rows('SELECT received_quantity = COALESCE(?,0)+2.50 AS qty_ok,actual_price <=> ? AS price_ok FROM order_items WHERE id=?', [beforeOrder.received_quantity, beforeOrder.actual_price, item.order_item_id]); // policy 11b: confirm leaves actual_price untouched
    assert.equal(Number(row.qty_ok), 1); assert.equal(Number(row.price_ok), 1);
    assert.equal(await count('SELECT quantity = ?+2.50 FROM inventory_balance WHERE product_id=? AND department_id=1', [beforeBalance, item.product_id]), 1);
    assert.equal(await count('SELECT COUNT(*) FROM inventory_transactions'), txBefore + 1);
    assert.equal(await count('SELECT COUNT(*) FROM supplier_product_alias_events WHERE document_id=?', [doc.id]), 1);
    assert.equal(await count(`SELECT COUNT(*) FROM supplier_product_aliases a JOIN supplier_product_alias_events e ON e.alias_id=a.id
      WHERE e.document_id=? AND a.product_id=? AND a.last_unit_price=10.00`, [doc.id, item.product_id]), 1);
    assert.equal(await count("SELECT COUNT(*) FROM receiving_document_audits WHERE document_id=? AND action='confirm'", [doc.id]), 1);
  });
  await check('second confirm returns 409 without another stock receipt', async () => {
    await request('POST', `${api}/${doc.id}/confirm`, {}, bearer, 409);
    assert.equal(await count('SELECT COUNT(*) FROM inventory_transactions'), txBefore + 1);
  });
  await check('void restores order fields and inventory, keeps audit', async () => {
    doc = await request('POST', `${api}/${doc.id}/void`, { reason: 'SYNTHETIC smoke reversal' }, bearer);
    assert.equal(doc.status, 'void');
    const [after] = await rows('SELECT quantity,received_quantity,actual_price,is_received,receive_notes FROM order_items WHERE id=?', [item.order_item_id]);
    assert.deepEqual(after, beforeOrder); assert.equal((await balance())[0].quantity, beforeBalance);
    assert.equal(await count('SELECT COUNT(*) FROM inventory_transactions'), txBefore + 2);
    assert.equal(await count("SELECT COUNT(*) FROM receiving_document_audits WHERE document_id=? AND action='void'", [doc.id]), 1);
  });
  await check('repeat void does not reverse stock twice', async () => {
    const response = await fetch(`${state.base}${api}/${doc.id}/void`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ reason: 'SYNTHETIC repeat void' }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    assert.ok([200, 409].includes(response.status));
    assert.equal(await count('SELECT COUNT(*) FROM inventory_transactions'), txBefore + 2);
    assert.equal((await balance())[0].quantity, beforeBalance);
  });
} catch (e) {
  if (!failed) failed++;
  process.exitCode = 1; process.stderr.write(`${e.message.startsWith('Check failed:') ? e.message : 'Smoke aborted: pilot prerequisite/identity failure'}\n`);
} finally {
  await pool?.end();
  await json(`${out}/result.json`, { label: 'SYNTHETIC', run: state.run, documentId: doc?.id,
    tests: passed + failed, pass: passed, fail: failed, skip: 0, checks });
  process.stdout.write(`tests=${passed + failed} pass=${passed} fail=${failed} skip=0\nEvidence: ${out}/result.json\n`);
}
