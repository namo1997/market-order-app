// โต๊ะเทียบ: ชุดรวมเอกสาร คืนเงินสำรอง และถังงานเฉพาะ ใช้ปุ่ม/ฟอร์มเดิมของ admin เท่านั้น
(() => {
  const api = window.LbcDesk;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const { e, I } = api;
  const number = x => { const n = documentAmount(x); return n === null || n === undefined || n === '' ? null : Number(n); };
  const moneyText = x => x === null || !Number.isFinite(x) ? 'ยังไม่ทราบยอด' : money(x);
  const sum = docs => docs.reduce((n, x) => n + Number(amount(x) || 0), 0);
  const hintPage = x => /หน้าต่อ|หน้าประกอบ|ต่อ.*บิล/.test(String(x?.ai_summary || ''));
  const Thai = value => ({ pending:'รออ่าน', processing:'กำลังอ่าน', failed:'อ่านไม่สำเร็จ', paused:'พักการอ่าน', done:'อ่านแล้ว', manual_review:'รอตรวจด้วยคน', unmatched:'ยังไม่มีคู่', rejected:'ปฏิเสธคู่แล้ว', confirmed:'ยืนยันแล้ว', needs_amount:'ต้องแก้ยอด', unsent:'ยกเลิกส่งแล้ว' }[value] || 'ยังไม่ระบุสถานะ');
  const more = () => `<span class="lg cap"><button class="gbtn sq" data-complex-more aria-label="ตัวเลือกอื่น">${I('more')}</button><button class="gbtn sq" data-act="skip" aria-label="ข้าม">${I('skip')}</button></span>`;
  const facts = list => `<div class="facts">${list.filter(Boolean).map(([tone, text]) => `<span class="fact ${tone}">${e(text)}</span>`).join('')}</div>`;
  const dock = (title, info, actions) => `<div class="lg dock desk-complex-dock"><div class="q"><h1>${e(title)}</h1>${facts(info)}</div><div class="acts">${more()}${actions}</div></div>`;
  const documentPile = (documents, icon, label, total) => `<section class="desk-complex-pile"><header>${I(icon)}<strong>${e(label)}</strong><span>${documents.length} ใบ</span></header><div class="desk-complex-scroll">${documents.length ? documents.map(x => `<div class="desk-complex-paper">${api.doc(icon, label, [x])}<div class="desk-complex-document-amount">${e(moneyText(number(x)))}</div></div>`).join('') : `<div class="paper vacancy">${I(icon, 'xl')}<span>ยังไม่มี${e(label)}</span></div>`}</div><div class="lg desk-complex-total" data-complex-total="${icon}"><span>ยอดรวม${e(label)}</span><strong>${e(money(total))}</strong></div></section>`;
  const escape = it => ['board', 'เปิดในมุมมองรายการ', () => api.openClassic(it.bucket || 'review', it.row?.id || it.m?.id)];
  const sourceMenu = (id, icon, label, tone) => {
    const source = $(id);
    return [icon, label || source?.textContent || id, () => api.sourceClick(id), !source || source.disabled, tone];
  };
  const sourcePresent = id => Boolean($(id));
  function bindMenu(it, entries) {
    api.stage.querySelector('[data-complex-more]')?.addEventListener('click', event => {
      event.stopPropagation();
      api.popMenu(event.currentTarget, [...entries.filter(Boolean), escape(it)]);
    });
  }

  // เชื่อมเฉพาะยอดรวมของสองกอง ไม่เทียบยอดของใบแรกแทนทั้งชุด
  let resizeObserver;
  const connector = () => {
    const group = api.stage.querySelector('.desk-complex-group');
    if (!group) { resizeObserver?.disconnect(); return; }
    const left = group.querySelector('[data-complex-total="bill"]'), right = group.querySelector('[data-complex-total="slip"]');
    if (!left || !right) return;
    const g = group.getBoundingClientRect(), a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    if (!g.width || !g.height) return;
    let svg = group.querySelector(':scope > .desk-complex-lines');
    if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('desk-complex-lines'); svg.setAttribute('aria-hidden', 'true'); group.append(svg); }
    const x1 = a.right - g.left, y1 = a.top + a.height / 2 - g.top, x2 = b.left - g.left, y2 = b.top + b.height / 2 - g.top, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    const ok = group.dataset.deskAggregateTone === 'ok';
    const html = `<g class="${ok ? 'ok' : 'no'}"><path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"/><circle cx="${cx}" cy="${cy}" r="12"/><path class="mark" d="${ok ? `M${cx-5},${cy} l3,3 7,-7` : `M${cx-4},${cy-4} l8,8 M${cx+4},${cy-4} l-8,8`}"/></g>`;
    if (svg.innerHTML !== html) svg.innerHTML = html;
  };
  function bindGroup(it) {
    bindMenu(it, [sourceMenu('edit-match-group', 'pencil', 'แก้ชุดเอกสาร'), sourcePresent('pair-review-note') ? ['pencil', 'หมายเหตุการตรวจ', () => api.openControl('.pairfeedback', 'หมายเหตุการตรวจชุด')] : null]);
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === 'function') { resizeObserver = new ResizeObserver(connector); resizeObserver.observe(api.stage); api.stage.querySelectorAll('.desk-complex-total').forEach(x => resizeObserver.observe(x)); }
    connector(); requestAnimationFrame(connector);
  }
  function renderGroup(it) {
    const { bills, slips } = api.docsOf(it.m), billTotal = sum(bills), slipTotal = sum(slips), diff = billTotal - slipTotal, ok = Math.abs(diff) < .01;
    const html = `<div class="desk-complex-group" data-desk-aggregate-tone="${ok ? 'ok' : 'no'}">${documentPile(bills, 'bill', 'บิล', billTotal)}${documentPile(slips, 'slip', 'สลิป', slipTotal)}</div>`
      + dock('ยืนยันชุดเอกสารนี้ไหม?', [[ok ? 'ok' : 'no', `ต่าง ${money(diff)} บาท`], ['', `${bills.length} บิล · ${slips.length} สลิป`], ['', 'ตรวจรูปทุกใบก่อนยืนยัน']], api.proxyButton('reject-match-group', 'ไม่ใช่ชุดนี้', 'x', 'pbtn no') + api.proxyButton('confirm-match-group', 'ยืนยันชุดนี้', 'check', 'tg g pbtn yes'));
    return { html, bind: () => bindGroup(it) };
  }
  function evidenceBills(advance) {
    if (!advance) return [];
    const related = item(Number(advance.matched_item_id || 0));
    if (related?.category === 'bill') return [related];
    const confirmed = typeof confirmedMatchForItem === 'function' ? confirmedMatchForItem(advance.id) : null;
    return confirmed ? api.docsOf(confirmed).bills : advance.category === 'bill' ? [advance] : [];
  }
  function renderReimbursement(it) {
    const advance = item(it.m.advance_item_id), reimbursement = item(it.m.reimbursement_item_id), bills = evidenceBills(advance);
    const left = [advance, reimbursement].filter(Boolean);
    const html = `<div class="desk-complex-reimbursement"><section class="desk-complex-pile"><header>${I('slip')}<strong>โอนเงินสำรองและคืนเงิน</strong></header><div class="desk-complex-scroll">${left.map(x => `<div class="desk-complex-paper">${api.doc('slip', Number(x.id) === Number(advance?.id) ? 'เงินสำรองจ่าย' : 'คืนเงินให้พนักงาน', [x])}<div class="desk-complex-document-amount">${e(moneyText(number(x)))}</div></div>`).join('')}</div></section><section class="desk-complex-pile"><header>${I('bill')}<strong>หลักฐานการซื้อจริง</strong><span>${bills.length ? bills.length + ' ใบ' : 'ยังขาด'}</span></header><div class="desk-complex-scroll">${bills.length ? bills.map(x => `<div class="desk-complex-paper">${api.doc('bill', 'ใบเสร็จจากร้าน', [x])}</div>`).join('') : '<div class="paper vacancy desk-complex-vacancy">' + I('bill','xl') + '<span>ยังไม่มีใบเสร็จจากร้าน</span><small>เลือกวิธีเก็บหลักฐานด้านล่าง</small></div>'}</div></section></div>`
      + dock('คืนเงินสำรองจ่าย', [['na', 'รอตรวจหลักฐาน'], ['', `สำรอง ${moneyText(number(advance))} · คืน ${moneyText(number(reimbursement))}`]], api.proxyButton('reimbursement-reject', 'ไม่ใช่ชุดเดียวกัน', 'x', 'pbtn no') + api.proxyButton('reimbursement-substitute', 'สร้างใบแทนใบเสร็จ', 'bill', 'tg b pbtn'));
    return { html, bind: () => bindMenu(it, [sourcePresent('reimbursement-existing') ? sourceMenu('reimbursement-existing', 'bill', 'ใช้บิล/ใบเสร็จที่ยืนยันแล้ว') : null, ['pencil', 'หมายเหตุหลักฐาน', () => api.openControl('.pairfeedback', 'หมายเหตุหลักฐานสำรองจ่าย')], sourceMenu('reimbursement-no-receipt', 'check', 'ไม่ต้องมีใบแทน')]) };
  }
  function renderBatch(it) {
    const x = it.row, matched = item(Number(x.matched_item_id || 0));
    const html = api.doc('batch', 'ใบสรุปรอบจ่าย', [x]) + (matched ? api.doc('slip', 'สลิปที่เลือก', [matched]) : `<div class="doc"><div class="tag">${I('slip')}สลิปที่เลือก</div><div class="paper vacancy">${I('slip','xl')}<span>ยังไม่ได้เลือกสลิป</span></div></div>`)
      + dock('รายการรอบจ่ายนี้มีสลิปไหน?', [['na', moneyText(number(x))], ['', itemTitle(x) || 'รายการ #' + x.id]], api.proxyButton('batch-combine', 'เลือกหลายสลิป', 'batch') + api.proxyButton('batch-pick-slip', 'เลือกสลิปที่ใกล้เคียง', 'find', 'tg b pbtn'));
    return { html, bind: () => bindMenu(it, [sourcePresent('selected-not-document') ? sourceMenu('selected-not-document','other','จัดเป็นอื่น ๆ') : null, ['pencil','รายละเอียดรายการรอบจ่าย', () => api.openControl(':scope','รายละเอียดรายการรอบจ่าย')]]) };
  }
  function renderMinor(it) {
    const x = it.row, pending = it.bucket === 'ai_pending', leftover = it.bucket === 'leftover', orphan = it.bucket === 'orphan_page';
    let title, info, actions = '', note = '';
    if (pending) {
      title = 'รอ AI อ่านเอกสาร';
      info = [['na', Thai(x.ai_status)], ['', `${bucketRows('ai_pending').length} รูปในคิว`], ['', typeof when === 'function' ? when(x) : '']];
      note = x.ai_status === 'failed' ? 'AI อ่านรูปนี้ไม่สำเร็จ กำลังรอลองใหม่' : x.ai_status === 'paused' ? 'พักการอ่านรูปนี้แล้ว' : 'ยังไม่ได้ผลวิเคราะห์ จึงยังไม่มีการตัดสินใจเรื่องบิลหรือสลิป';
      actions = api.proxyButton('pause-ai', 'หยุดอ่านรอบนี้', 'x');
    } else if (leftover) {
      title = 'รายการนี้ตกหล่นจากถังงาน';
      const reason = typeof leftoverReason === 'function' ? leftoverReason(x) : null;
      note = String(reason?.why || 'ยังมีงานค้างที่ต้องตรวจสถานะ').replace(/"pending"/g, '“รออ่าน”').replace(/"manual_review"/g, '“รอตรวจด้วยคน”');
      info = [['na', Thai(x.match_status)], ['', moneyText(number(x))], ['', reason?.how || 'ตรวจสถานะจากคู่จับจริง']];
      actions = api.proxyButton('selected-repair-state','ซ่อมสถานะรายการนี้','reread','tg b pbtn');
    } else {
      title = orphan ? 'ยังขาดหน้าที่มียอดรวม' : 'รูปนี้อาจเป็นหน้าต่อของบิล';
      info = [['na', orphan ? 'หน้าประกอบยังไม่มีบิลยอดรวม' : 'ตรวจคำแนะนำจาก AI'], ['', itemTitle(x) || 'รูป #' + x.id]];
      note = x.ai_summary || 'ตรวจแชท LINE หรือส่งหน้าสรุปยอดเข้ากลุ่มเพิ่ม เพื่อรวมหลักฐานให้ครบ';
      // หน้าเดิมรองรับปุ่มหาบิลเฉพาะสลิป ไม่สร้างทางเขียนใหม่ให้หน้าประกอบ
      actions = sourcePresent('selected-pick-bill') ? api.proxyButton('selected-pick-bill','เลือกบิลที่เกี่ยวข้อง','find','tg b pbtn') : `<button class="tg b pbtn" data-complex-details>${I('info')}ดูข้อมูลและจัดหมวด</button>`;
    }
    const html = `<div class="desk-complex-minor"><div class="doc">${api.doc(pending ? 'reread' : orphan ? 'pages' : 'image', 'รูปเอกสาร', [x])}</div><aside class="desk-complex-note"><span class="desk-complex-status">${I(pending ? 'reread' : leftover ? 'docq' : 'pages')}</span><h2>${e(title)}</h2><p>${e(note)}</p>${pending ? `<small>รูป #${x.id} · ${e(senderName(x))}</small>` : ''}</aside></div>` + dock(title, info, actions);
    return { html, bind: () => {
      api.stage.querySelector('[data-complex-details]')?.addEventListener('click', () => api.openControl(':scope','ข้อมูลเอกสารและการจัดหมวด'));
      bindMenu(it, [['info','รายละเอียดเอกสาร', () => api.openControl(':scope','รายละเอียดเอกสาร')], sourcePresent('selected-pick-bill') && !pending ? sourceMenu('selected-pick-bill','find','เลือกบิลที่เกี่ยวข้อง') : null]);
    } };
  }
  api.itemRenderers.push({
    matches: it => Boolean(it?.m?.is_group || it?.m?.review_type === 'reimbursement' || ['batch','orphan_page','ai_pending','leftover'].includes(it?.bucket) || (it?.bucket === 'other' && hintPage(it.row))),
    render: it => { resizeObserver?.disconnect(); return it.m?.is_group ? renderGroup(it) : it.m?.review_type === 'reimbursement' ? renderReimbursement(it) : it.bucket === 'batch' ? renderBatch(it) : renderMinor(it); }
  });
  window.addEventListener('resize', connector);
  window.dispatchEvent(new Event('lbc:desk-extensions'));
})();
