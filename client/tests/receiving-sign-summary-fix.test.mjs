import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, armPad } from './receiving-harness.mjs';
import { open, signed, doc, row, sign, draw, btn, text, cleanup, historyBrowser } from './review-a-port-harness.mjs';
import { lineDiffersFromOrder, signSummaryText } from '../src/pages/receiving/review-a.js';

afterEach(cleanup);
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const opens = h => h.visible().filter(n => n.type === 'button' && h.text(n).startsWith('แตะเพื่อเซ็น'));
const canvases = h => h.visible().filter(n => n.type === 'canvas');
const signCalls = h => h.calls.filter(c => c[0] === 'signature');

// ---- P5: a scrolling finger must never become ink ----
test('P5: unsigned inline pads show only a tap target; there is no canvas or pointer handler on the page', async () => {
  const h = await open(signed({ has_receiver_signature: false })); await sign(h);
  assert.equal(opens(h).length, 2); assert.equal(canvases(h).length, 0);
  for (const node of opens(h)) {
    assert.equal(node.props.onPointerDown, undefined); assert.equal(node.props.onPointerMove, undefined);
    assert.equal(node.props.disabled, false);
  }
  assert.ok(h.visible().every(n => !n.props.onPointerDown), 'nothing on the signing page accepts pointer drawing');
  assert.equal(signCalls(h).length, 0);
});

test('P5: both receiver and deliverer pads open a focused sheet with cancel, clear and save', async () => {
  for (const index of [0, 1]) {
    const h = await open(signed({ has_receiver_signature: false })); await sign(h);
    await armPad(h, index);
    assert.equal(canvases(h).length, 1);
    const labels = h.visible().filter(n => n.type === 'button').map(n => h.text(n) || n.props['aria-label']);
    for (const label of ['ยกเลิก', 'ล้างเส้น', 'บันทึกเซ็น']) assert.ok(labels.includes(label), label);
    assert.match(text(h), index === 0 ? /เซ็นชื่อ · ผู้รับ/ : /เซ็นชื่อ · ผู้ส่งของ/);
    assert.equal(btn(h, 'บันทึกเซ็น').props.disabled, true, 'save needs ink');
    h.unmount();
  }
});

test('P5: cancel discards ink without any write and the next open starts blank', async () => {
  const h = await open(signed({ has_receiver_signature: false })); await sign(h);
  await draw(h); assert.equal(btn(h, 'บันทึกเซ็น').props.disabled, false);
  // P9 changed this: with ink, cancel first asks "ทิ้งลายเซ็นนี้?" (same as Back); the ink goes only on confirmation.
  await h.click('ยกเลิก'); assert.match(text(h), /ทิ้งลายเซ็นนี้\?/); await h.click('ทิ้งลายเซ็น');
  assert.equal(canvases(h).length, 0); assert.equal(opens(h).length, 2); assert.equal(signCalls(h).length, 0);
  assert.equal(btn(h, 'ยืนยันรับสินค้า').props.disabled, true);
  await armPad(h); assert.equal(btn(h, 'บันทึกเซ็น').props.disabled, true);
});

test('P5: Android Back (history pop) with no ink cancels the sheet and keeps the page and signature state untouched', async () => {
  const browser = historyBrowser();
  const h = await open(signed({ has_receiver_signature: false }), {}, {}, {}, browser); await sign(h);
  await armPad(h); assert.equal(canvases(h).length, 1);
  browser.history.back(); await h.settle();
  assert.equal(canvases(h).length, 0); assert.equal(signCalls(h).length, 0); assert.equal(opens(h).length, 2);
});

// P9 changed the original P5 expectation: Back with drawn ink used to discard it silently. Back is now the same
// as "ยกเลิก": it asks once inside the sheet; the ink is only dropped after "ทิ้งลายเซ็น".
test('P5/P9: Android Back (history pop) with ink asks inside the sheet and only discards on confirmation', async () => {
  const browser = historyBrowser();
  const h = await open(signed({ has_receiver_signature: false }), {}, {}, {}, browser); await sign(h);
  await draw(h); assert.equal(canvases(h).length, 1);
  browser.history.back(); await h.settle();
  assert.equal(h.all().filter(n => n.type === 'canvas').length, 1, 'the sheet and its ink stay while the question is open'); assert.match(text(h), /ทิ้งลายเซ็นนี้\?/);
  await h.click('ทิ้งลายเซ็น');
  assert.equal(canvases(h).length, 0); assert.equal(signCalls(h).length, 0); assert.equal(opens(h).length, 2);
  assert.doesNotMatch(text(h), /ทิ้งลายเซ็นนี้\?/);
});

