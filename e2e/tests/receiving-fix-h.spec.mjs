import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { staticServer } from '../support/static-server.mjs';
import { ssdDirectory } from '../support/ssd-path.mjs';

const user = { id: 12, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 1, department_id: 10 };
const parts = (a = '6', b = '4') => [
  { order_item_id: 50, department_id: 10, department_name: 'ครัว', quantity_ordered: '6', quantity_received: a },
  { order_item_id: 60, department_id: 30, department_name: 'สโตร์', quantity_ordered: '4', quantity_received: b },
];
const line = (patch = {}) => ({ id: 1, line_no: 1, product_id: 7, product_name: 'ขา B', bill_text: 'ขา B', order_item_id: 50,
  counted_quantity: '10', quantity_received: '10', quantity_billed: '10', quantity_ordered: '10',
  unit_id: 2, unit_text: 'กก.', unit_price: '20', amount: '200', match: { source: 'order', confidence: 1 },
  review_decision: null, departments: parts(), ...patch });

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
  for (const colorScheme of ['light', 'dark']) test.describe(`H mobile ${viewport.width}x${viewport.height} ${colorScheme}`, () => {
    test.use({ viewport, colorScheme });
    test('H1-H3 branch comparison, edited allocation, pre-sign and signing use visible quantities', async ({ page }) => {
      const server = await staticServer();
      const errors = [], unexpected = [], calls = [];
      const directory = ssdDirectory(path.join(process.env.E2E_OUT, 'screens', `round-${process.env.E2E_ROUND}`, `${viewport.width}-${colorScheme}`));
      let doc = { id: 501, scope: 'branch', status: 'draft', kind: 'bill', branch_id: 1, department_id: 10,
        counted_complete_at: '2026-10-19T00:00:00Z', supplier_name_text: 'ร้านทดสอบ', delivery_date: '2026-10-19',
        images: [], warnings: [{ code: 'LOW_CONFIDENCE', line_no: 3 }], ocr: { status: 'done', confidence: 0.99, warnings: [] },
        has_receiver_signature: false, created_at: '2026-10-19T00:00:00Z', lines: [line(),
          line({ id: 2, line_no: 2, product_id: 8, order_item_id: 70, departments: parts().map((p, i) => ({ ...p, order_item_id: 70 + i * 10 })), product_name: 'ปีกกลาง', bill_text: '', quantity_billed: null, unit_price: null, amount: null, review_decision: 'missing_bill' }),
          line({ id: 3, line_no: 3, product_id: 9, order_item_id: 90, departments: parts().map((p, i) => ({ ...p, order_item_id: 90 + i * 10 })), product_name: 'สินค้าชื่อยาวสำหรับตรวจการตัดบรรทัดบนหน้าจอมือถือ', match: { source: 'order', confidence: 0.3 }, review_decision: 'accept' })] };
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.clock.setFixedTime(new Date('2026-10-19T08:00:00Z'));
      await page.addInitScript(({ user, colorScheme }) => {
        sessionStorage.setItem('token', 'SYNTHETIC-local-session');
        sessionStorage.setItem('user', JSON.stringify(user));
        document.documentElement.dataset.theme = colorScheme;
      }, { user, colorScheme });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url()), method = route.request().method();
        if (!url.pathname.startsWith('/api/')) {
          if (url.origin === server.url) return route.continue();
          unexpected.push(`${method} ${url.origin}${url.pathname}`); return route.abort();
        }
        const headers = { 'access-control-allow-origin': server.url, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        calls.push(`${method} ${url.pathname}`);
        let data;
        if (url.pathname === '/api/auth/me') data = user;
        else if (url.pathname === '/api/receiving-documents/expected') data = [];
        else if (url.pathname === '/api/receiving-documents') data = [doc];
        else if (url.pathname === '/api/receiving-followups') data = { items: [], pending_count: 0 };
        else if (url.pathname === '/api/receiving-documents/501') {
          if (method === 'PUT') {
            const body = route.request().postDataJSON();
            doc = { ...doc, lines: doc.lines.map(row => { const patch = body.lines.find(p => p.id === row.id);
              return { ...row, ...patch, ...(patch?.quantity_received === '5.00' ? { departments: parts('3', '2') } : {}) }; }) };
          }
          data = doc;
        } else { unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 500, headers, json: {} }); }
        return route.fulfill({ status: 200, headers, json: { success: true, data } });
      });
      const capture = async name => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`).toBe(true);
        await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
        for (const button of await page.locator('.ra-footer .sg-primary:visible').all()) {
          const box = await button.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(48);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
      };
      try {
        await page.goto(`${server.url}/receiving`);
        await page.getByRole('radio', { name: 'ทั้งสาขา', exact: true }).check();
        await page.getByRole('button', { name: 'ดูเอกสาร', exact: true }).click();
        await page.getByRole('button', { name: 'เปิดเอกสาร #501 ร้านทดสอบ ร่าง', exact: true }).click();
        const row = page.locator('#review-row-1');
        const allocation = row.locator('details.ra-allocation > summary');
        await expect(allocation).toHaveText('แยกแผนก · ครัว 6 กก. · สโตร์ 4 กก.');
        await expect(row.locator('details.ra-allocation')).not.toHaveAttribute('open', '');
        await expect(page.locator('#review-row-2')).not.toContainText('อ่านบิลได้ไม่ชัด');
        await expect(page.locator('#review-row-2')).toContainText('ไม่มีในบิล');
        await expect(page.locator('#review-row-3')).toContainText('อ่านบิลได้ไม่ชัด');
        await capture('01-comparison');
        await row.getByRole('button', { name: 'แก้ข้อมูล ขา B', exact: true }).click();
        await page.getByRole('textbox', { name: 'แก้จำนวนหลังเปิดบิล ขา B', exact: true }).fill('5');
        await expect(allocation).toContainText('บันทึกการตัดสินใจเพื่ออัปเดต');
        await capture('02-unsaved');
        await row.getByRole('button', { name: 'รับ 5 กก. · แจ้งร้านขาด 5 กก.', exact: true }).click();
        await expect(allocation).toHaveText('แยกแผนก · ครัว 3 กก. · สโตร์ 2 กก.');
        await page.getByRole('button', { name: 'ดูสรุปก่อนเซ็น', exact: true }).click();
        await expect(page.locator('p.ra-allocation').first()).toHaveText('ขา B 5 กก. → ครัว 3 กก. · สโตร์ 2 กก.');
        await capture('03-summary');
        await page.getByRole('button', { name: 'ไปเซ็นรับของ', exact: true }).click();
        await capture('04-signing');
        await page.locator('.ra-sign-summary > details > summary').click();
        await expect(page.locator('p.ra-allocation').first()).toBeVisible();
        await expect(page.locator('p.ra-allocation').first()).toHaveText('ขา B 5 กก. → ครัว 3 กก. · สโตร์ 2 กก.');
        await capture('05-signing-details');
        expect(calls.filter(call => call.startsWith('PUT '))).toHaveLength(1);
        expect(errors).toEqual([]); expect(unexpected).toEqual([]);
      } finally {
        await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ viewport, colorScheme, errors, unexpected, calls }, null, 2));
        await page.close(); await server.close();
      }
    });
  });
}
