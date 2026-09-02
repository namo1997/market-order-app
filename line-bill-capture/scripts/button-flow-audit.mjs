import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.BUTTON_AUDIT_BASE_URL || 'http://127.0.0.1:8020').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('artifacts/button-flow-audit');
const maxDepth = Math.max(1, Math.min(3, Number(process.env.BUTTON_AUDIT_DEPTH || 2)));

const api = async (route) => {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return (await response.json()).data || [];
};

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
const businessDate = (item) => {
  const timestamp = Number(item?.event_timestamp_ms || 0);
  if (timestamp) return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
  return String(item?.created_at_line || item?.created_at || '').slice(0, 10);
};

const [days, items, matches] = await Promise.all([
  api('/api/admin/days?start=2026-07-01&end=2026-08-31'),
  api('/api/admin/items?start=2026-07-01&end=2026-08-31&limit=5000&live=1'),
  api('/api/admin/matches?limit=1000')
]);

const activeMatch = matches.find((row) => ['pending', 'manual_review'].includes(String(row.status)) && !row.is_group);
const byId = new Map(items.map((row) => [Number(row.id), row]));
const unmatched = (category) => items.find((row) => row.category === category
  && !['pending', 'confirmed', 'manual_review'].includes(String(row.match_status))
  && row.status !== 'unsent' && row.status !== 'duplicate');
const bill = unmatched('bill');
const slip = unmatched('transfer');
const other = unmatched('other');
const flagged = items.find((row) => Number(row.amount_conflict_flag || 0) === 1);
const openRound = days.find((row) => row.closing_status !== 'closed'
  && Number(row.pending_count || 0) + Number(row.unmatched_count || 0) + Number(row.needs_amount_count || 0) > 0);
const closedRound = days.find((row) => row.closing_status === 'closed');

if (!activeMatch || !bill || !slip || !openRound) {
  throw new Error('Audit fixture is missing a pending match, bill, slip, or open day');
}

const itemRoute = (prefix, item, bucket) => `${prefix}/review/item/${item.id}?date=${businessDate(item)}&source=${item.source_id}&bucket=${bucket}&item=${item.id}`;
const matchBill = byId.get(Number(activeMatch.bill_item_id));
let routes = [];
for (const prefix of ['/m2', '/m']) {
  routes.push(
    { label: `${prefix} home`, url: `${prefix}/` },
    { label: `${prefix} calendar`, url: `${prefix}/calendar` },
    { label: `${prefix} search`, url: `${prefix}/search`, prepare: async (page) => page.locator('input[placeholder*="2 ตัว"]').fill('Makro') },
    { label: `${prefix} more`, url: `${prefix}/more` },
    { label: `${prefix} flags`, url: `${prefix}/flags` },
    { label: `${prefix} open day`, url: `${prefix}/day/${openRound.business_date}/${openRound.source_id}` },
    { label: `${prefix} match review`, url: `${prefix}/review/match/${activeMatch.id}?date=${businessDate(matchBill)}&source=${matchBill.source_id}&bucket=review&item=${matchBill.id}` },
    { label: `${prefix} unmatched bill`, url: itemRoute(prefix, bill, 'bill') },
    { label: `${prefix} unmatched slip`, url: itemRoute(prefix, slip, 'slip') }
  );
  if (other) routes.push({ label: `${prefix} other document`, url: itemRoute(prefix, other, 'other') });
  if (closedRound) routes.push({ label: `${prefix} closed day`, url: `${prefix}/day/${closedRound.business_date}/${closedRound.source_id}?bucket=done` });
}
routes.push({ label: 'desktop board', url: '/admin' });
routes.push({ label: 'desktop review', url: `/admin?view=day&date=${businessDate(matchBill)}&group=${matchBill.source_id}&bucket=review&item=${activeMatch.id}` });
routes.push({ label: 'desktop bill', url: `/admin?view=day&date=${businessDate(bill)}&group=${bill.source_id}&bucket=bill&item=${bill.id}` });
routes.push({ label: 'desktop slip', url: `/admin?view=day&date=${businessDate(slip)}&group=${slip.source_id}&bucket=slip&item=${slip.id}` });
if (flagged) routes.push({ label: 'desktop flags', url: `/admin?view=flags&item=${flagged.id}` });
const routePattern = String(process.env.BUTTON_AUDIT_ROUTE || '').trim().toLowerCase();
if (routePattern) routes = routes.filter((route) => route.label.toLowerCase().includes(routePattern));

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const report = {
  baseUrl, routes: routes.length, discovered: 0, clicked: 0, decisionPrompts: 0,
  nativeDialogs: 0, openedSurfaces: 0, disabled: [], unsafeMutations: [], failures: [], coverage: []
};
report.missingImages = [];

