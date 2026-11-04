// Run on a verified SSD snapshot. Install Playwright in an isolated harness and
// set PLAYWRIGHT_MODULE_PATH to its index.mjs; no production API/DB is contacted.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.SOLAO_LOCAL_SIMULATION || !process.cwd().startsWith('/Volumes/SSD Files/SOLAO/')) {
  throw new Error('Run frontend regression tests on a verified SSD snapshot');
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
let server, browser, base;
const user = { id: 7, role: 'user', branch_id: 1, department_id: 11, name: 'Test department' };
const item = { product_id: 1, product_name: 'Test rice', quantity: 3, requested_price: 20 };
const state = (page) => page.locator('#audit-state').textContent().then(JSON.parse);
const waitReady = (page) => page.waitForFunction(() => window.__audit && !window.__audit.auth.loading);
const json = (route, data) => route.fulfill({ json: { success: true, data } });

before(async () => {
  process.env.VITE_API_URL = '/api';
  // Tailwind resolves its config/content from cwd, as in npm --prefix client run dev.
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function setup({ saved = {}, handle, viewport = { width: 390, height: 844 } } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser exception:', error.message); });
  await page.addInitScript(({ saved, user }) => {
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('user', JSON.stringify(user));
    for (const [key, value] of Object.entries(saved)) sessionStorage.setItem(key, value);
  }, { saved, user });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    if (handle && await handle(route, url)) return;
    if (url.pathname === '/api/auth/me') return json(route, user);
    if (url.pathname === '/api/auth/login') {
      const dept = route.request().postDataJSON().departmentId;
      return json(route, { token: `test-token-${dept}`, user: { ...user, id: dept, role: dept === 99 ? 'admin' : 'user', department_id: dept } });
    }
    if (url.pathname === '/api/orders/status') return json(route, { is_open: true });
    if (url.pathname === '/api/products') return json(route, [{ id: 1, name: 'Test rice', default_price: 20 }]);
    return json(route, []);
  });
  return { page, errors };
}

test('StrictMode restores and migrates the saved cart/date without overwriting them', async () => {
  const { page, errors } = await setup({ saved: { cart: JSON.stringify([item]), orderDate: '2026-11-06' } });
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    await page.waitForFunction(() => window.__audit.cart.itemCount === 1);
    assert.deepEqual((await state(page)).items, [item]);
    assert.equal((await state(page)).date, '2026-11-06');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cart')), null);
    assert.deepEqual(JSON.parse(await page.evaluate(() => sessionStorage.getItem('cart:7:1:11'))), [item]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('switching accounts isolates cart drafts and restores the right department', async () => {
  const { page } = await setup({ saved: { 'cart:7:1:11': JSON.stringify([item]), 'cart:8:1:8': '[]' } });
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    assert.equal((await state(page)).items.length, 1);
    await page.evaluate(() => window.__audit.auth.login(8));
    await page.waitForFunction(() => window.__audit.auth.user?.id === 8 && window.__audit.cart.itemCount === 0);
    assert.equal((await state(page)).items.length, 0);
    assert.deepEqual(JSON.parse(await page.evaluate(() => sessionStorage.getItem('cart:7:1:11'))), [item]);
  } finally { await page.close(); }
});

test('late session refresh cannot log the user back in after logout', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { page } = await setup({ handle: async (route, url) => {
    if (url.pathname !== '/api/auth/me') return false;
    await pending; await json(route, user); return true;
  } });
  try {
    await page.goto(`${base}/tests/harness.html`);
    await page.waitForFunction(() => Boolean(window.__audit));
    await page.evaluate(() => window.__audit.auth.logout());
    release(); await waitReady(page);
    await page.waitForTimeout(150);
    assert.equal((await state(page)).user, null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('user')), null);
  } finally { release(); await page.close(); }
});

test('numeric inputs forward min/max to native browser validation', async () => {
  const { page } = await setup();
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    const field = page.getByTestId('bounded-number');
    assert.equal(await field.evaluate((node) => node.validity.rangeUnderflow), true);
    await field.fill('11');
    assert.equal(await field.evaluate((node) => node.validity.rangeOverflow), true);
    await field.fill('5');
    assert.equal(await field.evaluate((node) => node.checkValidity()), true);
  } finally { await page.close(); }
});

