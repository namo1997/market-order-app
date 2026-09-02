import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.CASHFLOW_AUDIT_URL || 'http://127.0.0.1:5178').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('artifacts/button-flow-audit');
const credentials = {
  admin: ['admin', 'admin12345'],
  auditor: ['auditor', 'auditor123'],
  recorder: ['recorder', 'recorder123']
};
const allStates = [
  { label: 'admin dashboard controls', role: 'admin', kind: 'dashboard', date: '2026-08-15' },
  ...['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']
    .map((date) => ({ label: `admin receipt ${date}`, role: 'admin', kind: 'receipt', date })),
  { label: 'admin report', role: 'admin', kind: 'nav', nav: 'รายงาน' },
  { label: 'admin brief', role: 'admin', kind: 'nav', nav: 'สรุปงานค้าง' },
  { label: 'admin inbox', role: 'admin', kind: 'nav', nav: 'ไฟล์อีเมล' },
  { label: 'admin settings', role: 'admin', kind: 'nav', nav: 'ตั้งค่า' },
  { label: 'admin agents', role: 'admin', kind: 'nav', nav: 'Agent Health' },
  { label: 'auditor submitted', role: 'auditor', kind: 'receipt', date: '2026-08-15' },
  { label: 'auditor checked', role: 'auditor', kind: 'receipt', date: '2026-08-16' },
  { label: 'auditor brief', role: 'auditor', kind: 'nav', nav: 'สรุปงานค้าง' },
  { label: 'auditor inbox', role: 'auditor', kind: 'nav', nav: 'ไฟล์อีเมล' },
  { label: 'auditor agents', role: 'auditor', kind: 'nav', nav: 'Agent Health' },
  { label: 'recorder checked', role: 'recorder', kind: 'receipt', date: '2026-08-16' },
  { label: 'recorder closed', role: 'recorder', kind: 'receipt', date: '2026-08-19' },
  { label: 'recorder report', role: 'recorder', kind: 'nav', nav: 'รายงาน' },
  { label: 'cashier draft', role: 'cashier', kind: 'receipt', date: '2026-08-14' },
  { label: 'cashier correction', role: 'cashier', kind: 'receipt', date: '2026-08-18' },
  { label: 'cashier readonly', role: 'cashier', kind: 'receipt', date: '2026-08-15' }
];
const statePattern = String(process.env.CASHFLOW_AUDIT_STATE || '').trim().toLowerCase();
const states = statePattern
  ? allStates.filter((state) => state.label.toLowerCase().includes(statePattern))
  : allStates;

const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const report = { states: states.length, discovered: 0, clicked: 0, decisions: 0, disabled: [], failures: [], coverage: [] };
await fs.mkdir(outputDir, { recursive: true });

const login = async (page, role) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.login-screen,.topbar,.cashier-app').first().waitFor();
  if (role === 'cashier' && await page.locator('.cashier-app').count()) return;
  if (role !== 'cashier' && await page.locator('.topbar').count()) return;
  if (role === 'cashier') {
    await page.getByRole('button', { name: 'เข้าใช้งานแคชเชียร์' }).click();
    await page.locator('.cashier-app').waitFor();
    return;
  }
  const [username, password] = credentials[role];
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.locator('.topbar').waitFor();
};

const openState = async (page, state) => {
  await login(page, state.role);
  if (state.kind === 'nav') {
    await page.getByRole('button', { name: state.nav, exact: true }).click();
    await page.waitForTimeout(350);
    return;
  }
  if (state.role === 'cashier') {
    await page.locator('.cashier-selector select').selectOption({ label: 'สาขาทดสอบปุ่ม (ข้อมูลจำลอง)' });
  } else {
    await page.getByRole('button', { name: 'สาขาทดสอบปุ่ม (ข้อมูลจำลอง)', exact: true }).click();
  }
  const day = page.locator(`button[title^="${state.date} "]`);
  await day.waitFor({ state: 'visible' });
  await day.click();
  await page.locator(state.role === 'cashier' ? '.cashier-status-row' : '.receipt-review-panel').waitFor();
  await page.waitForTimeout(250);
};

const inventory = async (page, state) => page.locator('button:visible').evaluateAll((buttons, currentState) => {
  const seen = new Map();
  return buttons.map((button, index) => {
    const name = (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '')
      .replace(/\s+/g, ' ').trim() || '(ไม่มีชื่อ)';
    const occurrence = seen.get(name) || 0;
    seen.set(name, occurrence + 1);
    const inScope = currentState.role === 'cashier'
      ? Boolean(button.closest('.cashier-app'))
      : currentState.kind === 'receipt'
        ? Boolean(button.closest('.receipt-review-panel'))
        : currentState.kind === 'dashboard'
          ? Boolean(button.closest('.dashboard-control-rail'))
          : !button.closest('.topbar');
    return { name, occurrence, index, disabled: button.disabled, calendarDay: button.classList.contains('receipt-calendar-day'), inScope };
  }).filter((row) => row.inScope);
}, state);

