import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = String(process.env.BUTTON_AUDIT_BASE_URL || 'http://127.0.0.1:8020').replace(/\/$/, '');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('artifacts/button-form-audit');
const get = async (route) => {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  return (await response.json()).data || [];
};
const dateOf = (row) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(Number(row.event_timestamp_ms || Date.parse(row.created_at))));
const amount = (row) => Number(row.bill_total_value || row.slip_amount_value || row.announced_amount || 0);
const liveUnmatched = (row, category) => row.category === category
  && !['pending', 'manual_review', 'confirmed'].includes(String(row.match_status))
  && !['duplicate', 'unsent'].includes(String(row.status));

const [items, matches, days] = await Promise.all([
  get('/api/admin/items?start=2026-07-01&end=2026-08-31&limit=5000&live=1'),
  get('/api/admin/matches?limit=5000'),
  get('/api/admin/days?start=2026-07-01&end=2026-08-31')
]);
const byId = new Map(items.map((row) => [Number(row.id), row]));
const bills = items.filter((row) => liveUnmatched(row, 'bill') && amount(row) > 0);
const slips = items.filter((row) => liveUnmatched(row, 'transfer') && amount(row) > 0);
const other = items.find((row) => liveUnmatched(row, 'other'));
const bill = bills.find((candidate) => slips.some((slip) => slip.source_id === candidate.source_id
  && Math.abs((new Date(dateOf(slip)) - new Date(dateOf(candidate))) / 86_400_000) <= 31)) || bills[0];
const slip = slips[0];
const exactMatch = matches.find((row) => ['pending', 'manual_review'].includes(String(row.status)) && !row.is_group
  && amount(byId.get(Number(row.bill_item_id)) || {}) > 0
  && Math.abs(amount(byId.get(Number(row.bill_item_id)) || {}) - amount(byId.get(Number(row.slip_item_id)) || {})) < 0.01);
const exactBill = exactMatch && byId.get(Number(exactMatch.bill_item_id));
const exactSlip = exactMatch && byId.get(Number(exactMatch.slip_item_id));
const groupDay = (() => {
  const buckets = new Map();
  for (const row of [...bills, ...slips]) {
    const key = `${dateOf(row)}:${row.source_id}`;
    const value = buckets.get(key) || { date: dateOf(row), source: row.source_id, bills: 0, slips: 0 };
    if (row.category === 'bill') value.bills += 1;
    if (row.category === 'transfer') value.slips += 1;
    buckets.set(key, value);
  }
  return [...buckets.values()].find((row) => row.bills && row.slips);
})();
const openDay = days.find((row) => row.closing_status !== 'closed');
if (!bill || !slip || !other || !exactMatch || !exactBill || !exactSlip || !groupDay || !openDay) {
  throw new Error('Form audit fixture is incomplete');
}

const itemUrl = (row, bucket) => `/m2/review/item/${row.id}?date=${dateOf(row)}&source=${row.source_id}&bucket=${bucket}&item=${row.id}`;
const scenarios = [];
const add = (name, url, run) => scenarios.push({ name, url, run });

const expectDecision = async (page, action) => {
  await action();
  const dialog = page.locator('.decision-sheet-backdrop:visible');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const options = dialog.locator('.decision-sheet-options button');
  if (await options.count() < 3) throw new Error('decision dialog has too few reason choices');
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await dialog.waitFor({ state: 'detached' });
};

