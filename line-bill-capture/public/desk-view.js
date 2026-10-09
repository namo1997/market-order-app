// ตัวเลือกมุมมองของหน้า admin (จำค่าไว้ในเครื่อง): แบบเดิม / Liquid Glass (ธีมทั้งแอป) / โต๊ะเทียบเอกสาร
// โต๊ะเทียบเอกสารใช้ธีม Liquid Glass ด้วย หน้าต่างที่เปิดจากโต๊ะจึงหน้าตาเดียวกัน
// เป็นชั้นแสดงผลอย่างเดียว: ทุกการตัดสินใจเรียกฟังก์ชันเดิมของหน้า admin (update, drawer, askWhy, ปุ่มปิดรอบ)
// จึงใช้กติกา บันทึก และปุ่มย้อนกลับชุดเดียวกับแบบเดิม
(() => {
  const KEY = 'lbc-admin-view';
  const SPRITE = "<svg width=\"0\" height=\"0\" style=\"position:absolute\" aria-hidden=\"true\" id=\"desk-sprite\"><defs>\n<symbol id=\"i-board\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4.5\" width=\"18\" height=\"15\" rx=\"3.5\"/><path d=\"M9.5 4.5v15\"/><path d=\"M5.6 8h1.4M5.6 11h1.4\"/></symbol>\n<symbol id=\"i-prev\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14.5 5.5L8 12l6.5 6.5\"/></symbol>\n<symbol id=\"i-next\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9.5 5.5L16 12l-6.5 6.5\"/></symbol>\n<symbol id=\"i-down\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6.5 9.5L12 15l5.5-5.5\"/></symbol>\n<symbol id=\"i-chat\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4.5c4.7 0 8.5 3 8.5 6.8s-3.8 6.8-8.5 6.8c-.9 0-1.8-.1-2.6-.3L5 19.5l1-3.4C4.4 14.9 3.5 13.2 3.5 11.3 3.5 7.5 7.3 4.5 12 4.5z\"/></symbol>\n<symbol id=\"i-search\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6\"/><path d=\"M15 15l5 5\"/></symbol>\n<symbol id=\"i-ai\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 4c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6z\"/><path d=\"M17.5 14.5c.25 1.6 1 2.35 2.5 2.5-1.5.25-2.25 1-2.5 2.5-.25-1.5-1-2.25-2.5-2.5 1.5-.15 2.25-.9 2.5-2.5z\"/></symbol>\n<symbol id=\"i-lockday\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"2.5\"/><path d=\"M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5\"/></symbol>\n<symbol id=\"i-expense\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z\"/><path d=\"M14 3.5v4h4M9 12h6M9 15.5h6\"/></symbol>\n<symbol id=\"i-more\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><circle cx=\"6\" cy=\"12\" r=\"1.7\"/><circle cx=\"12\" cy=\"12\" r=\"1.7\"/><circle cx=\"18\" cy=\"12\" r=\"1.7\"/></symbol>\n<symbol id=\"i-skip\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 7l6 5-6 5zM12.5 7l6 5-6 5z\"/></symbol>\n<symbol id=\"i-x\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\"><path d=\"M6.5 6.5l11 11M17.5 6.5l-11 11\"/></symbol>\n<symbol id=\"i-check\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 12.5l4.5 4.5L19 7\"/></symbol>\n<symbol id=\"i-done\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M8.3 12.3l2.6 2.6 4.8-5.3\"/></symbol>\n<symbol id=\"i-bill\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z\"/><path d=\"M9 8h6M9 11.5h6M9 15h3.5\"/></symbol>\n<symbol id=\"i-slip\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"6.5\" y=\"2.5\" width=\"11\" height=\"19\" rx=\"2.5\"/><path d=\"M10 10.2l1.5 1.5 2.7-3M10.5 18.5h3\"/></symbol>\n<symbol id=\"i-pair\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.1 1.1\"/><path d=\"M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.1-1.1\"/></symbol>\n<symbol id=\"i-unpair\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15.7 13.5l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.1 1.1M8.3 10.5l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.1-1.1M4 4l16 16\"/></symbol>\n<symbol id=\"i-find\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6\"/><path d=\"M15 15l5 5M8 9h5M8 12h3\"/></symbol>\n<symbol id=\"i-askpay\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.5 3.5L3.5 10l6.5 3 3 6.5z\"/><path d=\"M20.5 3.5L10 13\"/></symbol>\n<symbol id=\"i-cash\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2.5\" y=\"6.5\" width=\"19\" height=\"11\" rx=\"2.5\"/><circle cx=\"12\" cy=\"12\" r=\"2.4\"/><path d=\"M6 12h.01M18 12h.01\" stroke-width=\"2.4\"/></symbol>\n<symbol id=\"i-pages\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"7.5\" y=\"3\" width=\"11\" height=\"14\" rx=\"2\"/><path d=\"M5.5 7v11.5A2.5 2.5 0 0 0 8 21h8\"/></symbol>\n<symbol id=\"i-income\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3.5v10M8 9.5l4 4 4-4\"/><path d=\"M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3\"/></symbol>\n<symbol id=\"i-other\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M6 6l12 12\"/></symbol>\n<symbol id=\"i-image\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3.5\" y=\"5\" width=\"17\" height=\"14\" rx=\"2.5\"/><circle cx=\"9\" cy=\"10\" r=\"1.6\"/><path d=\"M4 17l4.5-4.5 3.5 3.5 2.5-2.5L20 18\"/></symbol>\n<symbol id=\"i-expand\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5L14 10M4.5 19.5L10 14\"/></symbol>\n<symbol id=\"i-scale\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M6.5 9.5h11M6.5 14.5h11\"/></symbol>\n<symbol id=\"i-hash\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><path d=\"M5 9h14M5 15h14M10 4.5L8.5 19.5M15.5 4.5L14 19.5\"/></symbol>\n<symbol id=\"i-clock\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/></symbol>\n<symbol id=\"i-alert\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10.4 4.6a1.8 1.8 0 0 1 3.2 0l7.1 12.6a1.8 1.8 0 0 1-1.6 2.7H4.9a1.8 1.8 0 0 1-1.6-2.7z\"/><path d=\"M12 9.5v4M12 16.6h.01\" stroke-width=\"2.2\"/></symbol>\n<symbol id=\"i-chart\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\"><path d=\"M6 19.5V13M12 19.5V5M18 19.5V9.5\"/></symbol>\n<symbol id=\"i-users\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"9\" cy=\"8.5\" r=\"3.2\"/><path d=\"M3.5 19a5.5 5.5 0 0 1 11 0\"/><circle cx=\"16.8\" cy=\"9.5\" r=\"2.4\"/><path d=\"M16.5 14.2a4.5 4.5 0 0 1 4 4.8\"/></symbol>\n<symbol id=\"i-logout\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M13.5 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4\"/><path d=\"M9.5 8l-4 4 4 4M5.5 12h9\"/></symbol>\n<symbol id=\"i-reread\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2\"/><path d=\"M12 8c.3 2 1.3 3 3.3 3.3-2 .3-3 1.3-3.3 3.3-.3-2-1.3-3-3.3-3.3 2-.3 3-1.3 3.3-3.3z\"/></symbol>\n<symbol id=\"i-refresh\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19 12a7 7 0 1 1-2-4.9\"/><path d=\"M19 4.5V8h-3.5\"/></symbol>\n<symbol id=\"i-docq\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7.5 3.5h6.5l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z\"/><path d=\"M10.2 11a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.7.5-.7 1v.3M12 17h.01\"/></symbol>\n<symbol id=\"i-coupon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3.5 12.4V5a1.5 1.5 0 0 1 1.5-1.5h7.4l8.1 8.1a1.5 1.5 0 0 1 0 2.1l-6.8 6.8a1.5 1.5 0 0 1-2.1 0z\"/><circle cx=\"8\" cy=\"8\" r=\"1.3\"/></symbol>\n<symbol id=\"i-notbuy\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M6 6l12 12\"/></symbol>\n<symbol id=\"i-swap\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 8.5h14M15 5l3.5 3.5L15 12M19.5 15.5h-14M9 12l-3.5 3.5L9 19\"/></symbol>\n<symbol id=\"i-pencil\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5z\"/><path d=\"M14 6.5l3.5 3.5\"/></symbol>\n<symbol id=\"i-batch\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3.5\" y=\"8\" width=\"13\" height=\"12.5\" rx=\"2.5\"/><path d=\"M7 5h10.5A2.5 2.5 0 0 1 20 7.5V17\"/></symbol>\n<symbol id=\"i-teach\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 9.5L12 5l9.5 4.5L12 14z\"/><path d=\"M6.5 11.5v4c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4M21.5 9.5v5\"/></symbol>\n<symbol id=\"i-info\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v5.5M12 7.8h.01\" stroke-width=\"2.2\"/></symbol>\n<symbol id=\"i-sun\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4\"/></symbol><symbol id=\"i-moon\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z\"/></symbol><symbol id=\"i-auto\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 3.5a8.5 8.5 0 0 1 0 17z\" fill=\"currentColor\" stroke=\"none\"/></symbol></defs></svg>\n";
  const MODES = [['classic', 'แบบเดิม', 'board'], ['glass', 'Liquid Glass', 'ai'], ['desk', 'โต๊ะเทียบ', 'pair']];
  const read = () => { try { const v = localStorage.getItem(KEY); return MODES.some(m => m[0] === v) ? v : 'classic'; } catch { return 'classic'; } };
  let mode = read();
  const SCHEMES = [['auto', 'ตามเครื่อง', 'auto'], ['light', 'สว่าง', 'sun'], ['dark', 'มืด', 'moon']];
  let scheme = (() => { try { const v = localStorage.getItem('lbc-admin-scheme'); return SCHEMES.some(x => x[0] === v) ? v : 'auto'; } catch { return 'auto'; } })();
  const osDark = matchMedia('(prefers-color-scheme: dark)');
  const save = v => { mode = typeof v === 'string' ? v : (v ? 'desk' : (mode === 'desk' ? 'glass' : mode)); try { localStorage.setItem(KEY, mode); } catch {} };
  let inner = false, on = mode === 'desk', cur = null, picked = null, busy = false, chatOpen = false, lastSig = '';
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const I = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));
  const hhmm = x => { const t = Number(x?.event_timestamp_ms); return t ? new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : ''; };
  const img = id => `/api/admin/items/${Number(id)}/image`;

  document.body.insertAdjacentHTML('beforeend', SPRITE);
  const root = document.createElement('div');
  root.id = 'desk'; root.hidden = true; root.setAttribute('aria-label', 'โต๊ะเทียบเอกสาร');
  root.innerHTML = `<div class="wall" aria-hidden="true"></div>
  <header class="top">
    <span class="lg cap" id="desk-views"></span>
    <span class="lg cap"><button class="gbtn sq" id="desk-prev" data-tip="วันก่อน" aria-label="วันก่อน">${I('prev')}</button><span class="date" id="desk-date"></span><button class="gbtn sq" id="desk-next" data-tip="วันถัดไป" aria-label="วันถัดไป">${I('next')}</button><span class="div"></span><span class="gbtn" id="desk-group" style="cursor:default">${I('chat')}<span></span></span></span>
    <span class="lg meter" data-tip="งานที่เสร็จของวันนี้"><span id="desk-left"></span><span class="tube"><i id="desk-bar"></i></span></span>
    <span class="sp"></span>
    <button class="tg b pill" id="desk-close">${I('lockday')}ปิดรอบ</button>
  </header>
  <main class="stage" id="desk-stage"></main>
  <nav class="lg strip" id="desk-strip" aria-label="คิวงานของวัน"></nav>
  <div id="desk-tip" role="tooltip"></div>`;
  document.body.appendChild(root);
  const $d = id => document.getElementById(id);

  // ── ข้อมูล: ใช้ถังงานเดิมของหน้า ──
  const reviewRows = () => bucketRows('review');
  const docsOf = m => ({ bills: typeof matchBills === 'function' ? matchBills(m) : [pairs(m).bill].filter(Boolean), slips: typeof matchSlips === 'function' ? matchSlips(m) : [pairs(m).slip].filter(Boolean) });
  const simplePair = m => !m.is_group && m.review_type !== 'reimbursement' && pairs(m).bill && pairs(m).slip;
  const same = m => { const { bill, slip } = pairs(m); return Math.abs(Number(amount(bill)) - Number(amount(slip))) < 0.01; };
  const easy = m => simplePair(m) && same(m) && Number(m.score) >= 95;
  const tone = m => !simplePair(m) ? 'mu' : !same(m) ? 'no' : Number(m.score) >= 90 ? 'ok' : 'na';
  const SIDE = [['bill', 'บิลไม่เข้าคู่', 'bill'], ['slip', 'สลิปไม่เข้าคู่', 'slip'], ['needs_amount', 'ต้องแก้ยอด', 'pencil'], ['orphan_page', 'ขาดหน้ายอด', 'pages'], ['batch', 'รอบจ่ายหลายรายการ', 'batch'], ['ai_pending', 'รอ AI อ่าน', 'reread'], ['leftover', 'ตกหล่น', 'docq'], ['other', 'อื่น ๆ', 'other']];
  function queue() {
    const rows = reviewRows(), easyRows = rows.filter(easy);
    const q = [];
    if (easyRows.length >= 2) q.push({ key: 'easy', rows: easyRows });
    rows.filter(m => !(easyRows.length >= 2 && easy(m))).forEach(m => q.push({ key: 'm' + m.id, m }));
    return q;
  }
  const available = () => S.view === 'day' && innerWidth >= 1100 && !$('worklayout')?.hidden;

  // ── วาด ──
  function draw(force) {
    const q = queue();
    const sig = JSON.stringify([S.start, S.source, q.map(x => x.key), SIDE.map(([k]) => bucketRows(k).length), bucketRows('done').length]);
    if (!q.some(x => x.key === cur)) cur = q[0]?.key || null;
    if (cur === 'easy' && !picked) picked = new Set(q[0].rows.map(m => m.id));
    $d('desk-date').textContent = S.start ? new Date(S.start + 'T12:00:00+07:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    $d('desk-group').querySelector('span').textContent = S.source ? group(S.source) : 'ทุกกลุ่ม';
    const open = reviewRows().length + SIDE.filter(([k]) => k !== 'other').reduce((n, [k]) => n + bucketRows(k).length, 0), done = bucketRows('done').length;
    $d('desk-left').textContent = open ? `เหลือ ${open}` : 'ครบ';
    $d('desk-bar').style.width = (done + open ? Math.round(done / (done + open) * 100) : 100) + '%';
    $d('desk-close').disabled = Boolean($('closeday')?.disabled);
    if (!force && sig === lastSig && $d('desk-stage').dataset.cur === String(cur)) { strip(q); return; }
    lastSig = sig;
    stage(q, true);
    strip(q);
  }
  function chatTab() { return `<button class="lg chattab" id="desk-chattab" data-tip="แชท LINE (C)" aria-label="เปิดแชท LINE">${I('chat')}</button><aside class="lg sheet drawer" id="desk-drawer" ${chatOpen ? '' : 'hidden'}><div class="hd">${I('chat')}แชท LINE<button class="gbtn sq" id="desk-chatclose" aria-label="ปิดแชท">${I('prev')}</button></div><div class="body" id="desk-chatbody"></div></aside>`; }
  function paper(x, label, icon) {
    if (!x) return `<div class="paper"><span class="noimg">${I('unpair', 'xl')}ไม่มี${label}</span></div>`;
    return `<div class="paper"><img src="${img(x.id)}" alt="${label} #${x.id}" loading="lazy" data-open="${x.id}" onerror="this.parentNode.classList.add('broken')"><span class="noimg" hidden>${I(icon || 'image', 'xl')}โหลดรูป #${x.id} ไม่ได้</span></div>`;
  }
  function doc(icon, label, list) {
    const x = list[0];
    return `<div class="doc"><div class="tag">${I(icon, 's')}${x ? '#' + x.id : label}<span class="who">${x ? e(senderName(x)) + ' · ' + hhmm(x) : ''}</span>${list.length > 1 ? `<span class="more-docs">+${list.length - 1}</span>` : ''}<span class="sp"></span>${x ? `<span class="lg cap"><button class="gbtn sq" data-open="${x.id}" data-tip="เปิดรูปเต็ม" aria-label="เปิดรูปเต็ม">${I('expand', 's')}</button></span>` : ''}</div>${paper(x, label, icon)}</div>`;
  }
  function stage(q, anim) {
    const S2 = $d('desk-stage'), item = q.find(x => x.key === cur);
    S2.dataset.cur = String(cur);
    let html = '';
    if (!item) {
      const side = SIDE.filter(([k]) => bucketRows(k).length && k !== 'other');
      html = side.length
        ? `<div class="info"><h1>คู่รอตรวจหมดแล้ว</h1><p>ยังมีงานประเภทอื่นค้างอยู่ ${side.map(([, l]) => l).join(', ')} กดที่แถบด้านล่างเพื่อเปิดในมุมมองรายการ</p></div>`
        : `<div class="info"><div class="orb">${I('check')}</div><h1>เคลียร์ครบแล้ว</h1><button class="tg b pill" data-act="close">${I('lockday')}ปิดรอบวันนี้</button></div>`;
    } else if (item.key === 'easy') {
      html = `<div class="batch">${item.rows.map(m => { const { bill, slip } = pairs(m); return `<button class="pairc ${picked.has(m.id) ? 'on' : ''}" data-pick="${m.id}" role="checkbox" aria-checked="${picked.has(m.id)}"><span class="cap2"><span>${e(pairTitle(bill, m))}</span><span>${e(money(amount(bill)))}</span></span>${paper(bill, 'บิล')}${paper(slip, 'สลิป')}<span class="tick">${I('check')}</span></button>`; }).join('')}</div>
      <div class="lg dock"><div class="q"><h1>${item.rows.length} คู่ยอดตรงและ AI มั่นใจ</h1><div class="facts"><span class="fact ok">${I('scale', 's')}ยอดตรงทุกคู่</span><span class="fact">${I('ai', 's')}≥ 95%</span><span class="fact">ดูรูปก่อนกดยืนยัน</span></div></div>
      <div class="acts"><span class="lg cap"><button class="gbtn sq" data-act="skip" data-tip="ข้าม (S)" aria-label="ข้าม">${I('skip')}</button></span><button class="tg g pbtn yes" data-act="all" data-tip="Y" ${picked.size ? '' : 'disabled'}>${I('check')}ยืนยัน ${picked.size} คู่</button></div></div>`;
    } else {
      const m = item.m, { bills, slips } = docsOf(m), b = bills[0], s = slips[0];
      if (!simplePair(m)) {
        html = `<div class="info"><h1>${e(m.review_type === 'reimbursement' ? 'คืนเงินสำรองจ่าย' : 'ชุดรวมเอกสาร')}</h1><p>รายการแบบนี้ต้องดูหลายเอกสารพร้อมกัน เปิดในมุมมองรายการเพื่อตรวจให้ครบ</p><button class="tg b pill" data-act="classic">${I('board')}เปิดในมุมมองรายการ</button></div>`;
      } else {
        const ok = same(m), diff = Number(amount(b)) - Number(amount(s));
        const facts = [ok ? ['ok', 'scale', 'ยอดตรง ' + money(amount(b))] : ['no', 'scale', 'ต่าง ' + money(diff)], ['', 'clock', `${hhmm(b)} → ${hhmm(s)}`], [Number(m.score) >= 90 ? 'ok' : 'na', 'ai', 'AI ' + Math.round(Number(m.score) || 0) + '%']];
        html = `${doc('bill', 'บิล', bills)}${doc('slip', 'สลิป', slips)}
        <div class="lg dock"><div class="q"><h1 title="${e(pairTitle(b, m))}">${e(pairTitle(b, m))}</h1><div class="facts">${facts.map(([c, i, l]) => `<span class="fact ${c}">${I(i, 's')}${e(l)}</span>`).join('')}</div></div>
        <div class="acts"><span class="lg cap"><button class="gbtn sq" data-act="xs" data-tip="ข้อมูลค่าใช้จ่าย" aria-label="ข้อมูลค่าใช้จ่าย">${I('expense')}</button><button class="gbtn sq" data-act="more" data-tip="ตัวเลือกอื่น" aria-label="ตัวเลือกอื่น">${I('more')}</button><button class="gbtn sq" data-act="skip" data-tip="ข้าม (S)" aria-label="ข้าม">${I('skip')}</button></span><button class="pbtn no" data-act="no" data-tip="ไม่ใช่คู่นี้ (N)">${I('x')}ไม่ใช่</button><button class="tg g pbtn yes" data-act="yes" ${ok ? 'data-tip="ยืนยันคู่นี้ (Y)"' : 'disabled data-tip="ยอดไม่ตรง ยืนยันไม่ได้ · ใช้ ⋯ เพื่อแก้ยอดหรือเปลี่ยนคู่"'}>${I('check')}ยืนยัน</button></div></div>`;
      }
    }
    const chatPanel = chatOpen ? document.querySelector('#desk-chatbody .chatpanel') : null;
    S2.innerHTML = chatTab() + html;
    if (chatPanel) $d('desk-chatbody').appendChild(chatPanel);
    if (anim && !calm.matches) { S2.classList.remove('enter'); void S2.offsetWidth; S2.classList.add('enter'); setTimeout(() => S2.classList.remove('enter'), 800); }
    bindStage();
    if (item?.m && simplePair(item.m)) select(item.m, true);
  }
  function strip(q) {
    const s = $d('desk-strip'), prev = s.querySelector('.lens')?.style.transform;
    const tiles = q.map(x => x.key === 'easy'
      ? `<button class="qt ok ${cur === 'easy' ? 'cur' : ''}" data-go="easy" data-tip="คู่ที่ตรงทุกอย่าง"><span class="dot"></span><span class="n">${x.rows.length}</span><span class="pics">${I('pair')}</span><span class="a">ชุดง่าย</span></button>`
      : `<button class="qt ${tone(x.m)} ${cur === x.key ? 'cur' : ''}" data-go="${x.key}" data-tip="${e(pairTitle(pairs(x.m).bill, x.m))}"><span class="dot"></span><span class="pics">${I('bill', 's')}${I('slip', 's')}</span><span class="a">${e(money(amount(pairs(x.m).bill)))}</span></button>`).join('');
    const side = SIDE.filter(([k]) => bucketRows(k).length).map(([k, l, i]) => `<button class="qt mu side" data-bucket="${k}" data-tip="${l} · เปิดในมุมมองรายการ"><span class="n">${bucketRows(k).length}</span><span class="pics">${I(i)}</span><span class="a">${l}</span></button>`).join('');
    const done = bucketRows('done').length;
    s.innerHTML = `<span class="lens" id="desk-lens"></span><span class="count"><b>${reviewRows().length}</b>รอตรวจ</span>${tiles}${side ? '<span class="sep"></span>' + side : ''}${done ? `<span class="sep"></span><button class="qt ok side" data-bucket="done" data-tip="เสร็จแล้ว · เปิดในมุมมองรายการ"><span class="n" style="background:var(--green)">${done}</span><span class="pics">${I('done')}</span><span class="a">เสร็จแล้ว</span></button>` : ''}`;
    s.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (busy || cur === b.dataset.go) return; cur = b.dataset.go; picked = null; stage(queue(), true); strip(queue()); });
    s.querySelectorAll('[data-bucket]').forEach(b => b.onclick = () => openClassic(b.dataset.bucket));
    const lens = $d('desk-lens'), c = s.querySelector('.qt.cur');
    if (!c) { lens.style.opacity = 0; return; }
    if (prev) lens.style.transform = prev;
    const to = `translateX(${c.offsetLeft}px)`;
    if (prev && prev !== to && !calm.matches) { lens.classList.remove('moving'); void lens.offsetWidth; lens.classList.add('moving'); }
    lens.style.transform = to;
    c.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ── การกระทำ: เรียกของเดิมทั้งหมด ──
  function select(m, quiet) {
    if (Number(S.selected) === Number(m.id) && S.bucket === 'review' && !S.completedReview) return;
    S.completedReview = null; S.bucket = 'review'; S.selected = m.id;
    if (!quiet) render(); else { renderBucketsSafe(); }
  }
  function renderBucketsSafe() { inner = true; try { render(); } finally { inner = false; } }
  function current() { return queue().find(x => x.key === cur); }
  function next() { const q = queue(), i = q.findIndex(x => x.key === cur); cur = (q[i + 1] || q[0])?.key || null; picked = null; }
  async function run(fn) { if (busy) return; busy = true; root.querySelectorAll('.dock button').forEach(b => b.disabled = true); try { await fn(); } finally { busy = false; lastSig = ''; draw(true); } }
  function merge() {
    if (calm.matches) return;
    const stg = $d('desk-stage'), r0 = stg.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height * .42;
    stg.querySelectorAll('.doc .paper,.pairc.on').forEach(d => { const r = d.getBoundingClientRect(); d.animate([{ transform: 'none' }, { transform: `translate(${cx - (r.left + r.width / 2)}px,${cy - (r.top + r.height / 2)}px) scale(.12)`, borderRadius: '50%', opacity: .2 }], { duration: 460, easing: 'cubic-bezier(.6,0,.7,.3)', fill: 'forwards' }); });
    stg.querySelectorAll('.dock,.tag').forEach(x => x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' }));
    setTimeout(() => {
      const t = $d('desk-strip').querySelector('.count').getBoundingClientRect(), d = document.createElement('div'), z = 56;
      d.className = 'desk-drop'; Object.assign(d.style, { width: z + 'px', height: z + 'px', left: cx - z / 2 + 'px', top: cy - z / 2 + 'px' }); document.body.appendChild(d);
      d.animate([{ transform: 'scale(.3)' }, { transform: 'scale(1.15,.9)', offset: .25 }, { transform: 'scale(.95,1.05)', offset: .4 }, { transform: `translate(${t.left + t.width / 2 - cx}px,${t.top + t.height / 2 - cy}px) scale(.4)`, offset: 1 }], { duration: 760, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' }).onfinish = () => d.remove();
    }, 420);
  }
  async function act(a, el) {
    const it = current(), m = it?.m;
    if (a === 'classic') return openClassic('review', m?.id);
    if (a === 'close') return $('closeday')?.click();
    if (a === 'skip') { next(); stage(queue(), true); strip(queue()); return; }
    if (a === 'all') return run(async () => {
      const list = it.rows.filter(r => picked.has(r.id)); merge();
      for (const r of list) { select(r); await update(r, 'confirmed'); }
      picked = null; toastSafe(`ยืนยันแล้ว ${list.length} คู่`);
    });
    if (!m) return;
    if (a === 'yes') return run(async () => { if (!same(m)) return; select(m); merge(); await update(m, 'confirmed'); });
    if (a === 'no') return run(async () => { select(m); await update(m, 'rejected'); });
    if (a === 'xs') { select(m); document.querySelector('#reviewpanel .expense-entry-open')?.click(); return; }
    if (a === 'more') return popMenu(el, [
      ['swap', 'เปลี่ยนสลิป', () => { select(m); $('change')?.click(); }],
      ['batch', 'จ่ายรวมหลายใบ', () => { select(m); document.querySelector('#reviewpanel [data-workflow-control="combine-match"],#reviewpanel #combine-match')?.click() || openClassic('review', m.id); }],
      ['fix', 'แก้ปัญหา / แก้ข้อมูล (มุมมองรายการ)', () => openClassic('review', m.id)]
    ]);
  }
  const toastSafe = s => { if (typeof toast === 'function') toast(s); };
  function openClassic(bucket, id) {
    on = false; save(mode === 'desk' ? 'glass' : mode); closeChat();
    S.completedReview = null; S.bucket = bucket;
    const rows = bucketRows(bucket); S.selected = id && rows.some(r => Number(r.id) === Number(id)) ? id : rows[0]?.id ?? null;
    sync(); render(); if (typeof writeDaySelection === 'function') writeDaySelection(true);
  }
  function bindStage() {
    const S2 = $d('desk-stage');
    S2.querySelectorAll('[data-act]').forEach(b => b.onclick = ev => { ev.stopPropagation(); act(b.dataset.act, b); });
    S2.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const id = Number(b.dataset.pick); picked.has(id) ? picked.delete(id) : picked.add(id); stage(queue(), false); });
    S2.querySelectorAll('[data-open]').forEach(b => b.onclick = ev => { ev.stopPropagation(); window.open(img(b.dataset.open), '_blank', 'noopener'); });
    $d('desk-chattab').onclick = () => (chatOpen ? closeChat() : openChat());
    $d('desk-chatclose').onclick = closeChat;
  }

  // ── แชท: ย้ายแผงแชทเดิมเข้ามาในลิ้นชัก แล้วคืนที่เดิมตอนปิด ──
  let chatHome = null;
  function openChat() {
    const panel = document.querySelector('#worklayout .chatpanel') || document.querySelector('.chatpanel');
    if (!panel) return;
    if (!chatHome) chatHome = { parent: panel.parentNode, next: panel.nextSibling };
    chatOpen = true; $d('desk-drawer').hidden = false; $d('desk-chatbody').appendChild(panel);
    if (!calm.matches) { const a = $d('desk-chattab').getBoundingClientRect(), b = $d('desk-drawer').getBoundingClientRect(); $d('desk-drawer').animate([{ clipPath: `inset(${a.top - b.top}px ${b.right - a.right}px ${b.bottom - a.bottom}px 0 round 23px)`, filter: 'blur(8px)' }, { clipPath: 'inset(0 round 30px)', filter: 'blur(0)' }], { duration: 480, easing: 'cubic-bezier(.34,1.3,.64,1)' }); }
  }
  function closeChat() {
    if (chatHome) { const panel = document.querySelector('#desk-chatbody .chatpanel'); if (panel) chatHome.parent.insertBefore(panel, chatHome.next); chatHome = null; }
    chatOpen = false; const d = $d('desk-drawer'); if (d) d.hidden = true;
  }

  // ── เมนูงอกจากปุ่ม ──
  let pop = null;
  function popMenu(btn, items) {
    closePop();
    const m = document.createElement('div'); m.className = 'desk-pop'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([i, l]) => `<button role="menuitem"><span class="ii">${I(i)}</span>${l}</button>`).join('');
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2)) + 'px';
    m.style.top = Math.max(10, r.top - h - 10) + 'px';
    if (!calm.matches) { const b = m.getBoundingClientRect(); m.animate([{ clipPath: `inset(${r.top - b.top}px ${b.right - r.right}px ${b.bottom - r.bottom}px ${r.left - b.left}px round ${r.height / 2}px)`, filter: 'blur(8px)' }, { clipPath: 'inset(0 round 24px)', filter: 'blur(0)' }], { duration: 460, easing: 'cubic-bezier(.34,1.3,.64,1)' }); }
    m.querySelectorAll('button').forEach((b, i) => b.onclick = () => { closePop(); items[i][2](); });
    pop = m; m.querySelector('button')?.focus();
  }
  function closePop() { pop?.remove(); pop = null; }
  document.addEventListener('click', ev => { if (pop && !ev.target.closest('.desk-pop')) closePop(); });

  // ── ป้ายคำอธิบายแบบ macOS ──
  const tip = $d('desk-tip'); let tipEl = null, tipT;
  root.addEventListener('pointerover', ev => {
    const el = ev.target.closest('[data-tip]'); if (el === tipEl) return; clearTimeout(tipT);
    if (!el) { tipEl = null; tip.classList.remove('show'); return; }
    tipT = setTimeout(() => { tipEl = el; tip.textContent = el.dataset.tip; tip.classList.add('show'); const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight; let y = r.bottom + 8; if (y + h > innerHeight - 8) y = r.top - h - 8; tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = y + 'px'; }, 550);
  });
  root.addEventListener('pointerdown', () => { clearTimeout(tipT); tipEl = null; tip.classList.remove('show'); });

  // ── สลับมุมมอง ──
  const iconMap = { 'tab-board': 'board', flagbadge: 'alert', senders: 'users', closeday: 'lockday', 'day-prev': 'prev', 'day-next': 'next', backboard: 'home', confirm: 'check', reject: 'x', change: 'swap' };
  const savedSvg = new Map();
  function decorate() {
    const glass = mode !== 'classic';
    document.documentElement.classList.toggle('theme-glass', glass);
    document.documentElement.classList.toggle('glass-dark', glass && (scheme === 'dark' || (scheme === 'auto' && osDark.matches)));
    document.querySelectorAll('.ritem').forEach(r => {
      const svg = r.querySelector('svg'); if (!svg) return;
      const key = iconMap[r.id] || (/ค่าใช้จ่าย/.test(r.textContent) ? 'chart' : /ออก/.test(r.textContent) ? 'logout' : null);
      if (!key) return;
      if (glass && !svg.dataset.glass) { savedSvg.set(r, svg.innerHTML); svg.innerHTML = `<use href="#i-${key}"/>`; svg.setAttribute('viewBox', '0 0 24 24'); svg.dataset.glass = '1'; svg.style.fill = 'none'; }
      if (!glass && svg.dataset.glass) { svg.innerHTML = savedSvg.get(r) || ''; delete svg.dataset.glass; svg.style.fill = ''; }
    });
    Object.entries(iconMap).forEach(([id, key]) => {
      const b = document.getElementById(id); if (!b || !b.classList.contains('btn')) return;
      const has = b.querySelector(':scope > .gi');
      if (glass && !has) b.insertAdjacentHTML('afterbegin', `<svg class="gi" aria-hidden="true"><use href="#i-${key}"/></svg>`);
      if (!glass && has) has.remove();
    });
  }
  const switchHtml = () => MODES.map(([v, l, i]) => `<button type="button" data-view="${v}" aria-pressed="${mode === v}" title="มุมมอง: ${l}">${I(i)}${l}</button>`).join('')
    + (mode === 'classic' ? '' : (() => { const [, l, i] = SCHEMES.find(x => x[0] === scheme); return `<button type="button" data-scheme title="สี: ${l} (กดเพื่อเปลี่ยน)" aria-label="สี: ${l}">${I(i)}</button>`; })());
  function cycleScheme() {
    const i = SCHEMES.findIndex(x => x[0] === scheme); scheme = SCHEMES[(i + 1) % SCHEMES.length][0];
    try { localStorage.setItem('lbc-admin-scheme', scheme); } catch {}
    decorate(); placeSwitches(); toastSafe('สี: ' + SCHEMES.find(x => x[0] === scheme)[1]);
  }
  osDark.addEventListener('change', () => decorate());
  function setMode(v) {
    save(v); on = mode === 'desk'; lastSig = '';
    if (!on) closeChat();
    sync(); render();
  }
  function placeSwitches() {
    const top = $('ai-menu-toggle')?.closest('.aimenu') || $('ai-menu-toggle');
    if (top && !document.getElementById('view-switch-top')) {
      const w = document.createElement('div'); w.className = 'viewswitch'; w.id = 'view-switch-top'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', 'มุมมอง');
      top.parentNode.insertBefore(w, top);
    }
    document.querySelectorAll('#view-switch-top,#desk-views').forEach(w => { w.innerHTML = switchHtml(); w.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setMode(b.dataset.view)); w.querySelector('[data-scheme]')?.addEventListener('click', cycleScheme); });
  }
  function sync() {
    const show = on && available();
    root.hidden = !show; document.body.classList.toggle('desk-on', show);
    if (show) draw(); else { closeChat(); closePop(); }
    decorate(); placeSwitches();
  }
  function addToggle() {}
  $d('desk-prev').onclick = () => $('day-prev')?.click();
  $d('desk-next').onclick = () => $('day-next')?.click();
  $d('desk-close').onclick = () => $('closeday')?.click();

  // render เดิมทำงานเมื่อข้อมูลหรือการเลือกเปลี่ยน → วาดโต๊ะตามไปด้วย
  const baseRender = render;
  render = function (...args) {
    const out = baseRender.apply(this, args);
    if (!inner) { decorate(); if (on && available() && !busy) draw(); else if (!on || !available()) sync(); }
    return out;
  };
  addEventListener('resize', () => sync());
  new MutationObserver(() => sync()).observe($('worklayout'), { attributes: true, attributeFilter: ['hidden'] });

  // คีย์ลัด (เมื่อไม่มีหน้าต่างอื่นเปิดทับ)
  const dialogOpen = () => [...document.querySelectorAll('.drawerbg,.chatlightbox,[role="dialog"]')].some(x => !x.hidden && x.offsetParent !== null && !root.contains(x));
  document.addEventListener('keydown', ev => {
    if (root.hidden || ev.metaKey || ev.ctrlKey || ev.altKey || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) || ev.target.isContentEditable || dialogOpen()) return;
    const k = ev.key.toLowerCase(), q = s => $d('desk-stage').querySelector(`[data-act="${s}"]`);
    if (k === 'escape') { if (pop) closePop(); else if (chatOpen) closeChat(); return; }
    let hit = true;
    if (k === 'y') (q('yes') || q('all'))?.click();
    else if (k === 'n') q('no')?.click();
    else if (k === 's') q('skip')?.click();
    else if (k === 'c') chatOpen ? closeChat() : openChat();
    else if (k === 'arrowright' || k === 'arrowleft') { const qq = queue(), i = qq.findIndex(x => x.key === cur) + (k === 'arrowright' ? 1 : -1); if (qq[i] && !busy) { cur = qq[i].key; picked = null; stage(qq, true); strip(qq); } }
    else hit = false;
    if (hit) ev.preventDefault();
  });

  addToggle(); sync();
})();
