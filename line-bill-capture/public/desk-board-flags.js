/* P2/P3: โต๊ะภาพรวมเดือนและตรวจยอด ใช้ state/DOM/handler ของหน้าเดิมเท่านั้น */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const sourceLinks = () => [...document.querySelectorAll('#board a.calendar-run[data-open]')];
  const pendingOf = link => Number(/ค้าง\s+(\d+)/.exec(link.querySelector('b')?.textContent || '')?.[1] || 0);
  const enabled = id => { const node = byId(id); return !!node && !node.disabled; };
  const originalClick = (node, ev) => {
    if (!node || node.disabled) return;
    if (ev && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)) return;
    ev?.preventDefault(); node.click();
  };
  const linkState = link => link.classList.contains('done') ? 'closed' : link.classList.contains('ready') ? 'ready' : link.classList.contains('imported') ? 'imported' : 'pending';
  const monthRows = () => (S.days || []).filter(row => String(row.business_date || '').startsWith(S.calendarMonth || ''));
  function monthMeter() {
    const rows = monthRows(), count = key => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
    const done = count('confirmed_count'), pending = count('pending_count') + count('unmatched_count') + count('needs_amount_count') + count('processing_count');
    return { done, pending, total: done + pending };
  }
  function boardSignature() {
    const board = byId('board');
    return [S.calendarMonth, S.bSource, board?.querySelector('.month-title')?.textContent, board?.querySelector('.month-calendar')?.innerHTML,
      board?.querySelector('.month-stats')?.textContent, !board?.querySelector('.month-title') ? board?.textContent : '',
      JSON.stringify(monthRows().map(row => [row.business_date, row.source_id, row.closing_status, row.confirmed_count, row.pending_count, row.unmatched_count, row.needs_amount_count, row.processing_count])),
      ['month-prev', 'month-today', 'month-next'].map(id => byId(id)?.disabled).join(','),
      byId('ingest-alert')?.hidden, byId('ingest-alert-title')?.textContent, byId('ingest-alert-detail')?.textContent].join('|');
  }
  function renderBoard(api) {
    const { stage, strip, e, I } = api, board = byId('board');
    const links = sourceLinks(), oldest = new Map();
    for (const link of links) {
      if (!pendingOf(link)) continue;
      const [date, source] = link.dataset.open.split('|'), previous = oldest.get(source);
      if (!previous || date < previous.date) oldest.set(source, { date, link });
    }
    const resume = [...oldest.values()].sort((a, b) => a.date.localeCompare(b.date));
    const stats = [...(board?.querySelectorAll('.month-stat') || [])];
    const meter = monthMeter();
    const alert = byId('ingest-alert'), alertVisible = alert && !alert.hidden;
    stage.classList.add('desk-board-stage'); stage.classList.remove('desk-flag-stage');
    stage.innerHTML = `<section class="desk-month-page">${alertVisible ? `<aside class="desk-ingest lg sheet" role="status"><div><strong>${e(byId('ingest-alert-title')?.textContent)}</strong><p>${e(byId('ingest-alert-detail')?.textContent)}</p></div><button class="gbtn" data-system="ingest-alert-open">เปิดวันที่เริ่มขาด${I('next')}</button></aside>` : ''}
      <header class="desk-month-head"><div><h1>${e(board?.querySelector('.month-title strong')?.textContent || S.calendarMonth || 'ภาพรวมเดือน')}</h1><p>${e(board?.querySelector('.month-title span')?.textContent || '')}</p></div><div class="lg cap"><button class="gbtn sq" data-system="month-prev" aria-label="เดือนก่อน">${I('prev')}</button><button class="gbtn" data-system="month-today">เดือนนี้</button><button class="gbtn sq" data-system="month-next" aria-label="เดือนถัดไป">${I('next')}</button></div><div class="desk-month-meter"><strong>เสร็จ ${meter.done} · ค้าง ${meter.pending}</strong><span class="tube"><i style="width:${meter.total ? meter.done / meter.total * 100 : 0}%"></i></span></div></header>
      <div class="desk-month-stats">${stats.map(stat => `<article><span>${e(stat.querySelector('span')?.textContent)}</span><strong>${e(stat.querySelector('strong')?.textContent)}</strong><small title="${e(stat.querySelector('small')?.textContent)}">${e(stat.querySelector('small')?.textContent)}</small></article>`).join('')}</div>
      <section class="desk-resume"><div class="desk-board-section-title"><h2>ทำต่อจากตรงนี้</h2><span>วันที่ค้างเก่าสุดของแต่ละกลุ่ม</span></div><div class="desk-resume-cards">${resume.length ? resume.map(({ date, link }, index) => `<article class="lg sheet"><div><strong>${e(link.querySelector('span')?.textContent)}</strong><span>${e(date)} · ค้าง ${pendingOf(link)}</span></div><a class="tg b pill" data-resume="${index}" href="${e(link.getAttribute('href'))}" title="${e(link.title)}">เริ่มตรวจ${I('next')}</a></article>`).join('') : '<div class="desk-resume-empty">ไม่มีงานค้างในเดือนนี้</div>'}</div></section>
      <section class="desk-calendar-section"><div class="desk-board-section-title"><h2>ปฏิทินประจำเดือน</h2><div class="desk-calendar-key"><span class="pending">ค้าง</span><span class="ready">พร้อมปิด</span><span class="closed">ปิดแล้ว</span></div><button class="gbtn" id="desk-all-rounds">${I('board')}รอบทั้งหมด</button></div><div class="desk-month-calendar"></div></section></section>`;
    strip.hidden = true; strip.innerHTML = '';
    const calendar = board?.querySelector('.month-calendar');
    if (calendar) {
      const copy = calendar.cloneNode(true); copy.className = 'desk-calendar-grid';
      copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      [...copy.querySelectorAll('a.calendar-run')].forEach((link, index) => {
        const original = links[index]; link.dataset.state = linkState(original);
        link.dataset.tip = original.title; link.onclick = ev => originalClick(original, ev);
        link.removeAttribute('data-open');
      });
      const originalDays = [...calendar.querySelectorAll('.calendar-day')];
      [...copy.querySelectorAll('.calendar-day')].forEach((cell, index) => {
        const original = originalDays[index];
        if (!original?.hasAttribute('data-open-date')) return;
        cell.removeAttribute('data-open-date'); cell.removeAttribute('data-open-source');
        cell.onclick = ev => { if (ev.target.closest('a')) return; originalClick(original, ev); };
        cell.onkeydown = ev => { if (ev.target.closest('a')) return; if (ev.key === 'Enter' || ev.key === ' ') originalClick(original, ev); };
      });
      stage.querySelector('.desk-month-calendar').append(copy);
    } else {
      stage.querySelector('.desk-month-calendar').innerHTML = `<p role="status">${e(board?.textContent || 'กำลังโหลดภาพรวมเดือน…')}</p>`;
    }
    stage.querySelectorAll('[data-system]').forEach(button => { button.disabled = !enabled(button.dataset.system); button.onclick = () => api.systemClick(button.dataset.system); });
    stage.querySelectorAll('[data-resume]').forEach(button => button.onclick = ev => originalClick(resume[Number(button.dataset.resume)]?.link, ev));
    stage.querySelector('#desk-all-rounds').onclick = () => api.openNode(board?.querySelector('.round-table-wrap'), 'รอบทั้งหมด');
    api.annotateTips(stage);
  }

  let heldManual = null;
  function cleanupFlags() {
    if (heldManual) {
      const { node, marker } = heldManual;
      if (marker.isConnected) marker.replaceWith(node); else node.remove();
      heldManual = null;
    }
  }
  function flagsSignature() {
    return JSON.stringify([S.flagSelected, (S.flagItems || []).map(row => [row.id, row.updated_at, row.announced_amount, row.bill_total_value, row.slip_amount_value]), byId('flaglist')?.querySelector('.flagempty')?.textContent, byId('flagchat')?.innerHTML, ['flag-document', 'flag-use', 'flag-save', 'flag-pair', 'retry-flags', 'retry-flag-context'].map(id => [id, !!byId(id), byId(id)?.disabled])]);
  }
  function renderFlags(api) {
    cleanupFlags();
    const { stage, strip, e, I } = api;
    const rows = S.flagItems || [], selected = rows.find(row => Number(row.id) === Number(S.flagSelected));
    stage.classList.remove('desk-board-stage'); stage.classList.add('desk-flag-stage');
    strip.hidden = !rows.length;
    strip.innerHTML = `<span class="desk-flag-queue-title">ต้องตรวจยอด <b>${rows.length}</b></span>${rows.map(row => `<button class="desk-flag-chip ${Number(row.id) === Number(S.flagSelected) ? 'sel' : ''}" data-desk-flag="${Number(row.id)}" aria-label="เปิดตรวจยอดรูป ${Number(row.id)}" aria-pressed="${Number(row.id) === Number(S.flagSelected)}">${I('bill', 's')}<span>${e(row.vendor_name || row.bill_purpose || '#' + row.id)}</span><b>#${Number(row.id)}</b></button>`).join('')}`;
    strip.querySelectorAll('[data-desk-flag]').forEach(button => button.onclick = () => originalClick(document.querySelector(`#flaglist [data-flag-id="${Number(button.dataset.deskFlag)}"]`)));
    if (!rows.length) {
      stage.innerHTML = `<section class="desk-flag-empty"><div class="lg sheet"><span class="desk-empty-check">${I('check', 'xl')}</span><h1>ต้องตรวจยอด</h1><p role="status">${e(byId('flaglist')?.querySelector('.flagempty')?.textContent || 'กำลังโหลดรายการตรวจยอด…')}</p>${byId('retry-flags') ? '<button class="tg b pill" data-system="retry-flags">ลองโหลดอีกครั้ง</button>' : ''}</div></section>`;
    } else if (!selected || !byId('flag-document')) {
      stage.innerHTML = `<section class="desk-flag-empty"><div class="lg sheet"><h1>เลือกรายการเพื่อตรวจยอด</h1><p>เลือกจากคิวรูปด้านล่าง แล้วเทียบยอดในเอกสารกับข้อความ</p></div></section>`;
    } else {
      const sourceDocument = byId('flag-document'), sourceAnnounced = byId('flag-use');
      const chat = byId('flagchat');
      stage.innerHTML = `<aside class="desk-flag-chat lg sheet"><header>${I('chat')}ข้อความที่แจ้งยอด</header><div class="desk-flag-messages">${chat?.innerHTML || 'กำลังโหลดข้อความ…'}</div></aside>${api.doc(selected.category === 'bill' ? 'bill' : 'slip', 'เอกสาร', [selected])}<section class="lg sheet dock desk-flag-dock"><div class="desk-flag-question"><div><h1>ยอดไหนถูก?</h1><p>${e(byId('flagdetail-sub')?.textContent || '')}</p></div><div class="desk-flag-more"><button class="gbtn sq" id="desk-flag-more" aria-label="ตัวเลือกตรวจยอด" aria-expanded="false">${I('more')}</button><div class="lg sheet desk-flag-menu" hidden>${byId('flag-pair') ? '<button class="gbtn" data-system="flag-pair">ไปจับคู่เอกสาร</button>' : ''}<button class="gbtn" id="desk-flag-details">รายละเอียดต้นฉบับ</button></div></div></div><div class="desk-flag-choices"><button class="desk-flag-choice" data-system="flag-document" ${sourceDocument.disabled ? 'disabled' : ''}>${sourceDocument.innerHTML}</button><button class="desk-flag-choice announced" data-system="flag-use" ${sourceAnnounced?.disabled ? 'disabled' : ''}>${sourceAnnounced?.innerHTML || 'ไม่พบยอดที่แจ้ง'}</button></div><div class="desk-flag-manual-host"></div></section>`;
      const originalManual = byId('flagdetail')?.querySelector('.flagmanual');
      if (originalManual) {
        const marker = document.createComment('desk flag manual original location'); originalManual.before(marker);
        heldManual = { node: originalManual, marker }; stage.querySelector('.desk-flag-manual-host').append(originalManual);
      }
      stage.querySelectorAll('.desk-flag-messages [id]').forEach(node => node.removeAttribute('id'));
      const clonedRetry = stage.querySelector('.desk-flag-messages button');
      if (clonedRetry && byId('retry-flag-context')) clonedRetry.onclick = () => api.systemClick('retry-flag-context');
      const menu = stage.querySelector('.desk-flag-menu'), toggle = stage.querySelector('#desk-flag-more');
      toggle.onclick = () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); };
      stage.querySelector('#desk-flag-details').onclick = () => { menu.hidden = true; api.openNode(byId('flagdetail')?.querySelector('.flagmeta'), 'รายละเอียดต้องตรวจยอด'); };
    }
    stage.querySelectorAll('[data-system]').forEach(button => {
      button.disabled = !enabled(button.dataset.system);
      button.onclick = () => {
        if (selected && Number(S.flagSelected) !== Number(selected.id)) return;
        api.systemClick(button.dataset.system);
      };
    });
    api.annotateTips(stage); api.annotateTips(strip);
  }

  const desk = window.LbcDesk = window.LbcDesk || {}; desk.views = desk.views || {};
  desk.views.board = { signature: boardSignature, render: renderBoard, cleanup() {} };
  desk.views.flags = { signature: flagsSignature, render: renderFlags, cleanup: cleanupFlags };
  window.dispatchEvent(new Event('lbc:desk-extensions'));
})();
