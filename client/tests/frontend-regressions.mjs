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

async function setup({ saved = {}, handle, profile = user, init, viewport = { width: 390, height: 844 } } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser exception:', error.message); });
  if (init) await page.addInitScript(init);
  await page.addInitScript(({ saved, user }) => {
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('user', JSON.stringify(user));
    for (const [key, value] of Object.entries(saved)) sessionStorage.setItem(key, value);
  }, { saved, user: profile });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    if (handle && await handle(route, url)) return;
    if (url.pathname === '/api/auth/me') return json(route, profile);
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


const admin = { ...user, role: 'admin' };
const variance = { summary: { total_items: 1, items_with_variance: 1, total_variance_value: 20 }, items: [{ product_id: 1, department_id: 11, product_name: 'Fixture rice', system_quantity: 4, counted_quantity: 3, variance: -1, unit_abbr: 'kg', checked_at: '2026-11-04T01:00:00Z' }] };

async function prepareStock(mode, outcome = 'success') {
  const writes = [];
  const { page, errors } = await setup({ profile: admin, handle: async (route, url) => {
    if (url.pathname === '/api/branches') { await json(route, [{ id: 1, name: 'Fixture branch' }]); return true; }
    if (url.pathname === '/api/auth/departments/1') { await json(route, [{ id: 11, name: 'Fixture department' }]); return true; }
    if (url.pathname === '/api/inventory/dashboard') { await json(route, { stats: {}, low_stock_items: [] }); return true; }
    if (url.pathname === '/api/inventory/variance-report') { await json(route, variance); return true; }
    if (url.pathname === '/api/stock-check/my-check/history') { await json(route, [{ id: 1, product_id: 1, product_name: 'Fixture rice', checked_at: '2026-11-04T01:00:00Z', check_date: '2026-11-04', stock_quantity: 3 }]); return true; }
    if (url.pathname === '/api/inventory/apply-adjustment') {
      writes.push(route.request().postDataJSON());
      if (outcome === 'reject') await route.fulfill({ status: 403, json: { success: false, message: 'Fixture server denied adjustment' } });
      else await json(route, { total_adjustments: 1 });
      return true;
    }
    return false;
  } });
  await page.goto(`${base}/tests/harness.html?mode=${mode}`);
  await waitReady(page);
  if (mode === 'stock-check') {
    await page.getByRole('button', { name: 'ประวัติการเช็คสต็อก', exact: true }).click();
    await page.getByText('Fixture rice', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'เปิดโหมดเลือกปรับปรุงรายตัว', exact: true }).click();
    await page.getByRole('button', { name: 'เลือกทั้งหมด', exact: true }).click();
    return { page, errors, writes, apply: page.getByRole('button', { name: 'ปรับปรุงเฉพาะที่เลือก', exact: true }) };
  }
  if (mode === 'stock-variance') {
    await page.locator('select').nth(0).selectOption('1');
    await page.locator('select').nth(1).selectOption('11');
    return { page, errors, writes, apply: page.getByRole('button', { name: 'ปรับปรุงยอดทั้งหมด', exact: true }) };
  }
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'เลือกสาขา' }) }).selectOption('1');
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'เลือกแผนก' }) }).selectOption('11');
  await page.getByRole('button', { name: 'ตรวจสอบส่วนต่าง', exact: true }).click();
  return { page, errors, writes, apply: page.getByRole('button', { name: /ยืนยันอัปเดตสต็อกตามจริงจำนวน 1 รายการ/ }) };
}

