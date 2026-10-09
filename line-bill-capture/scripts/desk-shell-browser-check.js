// ใช้ Playwright CLI run-code บน SSD loopback preview: เปิด/ปิดเครื่องมือเดิมและตรวจ layout โดยไม่เขียนข้อมูล
async page => {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(page.url())) throw Error('ต้องเป็น Local loopback preview');
  const check = (value,message) => {if(!value)throw Error(message);};
  const writes=[], errors=[], layout=[];
  page.on('pageerror',err=>errors.push(err.message));
  await page.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.continue():(writes.push(route.request().url()),route.abort()));
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>{localStorage.setItem('lbc-admin-view','desk');localStorage.setItem('lbc-admin-scheme','light');});
  await page.reload(); await page.waitForFunction(()=>S.view==='day'&&!S.dayLoading); await page.locator('#desk:not([hidden])').waitFor();
  for(const scheme of ['light','dark']) for(const width of [1120,1280,1440,1920]) {
    await page.setViewportSize({width,height:900});
    const label=scheme==='dark'?'มืด':'สว่าง';
    for(let i=0;i<3&&await page.locator('#desk-views [data-scheme]').getAttribute('aria-label')!=='สี: '+label;i++)await page.locator('#desk-views [data-scheme]').click();
    const result=await page.evaluate(()=>{const top=document.querySelector('#desk .top'),rect=top.getBoundingClientRect();return {overflow:top.scrollWidth>top.clientWidth+1,clipped:[...top.children].filter(n=>getComputedStyle(n).display!=='none').some(n=>{const r=n.getBoundingClientRect();return r.left<rect.left-1||r.right>rect.right+1;}),height:rect.height};});
    check(!result.overflow&&!result.clipped,'เมนูระบบล้น '+width+'/'+scheme+JSON.stringify(result));layout.push({width,scheme,...result});
  }
  await page.setViewportSize({width:1440,height:900});
  const route=page.url();
  await page.locator('#desk-nav').click();check((await page.locator('.desk-pop').innerText()).includes('สรุปข้อมูลค่าใช้จ่าย'),'เมนูต้องมีค่าใช้จ่าย');
  check(await page.locator('.desk-pop button.danger').count()===1,'ออกจากระบบต้องแยกสี');await page.keyboard.press('Escape');
  await page.locator('#desk-ai').click();check(await page.locator('#ai-menu').isVisible(),'เมนู AI ต้องเปิด');
  check(await page.locator('#desk-controls #run').count()===1,'ต้องใช้ปุ่ม AI ต้นฉบับ');await page.keyboard.press('Escape');
  check(await page.locator('#day-chrome #aimenu,header #aimenu').count()===1||await page.locator('#aimenu').count()===1,'คืน AI node ต้นฉบับ');
  await page.keyboard.press('Meta+k');check(await page.locator('#desk-controls #global-search').isVisible(),'⌘K เปิดช่องค้นหาต้นฉบับ');
  await page.keyboard.press('Escape');check(page.url()===route,'Escape เครื่องมือไม่กลับหน้ารวม');
  await page.locator('#desk-group').click();check(await page.locator('.desk-pop button').count()>0,'เลือกกลุ่มมีตัวเลือกเดิม');await page.keyboard.press('Escape');
  await page.locator('#desk-round').click();check(await page.locator('.desk-pop button').count()>0,'ตัวเลือกรอบ');await page.keyboard.press('Escape');
  await page.screenshot({path:'desk-phase2-p1-shell.png'});
  check(!writes.length,'ต้องไม่มี request เขียน');check(!errors.length,'runtime errors '+errors.join(','));
  return {passed:true,layout,writes,errors};
}
