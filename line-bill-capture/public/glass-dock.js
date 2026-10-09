// แท่นปุ่มลอยของมุมมอง Liquid Glass (เฉพาะจอคอม)
// ไม่สร้างการตัดสินใจเอง: ปุ่มบนแท่นและในเมนู ⋯ เป็นตัวแทนที่เรียก .click() ของปุ่มเดิม
// ปุ่มเดิมยังอยู่ใน DOM (แค่ซ่อน) จึงใช้กฎฝั่งเซิร์ฟเวอร์ การย้อนกลับ และบันทึกการตรวจชุดเดิมทั้งหมด
(() => {
  const html = document.documentElement;
  const on = () => html.classList.contains('theme-glass') && !document.body.classList.contains('desk-on') && innerWidth >= 1100;
  // ไอคอนที่ชุดของ desk-view.js ยังไม่มี
  const EXTRA = "<svg width=\"0\" height=\"0\" style=\"position:absolute\" aria-hidden=\"true\" id=\"gl-sprite\"><defs><symbol id=\"i-home\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 10.5L12 4l7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5V15h-5v5.5H6A1.5 1.5 0 0 1 4.5 19z\"/></symbol><symbol id=\"i-eye\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></symbol><symbol id=\"i-save\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 4h10l3.5 3.5V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z\"/><path d=\"M8.5 4v4h6V4M8 20v-5.5h8V20\"/></symbol><symbol id=\"i-subst\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z\"/><path d=\"M14 3.5v4h4\"/><circle cx=\"12\" cy=\"14\" r=\"3\"/><path d=\"M10.8 14l.9.9 1.6-1.7\"/></symbol><symbol id=\"i-wait\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 3.5h10M7 20.5h10M8 3.5v2.3a4 4 0 0 0 8 0V3.5M8 20.5v-2.3a4 4 0 0 1 8 0v2.3\"/></symbol><symbol id=\"i-up\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6.5 14.5L12 9l5.5 5.5\" stroke-width=\"2\"/></symbol></defs></svg>";
  if (!document.getElementById('gl-sprite')) document.body.insertAdjacentHTML('afterbegin', EXTRA);
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
  // รับคีย์ของเมนูก่อน router หน้าเดิม เพื่อให้ Escape ปิดเมนูโดยไม่ย้อนออกจากวันทำงาน
  window.addEventListener('keydown', ev => {
    if (!pop) return;
    if (ev.key === 'Escape') { const a = popFor; closePop(); a?.focus(); ev.preventDefault(); ev.stopImmediatePropagation(); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const items = [...pop.querySelectorAll('button:not([disabled])')], i = items.indexOf(document.activeElement);
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); ev.preventDefault(); ev.stopImmediatePropagation();
    }
  }, true);
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
    const srcs = on() ? [...panel.querySelectorAll('#workflow-guidance button, #classification-box button, #skip-current, .bar .actions button, .expense-entry-open, details > summary')] : [];
    const sig = on() + sigOf(srcs) + '#' + panel.querySelectorAll('.bar').length + '@' + panel.clientWidth + 'x' + panel.clientHeight;
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

    // ปุ่มจัดข้อมูลค่าใช้จ่ายอยู่ท้ายรายการและถูกแท่นปุ่มบัง → เพิ่มปุ่มลัดบนหัวรายละเอียด
    const xsOpen = q('.expense-entry-open'), head = q('.reviewhead');
    if (xsOpen && head && visible(xsOpen) && (xsOpen.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop) > panel.clientHeight - 140) {
      const j = proxy(xsOpen, 'gl-cap plain gl-xsjump', 'จัดข้อมูลค่าใช้จ่าย', 'expense');
      j.dataset.gtip = 'ข้อมูลค่าใช้จ่ายของรายการนี้'; head.append(j);
    }
    const h2 = q('.reviewhead h2'); if (h2 && !h2.title) h2.title = txt(h2);

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
    const hiddenNow = [...box.querySelectorAll('.bucket.zero:not(.active)')].length;
    if (bsig === bucketSig && (!on() || (box.querySelector('.gl-bi') && (!hiddenNow || document.querySelector('.gl-more'))))) return;
    bucketSig = bsig;
    document.querySelectorAll('.gl-more').forEach(x => x.remove());
    const all = [...box.querySelectorAll('.bucket')];
    all.forEach(b => b.classList.toggle('gl-hide', on() && !showEmpty && b.classList.contains('zero') && !b.classList.contains('active')));
    const hiddenN = all.filter(b => b.classList.contains('zero') && !b.classList.contains('active')).length;
    if (on() && hiddenN) {
      const t = showEmpty ? 'ซ่อนถังว่าง' : `แสดงถังว่าง (${hiddenN})`;
      const m = mk('gl-ib gl-more', I(showEmpty ? 'up' : 'down', 's'), t, () => { showEmpty = !showEmpty; bucketSig = ''; buildBuckets(); });
      m.classList.remove('gl-x');
      const bar = document.querySelector('.queuebar'); bar ? bar.append(m) : box.append(m);
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

  // ── แถบบนแถวเดียว: ย้าย #backbar (หัววันทำงาน) เข้าไปใน header.top แล้วจัดลำดับด้วย CSS ──
  // ย้ายทั้ง element (id และ handler เดิมอยู่ครบ) และย้ายกลับเมื่อออกจาก Liquid Glass
  let backHome = null, topSig = '';
  function buildTop() {
    const header = document.querySelector('.canvas > header.top, header.top'), bb = $('backbar'), dc = $('daychrome');
    if (!header || !bb || !dc) return;
    const vs = $('view-switch-top');
    const tsig = on() + '|' + dc.hidden + '|' + (vs ? sigOf([...vs.querySelectorAll('button')]) : '') + '|' + (bb.parentElement === header);
    if (tsig === topSig && (!on() || header.querySelector('.gl-viewbtn'))) return;
    topSig = tsig;
    header.querySelector('.gl-viewbtn')?.remove();
    if (!on()) {
      if (bb.parentElement === header) { dc.insertBefore(bb, dc.firstChild); }
      bb.classList.remove('gl-hide'); vs?.classList.remove('gl-hide'); header.classList.remove('gl-onerow');
      return;
    }
    if (bb.parentElement !== header) header.prepend(bb);
    bb.classList.toggle('gl-hide', dc.hidden);
    header.classList.add('gl-onerow');
    const ai = $('ai'); if (ai) ai.dataset.gtip = txt(ai) + (ai.title ? ' · ' + ai.title : '');
    const am = $('ai-menu-toggle'); if (am) am.dataset.gtip = 'AI ทั้งระบบ · ' + (am.title || '');
    [['closeday', 'ปิดรอบวันนี้'], ['backboard', 'หน้าแรก'], ['day-prev', 'วันก่อน ในกลุ่มเดิม'], ['day-next', 'วันถัดไป ในกลุ่มเดิม'], ['reload', 'โหลดข้อมูลล่าสุด ไม่เรียก AI'], ['logout', 'ออกจากระบบ']].forEach(([id, t]) => { const el = $(id); if (el) { el.dataset.gtip = el.disabled && el.title ? `${t} · ${el.title}` : t; if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', t); } });
    if (vs) {
      vs.classList.add('gl-hide');
      const views = [...vs.querySelectorAll('[data-view]')], sch = vs.querySelector('[data-scheme]');
      const b = mk('gl-ib gl-viewbtn', I('eye'), 'มุมมองและสี', ev => openPop(ev.currentTarget, [
        { title: 'มุมมอง', items: views.map(el => ({ el, label: txt(el), current: el.getAttribute('aria-pressed') === 'true', icon: el.dataset.view === 'classic' ? 'board' : el.dataset.view === 'desk' ? 'pair' : 'ai' })) },
        { title: 'สี', items: sch ? [{ el: sch, label: (sch.getAttribute('aria-label') || 'สี') + ' · กดเพื่อเปลี่ยน', icon: 'auto' }] : [] }
      ], true));
      b.classList.remove('gl-x'); header.append(b);
    }
  }

  // ── แชท: รวมข้อความต่อเนื่องของคนเดียวกัน และย้ายรายละเอียดผู้ส่งไปไว้ในป้ายชี้ ──
  let chatSig = '';
  function buildChat() {
    const log = document.querySelector('#worklayout .chatlog'); if (!log) return;
    const msgs = [...log.querySelectorAll('.chatmsg')];
    const csig = on() + '|' + msgs.length + '|' + (msgs[0] ? uid(msgs[0]) : 0) + '|' + (msgs.at(-1) ? uid(msgs.at(-1)) : 0);
    if (csig === chatSig) return; chatSig = csig;
    let prev = null, prevT = -1;
    msgs.forEach(m => {
      const name = m.querySelector('.chatname'), who = txt(name), time = txt(m.querySelector('.chattime'));
      const [h, mi] = time.split(':').map(Number), t = h * 60 + mi;
      const sameBlock = prev && prev.parentElement === m.parentElement && prev === m.previousElementSibling;
      const cont = on() && sameBlock && who && who === txt(prev.querySelector('.chatname')) && t - prevT >= 0 && t - prevT <= 10;
      m.classList.toggle('gl-cont', !!cont);
      const det = m.querySelector('.expense-sender-details span');
      if (name && det) { if (on()) name.dataset.gtip = txt(det); else delete name.dataset.gtip; }
      prev = m; prevT = t;
    });
  }

  function enhance() {
    if (building) return; building = true;
    try {
      buildBuckets(); buildDock(); buildDayMenu(); buildTop(); buildChat();
      if (popFor && !document.contains(popFor)) closePop();
    } finally { building = false; mo.takeRecords(); }
  }
  let raf = 0; const soon = () => { if (!raf) raf = setTimeout(() => { raf = 0; enhance(); }, 16); };
  // การย่อจอ/เปลี่ยน layout อาจทำให้ปุ่มเดิมตกใต้แท่น แม้ชุดปุ่มต้นทางไม่เปลี่ยน
  const panelResize = new ResizeObserver(soon);
  if ($('reviewpanel')) panelResize.observe($('reviewpanel'));
  const mo = new MutationObserver(recs => { if (building) return; if (recs.some(r => r.type === 'attributes' ? !r.target.classList?.contains('gl-x') : ![...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && (n.classList?.contains('gl-x') || n.classList?.contains('gl-pop'))))) soon(); });
  const watch = () => ['reviewpanel', 'buckets', 'backbar', 'daychrome', 'view-switch-top', 'chatlist'].forEach(id => { const el = $(id); if (el && !el.dataset.glWatch) { el.dataset.glWatch = '1'; mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class'] }); } });
  new MutationObserver(soon).observe(html, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', soon);
  if (typeof render === 'function') { const base = render; render = function (...a) { const r = base.apply(this, a); watch(); soon(); return r; }; }

  // ── แถบย้อนกลับหลังยืนยัน (#undobar ของหน้าเดิม ค้าง 30 วินาที) ──
  // เดิมอยู่กลางล่างจอและบังรายการ: แสดงเต็ม 3 วินาที แล้วหดเป็นปุ่มกลมมุมซ้ายล่าง ชี้/โฟกัสแล้วกางออก
  // เวลาและการย้อนกลับเป็นของหน้าเดิมทั้งหมด (offerUndo / runUndo) ไฟล์นี้เปลี่ยนแค่การแสดงผล
  const undo = $('undobar');
  if (undo) {
    let undoT = 0;
    const expand = () => {
      if (!undo.classList.contains('gl-undo-open')) undo.classList.add('gl-undo-open'); clearTimeout(undoT);
      undoT = setTimeout(() => { if (undo.classList.contains('gl-undo-open')) undo.classList.remove('gl-undo-open'); }, 3000);
      const t = txt($('undotext')), g = t ? `ย้อนกลับ: ${t}` : 'ย้อนกลับ'; if (undo.dataset.gtip !== g) undo.dataset.gtip = g;
    };
    let was = false;
    new MutationObserver(() => {
      const shown = undo.classList.contains('show') && !undo.hidden;
      if (shown && !was) expand();
      // เปลี่ยน class เฉพาะเมื่อต่างจริง: classList.remove/add เขียน attribute ทุกครั้งแม้ค่าเดิม → observer จะวนไม่จบ (หน้าค้าง)
      if (!shown) { if (undo.classList.contains('gl-undo-open')) undo.classList.remove('gl-undo-open'); clearTimeout(undoT); }
      was = shown;
    }).observe(undo, { attributes: true, attributeFilter: ['class', 'hidden'] });
    // ยืนยันรายการใหม่ขณะแถบยังแสดง: ข้อความเปลี่ยน → กางให้เห็นอีกครั้ง
    if ($('undotext')) new MutationObserver(() => { if (was) expand(); }).observe($('undotext'), { childList: true, characterData: true, subtree: true });
  }

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