const inspectLayout = async (page, label) => {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const overlays = [...document.querySelectorAll('.sheet-backdrop,.decision-sheet-backdrop,.decisionbg,.decision-reason-backdrop,[role="dialog"]')].filter(visible);
    const activeOverlay = overlays.at(-1);
    const targets = [...document.querySelectorAll('button,a[href]')].filter((element) => visible(element) && (!activeOverlay || activeOverlay.contains(element))).map((element) => {
      const rect = element.getBoundingClientRect();
      const center = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)), Math.min(innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height / 2, innerHeight - rect.top - 1))));
      return {
        name: (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        width: Math.round(rect.width), height: Math.round(rect.height),
        blocked: rect.top >= 0 && rect.bottom <= innerHeight && !(center === element || element.contains(center))
      };
    });
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      undersized: targets.filter((row) => row.width < 44 || row.height < 44),
      blocked: targets.filter((row) => row.blocked)
    };
  });
  if (result.overflow) throw new Error(`${label}: horizontal overflow`);
  if (result.undersized.length) throw new Error(`${label}: undersized target ${JSON.stringify(result.undersized[0])}`);
  // Playwright click checks actual obstruction after scrolling a target into view. A static
  // center-point scan reports false positives for horizontal carousels and fixed bottom navs.
};

const buttonInventory = async (page) => page.locator('button:visible').evaluateAll((buttons) => {
  const seen = new Map();
  return buttons.map((button, index) => {
    const name = (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180) || '(ไม่มีชื่อ)';
    const occurrence = seen.get(name) || 0;
    seen.set(name, occurrence + 1);
    return { name, occurrence, index, disabled: button.disabled };
  });
});

const findButton = (page, step) => page.locator('button:visible').nth(step.index);

