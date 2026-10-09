// ตรวจ group filter เดิมบน board/flags หลังปรับ header — GET เท่านั้น
async page => {
  const check = (ok, text) => { if (!ok) throw Error(text); };
  check(/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()), 'ต้องเป็น loopback preview');
  await page.unrouteAll({ behavior: 'wait' });
  const requests = [], writes = [], errors = [], layouts = [], base = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/items' && url.searchParams.get('flagged') === '1') requests.push(url.searchParams.get('source_id') || '');
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.goto(base + '/admin?view=board&month=2026-10');
  await page.locator('.desk-calendar-grid .calendar-run').first().waitFor();
  const options = await page.evaluate(() => [...document.getElementById('group').options].map(option => ({ value: option.value, label: option.textContent })));
  const group = options.find(option => option.value), all = options.find(option => !option.value);
  check(group && all, 'ต้องมีทุกกลุ่มและกลุ่มจริงใน select เดิม');
  await page.evaluate(() => { window.__groupEvents = []; document.getElementById('group').addEventListener('change', () => window.__groupEvents.push([S.view, document.getElementById('group').value])); });
  const choose = async option => {
    await page.locator('#desk-group').click(); await page.locator('.desk-pop button').filter({ hasText: option.label }).first().click();
    await page.waitForFunction(value => document.getElementById('group').value === value && document.getElementById('desk-group').textContent.includes(document.getElementById('group').selectedOptions[0].textContent), option.value);
  };
  await choose(group);
  await page.waitForFunction(value => S.bSource === value && [...document.querySelectorAll('#board .calendar-run')].every(link => link.dataset.open.split('|')[1] === value), group.value);
  await choose(all);
  await page.waitForFunction(() => S.bSource === '' && new Set([...document.querySelectorAll('#board .calendar-run')].map(link => link.dataset.open.split('|')[1])).size > 1);
  await page.evaluate(() => document.getElementById('flagbadge').click());
  await page.waitForFunction(() => S.view === 'flags' && document.body.classList.contains('desk-on'));
  await choose(group);
  await page.waitForFunction(value => S.flagSource === value, group.value);
  await page.waitForTimeout(250);
  await choose(all); await page.waitForFunction(() => S.flagSource === ''); await page.waitForTimeout(250);
  check(requests.includes(group.value) && requests.includes(''), 'flags ต้องเรียก loader เดิมด้วย source filter / ทุกกลุ่ม');
  check(await page.evaluate(expected => ['board', 'flags'].every(view => expected.every(value => window.__groupEvents.some(event => event[0] === view && event[1] === value))), [group.value, '']), 'ต้อง dispatch change ของ select จริงทั้งสองหน้า');
  const theme = async dark => {
    const label = dark ? 'มืด' : 'สว่าง';
    for (let i = 0; i < 3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: ' + label; i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (dark ? 1 : 0), 'ต้องใช้ปุ่มเลือกสีจริง');
  };
  for (const view of ['flags', 'board']) {
    if (view === 'board') { await page.evaluate(() => document.getElementById('tab-board').click()); await page.waitForFunction(() => S.view === 'board' && !!document.querySelector('.desk-calendar-grid')); }
    for (const dark of [false, true]) for (const width of [1120, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 }); await theme(dark); await page.mouse.move(0, 0); await page.waitForTimeout(700);
      check(await page.evaluate(() => {
        const header = document.querySelector('#desk > .top'), r = header.getBoundingClientRect(), group = document.getElementById('desk-group'), g = group.getBoundingClientRect();
        return group.getClientRects().length && !group.disabled && r.left >= 0 && r.right <= innerWidth && header.scrollWidth <= header.clientWidth + 1 && g.top >= r.top && g.bottom <= r.bottom + 1;
      }), 'header/group ล้นหรือไม่แสดง ' + view + '/' + width + '/' + dark);
      layouts.push({ view, width, dark, headerAndGroupFit: true });
      if (width === 1440) await page.screenshot({ path: `desk-p23-group-${view}-${dark ? 'dark' : 'light'}-1440.png` });
    }
  }
  check(!writes.length && !errors.length, 'ห้าม writes/runtime errors');
  return { passed: true, groupFilterOriginalChange: true, flagsSourceRequestParity: true, layouts, writes, errors };
}
