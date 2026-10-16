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

test('device r3: reopened pilot OCR without doc_kind keeps 10 proposals and review CTA on both tabs', async () => {
  for (const code of [undefined, 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN']) {
    const h = await editor(document({ ocr: { status: 'done', warnings: code ? [code] : [] } }));
    assert.equal(art(h, 'not-a-bill'), false);
    assert.equal(h.text(trigger(h)), code === 'DOC_KIND_UNCERTAIN' || code === 'NOT_A_BILL' ? 'ตรวจข้อมูลบิล' : 'ไม่มีปัญหาข้อมูล');
    assert.equal(h.text(primary(h)), 'ตรวจรายการ'); h.budget();
    if (code === 'DOC_KIND_UNCERTAIN') assert.ok(h.visible().some(node => node.props['data-status'] === 'review' && h.text(node) === 'ตรวจชนิดเอกสาร'));
    await h.click('ตรวจรายการ');
    assert.equal(art(h, 'not-a-bill'), false); assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 10)'); h.budget();
    await h.click('ตรวจรายการก่อน (ค้าง 10)');
    assert.equal(h.focused.at(-1), 'line-0-inline');
    assert.equal(h.calls.length, 0); assert.equal(art(h, 'sign'), false);
    h.unmount();
  }
});

test('device r3: fresh OCR checks merged human rows, and zero-line nonbill alone offers retake', async () => {
  for (const humanRows of [false, true]) {
    const doc = document({ lines: humanRows ? [line(1, true)] : [], ocr: { status: 'none' } });
    const h = await editor(doc, { ocr: async () => document({ lines: [], ocr: { status: 'done', warnings: ['NOT_A_BILL'] } }) });
    await h.click('อ่านบิล');
    assert.equal(art(h, 'not-a-bill'), !humanRows);
    if (humanRows) { assert.equal(h.text(primary(h)), 'ไปเซ็น'); await h.radio('images'); assert.equal(h.text(primary(h)), 'ตรวจรายการ'); }
    else assert.equal(h.text(primary(h)), 'ถ่ายบิล');
    h.unmount();
  }
  const h = await editor(document({ lines: [], ocr: { status: 'done' } }));
  assert.equal(art(h, 'not-a-bill'), false); assert.equal(h.text(primary(h)), 'อ่านบิล');
  h.unmount();
});

test('device r3: reading pilot mock with 10 rows and no doc_kind lands on review, then keeps review CTA on bill tab', async () => {
  for (const code of ['NOT_A_BILL', 'DOC_KIND_UNCERTAIN']) {
    const h = await editor(document({ lines: [], ocr: { status: 'none' } }), {
      ocr: async () => document({ ocr: { status: 'done', warnings: [code] } }),
    });
    // The mock's persisted image is sufficient to run OCR; no provider is called.
    await h.click('อ่านบิล');
    assert.equal(h.text(primary(h)), 'ตรวจรายการก่อน (ค้าง 10)'); assert.equal(art(h, 'not-a-bill'), false);
    assert.equal(h.text(trigger(h)), 'ตรวจข้อมูลบิล');
    await h.radio('images'); assert.equal(h.text(primary(h)), 'ตรวจรายการ');
    assert.equal(art(h, 'not-a-bill'), false); h.budget(); h.unmount();
  }
});

