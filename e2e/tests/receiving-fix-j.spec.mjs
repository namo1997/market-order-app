import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { staticServer } from '../support/static-server.mjs';
import { ssdDirectory } from '../support/ssd-path.mjs';
const user = { id: 12, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 1, department_id: 10 };
for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) for (const colorScheme of ['light', 'dark']) {
  test.describe(`J mobile ${viewport.width} ${colorScheme}`, () => {
    test.use({ viewport, colorScheme });
    test('J1-J3 visible followup, duplicate count redirect and manual receipt without OCR through signing', async ({ page }) => {
      const server = await staticServer(); const errors = [], unexpected = [], calls = [];
      const directory = ssdDirectory(path.join(process.env.E2E_OUT, `round-${process.env.E2E_ROUND}`, `${viewport.width}-${colorScheme}`));
      let doc = { id: 501, client_uuid: 'round-j', scope: 'department', status: 'draft', kind: 'manual_receipt', supplier_name_text: 'ร้านทดสอบ', counted_complete_at: null, images: [], ocr: { status: 'locked' }, warnings: [], lines: [{ id: 1, line_no: 1, product_id: 7, product_name: 'อกไก่', order_item_id: 50, unit_text: 'กก.', counted_quantity: null }] };
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-10-19T08:00:00Z'));
      await page.addInitScript(({ user, colorScheme }) => { sessionStorage.setItem('token', 'SYNTHETIC-local-session'); sessionStorage.setItem('user', JSON.stringify(user)); document.documentElement.dataset.theme = colorScheme; }, { user, colorScheme });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url()), method = route.request().method();
        if (!url.pathname.startsWith('/api/')) { if (url.origin === server.url) return route.continue(); unexpected.push(url.origin + url.pathname); return route.abort(); }
        const headers = { 'access-control-allow-origin': server.url, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        calls.push(`${method} ${url.pathname}`); let data;
        if (url.pathname === '/api/receiving-documents/501/signatures/receiver' && method === 'GET') return route.fulfill({ status: 200, headers, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=', 'base64') });
        if (url.pathname === '/api/auth/me') data = user;
        else if (url.pathname === '/api/receiving-documents/expected') data = [{ supplier_key: 'pg:1', supplier_name: 'ร้านทดสอบ', items: [{ order_item_id: 50, product_id: 7, product_name: 'อกไก่', has_pending: true, unit_name: 'กก.' }] }];
        else if (url.pathname === '/api/receiving-followups') data = method === 'POST' ? { created: false, followup: { created_at: '2026-10-19T08:00:00Z' } } : { items: [], pending_count: 0 };
        else if (url.pathname === '/api/products') data = [{ id: 7, name: 'อกไก่', unit_name: 'กก.' }, { id: 8, name: 'ขา B', unit_name: 'กก.' }];
        else if (url.pathname === '/api/receiving-documents') data = [doc];
        else if (url.pathname === '/api/receiving-documents/501') data = doc;
        else if (url.pathname === '/api/receiving-documents/501/count') {
          const body = route.request().postDataJSON();
          doc = { ...doc, counted_complete_at: '2026-10-19T08:00:00Z', ocr: { status: 'none' }, lines: doc.lines.map(row => ({ ...row, quantity_ordered: '10', quantity_received: body.lines.find(l => l.id === row.id).counted_quantity, counted_quantity: body.lines.find(l => l.id === row.id).counted_quantity, review_decision: 'missing_bill', match: { source: 'order' } })) }; data = doc;
        } else if (url.pathname === '/api/receiving-documents/501/signatures' && method === 'POST') { doc = { ...doc, has_receiver_signature: true }; data = doc; }
        else if (url.pathname === '/api/receiving-documents/501/confirm') { doc = { ...doc, status: 'confirmed' }; data = doc; }
        else { unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 500, headers, json: {} }); }
        return route.fulfill({ status: 200, headers, json: { success: true, data } });
      });
      const capture = async name => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
        for (const footer of await page.locator('.ra-footer:visible').all()) { const box = await footer.boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1); }
      };
      try {
        await page.goto(`${server.url}/receiving`);
        await page.getByRole('button', { name: 'ตามของ ร้านทดสอบ', exact: true }).click();
        await page.getByRole('button', { name: 'แจ้งบัญชี', exact: true }).click();
        const feedback = page.locator('.rc-followup-feedback'); await expect(feedback).toContainText('แจ้งไปแล้ว เวลา');
        const a = await feedback.boundingBox(), b = await page.locator('.rc-receiving-actions').boundingBox(); expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y + a.height).toBeLessThan(b.y);
        await capture('01-followup');
        await page.getByRole('button', { name: 'ดูเอกสาร', exact: true }).click();
        await page.getByRole('button', { name: 'เปิดเอกสาร #501 ร้านทดสอบ ร่าง', exact: true }).click();
        await expect(page.locator('.ra-steps')).toHaveText('นับของสรุปเซ็นรับ');
        await expect(page.getByRole('button', { name: 'ยืนยันการนับ', exact: true })).toBeDisabled();
        await page.getByRole('textbox', { name: 'นับได้ อกไก่', exact: true }).fill('4.5');
        await page.getByRole('button', { name: 'เพิ่มสินค้าที่มาส่ง', exact: true }).click();
        await page.getByRole('searchbox', { name: 'ค้นหาสินค้า', exact: true }).fill('ไก่');
        await expect(page.getByRole('button', { name: 'อกไก่ · มีในใบแล้ว · ไปช่องนับเดิม', exact: true })).toBeVisible(); await capture('02-existing-product');
        await page.getByRole('button', { name: 'อกไก่ · มีในใบแล้ว · ไปช่องนับเดิม', exact: true }).click();
        await expect(page.locator('.ra-count-row')).toHaveCount(1); await expect(page.locator('#count-1')).toBeFocused(); await expect(page.locator('#count-1')).toHaveValue('4.5');
        await capture('03-count');
        await page.getByRole('button', { name: 'ยืนยันการนับ', exact: true }).click();
        await expect(page.locator('.ra-document')).toHaveAttribute('data-step', 'summary');
        await expect(page.getByRole('region', { name: 'สรุปก่อนเซ็น' })).toContainText('สั่ง 10 กก.');
        await expect(page.locator('.ra-document')).not.toContainText('ยอดบิล'); await capture('04-summary');
        await page.getByRole('button', { name: 'ไปเซ็นรับของ', exact: true }).click(); await capture('05-sign');
        const canvas = page.locator('canvas').first(), box = await canvas.boundingBox();
        await page.mouse.move(box.x + 15, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 85, box.y + 40, { steps: 8 }); await page.mouse.up();
        await page.getByRole('button', { name: 'บันทึกเซ็น', exact: true }).first().click();
        await expect(page.getByRole('button', { name: 'ยืนยันรับสินค้า', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'ยืนยันรับสินค้า', exact: true }).click(); await expect(page.getByLabel('รับของสำเร็จ')).toBeVisible(); await capture('06-success');
        expect(calls.some(c => /ocr|images/.test(c))).toBe(false); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
      } finally { await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify({ viewport, colorScheme, errors, unexpected, calls }, null, 2)); await page.close(); await server.close(); }
    });
  });
}
