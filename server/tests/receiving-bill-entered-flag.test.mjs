import test from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from '../src/models/receiving-documents-helpers.js';

// Bug hunt 2026-10-24 (real NewStar bill on the pilot): picking the product for a read bill line marked the line
// as edited, so the card said "จำนวนบิลกรอกหรือแก้โดยคน" although nobody touched the bill quantity.
const row = {
  id: 1, client_uuid: 'u', status: 'draft', kind: 'bill', branch_id: 1, department_id: 1, receiving_scope: 'department',
  supplier_name_text: 'นิวสตาร์', delivery_date: '2026-10-24', ocr_status: 'done', receiver_user_id: 1, receiver_name: 'ผู้รับ',
  created_at: new Date('2026-10-24T04:00:00Z'), updated_at: new Date('2026-10-24T04:00:00Z'), counted_complete_at: new Date('2026-10-24T04:10:00Z'), warnings_json: '[]',
  ocr_result_json: JSON.stringify({ line_reads: [{ line_no: 1, bill_text: 'เสือร้องไห้ออสกรีนแฮม', bill_read: { quantity_billed: 21, unit_price: 265, amount: 5565 } }] })
};
const line = patch => ({ id: 7, document_id: 1, line_no: 1, bill_text: 'เสือร้องไห้ออสกรีนแฮม', product_id: 34, product_name: 'เสือร้องไห้',
  unit_text: 'กิโลกรัม', quantity_billed: '21.00', quantity_received: '20.00', unit_price: '265.000000', amount: '5565.00',
  counted_quantity: '20.00', match_source: 'manual', is_user_edited: 1, ...patch });

test('a read bill line matched by a person keeps the read quantity as the bill’s, not a typed one', () => {
  const doc = helpers.mapReceivingDocumentRow(row, { lines: [line()] });
  assert.equal(doc.lines[0].bill_entered_manually, false);
  assert.equal(doc.lines[0].bill_read.quantity_billed, 21);
});

test('a bill quantity changed from the read value, or typed with no read, is still marked as typed', () => {
  assert.equal(helpers.mapReceivingDocumentRow(row, { lines: [line({ quantity_billed: '20.00' })] }).lines[0].bill_entered_manually, true);
  assert.equal(helpers.mapReceivingDocumentRow({ ...row, ocr_status: 'none', ocr_result_json: null }, { lines: [line()] }).lines[0].bill_entered_manually, true);
  assert.equal(helpers.mapReceivingDocumentRow(row, { lines: [line({ is_user_edited: 0 })] }).lines[0].bill_entered_manually, false);
});
