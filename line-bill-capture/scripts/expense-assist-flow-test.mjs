import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { storage } from './ssd-storage.mjs';

// ระยะ 2 ด้วยเบราว์เซอร์จริง (Playwright CLI) บนชุดสมมติ loopback ของ expense-desktop-preview.mjs
// ใช้: รัน expense-desktop-preview.mjs ผ่าน SSD runner ค้างไว้ แล้วรันไฟล์นี้พร้อม --fixture=<expense-desktop-preview*.json บน SSD>
// เตรียมข้อมูลเพิ่มโดยเขียนตรงลง DB สมมติบน SSD เท่านั้น ไม่แตะ Production
assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1', 'Use the SOLAO SSD runner');
storage.assertSSD();
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const fixture = JSON.parse(await fs.readFile(storage.assertSSDPath(arg('fixture')), 'utf8'));
assert.equal(fixture.fictional, true);
assert.match(fixture.base_url, /^http:\/\/127\.0\.0\.1:\d+$/);
const dbPath = storage.assertSSDPath(fixture.db_path);
const out = storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const browserDir = path.join(out, 'output', 'playwright'); await fs.mkdir(browserDir, { recursive: true });
const session = arg('session') || 'lbc-assist-pc';
process.env.npm_config_offline = 'true';
process.env.PWTEST_SOCKETS_DIR = storage.assertSSDPath('/Volumes/SSD Files/SOLAO/line-bill-capture/tmp/pw');
await fs.mkdir(process.env.PWTEST_SOCKETS_DIR, { recursive: true });
const wrapper = '/Users/surachart/.codex/skills/playwright/scripts/playwright_cli.sh';
const logPath = path.join(out, `expense-assist-browser-${new Date().toISOString().replaceAll(':', '-')}.log`);
let log = '', checks = [];

