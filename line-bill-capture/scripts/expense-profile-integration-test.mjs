import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

// Independent HTTP contract checks; fictional data and outputs require the verified SSD runner.
assert.ok(process.env.SOLAO_LOCAL_SIMULATION === '1' && os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use the SOLAO SSD runner');
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-profile-http-'));
process.env.CAPTURE_DATA_DIR = data;
process.env.CAPTURE_DB_PATH = path.join(data, 'fictional.sqlite');
const db = await import('../src/db.js');
await db.initDatabase();
const sql = new DatabaseSync(process.env.CAPTURE_DB_PATH);
const now = '2026-10-06T03:00:00.000Z';
const stamp = Date.parse(now);
const insert = sql.prepare(`INSERT INTO capture_items
  (id,line_message_id,source_type,source_id,category,status,vendor_name,supplier_name,bill_total_value,slip_amount_value,match_status,ai_status,ai_raw_text,ai_result_json,event_timestamp_ms,raw_event_json,created_at,updated_at)
  VALUES(?,?,'group',?,?,?,'หัวบิล OCR','ร้าน OCR',?,?, 'unmatched','done','ข้อความ OCR ต้นฉบับ',?,?, '{}',?,?)`);
for (const [id, group, category, status, day] of [[1,'Gfictional','bill','downloaded',0],[2,'Gfictional','transfer','downloaded',0],[3,'Gother','bill','downloaded',0],[4,'Gfictional','bill','downloaded',1],[5,'Gfictional','bill','unsent',0],[6,'Gfictional','bill','duplicate',0]]) {
  insert.run(id, `fictional-image-${id}`, group, category, status, category === 'bill' ? 100.01 : null, category === 'transfer' ? 100.01 : null,
    JSON.stringify({ supplier_name: 'ร้าน OCR', recipient_name: 'ผู้รับ TO', payer_name: 'ผู้จ่าย FROM', recipient_account_masked: 'xxx1234' }), stamp + day * 86400000, now, now);
}
const message = sql.prepare(`INSERT INTO line_messages
  (id,line_message_id,message_type,source_type,source_id,text,status,event_timestamp_ms,raw_event_json,created_at,updated_at)
  VALUES(?,?,'text','group',?,'เนื้อสำหรับครัว สมมติ',?,?, '{}',?,?)`);
for (const [id, group, status, day] of [[11,'Gfictional','active',0],[12,'Gother','active',0],[13,'Gfictional','active',1],[14,'Gfictional','unsent',0]]) message.run(id, `fictional-chat-${id}`, group, status, stamp + day * 86400000, now, now);
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
    ADMIN_AUTH_DISABLED: '0', ADMIN_AUTH_MODE: 'operator_only', ADMIN_OPERATOR_NAMES: '["dot","fictional-other"]',
    ADMIN_SESSION_SECRET: 'fictional-expense-http-secret', DECISION_REASON_REQUIRED: '1',
    AI_WORKER_ENABLED: 'false', AI_PROVIDER: 'mock', OPENAI_API_KEY: '',
    LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '', LINE_BILL_CAPTURE_CHANNEL_SECRET: 'fictional-line-secret',
    LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN: '', LINE_BILL_CAPTURE_PUSH_MOCK: '1', LINE_BILL_CAPTURE_SILENT_MODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
const base = `http://127.0.0.1:${port}`;
let cookie = '';
const request = async (route, options = {}) => {
  const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', cookie }, ...options });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null, response };
};
const choose = async operator => {
  const response = await fetch(base + '/api/auth/operator', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ operator }), signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 303);
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
};
const action = 'document.expense_profile.save';
const route = id => `/api/admin/items/${id}/expense-profile`;
const context = async (id, override = {}, actorCookie = cookie) => {
  const result = await request('/api/admin/decision-contexts', { method: 'POST', headers: { 'content-type': 'application/json', cookie: actorCookie }, body: JSON.stringify({ action_key: action, entity_type: 'item', entity_id: String(id), context_snapshot: { route: route(id) }, ...override }) });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.data.id;
};
const put = async (id, payload, decision = null) => {
  const decisionId = decision || await context(id);
  const result = await request(route(id), { method: 'PUT', headers: { 'content-type': 'application/json', cookie, 'x-decision-id': decisionId, 'x-decision-reason-code': 'user_action' }, body: JSON.stringify(payload) });
  return { ...result, decisionId };
};
const entry = (value, source = 'manual', evidence = []) => ({ value, source, evidence });
const payload = (revision, fields, status = 'draft') => ({ expected_revision: revision, status, fields, reason: 'ตรวจหลักฐานจำลองโดยคน' });
const counts = () => Object.fromEntries(['capture_expense_profiles', 'capture_expense_profile_revisions', 'decision_events'].map(name => [name, sql.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n]));
const financial = () => JSON.stringify(Object.fromEntries(['capture_items','capture_matches','capture_cash_payments','capture_daily_closings','ai_learning_examples','ai_category_learning_examples','line_transfer_requests'].map(name => [name, sql.prepare(`SELECT * FROM ${name} ORDER BY id`).all()])));
const results = [];
const check = async (name, fn) => { await fn(); results.push({ name, passed: true }); };
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, output);
  await check('anonymous GET/PUT protected; authenticated write requires decision audit', async () => {
    assert.equal((await request(route(1))).status, 401);
    assert.equal((await request(route(1), { method: 'PUT', body: JSON.stringify(payload(0, {})) })).status, 401);
    cookie = await choose('dot');
    assert.equal((await request(route(1), { method: 'PUT', body: JSON.stringify(payload(0, {})) })).status, 422);
  });
  sql.prepare(`INSERT INTO capture_matches(bill_item_id,slip_item_id,score,status,created_by,reviewed_by,reviewed_at,confirmed_at,created_at,updated_at)
    VALUES(1,2,100,'confirmed','dot','dot',?,?,?,?)`).run(now,now,now,now);
  sql.prepare("UPDATE capture_items SET match_status='confirmed',matched_item_id=CASE id WHEN 1 THEN 2 ELSE 1 END WHERE id IN (1,2)").run();
  // Startup repairs orphan duplicates; establish a valid unavailable fixture after startup.
  sql.prepare("UPDATE capture_items SET status='duplicate',duplicate_of_item_id=1 WHERE id=6").run();
  const original = financial();
  await check('GET leaves no profile/revision/audit and does not confirm OCR', async () => {
    const before = counts();
    const got = await request(route(1)); assert.equal(got.status, 200); assert.equal(got.body.data.revision, 0);
    assert.equal(got.body.data.fields.supplier_name.value, null);
    assert.equal(got.body.data.suggestions.supplier_name.value, 'ร้าน OCR');
    assert.deepEqual(got.body.data.suggestions.recipient_name, {value:'ผู้รับ TO',source:'paired_ocr',evidence:[{item_id:2}]});
    const slip = await request(route(2)); assert.equal(slip.body.data.suggestions.recipient_name.value, 'ผู้รับ TO');
    assert.notEqual(slip.body.data.suggestions.recipient_name.value, 'ผู้จ่าย FROM');
    assert.equal(slip.body.data.suggestions.supplier_name, undefined);
    assert.deepEqual(counts(), before); assert.equal(financial(), original);
    for (const invalid of ['0','abc','1.5','9007199254740992']) assert.equal((await request(route(invalid))).status,400);
    assert.equal((await request(route(999))).status,404);
    assert.equal((await put(999,payload(0,{}))).status,404);
  });
  await check('manual correction persists without AI and freezes authoritative actor', async () => {
    const result = await put(1, payload(0, { supplier_name: entry('ร้านคนยืนยัน'), purpose: entry('เนื้อสำหรับครัว','chat',[{ item_id: 1, message_id: 'fictional-chat-11' }]), branch: entry('สาขาที่คนเลือก') }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.revision, 1); assert.equal(result.body.data.updated_by, 'dot');
    assert.equal(result.body.data.fields.supplier_name.value, 'ร้านคนยืนยัน');
    const history = sql.prepare('SELECT * FROM capture_expense_profile_revisions WHERE item_id=1 AND revision=1').get();
    assert.equal(history.actor, 'dot'); assert.equal(history.decision_id, result.decisionId); assert.ok(history.reason);
    assert.equal(JSON.parse(history.old_fields_json).supplier_name.value, null);
    assert.equal(JSON.parse(history.new_fields_json).supplier_name.value, 'ร้านคนยืนยัน');
    const evidence = JSON.parse(history.evidence_snapshot_json);
    assert.equal(evidence.item.source_id,'Gfictional');
    assert.equal(evidence.suggestions.supplier_name.value,'ร้าน OCR');
    assert.equal(evidence.messages[0].text,'เนื้อสำหรับครัว สมมติ');
    assert.equal(financial(), original);
  });
  await check('invalid evidence, role, account, value and actor input rejected atomically', async () => {
    const cases = [
      payload(1,{ purpose: entry('ผิดภาพ','bill',[{item_id:3}]) }),
      ...['fictional-chat-12','fictional-chat-13','fictional-chat-14','missing'].map(message_id => payload(1,{purpose:entry('ผิดบริบท','chat',[{item_id:1,message_id}])})),
      payload(1,{recipient_name:entry('สลับบทบาท','bill',[{item_id:1}])}),
      payload(1,{recipient_account_masked:entry('1234567890')}),
      payload(1,{purpose:entry(0)}), payload(1,{payer_name:entry('FROM')}),
      {...payload(1,{}),actor:'forged'}, {...payload(1,{}),expected_revision:'1'}
    ];
    for (const input of cases) { const result = await put(1,input); assert.equal(result.status,400,JSON.stringify(result.body)); }
    const fullAccount = payload(1,{recipient_account_masked:entry('1234567890')});
    const fullAccountContext = await context(1,{context_snapshot:{request:fullAccount}});
    assert.equal((await put(1,fullAccount,fullAccountContext)).status,400);
    assert.equal((await request(route(1))).body.data.revision,1); assert.equal(financial(),original);
    for (const id of [5,6]) assert.equal((await put(id,payload(0,{}))).status,409);
  });
  await check('audit rejects other actor, mismatched action/entity and reuse', async () => {
    const other = await choose('fictional-other');
    for (const decision of [await context(1,{},other), await context(1,{action_key:'document.metadata.update'}),await context(3),await context(1,{entity_type:'match'})]) {
      assert.equal((await put(1,payload(1,{}),decision)).status,409);
    }
    const reused = sql.prepare('SELECT decision_id FROM capture_expense_profile_revisions WHERE item_id=1 AND revision=1').get().decision_id;
    assert.equal((await put(1,payload(1,{}),reused)).status,409);
    assert.equal((await request(route(1))).body.data.revision,1);
  });
  await check('partial updates revalidate inherited evidence after LINE unsend', async () => {
    sql.prepare("UPDATE line_messages SET status='unsent' WHERE id=11").run();
    const stale = await put(1,payload(1,{notes:entry('แก้เฉพาะหมายเหตุ')}));
    assert.equal(stale.status,400,JSON.stringify(stale.body));
    assert.equal((await request(route(1))).body.data.revision,1);
    sql.prepare("UPDATE line_messages SET status='active' WHERE id=11").run();
  });
  await check('review requires purchase facts and distinct payee relation', async () => {
    assert.equal((await put(1,payload(1,{transaction_type:entry('purchase'),recipient_name:entry('คนรับเงินคนละชื่อ')},'reviewed'))).status,400);
    const saved = await put(1,payload(1,{transaction_type:entry('purchase'),recipient_name:entry('คนรับเงินคนละชื่อ'),supplier_payee_relation:entry('owner')},'reviewed'));
    assert.equal(saved.status,200,JSON.stringify(saved.body)); assert.equal(saved.body.data.reviewed_by,'dot'); assert.equal(saved.body.data.revision,2);
    assert.equal(financial(),original);
  });
  await check('stale revision and simultaneous saves preserve one winner and history', async () => {
    assert.equal((await put(1,payload(1,{purpose:entry('ร่างเก่า')}))).status,409);
    const decisions = [await context(1),await context(1)];
    const pair = await Promise.all(decisions.map((id,index) => put(1,payload(2,{notes:entry(`ร่างพร้อมกัน ${index}`)}),id)));
    assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
    assert.equal((await request(route(1))).body.data.revision,3);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM capture_expense_profile_revisions WHERE item_id=1').get().n,3);
    assert.equal(financial(),original);
  });
  await check('draft and reviewed accept omitted reason; immutable defaults and conflict guard', async () => {
    const bare = { expected_revision: 0, status: 'draft', fields: { notes: entry('ร่างไม่ระบุเหตุผล') } };
    const draft = await put(3, bare);
    assert.equal(draft.status, 200, JSON.stringify(draft.body)); assert.equal(draft.body.data.history[0].reason, 'บันทึกร่าง');
    assert.equal(draft.body.data.history[0].decision_id, draft.decisionId);
    const reviewed = await put(3, { ...bare, expected_revision: 1, status: 'reviewed', fields: { transaction_type: entry('internal_transfer'), notes: entry('แลกเงินสด') } });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body)); assert.equal(reviewed.body.data.history[0].reason, 'บันทึกว่าตรวจแล้ว');
    assert.equal((await put(3, bare)).status, 409);
    const row = sql.prepare('SELECT COUNT(*) n FROM capture_expense_profile_revisions WHERE item_id=3').get().n; assert.equal(row, 2);
    await new Promise(resolve => setTimeout(resolve, 500)); // decision audit finishes asynchronously after the response
  });
  await check('historical correction snapshots resist UPDATE/DELETE and later OCR cannot replace manual values', async () => {
    const frozen = sql.prepare('SELECT * FROM capture_expense_profile_revisions WHERE item_id=1 AND revision=1').get();
    assert.throws(()=>sql.prepare('UPDATE capture_expense_profile_revisions SET reason=? WHERE item_id=1 AND revision=1').run('rewrite'),/immutable/);
    assert.throws(()=>sql.prepare('DELETE FROM capture_expense_profile_revisions WHERE item_id=1 AND revision=1').run(),/immutable/);
    sql.prepare('UPDATE capture_items SET supplier_name=?,ai_raw_text=?,ai_result_json=? WHERE id=1').run('ร้าน OCR ใหม่','ข้อความ OCR ใหม่',JSON.stringify({supplier_name:'ร้าน OCR ใหม่'}));
    const current = await request(route(1)); assert.equal(current.body.data.fields.supplier_name.value,'ร้านคนยืนยัน');
    assert.deepEqual(sql.prepare('SELECT * FROM capture_expense_profile_revisions WHERE item_id=1 AND revision=1').get(),frozen);
  });
  await check('expense decision audit reaches completed/failed; no automatic export or AI learning', async () => {
    let events;
    for(let i=0;i<20;i++){ events=sql.prepare('SELECT actor,status,request_payload,context_snapshot FROM decision_events WHERE action_key=?').all(action); if(events.some(e=>e.status==='completed')&&events.some(e=>e.status==='failed'))break; await new Promise(resolve=>setTimeout(resolve,20)); }
    assert.ok(events.some(e=>e.actor==='dot'&&e.status==='completed'));
    assert.ok(events.some(e=>e.status==='failed'));
    assert.ok(events.every(e=>!String(e.request_payload).includes('1234567890')), 'rejected full account must not persist in expense decision payload');
    assert.ok(events.every(e=>!String(e.context_snapshot).includes('1234567890')), 'rejected full account must not persist in expense decision context');
    for(const table of ['ai_learning_examples','ai_category_learning_examples','line_transfer_requests']) assert.equal(sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  });
  await check('all manual fields, nonpurchase types and clearing values round-trip without financial writes', async () => {
    const before = financial();
    let revision = 0;
    const manual = { supplier_name:entry(null), recipient_name:entry('ผู้รับที่คนยืนยัน'), recipient_bank:entry('ธนาคารทดสอบ'),
      recipient_account_masked:entry('••••1234'), purpose:entry('วัตถุประสงค์ตามหลักฐาน'), branch:entry('สาขาที่คนตรวจ'),
      department:entry('ฝ่ายครัว'), transaction_type:entry('internal_transfer'), supplier_payee_relation:entry('unknown'), notes:entry('โอนระหว่างบัญชี จึงไม่มีซัพพลายเออร์') };
    const nonpurchase = await put(2,payload(revision,manual,'reviewed'));
    assert.equal(nonpurchase.status,200,JSON.stringify(nonpurchase.body)); revision = nonpurchase.body.data.revision;
    assert.equal(nonpurchase.body.data.fields.supplier_name.value,null,'nonpurchase review must not force a fake supplier');
    for(const [key,field] of Object.entries(manual)) assert.deepEqual(nonpurchase.body.data.fields[key],field,key);
    for(const type of ['purchase','advance_payment','reimbursement','internal_transfer','loan','refund_adjustment','unknown']) {
      const saved = await put(2,payload(revision,{transaction_type:entry(type),supplier_name:entry('ร้านที่คนยืนยัน'),supplier_payee_relation:entry('owner')},'reviewed'));
      assert.equal(saved.status,200,JSON.stringify(saved.body)); revision++;
      assert.equal(saved.body.data.revision,revision); assert.equal(saved.body.data.fields.transaction_type.value,type);
    }
    const cleared = await put(2,payload(revision,{department:entry('  '),branch:entry(null)},'draft'));
    assert.equal(cleared.status,200,JSON.stringify(cleared.body));
    assert.equal(cleared.body.data.fields.department.value,null); assert.equal(cleared.body.data.fields.branch.value,null);
    assert.equal(cleared.body.data.reviewed_by,null); assert.equal(cleared.body.data.reviewed_at,null);
    const reread = await request(route(2)); assert.deepEqual(reread.body.data.fields,cleared.body.data.fields);
    assert.equal(financial(),before);
  });
  await check('closed round GET lock and PUT409 preserve profile/history until explicit reopen', async () => {
    const before = await request(route(1));
    sql.prepare(`INSERT INTO capture_daily_closings(business_date,source_id,status,summary_json,created_at,updated_at) VALUES('2026-10-06','Gfictional','closed','{}',?,?)`).run(now,now);
    const locked = await request(route(1));
    assert.equal(locked.body.data.edit_lock.code,'round_closed');
    const response = await put(1,payload(before.body.data.revision,{purpose:entry('ห้ามเขียนในรอบปิด')},'draft'));
    assert.equal(response.status,409); assert.equal(response.body.details.code,'round_closed');
    const after = await request(route(1));
    assert.deepEqual(after.body.data.fields,before.body.data.fields);
    assert.deepEqual(after.body.data.history,before.body.data.history);
    assert.equal(after.body.data.revision,before.body.data.revision);
    assert.equal(sql.prepare('SELECT status FROM capture_daily_closings').get().status,'closed');
    sql.prepare("UPDATE capture_daily_closings SET status='open'").run();
    assert.equal((await request(route(1))).body.data.edit_lock,null);
  });
  await check('one pair review via HTTP: scoped GET, shared save, batch state, stale context and auth', async () => {
    const before = await request(route(1));
    const edge = sql.prepare('SELECT id,status FROM capture_matches WHERE bill_item_id=1 AND slip_item_id=2').get();
    const matchId = Number(edge.id); sql.prepare("UPDATE capture_matches SET status='pending' WHERE id=?").run(matchId);
    try {
      const scoped = await request(route(1)+`?pair_match_id=${matchId}`);
      assert.equal(scoped.status,200); assert.equal(scoped.body.data.pair_scope.primary_item_id,1);
      const scope = scoped.body.data.pair_scope;
      const pair_context = {match_id:matchId,item_ids:scope.item_ids,expected_revisions:scope.expected_revisions};
      const finance = financial(), oldSlip = sql.prepare('SELECT * FROM capture_expense_profiles WHERE item_id=2').get();
      const response = await put(1,{...payload(before.body.data.revision,{transaction_type:entry('internal_transfer'),notes:entry('โอนระหว่างบัญชีสมมติ')},'reviewed'),reason:'',pair_context});
      assert.equal(response.status,200,JSON.stringify(response.body)); assert.equal(response.body.data.pair_scope.membership_valid,true);
      assert.equal(response.body.data.pair_scope.shared_status,'reviewed'); assert.equal(financial(),finance);
      assert.deepEqual(sql.prepare('SELECT * FROM capture_expense_profiles WHERE item_id=2').get(),oldSlip,'single review does not clone or overwrite slip profile');
      const status=await request(`/api/admin/expense-status/items?ids=1,2&match_ids=${matchId}`);
      assert.equal(status.status,200); assert.equal(status.body.by_match[matchId].review_status,'reviewed');
      assert.equal((await put(1,{...payload(response.body.data.revision,{},'draft'),pair_context})).status,409,'old member revision context rejected');
      assert.equal((await request(route(2)+`?pair_match_id=${matchId}`)).status,409,'slip cannot own pair facts');
      assert.equal((await request(route(1)+'?pair_match_id=x')).status,400);
      assert.equal((await request('/api/admin/expense-status/items?ids=1&match_ids=x')).status,400);
      sql.prepare("UPDATE capture_matches SET status='rejected' WHERE id=?").run(matchId);
      assert.equal((await request(route(1)+`?pair_match_id=${matchId}`)).status,409);
    } finally { sql.prepare('UPDATE capture_matches SET status=? WHERE id=?').run(edge.status,matchId); }
  });
  const report = { fictional: true, base, data, results };
  await fs.writeFile(path.join(process.env.SOLAO_TEST_OUTPUT_DIR,'expense-profile-http.json'),JSON.stringify(report,null,2));
  console.log(`Expense profile independent HTTP integration: ${results.length} groups passed (fictional SSD DB).`);
} catch (error) {
  console.error(output.slice(-6000));
  throw error;
} finally {
  if(child.exitCode===null){ const stopped=once(child,'exit'); child.kill('SIGTERM'); await stopped; }
  sql.close();
}
