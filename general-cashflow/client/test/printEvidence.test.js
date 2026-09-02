import assert from 'node:assert/strict';
import test from 'node:test';
import { addToPrintBudget, createPrintBudget, selectReceiptEvidenceEntries } from '../src/printEvidence.js';

test('detail printing orders bank evidence before the four cashier document groups', () => {
  const receipt = {
    lines: [
      { channel_code: 'QR_KPLUS', evidence_attachment_id: 17 },
      { channel_code: 'CREDIT_CARD_SCB', evidence_attachment_id: 18 }
    ],
    attachments: [
      { id: 17, attachment_type: 'statement', uploaded_by_role: null },
      { id: 18, attachment_type: 'statement', uploaded_by_role: null },
      { id: 21, attachment_type: 'cash_slip', uploaded_by_role: 'cashier' },
      { id: 22, attachment_type: 'statement', uploaded_by_role: 'cashier' }
    ]
  };

  const entries = selectReceiptEvidenceEntries(receipt);
  assert.deepEqual(entries.slice(0, 5).map((entry) => entry.label), [
    'บัตรเครดิต SCB',
    'บัตรเครดิต KTC',
    'QR กสิกร',
    'GRAB food',
    'QR กรุงศรี'
  ]);
  assert.equal(entries[0].attachment.id, 18);
  assert.equal(entries[0].line.channel_code, 'CREDIT_CARD_SCB');
  assert.equal(entries[0].channelCode, 'CREDIT_CARD_SCB');
  assert.equal(entries[2].attachment.id, 17);
  assert.deepEqual(entries.slice(5).map((entry) => entry.label), [
    'สรุปยอดเงิน',
    'รูปสรุปรวมหน้าร้าน',
    'สรุปบัตรเครดิต',
    'บิลจ่ายอื่นๆ'
  ]);
  assert.equal(entries[5].attachment.id, 21);
  assert.equal(entries[7].attachment.id, 22);
  assert.equal(entries[6].status, 'missing');
});

test('zero-value channel without evidence is shown as no activity', () => {
  const entries = selectReceiptEvidenceEntries({
    lines: [{ channel_code: 'CREDIT_CARD_KTC', cashier_amount: 0, statement_amount: 0 }],
    attachments: []
  });
  assert.equal(entries.find((entry) => entry.channelCode === 'CREDIT_CARD_KTC').status, 'no_activity');
});

test('print budget blocks oversized files, packets, and raster work', () => {
  assert.throws(() => addToPrintBudget(createPrintBudget(), { pages: 31, fileName: 'statement.pdf' }), /30/);
  const packet = createPrintBudget();
  addToPrintBudget(packet, { pages: 30 });
  addToPrintBudget(packet, { pages: 30 });
  assert.throws(() => addToPrintBudget(packet, { pages: 1 }), /60/);
  assert.throws(() => addToPrintBudget(createPrintBudget(), { pages: 1, rasterPixels: 80_000_001 }), /80 ล้าน/);
});
