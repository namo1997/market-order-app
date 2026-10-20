import { test, expect, openDocument, moreAction, sign } from '../support/fixtures.mjs';
import { ocrDocument } from '../support/mock-api.mjs';

const capture = async (app, name) => {
  await app.shot(name); await app.layout(name); await app.audit(name);
};

test('complete receiving flow with live quantity colors, signature, confirm and void', async ({ app }) => {
  const { page } = app;
  await app.start();
  await capture(app, '01-expected');
  await page.getByRole('radio', { name: 'ผู้ขายทดสอบ', exact: true }).check();
  await page.getByRole('button', { name: 'รับสินค้า', exact: true }).click();
  await capture(app, '02-create-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'สร้างใบรับ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ถ่ายบิล', exact: true })).toBeVisible();
  expect(app.api.doc.lines).toEqual([]);
  await capture(app, '03-draft');
  // Generate a small image in this browser only; no internal-disk fixture or bill PII.
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 200);
    context.fillStyle = '#111'; context.font = '18px sans-serif'; context.fillText('ANON BILL 392.00', 10, 40);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  });
  await page.getByLabel('รูปบิล', { exact: true }).setInputFiles({ name: 'anonymous-bill.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(image, 'base64') });
  await expect(page.getByRole('button', { name: 'ส่งรูป', exact: true })).toBeEnabled();
  await capture(app, '04-photo-selected');
  await page.getByRole('button', { name: 'ส่งรูป', exact: true }).click();
  await expect(page.getByRole('img', { name: 'บิลหน้า 1', exact: true })).toBeVisible();
  await capture(app, '05-photo-uploaded');
  await page.getByRole('button', { name: 'อ่านบิล', exact: true }).click();
  const qty = page.getByRole('textbox', { name: 'รับจริง', exact: true });
  await expect(qty).toHaveValue('2.5');
  const line = page.getByRole('article').filter({ has: qty });
  const status = line.locator('.sg-status');
  const colors = {};
  for (const [value, state, label] of [['2.5', 'ok', 'ตรงใบสั่ง'], ['2', 'review', 'ต่าง 0.5 กก.'], ['-1', 'error', 'ตรวจตัวเลข'], ['2.5', 'ok', 'ตรงใบสั่ง']]) {
    await qty.fill(value);
    await expect(status).toHaveAttribute('data-status', state); await expect(status).toHaveText(label);
    colors[state] = await status.evaluate(element => getComputedStyle(element).color);
    const expectedColor = await status.evaluate((element, state) => {
      const probe = document.createElement('span'); probe.style.color = `var(--sg-${state === 'ok' ? 'ok' : state})`;
      element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color;
    }, state);
    expect(colors[state]).toBe(expectedColor);
    await capture(app, `06-quantity-${state}`);
  }
  expect(new Set(Object.values(colors)).size).toBe(3);
  await page.getByRole('button', { name: 'ต่อไป', exact: true }).click();
  await capture(app, '07-signature-empty');
  await sign(page);
  await app.shot('08-signature-drawn');
  await page.getByRole('button', { name: 'บันทึกเซ็น', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ตรวจรับ', exact: true })).toBeEnabled();
  expect(app.api.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  expect(app.api.doc.has_receiver_signature).toBe(true);
  await capture(app, '09-signature-saved');
  await page.getByRole('button', { name: 'ตรวจรับ', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'ยืนยันรับ', exact: true });
  await expect(confirm).toBeVisible(); await capture(app, '10-confirm-review');
  const release = app.api.pauseNext('POST', '/confirm');
  await confirm.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await app.api.waitFor('POST', '/confirm');
  try {
    await expect(confirm.getByRole('button', { name: 'กำลังบันทึก…', exact: true })).toBeDisabled();
    await app.shot('11-saving');
  } finally { release(); }
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^ยืนยันแล้ว$/ })).toBeVisible();
  expect(app.api.doc.status).toBe('confirmed');
  await capture(app, '12-confirmed');
  await moreAction(page, 'void');
  const voidDialog = page.getByRole('dialog', { name: 'ยกเลิกใบรับ', exact: true });
  const voidButton = voidDialog.getByRole('button', { name: 'ยกเลิกใบรับ', exact: true });
  await expect(voidButton).toBeDisabled();
  await page.getByRole('textbox', { name: 'เหตุผล', exact: true }).fill('   '); await expect(voidButton).toBeDisabled();
  expect(app.api.calls.filter(call => call.path.endsWith('/void'))).toHaveLength(0);
  await page.getByRole('textbox', { name: 'เหตุผล', exact: true }).fill('รับผิดใบ ขอทดสอบย้อนรายการ');
  await capture(app, '13-void-reason');
  await voidButton.click(); await expect(voidDialog).not.toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^ยกเลิกแล้ว$/ })).toBeVisible();
  expect(app.api.doc.status).toBe('void');
  expect(app.api.calls.filter(call => call.path.endsWith('/confirm'))).toHaveLength(1);
  expect(app.api.calls.filter(call => call.path.endsWith('/void'))).toHaveLength(1);
  await page.getByRole('button', { name: 'รายละเอียด', exact: true }).click();
  await expect(page.getByRole('option', { name: 'ยกเลิกใบรับ', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'ปิด', exact: true }).click();
  await capture(app, '14-voided');
});

