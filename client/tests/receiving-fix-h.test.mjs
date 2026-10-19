import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './receiving-harness.mjs';

const user = { id: 12, role: 'user', branch_id: 1, department_id: 10, name: 'ผู้รับ' };
const parts = (a = '6', b = '4') => [
  { order_item_id: 50, department_id: 10, department_name: 'ครัว', quantity_ordered: '6', quantity_received: a },
  { order_item_id: 60, department_id: 30, department_name: 'สโตร์', quantity_ordered: '4', quantity_received: b },
];
const row = (patch = {}) => ({ id: 1, line_no: 1, product_id: 7, product_name: 'ขา B', bill_text: 'ขา B', order_item_id: 50,
  counted_quantity: '10', quantity_received: '10', quantity_billed: '10', quantity_ordered: '10',
  unit_id: 2, unit_text: 'กก.', unit_price: '20', amount: '200', match: { source: 'order', confidence: 1 },
  review_decision: null, departments: parts(), ...patch });
const doc = (patch = {}) => ({ id: 1, scope: 'branch', status: 'draft', kind: 'bill', branch_id: 1, department_id: 10,
  counted_complete_at: '2026-10-18T00:00:00Z', supplier_name_text: 'ร้านทดสอบ', images: [], warnings: [],
  ocr: { status: 'done' }, has_receiver_signature: true, lines: [row()], ...patch });
const allocation = h => h.find(n => n.type === 'summary' && h.text(n).startsWith('แยกแผนก'));

test('H1 missing-bill cards show missing-bill guidance without phantom unreadable text, retain genuine row and whole-bill warnings', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc({ lines: [row({ quantity_billed: null, bill_text: '', unit_price: null, amount: null }),
    row({ id: 2, line_no: 2, product_name: 'ปีกกลาง', match: { source: 'ai', confidence: 0.3 } })],
    warnings: [{ code: 'LOW_CONFIDENCE', line_no: 2 }, { code: 'LOW_CONFIDENCE', line_no: null }] }), user });
  const missing = h.find(n => n.props.id === 'review-row-1');
  assert.match(h.text(missing), /ไม่มีในบิล.*ให้บัญชีขอบิลจากร้าน/);
  assert.doesNotMatch(h.text(missing), /อ่านบิลได้ไม่ชัด/);
  assert.match(h.text(h.find(n => n.props.id === 'review-row-2')), /อ่านบิลได้ไม่ชัด/);
  assert.match(h.text(h.find(n => n.props['aria-label'] === 'ข้อสังเกตบิล')), /อ่านบิลได้ไม่ชัด/);
});

test('H3 collapsed branch card exposes saved allocation numbers and retains ordered-quantity details', async () => {
  const h = await harness('BranchDocumentEditor', { initialDocument: doc(), user });
  assert.equal(h.text(allocation(h)), 'แยกแผนก · ครัว 6 กก. · สโตร์ 4 กก.');
  const details = h.find(n => n.type === 'details' && n.props.className === 'ra-allocation');
  assert.match(h.text(details), /ครัว · สั่ง 6 · รับ 6 กก\./);
  assert.match(h.text(details), /สโตร์ · สั่ง 4 · รับ 4 กก\./);
});

for (const [quantity, a, b] of [['5', '3', '2'], ['0.01', '0.01', '0'], ['0', '0', '0']]) {
  test(`H2/H3 edited branch ${quantity}: no stale split before save, refreshed numbers in card, pre-sign and compact signing summary`, async () => {
    let current = doc();
    const h = await harness('BranchDocumentEditor', { initialDocument: current, user }, {
      update: async (id, body) => {
        current = { ...current, lines: current.lines.map(line => ({ ...line, ...body.lines.find(p => p.id === line.id), departments: parts(a, b) })) };
        return current;
      },
    });
    await h.click('แก้'); await h.select('แก้จำนวนหลังเปิดบิล ขา B', quantity);
    assert.match(h.text(allocation(h)), /บันทึกการตัดสินใจเพื่ออัปเดต/);
    assert.doesNotMatch(h.text(allocation(h)), /ครัว 6/);
    await h.click(`รับ ${quantity} กก. · แจ้งร้านขาด ${quantity === '5' ? '5' : quantity === '0.01' ? '9.99' : '10'} กก.`);
    const breakdown = `ครัว ${a} กก. · สโตร์ ${b} กก.`;
    assert.equal(h.text(allocation(h)), `แยกแผนก · ${breakdown}`);
    await h.click('ดูสรุปก่อนเซ็น');
    const summaryText = `ขา B ${quantity} กก. → ${breakdown}`;
    assert.equal(h.text(h.find(n => n.type === 'p' && n.props.className === 'ra-allocation')), summaryText);
    await h.click('ไปเซ็นรับของ');
    assert.equal(h.text(h.find(n => n.type === 'p' && n.props.className === 'ra-allocation')), summaryText);
  });
}

test('H2 branch summary has no empty allocation labels for absent/empty departments; one department displays quantity', async () => {
  const h = await harness('ReviewSummary', { doc: doc({ lines: [row({ departments: undefined }), row({ id: 2, departments: [] }),
    row({ id: 3, quantity_received: '1', departments: parts('1').slice(0, 1) })] }) });
  const rows = h.visible().filter(n => n.type === 'p' && n.props.className === 'ra-allocation');
  assert.equal(rows.length, 1);
  assert.equal(h.text(rows[0]), 'ขา B 1 กก. → ครัว 1 กก.');
  assert.equal(h.visible().filter(n => n.type === 'summary' && /แยกแผนก/.test(h.text(n))).length, 0);
});

test('H2/H3 allocation groups multiple order rows for one department with exact hundredths, preserves non-proportional server allocations and unknowns', async () => {
  for (const [departments, received, expected] of [
    [[...parts('0.1', '0'), { ...parts()[0], order_item_id: 51, quantity_received: '0.2' }], '0.3', 'ครัว 0.3 กก. · สโตร์ 0 กก.'],
    [parts('0', '4'), '4', 'ครัว 0 กก. · สโตร์ 4 กก.'],
    [parts(null, '4'), '4', 'ครัว — กก. · สโตร์ 4 กก.'],
  ]) {
    const h = await harness('ReviewRows', { doc: doc({ lines: [row({ departments, quantity_received: received })] }) });
    assert.equal(h.text(allocation(h)), `แยกแผนก · ${expected}`);
    h.unmount();
  }
});

test('H2/H3 department scope never shows branch allocation, including old records with department metadata', async () => {
  const h = await harness('DocumentEditor', { initialDocument: doc({ scope: 'department', lines: [row({ review_decision: 'accept' })] }), user });
  assert.equal(h.visible().filter(n => n.props.className === 'ra-allocation').length, 0);
  await h.click('ดูสรุปก่อนเซ็น');
  assert.equal(h.visible().filter(n => n.props.className === 'ra-allocation').length, 0);
});
