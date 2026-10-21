import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { staticServer } from '../support/static-server.mjs';
import { ssdDirectory } from '../support/ssd-path.mjs';
const user = { id: 12, name: 'ผู้รับทดสอบ', role: 'user', branch_id: 1, department_id: 10 };
const supplier = { supplier_key: 'sm:1', supplier_master_id: 1, product_group_id: null, name: 'ร้านน้ำแข็ง vic', code: 'SYN-VIC' };
for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) for (const colorScheme of ['light', 'dark']) {
 test.describe(`M mobile ${viewport.width} ${colorScheme}`, () => {
  test.use({ viewport, colorScheme });
  test('M1-M5 no-order supplier search, empty count, suggestions, explicit count and confirmation; Thai date and resume arrow', async ({ page }) => {
   const server = await staticServer(), errors = [], unexpected = [], calls = [];
   const dir = ssdDirectory(path.join(process.env.E2E_OUT, `${viewport.width}-${colorScheme}`));
   let doc, createBody, searchFails = true, productsFail = true;
   const ordered = { id: 20, supplier_name_text: 'ร้านไก่', product_group_id: 3, scope: 'department', branch_id: 1, department_id: 10,
    kind: 'bill', status: 'draft', delivery_date: '2026-10-20', lines: [], images: [], warnings: [] };
   page.on('pageerror', e => errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
   await page.addInitScript(({ user, colorScheme }) => { sessionStorage.setItem('token', 'SYNTHETIC-local-session'); sessionStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('solao.receiving.theme.v1', colorScheme); document.documentElement.dataset.theme = colorScheme; }, { user, colorScheme });
   await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (!url.pathname.startsWith('/api/')) { if (url.origin === server.url) return route.continue(); unexpected.push(url.origin + url.pathname); return route.abort(); }
    const headers = { 'access-control-allow-origin': server.url, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const ok = data => route.fulfill({ status: 200, headers, json: { success: true, data } });
    const fail = () => route.fulfill({ status: 503, headers, json: { success: false, code: 'RECEIVING_NOT_READY' } });
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/auth/me') return ok(user);
    if (url.pathname === '/api/receiving-followups') return ok({ items: [], pending_count: 0 });
    if (url.pathname === '/api/receiving-documents/expected') return ok([{ supplier_key: 'pg:3', supplier_name: 'ร้านไก่', items: [{ order_item_id: 50, product_id: 10, product_name: 'ขา B', has_pending: true, unit_name: 'กิโลกรัม' }] }]);
    if (url.pathname === '/api/receiving-documents/suppliers') {
     expect(url.searchParams.get('branch_id')).toBe('1'); expect(url.searchParams.get('department_id')).toBe('10');
     if (searchFails) return fail();
     return ok(url.searchParams.get('q')?.includes('ร้านใหม่') ? [] : [supplier]);
    }
    if (url.pathname === '/api/receiving-documents/supplier-products') {
     expect(url.searchParams.get('supplier_key')).toBe('sm:1');
     if (productsFail) return fail();
     return ok([{ id: 7, name: 'น้ำแข็งหลอดใหญ่', unit_id: 2, unit_name: 'ถุง' }, { id: 8, name: 'น้ำแข็งสำหรับกาแฟ', unit_id: 2, unit_name: 'ถุง' }]);
    }
    if (url.pathname === '/api/receiving-documents') {
     if (method === 'GET') return ok(doc ? [ordered, doc] : [ordered]);
     createBody = route.request().postDataJSON(); expect(createBody.supplier_master_id).toBe(1); expect(createBody.supplier_name_text).toBe(supplier.name); expect(createBody.order_item_ids).toEqual([]);
     doc = { ...createBody, id: 5, branch_id: 1, department_id: 10, status: 'draft', scope: 'department', counted_complete_at: null,
      images: [], warnings: [], lines: [], ocr: { status: 'locked' } }; return ok(doc);
    }
    if (url.pathname.endsWith('/5/count')) {
     const body = route.request().postDataJSON(); expect(body.lines).toHaveLength(1); expect(body.lines[0].counted_quantity).toBe('3');
     doc = { ...doc, counted_complete_at: '2026-10-20T03:00:00Z', lines: [{ id: 1, product_id: 7, product_name: 'น้ำแข็งหลอดใหญ่', unit_text: 'ถุง',
      counted_quantity: '3.00', quantity_received: '3.00', quantity_billed: null, review_decision: 'missing_bill', match: { source: 'manual' } }] }; return ok(doc);
    }
    if (url.pathname.endsWith('/5/signatures') && method === 'POST') { doc = { ...doc, has_receiver_signature: true }; return ok(doc); }
    if (url.pathname.endsWith('/5/confirm')) { doc = { ...doc, status: 'confirmed' }; return ok(doc); }
    if (url.pathname.endsWith('/5') || url.pathname.endsWith('/20')) return ok(url.pathname.endsWith('/20') ? ordered : doc);
    unexpected.push(`${method} ${url.pathname}`); return route.fulfill({ status: 500, headers, json: {} });
   });
   const capture = async name => { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }); };
   try {
    await page.goto(`${server.url}/receiving`);
    await page.getByRole('button', { name: 'ตัวเลือก', exact: true }).click();
    await page.getByRole('button', { name: 'ตั้งค่าใบรับเอง', exact: true }).click();
    const resume = page.getByRole('button', { name: 'ทำต่อใบ #20', exact: true }); await expect(resume).toBeVisible();
    await expect(resume.locator('use')).toHaveAttribute('href', /#back$/); await capture('01-resume-arrow');
    await page.getByRole('button', { name: 'ปิด', exact: true }).click();
    await page.getByRole('button', { name: 'ตัวเลือก', exact: true }).click();
    await expect(page.locator('.rc-thai-date-control')).toContainText('20 ต.ค. 2569'); await capture('02-thai-date');
    await page.getByRole('button', { name: 'รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)', exact: true }).click();
    await expect(page.getByText('ค้นหาร้านไม่ได้ กรุณาลองใหม่ก่อนเลือกชื่อร้าน')).toBeVisible(); await capture('03-search-error');
    searchFails = false;
    await page.getByRole('button', { name: 'ค้นหาร้านอีกครั้ง', exact: true }).click();
    await page.getByRole('searchbox', { name: 'ผู้ส่งของ', exact: true }).fill('ร้านใหม่ทดสอบ');
    await expect(page.getByText('ไม่พบร้านในทะเบียน', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ใช้ชื่อ “ร้านใหม่ทดสอบ” · ร้านใหม่ รอบัญชีตรวจ', exact: true }).click(); await capture('04-new-supplier');
    await page.getByRole('button', { name: 'เปลี่ยนร้าน', exact: true }).click();
    await page.getByRole('searchbox', { name: 'ผู้ส่งของ', exact: true }).fill('vic');
    await page.getByRole('button', { name: 'ร้านน้ำแข็ง vic SYN-VIC · ทะเบียนซัพ', exact: true }).click();
    await page.getByRole('radio', { name: 'ไม่มีบิล', exact: true }).check(); await capture('05-selected-master');
    await page.getByRole('button', { name: 'เริ่มนับของ', exact: true }).click();
    await expect(page.getByText('ยังไม่มีสินค้าให้นับ', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ยืนยันการนับ', exact: true })).toBeDisabled(); await capture('06-empty-count');
    productsFail = false;
    await page.getByRole('button', { name: 'โหลดสินค้าแนะนำอีกครั้ง', exact: true }).click();
    await page.getByRole('button', { name: 'น้ำแข็งหลอดใหญ่ ถุง', exact: true }).click();
    const count = page.getByRole('textbox', { name: 'นับได้ น้ำแข็งหลอดใหญ่', exact: true }); await expect(count).toHaveValue('');
    await page.getByRole('button', { name: 'น้ำแข็งหลอดใหญ่ มีในใบแล้ว · ไปช่องนับเดิม', exact: true }).click(); await expect(count).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'นับได้ น้ำแข็งหลอดใหญ่', exact: true })).toHaveCount(1);
    await count.fill('3'); await capture('07-quick-count');
    await page.getByRole('button', { name: 'ยืนยันการนับ', exact: true }).click(); await capture('08-summary');
    await page.getByRole('button', { name: 'ไปเซ็นรับของ', exact: true }).click();
    const canvas = page.locator('canvas').first(), box = await canvas.boundingBox();
    await page.mouse.move(box.x + 15, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 85, box.y + 40, { steps: 8 }); await page.mouse.up();
    await page.getByRole('button', { name: 'บันทึกเซ็น', exact: true }).first().click();
    await page.getByRole('button', { name: 'ยืนยันรับสินค้า', exact: true }).click();
    await expect(page.getByLabel('รับของสำเร็จ')).toBeVisible(); await capture('09-success');
    expect(calls.some(c => c.endsWith('/ocr'))).toBe(false); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
   } finally { await fs.writeFile(path.join(dir, 'evidence.json'), JSON.stringify({ viewport, colorScheme, errors, unexpected, calls }, null, 2)); await page.close(); await server.close(); }
  });
 });
}
