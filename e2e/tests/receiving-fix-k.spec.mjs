import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { staticServer } from '../support/static-server.mjs';
import { ssdDirectory } from '../support/ssd-path.mjs';

const user = { id: 12, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 1, department_id: 10 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=', 'base64');
for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) for (const colorScheme of ['light', 'dark']) {
  test.describe(`K mobile ${viewport.width} ${colorScheme}`, () => {
    test.use({ viewport, colorScheme });
    test('K2-K5 resume, deferred capture, zero delivery and explicit over-order through confirmation', async ({ page }) => {
      const server = await staticServer(); const errors = [], unexpected = [], calls = [];
      const directory = ssdDirectory(path.join(process.env.E2E_OUT, `${viewport.width}-${colorScheme}`));
      let doc = { id: 5, client_uuid: 'round-k', branch_id: 1, department_id: 10, scope: 'department', product_group_id: 3,
        status: 'draft', kind: 'bill', delivery_date: '2026-10-20', supplier_name_text: 'ร้านไก่', counted_complete_at: null,
        images: [], ocr: { status: 'locked' }, warnings: [], lines: ['ปีกกลาง', 'อกไก่'].map((product_name, i) => ({
          id: i + 1, product_id: i + 7, order_item_id: i + 50, product_name, line_no: i + 1, unit_text: 'กิโลกรัม', counted_quantity: null, match: { source: 'order' } })) };
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
      await page.addInitScript(({ user, colorScheme }) => { sessionStorage.setItem('token', 'SYNTHETIC-local-session'); sessionStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('solao.receiving.theme.v1', colorScheme); document.documentElement.dataset.theme = colorScheme; }, { user, colorScheme });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url()), method = route.request().method();
        if (!url.pathname.startsWith('/api/')) { if (url.origin === server.url) return route.continue(); unexpected.push(url.origin + url.pathname); return route.abort(); }
        const headers = { 'access-control-allow-origin': server.url, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        calls.push(`${method} ${url.pathname}`); let data;
        if (/\/images\/\d+$|\/signatures\/receiver$/.test(url.pathname)) return route.fulfill({ headers, contentType: 'image/png', body: png });
        if (url.pathname === '/api/auth/me') data = user;
        else if (url.pathname === '/api/receiving-documents/expected') data = [{ supplier_key: 'pg:3', supplier_name: 'ร้านไก่', items: doc.lines.map(row => ({ ...row, has_pending: true, unit_name: 'กิโลกรัม' })) }];
        else if (url.pathname === '/api/receiving-followups') data = { items: [], pending_count: 0 };
        else if (url.pathname === '/api/receiving-documents') { expect(method).toBe('GET'); data = [doc]; }
        else if (url.pathname.endsWith('/5/images') && method === 'POST') { doc = { ...doc, images: [{ id: 9, page_no: 1 }] }; data = { image_id: 9 }; }
        else if (url.pathname.endsWith('/5/count')) {
          const body = route.request().postDataJSON(); doc = { ...doc, counted_complete_at: '2026-10-20T03:00:00Z', ocr: { status: 'done' }, total: '2400',
            lines: doc.lines.map((row, i) => ({ ...row, counted_quantity: body.lines[i].counted_quantity, quantity_received: body.lines[i].counted_quantity,
              quantity_billed: i ? null : '40', quantity_ordered: i ? '5' : '10', unit_price: i ? null : '60', amount: i ? null : '2400' })) }; data = doc;
        } else if (url.pathname.endsWith('/5/signatures') && method === 'POST') { doc = { ...doc, has_receiver_signature: true }; data = doc; }
        else if (url.pathname.endsWith('/5/confirm')) { doc = { ...doc, status: 'confirmed' }; data = doc; }
        else if (url.pathname.endsWith('/5')) {
          if (method === 'PUT') { const body = route.request().postDataJSON(); doc = { ...doc, ...body, lines: body.lines.map(row => ({ ...doc.lines.find(old => old.id === row.id), ...row })) }; }
          data = doc;
        } else { unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 500, headers, json: {} }); }
        return route.fulfill({ status: 200, headers, json: { success: true, data } });
      });
      const capture = async name => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
      };
      try {
        await page.goto(`${server.url}/receiving`);
        // Scan-first: the footer reuses the existing draft #5 and opens the scanner (no resume sheet).
        await page.getByRole('button', { name: 'สแกนบิล ร้านไก่', exact: true }).click();
        await expect(page.getByRole('button', { name: 'สแกนบิลอีกครั้ง', exact: true })).toBeVisible(); await capture('01-resume');
        await page.getByLabel('รูปบิล', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
        await expect(page.getByRole('status').filter({ hasText: 'แนบบิล 1 หน้าแล้ว' })).toContainText('จะอ่านหลังนับครบ'); await capture('02-capture');
        await page.getByRole('textbox', { name: 'นับได้ ปีกกลาง', exact: true }).fill('40');
        await page.getByRole('textbox', { name: 'นับได้ อกไก่', exact: true }).fill('0');
        await page.getByRole('button', { name: 'กลับคิว', exact: true }).click();
        await expect(page.getByRole('dialog')).toContainText('มีข้อมูลที่ยังไม่ส่ง'); await capture('03-leave-guard');
        await page.getByRole('button', { name: 'ทำต่อใบเดิม', exact: true }).click(); await expect(page.locator('#count-1')).toHaveValue('40');
        await page.getByRole('button', { name: 'ยืนยันการนับและเทียบบิล', exact: true }).click();
        await expect(page.getByRole('button', { name: 'ยืนยันทั้งหมดที่ตรง', exact: true })).toBeDisabled();
        await expect(page.locator('#review-row-1')).toContainText('เกินจากใบสั่ง 30 กิโลกรัม (ข้อมูลประกอบ)');
        await page.locator('#review-row-1').scrollIntoViewIfNeeded(); await capture('04-over-order');
        await page.locator('#review-row-2').scrollIntoViewIfNeeded();
        await expect(page.locator('#review-row-2')).not.toContainText('ขอบิลจากร้าน'); await expect(page.locator('#review-row-2')).not.toContainText('คืนร้าน 0'); await capture('05-not-delivered');
        await page.getByRole('button', { name: 'ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)', exact: true }).click();
        await page.getByRole('button', { name: 'ยืนยันรับเกินใบสั่ง 40 กิโลกรัม', exact: true }).click();
        await page.getByRole('button', { name: 'ดูสรุปก่อนเซ็น', exact: true }).click(); await capture('06-summary');
        await page.getByRole('button', { name: 'ไปเซ็นรับของ', exact: true }).click();
        const canvas = page.locator('canvas').first(), box = await canvas.boundingBox();
        await page.mouse.move(box.x + 15, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 85, box.y + 40, { steps: 8 }); await page.mouse.up();
        await page.getByRole('button', { name: 'บันทึกเซ็น', exact: true }).first().click();
        await page.getByRole('button', { name: 'ยืนยันรับสินค้า', exact: true }).click();
        await expect(page.getByLabel('รับของสำเร็จ')).toBeVisible(); await capture('07-success');
        expect(doc.lines.map(l => l.review_decision)).toEqual(['over_order', 'not_delivered']);
        expect(calls.some(c => c === 'POST /api/receiving-documents')).toBe(false); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
      } finally { await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ viewport, colorScheme, errors, unexpected, calls }, null, 2)); await page.close(); await server.close(); }
    });
  });
}
