async page => {
  const errors = [], writes = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (!['GET','HEAD'].includes(route.request().method())) {writes.push(route.request().method()+' '+route.request().url());return route.abort();}
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:900});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>S.view==='day'&&!S.dayLoading&&S.items.length>0);
  await page.getByRole('button',{name:'โต๊ะเทียบ',exact:true}).first().click();
  await page.evaluate(()=>{let count=0;while(document.querySelector('#desk-views [data-scheme]')?.getAttribute('aria-label')!=='สี: สว่าง'&&count++<4)document.querySelector('#desk-views [data-scheme]')?.click();});
  await page.waitForTimeout(500);
  const setup = await page.evaluate(() => {
    const m = S.matches.find(x=>!x.is_group&&x.review_type!=='reimbursement'), pair = m && pairs(m);
    if(!pair?.bill||!pair?.slip)return {error:'ไม่มี fixture คู่ธรรมดาสำหรับทดสอบ'};
    const match={...m,status:'confirmed',reviewed_by:'ผู้ตรวจ fixture',reviewed_at:'2026-10-02T11:20:00Z',confirmed_at:'2026-10-02T11:20:00Z'};
    const ids=new Set([pair.bill.id,pair.slip.id]);
    const replace=x=>ids.has(x.id)?{...x,match_status:'confirmed',matched_item_id:x.id===pair.bill.id?pair.slip.id:pair.bill.id}:x;
    S.items=S.items.map(replace);S.pool=S.pool.map(replace);
    S.allActiveMatches=[match,...(S.allActiveMatches||[]).filter(x=>x.id!==m.id)];
    S.confirmedMatches=[match];S.donePaymentFilter='all';S.bucket='done';S.bucketPinned=true;S.selected=pair.bill.id;render();
    LbcDesk.go(LbcDesk.itemProviders.flatMap(fn=>fn(LbcDesk)).find(x=>x.bucket==='done').key);
    return {billId:pair.bill.id,slipId:pair.slip.id};
  });
  if(setup.error)throw new Error(setup.error);
  const assert=async(name,fn)=>{const ok=await fn();checks.push({name,ok});if(!ok)throw new Error(name);};
  await assert('confirmed pair stays on desk',()=>page.evaluate(()=>!LbcDesk.root.hidden&&LbcDesk.current()?.bucket==='done'&&document.querySelectorAll('#desk-stage > .doc .paper img').length===2));
  await assert('confirmation identity and date',()=>page.locator('.desk-done-dock').innerText().then(text=>text.includes('ผู้ตรวจ fixture')&&text.includes('2026-10-02T11:20:00Z')));
  await page.locator('[data-desk-done-more]').click();
  await page.locator('.desk-pop [role="menuitem"]').filter({hasText:'ส่งคำแก้ให้ AI เรียนรู้'}).click();
  await assert('learning textarea is original node',()=>page.evaluate(()=>document.querySelector('#desk-controls #done-learning-note')===document.getElementById('done-learning-note')));
  await assert('moved original primary button stays readable',()=>page.evaluate(()=>getComputedStyle(document.getElementById('teach-done-ai')).color==='rgb(255, 255, 255)'));
  await page.locator('#desk-controls textarea').fill('ทดสอบเฉพาะหน้าจอ ไม่บันทึก');
  await page.keyboard.press('Escape');
  await assert('learning node restored',()=>page.locator('#reviewpanel #done-learning-note').count().then(n=>n===1));
  await page.evaluate(()=>{const button=document.getElementById('unconfirm-pair');button.onclick=()=>window.__deskUnconfirmSpy=(window.__deskUnconfirmSpy||0)+1;});
  await page.locator('#desk-stage [data-proxy="unconfirm-pair"]').click();
  await assert('unconfirm uses existing source button',()=>page.evaluate(()=>window.__deskUnconfirmSpy===1));
  await page.locator('[data-desk-done-payment="cash"]').click();
  await assert('empty cash filter remains on desk with filters',()=>page.evaluate(()=>LbcDesk.current()?.key==='done:empty'&&S.donePaymentFilter==='cash'&&document.querySelectorAll('#desk-stage [data-desk-done-payment]').length===3));
  await page.locator('[data-desk-done-payment="all"]').click();
  await assert('all filter returns confirmed pair',()=>page.evaluate(()=>LbcDesk.current()?.row?.id===Number(S.selected)&&LbcDesk.current()?.bucket==='done'));
  await page.waitForFunction(()=>document.getElementById('unconfirm-pair'));
  await page.waitForFunction(()=>{const source=document.getElementById('unconfirm-pair'),proxy=document.querySelector('#desk-stage [data-proxy="unconfirm-pair"]');return source&&proxy&&proxy.disabled===source.disabled;},{},{timeout:2000});
  await assert('all filter restores current original unconfirm guard',()=>page.evaluate(()=>document.querySelector('#desk-stage [data-proxy="unconfirm-pair"]').disabled===document.getElementById('unconfirm-pair').disabled));
  await page.screenshot({path:'p4-confirmed-light-1440.png',animations:'disabled'});
  await page.evaluate(({billId})=>{
    const row=item(billId),cash={...row,cash_payment_id:900001,cash_payment_amount:amount(row),cash_recipient_name:'ผู้รับ fixture',cash_payment_note:'ทดสอบจอ',cash_confirmed_at:'2026-10-02T11:30:00Z'};
    S.items=S.items.map(x=>x.id===billId?cash:x);S.pool=S.pool.map(x=>x.id===billId?cash:x);S.confirmedMatches=[];S.allActiveMatches=[];S.donePaymentFilter='all';S.bucket='done';S.selected=billId;render();LbcDesk.go('done:cash:'+billId);
  },setup);
  await assert('cash evidence displayed',()=>page.locator('.desk-cash-card').innerText().then(text=>text.includes('ผู้รับ fixture')&&text.includes('11:30')));
  await page.locator('[data-desk-done-payment="cash"]').click();
  await assert('cash filter returns cash item',()=>page.evaluate(()=>S.donePaymentFilter==='cash'&&LbcDesk.current()?.key==='done:cash:'+S.selected));
  await page.locator('[data-desk-done-payment="transfer"]').click();
  await assert('empty transfer filter remains done',()=>page.evaluate(()=>S.donePaymentFilter==='transfer'&&LbcDesk.current()?.key==='done:empty'));
  await page.locator('[data-desk-done-payment="all"]').click();
  await assert('all filter restores cash item',()=>page.evaluate(()=>S.donePaymentFilter==='all'&&LbcDesk.current()?.key==='done:cash:'+S.selected));
  await page.locator('[data-proxy="edit-cash-payment"]').click();
  await assert('cash original form and quick notes',()=>page.evaluate(()=>!document.getElementById('cash-payment-bg').hidden&&document.getElementById('cash-payment-recipient').value==='ผู้รับ fixture'&&document.querySelectorAll('#cash-payment-quick-notes [data-note]').length>0));
  await page.locator('#cash-payment-quick-notes [data-note]').first().click();
  await assert('cash quick note updates original textarea',()=>page.locator('#cash-payment-note').inputValue().then(value=>value!=='ทดสอบจอ'));
  await page.locator('#cash-payment-cancel').click();
  await assert('cash cancel retains item',()=>page.evaluate(()=>LbcDesk.current()?.key==='done:cash:'+S.selected&&!document.getElementById('cash-payment-bg').getClientRects().length));
  await page.evaluate(()=>{document.getElementById('void-cash-payment').onclick=()=>window.__deskCashVoidSpy=(window.__deskCashVoidSpy||0)+1;});
  await page.locator('[data-proxy="void-cash-payment"]').click();
  await assert('cash void bridges original source',()=>page.evaluate(()=>window.__deskCashVoidSpy===1));
  // Claude section 13: viewer uses current document, zoom/rotation controls, Escape returns same queue.
  await page.locator('#desk-stage .doc [data-open]').first().click();
  await page.locator('.desk-viewer img').waitFor();
  await assert('full image viewer is current document',()=>page.locator('.desk-viewer img').getAttribute('src').then(src=>src.endsWith(`/items/${setup.billId}/image`)));
  await page.locator('.desk-viewer [data-z="in"]').click();
  await assert('viewer zoom control',()=>page.locator('.dv-pct').innerText().then(text=>text!=='100%'));
  await page.locator('.desk-viewer [data-z="rot"]').click();
  await assert('viewer rotation',()=>page.locator('.desk-viewer').evaluate(node=>node.classList.contains('rotated')));
  await page.keyboard.press('Escape');
  await page.locator('.desk-viewer').waitFor({state:'detached',timeout:2000});
  await assert('viewer Escape retains same cash item',()=>page.evaluate(()=>!document.querySelector('.desk-viewer')&&LbcDesk.current()?.key==='done:cash:'+S.selected));
  // Native undo bar, no undo request: replace only its original handler for the bridge check.
  await page.evaluate(()=>{document.getElementById('undobar').hidden=false;document.getElementById('undotext').textContent='ทดสอบปุ่มย้อนกลับ ไม่บันทึก';document.getElementById('undobutton').onclick=()=>window.__deskUndoSpy=(window.__deskUndoSpy||0)+1;});
  await page.locator('#undobutton').click();
  await assert('undo original button above desk',()=>page.evaluate(()=>window.__deskUndoSpy===1&&Number(getComputedStyle(document.getElementById('undobar')).zIndex)>65));
  await page.evaluate(()=>document.getElementById('undobar').hidden=true);
  await page.evaluate(({billId})=>openTransferRequest(item(billId)),setup);
  await assert('transfer original dialog opens with unchecked confirmation',()=>page.evaluate(()=>!document.getElementById('transfer-request-bg').hidden&&!document.getElementById('transfer-request-confirm').checked&&document.getElementById('transfer-request-submit').disabled));
  await page.locator('#transfer-request-cancel').click();
  await page.evaluate(({billId})=>openNotDocument(item(billId),'บิล'),setup);
  await assert('not-document original guard remains disabled',()=>page.evaluate(()=>!document.getElementById('not-document-bg').hidden&&document.getElementById('not-document-submit').disabled));
  await page.locator('#not-document-cancel').click();
  await page.evaluate(({billId,slipId})=>askWhy({bill:item(billId),slip:item(slipId),onDone:()=>window.__deskWhyCancelled=true}),setup);
  await assert('why original chips and form opens',()=>page.evaluate(()=>!document.getElementById('why-bg').hidden&&document.querySelectorAll('#why-chips button').length>0));
  await page.locator('#why-close').click();
  await page.evaluate(({slipId})=>openReceiptSubstitute(item(slipId)),setup);
  await assert('receipt original form opens',()=>page.evaluate(()=>!document.getElementById('receiptbg').hidden&&document.getElementById('receipt-payer').value==='บริษัท โซลาว จำกัด'));
  await page.locator('#receipt-cancel').click();
  await page.evaluate(({slipId})=>openChatLightbox(`/api/admin/items/${slipId}/image`,'สลิป fixture'),setup);
  await page.locator('#chatlightbox-image').waitFor();
  await page.locator('#chatzoomin').click();
  await assert('native lightbox original zoom',()=>page.locator('#chatzoomreset').innerText().then(text=>text!=='100%'));
  await page.locator('#chatlightbox-close').click();
  await page.evaluate(()=>LbcDesk.systemClick('xs-open'));
  await assert('expense summary native dialog opens',()=>page.locator('#xs-summary').evaluate(node=>node.open));
  await page.locator('#xs-close').click();
  await page.locator('[data-desk-done-more]').click();
  await page.locator('.desk-pop [role="menuitem"]').filter({hasText:'ข้อมูลค่าใช้จ่าย'}).click();
  await assert('expense entry native dialog opens',()=>page.locator('.expense-profile-dialog').evaluate(node=>node.open));
  await page.keyboard.press('Escape');
  await assert('native forms cancel retains same cash item',()=>page.evaluate(()=>!document.querySelector('.expense-profile-dialog').open&&LbcDesk.current()?.key==='done:cash:'+S.selected));
  await assert('native focus preserves fixed desk header',()=>page.evaluate(()=>LbcDesk.root.scrollTop===0&&LbcDesk.root.scrollLeft===0&&LbcDesk.root.querySelector('.top').getBoundingClientRect().top>=0));
  // P3 ย้ายรายละเอียดธงเป็นหน้าบนโต๊ะโดยตรง จึงไม่เปิด flagbg ซ้ำ
  const overlays=['why-bg','drawerbg','cash-payment-bg','transfer-request-bg','receiptbg','not-document-bg','slip-preview-bg','sendersbg'];
  for(const width of [1120,1280,1440,1920]) for(const scheme of ['light','dark']) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(scheme=>{let count=0;while(document.querySelector('#desk-views [data-scheme]')?.getAttribute('aria-label')!==`สี: ${scheme==='light'?'สว่าง':'มืด'}`&&count++<4)document.querySelector('#desk-views [data-scheme]')?.click();},scheme);
    await page.waitForFunction(()=>!LbcDesk.stage.classList.contains('enter'));
    await assert(`${width} ${scheme} scheme applied`,()=>page.evaluate(scheme=>document.documentElement.classList.contains('glass-dark')===(scheme==='dark'),scheme));
    await assert(`${width} ${scheme} native danger color preserved`,()=>page.evaluate(()=>{const button=document.getElementById('not-document-submit'),probe=document.createElement('span');probe.style.color='var(--g-red)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return getComputedStyle(button).color===expected;}));
    const geometry=await page.evaluate(()=>({overflow:LbcDesk.root.scrollTop!==0||LbcDesk.root.scrollLeft!==0||[...LbcDesk.root.querySelectorAll(':scope > .top,:scope > .strip')].some(node=>{const r=node.getBoundingClientRect();return r.right>innerWidth+1||r.top<0;}),stage:LbcDesk.stage.scrollWidth>LbcDesk.stage.clientWidth+1,dock:document.querySelector('.desk-done-dock').getBoundingClientRect().right>innerWidth+1}));
    await assert(`${width} ${scheme} cash no overflow`,()=>Promise.resolve(!geometry.overflow&&!geometry.stage&&!geometry.dock));
    for(const id of overlays) {
      await page.evaluate(id=>{document.getElementById(id).hidden=false;},id);
      await assert(`${width} ${scheme} ${id} visible above desk`,()=>page.evaluate(id=>{const node=document.getElementById(id),style=getComputedStyle(node);return style.visibility==='visible'&&Number(style.zIndex)>65&&node.getBoundingClientRect().width>0;},id));
      await page.evaluate(id=>{document.getElementById(id).hidden=true;},id);
    }
  }
  await page.screenshot({path:'p4-cash-dark-1920.png',animations:'disabled'});
  await page.reload({waitUntil:'domcontentloaded'});
  return {passed:checks.every(x=>x.ok)&&!errors.length&&!writes.length,checks,errors,writes,fixture:'browser memory only; no financial saves'};
}