test('empty department product list is fetched once; date changes do not refetch products', async () => {
  let departmentCalls = 0, productCalls = 0;
  const { page, errors } = await setup({ handle: async (route, url) => {
    if (url.pathname.includes('department-products')) { departmentCalls++; await json(route, []); return true; }
    if (url.pathname === '/api/products') productCalls++;
    return false;
  } });
  try {
    await page.goto(`${base}/tests/harness.html?mode=products`); await waitReady(page);
    await page.getByText('Test rice', { exact: true }).waitFor();
    const beforeDateChange = productCalls;
    await page.evaluate(() => window.__audit.cart.setOrderDate('2026-11-07'));
    await page.waitForTimeout(150);
    assert.equal(productCalls, beforeDateChange);
    await page.getByRole('checkbox', { name: /เฉพาะแผนก/ }).check();
    await page.getByText('ยังไม่มีรายการสินค้าสำหรับแผนกนี้', { exact: true }).waitFor();
    await page.waitForTimeout(250);
    assert.equal(departmentCalls, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('receiving page handles permission changes without changing hook order', async () => {
  const { page, errors } = await setup();
  try {
    await page.goto(`${base}/tests/harness.html?mode=receive`); await waitReady(page);
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__audit.auth.login(99));
    await page.waitForURL('**/admin/orders');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('cancelled GET does not spend retry backoff time', async () => {
  const { page } = await setup();
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    const result = await page.evaluate(async () => {
      const { default: client } = await import('/src/api/client.js');
      const controller = new AbortController(); controller.abort();
      const start = performance.now();
      try { await client.get('/cancel-check', { signal: controller.signal }); }
      catch (error) { return { elapsed: performance.now() - start, code: error.code }; }
    });
    assert.equal(result.code, 'ERR_CANCELED');
    assert.ok(result.elapsed < 500, `cancelled GET took ${result.elapsed}ms`);
  } finally { await page.close(); }
});


test('old 401 response cannot erase a newer successful login', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { page } = await setup({ handle: async (route, url) => {
    if (url.pathname !== '/api/auth/me') return false;
    await pending; await route.fulfill({ status: 401, json: { success: false } }); return true;
  } });
  try {
    await page.goto(`${base}/tests/harness.html`);
    await page.waitForFunction(() => Boolean(window.__audit));
    await page.evaluate(() => window.__audit.auth.login(8));
    await page.waitForFunction(() => window.__audit.auth.user?.id === 8);
    release();
    await page.waitForTimeout(200);
    assert.equal((await state(page)).user.id, 8);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('token')), 'test-token-8');
  } finally { release(); await page.close(); }
});


test('PR/PO readonly PIN session cannot operate issue/receive controls', async () => {
  const { page } = await setup({ saved: {
    general_purchase_token: 'readonly-test-token',
    general_purchase_access: JSON.stringify({ token: 'readonly-test-token', readonly: true, user: { mode: 'readonly' } })
  } });
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    await page.waitForFunction(() => !window.__audit.general.authLoading);
    assert.equal((await state(page)).canOperate, false);
  } finally { await page.close(); }
});


test('clearing a cart and logging out in one event clears the stored draft', async () => {
  const { page } = await setup({ saved: { 'cart:7:1:11': JSON.stringify([item]) } });
  try {
    await page.goto(`${base}/tests/harness.html`); await waitReady(page);
    await page.evaluate(() => { window.__audit.cart.clearCart(); window.__audit.auth.logout(); });
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cart:7:1:11')), null);
  } finally { await page.close(); }
});


test('Google session survives a late unauthorized refresh of the previous session', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { page } = await setup({ handle: async (route, url) => {
    if (url.pathname !== '/api/auth/me') return false;
    await pending;
    await route.fulfill({ status: 401, json: { success: false } });
    return true;
  } });
  try {
    await page.goto(`${base}/tests/harness.html`);
    await page.waitForFunction(() => Boolean(window.__audit));
    await page.evaluate(() => window.__audit.auth.acceptGoogleSession({ token: 'google-session', user: { id: 15, role: 'user', branch_id: 1, department_id: 15 } }));
    release();
    await waitReady(page);
    await page.waitForTimeout(150);
    assert.equal((await state(page)).user.id, 15);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('token')), 'google-session');
  } finally { release(); await page.close(); }
});

test('LINE code login still establishes the owner session after the session-race port', async () => {
  const { page, errors } = await setup({ handle: async (route, url) => {
    if (url.pathname !== '/api/auth/line/super-admin/exchange') return false;
    assert.equal(route.request().postDataJSON().code, 'fixture-line-code');
    await json(route, { token: 'line-session', user: { id: 21, role: 'super_admin', branch_id: 1, department_id: 1 } });
    return true;
  } });
  try {
    await page.goto(`${base}/tests/harness.html`);
    await waitReady(page);
    const result = await page.evaluate(() => window.__audit.auth.loginSuperAdminWithLineCode('fixture-line-code'));
    assert.equal(result.success, true);
    await page.waitForFunction(() => window.__audit.auth.user?.id === 21);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('token')), 'line-session');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const [width, height] of [[360, 800], [390, 844], [412, 915]]) {
  test(`product ordering stays usable at mobile viewport ${width}x${height}`, async () => {
    const { page, errors } = await setup({ viewport: { width, height } });
    try {
      await page.goto(`${base}/tests/harness.html?mode=products`);
      await waitReady(page);
      await page.getByText('Test rice', { exact: true }).waitFor();
      assert.equal(await page.locator('.grid').first().evaluate((node) => getComputedStyle(node).display), 'grid', 'production Tailwind styles are loaded');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}