async function cli(...args) {
  if (args[0] === 'run-code' && !args[1].startsWith('async page')) args[1] = `async page => { ${args[1]} }`;
  const child = spawn('bash', [wrapper, '--session', session, ...args], { cwd: browserDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { text += data; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  log += `\n$ playwright-cli ${args[0]} ${args.slice(1).join(' ')}\n${text}`;
  await fs.writeFile(logPath, log);
  assert.equal(code, 0, text); assert.ok(!text.includes('### Error'), text);
  return text;
}
async function snapshot() {
  const text = await cli('snapshot');
  const inline = text.match(/```yaml\n([\s\S]*?)```/); if (inline) return inline[1];
  const match = text.match(/\[Snapshot\]\(([^)]+)\)/); assert.ok(match, text);
  return fs.readFile(path.resolve(browserDir, match[1]), 'utf8');
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function ref(role, name, nth = 0, prefix = false) {
  const text = await snapshot();
  const re = new RegExp(`- '?${escape(role)} \\"${escape(name)}${prefix ? '' : '\\"'}[^\\n]*?\\[ref=([^\\]]+)\\]`, 'g');
  const matches = [...text.matchAll(re)]; assert.ok(matches[nth], `Missing ${role} ${name}\n${text}`); return matches[nth][1];
}
const act = async (command, role, name, value, nth = 0, prefix = false) => cli(command, await ref(role, name, nth, prefix), ...(value === undefined ? [] : [value]));
async function value(expression) {
  const text = await cli('eval', `JSON.stringify(${expression})`);
  const segment = text.split('### Result\n')[1]?.split('\n###')[0]?.trim(); assert.ok(segment, text);
  const parsed = JSON.parse(segment); return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}
async function until(expression, expected, description) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const actual = await value(expression);
    if (typeof expected === 'function' ? expected(actual) : actual === expected) { checks.push(description); return actual; }
    if (attempt === 19) assert.fail(`${description}: ${JSON.stringify(actual)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const ok = async (expression, description) => { assert.equal(await value(expression), true, description); checks.push(description); };
const field = (key) => `document.getElementById('expense-profile-${key}')`;
const scopeUrl = (item, bucket = 'bill', group = fixture.groups[0]) => { const url = new URL(fixture.admin_url); url.searchParams.set('bucket', bucket); url.searchParams.set('item', item); url.searchParams.set('group', group); return url.href; };
const fill = (name, text) => act('fill', 'textbox', name, text);
const select = (name, text) => act('select', 'combobox', name, text);
const openProfile = async (label) => { await act('click', 'button', `ข้อมูลสำหรับค่าใช้จ่าย · ${label}`, undefined, 0, true); await until("document.querySelector('.expense-profile-dialog')?.textContent?.includes('ฉบับ')", true, `profile dialog opens (${label})`); };
const sqlRead = (query) => { const sql = new DatabaseSync(dbPath, { readOnly: true }); sql.exec('PRAGMA query_only=ON'); try { return sql.prepare(query).all(); } finally { sql.close(); } };
const savedFields = (id) => JSON.parse(sqlRead(`SELECT fields_json FROM capture_expense_profiles WHERE item_id=${id}`)[0].fields_json);
const financialSnapshot = () => Object.fromEntries(['capture_items', 'capture_matches', 'capture_cash_payments', 'capture_daily_closings', 'ai_learning_examples', 'ai_category_learning_examples', 'line_transfer_requests']
  .map((table) => [table, sqlRead(`SELECT * FROM ${table} ORDER BY id`)]));

// --- เตรียมประวัติสมมติ: สลิป #2 (คู่ของบิล #1) และคู่ร้าน-ผู้รับที่ตรวจแล้วสองรายการ (#3, #6) ---
{
  const sql = new DatabaseSync(dbPath);
  sql.exec('PRAGMA busy_timeout=5000');
  const now = '2026-10-06T04:00:00.000Z';
  const manual = (text) => ({ value: text, source: 'manual', evidence: [] });
  const seed = (id, status, fields) => {
    const json = JSON.stringify(fields);
    sql.prepare(`INSERT INTO capture_expense_profiles(item_id,revision,status,fields_json,reviewed_by,reviewed_at,updated_by,updated_at) VALUES(?,1,?,?,?,?,?,?)`)
      .run(id, status, json, status === 'reviewed' ? 'ผู้ตรวจสมมติ' : null, status === 'reviewed' ? now : null, 'ผู้ตรวจสมมติ', now);
    sql.prepare(`INSERT INTO capture_expense_profile_revisions(item_id,revision,status,old_status,old_fields_json,new_fields_json,actor,reason,decision_id,evidence_snapshot_json,created_at) VALUES(?,1,?,'draft','{}',?,?,?,NULL,'{}',?)`)
      .run(id, status, json, 'ผู้ตรวจสมมติ', 'เตรียมชุดทดสอบ', now);
  };
  seed(2, 'reviewed', { transaction_type: manual('purchase'), supplier_name: manual('ร้านครัวสมมติ'), purpose: manual('ผักสำหรับครัวสาขาทดสอบ'),
    recipient_name: manual('นายสมมติ รับแทนร้าน'), recipient_bank: manual('ธนาคารสมมติ'), recipient_account_masked: manual('XXXX9876'),
    supplier_payee_relation: manual('authorized_payee'), branch: manual('สาขาของสลิป'), department: manual('ครัว'), notes: manual('หมายเหตุเฉพาะสลิปไม่ต้องส่งต่อ') });
  for (const id of [3, 6]) seed(id, 'reviewed', { transaction_type: manual('refund_adjustment'), supplier_name: manual('ธุรกิจคุณลูกค้า'), purpose: manual('คืนเงินลูกค้า'),
    recipient_name: manual('คุณลูกค้าสมมติ'), recipient_bank: manual('ธนาคารสมมติ'), supplier_payee_relation: manual('owner') });
  sql.close();
}
const baseline = financialSnapshot();

try {
  await cli('open', scopeUrl(1, 'done')); await cli('resize', '1440', '900');
  const tree = await snapshot(); if (tree.includes('button "d dot"')) await act('click', 'button', 'd dot');
  await until("document.querySelector('.expense-profile-entry')!==null", true, 'operator login and day document render');

  // 1) บิล #1: ข้อเสนอจากเอกสารคู่ + ใช้ทั้งหมดไม่ทับค่าที่กรอก + เคารพช่องที่ระยะ 1 ซ่อน
  await openProfile('บิล #1');
  assert.match(await value(`${field('recipient_name')}.closest('.expense-profile-field').querySelector('.expense-profile-suggestion').textContent`), /ข้อเสนอจาก เอกสารคู่ #2: นายสมมติ รับแทนร้าน/); checks.push('paired document suggestion names source #2');
  await ok(`!${field('recipient_name')}.closest('.expense-profile-field').querySelector('.expense-profile-evidence')`, 'paired suggestion replaces image-evidence disclosure');
  await ok(`${field('recipient_name')}.value===''&&${field('supplier_payee_relation')}.value===''`, 'paired facts are not auto-filled');
  const suppliers = await value(`[...${field('supplier_name')}.list.options].map(o=>o.value)`);
  assert.ok(suppliers.includes('ร้านครัวสมมติ') && suppliers.includes('ธุรกิจคุณลูกค้า'), JSON.stringify(suppliers)); checks.push('supplier autocomplete lists known shops');
  const recipients = await value(`[...${field('recipient_name')}.list.options].map(o=>o.value)`);
  assert.ok(recipients.includes('นายสมมติ รับแทนร้าน') && recipients.includes('คุณลูกค้าสมมติ'), JSON.stringify(recipients)); checks.push('recipient autocomplete lists known payees');
  await ok(`!/[0-9]{5,}/.test(JSON.stringify([...document.querySelectorAll('.expense-profile-dialog datalist option')].map(o=>o.value)))`, 'autocomplete lists contain no account-like numbers');
  // ระยะ 1 (ย่อช่องตามประเภทรายการ) อาจยังไม่รวมใน branch นี้: ตรวจพฤติกรรม "ข้ามช่องที่ซ่อน" เฉพาะเมื่อมี
  const phase1 = await value("typeof expenseProfileRequirements==='function'"); checks.push(`phase 1 collapsing present: ${phase1}`);
  await select('ประเภทรายการ', 'internal_transfer');
  if (phase1) await ok(`document.querySelector('#expense-profile-collapsed-supplier_name')?.open===false`, 'phase 1 collapses shop section for internal transfer');
  await fill('สาขา', 'สาขากรอกเอง');
  await act('click', 'button', 'ใช้ข้อเสนอทั้งหมด');
  await until(`${field('recipient_name')}.value`, 'นายสมมติ รับแทนร้าน', 'apply all fills visible blank fields');
  assert.equal(await value(`${field('branch')}.value`), 'สาขากรอกเอง'); checks.push('apply all keeps what the user typed');
  assert.equal(await value(`${field('transaction_type')}.value`), 'internal_transfer'); checks.push('apply all keeps chosen transaction type');
  if (phase1) { assert.equal(await value(`${field('supplier_name')}.value`), ''); assert.equal(await value(`${field('supplier_payee_relation')}.value`), ''); checks.push('apply all skips fields phase 1 hides'); }
  else { assert.equal(await value(`${field('supplier_name')}.value`), 'ร้านครัวสมมติ'); checks.push('apply all fills every visible field without phase 1'); }
  assert.equal(await value(`${field('recipient_account_masked')}.value`), 'XXXX9876');
  assert.equal(await value(`${field('department')}.value`), 'ครัว');
  assert.equal(await value(`${field('purpose')}.value`), 'ผักสำหรับครัวสาขาทดสอบ');
  await ok(`document.getElementById('expense-profile-apply-all').closest('.expense-profile-assist-bar').textContent.includes('ยังไม่ได้บันทึก')`, 'apply all announces draft-only result');
  assert.equal(await value('document.activeElement?.id'), 'expense-profile-apply-all'); checks.push('focus returns to apply-all button');
  assert.equal(await value(`${field('notes')}.value`), ''); checks.push('slip-only notes are not carried over');
  await cli('screenshot');
  if (phase1) {
    await act('click', 'generic', 'ซื้อจากใคร', undefined, 0, true);
    await ok(`document.querySelector('#expense-profile-collapsed-supplier_name').open===true`, 'user can open the hidden section');
    await act('click', 'button', 'ใช้ข้อเสนอทั้งหมด');
    await until(`${field('supplier_name')}.value`, 'ร้านครัวสมมติ', 'apply all fills a field once the user opens it');
  }
  assert.equal(await value(`${field('supplier_payee_relation')}.value`), 'authorized_payee');
  await fill('เหตุผลการบันทึก', 'ใช้ข้อเสนอลงร่างตามหลักฐานจำลอง'); // ฐานก่อนระยะ 1 ยังบังคับเหตุผลแม้เป็นร่าง
  await act('click', 'button', 'บันทึกร่าง');
  await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 1')", true, 'draft with assisted values saves');
  const one = savedFields(1);
  assert.deepEqual(one.recipient_name, { value: 'นายสมมติ รับแทนร้าน', source: 'paired_document', evidence: [{ item_id: 2 }] });
  assert.equal(one.supplier_payee_relation.source, 'paired_document'); assert.equal(one.branch.source, 'manual'); assert.equal(one.transaction_type.value, 'internal_transfer'); assert.equal(one.transaction_type.source, 'manual');
  assert.equal(one.recipient_account_masked.value, 'XXXX9876'); checks.push('saved sources/evidence match what the user applied');
  await ok(`document.querySelector('.expense-profile-dialog').textContent.includes('ที่มาของข้อมูล: เอกสารคู่ #2')`, 'saved field shows paired document origin');
  await cli('screenshot');
  assert.deepEqual(financialSnapshot(), baseline); checks.push('assist flow leaves bills, slips, matches, cash and closings untouched');

  // 2) สลิป #5: ประวัติร้าน-ผู้รับที่ตรวจแล้ว (#3, #6) ไม่นับร่างและไม่เสนอเลขบัญชี
  await cli('goto', scopeUrl(5, 'slip')); await openProfile('สลิป #5');
  assert.match(await value(`${field('supplier_name')}.closest('.expense-profile-field').querySelector('.expense-profile-suggestion').textContent`), /ข้อเสนอจาก การตรวจก่อนหน้า 2 รายการ: ธุรกิจคุณลูกค้า/); checks.push('remembered pair names reviewed history count');
  await ok(`!${field('recipient_account_masked')}.closest('.expense-profile-field').textContent.includes('การตรวจก่อนหน้า')`, 'account suggestion never comes from history');
  await select('ประเภทรายการ', 'refund_adjustment');
  await act('click', 'button', 'ใช้ข้อเสนอทั้งหมด');
  await until(`${field('supplier_name')}.value`, 'ธุรกิจคุณลูกค้า', 'apply all fills remembered shop');
  assert.equal(await value(`${field('supplier_payee_relation')}.value`), 'owner');
  assert.equal(await value(`${field('recipient_name')}.value`), 'คุณลูกค้าสมมติ');
  await fill('เหตุผลการบันทึก', 'ใช้ข้อเสนอลงร่างตามหลักฐานจำลอง'); // ฐานก่อนระยะ 1 ยังบังคับเหตุผลแม้เป็นร่าง
  await act('click', 'button', 'บันทึกร่าง');
  await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 1')", true, 'draft with remembered values saves');
  const five = savedFields(5);
  assert.equal(five.supplier_name.source, 'remembered_pair'); assert.deepEqual(five.supplier_name.evidence.map((ref) => ref.item_id).sort(), [3, 6]);
  assert.equal(five.supplier_payee_relation.source, 'remembered_pair'); assert.equal(five.recipient_name.source, 'slip');
  checks.push('remembered values saved with reviewed-history evidence');

  // 3) response ต้องไม่มีเลขบัญชีเต็ม
  const text = await cli('run-code', `const bodies = await page.evaluate(() => Promise.all(['/api/admin/items/1/expense-profile', '/api/admin/items/5/expense-profile', '/api/admin/expense-profile-options'].map((url) => fetch(url).then((response) => response.text())))); return JSON.stringify(bodies);`);
  const segment = text.split('### Result\n')[1]?.split('\n###')[0]?.trim(); assert.ok(segment, text);
  let bodies = JSON.parse(segment); if (typeof bodies === 'string') bodies = JSON.parse(bodies);
  for (const body of bodies) { const found = body.replace(/[a-f0-9]{32,}/gi, '').replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '').replace(/"(?:created_at|updated_at|reviewed_at|event_timestamp_ms)":"?[^,}]+/g, '').match(/.{30}\d{6,}.{10}/u); assert.ok(!found, `response contains long digits: ${found?.[0]}`); }
  checks.push('profile and options responses contain no account-like numbers');
  assert.deepEqual(financialSnapshot(), baseline); checks.push('second flow leaves financial facts untouched');
  await cli('screenshot');
  const report = { ok: true, checks, log_path: logPath };
  await fs.writeFile(path.join(out, 'expense-assist-flow-report.json'), JSON.stringify(report, null, 2));
  console.log(`expense assist browser flow OK (${checks.length} checks)\n${checks.map((c) => `- ${c}`).join('\n')}`);
} finally {
  await cli('close').catch(() => {});
}