for (const mode of ['stock-check', 'inventory-dashboard', 'stock-variance']) {
  for (const outcome of ['success', 'cancel-pin', 'cancel-confirm', 'reject']) {
    test(`${mode}: nondefault PIN reaches server; ${outcome} preserves confirmation and server result`, async () => {
      const { page, errors, writes, apply } = await prepareStock(mode, outcome);
      const notices = [];
      page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') {
          if (outcome === 'cancel-pin') await dialog.dismiss();
          else await dialog.accept('482951');
        } else if (dialog.type() === 'confirm') {
          if (outcome === 'cancel-confirm') await dialog.dismiss();
          else await dialog.accept();
        } else { notices.push(dialog.message()); await dialog.accept(); }
      });
      try {
        await apply.click();
        if (outcome.startsWith('cancel')) {
          await page.waitForTimeout(100);
          assert.equal(writes.length, 0);
        } else {
          await page.waitForFunction(() => true);
          for (let i = 0; i < 30 && !notices.length; i++) await page.waitForTimeout(25);
          assert.equal(writes.length, 1);
          assert.equal(writes[0].pin, '482951');
          assert.equal(Number(writes[0].department_id), 11);
          assert.ok(notices.some((notice) => outcome === 'reject' ? notice.includes('Fixture server denied adjustment') : /เรียบร้อย|สำเร็จ/.test(notice)));
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }
}

const accessSaved = (readonly = true) => ({ general_purchase_token: 'gp-fixture', general_purchase_access: JSON.stringify({ token: 'gp-fixture', readonly, canCreate: !readonly, canApprove: !readonly, user: { mode: readonly ? 'readonly' : 'employee_head', fullName: 'Fixture buyer' } }) });
const summaryRequest = (id = 41, status = 'awaiting_receipt') => ({ id, number: `PR-${id}`, poNumber: `GPO-${id}`, status, summary: true, itemCount: 1, itemSummary: 'Fixture purchase rice', items: [], timeline: [], header: { branch: 'Fixture branch', department: 'Fixture department', vendorName: 'Fixture supplier', purpose: 'Fixture purpose' }, subtotalAmount: 999, actualTotalAmount: 888, itemEstimatedTotal: 20, itemActualTotal: 20, createdAt: '2026-11-04T01:00:00Z' });
const fullRequest = (id = 41, status = 'awaiting_receipt') => ({ ...summaryRequest(id, status), summary: false, items: [{ id: 401, name: 'Fixture purchase rice', quantity: 2, unit: 'kg', totalPrice: 20, actualPrice: 20 }] });
const navigateTo = (page, pathname) => page.evaluate((path) => window.__audit.navigate(path), pathname);

async function setupPurchase({ readonly = true, detailError = false, detailStatus = 'awaiting_receipt', viewport, shrinkAfterMutation = false } = {}) {
  const calls = [];
  const changed = new Map();
  const result = await setup({ viewport, saved: accessSaved(readonly), handle: async (route, url) => {
    if (url.pathname === '/api/general-purchase') {
      calls.push({ kind: 'list', query: Object.fromEntries(url.searchParams) });
      const pageNo = Number(url.searchParams.get('page') || 1);
      const status = url.searchParams.get('status') || 'awaiting_receipt';
      const shrunk = shrinkAfterMutation && changed.size > 0;
      await route.fulfill({ json: { success: true, data: shrunk && pageNo > 1 ? [] : [summaryRequest(pageNo === 1 ? 41 : 42, status)], pagination: { page: pageNo, page_size: 30, total: shrunk ? 1 : 31, total_pages: shrunk ? 1 : 2 }, stats: { total: shrunk ? 1 : 31, byStatus: { pending_review: 5, approved: 4, awaiting_receipt: 20, received: 2, rejected: 0 } } } });
      return true;
    }
    const mutation = /^\/api\/general-purchase\/(\d+)\/(approve|issue-po|receive)$/.exec(url.pathname);
    if (mutation) {
      calls.push({ kind: 'mutation', action: mutation[2], body: route.request().postDataJSON() });
      const status = { approve: 'approved', 'issue-po': 'awaiting_receipt', receive: 'received' }[mutation[2]];
      changed.set(Number(mutation[1]), status);
      await json(route, fullRequest(Number(mutation[1]), status));
      return true;
    }
    const match = /^\/api\/general-purchase\/(\d+)$/.exec(url.pathname);
    if (match) {
      calls.push({ kind: 'detail', id: Number(match[1]) });
      if (detailError) await route.fulfill({ status: 404, json: { success: false, message: 'Fixture missing document' } });
      else await json(route, fullRequest(Number(match[1]), changed.get(Number(match[1])) || detailStatus));
      return true;
    }
    return false;
  } });
  await result.page.goto(`${base}/tests/harness.html`);
  await waitReady(result.page);
  return { ...result, calls };
}

test('GP summaries load only inside workspace, use server pagination/counts, and load no detail until opened', async () => {
  const { page, errors, calls } = await setupPurchase();
  try {
    await page.waitForTimeout(100);
    assert.equal(calls.length, 0);
    await navigateTo(page, '/general-purchase/hub');
    await page.getByText('เอกสารทั้งหมด (31)', { exact: true }).waitFor();
    assert.ok(await page.getByRole('link', { name: /ประวัติรับสินค้า/ }).getAttribute('href') === '/general-purchase/receive?status=received');
    assert.ok(calls.filter((call) => call.kind === 'list').every((call) => call.query.summary === 'true' && call.query.page_size === '30' && !call.query.limit));
    assert.equal(calls.filter((call) => call.kind === 'detail').length, 0);
    assert.equal(await page.getByText(/999|888/).count(), 0, 'summary keeps original item-sum basis instead of stored header totals');
    await page.getByRole('button', { name: 'หน้าถัดไป', exact: true }).click();
    await page.getByText('PR-42', { exact: true }).first().waitFor();
    assert.ok(calls.some((call) => call.query?.page === '2'));
    assert.ok(await page.getByText(/โหมดดูข้อมูล: ดูเอกสารและสถานะได้เท่านั้น/).count());
    assert.equal(await page.getByText(/PIN 1997/).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Awaiting opens the chosen document directly and readonly cannot receive it', async () => {
  const { page, errors, calls } = await setupPurchase();
  try {
    await navigateTo(page, '/general-purchase/awaiting');
    await page.getByRole('link', { name: 'ไปหน้ารับสินค้า →', exact: true }).click();
    await page.waitForURL('**/general-purchase/receive?request=41');
    await page.locator('[data-request-id="41"]').getByText('ใบกำกับภาษี', { exact: false }).first().waitFor();
    assert.equal(calls.filter((call) => call.kind === 'detail').length, 1);
    assert.equal(await page.getByRole('button', { name: /บันทึกรับสินค้า|ยืนยันรับสินค้า|บันทึก\/ปิด/ }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('GP detail opens lazily, handles missing documents and preserves retry', async () => {
  const { page, calls } = await setupPurchase({ detailError: true });
  try {
    await navigateTo(page, '/general-purchase/review');
    await page.getByText('PR-41', { exact: true }).waitFor();
    assert.equal(calls.filter((call) => call.kind === 'detail').length, 0);
    await page.getByRole('button', { name: 'เปิดรายละเอียด', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture missing document' }).waitFor();
    await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
    for (let i = 0; i < 30 && calls.filter((call) => call.kind === 'detail').length < 2; i++) await page.waitForTimeout(20);
    assert.equal(calls.filter((call) => call.kind === 'detail').length, 2);
  } finally { await page.close(); }
});

test('FollowupBell coalesces reads and pauses hidden/offline work, refreshing immediately on return', async () => {
  let reads = 0, release;
  const pending = new Promise((resolve) => { release = resolve; });
  let hold = false;
  const { page, errors } = await setup({ profile: admin, init: () => {
    window.__fixtureHidden = false; window.__fixtureOnline = true; window.__fixturePolls = [];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__fixtureHidden });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__fixtureOnline });
    const interval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => delay === 30000 ? (window.__fixturePolls.push(callback), 90000 + window.__fixturePolls.length) : interval(callback, delay, ...args);
  }, handle: async (route, url) => {
    if (!url.pathname.startsWith('/api/receiving-followups')) return false;
    reads++;
    if (hold) await pending;
    await json(route, { items: [], pending_count: 0 });
    return true;
  } });
  try {
    await page.goto(`${base}/tests/harness.html?mode=followup`); await waitReady(page);
    await page.getByRole('button', { name: 'แจ้งเตือนตามของ 0 เรื่อง' }).waitFor();
    const initial = reads;
    await page.evaluate(() => { window.__fixtureHidden = true; document.dispatchEvent(new Event('visibilitychange')); window.__fixturePolls.at(-1)(); });
    await page.waitForTimeout(60); assert.equal(reads, initial);
    await page.evaluate(() => { window.__fixtureHidden = false; window.__fixtureOnline = false; document.dispatchEvent(new Event('visibilitychange')); window.__fixturePolls.at(-1)(); });
    await page.waitForTimeout(60); assert.equal(reads, initial);
    hold = true;
    await page.evaluate(() => { window.__fixtureOnline = true; window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); window.__fixturePolls.at(-1)(); });
    for (let i = 0; i < 30 && reads === initial; i++) await page.waitForTimeout(20);
    assert.equal(reads, initial + 1);
    release();
    assert.deepEqual(errors, []);
  } finally { release(); await page.close(); }
});

test('unfinished reports disappear from settings navigation while their old URL remains readable', async () => {
  const { page, errors } = await setup({ profile: admin });
  try {
    await page.goto(`${base}/tests/harness.html?mode=settings`); await waitReady(page);
    await page.getByRole('heading', { name: 'ตั้งค่าระบบ', exact: true }).waitFor();
    assert.equal(await page.getByText(/รายงานการเบิก\/โอน\/ซื้อ\/วัตถุดิบ/).count(), 0);
    await navigateTo(page, '/admin/settings/reports/operations');
    await page.getByText('สถานะ: เตรียมไว้สำหรับพัฒนาต่อในเฟสถัดไป', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


for (const [pathname, status, action] of [['review', 'pending_review', 'approve'], ['po', 'approved', 'issue-po'], ['receive', 'awaiting_receipt', 'receive']]) {
  test(`GP ${pathname} retains operator action after summary/detail split`, async () => {
    const { page, errors, calls } = await setupPurchase({ readonly: false, detailStatus: status });
    try {
      await navigateTo(page, `/general-purchase/${pathname}`);
      await page.getByRole('button', { name: 'เปิดรายละเอียด', exact: true }).click();
      if (action === 'approve') {
        await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
        await page.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click();
      } else if (action === 'issue-po') {
        await page.getByRole('button', { name: 'ออก PO', exact: true }).click();
        await page.getByRole('button', { name: 'ออก PO ส่ง "รอรับ"', exact: true }).click();
      } else await page.getByRole('button', { name: 'บันทึก/ปิด', exact: true }).click();
      for (let i = 0; i < 30 && !calls.some((call) => call.kind === 'mutation'); i++) await page.waitForTimeout(25);
      const mutation = calls.find((call) => call.kind === 'mutation');
      assert.equal(mutation?.action, action);
      if (action === 'issue-po') assert.equal(mutation.body.poNumber, '', 'server allocates the number instead of guessing from one page');
      if (action === 'receive') assert.deepEqual(mutation.body.items, [{ id: 401, actualQuantity: 2, actualPrice: 20 }]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}


test('successful selected receipt transitions to received and never leaves an editable stale form', async () => {
  const { page, errors, calls } = await setupPurchase({ readonly: false });
  try {
    await navigateTo(page, '/general-purchase/receive?request=41');
    await page.getByRole('button', { name: 'บันทึก/ปิด', exact: true }).click();
    await page.waitForURL('**/general-purchase/receive?status=received&request=41');
    await page.getByText(/เอกสารนี้รับเสร็จแล้ว/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'บันทึก/ปิด', exact: true }).count(), 0);
    assert.equal(calls.filter((call) => call.kind === 'mutation').length, 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a mutation that empties the last page refetches the new last page rather than claiming no documents', async () => {
  const { page, errors, calls } = await setupPurchase({ readonly: false, detailStatus: 'pending_review', shrinkAfterMutation: true });
  try {
    await navigateTo(page, '/general-purchase/review?page=2');
    await page.getByText('PR-42', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'เปิดรายละเอียด', exact: true }).click();
    await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันอนุมัติ', exact: true }).click();
    await page.waitForURL('**/general-purchase/review?page=1');
    await page.getByText('PR-41', { exact: true }).waitFor();
    assert.ok(calls.some((call) => call.query?.page === '1'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const [width, height] of [[360, 800], [412, 915]]) {
  test(`GP readonly pager and selected-document journey fit mobile ${width}x${height}`, async () => {
    const { page, errors } = await setupPurchase({ viewport: { width, height } });
    try {
      await navigateTo(page, '/general-purchase/hub');
      await page.getByText('เอกสารทั้งหมด (31)', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'หน้าถัดไป', exact: true }).click();
      await page.getByText('PR-42', { exact: true }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'summary and pager have no horizontal overflow');
      if (width === 360) await page.screenshot({ path: `${process.env.SOLAO_ARTIFACTS_DIR}/gp-mobile-360-hub.png`, fullPage: true });
      await page.getByRole('link', { name: /รอรับ$/ }).click();
      await page.getByRole('link', { name: 'ไปหน้ารับสินค้า →', exact: true }).click();
      await page.getByText('ใบกำกับภาษี', { exact: false }).first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'selected receipt has no horizontal overflow');
      assert.equal(await page.getByRole('button', { name: 'บันทึก/ปิด', exact: true }).count(), 0);
      if (width === 412) await page.screenshot({ path: `${process.env.SOLAO_ARTIFACTS_DIR}/gp-mobile-412-receive.png`, fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}
