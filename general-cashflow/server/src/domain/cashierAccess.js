export const CASHIER_STAFF = Object.freeze([
  Object.freeze({ username: 'cashier_namo', fullName: 'นะโม' }),
  Object.freeze({ username: 'cashier_pun', fullName: 'ปุณ' }),
  Object.freeze({ username: 'cashier_sa', fullName: 'สา' }),
  Object.freeze({ username: 'cashier_ja', fullName: 'จ๋า' })
]);

export const cashierUsernames = () => CASHIER_STAFF.map(({ username }) => username);

export const cashierDefinition = (username) => CASHIER_STAFF.find(
  (cashier) => cashier.username === String(username || '').trim()
);

export const isConfiguredCashier = (username) =>
  CASHIER_STAFF.some((cashier) => cashier.username === String(username || '').trim());

export const isValidAccessPin = (pin) => /^\d{6}$/.test(String(pin || '').trim());

// Kept for bootstrap compatibility with existing cashier rows. Cashier sign-in no longer asks for it.
export const isValidCashierPin = isValidAccessPin;

export const ADMIN_OPERATORS = Object.freeze([
  Object.freeze({ username: 'admin_sa', fullName: 'สา' }),
  Object.freeze({ username: 'admin_mo', fullName: 'โม' }),
  Object.freeze({ username: 'admin_ja', fullName: 'จ๋า' }),
  Object.freeze({ username: 'admin_pen', fullName: 'เพ็ญ' }),
  Object.freeze({ username: 'admin_jum', fullName: 'จุ๋ม' })
]);

export const adminOperator = (username) => ADMIN_OPERATORS.find((operator) => operator.username === username);
