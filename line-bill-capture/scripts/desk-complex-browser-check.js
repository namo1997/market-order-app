// P5–P7 บน loopback SSD เท่านั้น: fixtures ในหน่วยความจำและ spies ของ handler เดิม ไม่มีการบันทึก
async page => {
  const check = (value, message) => { if (!value) throw Error(message); };
  check(/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()), 'ต้องเป็น loopback preview');
  const reportDirectory = await page.evaluate(() => window.__deskEvidenceDirectory || '');
  check(reportDirectory.startsWith('/Volumes/SSD Files/SOLAO/'), 'browser session ต้องเปิดจาก SSD reports');
  const errors = [], writes = [], layouts = [], handlers = [];
  let pickerRows = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!['GET','HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort(); }
    const url = new URL(route.request().url());
    if (pickerRows && url.pathname === '/api/admin/items' && url.searchParams.has('source_id') && !url.searchParams.has('start')) return route.fulfill({ contentType:'application/json',body:JSON.stringify({ok:true,data:pickerRows,pagination:{total:pickerRows.length}}) });
    return route.continue();
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({ width:1440, height:900 });
  await page.evaluate(() => { localStorage.setItem('lbc-admin-view','desk'); localStorage.setItem('lbc-admin-scheme','light'); });
  await page.reload();
  await page.waitForFunction(() => window.LbcDesk && document.querySelector('#desk-strip [data-go]'));
  check(await page.evaluate(() => window.LbcDesk.itemRenderers.some(r => r.matches({ bucket:'batch' }))), 'module P5–P7 ไม่ได้ลงทะเบียน');
  const scheme = async dark => {
    const label = dark ? 'มืด' : 'สว่าง';
    for (let i=0;i<3 && await page.locator('#desk-views [data-scheme]').getAttribute('aria-label') !== 'สี: '+label;i++) await page.locator('#desk-views [data-scheme]').click();
    check(await page.locator('html.glass-dark').count() === (dark ? 1 : 0), 'ต้องใช้โหมดสีจริง');
  };
  const layout = async name => {
    for (const dark of [false,true]) for (const width of [1120,1280,1440,1920]) {
      await page.setViewportSize({ width,height:900 }); await scheme(dark); await page.waitForTimeout(180);
      const result = await page.evaluate(() => {
        const stage=document.getElementById('desk-stage'),dock=stage.querySelector('.dock'),rect=dock.getBoundingClientRect(),root=document.getElementById('desk');
        return { overflow:dock.scrollWidth>dock.clientWidth+1 || rect.left<0 || rect.right>innerWidth || stage.scrollWidth>stage.clientWidth+1, shift:root.scrollLeft!==0, height:rect.bottom<=stage.getBoundingClientRect().bottom+2 };
      });
      check(!result.overflow && !result.shift && result.height, 'เลย์เอาต์ล้น '+name+'/'+width+'/'+dark+' '+JSON.stringify(result));
      layouts.push({ name,width,dark,...result });
    }
    await page.setViewportSize({ width:1440,height:900 }); await scheme(false);
    await page.screenshot({ path:reportDirectory+'/desk-phase2-'+name+'.png' });
  };
  const spy = async (id, expected) => {
    await page.evaluate(id => { window.__complexCalls=[];document.getElementById(id).onclick=()=>window.__complexCalls.push([id,(0,eval)('S.bucket'),(0,eval)('S.selected')]); },id);
    await page.locator(`#desk-stage [data-proxy="${id}"]`).click();
    const calls=await page.evaluate(() => window.__complexCalls);
    check(calls.length===1 && Number(calls[0][2])===expected,'ต้องเรียก handler รายการเดิม '+id);
    handlers.push(calls[0]);
  };
  const spyMenu = async (id, label, expected) => {
    await page.evaluate(id => { window.__complexCalls=[];document.getElementById(id).onclick=()=>window.__complexCalls.push([id,(0,eval)('S.bucket'),(0,eval)('S.selected')]); },id);
    await page.locator('[data-complex-more]').click();await page.getByRole('menuitem',{name:label,exact:true}).click();
    const calls=await page.evaluate(()=>window.__complexCalls);check(calls.length===1&&Number(calls[0][2])===expected,'เมนูต้องเรียก handler เดิม '+id);handlers.push(calls[0]);
  };
  // ใช้ id/รูปจริงของ fixture preview แต่ปรับประเภท/ยอด/ความเชื่อมโยงใน browser memory เท่านั้น
  const fixture = await page.evaluate(() => {
    const s=(0,eval)('S'),rows=s.items.filter(x=>!['unsent','duplicate'].includes(x.status)&&x.storage_relative_path).slice(0,8).map(x=>({...x}));
    if(rows.length<8)throw Error('preview ต้องมีเอกสารอย่างน้อย 8 รูป');
    const bill=(x,v)=>Object.assign(x,{category:'bill',bill_total_value:v,bill_total_text:String(v),announced_amount:null,bill_purpose:'เอกสารจำลอง P5',match_status:'pending',ai_status:'done',amount_review_flag:0,generated_document_type:null,payment_role:null,reimbursement_related_item_id:null});
    const slip=(x,v)=>Object.assign(x,{category:'transfer',slip_amount_value:v,slip_amount_text:String(v),match_status:'pending',ai_status:'done',amount_review_flag:0,generated_document_type:null,payment_role:null,reimbursement_related_item_id:null});
    bill(rows[0],100);bill(rows[1],200);slip(rows[2],150);slip(rows[3],150);
    s.items=rows;s.pool=rows;s.confirmedMatches=[];s.matches=[{id:900001,is_group:true,match_group_key:'desk-fixture-group',bill_item_ids:[rows[0].id,rows[1].id],slip_item_ids:[rows[2].id,rows[3].id],status:'pending',score:90,reasons:[]}];s.completedReview=null;s.bucket='review';s.selected=900001;
    render();window.LbcDesk.go('m900001');
    return { ids:rows.map(x=>x.id),match:900001 };
  });
  pickerRows = await page.evaluate(() => (0,eval)('S.items'));
  await page.locator('.desk-complex-group').waitFor();
  check(await page.locator('.desk-complex-group .paper img').count()===4,'ต้องแสดงรูปครบทุกใบในชุด');
  check(await page.locator('.desk-complex-total').count()===2,'ต้องมีผลรวมทั้งสองฝั่ง');
  check(await page.locator('.desk-complex-lines .ok').count()===1,'ยอดรวมตรงต้องเชื่อมสีเขียว');
  check(!await page.locator('#desk-stage [data-proxy="confirm-match-group"]').isDisabled(),'ยอดตรงต้องคง guard เดิม');
  await layout('p5-group');
  await spy('confirm-match-group',fixture.match);
  await spy('reject-match-group',fixture.match);
  await page.locator('[data-complex-more]').click();
  await page.getByRole('menuitem',{name:'แก้ชุดเอกสาร',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('drawerbg').hidden);
  await page.locator('#group-auto-match').waitFor();
  for(const id of ['group-auto-match','clear-group-bills','clear-group-slips','save-match-group']) check(await page.locator('#'+id).count()===1,'picker ต้องมีปุ่ม '+id);
  check(await page.locator('#drawerbg').evaluate(el=>Number(getComputedStyle(el).zIndex)>65),'picker ต้องอยู่เหนือโต๊ะ');
  await page.locator('#clear-group-bills').click();
  check(await page.locator('#save-match-group').isDisabled(),'ล้างบิลต้องหยุดการบันทึกตาม guard เดิม');
  await page.locator('#group-auto-match').click();check(!await page.locator('#save-match-group').isDisabled(),'เสนอชุดต้องคืนผลรวมที่ตรงตาม handler เดิม');
  await page.locator('#clear-group-slips').click();check(await page.locator('#save-match-group').isDisabled(),'ล้างสลิปต้องหยุดการบันทึกตาม guard เดิม');
  await page.keyboard.press('Escape');
  check(await page.locator('.desk-complex-group').count()===1,'ปิด picker ต้องกลับงานเดิม');
  await page.evaluate(()=>{const s=(0,eval)('S');s.pool=s.items;render();}); // picker GET เติม pool จริง จึงคืน references ของ fixture ในหน่วยความจำ
  await page.evaluate(id=>{const x=(0,eval)('item')(id);x.bill_total_value=210;x.bill_total_text='210';render();window.LbcDesk.refresh();},fixture.ids[1]);
  check(await page.locator('#desk-stage [data-proxy="confirm-match-group"]').isDisabled(),'ยอดต่างต้องไม่ยืนยันได้');
  check(await page.locator('.desk-complex-lines .no').count()===1,'ยอดต่างต้องเส้นแดง');
  await page.screenshot({path:reportDirectory+'/desk-phase2-p5-group-difference.png'});
  const batchId=await page.evaluate(id=>{const s=(0,eval)('S'),x=(0,eval)('item')(id);Object.assign(x,{category:'bill',bill_total_value:450,bill_total_text:'450',generated_document_type:'batch_payment_line',match_status:'unmatched',matched_item_id:null,ai_status:'done'});s.matches=[];render();window.LbcDesk.go('batch:'+x.id);return x.id;},fixture.ids[4]);
  pickerRows = await page.evaluate(() => (0,eval)('S.items'));
  for(const id of ['batch-pick-slip','batch-combine'])check(await page.locator(`#desk-stage [data-proxy="${id}"]`).count()===1,'batch ต้องมี '+id);
  await layout('p5-batch');
  await page.locator('#desk-stage [data-proxy="batch-combine"]').click();await page.waitForFunction(()=>!document.getElementById('drawerbg').hidden);await page.locator('#group-auto-match').waitFor();await page.keyboard.press('Escape');await page.evaluate(()=>{const s=(0,eval)('S');s.pool=s.items;render();});
  await spy('batch-pick-slip',batchId);
  const reimbursement=await page.evaluate(ids=>{const s=(0,eval)('S'),a=(0,eval)('item')(ids[5]),r=(0,eval)('item')(ids[6]),b=(0,eval)('item')(ids[7]);Object.assign(a,{category:'transfer',slip_amount_value:800,payment_role:'advance',match_status:'confirmed',matched_item_id:b.id,ai_status:'done',generated_document_type:null});Object.assign(r,{category:'transfer',slip_amount_value:800,payment_role:'reimbursement',reimbursement_status:'pending',reimbursement_related_item_id:a.id,match_status:'unmatched',ai_status:'done',generated_document_type:null});Object.assign(b,{category:'bill',bill_total_value:800,bill_total_text:'800',match_status:'confirmed',ai_status:'done',generated_document_type:null});s.matches=[];render();window.LbcDesk.go('m'+(-r.id));return{a:a.id,r:r.id,b:b.id,id:-r.id};},fixture.ids);
  await page.locator('.desk-complex-reimbursement').waitFor();
  check(await page.locator('.desk-complex-reimbursement .paper img').count()===3,'ต้องเห็นสำรอง คืนเงิน และบิลซื้อจริงครบ');
  await layout('p6-reimbursement');
  await page.locator('[data-complex-more]').click();check((await page.locator('.desk-pop').innerText()).includes('ใช้บิล/ใบเสร็จที่ยืนยันแล้ว'),'existing receipt ต้องพร้อมตาม source');await page.getByRole('menuitem',{name:'หมายเหตุหลักฐาน',exact:true}).click();
  check(await page.locator('#desk-controls #reimbursement-note').count()===1,'ต้องย้าย textarea เดิม');
  await page.locator('#reimbursement-note').fill('หมายเหตุ fixture ไม่บันทึก');await page.getByRole('button',{name:'ปิดตัวเลือก',exact:true}).click();check(await page.locator('#reviewpanel #reimbursement-note').inputValue()==='หมายเหตุ fixture ไม่บันทึก','ต้องรักษาร่างหมายเหตุ');
  await page.locator('#desk-stage [data-proxy="reimbursement-substitute"]').click();await page.waitForFunction(()=>!document.getElementById('receiptbg').hidden);await page.keyboard.press('Escape');
  check(await page.locator('.desk-complex-reimbursement').count()===1,'ปิดใบแทนต้องกลับงานคืนเงินเดิม');
  await page.evaluate(()=>document.getElementById('reimbursement-note').value='');
  await page.locator('[data-complex-more]').click();await page.getByRole('menuitem',{name:'ไม่ต้องมีใบแทน',exact:true}).click();
  check(await page.evaluate(()=>document.body.innerText.includes('ระบุเหตุผลที่ไม่ต้องมีใบแทน')),'ไม่ต้องมีใบแทนต้องรักษา guard หมายเหตุเดิม');
  await spyMenu('reimbursement-existing','ใช้บิล/ใบเสร็จที่ยืนยันแล้ว',reimbursement.id);
  await spyMenu('reimbursement-no-receipt','ไม่ต้องมีใบแทน',reimbursement.id);
  await spy('reimbursement-reject',reimbursement.id);
  await spy('reimbursement-substitute',reimbursement.id);
  await page.evaluate(id=>{const a=(0,eval)('item')(id);a.match_status='unmatched';a.matched_item_id=null;render();window.LbcDesk.refresh();},reimbursement.a);
  check((await page.locator('.desk-complex-reimbursement').innerText()).includes('ยังไม่มีใบเสร็จจากร้าน'),'ไม่มีหลักฐานต้องแสดงช่องว่าง');
  // P7 แต่ละประเภทใช้ภาพเดียวและ source controls เดิม สถานะ raw ต้องไม่เปลี่ยน
  for(const bucket of ['orphan_page','ai_pending','leftover','other']){
    const id=await page.evaluate(({bucket,id})=>{const s=(0,eval)('S'),x=(0,eval)('item')(id);s.matches=[];Object.assign(x,{generated_document_type:null,payment_role:null,reimbursement_related_item_id:null,ai_status:'done',category:bucket==='orphan_page'?'bill_page':bucket==='other'?'other':'bill',match_status:bucket==='leftover'?'manual_review':'unmatched',bill_total_value:400,bill_total_text:'400',document_has_payable:0,ai_summary:'หน้าต่อของบิล ยังขาดหน้ารวมยอด'});if(bucket==='ai_pending'){x.ai_status='processing';x.category='pending'}render();window.LbcDesk.go(bucket+':'+id);return id;},{bucket,id:fixture.ids[0]});
    await page.locator('.desk-complex-minor').waitFor();check(await page.locator('.desk-complex-minor .paper img').count()===1,'ถัง '+bucket+' ต้องมีรูปเต็ม');await layout('p7-'+bucket);
    if(bucket==='leftover'){check(!(await page.locator('.desk-complex-minor').innerText()).includes('manual_review'),'ต้องแปล raw status ใน UI');check(await page.evaluate(id=>(0,eval)('item')(id).match_status,id)==='manual_review','ห้ามเปลี่ยน raw status');await spy('selected-repair-state',id)}
    if(bucket==='ai_pending'){check(await page.locator('#desk-stage [data-proxy="pause-ai"]').count()===1,'รออ่านต้องมีหยุดรอบ');check(await page.locator('#desk-stage [data-proxy="confirm-match-group"],[data-act="yes"]').count()===0,'รออ่านต้องไม่มีปุ่มตัดสินใจ');await spy('pause-ai',id)}
    await page.locator('[data-complex-more]').click();check((await page.locator('.desk-pop').innerText()).includes('เปิดในมุมมองรายการ'),'ทุกงานต้องมีทางสำรอง');await page.keyboard.press('Escape');
  }
  check(!writes.length,'พบ write request '+writes.join(','));check(!errors.length,'พบ pageerror '+errors.join(','));
  return {passed:true,fixtures:'browser memory and read-only picker response with same preview rows',layouts,handlers,writes,errors};
}
