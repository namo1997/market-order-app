import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { storage } from './ssd-storage.mjs';

// ชุดสมมติสำหรับตรวจ desktop เท่านั้น: สร้างใหม่ทุกครั้งและไม่ใช้ข้อมูลหรือ token ของ Production
assert.equal(process.env.SOLAO_LOCAL_SIMULATION, '1', 'Use ssd-workspace.mjs run --project line-bill-capture');
storage.assertSSD();
const source = storage.assertSSDPath(path.resolve(import.meta.dirname, '..'));
const temporaryRoot = storage.assertSSDPath(os.tmpdir());
const reports = storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const dataDir = await fs.mkdtemp(path.join(temporaryRoot, 'expense-desktop-'));
const imageDir = path.join(dataDir, 'images');
const dbPath = path.join(dataDir, 'fictional.sqlite');
await fs.mkdir(imageDir, { recursive: true });
process.env.CAPTURE_DATA_DIR = dataDir;
process.env.CAPTURE_DB_PATH = dbPath;
const db = await import('../src/db.js');
await db.initDatabase();
const sql = new DatabaseSync(dbPath);
const businessDate = '2026-10-06';
const createdAt = '2026-10-06T03:00:00.000Z';
const baseTimestamp = Date.parse(createdAt);
const mainGroup = 'Gexpense-main';
const otherGroup = 'Gexpense-other';
const cases = [
  { id: 1, category: 'bill', group: mainGroup, amount: 100.01, supplier: 'ร้านครัวสมมติ', purpose: 'ผักสำหรับครัวสาขาทดสอบ',
    title: 'บิลร้านครัวสมมติ', rows: ['ผู้ขาย: ร้านครัวสมมติ', 'รายการ: ผักสำหรับครัว', 'ยอดรวม: 100.01 บาท', 'วันที่: 6 ตุลาคม 2569'],
    analysis: { supplier_name: 'ร้านครัวสมมติ', bill_purpose: 'ผักสำหรับครัวสาขาทดสอบ', document_class: 'standard_bill' } },
  { id: 2, category: 'transfer', group: mainGroup, amount: 100.01, title: 'สลิปจ่ายค่าสินค้า',
    rows: ['จาก: บริษัทสมมติผู้จ่าย', 'ถึง: นายสมมติ รับแทนร้าน', 'ธนาคาร: ธนาคารสมมติ', 'บัญชีปลายทาง: XXXX9876', 'ยอดโอน: 100.01 บาท'],
    analysis: { recipient_name: 'นายสมมติ รับแทนร้าน', recipient_bank: 'ธนาคารสมมติ', recipient_account_masked: 'XXXX9876', payer_account_name: 'บริษัทสมมติผู้จ่าย', document_class: 'transfer_slip' } },
  { id: 3, category: 'bill', group: mainGroup, amount: 250, title: 'บิลที่ข้อมูลยังไม่ครบ',
    rows: ['ชื่อร้าน: อ่านไม่ชัด', 'รายการซื้อ: ยังไม่ได้ระบุ', 'ยอดรวม: 250.00 บาท', 'โปรดเปิดแชทและกรอกข้อมูลเอง'], analysis: { document_class: 'standard_bill' } },
  { id: 4, category: 'transfer', group: mainGroup, amount: 80, title: 'สลิปที่ยังไม่ทราบผู้รับ',
    rows: ['ชื่อผู้รับ: อ่านไม่ชัด', 'บัญชีปลายทาง: ไม่ปรากฏ', 'ยอดโอน: 80.00 บาท', 'ยังไม่ยืนยันว่าเป็นการซื้อ'], analysis: { recipient_name: null, document_class: 'transfer_slip' } },
  { id: 5, category: 'transfer', group: mainGroup, amount: 40, title: 'คืนเงินลูกค้า — กรณีไม่ใช่การซื้อ',
    rows: ['รายการ: คืนเงินลูกค้าสมมติ', 'ถึง: คุณลูกค้าสมมติ', 'บัญชีปลายทาง: XXXX1122', 'ยอดโอนคืน: 40.00 บาท'],
    analysis: { recipient_name: 'คุณลูกค้าสมมติ', recipient_bank: 'ธนาคารสมมติ', recipient_account_masked: 'XXXX1122', document_class: 'transfer_slip' } },
  { id: 6, category: 'bill', group: otherGroup, amount: 60, supplier: 'ร้านอีกกลุ่มสมมติ', purpose: 'อุปกรณ์อีกสาขา', title: 'บิลอีกกลุ่ม',
    rows: ['ผู้ขาย: ร้านอีกกลุ่มสมมติ', 'รายการ: อุปกรณ์อีกสาขา', 'ยอดรวม: 60.00 บาท', 'ใช้ทดสอบร่างแยกตามเอกสารและกลุ่ม'], analysis: { supplier_name: 'ร้านอีกกลุ่มสมมติ', document_class: 'standard_bill' } }
];
const escapeXml = (text) => String(text).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const documentSvg = (item) => `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
  <rect width="960" height="1280" fill="#eff4f3"/><rect x="48" y="48" width="864" height="1184" rx="24" fill="#fff" stroke="#d1ded8" stroke-width="3"/>
  <rect x="80" y="84" width="800" height="96" rx="12" fill="#1d5645"/>
  <g font-family="Tahoma, Arial, sans-serif"><text x="110" y="145" fill="white" font-size="34">SOLAO • ชุดทดสอบสมมติ</text>
  <text x="100" y="258" font-size="39" fill="#153a30">${escapeXml(item.title)}</text>
  <text x="100" y="320" font-size="25" fill="#667c72">เอกสาร #${item.id} • ${businessDate} • ${escapeXml(item.group)}</text>
  <line x1="100" y1="365" x2="860" y2="365" stroke="#cddbd4" stroke-width="2"/>
  ${item.rows.map((row, index) => `<text x="110" y="${435 + index * 98}" font-size="31" fill="#244d40">${escapeXml(row)}</text>`).join('')}
  <rect x="100" y="960" width="760" height="150" rx="16" fill="#fff5df"/>
  <text x="132" y="1025" fill="#7d5520" font-size="32">ข้อมูลและเลขบัญชีสมมติเท่านั้น</text>
  <text x="132" y="1077" fill="#7d5520" font-size="25">ใช้ตรวจหน้า desktop • ไม่ใช่หลักฐานการเงินจริง</text>
  <text x="100" y="1180" fill="#7b8f84" font-size="22">Generated Local fixture • expense readiness phase 1</text></g></svg>`;
