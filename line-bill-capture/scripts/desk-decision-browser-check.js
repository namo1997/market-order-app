// ใช้ Playwright run-code กับ SSD loopback preview เท่านั้น; fixture/spy อยู่ใน browser memory ไม่มีการยืนยันจริง
async page => {
  const check = (value, message) => { if (!value) throw Error(message); };
  check(/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()), 'ต้องเป็น Local loopback preview');
  const writes = [], errors = [], cases = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : (writes.push(route.request().url()), route.abort()));
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.reload(); await page.waitForFunction(() => !S.dayLoading && S.matches.length >= 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.__decisionCalls = []; window.__decisionOriginal = update;
    window.__decisionRows = S.matches.filter(m => !m.is_group && m.review_type !== 'reimbursement').slice(0, 2).map(m => ({ ...m, status: 'pending', score: 90 }));
    for (const m of window.__decisionRows) {
      const { bill, slip } = pairs(m);
      Object.assign(bill, { amount_review_flag: 0, bill_total_value: 100, bill_total_text: '100', match_status: 'pending' });
      Object.assign(slip, { amount_review_flag: 0, slip_amount_value: 100, slip_amount_text: '100', match_status: 'pending' });
    }
    window.__decisionFixture = score => {
      S.matches = window.__decisionRows.map(m => ({ ...m, score })); S.confirmedMatches = []; S.completedReview = null;
      S.bucket = 'review'; S.selected = S.matches[0].id; render(); window.LbcDesk.go(score >= 95 ? 'easy' : 'm' + S.matches[0].id);
    };
    update = async (m, status) => { window.__decisionCalls.push({ id: m.id, status }); if (status === 'confirmed') S.confirmedMatches.push({ ...m, status }); };
    window.__decisionFixture(90);
  });
  const calls = () => page.evaluate(() => window.__decisionCalls.splice(0));
  const key = (key, repeat = false) => page.evaluate(({ key, repeat }) => document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true })), { key, repeat });
  await page.waitForTimeout(450);
  const before = await page.evaluate(() => S.selected);
  for (const k of ['y', 'n', 's']) await key(k, true);
  check((await calls()).length === 0 && await page.evaluate(() => S.selected) === before, 'คีย์ค้าง Y/N/S ต้องไม่ตัดสินใจหรือข้ามงาน'); cases.push('repeat Y/N/S ignored');
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); for (const key of ['y', 'n']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  check((await calls()).length === 0, 'Y/N ทันทีหลังเปลี่ยนคู่ต้องไม่ทำงาน'); cases.push('selection cooldown');
  await page.waitForTimeout(450); await key('y'); await page.waitForTimeout(100);
  check((await calls()).length === 1, 'Y ปกติหลังพ้นช่วงพักต้องเรียก handler เดิม');
  await page.waitForTimeout(450); await page.evaluate(() => render()); await key('n'); await page.waitForTimeout(100);
  check((await calls()).length === 1, 'render งานเดิมต้องไม่เลื่อนเวลาพักคีย์ออกไป'); cases.push('normal keys and same-item rerender');
  await page.evaluate(() => { S.start = '2026-10-03'; render(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true })); });
  check((await calls()).length === 0, 'เปลี่ยนวันแม้ id เดิมต้องพักคีย์');
  await page.evaluate(() => { S.start = '2026-10-02'; window.__decisionFixture(99); }); await page.waitForTimeout(450);
  await key('y'); check((await calls()).length === 0, 'Y ครั้งแรกต้องไม่ยืนยันชุด');
  check((await page.locator('[data-act="all"]').innerText()).includes('กดอีกครั้ง'), 'ต้องอธิบายการยืนยันซ้ำบนปุ่ม');
  await key('y', true); check((await calls()).length === 0, 'คีย์ค้างต้องไม่เป็นครั้งยืนยันซ้ำ');
  await page.screenshot({ path: 'desk-batch-armed.png' });
  await key('y'); await page.waitForTimeout(120);
  check((await calls()).length === 2, 'Y ครั้งที่สองต้องเรียก handler เดิมครบคู่ที่เลือก'); cases.push('batch explicit second confirmation');
  await page.evaluate(() => window.__decisionFixture(99)); await page.waitForTimeout(450);
  await key('y'); await page.waitForTimeout(3150); await key('y');
  check((await calls()).length === 0, 'เกิน 3 วินาทีต้องเริ่มคำยืนยันใหม่'); cases.push('batch expiry');
  await page.locator('[data-pick]').first().click(); await key('y');
  check((await calls()).length === 0, 'เปลี่ยนคู่ที่เลือกต้องยกเลิกคำยืนยันชุดเก่า');
  await page.evaluate(() => window.LbcDesk.go('other:' + S.items.find(x => x.category === 'other').id));
  await page.evaluate(() => window.LbcDesk.go('easy')); await page.waitForTimeout(450); await key('y');
  check((await calls()).length === 0, 'สลับไปงานอื่นแล้วกลับต้องเริ่มยืนยันชุดใหม่'); cases.push('batch selection and navigation reset');
  await page.reload();
  check(!writes.length && !errors.length, 'ห้าม network writes/runtime errors');
  return { passed: true, cases, writes, errors };
}
