// ฟอร์มเดิมที่ย้ายเข้าแผ่นโต๊ะต้องเก็บ draft และไม่เกิด id ซ้ำหลัง source render
async page => {
  const check = (ok, text) => { if (!ok) throw Error(text); };
  check(/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()), 'ต้องเป็น loopback preview');
  const base = new URL(page.url()).origin, writes = [], errors = [];
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.goto(base + '/admin?view=day&date=2026-10-02&group=C987d13b96371f18f5a0996107d4f6ef5&bucket=review');
  await page.locator('#desk-strip [data-go^="m"]').first().waitFor(); await page.locator('#desk-strip [data-go^="m"]').first().click();
  await page.evaluate(() => window.LbcDesk.openControl('#more', 'ตรวจ draft ของฟอร์มต้นฉบับ'));
  await page.locator('#desk-controls #vendor').waitFor();
  const draft = { vendor: 'DRAFT-PRESERVE', purpose: 'รายการจำลองเพื่อตรวจ form', billtotal: '123.45', notes: 'ไม่บันทึกข้อมูลนี้' };
  for (const [id, value] of Object.entries(draft)) await page.locator('#desk-controls #' + id).fill(value);
  const beforeScope = await page.evaluate(() => [S.view, S.start, S.source, S.bucket, S.selected]);
  await page.evaluate(() => render()); await page.waitForTimeout(160);
  check(await page.evaluate(expected => Object.entries(expected).every(([id, value]) => {
    const nodes = document.querySelectorAll('[id="' + id + '"]'); return nodes.length === 1 && nodes[0].closest('#desk-controls') && nodes[0].value === value;
  }), draft), 'original render ต้องไม่ทำ id ซ้ำหรือ draft เปลี่ยน');
  check(await page.evaluate(expected => JSON.stringify([S.view, S.start, S.source, S.bucket, S.selected]) === JSON.stringify(expected), beforeScope), 'source render ต้องคง selection เดิม');
  // ตรวจ original submit handler อ่าน draft นี้จริง โดย stub fetch ก่อนออก network
  await page.evaluate(() => {
    window.__draftFetch = window.fetch; window.__draftRequests = [];
    window.fetch = (...args) => {
      const method = String(args[1]?.method || 'GET').toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) { window.__draftRequests.push({ url: String(args[0]), method, body: JSON.parse(args[1]?.body || '{}') }); return Promise.reject(new Error('fixture captured before network; no write')); }
      return window.__draftFetch(...args);
    };
  });
  await page.locator('#desk-controls #form button[type="submit"]').click();
  await page.waitForFunction(() => window.__draftRequests.length);
  const captured = await page.evaluate(() => { window.fetch = window.__draftFetch; return window.__draftRequests; });
  const request = captured[0]?.body?.context_snapshot?.request;
  check(request?.vendor_name === draft.vendor && request?.bill_purpose === draft.purpose && request?.bill_total_text === draft.billtotal && request?.notes === draft.notes, 'original save handler ต้องอ่าน draft ที่แสดงอยู่');
  await page.evaluate(() => {
    window.__draftReview = review;
    review = (...args) => { const out = window.__draftReview(...args); const source = document.querySelector('#reviewpanel #form button[type="submit"]'); if (source) source.disabled = true; return out; };
    render(); review = window.__draftReview;
  });
  check(await page.locator('#desk-controls #form button[type="submit"]').isDisabled(), 'fresh original disabled state ต้องไม่ถูก draft restoration เปลี่ยน');
  await page.locator('#desk-controls .hd button').click();
  check(await page.locator('#reviewpanel #form').count() === 1 && await page.locator('#desk-controls').count() === 0, 'ปิดแล้วต้องคืนฟอร์มต้นฉบับ');
  check(!writes.length && !errors.length, 'ห้าม network writes/runtime errors');
  return { passed: true, sourceRenderDraftAndUniqueIds: true, originalSaveReadsVisibleDraft: true, sourceFormRestored: true, capturedBeforeNetwork: captured.length, writes, errors };
}
