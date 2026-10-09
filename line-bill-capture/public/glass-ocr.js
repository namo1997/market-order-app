// ไฮไลท์ตัวเลขบนรูปเอกสาร (มุมมอง Liquid Glass / โต๊ะเทียบ บนจอคอม)
// AI เก็บแค่ค่าตัวเลข ไม่ได้เก็บตำแหน่งในรูป ไฟล์นี้จึงใช้ OCR ในเบราว์เซอร์ (Tesseract, ไฟล์อยู่ใน /admin/vendor/tesseract)
// หาตำแหน่งของยอดที่ AI อ่านไว้ แล้ววาดแถบไฮไลท์ทับรูป — อ่านอย่างเดียว ไม่ส่งรูปออกนอกเครื่อง ไม่บันทึกอะไรลงเซิร์ฟเวอร์
(() => {
  const html = document.documentElement;
  const VENDOR = '/admin/vendor/tesseract/';
  const KEY = 'lbc-ocr-v2:';
  const on = () => html.classList.contains('theme-glass') && innerWidth >= 1100;
  const state = () => { try { return (0, eval)('typeof S !== "undefined" ? S : null'); } catch { return null; } };
  const itemOf = id => { const s = state(); return (s?.pool || []).find(x => Number(x.id) === id) || (s?.items || []).find(x => Number(x.id) === id) || (s?.flagItems || []).find(x => Number(x.id) === id) || null; };
  const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ยอดที่ต้องหาในรูปนี้ (ตามประเภทเอกสาร)
  function targetsOf(it) {
    if (!it) return [];
    const slip = /transfer|incoming/.test(it.category || '');
    const v = Number(slip ? it.slip_amount_value : it.bill_total_value);
    const out = [];
    if (Number.isFinite(v) && v >= 1) out.push({ kind: 'amount', value: v, label: (slip ? 'ยอดสลิป ' : 'ยอดบิล ') + fmt(v) });
    const ref = String(it.doc_ref || '').replace(/[\s-]+/g, '');
    if (/^\d{5,}$/.test(ref)) out.push({ kind: 'ref', value: ref, label: (slip ? 'เลขอ้างอิง ' : 'เลขที่ ') + it.doc_ref });
    return out;
  }

  // ── OCR worker (โหลดเมื่อจำเป็นครั้งแรก) ──
  let workerP = null;
  function loadScript(src) { return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('load ' + src)); document.head.append(s); }); }
  function worker() {
    if (!workerP) workerP = (async () => {
      if (!window.Tesseract) await loadScript(VENDOR + 'tesseract.min.js');
      const w = await window.Tesseract.createWorker('eng', 1, {
        workerPath: VENDOR + 'worker.min.js', corePath: VENDOR + 'tesseract-core-simd-lstm.wasm.js', langPath: VENDOR.replace(/\/$/, ''), gzip: true, logger: () => {}
      });
      await w.setParameters({ tessedit_char_whitelist: '0123456789.,-', tessedit_pageseg_mode: '11' });
      return w;
    })().catch(err => { workerP = null; throw err; });
    return workerP;
  }

  // หาคำ/กลุ่มคำที่ตรงกับเป้าหมาย คืนกรอบแบบสัดส่วน 0..1 ของรูป
  function findBoxes(data, targets, W, H) {
    const lines = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => lines.push(l.words || []))));
    const hits = [];
    for (const t of targets) {
      for (const words of lines) {
        for (let i = 0; i < words.length; i++) {
          let txt = '';
          for (let j = i; j < Math.min(words.length, i + 3); j++) {
            txt += words[j].text;
            const clean = txt.replace(/[,\s]/g, '');
            let ok = false;
            if (t.kind === 'amount') {
              // ตรงตัว หรือมีสัญลักษณ์ ฿ นำหน้าที่ OCR อ่านเป็นเลข 8/5/6 หนึ่งตัว
              const want = [t.value.toFixed(2), Number.isInteger(t.value) ? String(t.value) : null, t.value.toFixed(1)].filter(Boolean);
              ok = want.some(w => clean === w || (clean.length === w.length + 1 && clean.endsWith(w) && /^[856]/.test(clean)))
                && (clean.includes('.') || txt.includes(',') || Number.isInteger(t.value));
            } else ok = clean.replace(/\D/g, '').length >= 5 && clean.replace(/\D/g, '') === t.value;
            if (ok) {
              const ws = words.slice(i, j + 1), x0 = Math.min(...ws.map(w => w.bbox.x0)), y0 = Math.min(...ws.map(w => w.bbox.y0)), x1 = Math.max(...ws.map(w => w.bbox.x1)), y1 = Math.max(...ws.map(w => w.bbox.y1));
              hits.push({ kind: t.kind, x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H });
              break;
            }
          }
        }
      }
    }
    return hits;
  }

  const memo = new Map();
  const cacheKey = (id, targets) => KEY + id + ':' + targets.map(t => t.value).join('|');
  const readCache = k => { if (memo.has(k)) return memo.get(k); try { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v) memo.set(k, v); return v; } catch { return null; } };
  const writeCache = (k, v) => { memo.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // คิว: อ่านทีละรูป เฉพาะรูปที่เห็นอยู่
  const queue = []; let busy = false;
  async function pump() {
    if (busy) return; const job = queue.shift(); if (!job) return; busy = true;
    try {
      if (!job.img.isConnected || !on()) { delete job.img.dataset.glOcrId; return; }
      setBadge(job, 'busy', 'กำลังหาตัวเลขในรูป…');
      const w = await worker();
      const { data } = await w.recognize(job.img, {}, { blocks: true });
      const boxes = findBoxes(data, job.targets, job.img.naturalWidth, job.img.naturalHeight);
      writeCache(job.key, { boxes });
      if (job.img.isConnected && on()) draw(job.img, job.targets, boxes);
      else delete job.img.dataset.glOcrId;
    } catch (err) {
      if (job.img.isConnected && on()) setBadge(job, 'miss', 'อ่านตำแหน่งตัวเลขไม่ได้ในเครื่องนี้');
    } finally { busy = false; setTimeout(pump, 0); }
  }

  function host(img) { const p = img.parentElement; p.classList.add('gl-ocr-host'); let o = p.querySelector(':scope > .gl-ocr'); if (!o) { o = document.createElement('div'); o.className = 'gl-ocr'; o.setAttribute('aria-hidden', 'true'); p.append(o); } return o; }
  function setBadge(job, cls, text) { const o = host(job.img); let b = o.querySelector('.gl-ocr-badge'); if (!b) { b = document.createElement('span'); o.append(b); } b.className = 'gl-ocr-badge ' + cls; b.textContent = text; }

  // ผลเทียบระหว่างเอกสารในแผงเดียวกัน: ยอดตรงกัน = เขียว, ต่างกัน = แดง, มีใบเดียว = เหลือง
  function tone(img) {
    const aggregate=img.closest('[data-desk-aggregate-tone]'); if (aggregate) return aggregate.dataset.deskAggregateTone;
    if (img.closest('[data-desk-confirmed]')) return 'ok';
    const scope = img.closest('.pairc') || img.closest('#reviewpanel, #desk-stage'); if (!scope) return 'hl';
    const vals = [...scope.querySelectorAll('img[data-gl-ocr-amount]')].map(i => Number(i.dataset.glOcrAmount));
    if (vals.length < 2) return 'hl';
    return vals.every(v => Math.abs(v - vals[0]) < 0.01) ? 'ok' : 'no';
  }

  function place(img) {
    const o = img.parentElement?.querySelector(':scope > .gl-ocr'); if (!o || !img.naturalWidth) return;
    const pr = img.parentElement.getBoundingClientRect(), ir = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit, nw = img.naturalWidth, nh = img.naturalHeight;
    let sx = ir.width / nw, sy = ir.height / nh, ox = ir.left - pr.left, oy = ir.top - pr.top;
    if (fit === 'contain' || fit === 'scale-down') { const s = Math.min(sx, sy); ox += (ir.width - nw * s) / 2; oy += (ir.height - nh * s) / 2; sx = sy = s; }
    else if (fit === 'cover') { const s = Math.max(sx, sy); ox += (ir.width - nw * s) / 2; oy += (ir.height - nh * s) / 2; sx = sy = s; }
    o.style.left = ox + 'px'; o.style.top = oy + 'px'; o.style.width = nw * sx + 'px'; o.style.height = nh * sy + 'px';
    window.dispatchEvent(new CustomEvent('lbc:ocr-layout', { detail: { id: Number(img.dataset.glOcrId) } }));
  }

  function draw(img, targets, boxes) {
    const o = host(img); o.querySelectorAll('.gl-ocr-box').forEach(x => x.remove());
    const amt = targets.find(t => t.kind === 'amount'); if (amt) img.dataset.glOcrAmount = amt.value;
    const ref = targets.find(t => t.kind === 'ref'); if (ref) img.dataset.glOcrRef = ref.value;
    const t = tone(img);
    boxes.forEach(b => { const d = document.createElement('i'); d.className = `gl-ocr-box ${b.kind} ${b.kind === 'amount' ? t : 'hl'}`; d.style.left = (b.x * 100 - .6) + '%'; d.style.top = (b.y * 100 - .4) + '%'; d.style.width = (b.w * 100 + 1.2) + '%'; d.style.height = (b.h * 100 + .8) + '%'; o.append(d); });
    const found = boxes.some(b => b.kind === 'amount');
    const job = { img };
    if (found) o.querySelector('.gl-ocr-badge')?.remove();
    else if (amt) setBadge(job, 'miss ' + t, amt.label + ' · หาในรูปไม่เจอ');
    place(img);
    // ปรับสีของรูปคู่ที่วาดไว้ก่อนให้ตรงกัน
    (img.closest('.pairc') || img.closest('#reviewpanel, #desk-stage'))?.querySelectorAll('.gl-ocr-box.amount').forEach(x => { x.classList.remove('ok', 'no', 'hl'); x.classList.add(t); });
    // โต๊ะเทียบวาดเส้นหลังกล่องอยู่บนรูปจริงแล้ว ไม่ต้องเดาเวลาที่ OCR เสร็จ
    window.dispatchEvent(new CustomEvent('lbc:ocr', { detail: { id: Number(img.dataset.glOcrId), boxes } }));
  }

  const ro = new ResizeObserver(es => es.forEach(e => place(e.target)));
  const observed = new Set();

  function start(img) {
    const id = Number(img.dataset.glOcrId), targets = targetsOf(itemOf(id)); if (!targets.length) return;
    const key = cacheKey(id, targets), hit = readCache(key);
    const go = () => { if (hit) draw(img, targets, hit.boxes); else { queue.push({ img, targets, key }); pump(); } };
    img.complete && img.naturalWidth ? go() : img.addEventListener('load', go, { once: true });
  }

  function scan() {
    for (const img of observed) if (!img.isConnected) { ro.unobserve(img); observed.delete(img); }
    if (!on()) return;
    document.querySelectorAll('#reviewpanel img, #desk-stage .paper img, #chatlightbox-image, #slip-preview-image, #desk .desk-viewer .dv-wrap img').forEach(img => {
      const m = /\/api\/admin\/items\/(\d+)\/image/.exec(img.getAttribute('src') || ''); if (!m) return;
      if (!img.getBoundingClientRect().width || getComputedStyle(img).visibility === 'hidden') return;
      if (img.getBoundingClientRect().width < 120 && img.closest('.xs-item, .ithumb, .thumb')) return;
      if (img.dataset.glOcrId === m[1]) return;
      img.dataset.glOcrId = m[1]; delete img.dataset.glOcrAmount;
      img.parentElement?.querySelector(':scope > .gl-ocr')?.remove();
      ro.observe(img); observed.add(img); start(img);
    });
  }
  let t = 0; const soon = () => { clearTimeout(t); t = setTimeout(scan, 120); };
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(soon).observe(html, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', soon);
  soon();
})();