const insertItem = sql.prepare(`INSERT INTO capture_items
  (id,line_message_id,source_type,source_id,sender_user_id,category,status,content_type,file_extension,file_size_bytes,file_sha256,
   storage_path,storage_relative_path,vendor_name,supplier_name,bill_purpose,bill_total_text,bill_total_value,slip_amount_text,slip_amount_value,
   match_status,matched_item_id,ai_status,ai_raw_text,ai_summary,ai_result_json,context_message_id,event_timestamp_ms,raw_event_json,downloaded_at,created_at,updated_at)
  VALUES(?,?,'group',?,?,?,'downloaded','image/svg+xml','svg',?,?,?,?,?,?,?,?,?,?,?,?,?,'done',?,?,?,?,?,'{}',?,?,?)`);
const insertImageMessage = sql.prepare(`INSERT INTO line_messages
  (line_message_id,message_type,source_type,source_id,sender_user_id,text,status,event_timestamp_ms,raw_event_json,created_at,updated_at)
  VALUES(?,'image','group',?,?, '[image]','active',?,'{}',?,?)`);
for (const item of cases) {
  const filename = `expense-doc-${item.id}.svg`;
  const imagePath = path.join(imageDir, filename);
  const svg = Buffer.from(documentSvg(item));
  await fs.writeFile(imagePath, svg, { flag: 'wx' });
  const bill = item.category === 'bill';
  const stamp = baseTimestamp + (item.id - 1) * 5 * 60000;
  const sender = bill ? 'Ufictional-buyer' : 'Ufictional-payer';
  insertItem.run(item.id, `fictional-image-${item.id}`, item.group, sender, item.category, svg.length,
    crypto.createHash('sha256').update(svg).digest('hex'), imagePath, `images/${filename}`,
    item.supplier || null, item.supplier || null, item.purpose || null, bill ? item.amount.toFixed(2) : null, bill ? item.amount : null,
    bill ? null : item.amount.toFixed(2), bill ? null : item.amount, item.id <= 2 ? 'confirmed' : 'unmatched',
    item.id === 1 ? 2 : item.id === 2 ? 1 : null, item.rows.join('\n'), item.title,
    JSON.stringify(item.analysis), item.id === 1 ? 101 : null, stamp, createdAt, createdAt, createdAt);
  insertImageMessage.run(`fictional-image-${item.id}`, item.group, sender, stamp, createdAt, createdAt);
}
const insertText = sql.prepare(`INSERT INTO line_messages
  (id,line_message_id,message_type,source_type,source_id,sender_user_id,text,status,event_timestamp_ms,raw_event_json,created_at,updated_at)
  VALUES(?,?,'text','group',?,? ,?,'active',?,'{}',?,?)`);
