import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyKplusReference } from '../src/kplusEvidence.js';

const body = 'รหัสร้านค้า : KB000001590548 ยอดเงินจำนวน(บาท) : 29,221.90';
const line = () => ({
  channel_code: 'QR_KPLUS', receipt_status: 'SUBMITTED', settlement_source: 'LEGACY_EVIDENCE',
  settlement_status: 'MATCHED_AUTO', manual_checked_without_reference: 0, fee_amount: '0.00',
  expected_amount: '44751.90', expected_gross_amount: '44751.90', expected_net_amount: '44751.90',
  cashier_amount: '29221.90', statement_amount: '29221.90', evidence_file_data: Buffer.from(body)
});
const evidence = () => [{
  inbox_import_id: 1629, bank_transaction_id: 2910, statement_transaction_id: 4498,
  reference_no: 'KB000001590548', amount: '29221.90', raw_payload: { body }
}];

test('legacy K SHOP reference is repaired from the email, not the stored POS split', () => {
  const input = line();
  const result = resolveLegacyKplusReference(input, evidence());
  assert.equal(result.expected_gross_amount, 29221.90);
  assert.equal(result.expected_net_amount, 29221.90);
  assert.equal(result.settlement_source, 'BANK_SETTLEMENT');
  assert.equal(result.cashier_reference_variance_amount, 0);
  assert.equal(result.settlement_variance_amount, 0);
  assert.equal(result.settlement_status, 'MATCHED_AUTO');
  assert.equal(input.expected_amount, '44751.90');
  assert.equal(input.cashier_amount, '29221.90');
  assert.equal(input.statement_amount, '29221.90');
  assert.equal(resolveLegacyKplusReference({ ...input, ...result }, evidence()), null);
});

test('a real cashier or actual-money discrepancy stays visible after reference repair', () => {
  const result = resolveLegacyKplusReference({ ...line(), cashier_amount: '30000', statement_amount: '29000' }, evidence());
  assert.equal(result.expected_net_amount, 29221.90);
  assert.equal(result.cashier_reference_variance_amount, 778.10);
  assert.equal(result.settlement_variance_amount, -221.90);
  assert.equal(result.settlement_status, 'EXCEPTION');
});

test('legacy K SHOP repair skips closed, checked, manual, fee-bearing and other-channel records', () => {
  for (const change of [
    { receipt_status: 'CLOSED' }, { receipt_status: 'CHECKED_OK' }, { receipt_status: 'CHECKED_VARIANCE' },
    { channel_code: 'QR_KRUNGSRI' }, { settlement_source: 'MANUAL' },
    { manual_checked_without_reference: 1 }, { settlement_status: 'MATCHED_MANUAL' },
    { fee_amount: '1.00' }, { expected_gross_amount: '40000' }, { expected_net_amount: '40000' }
  ]) assert.equal(resolveLegacyKplusReference({ ...line(), ...change }, evidence()), null);
});

test('legacy K SHOP repair requires one consistent email and the same attached proof', () => {
  assert.equal(resolveLegacyKplusReference(line(), []), null);
  assert.equal(resolveLegacyKplusReference(line(), [...evidence(), ...evidence()]), null);
  assert.equal(resolveLegacyKplusReference(line(), [{ ...evidence()[0], amount: '30000' }]), null);
  assert.equal(resolveLegacyKplusReference(line(), [{ ...evidence()[0], reference_no: 'KBOTHER' }]), null);
  assert.equal(resolveLegacyKplusReference({ ...line(), evidence_file_data: Buffer.from(body.replace('29,221.90', '44,751.90')) }, evidence()), null);
});

test('legacy K SHOP repair refuses unreadable proof rather than guessing an amount', () => {
  assert.throws(() => resolveLegacyKplusReference({ ...line(), evidence_file_data: Buffer.from('unreadable') }, evidence()));
});
