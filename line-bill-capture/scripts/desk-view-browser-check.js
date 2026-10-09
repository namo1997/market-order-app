// ใช้ Playwright CLI run-code --filename=<ไฟล์นี้> กับพรีวิวจาก desk-view-preview.mjs บน SSD เท่านั้น
// กรณีสีแดง/เลขอ้างอิง/หาไม่เจอเป็น fixture ในหน่วยความจำเบราว์เซอร์ ไม่เขียนข้อมูลจริง
async page => {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น loopback preview');
  const check = (v, message) => { if (!v) throw Error(message); };
  const setScheme = async scheme => {
    const label = scheme === 'dark' ? 'มืด' : 'สว่าง';
    for (let i = 0; i < 3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: ' + label; i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (scheme === 'dark' ? 1 : 0), 'ต้องใช้โหมดสีจริง');
  };
  const writes = [], errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.route('**/*', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.reload();
  await page.locator('#desk:not([hidden]) .pairc').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#desk-stage .desk-link[data-kind="amount"]').length >= 2, { timeout: 60000 });
  check(await page.locator('#desk-stage .desk-link.no').count() === 0, 'ชุดง่ายต้องไม่เทียบยอดข้ามคู่');
  const realBatchLinks = await page.locator('#desk-stage .desk-link').count();
  await page.screenshot({ path: 'desk-d1-batch.png' });
  for (const scheme of ['light', 'dark']) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await setScheme(scheme);
    check(await page.evaluate(() => {
      const batch = document.querySelector('#desk-stage .batch'), dock = document.querySelector('#desk-stage .dock'), r = dock.getBoundingClientRect();
      return batch.scrollWidth <= batch.clientWidth + 1 && dock.scrollWidth <= dock.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth;
    }), 'ชุดง่ายล้น: ' + width + '/' + scheme);
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await setScheme('light');
  await page.locator('#desk-strip [data-go^="m"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#desk-stage .desk-link[data-kind="amount"]').length === 1, { timeout: 60000 });
  const geometry = () => page.evaluate(() => {
    const st = document.querySelector('#desk-stage'), sr = st.getBoundingClientRect();
    const ps = [...st.querySelectorAll(':scope > .doc .paper')];
    const path = st.querySelector('.desk-link[data-kind="amount"] .connector');
    const a = ps[0].querySelector('.gl-ocr-box.amount').getBoundingClientRect(), b = ps[1].querySelector('.gl-ocr-box.amount').getBoundingClientRect();
    const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
    return { error: Math.max(Math.abs(start.x - (a.right - sr.left)), Math.abs(start.y - (a.top + a.height / 2 - sr.top)),
      Math.abs(end.x - (b.left - sr.left)), Math.abs(end.y - (b.top + b.height / 2 - sr.top))),
      overflow: document.documentElement.scrollWidth > innerWidth || st.scrollWidth > st.clientWidth || document.querySelector('#desk').scrollLeft !== 0,
      clipped: ps.some(p => { const pr = p.getBoundingClientRect(), ir = p.querySelector('img').getBoundingClientRect(); return ir.height > pr.height + 1 || ir.width > pr.width + 1; }) };
  });
  const results = [];
  for (const scheme of ['light', 'dark']) {
    await setScheme(scheme);
    for (const width of [1120, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(850);
      const result = await geometry();
      check(result.error < 2, 'เส้นต้องตามกล่องหลัง resize: ' + JSON.stringify(result));
      check(!result.overflow && !result.clipped, 'รูปหรือโต๊ะล้น: ' + width + '/' + scheme);
      results.push({ width, scheme, ...result });
      await page.screenshot({ path: `desk-d1-${scheme}-${width}.png` });
    }
  }
  // ตำแหน่งเลขอ้างอิงจำลอง เพื่อแยกการทดสอบ event/สี/เส้นออกจากความแม่นยำ OCR บนรูปจริง
  await page.evaluate(() => {
    const papers = [...document.querySelectorAll('#desk-stage > .doc .paper')];
    papers.forEach((paper, i) => {
      const img = paper.querySelector('img'); img.dataset.glOcrRef = i ? '999990' : '999991';
      const box = document.createElement('i'); box.className = 'gl-ocr-box ref hl';
      Object.assign(box.style, { left: '20%', top: '25%', width: '12%', height: '3%' });
      paper.querySelector('.gl-ocr').append(box);
    });
    window.dispatchEvent(new CustomEvent('lbc:ocr', { detail: { id: Number(papers[1].querySelector('img').dataset.glOcrId), boxes: [] } }));
  });
  await page.waitForFunction(() => document.querySelector('.desk-link.no[data-kind="ref"]'));
  await page.evaluate(() => {
    const images = [...document.querySelectorAll('#desk-stage > .doc .paper img')]; images[1].dataset.glOcrRef = images[0].dataset.glOcrRef;
    images[1].dataset.glOcrAmount = Number(images[0].dataset.glOcrAmount) + 1;
    window.dispatchEvent(new CustomEvent('lbc:ocr', { detail: { id: Number(images[1].dataset.glOcrId), boxes: [] } }));
  });
  await page.waitForFunction(() => document.querySelector('.desk-link.ok[data-kind="ref"]') && document.querySelector('.desk-link.no[data-kind="amount"]'));
  await page.evaluate(() => {
    const p = document.querySelector('#desk-stage > .doc .paper');
    p.querySelectorAll('.gl-ocr-box').forEach(box => box.remove());
    window.dispatchEvent(new CustomEvent('lbc:ocr', { detail: { id: Number(p.querySelector('img').dataset.glOcrId), boxes: [] } }));
  });
  await page.waitForFunction(() => !document.querySelector('#desk-stage .desk-lines'));
  check((await page.locator('#desk-stage .facts').innerText()).includes('415.00'), 'หาไม่เจอยังต้องเห็นยอดใน facts');
  // กล่องที่วาดเสร็จหลังเปลี่ยนงานต้องไม่เพิ่มเส้นกลับไปยังงานเก่า
  await page.locator('#desk-strip [data-go="easy"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#desk-stage .desk-link[data-kind="amount"]').length >= 2);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lbc:ocr', { detail: { id: -1, boxes: [] } })));
  check(await page.locator('#desk-stage > .doc').count() === 0, 'event เก่าต้องไม่คืนเอกสารเก่า');
  await page.locator('#desk-views [data-view="classic"]').click();
  check(await page.locator('html.theme-glass').count() === 0, 'แบบเดิมต้องถอดธีม');
  check(await page.locator('#desk-stage .desk-lines').count() === 0, 'แบบเดิมต้องไม่มีเส้น');
  await page.locator('#view-switch-top [data-view="desk"]').click();
  await page.setViewportSize({ width: 1099, height: 900 });
  await page.waitForFunction(() => document.querySelector('#desk').hidden);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#desk-strip [data-go^="m"]').first().click();
  await page.waitForFunction(() => document.querySelector('.desk-link.ok[data-kind="amount"]'));
  await setScheme('light');
  await page.screenshot({ path: 'desk-d1-review.png' });
  await page.evaluate(() => { window.__deskOriginalUpdate = (0, eval)('update'); window.__deskUpdateCalls = []; (0, eval)('update = async (m, status) => window.__deskUpdateCalls.push([m.id, status])'); document.getElementById('why-bg').hidden = false; });
  try {
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true })));
    check(await page.evaluate(() => window.__deskUpdateCalls.length === 0), 'Y ต้องไม่ยืนยันหลัง dialog ที่เปิดอยู่');
    await page.evaluate(() => document.getElementById('why-bg').hidden = true);
    await page.locator('#desk-strip [data-go="easy"]').click();
    await page.locator('#desk-stage [data-act="all"]').click();
    await page.waitForFunction(() => /^ยืนยัน 0\//.test(document.getElementById('toast').textContent));
    check(await page.evaluate(() => window.__deskUpdateCalls.length === 1), 'ชุดง่ายต้องหยุดเมื่อยังไม่เห็นผลยืนยันจริง ไม่แจ้งว่าครบ');
  } finally { await page.evaluate(() => { (0, eval)('update = window.__deskOriginalUpdate'); document.getElementById('why-bg').hidden = true; }); }
  check(writes.length === 0, 'ทดสอบนี้ต้องไม่ส่ง request เขียนข้อมูล');
  check(errors.length === 0, 'runtime errors: ' + errors.join(', '));
  return { passed: true, realBatchLinks, layout: results, synthetic: ['ref match/mismatch', 'amount mismatch', 'missing box', 'late event'], writes, errors };
}
