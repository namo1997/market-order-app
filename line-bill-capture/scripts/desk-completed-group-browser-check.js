async page => {
  const errors=[],writes=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{if(!['GET','HEAD'].includes(route.request().method())){writes.push(route.request().method()+' '+route.request().url());return route.abort();}return route.continue();});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>S.view==='day'&&!S.dayLoading&&S.matches.length>=2);
  await page.getByRole('button',{name:'โต๊ะเทียบ',exact:true}).first().click();
  const ids=await page.evaluate(()=>{
    const rows=S.matches.slice(0,2),bills=rows.flatMap(matchBills),slips=rows.flatMap(matchSlips);
    const groupMatch={...rows[0],id:900003,is_group:true,match_group_key:'fixture-confirmed-group',bill_item_ids:bills.map(x=>x.id),slip_item_ids:slips.map(x=>x.id),status:'confirmed',reviewed_by:'ผู้ตรวจชุด fixture',confirmed_at:'2026-10-02T11:40:00Z'};
    const billIds=new Set(bills.map(x=>x.id)),slipIds=new Set(slips.map(x=>x.id)),sourceIds=new Set(rows.map(x=>x.id));
    const replace=x=>billIds.has(x.id)?{...x,match_status:'confirmed',matched_item_id:slips[0].id}:slipIds.has(x.id)?{...x,match_status:'confirmed',matched_item_id:bills[0].id}:x;
    S.items=S.items.map(replace);S.pool=S.pool.map(replace);S.matches=S.matches.filter(x=>!sourceIds.has(x.id));S.confirmedMatches=[groupMatch];S.allActiveMatches=[groupMatch];S.bucket='done';S.bucketPinned=true;S.selected=bills[0].id;S.donePaymentFilter='all';render();LbcDesk.go('done:fixture-confirmed-group');
    return {bills:bills.map(x=>x.id),slips:slips.map(x=>x.id)};
  });
  const assert=async(name,fn)=>{const ok=await fn();checks.push({name,ok});if(!ok)throw new Error(name);};
  await assert('confirmed group deduplicated in queue',()=>page.evaluate(()=>LbcDesk.itemProviders.flatMap(fn=>fn(LbcDesk)).filter(x=>x.bucket==='done').length===1));
  await assert('every group document displayed',()=>page.evaluate(ids=>{const urls=[...document.querySelectorAll('.desk-done-piles .paper img')].map(x=>x.getAttribute('src'));return [...ids.bills,...ids.slips].every(id=>urls.includes(`/api/admin/items/${id}/image`))&&urls.length===ids.bills.length+ids.slips.length;},ids));
  await assert('aggregate comparison chips and connector',()=>page.evaluate(()=>{LbcDesk.scheduleLines();return document.querySelectorAll('[data-desk-total]').length===2&&LbcDesk.stage.dataset.deskConfirmed==='true';}));
  await page.waitForFunction(()=>document.querySelectorAll('#desk-stage .desk-lines path').length>0);
  for(const width of [1120,1280,1440,1920])for(const scheme of ['light','dark']){
    await page.setViewportSize({width,height:900});
    await page.evaluate(scheme=>{let count=0;while(document.querySelector('#desk-views [data-scheme]')?.getAttribute('aria-label')!==`สี: ${scheme==='light'?'สว่าง':'มืด'}`&&count++<4)document.querySelector('#desk-views [data-scheme]')?.click();},scheme);
    await page.waitForFunction(()=>!LbcDesk.stage.classList.contains('enter'));
    await assert(`${width} ${scheme} group fits`,()=>page.evaluate(()=>LbcDesk.stage.scrollWidth<=LbcDesk.stage.clientWidth+1&&[...document.querySelectorAll('.desk-done-pile,.desk-done-dock')].every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})));
    if(width===1440&&scheme==='light')await page.screenshot({path:'p4-confirmed-group-light-1440.png',animations:'disabled'});
  }
  await page.reload({waitUntil:'domcontentloaded'});
  return {passed:checks.every(x=>x.ok)&&!errors.length&&!writes.length,checks,errors,writes,fixture:'browser memory only; no financial saves'};
}