test('P5: saving from the sheet writes once with the existing data URL format and closes the sheet', async () => {
  const h = await open(signed({ has_receiver_signature: false })); await sign(h);
  await draw(h); await h.click('บันทึกเซ็น');
  assert.equal(signCalls(h).length, 1); assert.equal(signCalls(h)[0][2], 'receiver');
  assert.equal(signCalls(h)[0][3], 'synthetic-signature');
  assert.equal(canvases(h).length, 0);
  assert.equal(btn(h, 'ยืนยันรับสินค้า').props.disabled, false);
});

test('P5: read-only and already-signed pads never offer drawing', async () => {
  const h = await open(signed()); await sign(h);
  assert.equal(canvases(h).length, 0); assert.equal(opens(h).length, 1, 'only the unsigned deliverer pad is open to sign');
  const pad = await harness('SignaturePad', { label: 'ผู้รับ', inline: true, readOnly: true });
  assert.equal(canvases(pad).length, 0); assert.equal(opens(pad).length, 0); pad.unmount();
});

test('P5: CSS keeps drawing surfaces touch-locked only inside the sheet, with 48px actions', async () => {
  const css = await read('../src/pages/receiving/receiving.css');
  assert.match(css, /\.rc-sign-open \{[^}]*touch-action: pan-y/);
  assert.match(css, /\.rc-signature \.rc-sign-sheet canvas \{[^}]*touch-action: none/);
  assert.match(css, /\.rc-sign-actions > \* \{ min-height: 48px/);
  const source = await read('../src/pages/receiving/SignaturePad.jsx');
  assert.match(source, /backDismiss/); assert.match(source, /rc-image-fullscreen/);
});

// ---- P3: only real differences are counted and accented ----
const ordered = (id, received, orderedQty, patch = {}) => row(id, { quantity_ordered: String(orderedQty), quantity_received: String(received), counted_quantity: String(received), review_decision: 'missing_bill', ...patch });
const manual = lines => doc({ kind: 'manual_receipt', lines });

// Owner 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the sign card line is only "รับ X จาก Y รายการ"; differences stay in รายละเอียดสรุป.
test('P3: no-bill receipt counts only lines that differ from the order; the sign line says only what was received', () => {
  const lines = [ordered(1, 3, 10), ordered(2, 10, 10), ordered(3, 2, 10), ordered(4, 4, 10)];
  assert.deepEqual(lines.map(lineDiffersFromOrder), [true, false, true, true]);
  assert.equal(signSummaryText(manual(lines)), 'รับ 4 จาก 4 รายการ');
  assert.equal(signSummaryText(manual([ordered(1, 10, 10), ordered(2, 5, 5)])), 'รับ 2 จาก 2 รายการ');
});

test('P3: a line with no order quantity, or an explicit non-bill decision, still counts as a difference', () => {
  assert.equal(lineDiffersFromOrder(ordered(1, 4, 10, { quantity_ordered: null })), true);
  assert.equal(lineDiffersFromOrder(ordered(1, 10, 10, { review_decision: 'wrong_product' })), true);
  assert.equal(lineDiffersFromOrder(ordered(1, 10, 10, { review_decision: null })), false);
});

test('P3: billed receipts say only what was received on the sign line', () => {
  const lines = [row(1, { review_decision: 'accept' }), row(2, { review_decision: 'short' }), row(3, { review_decision: 'price_review' })];
  assert.equal(signSummaryText(doc({ lines })), 'รับ 3 จาก 3 รายการ');
});

test('P3: sign-step summary and cards render the real count; matched cards are neutral', async () => {
  const lines = [ordered(1, 3, 10), ordered(2, 10, 10), ordered(3, 2, 10), ordered(4, 4, 10)];
  const compact = await harness('ReviewSummary', { doc: manual(lines), compact: true });
  const card = compact.find(n => n.props.className === 'ra-sign-summary');
  assert.equal(compact.text(card.props.children[0]), 'รับ 4 จาก 4 รายการ', 'one line on the card');
  const folded = compact.all(card).find(n => n.type === 'details');
  assert.match(compact.text(folded), /ไม่ตรงใบสั่ง 3 รายการ/, 'the real difference count stays in รายละเอียดสรุป');
  assert.doesNotMatch(compact.text(compact.visible()), /4 ข้อแตกต่าง|ต้องขอบิล 1 ใบ/); compact.unmount();
  const full = await harness('ReviewSummary', { doc: manual(lines) });
  const cards = full.visible().filter(n => n.type === 'article' && n.props.className === 'ra-card');
  assert.deepEqual(cards.map(n => n.props['data-match']), [undefined, 'matched', undefined, undefined]);
  assert.match(full.text(cards[1]), /ตรงตามใบสั่ง/); full.unmount();
  const css = await read('../src/pages/receiving/review-a.css');
  assert.match(css, /\.ra-card\[data-match='matched'\] \{ border-left-color: var\(--sg-control-border\)/);
});
