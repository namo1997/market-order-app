// ตรวจหน้าต่างเดิมใน glass/desk: fixture อยู่ในหน่วยความจำ ไม่ยืนยัน/บันทึก/เรียก AI
async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const originalUrl = page.url(), base = new URL(originalUrl).origin;
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(base), 'ต้องเป็น loopback preview');
  const cases = [], nativeDialogs = [], writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { nativeDialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.dismiss(); });
  await page.route('**/*', route => {
    const request = route.request();
    if (!request.url().startsWith(base)) return route.abort();
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
    if (/\/99999[12]\/receipt-substitute-draft/.test(request.url())) return route.fulfill({ json: { success: true, data: { document_date: '2026-10-02', amount: 960, payer_name: 'บริษัทตัวอย่าง', payee_name: 'ผู้รับจำลอง', payee_account: '••1234', description: 'ข้อมูลจำลองตรวจหน้าต่าง' } } });
    return route.continue();
  });
  for (const mode of ['glass', 'desk']) for (const scheme of ['light', 'dark']) for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    await page.evaluate(({ mode, scheme }) => { localStorage.setItem('lbc-admin-view', mode); localStorage.setItem('lbc-admin-scheme', scheme); }, { mode, scheme });
    await page.goto(originalUrl); await page.waitForFunction(() => !S.dayLoading);
    await page.waitForTimeout(250);
    const capture = async (name, selector) => {
      await page.locator(selector).waitFor({ state: 'visible' }); await page.waitForTimeout(450);
      const measurement = await page.locator(selector).evaluate(root => {
        const r = root.getBoundingClientRect(), style = getComputedStyle(root);
        const visible = e => { const box = e.getBoundingClientRect(), s = getComputedStyle(e); return box.width && box.height && s.display !== 'none' && s.visibility !== 'hidden'; };
        const controls = [...root.querySelectorAll('button,input,select,textarea')].filter(visible);
        return { background: style.backgroundColor, color: style.color, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          overflow: root.scrollWidth > root.clientWidth + 2,
          noName: controls.filter(e => e.tagName === 'BUTTON' && !(e.textContent.trim() || e.getAttribute('aria-label') || e.title)).map(e => e.id),
          duplicateIds: [...document.querySelectorAll('[id]')].map(e => e.id).filter((id, index, all) => all.indexOf(id) !== index),
          inputs: controls.filter(e => e.tagName !== 'BUTTON').map(e => ({ id: e.id, background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color })) };
      });
      const rgb = measurement.background.match(/[\d.]+/g)?.map(Number) || [];
      const darkSurface = scheme !== 'dark' || Math.max(...rgb.slice(0, 3)) < 110;
      const passed = measurement.left >= -1 && measurement.right <= width + 1 && measurement.top >= -1 && measurement.bottom <= (width === 1280 ? 800 : 900) + 1 && !measurement.overflow && !measurement.noName.length && !measurement.duplicateIds.length && darkSurface;
      cases.push({ mode, scheme, width, name, passed, darkSurface, ...measurement });
      await page.screenshot({ path: `dialog-${mode}-${scheme}-${width}-${name}.png`, animations: 'disabled' });
    };
    if (mode === 'desk') await page.evaluate(() => window.LbcDesk.systemClick('senders')); else await page.locator('#senders').click();
    await capture('senders', '#sendersbg .drawer'); await page.locator('#close-senders').click();
    await page.locator(mode === 'desk' ? '#desk-ai' : '#ai-menu-toggle').click();
    await capture('ai-menu', mode === 'desk' ? '#desk-controls' : '#ai-menu');
    if (mode === 'desk') await page.locator('#desk-controls .hd button').click(); else await page.locator('#ai-menu-toggle').click();
    await page.locator(mode === 'desk' ? '#desk-round' : '.gl-daymore').click();
    await capture('round-menu', mode === 'desk' ? '.desk-pop' : '.gl-pop');
    const scopeBefore = await page.evaluate(() => [S.view, S.start, S.source, S.bucket, S.selected]);
    await page.keyboard.press('Escape');
    check(await page.evaluate(expected => JSON.stringify([S.view, S.start, S.source, S.bucket, S.selected]) === JSON.stringify(expected), scopeBefore), 'Escape ต้องปิดเมนูโดยไม่ย้อนออกจากวันหรือเปลี่ยน selection');
    // จับ confirm เดิมแล้ว dismiss เสมอ ไม่เปิดรอบ/ปิดรอบ/อ่าน AI จริง
    await page.evaluate(async () => {
      const day = S.days.find(d => d.business_date === S.start && d.source_id === S.source);
      window.__dialogDayStatus = day.closing_status; day.closing_status = 'closed'; syncView();
      await closeCurrentDay(); day.closing_status = window.__dialogDayStatus; syncView();
      await $('reread').onclick();
    });
    check(nativeDialogs.length >= 2, 'ต้องพบ confirm เปิดรอบและอ่าน AI ใหม่');
    await page.evaluate(() => {
      const template = S.items.find(x => x.category === 'bill') || S.items[0];
      window.__dialogFixture = { ...template, id: 999991, category: 'bill', status: 'downloaded', ai_status: 'done', match_status: 'unmatched', matched_item_id: null, active_transaction: null,
        generated_document_type: 'receipt_substitute', generated_document_json: JSON.stringify({ document_date: '2026-10-02', amount: 960, payer_name: 'บริษัทตัวอย่าง', payee_name: 'ผู้รับจำลอง', description: 'ข้อมูลจำลองตรวจหน้าต่าง' }),
        vendor_name: 'ร้านจำลอง', bill_total_value: 960, bill_total_text: '960', amount_review_flag: 0, payment_role: null, reimbursement_related_item_id: null, updated_at: '2026-10-02T12:00:00Z' };
      S.items.push(window.__dialogFixture); S.pool.push(window.__dialogFixture); S.bucket = 'bill'; S.bucketPinned = true; S.selected = 999991;
      if (document.body.classList.contains('desk-on')) window.LbcDesk.go('bill:999991');
      render();
      if (!document.getElementById('reviewpanel').querySelector('.reviewhead')) throw Error('fixture ไม่มี native reviewhead');
    });
    await page.waitForFunction(() => document.querySelector('#reviewpanel .receipt-substitute-void-actions button'));
    await page.evaluate(() => document.querySelector('#reviewpanel .receipt-substitute-void-actions button').click());
    await capture('void-receipt', '.receipt-substitute-void-dialog');
    await page.locator('.receipt-substitute-void-dialog textarea').fill('เหตุผลจำลอง ไม่กดบันทึก');
    await page.locator('.receipt-substitute-void-dialog .actions button').first().click();
    await page.evaluate(() => openNotDocument(window.__dialogFixture, 'บิล'));
    await capture('not-document', '#not-document-bg .receiptmodal');
    await page.locator('#not-document-kind').selectOption('custom');
    await page.locator('#not-document-reason').fill('ทดสอบเฉพาะฟอร์ม ไม่ยืนยัน');
    await page.locator('#not-document-close').click();
    await page.evaluate(async () => {
      const advance = { ...window.__dialogFixture, id: 999992, category: 'transfer', generated_document_type: null, slip_amount_value: 960, slip_amount_text: '960', transfer_to_name: 'ผู้รับจำลอง', transfer_to_account: '••1234' };
      await openReceiptSubstitute(advance, 999993);
    });
    await capture('reimbursement', '#receiptbg .receiptmodal');
    await page.locator('#receipt-description').fill('ร่างจำลอง ไม่สร้างใบแทน');
    await page.locator('#receipt-close').click();
    check(await page.evaluate(() => [...document.querySelectorAll('dialog[open],.drawerbg:not([hidden])')].length === 0), 'ปิดแล้วต้องไม่มี overlay ค้าง');
  }
  const failures = cases.filter(entry => !entry.passed);
  return { passed: !failures.length && !writes.length && !errors.length, cases, failures, nativeDialogs, writes, errors,
    notes: ['เปิดรอบ/อ่านใหม่ใช้ browser confirm เดิม จับข้อความแล้ว dismiss ไม่มี CSS หน้าต่าง custom ให้แก้', 'ยกเลิกใบแทน/คืนเงินใช้ fixture ในหน่วยความจำ ไม่ยืนยันธุรกรรม', 'ทดสอบครบ 6 กลุ่มใน handoff; เมนูรอบและเมนู AI ถ่ายภาพแยก'] };
}