const inspect = async (page) => page.evaluate(() => {
  const visible = (node) => {
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const targets = [...document.querySelectorAll('button,a[href],input,select,textarea')]
    .filter((node) => visible(node) && !node.classList.contains('visually-hidden'))
    .map((node) => {
    const hitTarget = node.matches('input[type="checkbox"],input[type="radio"]') ? (node.closest('label') || node) : node;
    const rect = hitTarget.getBoundingClientRect();
    return { name: (node.getAttribute('aria-label') || node.textContent || node.getAttribute('name') || node.tagName).replace(/\s+/g, ' ').trim().slice(0, 80), width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  return {
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    tinyMobile: innerWidth <= 430 ? targets.filter((row) => row.width < 44 || row.height < 44) : []
  };
});

const setupPage = async (context, state, issues, writes) => {
  const page = await context.newPage();
  if (state.role !== 'cashier') {
    await page.addInitScript(({ date }) => {
      localStorage.setItem('general_cashflow_dashboard_filters', JSON.stringify({ date, branch_id: '', status: '' }));
    }, { date: state.date || '2026-08-15' });
  }
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) issues.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) issues.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (/\/(auth\/login|auth\/cashier|decision-contexts|decisions\/[^/]+\/cancel)$/.test(pathname)) return;
    writes.push(`${request.method()} ${pathname}`);
  });
  page.on('dialog', (dialog) => dialog.accept('ทดสอบ browser audit'));
  await openState(page, state);
  return page;
};

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const auditState = async (state) => {
  console.log(`START ${state.label}`);
  const viewport = state.role === 'cashier' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addInitScript(() => { window.print = () => {}; });
  const stateCoverage = { state: state.label, buttons: [], clicks: 0, decisions: 0, failures: [] };
  let rootPage;
  try {
    const rootIssues = []; const rootWrites = [];
    rootPage = await setupPage(context, state, rootIssues, rootWrites);
    const layout = await inspect(rootPage);
    if (layout.overflow) stateCoverage.failures.push('horizontal overflow');
    if (layout.tinyMobile.length) stateCoverage.failures.push(`undersized mobile target ${JSON.stringify(layout.tinyMobile[0])}`);
    if (rootIssues.length) stateCoverage.failures.push(...rootIssues);
    if (rootWrites.length) stateCoverage.failures.push(`unexpected writes while loading: ${rootWrites.join(', ')}`);
    const buttons = await inventory(rootPage, state);
    report.discovered += buttons.length;
    stateCoverage.buttons = buttons.map((row) => row.name);
    for (const button of buttons) {
      if (button.disabled) {
        report.disabled.push({ state: state.label, button: button.name });
        continue;
      }
      if (button.calendarDay) continue;
      const issues = []; const writes = [];
      let page;
      try {
        page = await setupPage(context, state, issues, writes);
        const target = page.locator('button:visible').nth(button.index);
        if (!await target.count()) throw new Error(`cannot replay ${button.name}`);
        await target.click({ timeout: 5000 });
        report.clicked += 1; stateCoverage.clicks += 1;
        await page.waitForTimeout(350);
        const decision = page.locator('.decision-reason-backdrop:visible');
        if (await decision.count()) {
          const choices = decision.locator('.decision-reason-options button');
          if (await choices.count() < 3) throw new Error('decision dialog has too few reason choices');
          report.decisions += 1; stateCoverage.decisions += 1;
          await decision.getByRole('button', { name: 'ยกเลิก' }).click();
          await decision.waitFor({ state: 'detached' });
          await page.waitForTimeout(100);
        }
        if (writes.length) throw new Error(`business mutation escaped cancellation: ${writes.join(', ')}`);
        if (issues.length) throw new Error(issues.join(' | '));
        const afterLayout = await inspect(page);
        if (afterLayout.overflow) throw new Error('horizontal overflow after click');
        if (afterLayout.tinyMobile.length) throw new Error(`undersized mobile target ${JSON.stringify(afterLayout.tinyMobile[0])}`);
      } catch (error) {
        const message = `${button.name}: ${error.message}`;
        stateCoverage.failures.push(message);
        await page?.screenshot({ path: path.join(outputDir, `${state.label}-${button.name}`.replace(/[^a-z0-9]+/gi, '-').slice(0, 120) + '.png'), fullPage: true }).catch(() => {});
      } finally {
        await page?.close().catch(() => {});
      }
    }
  } catch (error) {
    stateCoverage.failures.push(`load: ${error.message}`);
  } finally {
    await rootPage?.close().catch(() => {});
    await context.close();
  }
  report.coverage.push(stateCoverage);
  stateCoverage.failures.forEach((failure) => report.failures.push({ state: state.label, flow: failure }));
  console.log(`DONE ${state.label} clicks=${stateCoverage.clicks} failures=${stateCoverage.failures.length}`);
  if (stateCoverage.failures.length) console.log(JSON.stringify(stateCoverage.failures));
};
for (let index = 0; index < states.length; index += 3) {
  await Promise.all(states.slice(index, index + 3).map(auditState));
}
await browser.close();
await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ states: report.states, discovered: report.discovered, clicked: report.clicked, decisions: report.decisions, disabled: report.disabled.length, failures: report.failures.length }, null, 2));
if (report.failures.length) process.exitCode = 1;
