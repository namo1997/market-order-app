import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.SOLAO_LOCAL_SIMULATION || !process.cwd().startsWith('/Volumes/SSD Files/SOLAO/')) throw new Error('Use verified SSD snapshot');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
let server, browser, base;
before(async () => {
  process.env.VITE_API_URL = '/api';
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  server = await createServer({ root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
const user = { id: 9, role: 'admin', name: 'Fixture admin', branch_id: 1, department_id: 1 };
const report = (amount) => ({ start: '2026-11-04', end: '2026-11-04', summary: { bill_count: 1, total_revenue: amount, menu_count: 0 }, items: [], pareto_items: [], daily: [], by_branch: [], by_group: [], by_hour: [], bill_dist: [], by_weekday: [], prev_items: [], prev_top_items: [] });
async function setup(handle) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.addInitScript((user) => { sessionStorage.setItem('token', 'fixture-token'); sessionStorage.setItem('user', JSON.stringify(user)); }, user);
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    if (await handle(route, url)) return;
    let data = [];
    if (url.pathname === '/api/auth/me') data = user;
    if (url.pathname.endsWith('/branches')) data = [{ id: 1, name: 'Fixture A', clickhouse_branch_id: 'a' }, { id: 2, name: 'Fixture B', clickhouse_branch_id: 'b' }];
    if (url.pathname.endsWith('/reports/sales')) data = report(100);
    await route.fulfill({ json: { success: true, data } });
  });
  return { page, errors, dialogs };
}

test('private sales page loads product suggestions only on focus and caches an empty result', async () => {
  let products = 0;
  const { page, errors, dialogs } = await setup(async (route, url) => {
    if (url.pathname !== '/api/products') return false;
    products++; await route.fulfill({ json: { success: true, data: [] } }); return true;
  });
  try {
    await page.goto(`${base}/admin/settings/sales-report`);
    await page.getByText('฿100.00', { exact: true }).first().waitFor();
    assert.equal(products, 0);
    const search = page.getByPlaceholder('ชื่อเมนูหรือ barcode');
    await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/api/products'), search.focus()]);
    await page.getByRole('heading', { name: 'รายงานยอดขาย', exact: true }).click(); await search.focus();
    assert.equal(products, 1); assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  } finally { await page.close(); }
});

test('public sales branch switch cancels obsolete request without replacing the newer totals or alerting', async () => {
  let release, started, completed;
  const held = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { started = resolve; });
  const finished = new Promise((resolve) => { completed = resolve; });
  const { page, errors, dialogs } = await setup(async (route, url) => {
    if (!url.pathname.endsWith('/reports/sales')) return false;
    const branch = url.searchParams.get('branch_id');
    if (branch === '1') {
      started(); await held;
      try { await route.fulfill({ json: { success: true, data: report(111) } }); } catch { /* request deliberately aborted */ }
      completed(); return true;
    }
    await route.fulfill({ json: { success: true, data: report(branch === '2' ? 222 : 100) } }); return true;
  });
  try {
    await page.goto(`${base}/sales-dashboard`);
    await page.getByText('฿100.00', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Fixture A', exact: true }).click(); await reached;
    await page.getByRole('button', { name: 'Fixture B', exact: true }).click();
    await page.getByText('฿222.00', { exact: true }).first().waitFor();
    release(); await finished;
    assert.equal(await page.getByText('฿111.00', { exact: true }).count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  } finally { release(); await page.close(); }
});
