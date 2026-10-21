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