insertText.run(101, 'fictional-chat-101', mainGroup, 'Ufictional-buyer', 'ผักสำหรับครัวสาขาทดสอบ จากร้านครัวสมมติ ยอด100.01 บาท ผู้รับในสลิปเป็นบัญชีรับแทนร้าน ขอให้คนตรวจความสัมพันธ์ก่อนยืนยัน', baseTimestamp + 60000, createdAt, createdAt);
insertText.run(102, 'fictional-chat-102', mainGroup, 'Ufictional-buyer', 'บิล #3 ยังไม่ทราบชื่อร้านและซื้ออะไร กรุณากรอกฉบับร่างไว้ก่อน', baseTimestamp + 11 * 60000, createdAt, createdAt);
insertText.run(103, 'fictional-chat-103', mainGroup, 'Ufictional-payer', 'รายการ #5 คืนเงินลูกค้าสมมติ ไม่ใช่ซื้อสินค้า บันทึกชนิดธุรกรรมพร้อมหมายเหตุ', baseTimestamp + 21 * 60000, createdAt, createdAt);
insertText.run(104, 'fictional-chat-104', otherGroup, 'Ufictional-buyer', 'อุปกรณ์อีกสาขา60 บาท ใช้ทดสอบร่างแยกกลุ่ม', baseTimestamp + 26 * 60000, createdAt, createdAt);
for (const [group, name] of [[mainGroup, 'สาขาทดสอบหลัก'], [otherGroup, 'อีกกลุ่มทดสอบ']]) {
  sql.prepare(`INSERT INTO line_groups(source_type,source_id,source_key,first_seen_at,last_seen_at,message_count,text_count,image_count)
    VALUES('group',?,?,?,?,?,?,?)`).run(group, `group:${group}`, createdAt, createdAt, group === mainGroup ? 8 : 2, group === mainGroup ? 3 : 1, group === mainGroup ? 5 : 1);
  for (const [userId, displayName] of [['Ufictional-buyer', 'ผู้ซื้อสมมติ'], ['Ufictional-payer', 'ผู้จ่ายสมมติ']]) {
    sql.prepare(`INSERT INTO line_senders(source_type,source_id,user_id,display_name,created_at,updated_at) VALUES('group',?,?,?,?,?)`)
      .run(group, userId, displayName, createdAt, createdAt);
  }
}
sql.prepare(`INSERT INTO capture_matches(bill_item_id,slip_item_id,score,status,reason_json,created_by,reviewed_by,reviewed_at,confirmed_at,created_at,updated_at)
  VALUES(1,2,100,'confirmed','["คู่เอกสารสมมติที่คนยืนยันไว้แล้ว"]','dot','dot',?,?,?,?)`).run(createdAt, createdAt, createdAt, createdAt);
