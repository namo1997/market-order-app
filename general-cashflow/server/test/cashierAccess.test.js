import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASHIER_STAFF,
  cashierUsernames,
  isConfiguredCashier,
  isValidCashierPin
} from '../src/domain/cashierAccess.js';

test('cashier login exposes only the four configured staff accounts', () => {
  assert.deepEqual(CASHIER_STAFF.map(({ fullName }) => fullName), ['นะโม', 'ปุณ', 'สา', 'จ๋า']);
  assert.deepEqual(cashierUsernames(), ['cashier_namo', 'cashier_pun', 'cashier_sa', 'cashier_ja']);
  assert.equal(isConfiguredCashier('cashier_namo'), true);
  assert.equal(isConfiguredCashier('cashier'), false);
});

test('cashier PIN requires a numeric code of a safe length', () => {
  assert.equal(isValidCashierPin('197019'), true);
  assert.equal(isValidCashierPin('19701'), false);
  assert.equal(isValidCashierPin('197019x'), false);
  assert.equal(isValidCashierPin(''), false);
});
