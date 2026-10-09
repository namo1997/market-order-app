// พรีวิว SSD เท่านั้น: งานบิลจำลองในหน่วยความจำ เปิด dialog เดิมแต่ไม่กดบันทึก/ส่งข้อความ
async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const setScheme = async dark => {
    const label = dark ? 'มืด' : 'สว่าง';
    for (let i = 0; i < 3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: ' + label; i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (dark ? 1 : 0), 'ต้องใช้โหมดสีจริง');
  };
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น loopback preview');
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.reload(); await page.locator('#desk-strip [data-go^="slip:"]').first().waitFor();
  await page.locator('#desk-strip [data-go^="slip:"]').first().click();
  await page.locator('#desk-stage [data-proxy="selected-pick-bill"]').waitFor();
  check(await page.locator('#desk-stage .vacancy').count() === 1, 'สลิปต้องมีช่องบิลว่าง');
  await page.locator('#desk-stage [data-proxy="selected-pick-bill"]').click();
  await page.waitForFunction(() => !document.getElementById('drawerbg').hidden);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'desk-d2-slip.png' });
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await setScheme(dark);
    check(await page.evaluate(() => { const d = document.querySelector('#desk-stage .dock'), r = d.getBoundingClientRect(); return d.scrollWidth <= d.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth && document.querySelector('#desk').scrollLeft === 0; }), 'แท่นสลิปต้องไม่ล้น');
    await page.screenshot({ path: `desk-d2-slip-${dark ? 'dark' : 'light'}-${width}.png` });
  }
  const billId = await page.evaluate(() => {
    const s = (0, eval)('S'), bill = s.items.find(x => x.category === 'bill' && x.bill_total_value > 0);
    bill.match_status = 'unmatched'; render(); return bill.id;
  });
  await page.locator(`#desk-strip [data-go="bill:${billId}"]`).click();
  const billState = await page.evaluate(() => ({ bucket: (0, eval)('S.bucket'), id: (0, eval)('S.selected'),
    inventory: [...document.querySelectorAll('#reviewpanel button[id]')].map(x => ({ id: x.id, disabled: x.disabled, label: x.textContent.trim() })) }));
  check(billState.bucket === 'bill' && Number(billState.id) === billId, 'ต้อง select บิลเดิมก่อนใช้ปุ่ม');
  for (const id of ['selected-pick-slip', 'selected-request-transfer', 'confirm-cash-payment']) {
    check(await page.locator(`#desk-stage [data-proxy="${id}"]`).count() === 1, 'ปุ่มหลักหาย: ' + id);
  }
  await page.locator('#desk-stage [data-proxy="selected-request-transfer"]').click();
  await page.waitForFunction(() => !document.getElementById('transfer-request-bg').hidden);
  check(await page.locator('#transfer-request-submit').isDisabled(), 'ขอโอนต้องรอการยืนยันหลักฐานเดิม');
  await page.keyboard.press('Escape');
  await page.locator('#desk-stage [data-proxy="confirm-cash-payment"]').click();
  await page.waitForFunction(() => !document.getElementById('cash-payment-bg').hidden);
  await page.keyboard.press('Escape');
  await page.locator('#desk-stage [data-act="item-more"]').click();
  const labels = await page.locator('.desk-pop').innerText();
  for (const label of ['แก้ยอดบิล', 'จ่ายรวมหลายใบ', 'สลิปจ่าย', 'เงินเข้า', 'ไม่ใช่เอกสารการเงิน', 'แก้ปัญหารายการนี้']) check(labels.includes(label), 'เมนูหาย: ' + label);
  await page.getByRole('menuitem', { name: 'แก้ยอดบิล', exact: true }).click();
  await page.locator('#desk-controls #selected-amount').fill('123.45');
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  check(await page.locator('#reviewpanel #selected-amount').inputValue() === '123.45', 'ปิดแผงต้องคงร่างและ input เดิม');
  await page.locator('#desk-stage [data-act="item-more"]').click();
  await page.getByRole('menuitem', { name: 'แก้ปัญหารายการนี้', exact: true }).click();
  await page.locator('#desk-controls .workflow-choice').first().waitFor();
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  await page.locator('#desk-stage [data-act="item-more"]').click();
  await page.getByRole('menuitem', { name: 'รายละเอียดและปุ่มทั้งหมด', exact: true }).click();
  check(await page.locator('#desk-controls #reviewpanel').count() === 1, 'ปุ่มเดิมทั้งหมดต้องเปิดได้บนโต๊ะ');
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await setScheme(dark);
    check(await page.evaluate(() => {
      const pane = document.getElementById('desk-controls'), body = pane.querySelector('.body'), r = pane.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && body.scrollWidth <= body.clientWidth + 1;
    }), 'แผงปุ่มทั้งหมดล้น: ' + width + '/' + dark);
  }
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  check(await page.locator('#worklayout #reviewpanel').count() === 1, 'ปิดแล้วต้องคืนแผงเดิม');
  const layout = [];
  for (const dark of [false, true]) {
    await setScheme(dark);
    for (const width of [1120, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => {
        const dock = document.querySelector('#desk-stage .dock'), r = dock.getBoundingClientRect();
        return dock.scrollWidth > dock.clientWidth + 1 || r.left < 0 || r.right > innerWidth || document.documentElement.scrollWidth > innerWidth;
      });
      check(!overflow, 'แท่นบิลล้น: ' + width + '/' + dark); layout.push({ width, dark, overflow });
      await page.screenshot({ path: `desk-d2-bill-${dark ? 'dark' : 'light'}-${width}.png` });
    }
  }
  check(writes.length === 0, 'เปิดหน้าต่างต้องไม่เขียนข้อมูลหรือส่ง LINE');
  check(errors.length === 0, 'runtime errors: ' + errors.join(', '));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#desk-stage [data-act="item-more"]').click();
  await page.getByRole('menuitem', { name: 'แก้ยอดบิล', exact: true }).click();
  await page.screenshot({ path: 'desk-d2-controls-dark.png' });
  await page.getByRole('button', { name: 'ปิดตัวเลือก', exact: true }).click();
  await page.locator('#desk-stage [data-act="item-more"]').click();
  await page.evaluate(() => { window.__deskOldMenu = document.querySelector('.desk-pop button'); });
  await page.locator('#desk-strip [data-go^="slip:"]').first().click();
  check(await page.locator('.desk-pop').count() === 0, 'เปลี่ยนงานต้องปิดเมนูเก่า');
  await page.evaluate(() => window.__deskOldMenu.click());
  check(await page.locator('#desk-controls').count() === 0, 'เมนูเก่าต้องไม่เปิดฟอร์มให้งานใหม่');
  await setScheme(false);
  return { passed: true, billId, inventory: billState.inventory, layout, writes, errors };
}
