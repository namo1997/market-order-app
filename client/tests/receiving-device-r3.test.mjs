import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { harness } from './receiving-harness.mjs';
import { needsBillCheck } from '../src/pages/receiving/receiving-illustration-state.js';

const user = { id: 1, name: 'ผู้รับทดสอบ', role: 'receiver', branch_id: 1, department_id: 1 };
const line = (id = 1, manual = false) => ({ id, line_no: id, product_id: 7, product_name: `ผัก ${id}`, bill_text: `ผัก ${id}`,
  order_item_id: 42, unit_text: 'กก.', quantity_received: '0.2', quantity_billed: '0.2', unit_price: '10', amount: '2', match: { source: manual ? 'manual' : 'order' } });
const document = (values = {}) => ({ id: 5, status: 'draft', kind: 'bill', supplier_name_text: 'ร้านทดสอบ',
  delivery_date: '2026-10-16', has_receiver_signature: false, total: '20', discount: '0', vat: '0',
  images: [{ id: 1, page_no: 1 }], lines: Array.from({ length: 10 }, (_, i) => line(i + 1)),
  ocr: { status: 'done' }, warnings: [], ...values });
const editor = (doc = document(), api = {}, props = {}) => harness('DocumentEditor', {
  initialDocument: doc, user, onBack() {}, onChanged() {}, ...props,
}, { image: async () => new Blob(['synthetic']), ...api }, {}, {}, { setTimeout: done => { done(); return 1; }, clearTimeout() {} });
const art = (h, state) => h.visible().some(node => node.props['data-illustration'] === state);
const primary = h => h.find(node => node.type === 'button' && node.props.className?.includes('sg-primary'));
const trigger = h => h.find(node => node.props.className === 'rc-review-trigger');
const showChecks = async h => { trigger(h).props.onClick(); await h.settle(); };

test('device r3: bill warning requires completed OCR, explicit NOT_A_BILL and zero useful item rows', () => {
  for (const status of ['none', 'pending', 'failed', 'done']) {
    for (const code of [undefined, 'DOC_KIND_UNCERTAIN', 'NOT_A_BILL']) {
      for (const lines of [[], [{ bill_text: '  ' }], [line()], [{ bill_text: 'ผัก', quantity_received: 'bad' }]]) {
        const doc = document({ lines, ocr: { status, warnings: code ? [code] : [] } });
        assert.equal(needsBillCheck(doc), status === 'done' && code === 'NOT_A_BILL' && (lines.length === 0 || lines[0].bill_text === '  '));
      }
    }
  }
  assert.equal(needsBillCheck(document({ lines: [], warnings: [{ code: 'NOT_A_BILL' }] })), true);
  assert.equal(needsBillCheck(document({ lines: [], ocr: { status: 'done', warnings: [{ code: 'NOT_A_BILL' }] } })), true);
});









test('device r3: repeated card taps issue one read while opening; failure preserves retry target', async () => {
  let reject, reads = 0;
  const promise = new Promise((_, fail) => { reject = fail; });
  const h = await harness('Receiving', {}, { list: async () => [document()], get: () => { reads++; return promise; } });
  await h.radio('documents');
  const card = h.find(node => node.props.className === 'rc-document-card');
  const first = card.props.onClick(); const second = card.props.onClick(); await h.settle();
  assert.equal(reads, 1); assert.equal(h.find(node => node.props.className === 'rc-document-card').props.disabled, true);
  reject({ response: { status: 503 } }); await Promise.all([first, second]); await h.settle();
  assert.equal(art(h, 'error'), true);
  h.api.get = async id => { reads++; assert.equal(id, 5); return document(); }; h.api.image = async () => new Blob(['synthetic']);
  await h.click('ลองใหม่'); assert.equal(reads, 2); h.unmount();
});







test('device r3: new content controls declare 48px targets and visible focus using shared tokens', async () => {
  const css = postcss.parse(await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8'));
  for (const selector of ['.solao .rc-document-card', '.solao .rc-review-trigger', '.solao .rc-check-row']) {
    let height;
    css.walkRules(selector, rule => rule.walkDecls('min-height', declaration => { height = declaration.value; }));
    assert.equal(height, 'var(--sg-touch)');
  }
  assert.ok(css.nodes.some(node => node.selector?.includes('.rc-document-card, .rc-review-trigger, .rc-check-row):focus-visible')));
});
