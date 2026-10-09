// เตรียม desk-baseline.js/css จาก git show HEAD ลง public ของ SSD snapshot เท่านั้นก่อนรัน
async page => {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น loopback preview');
  const base = new URL(page.url()).origin;
  const js = await (await page.request.get(base + '/admin/desk-baseline.js')).text();
  const css = await (await page.request.get(base + '/admin/desk-baseline.css')).text();
  const read = async width => {
    await page.setViewportSize({ width, height: 900 }); await page.reload();
    await page.locator('#reviewpanel #confirm').waitFor(); await page.waitForTimeout(500);
    return page.evaluate(() => ({
      classic: !document.documentElement.classList.contains('theme-glass') && document.getElementById('desk').hidden,
      positions: ['worklayout', 'reviewpanel', 'list', 'chatlist', 'view-switch-top'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), s = getComputedStyle(e); return [id, ...[r.x, r.y, r.width, r.height].map(x => Math.round(x * 10) / 10), s.display, s.fontSize]; }),
      controls: [...document.querySelectorAll('#reviewpanel button')].map(b => [b.id, b.textContent.trim(), b.disabled]),
    }));
  };
  await page.evaluate(() => localStorage.removeItem('lbc-admin-view'));
  const after = {};
  for (const width of [1120, 1280, 1440, 1920]) after[width] = await read(width);
  await page.screenshot({ path: 'desk-classic-after.png' });
  await page.route('**/admin/desk-view.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: js }));
  await page.route('**/admin/desk-view.css', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  const before = {};
  try {
    for (const width of [1120, 1280, 1440, 1920]) before[width] = await read(width);
    await page.screenshot({ path: 'desk-classic-before.png' });
    for (const width of [1120, 1280, 1440, 1920]) {
      if (!after[width].classic || JSON.stringify(before[width]) !== JSON.stringify(after[width])) throw Error('แบบเดิมต่างจาก HEAD: ' + width + '\n' + JSON.stringify({ before: before[width], after: after[width] }));
    }
  } finally { await page.unroute('**/admin/desk-view.js'); await page.unroute('**/admin/desk-view.css'); }
  await page.evaluate(() => localStorage.setItem('lbc-admin-view', 'desk')); await page.reload();
  return { passed: true, widths: [1120, 1280, 1440, 1920], defaultClassic: true, compared: 'positions, typography, controls, disabled states against HEAD' };
}
