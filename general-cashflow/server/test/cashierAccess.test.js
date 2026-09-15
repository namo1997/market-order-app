import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASHIER_STAFF,
  cashierDefinition,
  cashierUsernames,
  isConfiguredCashier,
  isValidAccessPin
} from '../src/domain/cashierAccess.js';

test('cashier login exposes only the four configured staff accounts', () => {
  assert.deepEqual(CASHIER_STAFF.map(({ fullName }) => fullName), ['นะโม', 'ปุณ', 'สา', 'จ๋า']);
  assert.deepEqual(cashierUsernames(), ['cashier_namo', 'cashier_pun', 'cashier_sa', 'cashier_ja']);
  assert.equal(isConfiguredCashier('cashier_namo'), true);
  assert.equal(isConfiguredCashier('cashier'), false);
  assert.equal(cashierDefinition('cashier_namo')?.fullName, 'นะโม');
  assert.equal(cashierDefinition('unknown'), undefined);
});

test('admin access PIN requires exactly six numeric digits', () => {
  assert.equal(isValidAccessPin('197019'), true);
  assert.equal(isValidAccessPin('19701'), false);
  assert.equal(isValidAccessPin('197019x'), false);
  assert.equal(isValidAccessPin(''), false);
});