add('edit bill amount', itemUrl(bill, 'bill'), async (page) => {
  await page.getByRole('button', { name: 'แก้ยอดบิล' }).click();
  const input = page.locator('.form-sheet input[inputmode="decimal"]');
  await input.fill(String((amount(bill) + 0.01).toFixed(2)));
  await expectDecision(page, () => page.getByRole('button', { name: 'บันทึกยอดบิล' }).click());
});
add('edit slip amount', itemUrl(slip, 'slip'), async (page) => {
  await page.getByRole('button', { name: 'แก้ยอดสลิป' }).click();
  await page.locator('.form-sheet input[inputmode="decimal"]').fill(String((amount(slip) + 0.01).toFixed(2)));
  await expectDecision(page, () => page.getByRole('button', { name: 'บันทึกยอดสลิป' }).click());
});
add('classify bill as other with reason', itemUrl(bill, 'bill'), async (page) => {
  await page.getByRole('button', { name: 'ไม่ใช่บิล' }).click();
  await page.locator('.form-sheet textarea').first().fill('รูปนี้เป็นข้อความสนทนาทดสอบ ไม่ใช่เอกสารการเงิน');
  await page.locator('.learn-toggle input').uncheck();
  await expectDecision(page, () => page.getByRole('button', { name: 'บันทึกโดยไม่สอน AI' }).click());
});
add('classify slip as other with reason', itemUrl(slip, 'slip'), async (page) => {
  await page.getByRole('button', { name: 'ไม่ใช่สลิป' }).click();
  await page.locator('.form-sheet textarea').first().fill('รูปนี้ไม่ใช่หลักฐานการโอนเงิน');
  await page.locator('.learn-toggle input').uncheck();
  await expectDecision(page, () => page.getByRole('button', { name: 'บันทึกโดยไม่สอน AI' }).click());
});
add('cash payment', itemUrl(bill, 'bill'), async (page) => {
  await page.getByRole('button', { name: /เงินสด/ }).click();
  await page.getByLabel('ชื่อผู้รับเงิน').fill('ผู้รับเงินทดสอบ');
  await page.getByLabel('หมายเหตุ').fill('ทดสอบเส้นทางบันทึกเงินสด');
  await expectDecision(page, () => page.getByRole('button', { name: 'ยืนยันชำระเงินสด' }).click());
});
add('transfer request preview and guard', itemUrl(bill, 'bill'), async (page) => {
  await page.getByRole('button', { name: 'แจ้งให้โอนในกลุ่ม' }).click();
  const image = page.locator('.transfer-message-preview img');
  await image.waitFor({ state: 'visible' });
  if (!await image.evaluate((node) => node.complete && node.naturalWidth > 0)) throw new Error('transfer preview image did not load');
  await page.locator('.transfer-check input').check();
  await expectDecision(page, () => page.getByRole('button', { name: 'ยืนยันส่งรูปและข้อความ' }).click());
});
add('receipt substitute', itemUrl(slip, 'slip'), async (page) => {
  await page.getByRole('button', { name: 'สร้างใบแทนใบเสร็จรับเงิน' }).click();
  const inputs = page.locator('.form-sheet input');
  if (!await inputs.nth(0).inputValue()) await inputs.nth(0).fill('ผู้รับเงินทดสอบ');
  if (!await page.locator('.form-sheet textarea').inputValue()) await page.locator('.form-sheet textarea').fill('ค่าใช้จ่ายทดสอบ');
  await expectDecision(page, () => page.getByRole('button', { name: 'สร้างและปิดหลักฐาน' }).click());
});
add('split batch payment', itemUrl(other, 'other'), async (page) => {
  await page.getByRole('button', { name: 'แยกรายการจ่ายหลายราย' }).click();
  await page.locator('.batch-line').first().locator('input').nth(0).fill('ซัพพลายเออร์ทดสอบ');
  await page.locator('.batch-line').first().locator('input').nth(1).fill('100');
  await page.getByRole('button', { name: 'เพิ่มแถว' }).click();
  await expectDecision(page, () => page.getByRole('button', { name: 'บันทึกรายการแยก' }).click());
});
add('candidate image and choose', itemUrl(bill, 'bill'), async (page) => {
  await page.getByRole('button', { name: /เลือกสลิป$/ }).click();
  const cards = page.locator('.candidate-card');
  await cards.first().waitFor({ state: 'visible', timeout: 5000 });
  const loaded = await cards.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0));
  if (!loaded) throw new Error('candidate evidence image did not load');
  await page.getByRole('button', { name: /ค้นหา ±7 วัน/ }).click();
  await page.getByLabel('รวมทุกกลุ่ม').check();
  await expectDecision(page, () => cards.first().getByRole('button', { name: /เลือกสลิปนี้/ }).click());
});
add('multi-document group', `/m2/group/${groupDay.date}/${groupDay.source}`, async (page) => {
  const columns = page.locator('.picker-column');
  await columns.nth(0).locator('input[type="checkbox"]').first().check();
  await columns.nth(1).locator('input[type="checkbox"]').first().check();
  await expectDecision(page, () => page.getByRole('button', { name: /สร้างรายการรวมเพื่อตรวจ/ }).click());
});
add('confirm exact match', `/m2/review/match/${exactMatch.id}?date=${dateOf(exactSlip)}&source=${exactBill.source_id}&bucket=review&item=${exactBill.id}`, async (page) => {
  const confirm = page.getByRole('button', { name: /ยืนยัน/ }).last();
  if (await confirm.isDisabled()) throw new Error('exact amount match confirm is disabled');
  await expectDecision(page, () => confirm.click());
});
add('close day', `/m2/day/${openDay.business_date}/${openDay.source_id}`, async (page) => {
  await expectDecision(page, () => page.getByRole('button', { name: 'ปิดรอบวันนี้' }).click());
});

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];
for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const businessWrites = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(`console: ${message.text()}`);
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.on('request', (request) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (/\/(decision-contexts|decisions\/[^/]+\/cancel|category-learning\/review)$/.test(pathname)) return;
    businessWrites.push(`${request.method()} ${pathname}`);
  });
  try {
    await page.goto(`${baseUrl}${scenario.url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await scenario.run(page);
    await page.waitForTimeout(150);
    if (businessWrites.length) throw new Error(`business mutation escaped cancellation: ${businessWrites.join(', ')}`);
    if (errors.length) throw new Error(errors.join(' | '));
    results.push({ scenario: scenario.name, status: 'passed' });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `${scenario.name.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: true }).catch(() => {});
    results.push({ scenario: scenario.name, status: 'failed', error: error.message });
  } finally {
    await context.close();
  }
}
await browser.close();
await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify({ baseUrl, results }, null, 2));
const failed = results.filter((row) => row.status === 'failed');
console.log(JSON.stringify({ scenarios: results.length, passed: results.length - failed.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
