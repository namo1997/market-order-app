import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decimalEntryMessageFor, decimalEntryMessage } from '../src/pages/receiving/decimal-entry.js';

// Owner request 2026-10-21 "test every page yourself": findings from the SM-A075F walk-through (report 072s).
const source = name => readFile(new URL(`../src/pages/receiving/${name}`, import.meta.url), 'utf8');

test('072s #1 number pad mistakes get a specific hint: comma, second dot, otherwise the generic rule', () => {
  assert.equal(decimalEntryMessageFor('2,5'), 'ทศนิยมใช้จุด (.) ไม่ใช่จุลภาค (,)');
  assert.equal(decimalEntryMessageFor('1.2.3'), 'ใส่จุดทศนิยมได้ครั้งเดียว');
  assert.equal(decimalEntryMessageFor('-5'), decimalEntryMessage);
});

test('072s #2 a filled count is selected on tap and the hint survives the next valid digit until blur/empty', async () => {
  const field = await source('ReceivingNumberField.jsx');
  assert.match(field, /input\.select\?\.\(\)/);
  assert.match(field, /onPointerUp=\{event => \{\s+if \(selectOnTap\.current\)/);
  assert.match(field, /else if \(!raw\) setEntryError\(''\)/);
  assert.match(field, /onBlur=\{event => \{ setFocused\(false\); setEntryError\(''\);/);
});

test('072s #3 signature keeps its drawn aspect: backing height follows the on-screen box before the first stroke', async () => {
  const { fitCanvasAspect } = await import('../src/pages/receiving/SignaturePad.jsx').catch(() => ({}));
  const pad = await source('SignaturePad.jsx');
  assert.match(pad, /if \(!ink\) fitCanvasAspect\(canvas\.current\)/);
  if (fitCanvasAspect) {
    const canvas = { width: 760, height: 240, getBoundingClientRect: () => ({ width: 600, height: 760 }) };
    fitCanvasAspect(canvas); assert.equal(canvas.height, 963);
  }
});

test('072s #4 (owner 2026-10-22) sign step: required receiver first, optional courier folded below, no warning pill', async () => {
  const editor = await source('DocumentEditor.jsx');
  const sign = editor.slice(editor.indexOf("{step === 'sign' && !blind"));
  assert.ok(sign.indexOf('role="receiver"') < sign.indexOf('<details className="ra-courier"'));
  assert.ok(sign.indexOf('<details className="ra-courier"') < sign.indexOf('ชื่อผู้ส่งของ (ไม่บังคับ)'));
  assert.ok(sign.indexOf('ชื่อผู้ส่งของ (ไม่บังคับ)') < sign.indexOf('role="courier"'));
  assert.match(sign, /บันทึกชื่อแล้วต้องเซ็นผู้รับใหม่/);
  const pad = await source('SignaturePad.jsx');
  assert.match(pad, /\{!\(optional && !saved && !ink && !busy\) && <StatusPill/);
  // Owner 2026-10-24: the "เซ็นแล้ว" pill is the only saved state; no separate "บันทึกลายเซ็นแล้ว" line.
  assert.doesNotMatch(pad, /setMessage\('บันทึกลายเซ็นแล้ว'\)/);
});

test('072s #5 one reload label in every step; no-order line reads plainly', async () => {
  assert.doesNotMatch(await source('DocumentEditor.jsx'), /ตรวจผลการนับล่าสุด/);
  const manual = await source('ManualReceiptSummary.jsx');
  assert.match(manual, /'นอกใบสั่ง'/); // owner 2026-10-24: neutral wording, not ไม่ตรง/ไม่ได้อยู่
  assert.match(manual, /line\.quantity_ordered == null \? null/);
});

test('072s #6 every count is read back before it is locked; the read-back can go back to edit', async () => {
  const editor = await source('DocumentEditor.jsx');
  const submit = editor.slice(editor.indexOf("check_only: true"), editor.indexOf("incomplete > 0 || !doc.lines.length)}"));
  assert.match(submit, /setCountReview\(true\)/); assert.doesNotMatch(submit, /await persistCount\(\)/);
  assert.match(editor, /title="ทวนจำนวนก่อนยืนยัน"/); assert.match(editor, />ถูกต้อง ยืนยันการนับ</); assert.match(editor, />กลับไปแก้</);
  assert.match(editor, /ยืนยันแล้วแก้จำนวนไม่ได้/);
});

test('072s #7 plain words: ไม่มา chip, Thai reload dialog, no-price card, issue labels and recent receipts', async () => {
  const editor = await source('DocumentEditor.jsx');
  assert.match(editor, />ไม่มา<\/button>/); assert.doesNotMatch(editor, /window\.confirm/);
  assert.match(editor, /title="โหลดเอกสารล่าสุด\?"/); assert.match(editor, /โหลดใหม่ ทิ้งที่ยังไม่บันทึก/);
  assert.match(await source('Receiving.jsx'), /'ยังไม่มีราคา'/);
  assert.doesNotMatch(await source('SignaturePad.jsx'), /การเลื่อนหน้าจะไม่ทำให้เกิดเส้น/);
  const create = await readFile(new URL('../src/receiving-app/ReceivingIssueCreate.jsx', import.meta.url), 'utf8');
  assert.match(create, /สินค้าที่มีปัญหา/); assert.match(create, /ต้องตามภายใน/); assert.doesNotMatch(create, /บรรทัดอ้างอิง|เวลาไทย|สาขา \{doc\.branch_id\}/);
  assert.match(create, /api\.recentDocuments\?\.\(\)/); assert.match(create, /เลือกใบรับที่มีปัญหา/);
});

test('072s #8 recent receipt dates read in Thai', async () => {
  const { thaiDay } = await import('../src/receiving-app/ReceivingIssueCreate.jsx').catch(() => ({}));
  const create = await readFile(new URL('../src/receiving-app/ReceivingIssueCreate.jsx', import.meta.url), 'utf8');
  assert.match(create, /thaiDay\(item\.delivery_date\)/);
  if (thaiDay) { assert.equal(thaiDay('2026-10-21'), '21 ต.ค. 2569'); assert.equal(thaiDay(null), ''); }
});

test('072s #9 a registered code or exact name is not offered again as a new shop; cancelled scan has one plain line', async () => {
  const picker = await source('SupplierPicker.jsx');
  assert.match(picker, /!results\.some\(row => \[row\.code, row\.name\]/);
  const editor = await source('DocumentEditor.jsx');
  // Walkthrough 2026-10-24: the cancelled scan says it once in the footer; the two alternatives are quiet buttons.
  assert.match(editor, /\{actionReason \|\| 'ยังไม่มีรูปบิล'\}/); assert.match(editor, /className="ra-scan-choices"/);
  assert.match(editor, /step === 'images' && !scanEmpty && !doc\.images\.length && <p className="ra-evidence-state">/);
});

test('072s #10 locked steps look locked, success has one confirmation line, API setting is tucked away, issue link is a button', async () => {
  const css = await source('review-a.css');
  assert.match(css, /\.ra-steps button:disabled:not\(\[aria-current\]\) \{ background: transparent; color: var\(--sg-muted\);[^}]*border: 0;/);
  assert.match(css, /\.ra-steps button\[aria-current\]:disabled \{[^}]*opacity: 1;/);
  assert.match(css, /\.ra-steps button\[aria-current\]::before \{ border-color: var\(--sg-action\); background: var\(--sg-action\); \}/);
  assert.match(await source('DocumentEditor.jsx'), /state="received-success" eager description=""/);
  const app = await readFile(new URL('../src/receiving-app/ReceivingApp.jsx', import.meta.url), 'utf8');
  const actions = app.slice(app.indexOf('<div className="apk-actions">'), app.indexOf('<details><summary>ข้อมูลแอป'));
  assert.doesNotMatch(actions, /ตั้งค่า API/); assert.match(app, /<summary>ข้อมูลแอป<\/summary>.*ตั้งค่า API/s);
  assert.match(await source('Receiving.jsx'), /rc-issues-link/);
  const issues = await readFile(new URL('../src/receiving-app/ReceivingIssues.jsx', import.meta.url), 'utf8');
  // Owner 2026-10-24: the four-line card has no date line; opened/due times are in the detail.
  const card = issues.slice(issues.indexOf('<article className="ri-issue-card"'), issues.indexOf('</article>'));
  assert.doesNotMatch(card, /issueTime/);
  const detail = await readFile(new URL('../src/receiving-app/ReceivingIssueDetail.jsx', import.meta.url), 'utf8');
  assert.match(detail, /\['เปิดเรื่อง',issueTime\(row\.created_at\)\]/); assert.match(detail, /กำหนดตาม \{issueTime\(row\.due_at\)\}/);
});

test('072s #11 early read: names from the bill fill the blind count, typed counts survive, confirm waits for the read', async () => {
  const editor = await source('DocumentEditor.jsx');
  assert.match(editor, /if \(blind && hasNewImages\) startEarlyRead\(next\)/);
  assert.match(editor, /next\.kind !== 'bill' \|\| next\.scope === 'branch'/);
  assert.match(editor, /line\.product_name \|\| line\.bill_name \|\| 'รายการจากบิล'/);
  assert.match(editor, /incomplete > 0 \|\| !doc\.lines\.length \|\| earlyRead === 'pending'/);
  assert.match(editor, /earlyRead === 'pending' && <div className="ra-reading-mini" role="status" aria-busy="true"/);
});

test('072s #12 English units read from a bill show as Thai units in the count (display only)', async () => {
  const { thaiUnit } = await import('../src/pages/receiving/receiving-utils.js');
  assert.equal(thaiUnit('Kilogram'), 'กก.'); assert.equal(thaiUnit('KG'), 'กก.'); assert.equal(thaiUnit('pcs.'), 'ชิ้น');
  assert.equal(thaiUnit('ถุง'), 'ถุง'); assert.equal(thaiUnit(''), '');
  // 2026-10-26: the count unit comes from countView (bill pack unit for pack lines, else the Thai product unit).
  assert.match(await source('DocumentEditor.jsx'), /unit: inPack \? packUnit : thaiUnit\(line\.unit_text\) \|\| 'หน่วย'/);
  assert.match(await source('DocumentEditor.jsx'), /unit=\{countView\(line\)\.unit\}/);
});

test('072s #13 scope choice is styled as a small filter, not a second main tab bar', async () => {
  assert.match(await source('Receiving.jsx'), /<Segmented className="rc-scope-filter" label="ขอบเขตรับสินค้า"/);
  const css = await source('receiving.css');
  assert.match(css, /\.rc-scope-filter\.sg-segmented \{ display: inline-flex;/); assert.match(css, /content: 'ดูของ'/);
});

test('072s #14 capture then read: new pages on any blind bill draft (also a reopened one with pages) upload and start the early read at once', async () => {
  const editor = await source('DocumentEditor.jsx');
  const effect = editor.slice(editor.indexOf('ถ่ายแล้ววิเคราะห์เลย'), editor.indexOf('const switchToNoBill'));
  assert.match(effect, /if \(step !== 'images' \|\| manual \|\| !blind \|\| !draft/);
  assert.match(effect, /pending\.some\(page => page\.quality\?\.warnings\.length && !page\.qualityAccepted\)/);
  assert.doesNotMatch(effect, /scanFirst|doc\.images\.length\)/, 'must not wait for a button when the draft already has pages');
  assert.match(effect, /act\(uploadBill\)/);
});

test('072s #15 a blind bill draft opened with saved but unread pages starts the early read at once', async () => {
  const editor = await source('DocumentEditor.jsx');
  const effect = editor.slice(editor.indexOf('เอาแบบอ่านเลย'), editor.indexOf('A reopened receipt whose early read is still running'));
  assert.match(effect, /if \(!blind \|\| manual \|\| !online \|\| earlyRead \|\| pending\.length \|\| !doc\.images\.length\) return;/);
  assert.match(effect, /startEarlyRead\(doc\)/);
  // the guard inside startEarlyRead still limits it to department bill drafts that are not counted yet, once per image set
  assert.match(editor, /next\.kind !== 'bill' \|\| next\.scope === 'branch' \|\| next\.counted_complete_at \|\| next\.status !== 'draft'/);
  assert.match(editor, /if \(earlyReadKeys\.current\.has\(key\)\) return;/);
});