test('offline retry preserves client_uuid after duplicate clicks and lost create response', async ({ app, context }) => {
  const { page } = app;
  await app.start();
  await page.getByRole('radio', { name: 'ผู้ขายทดสอบ', exact: true }).check();
  await page.getByRole('button', { name: 'รับสินค้า', exact: true }).click();
  app.api.failNext('POST', '/receiving-documents', 0, '', { abort: true, commit: true });
  const release = app.api.pauseNext('POST', '/receiving-documents');
  const button = page.getByRole('dialog').getByRole('button', { name: 'สร้างใบรับ', exact: true });
  // Two native activation events in the same task exercise the ref lock before React rerenders.
  await button.evaluate(element => { element.click(); element.click(); });
  const first = await app.api.waitFor('POST', '/receiving-documents');
  expect(app.api.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  release();
  await expect(page.getByRole('alert')).toContainText('การเชื่อมต่อขัดข้อง');
  const id = app.api.doc.id;
  await page.getByRole('button', { name: 'ปิด', exact: true }).click();
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'ออฟไลน์' })).toBeVisible();
  await app.shot('01-offline-pending');
  await context.setOffline(false);
  // Close and reopen: persisted pending payload must survive component unmount.
  await page.getByRole('button', { name: 'รับสินค้า', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('คำขอค้าง');
  await page.getByRole('button', { name: 'ส่งซ้ำ', exact: true }).click();
  const second = await app.api.waitFor('POST', '/receiving-documents', 2);
  expect(second.body.client_uuid).toBe(first.body.client_uuid); expect(second.body).toEqual(first.body);
  expect(app.api.doc.id).toBe(id);
  await expect(page.getByRole('button', { name: 'ถ่ายบิล', exact: true })).toBeVisible();
  await capture(app, '02-retried-single-document');
});

test('keyboard Tab order and visible focus on receiving and modal controls', async ({ app }) => {
  const { page } = app; await app.start();
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  const order = [page.locator('.sg-display-settings summary'), page.getByRole('radio', { name: 'รอรับ', exact: true }),
    page.getByRole('radio', { name: 'ผู้ขายทดสอบ', exact: true }), page.getByRole('button', { name: 'ตัวเลือก', exact: true }),
    page.getByRole('button', { name: 'โหลดใหม่', exact: true }), page.getByRole('button', { name: 'สร้างใบรับ', exact: true })];
  for (let i = 0; i < order.length; i++) {
    await page.keyboard.press('Tab'); await expect(order[i]).toBeFocused();
    const visibleFocus = await order[i].evaluate(element => {
      const candidates = [element, element.closest('label'), element.nextElementSibling].filter(Boolean);
      return candidates.some(node => {
        const style = getComputedStyle(node);
        return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.outlineColor))
          || (style.boxShadow !== 'none' && /[2-9]px/.test(style.boxShadow));
      });
    });
    expect.soft(visibleFocus, `Tab ${i + 1}: visible focus`).toBe(true);
    await app.shot(`01-tab-${i + 1}`);
  }
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const elements = await dialog.locator('button:visible, input:visible, summary:visible').all();
  // Native dialog must contain the complete forward/reverse Tab cycle.
  for (let i = 0; i < elements.length + 2; i++) {
    await page.keyboard.press('Tab');
    expect.soft(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab trapped in modal').toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(order.at(-1)).toBeFocused();
  await capture(app, '02-focus-return');
});