const setupPage = async (context, route, sequence, issues) => {
  const page = await context.newPage();
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of 404/.test(message.text())) issues.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) issues.push(`HTTP ${response.status()} ${response.url()}`);
    if (response.status() === 404) {
      const type = response.request().resourceType();
      if (type === 'image') report.missingImages.push({ route: route.label, url: response.url() });
      else issues.push(`HTTP 404 ${type} ${response.url()}`);
    }
  });
  page.on('request', (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (/\/(decision-contexts|decisions\/[^/]+\/cancel|category-learning\/review|auth\/logout)$/.test(pathname)) return;
    const headers = request.headers();
    if (pathname.startsWith('/api/admin/') && !headers['x-decision-id']) report.unsafeMutations.push({ route: route.label, pathname, method: request.method() });
  });
  page.on('dialog', async (dialog) => { report.nativeDialogs += 1; await dialog.accept(); });
  await page.goto(`${baseUrl}${route.url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);
  await route.prepare?.(page);
  for (const step of sequence) {
    const locator = findButton(page, step);
    if (!await locator.count()) throw new Error(`cannot replay button “${step.name}”`);
    await locator.click();
    await page.waitForTimeout(180);
  }
  return page;
};

const auditRoute = async (route) => {
  const context = await browser.newContext({ viewport: { width: route.url.startsWith('/admin') ? 1440 : 390, height: route.url.startsWith('/admin') ? 900 : 844 } });
  const seenSequences = new Set();
  const queue = [{ sequence: [], allowedButtons: null }];
  const routeCoverage = { route: route.label, buttons: [], clicks: 0, prompts: 0, failures: [] };
  try {
    while (queue.length) {
      const { sequence, allowedButtons } = queue.shift();
      const sequenceKey = JSON.stringify(sequence);
      if (seenSequences.has(sequenceKey)) continue;
      seenSequences.add(sequenceKey);
      const issues = [];
      let page;
      try {
        page = await setupPage(context, route, sequence, issues);
        await inspectLayout(page, `${route.label} ${sequence.map((row) => row.name).join(' > ')}`);
        const inventory = await buttonInventory(page);
        report.discovered += inventory.length;
        for (const row of inventory) {
          if (!routeCoverage.buttons.includes(row.name)) routeCoverage.buttons.push(row.name);
          if (row.disabled) report.disabled.push({ route: route.label, sequence: sequence.map((step) => step.name), button: row.name });
        }
        if (sequence.length >= maxDepth) continue;
        const enabled = inventory.filter((row) => !row.disabled && (
          !allowedButtons || allowedButtons.includes(`${row.name}:${row.occurrence}`)
        )).slice(0, 40);
        for (const button of enabled) {
          const clickIssues = [];
          let clickPage;
          try {
            clickPage = await setupPage(context, route, sequence, clickIssues);
            const locator = findButton(clickPage, button);
            if (!await locator.count()) continue;
            await locator.click({ timeout: 4000 });
            report.clicked += 1; routeCoverage.clicks += 1;
            await clickPage.waitForTimeout(250);
            const reason = clickPage.locator('.decision-sheet-backdrop:visible,.decisionbg:visible,.decision-reason-backdrop:visible');
            if (await reason.count()) {
              const optionCount = await reason.locator('button').count();
              if (optionCount < 2) throw new Error(`reason dialog has only ${optionCount} buttons`);
              report.decisionPrompts += 1; routeCoverage.prompts += 1;
              const cancel = reason.getByRole('button', { name: 'ยกเลิก' }).last();
              if (await cancel.count()) await cancel.click();
            } else {
              const after = await buttonInventory(clickPage);
              const beforeNames = new Set(inventory.map((row) => `${row.name}:${row.occurrence}`));
              const newButtons = after.filter((row) => !row.disabled && !beforeNames.has(`${row.name}:${row.occurrence}`));
              if (newButtons.length) report.openedSurfaces += 1;
              if (sequence.length + 1 < maxDepth && newButtons.length) queue.push({
                sequence: [...sequence, button],
                allowedButtons: newButtons.map((row) => `${row.name}:${row.occurrence}`)
              });
            }
            if (clickIssues.length) throw new Error(clickIssues.join(' | '));
            await inspectLayout(clickPage, `${route.label} click ${button.name}`);
          } catch (error) {
            const message = `${sequence.map((step) => step.name).join(' > ')} > ${button.name}: ${error.message}`;
            routeCoverage.failures.push(message);
            report.failures.push({ route: route.label, flow: message });
          } finally {
            await clickPage?.close().catch(() => {});
          }
        }
        if (issues.length) throw new Error(issues.join(' | '));
      } catch (error) {
        routeCoverage.failures.push(`${sequence.map((step) => step.name).join(' > ') || 'load'}: ${error.message}`);
        report.failures.push({ route: route.label, flow: error.message });
      } finally {
        await page?.close().catch(() => {});
      }
    }
  } finally {
    await context.close();
  }
  report.coverage.push(routeCoverage);
};

for (const route of routes) await auditRoute(route);
await browser.close();

await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  routes: report.routes, discovered: report.discovered, clicked: report.clicked,
  decisionPrompts: report.decisionPrompts, nativeDialogs: report.nativeDialogs,
  openedSurfaces: report.openedSurfaces, disabled: report.disabled.length,
  unsafeMutations: report.unsafeMutations.length, failures: report.failures.length
}, null, 2));
if (report.unsafeMutations.length || report.failures.length) process.exitCode = 1;
