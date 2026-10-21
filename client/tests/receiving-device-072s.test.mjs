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

test('072s #4 sign step: optional courier name/signature come before the receiver and show no warning pill', async () => {
  const editor = await source('DocumentEditor.jsx');
  const sign = editor.slice(editor.indexOf("{step === 'sign' && !blind"));
  assert.ok(sign.indexOf('ชื่อผู้ส่งของ (ไม่บังคับ)') < sign.indexOf("role=\"receiver\""));
  assert.ok(sign.indexOf('role="courier"') < sign.indexOf('role="receiver"'));
  assert.match(sign, /บันทึกชื่อแล้วต้องเซ็นผู้รับใหม่/);
  const pad = await source('SignaturePad.jsx');
  assert.match(pad, /\{!\(optional && !saved && !ink && !busy\) && <StatusPill/);
  assert.match(pad, /current === 'บันทึกลายเซ็นแล้ว' \? '' : current/);
});

test('072s #5 one reload label in every step; no-order line reads plainly', async () => {
  assert.doesNotMatch(await source('DocumentEditor.jsx'), /ตรวจผลการนับล่าสุด/);
  const manual = await source('ManualReceiptSummary.jsx');
  assert.match(manual, /'ไม่ได้อยู่ในใบสั่ง'/);
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
  assert.match(editor, /scanEmpty \? 'ยังไม่มีรูปบิล · สแกนอีกครั้ง หรือรับแบบไม่มีบิล'/);
  assert.match(editor, /step === 'images' && !scanEmpty && <p className="ra-evidence-state">/);
});

test('072s #10 locked steps look locked, success has one confirmation line, API setting is tucked away, issue link is a button', async () => {
  const css = await source('review-a.css');
  assert.match(css, /\.ra-steps button:disabled:not\(\[aria-current\]\) \{ background: transparent;[^}]*border-style: dashed;/);
  assert.match(css, /\.ra-steps button\[aria-current\]:disabled \{[^}]*opacity: 1;/);
  assert.match(await source('DocumentEditor.jsx'), /state="received-success" eager description=""/);
  const app = await readFile(new URL('../src/receiving-app/ReceivingApp.jsx', import.meta.url), 'utf8');
  const actions = app.slice(app.indexOf('<div className="apk-actions">'), app.indexOf('<details><summary>ข้อมูลแอป'));
  assert.doesNotMatch(actions, /ตั้งค่า API/); assert.match(app, /<summary>ข้อมูลแอป<\/summary>.*ตั้งค่า API/s);
  assert.match(await source('Receiving.jsx'), /rc-issues-link/);
  const issues = await readFile(new URL('../src/receiving-app/ReceivingIssues.jsx', import.meta.url), 'utf8');
  assert.match(issues, /เปิดเรื่อง \{issueTime\(item\.created_at\)\} · กำหนดตาม/);
});
