import assert from 'node:assert/strict';

process.env.ADMIN_ACCESS_TOKEN = 'operator-auth-test-token-1234567890';
process.env.ADMIN_SESSION_SECRET = 'operator-auth-test-session-secret';
process.env.ADMIN_OPERATOR_NAMES = '["สา","ปุณ","โม","จ๋า"]';

const {
  checkAdminOperator,
  getAdminOperator,
  operatorPage,
  safeAdminNext,
  setOperatorCookie,
  setSessionCookie
} = await import('../src/auth.js');

const response = () => {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    append(name, value) {
      const key = String(name).toLowerCase();
      const current = headers.get(key);
      headers.set(key, current ? [...(Array.isArray(current) ? current : [current]), value] : [value]);
    }
  };
};

const req = { secure: false, headers: {}, query: {} };
const sessionRes = response();
setSessionCookie(req, sessionRes);
const sessionCookie = String(sessionRes.headers.get('set-cookie')).split(';')[0];

const operatorRes = response();
assert.equal(setOperatorCookie(req, operatorRes, 'ปุณ'), true);
const operatorCookie = String(operatorRes.headers.get('set-cookie')[0]).split(';')[0];
assert.equal(getAdminOperator({ headers: { cookie: `${sessionCookie}; ${operatorCookie}` } }), 'ปุณ');
assert.equal(checkAdminOperator('ไม่มีชื่อ'), false);
assert.match(operatorPage('/admin?view=board&month=2026-08'), />จ๋า</);
assert.equal(safeAdminNext('https://example.com'), '/admin');
assert.equal(safeAdminNext('/m2/review/item/1'), '/m2/review/item/1');

console.log('operator auth checks passed');
