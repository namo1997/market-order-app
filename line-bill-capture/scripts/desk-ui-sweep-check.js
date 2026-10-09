// Playwright CLI run-code บน SSD preview: ตรวจหน้าจอ ไม่มี request ตัดสินใจ และแยกชิปในกล่องเลื่อนออกจากปุ่มที่หลุดจอ
async page => {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น loopback preview');
  const base = new URL(page.url()).origin, day = new URL(page.url()).pathname + new URL(page.url()).search;
  const writes = [], errors = [], measurements = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : (writes.push(route.request().url()), route.abort()));
  for (const mode of ['classic', 'glass', 'desk']) for (const scheme of ['light', 'dark']) {
    await page.evaluate(({ mode, scheme }) => { localStorage.setItem('lbc-admin-view', mode); localStorage.setItem('lbc-admin-scheme', scheme); }, { mode, scheme });
    for (const [view, url] of [['day', day], ['board', '/admin?view=board&month=2026-10'], ['flags', '/admin?view=flags']]) {
      await page.goto(base + url); await page.waitForFunction(view => S.view === view && !S.dayLoading, view);
      await page.waitForTimeout(600);
      for (const width of [1280, 1440]) {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 }); await page.waitForTimeout(180);
        const result = await page.evaluate(() => {
          const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > .05; };
          const label = e => (e.id || e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 80);
          const nodes = [...document.querySelectorAll('button,input,select,textarea')].filter(visible), scrollable = [], offscreen = [];
          for (const node of nodes) {
            const r = node.getBoundingClientRect(); if (r.left >= -2 && r.right <= innerWidth + 2) continue;
            let parent = node.parentElement, indicator = null;
            while (parent && parent !== document.body) {
              const s = getComputedStyle(parent);
              if (parent.scrollWidth > parent.clientWidth + 1 && ['auto', 'scroll'].includes(s.overflowX)) {
                const flags = parent.classList.contains('desk-flag-scroll') && parent.parentElement.querySelector('.desk-flag-scroll-next[aria-label]');
                if (flags || s.scrollbarWidth !== 'none') indicator = parent;
                break;
              }
              parent = parent.parentElement;
            }
            (indicator ? scrollable : offscreen).push(label(node));
          }
          const ids = new Map(); document.querySelectorAll('[id]').forEach(e => ids.set(e.id, (ids.get(e.id) || 0) + 1));
          const duplicateIds = [...ids].filter(([, count]) => count > 1).map(([id]) => id);
          const noName = [...document.querySelectorAll('button,a[href],[role="button"]')].filter(visible).filter(e => !(e.textContent.trim() || e.getAttribute('aria-label') || e.title || e.dataset.tip)).map(label);
          const clipped = [...document.querySelectorAll('button,.chip,.pill,h1,h2,h3,label')].filter(visible).filter(e => e.clientWidth && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible').map(label);
          const lowContrast = [];
          // เป็นค่าอ้างอิงเช่น sweep เดิม; พื้นภาพหรือโปร่งใสต้องดูภาพจริง ไม่ใช้ตัดสินผ่าน/ไม่ผ่าน
          const lum = color => { const v = color.match(/[\d.]+/g)?.map(Number); if (!v) return null; const rgb = v.slice(0, 3).map(x => x / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return { value: .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2], alpha: v[3] ?? 1 }; };
          for (const e of [...document.querySelectorAll('body *')].filter(visible)) {
            if (lowContrast.length >= 20 || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
            let parent = e, bg = null, uncertain = false;
            while (parent) { const s = getComputedStyle(parent); uncertain ||= s.backgroundImage !== 'none'; const c = lum(s.backgroundColor); if (c?.alpha > .5) { bg = c.value; uncertain ||= c.alpha < 1; break; } parent = parent.parentElement; }
            const fg = lum(getComputedStyle(e).color); if (bg === null || !fg) continue;
            const ratio = (Math.max(bg, fg.value) + .05) / (Math.min(bg, fg.value) + .05);
            if (ratio < 2.6) lowContrast.push({ text: e.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), uncertain });
          }
          return { actualView: S.view, dark: document.documentElement.classList.contains('glass-dark'), pageHScroll: document.documentElement.scrollWidth > innerWidth + 1, duplicateIds, noName, clipped, offscreen, scrollable, lowContrast };
        });
        measurements.push({ mode, scheme, view, width, ...result });
        if (width === 1280) await page.screenshot({ path: `phase3-${mode}-${scheme}-${view}.png` });
      }
    }
  }
  const failures = measurements.filter(r => r.pageHScroll || r.duplicateIds.length || r.noName.length || r.clipped.length || r.offscreen.length);
  return { passed: !failures.length && !writes.length && !errors.length, measurements, failures, writes, errors, notes: ['classic ไม่มีโหมดมืด', 'contrast เป็นค่าประกอบการดูภาพ พื้น gradient และโลโก้ไม่ใช้ตัดสินอัตโนมัติ', 'ภาพ preview บางรายการไม่มีไฟล์ ไม่รับรองภาพ Production'] };
}
