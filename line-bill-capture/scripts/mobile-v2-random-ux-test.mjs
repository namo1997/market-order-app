import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.MOBILE_TEST_BASE_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
const outputDir = path.resolve('artifacts/mobile-v2');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 }
];

const api = async (route) => {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return (await response.json()).data || [];
};

const auditPage = async (page, label) => {
  await page.locator('main').waitFor({ state: 'visible' });
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    targets: [...document.querySelectorAll('button,a')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.hasAttribute('disabled')
          && (rect.height < 40 || rect.width < 32);
      })
      .map((element) => ({ text: (element.textContent || '').trim().slice(0, 40), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) }))
  }));
  if (result.overflow) throw new Error(`${label} has horizontal overflow`);
  if (result.targets.length) throw new Error(`${label} has an undersized target: ${JSON.stringify(result.targets[0])}`);
};

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const startDate = new Date(`${today}T12:00:00+07:00`);
startDate.setDate(startDate.getDate() - 60);
const days = await api(`/api/admin/days?start=${startDate.toISOString().slice(0, 10)}&end=${today}`);
const openRound = days.find((row) => row.closing_status !== 'closed'
  && Number(row.pending_count || 0) + Number(row.needs_amount_count || 0) + Number(row.unmatched_count || 0) > 0);
if (!openRound) throw new Error('No open round is available for Mobile V2 testing');
const reviewRound = days.find((row) => row.closing_status !== 'closed' && Number(row.pending_count || row.pending_matches || 0) > 0) || openRound;

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const report = { pages: 0, pairedReviews: 0, viewports: viewports.map((row) => row.width), failures: [] };

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    for (const route of ['/m2/', '/m2/calendar', '/m2/search', '/m2/more']) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
      await auditPage(page, `${route} at ${viewport.width}`);
      report.pages += 1;
    }
    const dayUrl = `${baseUrl}/m2/day/${reviewRound.business_date}/${reviewRound.source_id}?bucket=review`;
    await page.goto(dayUrl, { waitUntil: 'domcontentloaded' });
    await auditPage(page, `day at ${viewport.width}`);
    const firstPair = page.locator('.queue-row.pair').first();
    if (await firstPair.count()) {
      await firstPair.click();
      await page.locator('.evidence-stage').waitFor({ state: 'visible' });
      await auditPage(page, `review at ${viewport.width}`);
      const switchCount = await page.locator('.evidence-switch button').count();
      if (switchCount !== 2) throw new Error(`review rendered ${switchCount} evidence switches`);
      await page.locator('.evidence-switch button').nth(1).click();
      await page.getByRole('button', { name: /แชทรอบรูป/ }).click();
      await page.locator('.chat-sheet').waitFor({ state: 'visible' });
      await page.locator('.chat-sheet .icon-button').click();
      await page.getByRole('button', { name: /เหตุผลของ AI/ }).click();
      await page.locator('.ai-reasons').waitFor({ state: 'visible' });
      await page.locator('.chat-sheet .icon-button').click();
      await page.getByRole('button', { name: 'เปลี่ยนคู่' }).click();
      await page.locator('.candidate-list').waitFor({ state: 'visible' });
      const pickerOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (pickerOverflow) throw new Error('candidate picker has horizontal overflow');
      report.pairedReviews += 1;
    }
    await page.screenshot({ path: path.join(outputDir, `mobile-v2-${viewport.width}.png`), fullPage: false });
  } catch (error) {
    report.failures.push({ viewport: viewport.width, error: error.message });
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
