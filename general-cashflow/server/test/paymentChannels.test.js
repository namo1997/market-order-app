import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branchSupportsPaymentChannel,
  isCashPaymentDescription
} from '../src/domain/paymentChannels.js';

test('Kanklong offers SCB and KTC credit cards but not Kasikorn credit card', () => {
  assert.equal(branchSupportsPaymentChannel('KK', 'CREDIT_CARD_SCB'), true);
  assert.equal(branchSupportsPaymentChannel('KK', 'CREDIT_CARD_KTC'), true);
  assert.equal(branchSupportsPaymentChannel('KK', 'CREDIT_CARD_KBANK'), false);
  assert.equal(branchSupportsPaymentChannel('KK', 'PROMPTPAY'), true);
  assert.equal(branchSupportsPaymentChannel('KK', 'QR_KRUNGSRI'), true);
});

test('San Kamphaeng offers Kasikorn channels but not Krungsri QR', () => {
  assert.equal(branchSupportsPaymentChannel('SK', 'CREDIT_CARD_SCB'), false);
  assert.equal(branchSupportsPaymentChannel('SK', 'CREDIT_CARD_KTC'), false);
  assert.equal(branchSupportsPaymentChannel('SK', 'CREDIT_CARD_KBANK'), true);
  assert.equal(branchSupportsPaymentChannel('SK', 'QR_KPLUS'), true);
  assert.equal(branchSupportsPaymentChannel('SK', 'PROMPTPAY'), false);
  assert.equal(branchSupportsPaymentChannel('SK', 'QR_KRUNGSRI'), false);
});

test('cash descriptions from ClickHouse payment rows are recognized', () => {
  assert.equal(isCashPaymentDescription('เงินสด'), true);
  assert.equal(isCashPaymentDescription(' เงิน สด '), true);
  assert.equal(isCashPaymentDescription('CASH'), true);
  assert.equal(isCashPaymentDescription('เคพลัสช็อป'), false);
  assert.equal(isCashPaymentDescription(null), false);
});
