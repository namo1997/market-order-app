import { test as base, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { staticServer } from './static-server.mjs';
import { mockAPI, NOW, USER, SESSION } from './mock-api.mjs';
import { DEFAULT_OUT, ssdDirectory } from './ssd-path.mjs';

export const test = base.extend({
  app: async ({ page }, use, testInfo) => {
    const server = await staticServer();
    const errors = [], expectedNetworkErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Chromium emits one console error for intentional HTTP/transport failures.
      // Keep it in evidence; only allow its exact browser-generated form in negative tests.
      const text = message.text();
      if (/^Failed to load resource: (the server responded with a status of (401|403|404|409|422|429|503)\b|net::ERR_INTERNET_DISCONNECTED)/.test(text)
        && message.location().url.includes('/api/')) expectedNetworkErrors.push({ text, url: new URL(message.location().url).pathname });
      else errors.push(text);
    });
    // Fixed Date, normal timers: drawing, debounce and saving feedback still run.
    await page.clock.setFixedTime(new Date(NOW));
    const directory = ssdDirectory(path.join(process.env.E2E_OUT || DEFAULT_OUT, 'screens', `round-${process.env.E2E_ROUND || 'manual'}`, testInfo.project.name, testInfo.title.replace(/[^a-zA-Z0-9-]+/g, '-')));
    let api;
    const app = {
      page, server, errors, expectedNetworkErrors,
      get api() { return api; },
      async start(initialDocument = null, { login = false } = {}) {
        api = await mockAPI(page, server.url, initialDocument);
        if (!login) await page.addInitScript(({ user, session }) => {
          if (!sessionStorage.getItem('e2e.session.seeded')) {
            sessionStorage.setItem('token', session); sessionStorage.setItem('user', JSON.stringify(user));
            sessionStorage.setItem('e2e.session.seeded', '1');
          }
        }, { user: USER, session: SESSION });
        await page.goto(`${server.url}${login ? '/login' : '/receiving'}`);
        if (!login) await expect(page.getByRole('heading', { name: 'รับสินค้า', exact: true })).toBeVisible();
      },
      async shot(name) { await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true }); },
      async audit(name) {
        const result = await new AxeBuilder({ page }).include('.rc-app').analyze();
        await fs.writeFile(path.join(directory, `${name}-axe.json`), JSON.stringify(result.violations, null, 2));
        expect.soft(result.violations.filter(v => ['serious', 'critical'].includes(v.impact)), `${name}: axe serious/critical`).toEqual([]);
      },
      async layout(name) {
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`).toBe(true);
        const primary = page.locator('dialog[open] .sg-primary:visible, .sg-bar .sg-primary:visible');
        for (const button of await primary.all()) {
          const box = await button.boundingBox();
          expect.soft(box?.height, `${name}: primary touch height`).toBeGreaterThanOrEqual(48);
          expect.soft(box?.width, `${name}: primary touch width`).toBeGreaterThanOrEqual(48);
          if (page.viewportSize().width < 760) {
            expect.soft(box?.y + box?.height, `${name}: primary inside viewport`).toBeLessThanOrEqual(page.viewportSize().height);
            expect.soft(box?.y, `${name}: primary near bottom`).toBeGreaterThan(page.viewportSize().height - 200);
          }
        }
      },
    };
    try { await use(app); }
    finally {
      await fs.writeFile(path.join(directory, 'browser-evidence.json'), JSON.stringify({ errors, expectedNetworkErrors, unexpected: api?.unexpected, blocked: api?.blocked,
        calls: api?.calls.map(c => ({ method: c.method, path: c.path })) }, null, 2));
      expect.soft(errors, 'No unexpected console errors / page errors').toEqual([]);
      expect.soft(api?.unexpected || [], 'All API requests are explicitly mocked').toEqual([]);
      expect.soft(api?.blocked || [], 'No external network requests').toEqual([]);
      if (!/errors|offline|retry/.test(testInfo.title)) expect.soft(expectedNetworkErrors, 'No console errors in successful flow').toEqual([]);
      await page.close(); await server.close();
    }
  },
});
export { expect };

export async function openDocument(app) {
  const { page } = app;
  await page.getByRole('radio', { name: 'เอกสาร', exact: true }).check();
  await page.getByRole('radio', { name: 'ผู้ขายทดสอบ', exact: true }).check();
  await page.getByRole('button', { name: 'เปิดเอกสาร', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ผู้ขายทดสอบ', exact: true })).toBeVisible();
}
export async function moreAction(page, value) {
  await page.getByRole('button', { name: 'รายละเอียด', exact: true }).click();
  await page.getByRole('combobox', { name: 'ทำรายการ', exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'เลือก', exact: true }).click();
}
export async function sign(page) {
  await page.getByRole('radio', { name: 'เซ็น', exact: true }).check();
  const canvas = page.getByRole('img', { name: 'ช่องลงผู้รับ', exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 65); await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 110, { steps: 8 });
  await page.mouse.move(box.x + 110, box.y + 55, { steps: 8 }); await page.mouse.up();
}
