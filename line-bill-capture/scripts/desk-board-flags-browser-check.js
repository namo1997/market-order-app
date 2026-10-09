// P2/P3 local SSD preview: original handler parity, actual theme switch, read-only server requests.
async page => {
  const check = (ok, text) => { if (!ok) throw Error(text); };
  check(/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()), 'ต้องเป็น loopback preview');
  const baseUrl = new URL(page.url()).origin, errors = [], writes = [], layouts = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl + '/admin?view=board&month=2026-10');
  await page.locator('.desk-calendar-grid .calendar-run').first().waitFor();
  check(await page.evaluate(() => document.body.classList.contains('desk-on') && S.view === 'board'), 'ภาพรวมต้องอยู่บนโต๊ะ');
  check(await page.evaluate(() => {
    const originals = [...document.querySelectorAll('#board a.calendar-run')], copies = [...document.querySelectorAll('#desk-stage .calendar-run')];
    return originals.length === copies.length && copies.every((copy, index) => copy.getAttribute('href') === originals[index].getAttribute('href') && copy.title === originals[index].title);
  }), 'ปฏิทินต้องเก็บลิงก์และ tooltip เดิมครบ');
  check(await page.evaluate(() => {
    const expected = new Map();
    for (const link of document.querySelectorAll('#board a.calendar-run')) {
      if (!/ค้าง\s+[1-9]\d*/.test(link.querySelector('b').textContent)) continue;
      const [date, source] = link.dataset.open.split('|');
      if (!expected.has(source) || date < expected.get(source).date) expected.set(source, { date, href: link.getAttribute('href') });
    }
    const got = [...document.querySelectorAll('[data-resume]')].map(link => link.getAttribute('href')).sort();
    return JSON.stringify(got) === JSON.stringify([...expected.values()].map(x => x.href).sort());
  }), 'ทำต่อ ต้องเป็นวันค้างเก่าสุดแต่ละกลุ่ม');
  const theme = async dark => {
    const label = dark ? 'มืด' : 'สว่าง';
    for (let i = 0; i < 3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: ' + label; i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (dark ? 1 : 0), 'ใช้ปุ่มเลือกสีจริง');
  };
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await theme(dark); await page.waitForTimeout(180);
    const bad = await page.evaluate(() => {
      const root = document.getElementById('desk'), stage = document.getElementById('desk-stage');
      return root.scrollLeft !== 0 || stage.scrollWidth > stage.clientWidth + 1 || [...stage.querySelectorAll('.desk-month-head,.desk-calendar-grid')].some(node => { const r = node.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; });
    });
    check(!bad, `ภาพรวมล้น ${width}/${dark}`); layouts.push({ page: 'board', width, dark, overflow: bad });
    await page.screenshot({ path: `desk-p2-board-${dark ? 'dark' : 'light'}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await theme(false);
  await page.evaluate(() => {
    const alert = document.getElementById('ingest-alert');
    window.__ingestOriginal = { hidden: alert.hidden, title: document.getElementById('ingest-alert-title').textContent, detail: document.getElementById('ingest-alert-detail').textContent, handler: document.getElementById('ingest-alert-open').onclick };
    alert.hidden = false; document.getElementById('ingest-alert-title').textContent = 'แจ้งเตือนทดสอบจาก DOM เดิม'; document.getElementById('ingest-alert-detail').textContent = 'ช่วงข้อมูลรูปเข้าขาด (fixture)';
    window.__ingestCalls = 0; document.getElementById('ingest-alert-open').onclick = () => window.__ingestCalls++;
  });
  await page.locator('#desk-stage [data-system="ingest-alert-open"]').waitFor(); await page.locator('#desk-stage [data-system="ingest-alert-open"]').click();
  check(await page.evaluate(() => {
    const old = window.__ingestOriginal; document.getElementById('ingest-alert').hidden = old.hidden; document.getElementById('ingest-alert-title').textContent = old.title; document.getElementById('ingest-alert-detail').textContent = old.detail; document.getElementById('ingest-alert-open').onclick = old.handler;
    return window.__ingestCalls === 1;
  }), 'แถบเตือนต้องใช้ข้อความและปุ่มเดิม');
  await page.evaluate(() => { window.__monthOld = document.getElementById('month-prev').onclick; window.__monthClick = 0; document.getElementById('month-prev').onclick = () => window.__monthClick++; });
  await page.locator('#desk-stage [data-system="month-prev"]').click();
  check(await page.evaluate(() => { document.getElementById('month-prev').onclick = window.__monthOld; return window.__monthClick === 1; }), 'หัวเดือนต้องเรียกปุ่มเดิม');
  await page.locator('#desk-stage #desk-all-rounds').click();
  check(await page.locator('#desk .controls .round-table-wrap').count() === 1, 'รอบทั้งหมดต้องเป็นตารางเดิมในแผ่นโต๊ะ');
  await page.locator('#desk-controls .hd button').click();
  check(await page.locator('#board .round-table-wrap').count() === 1, 'ต้องคืนตารางเดิมเมื่อปิด');
  await page.locator('#desk-stage .calendar-run').first().click();
  await page.waitForFunction(() => S.view === 'day' && S.pool?.length && !document.getElementById('desk').hidden);
  const fixture = await page.evaluate(() => {
    const row = S.pool.find(item => item.category === 'bill' && item.status === 'downloaded');
    if (!row) throw Error('ไม่มีบิล fixture ของวัน');
    return { ...row, matched_item_id: null, amount_review_flag: 1, announced_amount: Number(row.bill_total_value || 100) + 10 };
  });
  await page.evaluate(() => document.getElementById('backboard').click());
  await page.waitForFunction(() => S.view === 'board' && !!document.querySelector('.desk-calendar-grid'));
  let failFlagLoad = true, failContext = true;
  await page.route('**/api/admin/items?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('flagged') === '1' && failFlagLoad) { failFlagLoad = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture flags load failure' }) }); }
    if (url.searchParams.get('flagged') === '1') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [fixture], pagination: { total: 1 }, flagged_count: 1 }) });
    return route.continue();
  });
  await page.route('**/api/admin/items/*/context?*', route => {
    if (failContext) { failContext = false; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture context load failure' }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { messages: [{ sender_display_name: 'ผู้ส่งจำลอง', message_type: 'text', text: 'แจ้งยอด ' + fixture.announced_amount, event_timestamp_ms: fixture.event_timestamp_ms }] } }) });
  });
  await page.evaluate(() => document.getElementById('flagbadge').click());
  await page.locator('#desk-stage [data-system="retry-flags"]').waitFor(); await page.locator('#desk-stage [data-system="retry-flags"]').click();
  await page.locator('[data-desk-flag]').first().waitFor(); await page.locator('[data-desk-flag]').first().click();
  await page.locator('#desk-stage [data-system="flag-document"]').waitFor();
  await page.locator('.desk-flag-messages button').waitFor(); await page.locator('.desk-flag-messages button').click();
  await page.waitForFunction(() => document.querySelector('.desk-flag-messages')?.textContent.includes('แจ้งยอด'));
  check(await page.evaluate(() => document.body.classList.contains('desk-on') && S.view === 'flags' && document.getElementById('flag-total').closest('#desk-stage') && !document.getElementById('flagbg').hidden), 'ต้องตรวจยอดและฟอร์มจริงอยู่โต๊ะ context guard เดิมยังทำงาน');
  const tabCount = page.context().pages().length;
  await page.locator('#desk-stage .paper img').click(); await page.locator('.desk-viewer').waitFor();
  check((await page.locator('.desk-viewer img').getAttribute('src')).includes('/' + fixture.id + '/image'), 'viewer ต้องเป็นรูป flags ปัจจุบัน');
  await page.keyboard.press('y'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.desk-viewer'));
  check(await page.evaluate(id => S.view === 'flags' && Number(S.flagSelected) === Number(id), fixture.id), 'Esc ต้องปิดรูปและคงรายการ flags');
  await page.locator('#desk-stage .tag [data-open]').click(); await page.locator('.desk-viewer').waitFor();
  await page.locator('.desk-viewer [data-z="close"]').click(); await page.waitForFunction(() => !document.querySelector('.desk-viewer'));
  check(page.context().pages().length === tabCount, 'รูป flags/expand ต้องไม่เปิดแท็บใหม่');
  for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await theme(dark); await page.waitForTimeout(220);
    const bad = await page.evaluate(() => {
      const dock = document.querySelector('.desk-flag-dock'), r = dock.getBoundingClientRect(), root = document.getElementById('desk');
      return dock.scrollWidth > dock.clientWidth + 1 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight || root.scrollLeft !== 0 || document.getElementById('flag-save').getBoundingClientRect().bottom > r.bottom + 1;
    });
    check(!bad, `ตรวจยอดล้น ${width}/${dark}`); layouts.push({ page: 'flags', width, dark, overflow: bad });
    await page.screenshot({ path: `desk-p3-flags-${dark ? 'dark' : 'light'}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await theme(false);
  // ตัวแทน choice และ original save ต้องส่งไป handler เดิมด้วย input เดิม (spy ไม่ยิง POST)
  const initialFlagAmount = await page.locator('#flag-total').inputValue();
  await page.evaluate(() => { window.__flagCalls = []; for (const id of ['flag-document', 'flag-use', 'flag-save']) { const source = document.getElementById(id); source.onclick = () => window.__flagCalls.push([id, document.getElementById('flag-total').value]); } });
  await page.locator('#desk-stage [data-system="flag-document"]').click();
  await page.locator('#desk-stage [data-system="flag-use"]').click();
  await page.locator('#flag-total').fill('125.75'); await page.locator('#flag-save').click();
  check(await page.evaluate(expected => JSON.stringify(window.__flagCalls) === JSON.stringify(expected), [['flag-document', initialFlagAmount], ['flag-use', initialFlagAmount], ['flag-save', '125.75']]), 'choice/save ต้องเรียก handler เดิมไม่แก้ยอดอัตโนมัติ');
  await page.evaluate(() => { document.getElementById('flag-use').disabled = true; });
  await page.waitForFunction(() => document.querySelector('#desk-stage [data-system="flag-use"]').disabled);
  await page.locator('#desk-flag-more').click();
  check(await page.locator('.desk-flag-menu:not([hidden]) [data-system="flag-pair"]').count() === 1, 'เมนูต้องมีจับคู่เอกสารเดิม');
  await page.locator('#desk-flag-details').click();
  check(await page.locator('#desk .controls .flagmeta').count() === 1, 'รายละเอียดต้องเป็น node เดิม');
  await page.locator('#desk-controls .hd button').click();
  await page.evaluate(() => document.getElementById('tab-board').click());
  await page.waitForFunction(() => S.view === 'board' && !!document.querySelector('.desk-calendar-grid'));
  check(await page.evaluate(() => !!document.querySelector('#flagdetail .flagmanual') && !document.querySelector('#desk-stage #flag-total')), 'ออกจาก flags ต้องคืน input เดิม');
  check(errors.length === 0, 'runtime error: ' + errors.join(', ')); check(writes.length === 0, 'ห้ามมี browser writes');
  return { passed: true, layouts, flagsFixtureId: fixture.id, originalHandlerParity: true, originalLoadRetries: true, flagsViewerAndEscape: true, writes, errors };
}
