// ตัวรันทดสอบโต๊ะเทียบ: ใช้ SSD snapshot + descriptor ของ loopback preview เท่านั้น
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { storage } from './ssd-storage.mjs';
import crypto from 'node:crypto';
if (process.env.SOLAO_LOCAL_SIMULATION !== '1') throw Error('ใช้ ssd-workspace.mjs run');
storage.assertSSD();
const source = storage.assertSSDPath(process.cwd()), out = storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const preview = JSON.parse(await fs.readFile(storage.assertSSDPath(process.argv[2]), 'utf8'));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(preview.base_url)) throw Error('ต้องเป็น loopback preview');
const baseline = process.argv[3] ? JSON.parse(await fs.readFile(storage.assertSSDPath(process.argv[3]), 'utf8')) : null;
const suiteNames = ['desk-review-browser-check.js', 'desk-shell-browser-check.js', 'desk-native-form-browser-check.js', 'desk-decision-browser-check.js', 'desk-board-flags-browser-check.js', 'desk-ui-sweep-check.js', 'desk-dialog-browser-check.js'];
const onlySuite = process.argv[4];
if (onlySuite && !suiteNames.includes(onlySuite) && onlySuite !== 'classic-HEAD-parity') throw Error('ชื่อ suite ไม่ถูกต้อง');
const files = ['desk-view.js', 'desk-view.css', 'desk-board-flags.js', 'desk-board-flags.css', 'glass-dock.js', 'glass-dock.css', 'glass-theme.css', 'expense-profile.js', 'expense-glass.js', 'expense-glass.css', 'index.html'];
for (const file of files) {
  const actual = await fetch(preview.base_url + '/admin/' + file);
  if (!actual.ok || Buffer.compare(await fs.readFile(path.join(source, 'public', file)), Buffer.from(await actual.arrayBuffer()))) throw Error('preview ไม่ตรง source snapshot: ' + file);
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || '/Users/surachart/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const sharp = require(path.join(source, 'node_modules/sharp'));
const browser = await chromium.launch({ headless: true }), suites = [], blockedWrites = [], errors = [];
const classicImages = new Map();
process.chdir(out);
async function pageFor({ width = 1440, height = 900, classic = false, useBaseline = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(15000);
  if (classic) await page.addInitScript(() => localStorage.setItem('lbc-admin-view', 'classic'));
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const r = route.request();
    if (!r.url().startsWith(preview.base_url)) return route.abort();
    if (!['GET', 'HEAD'].includes(r.method())) { blockedWrites.push({ method: r.method(), url: r.url() }); return route.abort(); }
    return route.continue();
  });
  if (classic) await page.route('**/api/admin/items/*/image*', async route => {
    // JPEG decoder ของ Chromium อาจเลือกลดขนาด/ปัดเศษไม่เหมือนกันตามจังหวะโหลด
    // เทียบ UI ด้วย pixels ที่ decode เป็น PNG เหมือนกันทั้งสองฝั่ง; ไม่เปลี่ยน source/รูปต้นฉบับ
    const key = new URL(route.request().url()).pathname;
    if (!classicImages.has(key)) {
      const response = await route.fetch(), bytes = await response.body();
      classicImages.set(key, response.ok() && /image\/jpeg/.test(response.headers()['content-type'] || '')
        ? { status: 200, contentType: 'image/png', body: await sharp(bytes).png().toBuffer() }
        : { status: response.status(), contentType: response.headers()['content-type'] || 'application/octet-stream', body: bytes });
    }
    return route.fulfill(classicImages.get(key));
  });
  if (useBaseline) {
    for (const file of files.filter(file => file !== 'index.html')) await page.route('**/admin/' + file, r => r.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : 'text/css', body: baseline[file] ?? '' }));
    if (baseline['index.html']) await page.route(preview.base_url + '/admin?**', r => r.fulfill({status:200,contentType:'text/html',body:baseline['index.html']}));
  }
  await page.goto(preview.admin_url); await page.waitForFunction(() => !S.dayLoading && S.view === 'day');
  return page;
}
try {
  for (const name of onlySuite === 'classic-HEAD-parity' ? [] : onlySuite ? [onlySuite] : suiteNames) {
    const page = await pageFor();
    try {
      const fn = eval('(' + await fs.readFile(path.join(source, 'scripts', name), 'utf8') + ')'), result = await fn(page);
      suites.push({ name, passed: result.passed, result }); console.log(JSON.stringify({ name, passed: result.passed }));
    } catch (error) { suites.push({ name, passed: false, error: error.message }); await page.screenshot({ path: name + '.failure.png' }); console.log(JSON.stringify({ name, passed: false, error: error.message })); }
    await page.close(); await fs.writeFile(path.join(out, 'desk-browser-report.json'), JSON.stringify({ suites }, null, 2));
  }
  if (!onlySuite || onlySuite === 'classic-HEAD-parity') {
  const page = await pageFor(), layouts = [], flags = [];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'glass'); }); await page.reload();
  await page.waitForFunction(() => document.querySelector('#reviewpanel .expense-entry-open'));
  for (const scheme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(scheme => localStorage.setItem('lbc-admin-scheme', scheme), scheme); await page.reload(); await page.waitForFunction(() => document.querySelector('#reviewpanel .expense-entry-open'));
    for (const width of [1120, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(200);
      // จอต่ำกว่า 1181px เรียงแผงลงด้านล่าง: เลื่อนถึงปุ่มตามการใช้งานเดิม
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width < 1181) {
        await page.locator('#reviewpanel .expense-entry-open').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
      }
      const result = await page.evaluate(() => {
        const e = document.querySelector('#reviewpanel .gl-xsjump') || document.querySelector('#reviewpanel .expense-entry-open'), r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { layout: innerWidth < 1181 ? 'stacked, scrolled to action' : 'columns', entry: e.classList.contains('gl-xsjump') ? 'header' : 'original', text: e.textContent.trim(), client: e.clientWidth, scroll: e.scrollWidth, right: r.right, clickable: e.contains(hit) };
      });
      layouts.push({ scheme, width, ...result, passed: result.client >= result.scroll - 1 && result.right <= width && result.clickable });
      await page.screenshot({ path: `expense-fixed-${scheme}-${width}.png` });
    }
  }
  suites.push({ name: 'expense-button-widths', passed: layouts.every(r => r.passed), layouts });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view', 'desk'); localStorage.setItem('lbc-admin-scheme', 'light'); });
  await page.goto(preview.base_url + '/admin?view=flags'); await page.locator('.desk-flag-scroll-next:not(:disabled)').waitFor();
  const track = page.locator('.desk-flag-scroll'); const left = await track.evaluate(e => e.scrollLeft);
  await page.locator('.desk-flag-scroll-next').click(); await page.waitForFunction(() => document.querySelector('.desk-flag-scroll').scrollLeft > 0);
  flags.push({ action: 'right', passed: await track.evaluate(e => e.scrollLeft) > left });
  await page.locator('.desk-flag-scroll-prev').click(); await page.waitForFunction(() => document.querySelector('.desk-flag-scroll').scrollLeft === 0);
  flags.push({ action: 'left', passed: true });
  await page.locator('.desk-flag-chip').last().scrollIntoViewIfNeeded(); await page.locator('.desk-flag-chip').last().click();
  await page.waitForFunction(() => document.querySelector('.desk-flag-scroll .desk-flag-chip:last-child')?.getAttribute('aria-pressed') === 'true');
  flags.push({ action: 'selected-visible', passed: await page.evaluate(() => { const t = document.querySelector('.desk-flag-scroll').getBoundingClientRect(), r = document.querySelector('.desk-flag-chip.sel').getBoundingClientRect(); return r.left >= t.left - 1 && r.right <= t.right + 1 && document.documentElement.scrollWidth <= innerWidth && document.getElementById('desk').scrollLeft === 0; }) });
  await page.screenshot({ path: 'flags-fixed-light-1280.png' });
  suites.push({ name: 'flags-scroll-buttons-and-selection', passed: flags.every(r => r.passed), flags });
  await page.close();
  if (baseline) {
    const comparisons = [];
    for (const width of [1120, 1280, 1440, 1920]) {
      const read = async tag => {
        // เริ่ม browser context ใหม่ที่ขนาดเป้าหมายทั้งก่อน/หลัง ป้องกันภาพย่อจาก cache การย่อจอรอบก่อน
        const p = await pageFor({ width, height: 900, classic: true, useBaseline: tag === 'before' });
        await p.locator('#confirm').waitFor(); await p.waitForTimeout(700);
        await p.waitForLoadState('networkidle');
        await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.querySelectorAll('img')].filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).map(img => img.decode().catch(() => {}))); });
        // โหลด JPEG ที่มองเห็นหลัง font/layout เสร็จแล้วด้วย URL ใหม่ทั้งก่อน/หลัง
        // ป้องกัน Chromium เลือกขนาด JPEG decode ต่างกันระหว่าง layout แรก
        await p.evaluate(async () => { await Promise.all([...document.querySelectorAll('img')].filter(img => { const r=img.getBoundingClientRect(); return r.bottom>0 && r.top<innerHeight && img.src.startsWith(location.origin+'/api/admin/items/'); }).map(async img => { const url=new URL(img.src); url.searchParams.set('classic-parity','settled-layout'); img.src=url.href; await img.decode().catch(()=>{}); })); });
        await p.waitForTimeout(450);
        const state = await p.evaluate(() => ({ classic: !document.documentElement.classList.contains('theme-glass') && document.getElementById('desk').hidden, positions: ['worklayout','reviewpanel','list','chatlist','view-switch-top'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return [id,r.x,r.y,r.width,r.height,getComputedStyle(e).fontSize]; }), imageRects: [...document.querySelectorAll('img')].filter(img=>img.src.startsWith(location.origin+'/api/admin/items/')).map(img=>{const r=img.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];}), controls: [...document.querySelectorAll('#reviewpanel button')].map(b => [b.id,b.textContent.trim(),b.disabled]) }));
        const png = await p.screenshot({ path: `classic-${tag}-${width}.png`, animations: 'disabled' }); const raw = await sharp(png).raw().toBuffer({resolveWithObject:true}), pixels = raw.data;
        let repeat = null;
        if (width === 1920) {
          await p.waitForTimeout(300);
          const repeated = await sharp(await p.screenshot({ path: `classic-${tag}-${width}-repeat.png`, animations: 'disabled' })).raw().toBuffer();
          repeat = { changedChannels: 0, maxChannelDelta: 0 };
          for (let i = 0; i < pixels.length; i++) {
            const delta = Math.abs(pixels[i] - repeated[i]);
            if (delta) repeat.changedChannels++;
            repeat.maxChannelDelta = Math.max(repeat.maxChannelDelta, delta);
          }
        }
        await p.close();
        return { state, pixels, repeat, channels: raw.info.channels, pixelHash: crypto.createHash('sha256').update(pixels).digest('hex') };
      };
      const after = await read('after');
      const before = await read('before');
      let changedChannels = 0, maxChannelDelta = 0, nonImageChangedChannels = 0, nonImageMaxDelta = 0;
      for (let i = 0; i < before.pixels.length; i++) {
        const delta = Math.abs(before.pixels[i] - after.pixels[i]);
        if (delta) changedChannels++;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta) { const pixel=Math.floor(i/before.channels),x=pixel%width,y=Math.floor(pixel/width),insideImage=before.state.imageRects.some(([left,top,right,bottom])=>x>=Math.floor(left)&&x<Math.ceil(right)&&y>=Math.floor(top)&&y<Math.ceil(bottom)); if(!insideImage){nonImageChangedChannels++;nonImageMaxDelta=Math.max(nonImageMaxDelta,delta);} }
      }
      comparisons.push({ width, positionsAndControlsEqual: JSON.stringify(before.state) === JSON.stringify(after.state), pixelEqual: before.pixelHash === after.pixelHash, changedChannels, maxChannelDelta, nonImageChangedChannels, nonImageMaxDelta, ...(width === 1920 ? { samePageRepeat: { before: before.repeat, after: after.repeat } } : {}) });
    }
    // เก็บผลเทียบพิกเซลแบบตรงตัวไว้ด้วย ยอมรับความคลาดเคลื่อนสีจากการวาดไม่เกิน 1/255 สำหรับงานแก้บั๊กนี้
    suites.push({ name: 'classic-HEAD-parity', passed: comparisons.every(r => r.positionsAndControlsEqual && r.nonImageMaxDelta <= 1), comparisons, imageDecoding: 'identical decoded JPEG pixels served as PNG to both sides; originals untouched', acceptance: 'same geometry/controls/image boxes; outside unchanged image bytes allow at most 1/255 compositor rounding; raw full-image deltas retained separately', pixelComparison: comparisons.every(r => r.pixelEqual) ? 'identical' : 'see changedChannels/maxChannelDelta' });
  }
  }
} catch (error) {
  suites.push({ name: 'browser-harness', passed: false, error: error.message });
  console.log(JSON.stringify({ name: 'browser-harness', passed: false, error: error.message }));
} finally {
  await browser.close(); storage.assertSSD();
  const report = { passed: suites.every(s => s.passed) && !blockedWrites.length && !errors.length, source, preview: preview.base_url, suites, blockedWrites, errors };
  await fs.writeFile(path.join(out, 'desk-browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, report: path.join(out, 'desk-browser-report.json') }));
  if (!report.passed) process.exitCode = 1;
}
