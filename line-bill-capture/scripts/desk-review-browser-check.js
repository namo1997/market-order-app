// D3–D6: เปิดของจริงบนสำเนา SSD; ธงยอด/ยอดว่าง/หมดคิวเป็น fixture ในหน่วยความจำ ไม่ส่งการตัดสินใจ
async page => {
  const check = (v, message) => { if (!v) throw Error(message); };
  const setScheme = async dark => {
    const label = dark ? 'มืด' : 'สว่าง';
    for (let i = 0; i < 3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: ' + label; i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (dark ? 1 : 0), 'ต้องใช้โหมดสีจริง');
  };
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น loopback preview');
  const errors = [], writes = [], layout = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.reload(); await page.locator('#desk-strip [data-go^="other:"]').first().waitFor();
  await page.locator('#desk-strip [data-go^="other:"]').first().click();
  for (const id of ['classify-bill', 'classify-slip', 'classify-incoming']) check(await page.locator(`#desk-stage [data-proxy="${id}"]`).count() === 1, 'ประเภทหาย: ' + id);
  for (const id of ['classify-bill', 'classify-slip']) {
    await page.evaluate(() => { window.__deskPrompt = window.prompt; window.__deskPromptText = ''; window.prompt = text => { window.__deskPromptText = text; return null; }; });
    await page.locator(`#desk-stage [data-proxy="${id}"]`).click();
    const prompted = await page.evaluate(() => { window.prompt = window.__deskPrompt; return /ระบุยอด/.test(window.__deskPromptText); });
    check(prompted, 'ต้องเรียก prompt ยอดเดิม');
  }
  await page.locator('#desk-stage [data-act="not-document"]').click();
  await page.waitForFunction(() => !document.getElementById('not-document-bg').hidden);
  check(!await page.locator('#not-document-learn').isChecked(), 'ไม่เกี่ยวต้องไม่เปิดสอน AI เอง');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'desk-d3-other.png' });
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await setScheme(dark);
    await page.waitForTimeout(150);
    const bad = await page.evaluate(() => { const d = document.querySelector('#desk-stage .dock'), r = d.getBoundingClientRect(); return d.scrollWidth > d.clientWidth + 1 || r.left < 0 || r.right > innerWidth || document.querySelector('#desk').scrollLeft !== 0; });
    check(!bad, 'แผงจัดประเภทล้น: ' + width + '/' + dark);
    layout.push({ stage: 'other', width, dark, overflow: bad });
    await page.screenshot({ path: `desk-d3-other-${dark ? 'dark' : 'light'}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await setScheme(false);
  // Peek ต้องมาจาก focus ปัจจุบันและเปิดแชททางซ้ายตรงข้อความเดิม
  await page.locator('#desk-strip [data-go^="other:"]').nth(1).click();
  await page.locator('#desk-peek:not([hidden])').waitFor();
  await page.screenshot({ path: 'desk-d4-peek.png' });
  await page.locator('#desk-peek').click();
  check(await page.locator('#desk-chatbody .chatpanel').count() === 1, 'peek ต้องใช้แผงแชทเดิม');
  check(await page.evaluate(() => document.querySelector('#desk-drawer').getBoundingClientRect().left < 80), 'แชทต้องอยู่ซ้าย');
  await page.screenshot({ path: 'desk-d4-chat.png' });
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await setScheme(dark);
    check(await page.evaluate(() => {
      const pane = document.getElementById('desk-drawer'), body = pane.querySelector('.body'), r = pane.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && body.scrollWidth <= body.clientWidth + 1;
    }), 'ลิ้นชักแชทล้น: ' + width + '/' + dark);
  }
  await page.locator('#desk-chatclose').click();
  check(await page.locator('#worklayout .chatpanel').count() === 1, 'ปิดแล้วต้องคืนแชท');
  await page.locator('#desk-strip [data-go^="other:"]').first().click();
  await page.locator('#desk-peek:not([hidden])').waitFor();
  await page.waitForFunction(() => document.getElementById('desk-peek').hidden, null, { timeout: 6500 });
  // ใช้ source handler spy เฉพาะการเทียบสะพานปุ่ม ไม่แทนที่ API การเงินจริง
  const flag = await page.evaluate(() => {
    const s = (0, eval)('S'), m = s.matches.find(m => !m.is_group && m.review_type !== 'reimbursement');
    const { bill, slip } = (0, eval)('pairs')(m); bill.amount_review_flag = 1; bill.announced_amount = Number(bill.bill_total_value) + 10;
    render(); return { match: m.id, bill: bill.id, slip: slip.id };
  });
  await page.locator(`#desk-strip [data-go="m${flag.match}"]`).click();
  check(await page.locator('#desk-stage [data-act="yes"]').count() === 0, 'มีธงยอดต้องไม่แสดงยืนยันคู่');
  for (const id of ['review-flag-document', 'review-flag-announced']) check(await page.locator(`#desk-stage [data-proxy="${id}"]`).count() === 1, 'ตัวเลือกยอดหาย');
  await page.evaluate(() => {
    window.__deskCalls = [];
    for (const id of ['review-flag-document', 'review-flag-announced']) document.getElementById(id).onclick = () => window.__deskCalls.push([id, (0, eval)('S.selected')]);
  });
  await page.locator('#desk-stage [data-proxy="review-flag-document"]').click();
  await page.locator('#desk-stage [data-proxy="review-flag-announced"]').click();
  check(await page.evaluate(id => window.__deskCalls.length === 2 && window.__deskCalls.every(x => Number(x[1]) === id), flag.match), 'ตัวเลือกยอดต้องคลิก handler คู่เดิม');
  await page.locator('#desk-stage [data-act="flag-manual"]').click();
  check(await page.locator('#desk-controls #review-flag-total').count() === 1, 'กรอกยอดเองต้องมี input เดิม');
  check(await page.locator('#desk-controls #review-flag-manual').count() === 1, 'กรอกยอดเองต้องมีปุ่มเดิม');
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  const measure = () => page.evaluate(() => {
    const root = document.querySelector('#desk'), dock = root.querySelector('.dock'), r = dock.getBoundingClientRect();
    return { overflow: dock.scrollWidth > dock.clientWidth + 1 || r.left < 0 || r.right > innerWidth || document.documentElement.scrollWidth > innerWidth, shifted: root.scrollLeft !== 0 };
  });
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await setScheme(dark);
    const result = await measure(); check(!result.overflow && !result.shifted, 'เลือกยอดล้นหรือโต๊ะเลื่อน: ' + width + '/' + dark);
    layout.push({ width, dark, ...result }); await page.screenshot({ path: `desk-d5-flag-${dark ? 'dark' : 'light'}-${width}.png` });
  }
  await page.reload(); await page.locator('#desk-strip [data-go="easy"]').waitFor();
  const missing = await page.evaluate(() => { const s = (0, eval)('S'), b = s.items.find(x => x.category === 'bill'); b.match_status = 'needs_amount'; b.bill_total_value = null; b.bill_total_text = null; render(); return b.id; });
  await page.locator(`#desk-strip [data-go="needs_amount:${missing}"]`).click();
  check((await page.locator('#desk-stage .facts').innerText()).includes('ยังไม่ทราบยอด'), 'NULL ต้องไม่เป็นศูนย์');
  await page.locator('#desk-stage [data-act="enter-amount"]').click();
  check(await page.locator('#desk-controls #selected-amount').count() === 1, 'ยอดว่างต้องใช้ฟอร์มเดิม');
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  await page.screenshot({ path: 'desk-d5-missing.png' });
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await setScheme(dark);
    const result = await measure(); check(!result.overflow && !result.shifted, 'ยอดว่างล้น: ' + width + '/' + dark);
    layout.push({ stage: 'missing', width, dark, ...result });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#desk .wall')).animationName === 'none'), 'ต้องเคารพ reduced motion');
  await page.evaluate(() => { const s = (0, eval)('S'); s.items = []; s.pool = []; s.matches = []; s.confirmedMatches = []; s.selected = null; s.bucket = 'review'; render(); });
  check((await page.locator('#desk-stage h1').innerText()) === 'เคลียร์ครบแล้ว', 'หมดงานต้องเห็นสถานะครบ');
  check(await page.locator('#desk-stage [data-act="close"]').isDisabled() === await page.locator('#closeday').isDisabled(), 'ปิดรอบในหน้าหมดงานต้องคง disabled ต้นทาง');
  check(await page.locator('#desk button:not([data-tip])').count() === 0, 'ปุ่มรองต้องมี tooltip');
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await setScheme(dark);
    check(await page.evaluate(() => {
      const info = document.querySelector('#desk-stage .info'), r = info.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && info.scrollWidth <= info.clientWidth + 1;
    }), 'หมดงานล้น: ' + width + '/' + dark);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2200); // รอ toast ชั่วคราวจากการล้าง state จำลอง ไม่ซ่อนข้อผิดพลาดด้วย CSS
  await page.screenshot({ path: 'desk-d6-empty.png' });
  check(errors.length === 0, 'runtime error: ' + errors.join(', ')); check(writes.length === 0, 'ทดสอบนี้ต้องไม่เขียนข้อมูล');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  return { passed: true, layout, flag, missing, writes, errors };
}
