import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { classifyRowsForChannel } from '../src/domain/reconciliation.js';

const qrChannel = {
  kind: 'qr',
  mappings: ['Thai QR Payment', 'K SHOP', 'MYQR']
};

test('QR statement preview keeps Thai QR rows separate from unrelated transfers', () => {
  const rows = [
    { uniqueHash: 'qr', transactionDate: '2026-07-02', description: 'รับเงินจากการขายด้วย Thai QR Payment | EDC/K SHOP/MYQR', amount: 48844.8 },
    { uniqueHash: 'transfer-a', transactionDate: '2026-07-02', description: 'รับโอนเงิน | โมบาย แอปพลิเคชัน', amount: 7373.93 },
    { uniqueHash: 'transfer-b', transactionDate: '2026-07-02', description: 'รับโอนเงิน | โมบาย แอปพลิเคชัน', amount: 6119.13 }
  ];
  const result = classifyRowsForChannel({ rows, channel: qrChannel, receiptDate: '2026-07-02', expectedNetAmount: 52672.8 });

  assert.equal(result.directChannel, true);
  assert.deepEqual(result.defaultHashes, ['qr']);
  assert.equal(result.rows.filter((row) => row.classification === 'classified').length, 1);
  assert.equal(result.rows.filter((row) => row.classification === 'unrelated').length, 2);
});

test('QR กสิกร includes every Thai QR Payment row on the same day', () => {
  const rows = [
    { uniqueHash: 'qr-a', transactionDate: '2026-07-15', description: 'รับเงินจากการขายด้วย Thai QR Payment | EDC/K SHOP/MYQR', amount: 24632.7 },
    { uniqueHash: 'qr-b', transactionDate: '2026-07-15', description: 'รับเงินจากการขายด้วย Thai QR Payment | EDC/K SHOP/MYQR', amount: 30 },
    { uniqueHash: 'grab', transactionDate: '2026-07-15', description: 'รับโอนเงิน | บจก. แกร็บแท็กซี่', amount: 6480.5 }
  ];
  const result = classifyRowsForChannel({ rows, channel: qrChannel, receiptDate: '2026-07-15', expectedNetAmount: 24662.7 });

  assert.deepEqual(result.defaultHashes, ['qr-a', 'qr-b']);
  assert.equal(result.rows.filter((row) => row.classification === 'classified').length, 2);
  assert.equal(result.rows.filter((row) => row.classification === 'classified').reduce((sum, row) => sum + row.amount, 0), 24662.7);
});

test('Grab settlement preview auto-selects an exact net deposit and limits near candidates to three', () => {
  const rows = [
    { uniqueHash: 'exact', transactionDate: '2026-07-03', description: 'GRAB payout', amount: 9000 },
    { uniqueHash: 'near-a', transactionDate: '2026-07-03', description: 'GRAB payout', amount: 8999 },
    { uniqueHash: 'near-b', transactionDate: '2026-07-04', description: 'GRAB payout', amount: 9010 },
    { uniqueHash: 'near-c', transactionDate: '2026-07-05', description: 'GRAB payout', amount: 9020 },
    { uniqueHash: 'far', transactionDate: '2026-07-05', description: 'GRAB payout', amount: 9500 },
    { uniqueHash: 'outside-window', transactionDate: '2026-07-06', description: 'GRAB payout', amount: 9000 }
  ];
  const result = classifyRowsForChannel({
    rows,
    channel: { kind: 'grab', mappings: ['GRAB'] },
    receiptDate: '2026-07-02',
    expectedNetAmount: 9000
  });

  assert.equal(result.directChannel, false);
  assert.equal(result.autoMatched, true);
  assert.deepEqual(result.defaultHashes, ['exact']);
  assert.equal(result.rows.filter((row) => row.candidate).length, 3);
  assert.equal(result.rows.find((row) => row.uniqueHash === 'outside-window').candidate, false);
});

test('Grab statement matching ignores an unrelated exact transfer when X3812 Grab transfer is present', () => {
  const rows = [
    { uniqueHash: 'unrelated', transactionDate: '2026-07-02', description: 'รับโอนเงินจากลูกค้า', amount: 6119.13 },
    { uniqueHash: 'grab-x3812', transactionDate: '2026-07-02', description: 'รับโอนเงิน จาก X3812 บจก. แกร็บแท็กซี่ ++ | GRAB', amount: 6119.13 }
  ];
  const result = classifyRowsForChannel({
    rows,
    channel: { kind: 'grab', mappings: ['X3812', 'บจก. แกร็บแท็กซี่'] },
    receiptDate: '2026-07-01',
    expectedNetAmount: 6119.13
  });

  assert.deepEqual(result.defaultHashes, ['grab-x3812']);
  assert.equal(result.autoMatched, true);
  assert.equal(result.rows.find((row) => row.uniqueHash === 'unrelated').candidate, false);
});

test('SCB credit card selects the only EDC deposit and ignores other incoming money', () => {
  const rows = [
    { uniqueHash: 'edc', transactionDate: '2026-07-02', description: 'CREDIT CARD DIVISION(EDC) | ATS', amount: 3653.72 },
    { uniqueHash: 'customer-transfer', transactionDate: '2026-07-02', description: 'รับโอนจากลูกค้า | ENET', amount: 9000 }
  ];
  const result = classifyRowsForChannel({
    rows,
    channel: { code: 'CREDIT_CARD_SCB', kind: 'credit_card', mappings: ['CREDIT CARD DIVISION(EDC)'] },
    receiptDate: '2026-07-01',
    expectedNetAmount: 3700
  });

  assert.deepEqual(result.defaultHashes, ['edc']);
  assert.equal(result.autoMatched, true);
  assert.equal(result.rows.find((row) => row.uniqueHash === 'customer-transfer').candidate, false);
});

test('SCB other incoming money is classified as promptpay separately from EDC', () => {
  const rows = [
    { uniqueHash: 'edc', transactionDate: '2026-07-01', description: 'CREDIT CARD DIVISION(EDC) | ATS', amount: 6225.35 },
    { uniqueHash: 'customer-transfer', transactionDate: '2026-07-01', description: 'รับโอนจากลูกค้า | ENET', amount: 9000 }
  ];
  const result = classifyRowsForChannel({
    rows,
    channel: { code: 'PROMPTPAY', kind: 'promptpay', mappings: [] },
    receiptDate: '2026-07-01',
    expectedNetAmount: 9000,
    classifyScbOtherIncoming: true
  });

  assert.deepEqual(result.defaultHashes, ['customer-transfer']);
  assert.equal(result.rows.find((row) => row.uniqueHash === 'edc').classification, 'unrelated');
});

test('KTC settlement training fixture reconciles gross sales after MDR and VAT fees', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/statement-training/ktc-settlement-evidence.json', import.meta.url), 'utf8'));
  assert.equal(fixture.provider, 'KTC');
  assert.equal(fixture.total_fee, fixture.mdr_fee + fixture.vat_on_mdr);
  assert.equal(fixture.net_payout, fixture.gross_sales - fixture.total_fee);
});