test('device r3: entire document card opens each status directly, with no document radio or second open action', async () => {
  for (const status of ['draft', 'confirmed', 'void']) {
    let reads = 0;
    const h = await harness('Receiving', {}, { list: async () => [document({ status })], get: async id => { reads++; assert.equal(id, 5); return document({ status }); }, image: async () => new Blob(['synthetic']) });
    await h.radio('documents');
    assert.equal(h.visible().filter(node => node.type === 'input' && node.props.name === 'document').length, 0);
    const card = h.find(node => node.type === 'button' && node.props.className === 'rc-document-card');
    assert.ok(h.text(card).includes('ร้านทดสอบ')); assert.equal(card.props.type, 'button'); h.budget();
    await card.props.onClick(); await h.settle();
    assert.equal(reads, 1); assert.ok(h.text(h.visible()).includes('#5')); assert.ok(h.visible().some(node => node.props['aria-label'] === 'ขั้นตอนรับสินค้า'));
    h.unmount();
  }
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

test('device r3: checks count distinct items, sort warnings by line and focus the selected item', async () => {
  const warnings = [{ code: 'LOW_CONFIDENCE', line_no: 8 }, { code: 'PRICE_CHANGE', line_no: 2 },
    { code: 'LOW_CONFIDENCE', line_no: 2 }, { code: 'LOW_CONFIDENCE', line_no: 2 }, { code: 'DUPLICATE_BILL' }];
  const h = await editor(document({ warnings, total: '25', ocr: { status: 'done', warnings: ['DOC_KIND_UNCERTAIN', 'DOC_KIND_UNCERTAIN'] } }));
  assert.equal(h.text(trigger(h)), 'ดูเหตุเตือน 2 รายการ');
  await showChecks(h);
  const rows = h.visible().filter(node => node.props.className === 'rc-check-row');
  assert.equal(rows.length, 10);
  assert.ok(h.text(rows[1]).startsWith('รายการ 2:')); assert.ok(h.text(rows[7]).startsWith('รายการ 8:'));
  assert.equal(h.text(rows[1]).split('อ่านบิลได้ไม่ชัด').length - 1, 1);
  assert.ok(h.text(h.visible()).includes('ข้อมูลบิล')); assert.ok(h.text(h.visible()).includes('อาจเป็นบิลซ้ำ'));
  assert.equal(h.visible().filter(node => node.type === 'li' && h.text(node).includes('AI ยังไม่แน่ใจชนิดเอกสาร')).length, 1);
  await rows[7].props.onClick(); await h.settle();
  assert.equal(h.focused.at(-1), 'line-7-quantity_received');
  assert.equal(h.all().find(node => node.props.id === 'line-7-review').props.checked, false); // Opening details never selects a bulk row.
  assert.ok(h.find(node => node.props.id === 'line-7-quantity_received')); assert.equal(h.calls.length, 0);
  h.unmount();
});

test('device r3: bill-only warnings have a bill label and zero item warnings', async () => {
  const doc = document({ lines: [line(1, true)], total: '2', warnings: [{ code: 'DUPLICATE_BILL' }, { code: 'DUPLICATE_BILL' }] });
  const h = await editor(doc, { expected: async () => [{ items: [{ order_item_id: 42, product_id: 7, quantity_ordered: '0.2', received_quantity: '0', unit_name: 'กก.' }] }] });
  assert.equal(h.text(trigger(h)), 'ตรวจข้อมูลบิล'); await showChecks(h);
  assert.equal(h.visible().filter(node => node.props.className === 'rc-check-row').length, 0);
  assert.equal(h.visible().filter(node => node.type === 'li' && h.text(node).includes('อาจเป็นบิลซ้ำ')).length, 1); h.unmount();
});

test('device r3: review all 10 proposals -> sign -> confirm -> received-success has one primary per step', async () => {
  let returned = false;
  const rows = Array.from({ length: 10 }, (_, i) => ({ ...line(i + 1), order_item_id: i + 1 }));
  const h = await editor(document({ lines: rows }), { expected: async () => [{ items: rows.map(row => ({ order_item_id: row.order_item_id, product_id: 7, quantity_ordered: '0.2', received_quantity: '0', unit_name: 'กก.' })) }] }, { onBack: () => { returned = true; } });
  await h.click('ตรวจรายการ');
  for (let i = 0; i < 10; i++) {
    await h.acceptAi(`ผัก ${i + 1}`);
  }
  await h.click('ไปเซ็น'); assert.equal(h.text(primary(h)), 'บันทึกเซ็น'); assert.equal(primary(h).props.disabled, true); h.budget();
  const canvas = h.find(node => node.type === 'canvas');
  canvas.props.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 50, clientY: 50, preventDefault() {} });
  canvas.props.onPointerUp(); await h.settle();
  assert.equal(primary(h).props.disabled, false); await h.click('บันทึกเซ็น');
  assert.equal(h.text(primary(h)), 'ตรวจรับ'); h.budget();
  await h.click('ตรวจรับ'); assert.equal(h.text(primary(h)), 'ยืนยัน'); assert.equal(art(h, 'received-success'), false); h.budget();
  await h.click('ยืนยัน'); assert.equal(art(h, 'received-success'), true); assert.equal(h.text(primary(h)), 'รับร้านถัดไป'); h.budget();
  assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1);
  assert.equal(h.calls.find(call => call[0] === 'update')[2].lines.length, 10);
  await h.click('รับร้านถัดไป'); assert.equal(returned, true); h.unmount();
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
