import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { row, doc, text, btn, cleanup, open } from './review-a-port-harness.mjs';
import { warningText } from '../src/pages/receiving/receiving-utils.js';
afterEach(cleanup);

const MESSAGE = 'รูปนี้เป็นใบวางบิล/ใบสรุปรอบ ไม่ใช่ใบส่งของ — ถ่ายใบส่งของของวันนี้แทน หรือรับแบบไม่มีบิล';
const statement = (patch = {}) => doc({ lines: [row(1, { bill_text: '', quantity_billed: null, unit_price: null, amount: null })],
  images: [{ id: 2, page_no: 1 }], ocr: { status: 'done', doc_kind: 'statement', warnings: [{ code: 'BILL_IS_STATEMENT', line_no: null }] }, ...patch });

test('statement: BILL_IS_STATEMENT has the Thai message and the notice sits outside collapsed details', async () => {
  assert.equal(warningText('BILL_IS_STATEMENT'), MESSAGE);
  const h = await open(statement());
  assert.match(text(h), /รูปนี้เป็นใบวางบิล\/ใบสรุปรอบ ไม่ใช่ใบส่งของ/);
  const notice = h.find(n => n.props.className?.includes?.('ra-statement-notice'));
  assert.ok(!h.all().some(n => n.type === 'details' && h.all(n).includes(notice)), 'notice is not inside a details block');
  for (const label of ['ถ่าย / เพิ่มรูปใบส่งของ', 'รับแบบไม่มีบิล']) assert.ok(!btn(h, label).props.disabled, label);
});

test('statement: no notice for a normal bill, a bill with other warnings, or a manual receipt', async () => {
  for (const patch of [{}, { ocr: { status: 'done', warnings: [{ code: 'NOT_A_BILL' }] } }, { kind: 'manual_receipt', ocr: { status: 'done', warnings: [{ code: 'BILL_IS_STATEMENT' }] } }]) {
    const h = await open(doc(patch));
    assert.doesNotMatch(text(h), /รูปนี้เป็นใบวางบิล/);
    assert.ok(!h.all().some(n => n.props.className?.includes?.('ra-statement-notice')));
  }
});

test('statement: retake action opens the bill photo step without saving or reading', async () => {
  const h = await open(statement());
  await h.click('ถ่าย / เพิ่มรูปใบส่งของ');
  assert.match(text(h), /เพิ่มรูปบิล/);
  assert.equal(h.calls.length, 0);
});

test('statement: "รับแบบไม่มีบิล" switches the draft to manual_receipt through the existing update and keeps the photo', async () => {
  const h = await open(statement());
  await h.click('รับแบบไม่มีบิล');
  const updates = h.calls.filter(call => call[0] === 'update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][2].kind, 'manual_receipt');
  assert.match(text(h), /ใบรับไม่มีบิล/);
  assert.doesNotMatch(text(h), /รูปนี้เป็นใบวางบิล/);
});

test('statement: button styles keep the 48px touch target', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/pages/receiving/review-a.css', import.meta.url), 'utf8');
  assert.match(css, /\.ra-statement-action\s*\{[^}]*min-height:\s*48px/);
});