test('mock login through branch and department then receiving route', async ({ app }) => {
  const { page } = app; await app.start(null, { login: true });
  await page.getByRole('button', { name: /สาขาทดสอบ/ }).click();
  await page.getByRole('button', { name: /ครัวทดสอบ/ }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(`${app.server.url}/receiving`);
  await expect(page.getByRole('heading', { name: 'รับสินค้า', exact: true })).toBeVisible();
  expect(app.api.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(1);
  await capture(app, '01-mock-login-receiving');
});

for (const [status, code, text] of [[429, 'RATE_LIMITED', 'อ่านบิลถี่เกินไป'], [503, 'OCR_UNAVAILABLE', 'ระบบอ่านบิลยังไม่พร้อม']]) {
  test(`errors OCR ${status} shows actionable message and allows manual review`, async ({ app }) => {
    const { page } = app; await app.start(ocrDocument({ ocr: { status: 'none', model: null, confidence: null, warnings: [] } }));
    await openDocument(app); app.api.failNext('POST', '/ocr', status, code);
    await page.getByRole('button', { name: 'อ่านบิล', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.getByRole('button', { name: 'อ่านบิล', exact: true })).toBeEnabled();
    expect(app.api.doc.status).toBe('draft');
    await capture(app, `01-ocr-${status}`);
    await page.getByRole('button', { name: 'อ่านบิล', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'รับจริง', exact: true })).toHaveValue('2.5');
    await capture(app, `02-ocr-${status}-recovered`);
  });
}

test('errors PUT 422 keeps edited draft and prevents confirm', async ({ app }) => {
  const { page } = app; await app.start(ocrDocument()); await openDocument(app);
  await page.getByRole('radio', { name: 'รายการ', exact: true }).check();
  await page.getByRole('textbox', { name: 'รับจริง', exact: true }).fill('2');
  app.api.failNext('PUT', '/501', 422, 'VALIDATION_FAILED');
  await moreAction(page, 'save'); await expect(page.getByRole('alert')).toContainText('ข้อมูลยังไม่ถูกต้อง');
  expect(app.api.doc.lines[0].quantity_received).toBe('2.5');
  expect(app.api.calls.some(call => call.path.endsWith('/confirm'))).toBe(false);
  await capture(app, '01-validation-422');
  await page.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'รับจริง', exact: true })).toHaveValue('2');
});

test('errors confirm 409 requires reload and never auto resends mutation', async ({ app }) => {
  const { page } = app; await app.start(ocrDocument({ has_receiver_signature: true })); await openDocument(app);
  await page.getByRole('radio', { name: 'เซ็น', exact: true }).check();
  await page.getByRole('button', { name: 'ตรวจรับ', exact: true }).click();
  app.api.failNext('POST', '/confirm', 409, 'NOT_DRAFT');
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('สถานะเอกสารเปลี่ยนแล้ว');
  await expect(page.getByRole('button', { name: 'ยืนยัน', exact: true })).toHaveCount(0);
  await app.shot('01-conflict-409'); await app.audit('01-conflict-409');
  await page.getByRole('dialog').getByRole('button', { name: 'ตรวจผลล่าสุด', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(app.api.calls.filter(call => call.path.endsWith('/confirm'))).toHaveLength(1);
  await capture(app, '02-conflict-reloaded');
});

for (const [status, code] of [[403, 'FORBIDDEN'], [404, 'NOT_FOUND']]) {
  test(`errors image ${status} does not expose protected image`, async ({ app }) => {
    const { page } = app; await app.start(ocrDocument());
    app.api.failNext('GET', '/images/601', status, code); await openDocument(app);
    await expect(page.getByRole('status').filter({ hasText: 'โหลดรูปไม่สำเร็จ' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'บิลหน้า 1', exact: true })).toHaveCount(0);
    await capture(app, `01-image-${status}`);
  });
}

test('errors expired session 401 returns to mock login', async ({ app }) => {
  const { page } = app; await app.start();
  app.api.failNext('GET', '/receiving-documents', 401, 'UNAUTHORIZED');
  await page.getByRole('button', { name: 'โหลดใหม่', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: /สาขาทดสอบ/ })).toBeVisible();
  await app.shot('01-expired-session-login');
});
