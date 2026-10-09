// แท่นปุ่มลอยของมุมมอง Liquid Glass (เฉพาะจอคอม)
// ไม่สร้างการตัดสินใจเอง: ปุ่มบนแท่นและในเมนู ⋯ เป็นตัวแทนที่เรียก .click() ของปุ่มเดิม
// ปุ่มเดิมยังอยู่ใน DOM (แค่ซ่อน) จึงใช้กฎฝั่งเซิร์ฟเวอร์ การย้อนกลับ และบันทึกการตรวจชุดเดิมทั้งหมด
(() => {
  const html = document.documentElement;
  const on = () => html.classList.contains('theme-glass') && !document.body.classList.contains('desk-on') && innerWidth >= 1100;
  const I = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const $ = id => document.getElementById(id);
  const txt = b => (b?.textContent || '').replace(/^✓\s*/, '').replace(/\s+/g, ' ').trim();
  const ICON = [
    [/เปลี่ยนสลิป/, 'swap'], [/จ่ายรวม|หลายสลิป/, 'batch'], [/เทียบและแก้|แก้ยอด|บันทึกยอด/, 'pencil'], [/จับคู่ผิด/, 'unpair'],
    [/ขัดแย้ง/, 'alert'], [/หลักฐาน/, 'docq'], [/หา.*ไม่เจอ/, 'find'], [/คูปอง|ส่วนลด/, 'coupon'], [/ไม่ใช่การซื้อ/, 'notbuy'],
    [/สอน AI|หมายเหตุ|เรียนรู้/, 'teach'], [/ขอโอน/, 'askpay'], [/เงินสด/, 'cash'], [/นี่คือบิล/, 'bill'], [/สลิปจ่าย/, 'slip'],
    [/โอนเข้า/, 'income'], [/อื่น ๆ/, 'other'], [/หาบิล|หาสลิป|เลือก.*ใกล้เคียง|เลือกบิล/, 'find'], [/อ่าน.*ใหม่/, 'reread'],
    [/หยุดอ่าน/, 'wait'], [/พิมพ์/, 'save'], [/ใบแทน/, 'subst'], [/ข้าม|ถัดไปโดยไม่/, 'skip']
  ];
  const iconFor = b => (ICON.find(([r]) => r.test(txt(b))) || [, 'next'])[1];
  const visible = b => b && !b.hidden && !b.closest('[hidden]');

  // ── เมนูลอยที่ไหลออกจากปุ่ม ──
  let pop = null, popFor = null;
  function closePop() { pop?.remove(); pop = null; popFor?.setAttribute('aria-expanded', 'false'); popFor = null; }
  function openPop(anchor, groups, below) {
    if (popFor === anchor) { closePop(); return; }
    closePop();
    const m = document.createElement('div'); m.className = 'gl-pop'; m.setAttribute('role', 'menu');
    groups.filter(g => g.items.length).forEach((g, gi) => {
      if (gi) m.insertAdjacentHTML('beforeend', '<div class="sep"></div>');
      if (g.title) m.insertAdjacentHTML('beforeend', `<h4>${g.title}</h4>`);
      g.items.forEach(o => {
        const it = document.createElement('button'); it.type = 'button'; it.setAttribute('role', 'menuitem');
        it.className = (o.danger ? 'danger ' : '') + (o.current ? 'cur' : '');
        it.disabled = !!o.el?.disabled;
        it.innerHTML = `${I(o.icon || iconFor(o.el))}<span>${o.label || txt(o.el)}${o.sub ? `<small>${o.sub}</small>` : ''}</span>`;
        it.onclick = () => { closePop(); o.run ? o.run() : o.el.click(); };
        m.append(it);
      });
    });
    document.body.append(m); pop = m; popFor = anchor; anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, below ? r.right - w : r.left));
    const y = below || r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.style.setProperty('--ox', (r.left + r.width / 2 - x) + 'px'); m.style.setProperty('--oy', (y > r.top ? 0 : h) + 'px');
    m.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  }
  document.addEventListener('click', ev => { if (pop && !ev.target.closest('.gl-pop') && ev.target.closest('[aria-expanded]') !== popFor) closePop(); }, true);
  document.addEventListener('keydown', ev => {
    if (!pop) return;
    if (ev.key === 'Escape') { const a = popFor; closePop(); a?.focus(); ev.preventDefault(); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const items = [...pop.querySelectorAll('button:not([disabled])')], i = items.indexOf(document.activeElement);
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); ev.preventDefault();
    }
  });
  addEventListener('resize', closePop);

  // ── ปุ่มบนแท่น ──
  const mk = (cls, inner, tip, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'gl-x ' + cls; b.innerHTML = inner; if (tip) { b.dataset.gtip = tip; b.setAttribute('aria-label', tip); } b.onclick = fn; return b; };
  const proxy = (el, cls, label, icon) => { const b = mk(cls, `${I(icon || iconFor(el), 's')}<span>${label || txt(el)}</span>`, el.title || '', () => el.click()); b.disabled = el.disabled; return b; };

  const iconProxy = (el, icon, tip) => { const b = mk('gl-ib', I(icon), tip, () => el.click()); b.disabled = el.disabled; return b; };

  let building = false;
  // ลายเซ็นของปุ่มต้นทาง: สร้างแท่นใหม่เฉพาะเมื่อปุ่มเดิมเปลี่ยนจริง (กันวนกับสคริปต์อื่นที่แก้ DOM ใน panel และไม่ปิดเมนูที่เปิดอยู่)
  const uids = new WeakMap(); let uidN = 0;
  const uid = el => uids.get(el) || (uids.set(el, ++uidN), uidN);
  const sigOf = els => els.map(b => b ? [uid(b), b.id, txt(b), b.disabled, b.hidden, b.className.replace(/\bgl-hide\b/g, '')].join('~') : '-').join('|');
  let dockSig = '';
  function buildDock() {
    const panel = $('reviewpanel'); if (!panel) return;
    const srcs = on() ? [...panel.querySelectorAll('#workflow-guidance button, #classification-box button, #skip-current, .bar .actions button, details > summary')] : [];
    const sig = on() + sigOf(srcs) + '#' + panel.querySelectorAll('.bar').length;
    const live = panel.querySelector('.gl-dock .gl-lead');
    if (sig === dockSig && (live || !on())) return;
    dockSig = sig;
    panel.querySelectorAll('.gl-x,.gl-dock-own').forEach(x => x.remove());
    panel.querySelectorAll('.gl-hide').forEach(x => x.classList.remove('gl-hide'));
    panel.querySelector('.bar.gl-dock')?.classList.remove('gl-dock');
    if (!on()) return;
    const q = s => panel.querySelector(s), qa = s => [...panel.querySelectorAll(s)];
    const more = q('#workflow-more'), problems = q('.workflow-problems'), toolbar = q('.workflow-toolbar');
    const skip = q('#skip-current');
    const pick = q('#selected-pick-bill,#selected-pick-slip');
    const promote = ['#selected-request-transfer', '#confirm-cash-payment'].map(s => q(s)).filter(visible);
    const typeBtns = more ? [...more.querySelectorAll('#classification-box button')] : [];
    const moreBtns = more ? [...more.querySelectorAll('.workflow-more-body button')].filter(b => b !== skip && !typeBtns.includes(b) && !promote.includes(b) && visible(b)) : [];
    const probBtns = problems ? [...problems.querySelectorAll('button')].filter(visible) : [];
    const teach = qa('details > summary').find(s => /สอน AI|หมายเหตุ/.test(s.textContent))?.parentElement;
    const actions = q('.bar .actions');
    if (!skip && !pick && !moreBtns.length && !probBtns.length && !typeBtns.length && !actions) return;

    let bar = q(':scope > .bar') || q('.bar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'bar gl-dock-own'; panel.append(bar); }
    bar.classList.add('gl-dock');
    const lead = document.createElement('div'); lead.className = 'gl-x gl-lead';
    const tail = document.createElement('div'); tail.className = 'gl-x gl-tail';

    const groups = [{ title: 'ตัวเลือกอื่น', items: moreBtns.map(el => ({ el })) }, { title: 'แก้ปัญหารายการนี้', items: probBtns.map(el => ({ el })) }];
    if (teach) groups.push({ title: '', items: [{ label: txt(teach.querySelector('summary')), icon: 'teach', run: () => { teach.open = true; teach.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); teach.querySelector('textarea,input')?.focus({ preventScroll: true }); } }] });
    if (groups.some(g => g.items.length)) lead.append(mk('gl-ib', I('more'), 'ตัวเลือกอื่นและแก้ปัญหา', ev => openPop(ev.currentTarget, groups)));
    if (typeBtns.length) {
      const cur = typeBtns.find(b => b.classList.contains('current'));
      lead.append(mk('gl-cap plain gl-type', `${I(cur ? iconFor(cur) : 'other', 's')}${I('down', 's')}`, `ประเภท: ${cur ? txt(cur).replace('นี่คือ', '') : 'ยังไม่ระบุ'} · กดเพื่อเปลี่ยน`,
        ev => openPop(ev.currentTarget, [{ title: 'ประเภทเอกสาร', items: typeBtns.filter(b => b.id !== 'selected-not-document').map(el => ({ el, current: el.classList.contains('current') })) }, { title: '', items: typeBtns.filter(b => b.id === 'selected-not-document').map(el => ({ el, sub: 'ไม่ใช่เอกสารการเงิน' })) }])));
    }
    if (skip) lead.append(iconProxy(skip, 'skip', 'ข้าม · ดูรายการถัดไปโดยไม่ตัดสินใจ'));
    promote.forEach(el => tail.append(iconProxy(el, /โอน/.test(txt(el)) ? 'askpay' : 'cash', /โอน/.test(txt(el)) ? 'ส่งขอโอนเข้า LINE' : 'บันทึกว่าจ่ายเป็นเงินสดแล้ว')));
    if (pick) tail.append(proxy(pick, 'gl-cap blue'));
    bar.querySelectorAll(':scope > span:not(.gl-x)').forEach(x => { if (x.textContent.trim()) x.dataset.gtip = x.textContent.trim(); });
    bar.prepend(lead);
    if (actions) actions.before(tail); else bar.append(tail);

    // ซ่อนตัวจริงที่มีตัวแทนแล้ว
    [more, problems, pick, skip].forEach(x => x && x.classList.add('gl-hide'));
    if (toolbar && ![...toolbar.children].some(c => !c.classList.contains('gl-hide'))) toolbar.classList.add('gl-hide');
    promote.forEach(x => x.classList.add('gl-hide'));
  }

  // ── ถังงาน: ไอคอน + ตัวเลข ขนาดเท่ากัน ไม่ขยับเมื่อเลือก ──
  const BI = { review: 'pair', ai_pending: 'reread', needs_amount: 'pencil', orphan_page: 'pages', batch: 'batch', slip: 'slip', bill: 'bill', leftover: 'docq', done: 'done', other: 'other' };
  let showEmpty = false;
  let bucketSig = '';
  function buildBuckets() {
    const box = $('buckets'); if (!box) return;
    const bsig = on() + '|' + showEmpty + '|' + [...box.querySelectorAll('.bucket[data-bucket]')].map(b => b.dataset.bucket + b.className.replace(/\bgl-hide\b/g, '') + (b.querySelector('b')?.textContent || '')).join(',');
    if (bsig === bucketSig && (!on() || box.querySelector('.gl-bi'))) return;
    bucketSig = bsig;
    box.querySelector('.gl-more')?.remove();
    const all = [...box.querySelectorAll('.bucket')];
    all.forEach(b => b.classList.toggle('gl-hide', on() && !showEmpty && b.classList.contains('zero') && !b.classList.contains('active')));
    const hiddenN = all.filter(b => b.classList.contains('zero') && !b.classList.contains('active')).length;
    if (on() && hiddenN) {
      const t = showEmpty ? 'ซ่อนถังว่าง' : `แสดงถังว่าง (${hiddenN})`;
      const m = mk('bucket gl-more', I(showEmpty ? 'up' : 'down', 's'), t, () => { showEmpty = !showEmpty; buildBuckets(); });
      m.classList.remove('gl-x'); box.append(m);
    }
    all.forEach(b => {
      const label = [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || b.dataset.label || '';
      if (label) b.dataset.label = label;
      const n = b.querySelector('b')?.textContent || '0';
      if (on()) {
        if (!b.querySelector('.gl-bi')) b.insertAdjacentHTML('afterbegin', `<svg class="ic s gl-bi" aria-hidden="true"><use href="#i-${BI[b.dataset.bucket] || 'other'}"/></svg>`);
        b.dataset.gtip = `${label} · ${n}`; b.setAttribute('aria-label', `${label} ${n} รายการ`);
      } else { b.querySelector('.gl-bi')?.remove(); delete b.dataset.gtip; b.removeAttribute('aria-label'); }
    });
  }

  // ── หัววันทำงาน: งานของรอบ (อ่านใหม่ · หยุดอ่าน · พิมพ์สรุป) รวมเป็น ⋯ ──
  let daySig = '';
  function buildDayMenu() {
    const bar = $('backbar'); if (!bar) return;
    const dsig = on() + sigOf([$('reread'), $('pause-ai'), $('printday'), $('closeday')]);
    if (dsig === daySig && (!on() || bar.querySelector('.gl-daymore'))) return;
    daySig = dsig;
    bar.querySelector('.gl-daymore')?.remove();
    const items = [$('reread'), $('pause-ai'), $('printday')].filter(Boolean);
    items.forEach(x => x.classList.remove('gl-hide'));
    if (!on()) return;
    const close = $('closeday');
    const b = mk('gl-ib gl-daymore', I('more'), 'รอบนี้: อ่านใหม่ · หยุดอ่าน · พิมพ์สรุป', ev => openPop(ev.currentTarget, [{ title: 'รอบนี้', items: items.filter(visible).map(el => ({ el, sub: el.id === 'reread' ? 'ล้างผลเดิมแล้วอ่านใหม่ · ใช้ token' : '' })) }], true));
    b.classList.remove('gl-x');
    close ? close.before(b) : bar.append(b);
    items.forEach(x => x.classList.add('gl-hide'));
  }

  function enhance() {
    if (building) return; building = true;
    try {
      buildBuckets(); buildDock(); buildDayMenu();
      if (popFor && !document.contains(popFor)) closePop();
    } finally { building = false; mo.takeRecords(); }
  }
  let raf = 0; const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; enhance(); }); };
  const mo = new MutationObserver(recs => { if (building) return; if (recs.some(r => ![...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && (n.classList?.contains('gl-x') || n.classList?.contains('gl-pop'))))) soon(); });
  const watch = () => ['reviewpanel', 'buckets', 'backbar'].forEach(id => { const el = $(id); if (el && !el.dataset.glWatch) { el.dataset.glWatch = '1'; mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class'] }); } });
  new MutationObserver(soon).observe(html, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', soon);
  if (typeof render === 'function') { const base = render; render = function (...a) { const r = base.apply(this, a); watch(); soon(); return r; }; }

  // ── ป้ายคำอธิบายแบบ macOS (หน่วง ~550ms) ──
  const tip = document.createElement('div'); tip.className = 'gl-tip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip);
  let tipEl = null, tipT = 0;
  document.addEventListener('pointerover', ev => {
    const el = on() ? ev.target.closest('[data-gtip]') : null; if (el === tipEl) return; clearTimeout(tipT); tipEl = null; tip.classList.remove('show');
    if (!el) return;
    tipT = setTimeout(() => { tipEl = el; tip.textContent = el.dataset.gtip; tip.classList.add('show'); const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight; let y = r.bottom + 8; if (y + h > innerHeight - 8) y = r.top - h - 8; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = y + 'px'; }, 550);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipT); tipEl = null; tip.classList.remove('show'); }, true);

  // หยดน้ำตอนกด
  document.addEventListener('pointerdown', ev => {
    const b = on() && ev.target.closest('.gl-x button, button.gl-x, .gl-cap, .gl-ib, #reviewpanel .bar .btn');
    if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = b.getBoundingClientRect(), d = document.createElement('span'); d.className = 'gl-drop';
    d.style.left = (ev.clientX - r.left) + 'px'; d.style.top = (ev.clientY - r.top) + 'px'; b.append(d); setTimeout(() => d.remove(), 600);
  });

  watch(); enhance();
})();
