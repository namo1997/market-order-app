import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.MOBILE_TEST_BASE_URL || 'http://127.0.0.1:8010').replace(/\/$/, '');
const sampleSize = Math.max(3, Math.min(20, Number(process.env.MOBILE_TEST_SAMPLES || 10)));
const seed = Number(process.env.MOBILE_TEST_SEED || Date.now());
const outputDir = path.resolve('artifacts/mobile/random-ux');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let state = seed >>> 0;
const random = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};
const shuffled = (rows) => [...rows].sort(() => random() - 0.5);
const smallTargets = async (page) => page.evaluate(() => [...document.querySelectorAll('button,a')]
  .filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !element.hasAttribute('disabled') && (rect.height < 40 || rect.width < 32);
  })
  .map((element) => ({ text: (element.textContent || '').trim().slice(0, 40), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })));
const api = async (route) => {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  const payload = await response.json();
  return payload.data || [];
};
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const startDate = new Date(`${date}T12:00:00+07:00`);
startDate.setDate(startDate.getDate() - 60);
const start = startDate.toISOString().slice(0, 10);
const days = await api(`/api/admin/days?start=${start}&end=${date}`);
const openDays = days.filter((row) => row.closing_status !== 'closed'
  && Number(row.pending_count || 0) + Number(row.needs_amount_count || 0) + Number(row.unmatched_count || 0) > 0);
if (!openDays.length) throw new Error('No open rounds are available for random testing');

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const viewports = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 }];
const selected = shuffled(openDays).slice(0, sampleSize);
const report = { seed, sampleSize: selected.length, pages: 0, pairedReviews: 0, unmatchedReviews: 0, toolChecks: 0, failures: [], samples: [] };

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    for (const route of ['/m/', '/m/calendar', '/m/flags']) {
      await page.goto(`${baseUrl}${route}?shell=${seed}-${viewport.width}`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error(`horizontal overflow on ${route} at ${viewport.width}px`);
      const undersized = await smallTargets(page);
      if (undersized.length) throw new Error(`undersized target on ${route}: ${JSON.stringify(undersized[0])}`);
      if (route === '/m/calendar') {
        const multiGroupDay = page.locator('button.calendar-day.has-data').first();
        if (await multiGroupDay.count()) {
          await multiGroupDay.click();
          await page.locator('.choice-sheet').waitFor({ state: 'visible' });
          const choices = await page.locator('.choice-sheet a').count();
          if (choices < 2) throw new Error(`multi-group calendar picker rendered only ${choices} choices`);
          await page.locator('.choice-sheet .icon-button').click();
          report.toolChecks += 1;
        }
      }
    }
    const taskLinks = await page.goto(`${baseUrl}/m/?shell=final-${seed}-${viewport.width}`, { waitUntil: 'domcontentloaded' })
      .then(() => page.locator('.task-shortcuts a').count());
    if (taskLinks < 2) throw new Error(`home has only ${taskLinks} actionable task shortcuts`);
    report.pages += 3;
  } catch (error) {
    report.failures.push({ page: 'shell', viewport: viewport.width, error: error.message });
  } finally {
    await context.close();
  }
}

for (let index = 0; index < selected.length; index += 1) {
  const round = selected[index];
  const viewport = viewports[index % viewports.length];
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const url = `${baseUrl}/m/day/${round.business_date}/${round.source_id}?random=${seed}-${index}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      queueRows: document.querySelectorAll('.queue-row').length,
      pairRows: document.querySelectorAll('.queue-row.pair').length,
      todo: document.querySelector('.queue-modes button')?.textContent?.trim() || ''
    }));
    if (metrics.overflow) throw new Error('horizontal overflow on day queue');
    const dayTargets = await smallTargets(page);
    if (dayTargets.length) throw new Error(`undersized day target: ${JSON.stringify(dayTargets[0])}`);
    if (!metrics.queueRows && Number(round.pending_count || 0) + Number(round.unmatched_count || 0) > 0) {
      throw new Error('day reports work but no actionable queue row is rendered');
    }
    const showMore = page.getByRole('button', { name: /ดูอีก \d+ รายการ/ }).first();
    if (await showMore.count()) {
      const before = await page.locator('.queue-row').count();
      await showMore.click();
      const after = await page.locator('.queue-row').count();
      if (after <= before) throw new Error('show-more button did not reveal additional queue rows');
      report.toolChecks += 1;
    }
    report.pages += 1;
    report.samples.push({ date: round.business_date, source: String(round.source_id).slice(0, 8), viewport: viewport.width, ...metrics });

    const pair = page.locator('.queue-row.pair').first();
    if (await pair.count()) {
      await pair.click();
      await page.locator('.evidence-card').first().waitFor({ state: 'visible' });
      const review = await page.evaluate(() => ({
        cards: document.querySelectorAll('.evidence-card').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasDecision: Boolean(document.querySelector('.decision-banner')),
        hasStickyAction: Boolean(document.querySelector('.sticky-actions'))
      }));
      if (review.cards !== 2) throw new Error(`paired review rendered ${review.cards} evidence cards instead of 2`);
      if (review.overflow || !review.hasDecision || !review.hasStickyAction) throw new Error('paired review is missing a decision surface');
      const reviewTargets = await smallTargets(page);
      if (reviewTargets.length) throw new Error(`undersized review target: ${JSON.stringify(reviewTargets[0])}`);
      report.pairedReviews += 1;
      if (report.pairedReviews === 1) {
        await page.locator('.evidence-card').first().click();
        await page.locator('.image-sheet .viewer').waitFor({ state: 'visible' });
        await page.locator('.image-sheet .icon-button').click();
        await page.getByRole('button', { name: /ดูข้อความแชท/ }).click();
        await page.locator('.chat-sheet').waitFor({ state: 'visible' });
        await page.locator('.chat-sheet .icon-button').click();
        await page.getByRole('button', { name: 'เปลี่ยนคู่' }).click();
        await page.locator('.picker-reference').waitFor({ state: 'visible' });
        const pickerOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (pickerOverflow) throw new Error('candidate picker has horizontal overflow');
        report.toolChecks += 3;
        await page.screenshot({ path: path.join(outputDir, 'candidate-picker.png'), fullPage: false });
      }
    } else {
      const single = page.locator('.queue-row').first();
      if (await single.count()) {
        await single.click();
        await page.locator('.evidence-card').first().waitFor({ state: 'visible' });
        const review = await page.evaluate(() => ({
          cards: document.querySelectorAll('.evidence-card').length,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          hasAction: Boolean(document.querySelector('.sticky-actions'))
        }));
        if (review.cards !== 1 || review.overflow || !review.hasAction) throw new Error('unmatched review is incomplete');
        report.unmatchedReviews += 1;
      }
    }
  } catch (error) {
    report.failures.push({ date: round.business_date, source: String(round.source_id).slice(0, 8), viewport: viewport.width, error: error.message });
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
