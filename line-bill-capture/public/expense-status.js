// ระยะ 3: สถานะข้อมูลค่าใช้จ่ายในคิวงาน ตัวกรอง และหน้าสรุปสำหรับฝ่ายบัญชี (desktop)
// อ่านอย่างเดียวจาก /api/admin/expense-status/*; ไม่แก้ bucketRows/dayWorkCount จึงไม่กระทบเงื่อนไขปิดรอบ
// "ตรวจแล้ว" = ตรวจข้อมูลเอกสารเท่านั้น ไม่ใช่การอนุมัติจ่ายหรือลงบัญชี
(() => {
  const LABEL = { none: 'ยังไม่กรอก', draft: 'ร่าง', reviewed: 'ตรวจแล้ว' };
  const ORDER = ['none', 'draft', 'reviewed'];
  const NOTE = 'สถานะนี้คือการตรวจข้อมูลเอกสารเท่านั้น ไม่ใช่การอนุมัติจ่ายหรือลงบัญชี และไม่มีผลต่อการปิดรอบ';
  const COUNTED = new Set(['bill', 'payment_voucher', 'transfer', 'transfer_notice']);
  const FILTER_BUCKETS = new Set(['review', 'bill', 'slip', 'done', 'needs_amount', 'leftover', 'batch']);
  const CHUNK = 400;
  const cache = new Map();
  let filter = 'all';
  let loadedFor = null, loading = false, pendingReload = false, failed = false;

  const eligible = row => row && row.status !== 'unsent' && row.status !== 'duplicate' && COUNTED.has(row.category);
  const badge = (status, prefix = '') => {
    const span = document.createElement('span');
    span.className = `xs-badge xs-${status}`;
    span.dataset.status = status;
    span.textContent = `${prefix}${LABEL[status]}`;
    span.title = `ข้อมูลค่าใช้จ่าย: ${LABEL[status]} · ${NOTE}`;
    return span;
  };

  // ---------- โหลดสถานะแบบ batch ----------
  async function loadStatuses() {
    if (S.view !== 'day') return;
    const items = (S.pool?.length ? S.pool : S.items || []).filter(eligible);
    const marker = S.items;
    if (loading) { pendingReload = true; return; }
    loading = true; failed = false;
    try {
      const ids = [...new Set(items.map(row => Number(row.id)))];
      for (let at = 0; at < ids.length; at += CHUNK) {
        const response = await api(`/api/admin/expense-status/items?ids=${ids.slice(at, at + CHUNK).join(',')}`);
        for (const [id, value] of Object.entries(response.data || {})) cache.set(Number(id), value.status);
      }
      loadedFor = marker;
    } catch (error) { loadedFor = null; failed = true; if (typeof toast === 'function') toast('โหลดสถานะข้อมูลค่าใช้จ่ายไม่สำเร็จ'); }
    finally {
      loading = false;
      paint();
      if (pendingReload) { pendingReload = false; if (loadedFor !== S.items && !failed) schedule(); }
      else if (!failed && filter !== 'all') rerenderQueue();
    }
  }

  // ---------- สมาชิกของแถวคิว ----------
  const memberIds = (row, bucket) => {
    if (bucket === 'review') {
      if (row.review_type === 'reimbursement') return { bills: [], slips: [] };
      return { bills: matchBills(row).map(x => Number(x.id)), slips: matchSlips(row).map(x => Number(x.id)) };
    }
    if (bucket === 'done') {
      const match = Number(row.cash_payment_id || 0) ? null : confirmedMatchForItem(row.id);
      if (match) return { bills: matchBills(match).map(x => Number(x.id)), slips: matchSlips(match).map(x => Number(x.id)) };
    }
    return COUNTED.has(row.category) && ['transfer', 'transfer_notice'].includes(row.category)
      ? { bills: [], slips: [Number(row.id)] } : { bills: [Number(row.id)], slips: [] };
  };
  const statusesOf = ids => ids.map(id => cache.get(id)).filter(Boolean);
  const allStatuses = (row, bucket) => { const m = memberIds(row, bucket); return [...statusesOf(m.bills), ...statusesOf(m.slips)]; };
  const summarize = list => !list.length ? null : list.every(s => s === list[0]) ? list[0] : 'mixed';

  // ใช้ใน renderList() เท่านั้น (ไม่ผ่าน bucketRows) จึงไม่กระทบ dayWorkCount/outstandingItem
  window.expenseStatusFilterRows = (rows, bucket) => {
    if (S.view !== 'day' || filter === 'all' || !FILTER_BUCKETS.has(bucket) || loadedFor !== S.items) return rows;
    return rows.filter(row => allStatuses(row, bucket).includes(filter));
  };

  // ---------- ป้ายในคิวและหัวรายละเอียด ----------
  const observers = [];
  const mixedBadge = prefix => {
    const span = document.createElement('span');
    span.className = 'xs-badge xs-mixed'; span.dataset.status = 'mixed';
    span.textContent = `${prefix}หลายสถานะ`; span.title = `ข้อมูลค่าใช้จ่าย: หลายสถานะ · ${NOTE}`; return span;
  };
  // บิล+สลิปในแถวเดียว (คู่/ชุดรวม) แสดงแยกบิลกับสลิป; แถวเดี่ยวแสดงสถานะเดียว
  function badgesFor(members, lead) {
    const out = [];
    const part = (name, ids) => {
      const status = summarize(statusesOf(ids));
      if (!status) return;
      const prefix = name ? `${lead}${name}: ` : lead;
      out.push(status === 'mixed' ? mixedBadge(prefix) : badge(status, prefix));
    };
    if (members.bills.length && members.slips.length) { part('บิล', members.bills); part('สลิป', members.slips); }
    else part('', [...members.bills, ...members.slips]);
    return out;
  }
  function paint() {
    if (S.view !== 'day') return;
    mute();
    try {
      const list = $('list'), rows = new Map(bucketRows(S.bucket).map(row => [Number(row.id), row]));
      list.querySelectorAll('.xs-badge,.xs-pair').forEach(el => el.remove());
      const attach = (host, row) => {
        if (!host || !row || (S.bucket === 'review' && row.review_type === 'reimbursement')) return;
        const badges = badgesFor(memberIds(row, S.bucket), 'ข้อมูลค่าใช้จ่าย: ');
        if (!badges.length) return;
        const wrap = document.createElement('span'); wrap.className = 'xs-pair'; wrap.append(...badges); host.append(wrap);
      };
      if (S.bucket === 'review') list.querySelectorAll('.row[data-id]').forEach(el => attach(el.querySelector('.rowmeta'), rows.get(Number(el.dataset.id))));
      else list.querySelectorAll('.irow[data-item]').forEach(el => attach(el.querySelector('.imeta'), rows.get(Number(el.dataset.item))));
      paintHead(rows);
      paintFilter();
    } finally { unmute(); }
  }
  function paintHead(rows) {
    const panel = $('reviewpanel');
    panel.querySelectorAll('.xs-head').forEach(el => el.remove());
    const head = panel.querySelector('.reviewhead');
    if (!head || S.selected == null) return;
    const row = rows.get(Number(S.selected));
    if (!row || (S.bucket === 'review' && row.review_type === 'reimbursement')) return;
    const badges = badgesFor(memberIds(row, S.bucket), 'ข้อมูลค่าใช้จ่าย: ');
    if (!badges.length) return;
    const wrap = document.createElement('span'); wrap.className = 'xs-head xs-pair'; wrap.append(...badges); head.append(wrap);
  }

  // ---------- ตัวกรองสถานะ ----------
  function ensureFilterBar() {
    let bar = $('xs-filter');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'xs-filter'; bar.className = 'xs-filter'; bar.hidden = true;
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'กรองตามสถานะข้อมูลค่าใช้จ่าย');
    $('list').before(bar);
    bar.addEventListener('click', event => {
      const button = event.target.closest('[data-xs-filter]');
      if (!button) return;
      setFilter(button.dataset.xsFilter);
    });
    return bar;
  }
  function paintFilter() {
    const bar = ensureFilterBar();
    const show = S.view === 'day' && FILTER_BUCKETS.has(S.bucket);
    bar.hidden = !show;
    if (!show) return;
    const rows = bucketRows(S.bucket), counts = { none: 0, draft: 0, reviewed: 0 };
    for (const row of rows) for (const status of new Set(allStatuses(row, S.bucket))) counts[status] += 1;
    const ready = loadedFor === S.items;
    bar.replaceChildren();
    const lead = document.createElement('span'); lead.className = 'xs-filter-lead'; lead.textContent = 'ข้อมูลค่าใช้จ่าย';
    bar.append(lead);
    const make = (key, text) => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.xsFilter = key; button.className = `xs-chip${filter === key ? ' on' : ''}`;
      button.setAttribute('aria-pressed', String(filter === key)); button.textContent = text; return button;
    };
    bar.append(make('all', `ทั้งหมด ${rows.length}`));
    for (const status of ORDER) bar.append(make(status, ready ? `${LABEL[status]} ${counts[status]}` : LABEL[status]));
    const note = document.createElement('span'); note.className = 'xs-filter-note'; note.textContent = NOTE;
    bar.append(note);
    const empty = $('list').querySelector('.empty');
    if (empty && filter !== 'all' && rows.length && ready) {
      empty.textContent = `ไม่มีรายการสถานะ “${LABEL[filter]}” ในถังนี้ · กด “ทั้งหมด” เพื่อล้างตัวกรอง`;
    }
  }
  function setFilter(next) {
    filter = ['none', 'draft', 'reviewed'].includes(next) ? next : 'all';
    rerenderQueue();
  }
  function rerenderQueue() { if (S.view === 'day') render(); }

  // ---------- เฝ้าดูการ render ของหน้า ----------
  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (S.view !== 'day') return;
      if (loadedFor !== S.items) loadStatuses(); else paint();
    }, 30);
  }
  function mute() { observers.forEach(o => o.disconnect()); }
  function unmute() { observers.forEach(o => o.observe(o.target, o.options)); }
  function startObserving() {
    for (const [target, options] of [[$('list'), { childList: true, subtree: true }], [$('reviewpanel'), { childList: true }], [$('buckets'), { childList: true }]]) {
      const observer = new MutationObserver(() => schedule());
      observer.target = target; observer.options = options; observer.observe(target, options);
      observers.push(observer);
    }
  }

  // ---------- อัปเดตทันทีเมื่อบันทึก profile สำเร็จ (ไม่แก้ expense-profile.js) ----------
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const match = method === 'PUT' && response.ok ? url.match(/\/api\/admin\/items\/(\d+)\/expense-profile(?:\?|$)/) : null;
      if (match) response.clone().json().then(body => {
        if (body?.data && ['draft', 'reviewed'].includes(body.data.status)) { cache.set(Number(match[1]), body.data.status); schedule(); }
      }).catch(() => {});
    } catch { /* ป้ายสถานะไม่ควรทำให้การบันทึกล้มเหลว */ }
    return response;
  };

  // ---------- หน้าสรุปสำหรับฝ่ายบัญชี ----------
  const dialog = document.createElement('dialog');
  dialog.id = 'xs-summary'; dialog.className = 'xs-dialog'; dialog.setAttribute('aria-labelledby', 'xs-title');
  dialog.innerHTML = `<div class="xs-dhead"><div><h2 id="xs-title">สรุปข้อมูลค่าใช้จ่าย</h2><p class="sub">${NOTE}</p></div><button class="btn" type="button" id="xs-close">ปิด</button></div>
    <form class="xs-controls" id="xs-form"><label>ตั้งแต่<input class="datepick" type="date" id="xs-start" required></label><label>ถึง<input class="datepick" type="date" id="xs-end" required></label><label>กลุ่ม / สาขา<select class="select" id="xs-source"></select></label><button class="btn primary" type="submit" id="xs-load">ดูสรุป</button></form>
    <div class="xs-body" id="xs-body"><p class="muted">เลือกช่วงวันที่แล้วกด “ดูสรุป”</p></div>`;
  let opener = null, summary = null, selection = null;

  const bangkokToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  function openSummary(trigger) {
    opener = trigger || document.activeElement;
    const source = $('xs-source');
    source.innerHTML = '<option value="">ทุกกลุ่ม</option>' + S.groups.map(g => `<option value="${esc(g.source_id)}">${esc(group(g.source_id))}</option>`).join('');
    if (!$('xs-end').value) { const today = bangkokToday(); $('xs-end').value = today; $('xs-start').value = `${today.slice(0, 8)}01`; }
    if (!dialog.open) dialog.showModal();
    $('xs-start').focus();
  }
  function cellButton(count, kind, status, day) {
    const label = `${kind === 'bill' ? 'บิล' : 'สลิป'} ${LABEL[status]}`;
    if (!count) return `<span class="xs-zero" aria-label="${label} 0">0</span>`;
    return `<button type="button" class="xs-cell xs-${status}" data-xs-kind="${kind}" data-xs-status="${status}" ${day ? `data-xs-date="${esc(day.date)}" data-xs-source="${esc(day.source_id)}"` : ''} aria-label="${label} ${count} รายการ${day ? ` วันที่ ${esc(day.date)}` : ''}">${count}</button>`;
  }
  function renderSummary() {
    const body = $('xs-body');
    const t = summary.totals;
    const totalRow = (kind, name) => `<tr><th scope="row">${name}</th>${ORDER.map(s => `<td>${cellButton(t[kind][s], kind, s)}</td>`).join('')}<td class="xs-sum">${t[kind].total}</td></tr>`;
    const days = summary.days.map(day => `<tr><td>${esc(day.date)}</td><td>${esc(group(day.source_id))}</td>${['bill', 'slip'].map(kind => ORDER.map(s => `<td>${cellButton(day[kind][s], kind, s, day)}</td>`).join('')).join('')}<td><button class="btn" type="button" data-xs-open-day="${esc(day.date)}" data-xs-source="${esc(day.source_id)}">เปิดวัน</button></td></tr>`).join('');
    body.innerHTML = `<p class="xs-scope">${esc(summary.scope.start)} ถึง ${esc(summary.scope.end)} · ${summary.scope.source_id ? esc(group(summary.scope.source_id)) : 'ทุกกลุ่ม'}</p>
      <table class="xs-table xs-totals"><caption>จำนวนทั้งช่วง (กดตัวเลขเพื่อดูรายการ)</caption><thead><tr><th></th>${ORDER.map(s => `<th scope="col">${LABEL[s]}</th>`).join('')}<th scope="col">รวม</th></tr></thead><tbody>${totalRow('bill', 'บิล')}${totalRow('slip', 'สลิป')}</tbody></table>
      <p class="xs-rule">นับเฉพาะบิลและสลิปที่ยังใช้งาน ไม่นับรูปที่จัดเป็น “อื่น ๆ” หน้าประกอบ รูปที่ยกเลิกส่ง หรือรูปซ้ำ</p>
      <div class="xs-scroll"><table class="xs-table xs-days"><caption>แยกตามวันและกลุ่ม</caption><thead><tr><th rowspan="2">วันที่</th><th rowspan="2">กลุ่ม</th><th colspan="3">บิล</th><th colspan="3">สลิป</th><th rowspan="2"></th></tr><tr>${[0, 1].map(() => ORDER.map(s => `<th scope="col">${LABEL[s]}</th>`).join('')).join('')}</tr></thead><tbody>${days || '<tr><td colspan="9" class="muted">ไม่มีบิลหรือสลิปในช่วงนี้</td></tr>'}</tbody></table></div>
      <section class="xs-items" id="xs-items" aria-live="polite"></section>`;
    renderItems();
  }
  function renderItems() {
    const box = $('xs-items');
    if (!box) return;
    if (!selection) { box.innerHTML = ''; return; }
    const rows = summary.items.filter(row => row.kind === selection.kind && row.status === selection.status
      && (!selection.date || (row.date === selection.date && row.source_id === selection.source)));
    const title = `${selection.kind === 'bill' ? 'บิล' : 'สลิป'} · ${LABEL[selection.status]}${selection.date ? ` · ${selection.date} · ${group(selection.source)}` : ''}`;
    box.innerHTML = `<h3>${esc(title)} · ${rows.length} รายการ</h3>${summary.items_truncated ? '<p class="xs-rule">รายการยาวเกินกว่าจะแสดงทั้งหมด ตัวเลขด้านบนยังนับครบ ให้ย่อช่วงวันที่หรือเลือกกลุ่มเพื่อดูรายการ</p>' : ''}
      <ul class="xs-list">${rows.map(row => `<li><button type="button" class="xs-item" data-xs-item="${row.id}" data-xs-status="${row.status}"><span class="xs-id">#${row.id}</span><span>${esc(row.date)}</span><span>${esc(group(row.source_id))}</span><span class="xs-amt">${row.amount == null ? '-' : esc(money(row.amount))}</span><span class="xs-ttl">${esc(row.title || '-')}</span><span class="xs-badge xs-${row.status}">${LABEL[row.status]}</span><span class="xs-go">ไปที่รายการ →</span></button></li>`).join('') || '<li class="muted">ไม่มีรายการ</li>'}</ul>`;
    box.scrollIntoView({ block: 'nearest' });
  }
  async function loadSummary(event) {
    event?.preventDefault();
    const params = new URLSearchParams({ start: $('xs-start').value, end: $('xs-end').value });
    if ($('xs-source').value) params.set('source_id', $('xs-source').value);
    const button = $('xs-load'); button.disabled = true; selection = null;
    $('xs-body').innerHTML = '<p class="muted">กำลังโหลด…</p>';
    try { summary = (await api(`/api/admin/expense-status/summary?${params}`)).data; renderSummary(); }
    catch (error) { $('xs-body').innerHTML = `<p class="xs-error" role="alert">${esc(error.message || 'โหลดสรุปไม่สำเร็จ')}</p>`; }
    finally { button.disabled = false; }
  }
  async function goTo(id, status) {
    dialog.close();
    try { await jumpToProcess(Number(id)); filter = status; rerenderQueue(); }
    catch (error) { toast(error.message); }
  }
  dialog.addEventListener('click', async event => {
    if (event.target === dialog) return dialog.close();
    if (event.target.closest('#xs-close')) return dialog.close();
    const cell = event.target.closest('[data-xs-kind]');
    if (cell) {
      selection = { kind: cell.dataset.xsKind, status: cell.dataset.xsStatus, date: cell.dataset.xsDate || '', source: cell.dataset.xsSource || '' };
      dialog.querySelectorAll('.xs-cell.on').forEach(el => el.classList.remove('on')); cell.classList.add('on'); return renderItems();
    }
    const go = event.target.closest('[data-xs-item]');
    if (go) return goTo(go.dataset.xsItem, go.dataset.xsStatus);
    const day = event.target.closest('[data-xs-open-day]');
    if (day) { dialog.close(); try { filter = 'all'; await openDay(day.dataset.xsOpenDay, day.dataset.xsSource); } catch (error) { toast(error.message); } }
  });
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); });

  function installRailButton() {
    const nav = document.querySelector('.railnav');
    if (!nav) return;
    const button = document.createElement('button');
    button.className = 'ritem'; button.id = 'xs-open'; button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg><span class="lb">สรุปข้อมูลค่าใช้จ่าย</span>';
    button.addEventListener('click', () => openSummary(button));
    ($('flagbadge') || nav.lastElementChild).after(button);
  }

  document.body.append(dialog);
  $('xs-form').addEventListener('submit', loadSummary);
  installRailButton();
  startObserving();
  schedule();
})();
