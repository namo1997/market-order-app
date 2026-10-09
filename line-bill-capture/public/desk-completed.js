// งานที่คนยืนยันแล้ว: อ่านหลักฐานเดิมบนโต๊ะ และส่งทุกคำสั่งกลับไปยังปุ่มต้นฉบับ
(() => {
  const api = window.LbcDesk;
  if (!api) return;
  const original = () => document.getElementById('reviewpanel');
  function completedItems() {
    if (S.view !== 'day') return [];
    const seen = new Set();
    const rows = bucketRows('done').flatMap(row => {
      const match = confirmedMatchForItem(row.id);
      const key = Number(row.cash_payment_id) ? `done:cash:${row.id}` : `done:${match?.match_group_key || match?.id || row.id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, bucket: 'done', row, completedMatch: match, completed: true }];
    });
    return rows.length || S.bucket !== 'done' ? rows : [{key:'done:empty',bucket:'done',completed:true,empty:true}];
  }
  const known = value => value == null || value === '' ? 'ไม่พบข้อมูล' : String(value);
  function renderCompleted(it, desk) {
    const { e, I, doc, paper, proxyButton } = desk;
    const row = it.row;
    const filter = S.donePaymentFilter || 'all';
    const filters = `<div class="lg cap desk-done-filters" role="group" aria-label="กรองวิธีชำระ">${[['all','ทั้งหมด'],['transfer','โอน'],['cash','เงินสด']].map(([value,label])=>`<button type="button" class="gbtn ${filter===value?'active':''}" data-desk-done-payment="${value}" aria-pressed="${filter===value}">${label}</button>`).join('')}</div>`;
    const bindFilters = () => desk.stage.querySelectorAll('[data-desk-done-payment]').forEach(button => button.onclick = event => {
      event.stopPropagation();
      const source = document.querySelector(`#bhint [data-done-payment="${button.dataset.deskDonePayment}"]`);
      if (source && !source.disabled) {source.click();desk.go(completedItems()[0]?.key || 'done:empty');}
    });
    if (!row) return {html:`<div class="info"><div class="orb">${I('done')}</div><h1>ยังไม่มีรายการที่ยืนยันแล้วในวิธีจ่ายนี้</h1><p>เลือกทั้งหมดเพื่อดูงานที่เสร็จแล้วของวันนี้</p>${filters}</div>`,bind:bindFilters};
    const match = confirmedMatchForItem(row.id), cash = Number(row.cash_payment_id || 0) > 0;
    const bills = match ? matchBills(match) : [row];
    const slips = match ? matchSlips(match) : [item(row.matched_item_id)].filter(Boolean);
    const reviewer = cash ? row.cash_confirmed_by : match?.reviewed_by;
    const reviewedAt = cash ? row.cash_confirmed_at : match?.confirmed_at || match?.reviewed_at;
    const totals = `<div class="desk-done-totals"><span class="lg cap" data-desk-total="bill">ยอดบิล ${e(money(sumDocs(bills)))}</span><span class="lg cap" data-desk-total="slip">${cash?'ยอดเงินสด':'ยอดสลิป'} ${e(money(cash?row.cash_payment_amount:sumDocs(slips)))}</span></div>`;
    const pile = (rows, icon, label) => `<section class="desk-done-pile"><div class="tag">${I(icon)}${label} ${rows.length} ใบ</div><div class="desk-done-papers">${rows.map(x=>`<article class="desk-done-sheet"><div class="desk-done-sheet-title">#${x.id}<button class="gbtn sq" data-open="${x.id}" aria-label="เปิด${label} #${x.id}">${I('expand','s')}</button></div>${paper(x,label,icon)}</article>`).join('')}</div></section>`;
    let docs;
    if (cash) docs = `${doc('bill','บิล',bills)}<section class="doc desk-cash-proof"><div class="tag">${I('cash')}หลักฐานการจ่ายเงินสด</div><div class="lg sheet desk-cash-card"><span class="desk-cash-mark">${I('cash','xl')}</span><strong>${e(money(row.cash_payment_amount))} บาท</strong><dl><dt>ผู้รับเงิน</dt><dd>${e(known(row.cash_recipient_name))}</dd><dt>หมายเหตุ</dt><dd>${e(known(row.cash_payment_note))}</dd><dt>ยืนยันเมื่อ</dt><dd>${e(known(row.cash_confirmed_at))}</dd></dl><p>ผู้ใช้งานบันทึกการจ่ายเงินสดแล้ว</p></div></section>`;
    else if (bills.length > 1 || slips.length > 1) docs = `<div class="desk-done-piles" data-desk-confirmed="true">${pile(bills,'bill','บิล')}${pile(slips,'slip','สลิป')}${totals}</div>`;
    else docs = `${doc('bill','บิล',bills)}${doc('slip','สลิป',slips)}`;
    const title = cash ? 'จ่ายเงินสดแล้ว' : 'คนตรวจและยืนยันแล้ว';
    const main = cash ? proxyButton('edit-cash-payment','แก้ข้อมูลเงินสด','pencil') + proxyButton('void-cash-payment','ยกเลิกการจ่ายสด','x','pbtn no') : proxyButton('unconfirm-pair','ยกเลิกการยืนยัน','unpair','pbtn no');
    const html = `${docs}<div class="lg dock desk-done-dock" data-desk-confirmed="true"><div class="q"><h1>${I('done')}${title}</h1><div class="facts"><span class="fact ok">${e(known(reviewer))}</span><span class="fact">${e(known(reviewedAt))}</span></div></div><div class="acts">${filters}<button type="button" class="gbtn sq" data-desk-done-more aria-label="ตัวเลือกงานที่ยืนยันแล้ว">${I('more')}</button>${main}</div></div>`;
    return { html, bind() {
      desk.stage.dataset.deskConfirmed = 'true';
      bindFilters();
      desk.stage.querySelector('[data-desk-done-more]').onclick = event => {
        event.stopPropagation();
        const panel = original(), entries = [];
        if (panel.querySelector('#teach-done-ai')) entries.push(['teach','ส่งคำแก้ให้ AI เรียนรู้',()=>desk.openControl('.done-learning','ส่งคำแก้ให้ AI เรียนรู้'),panel.querySelector('#teach-done-ai').disabled]);
        if (panel.querySelector('#selected-create-receipt')) entries.push(['expense','สร้างใบแทนใบเสร็จ',()=>desk.sourceClick('selected-create-receipt'),panel.querySelector('#selected-create-receipt').disabled]);
        panel.querySelectorAll('.receipt-substitute-void-actions [data-receipt-id]').forEach(source=>entries.push(['x',source.textContent.trim(),()=>{if(source.isConnected&&!source.disabled)source.click();},source.disabled,'danger']));
        if (panel.querySelector('.expense-entry-open')) entries.push(['expense','ข้อมูลค่าใช้จ่าย',()=>panel.querySelector('.expense-entry-open')?.click()]);
        entries.push(['info','รายละเอียดการยืนยัน',()=>desk.openControl(':scope','รายละเอียดงานที่ยืนยันแล้ว')]);
        entries.push(['board','เปิดแบบเดิม',()=>desk.openClassic('done',row.id)]);
        desk.popMenu(event.currentTarget,entries);
      };
      desk.scheduleLines();
    }};
  }
  api.itemProviders.push(completedItems);
  api.itemRenderers.push({ matches: it => it.bucket === 'done', render: renderCompleted });
  window.dispatchEvent(new Event('lbc:desk-extensions'));
})();
