import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { open, doc, row, text, cleanup, clock, track } from './review-a-port-harness.mjs';
import { harness } from './receiving-harness.mjs';
afterEach(cleanup);

test('P1 review shows arithmetic and recipient warnings visibly, deduplicated outside collapsed details', async () => {
  const h = await open(doc({ ocr: { status: 'done', ship_to: 'คันคลอง', warnings: ['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'SHIP_TO_MISMATCH'] } }));
  const status = h.visible().find(node => node.props.role === 'status' && h.text(node).includes('ยอดในบิลไม่ลงตัว'));
  assert.ok(status);
  assert.equal(h.text(status).split('ยอดในบิลไม่ลงตัว ตรวจส่วนลด/VAT').length - 1, 1);
  assert.match(h.text(status), /บิลนี้ส่งสาขาอื่น\?/);
  assert.match(text(h), /ผัก 1/);
});

test('P1 legacy receipt without optional OCR fields renders and blind count does not expose warnings', async () => {
  const legacy = await open(doc());
  assert.doesNotMatch(text(legacy), /บิลนี้ส่งสาขาอื่น\?|ยอดในบิลไม่ลงตัว/);
  const blind = await open(doc({ blind: true, counted_complete_at: null, ocr: { warnings: ['SHIP_TO_MISMATCH', 'BILL_TOTAL_MISMATCH'] }, lines: [row(1, { counted_quantity: null })] }));
  assert.doesNotMatch(text(blind), /บิลนี้ส่งสาขาอื่น\?|ยอดในบิลไม่ลงตัว/);
});

test('#8 ProductPicker uses receiving endpoint results for name/code/barcode/QR and server errors stay visible', async () => {
  const timers = clock(); const queries = []; const chosen = [];
  const h = track(await harness('ProductPicker', { id: 'p8', line: {}, branchId: 1, departmentId: 10, onChange: p => chosen.push(p) }, {
    products: async params => { queries.push(params); if (params.q === 'fail') throw new Error('mock'); return [{ id: 77, name: 'นอกใบสั่ง', unit_id: 2, unit_name: 'ถุง' }]; },
    getProducts: () => { throw new Error('general ordering search must not run'); },
  }, {}, {}, timers.runtime));
  for (const q of ['สินค้า', 'P-77', '885123', 'QR-77']) {
    await h.select('ค้นหาสินค้า', q); await timers.tick(350); await h.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(queries.at(-1))), { q, branch_id: 1, department_id: 10 });
    await h.click('นอกใบสั่ง');
    assert.equal(chosen.at(-1).product_id, 77); assert.equal(chosen.at(-1).order_item_id, null);
    assert.equal(chosen.at(-1).unit_text, 'ถุง');
  }
  await h.select('ค้นหาสินค้า', 'fail'); await timers.tick(350); await h.settle();
  assert.match(text(h), /ค้นหาไม่ได้/);
});

test('#8 nested review picker inherits the document scope for an admin receiving another branch', async () => {
  const timers = clock(); let query;
  const h = await open(doc({ branch_id: 77, department_id: 88 }), {
    products: async params => { query = params; return []; },
  }, {}, timers.runtime);
  await h.click('แก้'); await h.select('ค้นหาสินค้า', 'QR-77');
  await timers.tick(350); await h.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(query)), { q: 'QR-77', branch_id: 77, department_id: 88 });
});
