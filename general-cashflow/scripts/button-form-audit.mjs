import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.CASHFLOW_AUDIT_URL || 'http://127.0.0.1:5178').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('artifacts/button-form-audit');
const credentials = {
  admin: ['admin', 'admin12345'],
  auditor: ['auditor', 'auditor123'],
  recorder: ['recorder', 'recorder123']
};

await fs.mkdir(outputDir, { recursive: true });

const login = async (page, role) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.login-screen,.topbar,.cashier-app').first().waitFor();
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

const openReceipt = async (page, role, date) => {
  await login(page, role);
  if (role === 'cashier') {
    await page.locator('.cashier-selector select').selectOption({ label: 'สาขาทดสอบปุ่ม (ข้อมูลจำลอง)' });
  } else {
    await page.getByRole('button', { name: 'สาขาทดสอบปุ่ม (ข้อมูลจำลอง)', exact: true }).click();
  }
  const day = page.locator(`button[title^="${date} "]`);
  await day.waitFor({ state: 'visible' });
  await day.click();
  await page.locator(role === 'cashier' ? '.cashier-status-row' : '.receipt-review-panel').waitFor();
  if (role !== 'cashier') {
    await page.locator('.dashboard-receipt-overview p').getByText(date, { exact: false }).waitFor();
  }
  await page.waitForTimeout(150);
};

const scenarios = [
  {
    name: 'cashier adds miscellaneous receipt item', role: 'cashier', date: '2026-08-14',
    run: async (page, expectDecision) => {
      await page.getByRole('button', { name: 'เช็คอิน', exact: true }).click();
      await page.locator('input[placeholder="จำนวนเงิน"]').fill('123.45');
      await expectDecision(() => page.getByRole('button', { name: 'เพิ่ม', exact: true }).click());
    }
  },
  {
    name: 'cashier submits edited daily receipt', role: 'cashier', date: '2026-08-14',
    run: async (page, expectDecision) => {
      const amount = page.locator('.cashier-amount-input').first();
      await amount.fill('5000');
      const tableConfirmation = page.locator('.table-check-confirm input');
      if (await tableConfirmation.count()) await tableConfirmation.check();
      const tableNote = page.locator('.table-check-note');
      if (await tableNote.count()) await tableNote.fill('ทดสอบการส่งยอดใน Shadow mode');
      await expectDecision(() => page.getByRole('button', { name: 'ส่งยอด', exact: true }).click(), 6000);
    }
  },
  {
    name: 'auditor updates one cashier amount', role: 'auditor', date: '2026-08-15',
    run: async (page, expectDecision) => {
      const input = page.locator('.matrix-cashier input').first();
      await input.fill('1201');
      await expectDecision(() => page.locator('.matrix-inline-update-btn.is-visible').first().click());
    }
  },
  {
    name: 'auditor manually verifies a payment channel', role: 'auditor', date: '2026-08-15',
    run: async (page, expectDecision) => {
      await expectDecision(() => page.locator('.manual-check-btn:enabled').first().click());
    }
  },
  {
    name: 'auditor requests cashier correction', role: 'auditor', date: '2026-08-15',
    run: async (page, expectDecision) => {
      await expectDecision(() => page.getByRole('button', { name: 'ส่งกลับแก้ไข', exact: true }).click());
    }
  },
  {
    name: 'recorder closes checked receipt', role: 'recorder', date: '2026-08-16',
    run: async (page, expectDecision) => {
      await expectDecision(() => page.getByRole('button', { name: 'ปิดเอกสาร', exact: true }).click());
    }
  },
  {
    name: 'admin creates branch from settings', role: 'admin', nav: 'ตั้งค่า',
    run: async (page, expectDecision) => {
      await page.locator('input[placeholder="Code"]').fill('SHADOW_ONLY');
      await page.locator('input[placeholder="ชื่อสาขา"]').fill('ทดสอบ Shadow ไม่บันทึก');
      await page.locator('input[placeholder="ClickHouse branch id"]').fill('999999');
      await expectDecision(() => page.locator('.inline-form').getByRole('button', { name: 'บันทึก', exact: true }).click());
    }
  },
  {
    name: 'admin refreshes morning brief', role: 'admin', nav: 'สรุปงานค้าง',
    run: async (page, expectDecision) => {
      await expectDecision(() => page.getByRole('button', { name: 'สร้างใหม่', exact: true }).click());
    }
  }
];

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];

for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: scenario.role === 'cashier' ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await context.newPage();
  const writes = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`); });
  page.on('request', (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (/\/(auth\/login|auth\/cashier|decision-contexts|decisions\/[^/]+\/cancel)$/.test(pathname)) return;
    writes.push(`${request.method()} ${pathname}`);
  });
  page.on('dialog', (dialog) => dialog.accept('ทดสอบ Shadow mode'));

  const expectDecision = async (action, timeout = 4000) => {
    await action();
    const dialog = page.locator('.decision-reason-backdrop:visible');
    await dialog.waitFor({ timeout });
    const reasons = dialog.locator('.decision-reason-options button');
    if (await reasons.count() < 3) throw new Error('ตัวเลือกเหตุผลไม่ครบ');
    await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(150);
    if (writes.length) throw new Error(`business mutation escaped cancellation: ${writes.join(', ')}`);
  };

  try {
    if (scenario.date) await openReceipt(page, scenario.role, scenario.date);
    else {
      await login(page, scenario.role);
      await page.getByRole('button', { name: scenario.nav, exact: true }).click();
    }
    await scenario.run(page, expectDecision);
    if (errors.length) throw new Error(errors.join(' | '));
    results.push({ name: scenario.name, status: 'passed' });
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    results.push({ name: scenario.name, status: 'failed', error: error.message });
    console.log(`FAIL ${scenario.name}: ${error.message}`);
    await page.screenshot({ path: path.join(outputDir, `${scenario.name.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

await browser.close();
await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(results, null, 2));
const failed = results.filter((result) => result.status === 'failed');
console.log(JSON.stringify({ scenarios: results.length, passed: results.length - failed.length, failed: failed.length }, null, 2));
if (failed.length) process.exitCode = 1;
