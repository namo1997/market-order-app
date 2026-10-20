import test from 'node:test';
import assert from 'node:assert/strict';
import { receivingStockSource } from '../src/components/inventory/receiving-stock-source.mjs';
test('stock receipt sources preserve legacy order-item references and link latest receipt document', () => {
  assert.deepEqual(receivingStockSource({ reference_type: 'order_receiving', reference_id: '50', notes: 'รับสินค้าตามเอกสาร #1\nรับสินค้าตามเอกสาร #2' }), { id: 2, label: 'รับสินค้าตามเอกสาร #2', href: '/receiving?document_id=2' });
  assert.equal(receivingStockSource({ latest_receiving_notes: 'รับสินค้าตามเอกสาร #9' }).id, 9);
  assert.equal(receivingStockSource({ reference_type: 'receiving_document_void', reference_id: '2' }).label, 'ยกเลิกเอกสารรับสินค้า #2');
  assert.equal(receivingStockSource({ reference_type: 'receiving_document_return', reference_id: '3' }).label, 'คืนสินค้าตามเอกสาร #3');
  for (const reference_id of ['0','-1','javascript:alert(1)','2/../../9','99999999999999999999']) assert.equal(receivingStockSource({ reference_type: 'receiving_document', reference_id }), null);
  assert.equal(receivingStockSource({ notes: 'รับอัตโนมัติวันถัดไป' }), null);
});

test('stock link uses a 48px target and deep link loads the referenced receipt through the existing API', async () => {
  const { harness } = await import('./receiving-harness.mjs');
  const link = await harness('ReceivingStockSource', { item: { notes: 'รับสินค้าตามเอกสาร #9' } }, {}, {}, {}, {}, null, '../src/components/inventory/ReceivingStockSource.jsx');
  assert.equal(link.find(n => n.type === 'a').props.href, '/receiving?document_id=9');
  assert.match(link.find(n => n.type === 'a').props.className, /min-h-\[48px\]/);
  link.unmount();
  const calls = [];
  const page = await harness('Receiving', {}, { get: async id => { calls.push(id); throw { response: { status: 403 } }; } }, {}, { location: { search: '?document_id=9' } });
  assert.deepEqual(calls, ['9']);
  page.unmount();
});

test('physical return quantity is reviewed in confirmation and sent only with returned resolution', async () => {
  const { harness } = await import('./receiving-harness.mjs');
  let row = { id: 1, type: 'return', status: 'open', branch_id: 1, document_id: 9, quantity: '1.00', amount: '10.00', version: 1,
    due_at: '2026-10-21T01:00:00Z', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', note: '', evidence: [], history: [], supplier_name: 'SYNTHETIC' };
  const calls = [];
  const api = { detail: async () => row, assignees: async () => ({ items: [] }), update: async (id, body) => { calls.push(body); row = { ...row, ...body, version: 2 }; } };
  const h = await harness('ReceivingIssueDetail', { id: 1, user: { id: 7, role: 'accounting' }, api }, {}, {}, {}, { fetch: () => { throw Error('network forbidden'); } }, null, '../src/receiving-app/ReceivingIssueDetail.jsx');
  await h.select('สถานะ', 'resolved'); await h.select('ทางจบ', 'returned'); await h.select('จำนวนคืนจากสต๊อก', '0.20');
  await h.find(n => n.type === 'form' && n.props.onSubmit).props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.match(h.text(h.visible()), /ลดสต๊อก 0.20 หน่วยฐาน/);
  assert.equal(calls.length, 0, 'no mutation before explicit confirmation');
  await h.click('ยืนยันปิดเรื่อง');
  assert.equal(calls[0].stock_return_quantity, '0.20');
  assert.equal(calls[0].resolution, 'returned');
  h.unmount();
});