sql.close();
const portArgument = process.argv.find((arg) => arg.startsWith('--port='));
let port = Number(portArgument?.split('=')[1] ?? 0);
assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid loopback port');
if (port === 0) {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
}
const baseUrl = `http://127.0.0.1:${port}`;
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|DATABASE_URL)/i.test(key)) delete childEnv[key];
Object.assign(childEnv, { HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', CAPTURE_DATA_DIR: dataDir, CAPTURE_DB_PATH: dbPath,
  ADMIN_AUTH_MODE: 'operator_only', ADMIN_AUTH_DISABLED: '0', ADMIN_OPERATOR_NAMES: '["dot","ผู้ตรวจสมมติ"]',
  ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex'), DECISION_REASON_REQUIRED: '1',
  AI_PROVIDER: 'mock', AI_WORKER_ENABLED: 'false', OPENAI_API_KEY: '', OPENAI_BASE_URL: '',
  LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN: '', LINE_BILL_CAPTURE_CHANNEL_SECRET: '', LINE_BILL_CAPTURE_ACCOUNTING_EXPORT_TOKEN: '',
  LINE_BILL_CAPTURE_PUSH_MOCK: '1', LINE_BILL_CAPTURE_SILENT_MODE: '1', AI_TRACE_ENABLED: '0',
  LINE_BILL_CAPTURE_GROUP_LABELS: JSON.stringify({ [mainGroup]: 'สาขาทดสอบหลัก', [otherGroup]: 'อีกกลุ่มทดสอบ' }) });
const child = spawn(process.execPath, ['src/server.js'], { cwd: source, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
const logPath = path.join(reports, `expense-desktop-server-${path.basename(dataDir)}.log`);
const log = await fs.open(logPath, 'wx');
let lastOutput = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => { lastOutput = (lastOutput + bytes).slice(-6000); log.appendFile(bytes).catch(() => {}); });
const stop = (signal = 'SIGTERM') => { if (child.exitCode === null) child.kill(signal); };
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop());
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Fictional preview did not start: ${lastOutput}`);
  const login = await fetch(`${baseUrl}/api/auth/operator`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ operator: 'dot' }) });
  assert.equal(login.status, 303, 'Operator selector must work');
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const imageChecks = [];
  for (const item of cases) {
    const response = await fetch(`${baseUrl}/api/admin/items/${item.id}/image`, { headers: { cookie } });
    const bytes = await response.text();
    assert.equal(response.status, 200, `Image #${item.id} endpoint failed`);
    assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(bytes, /<svg/);
    assert.match(bytes, /ชุดทดสอบสมมติ/);
    imageChecks.push({ item_id: item.id, status: response.status, bytes: Buffer.byteLength(bytes), content_type: response.headers.get('content-type') });
  }
  const baselineSql = new DatabaseSync(dbPath, { readOnly: true });
  const originalValues = Object.fromEntries(['capture_items', 'capture_matches', 'capture_cash_payments', 'capture_daily_closings', 'ai_learning_examples', 'ai_category_learning_examples', 'line_transfer_requests']
    .map((table) => [table, baselineSql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  baselineSql.close();
  const baselinePath = path.join(reports, `expense-desktop-original-${path.basename(dataDir)}.json`);
  await fs.writeFile(baselinePath, JSON.stringify(originalValues, null, 2), { flag: 'wx' });
  const report = { fictional: true, base_url: baseUrl, admin_url: `${baseUrl}/admin?view=day&date=${businessDate}&group=${mainGroup}`,
    business_date: businessDate, groups: [mainGroup, otherGroup], data_dir: dataDir, db_path: dbPath, baseline_path: baselinePath, log_path: logPath,
    cases: cases.map(({ id, category, group, amount, title }) => ({ item_id: id, category, source_id: group, amount, title })),
    image_checks: imageChecks, ai_worker_enabled: false, line_push_mock: true };
  let reportPath = path.join(reports, 'expense-desktop-preview.json');
  try { await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    reportPath = path.join(reports, `expense-desktop-preview-${path.basename(dataDir)}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  }
  console.log(`Fictional desktop preview ready: ${baseUrl}`);
  console.log(`Admin: ${report.admin_url}`);
  console.log(`Fixture: ${reportPath}`);
  console.log(`Verified ${imageChecks.length} protected SVG image endpoints; fresh SSD DB: ${dbPath}`);
  if (process.argv.includes('--seed-only')) stop();
  if (child.exitCode === null) await once(child, 'exit');
} finally {
  stop();
  await log.close();
}
