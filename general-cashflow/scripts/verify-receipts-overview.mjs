import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { values:o } = parseArgs({ options:{ url:{type:'string'}, 'expected-commit':{type:'string'}, local:{type:'boolean',default:false}, artifacts:{type:'string'} } });
const url=o.url || 'https://general-cashflow-production.up.railway.app';
if(o.local && !['127.0.0.1','localhost'].includes(new URL(url).hostname)) throw new Error('Local verification requires loopback URL');
if(!o.local && !/^[a-f0-9]{40}$/.test(o['expected-commit'] || '')) throw new Error('Supply the complete expected commit');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifacts=path.resolve(o.artifacts || path.join(root,'output/playwright/cashflow-overview',new Date().toISOString().replaceAll(':','-')));
await fs.mkdir(artifacts,{recursive:true});
const records=[];
const check=async(name,fn)=>{ const evidence=await fn();records.push({name,status:'passed',evidence:evidence || 'assertions passed'});console.log(`PASS ${name}`); };
let browser, page;
try {
  const env=JSON.parse(execFileSync('railway',['variables','--service','general-cashflow','--environment','production','--json'],{cwd:root,encoding:'utf8'}));
  const auth=await fetch(`${url}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.CASHFLOW_ADMIN_USERNAME || 'admin',password:env.CASHFLOW_ADMIN_PASSWORD}),signal:AbortSignal.timeout(30000)}).then(r=>r.json());
  assert.ok(auth.data?.token,'Authorized login is required');
  const get=async query=>{const response=await fetch(`${url}/api/reports/receipts-overview?${new URLSearchParams(query)}`,{headers:{Authorization:`Bearer ${auth.data.token}`},signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);return (await response.json()).data;};
  const allPages=async query=>{const first=await get({...query,page_size:100,page:1});const rows=[...first.rows];for(let page=2;page<=first.pagination.pages;page++){const next=await get({...query,page_size:100,page});assert.deepEqual(next.summary,first.summary);rows.push(...next.rows);}assert.equal(rows.length,first.pagination.total);assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);return {...first,rows};};
  const scope={from:'2026-08-01',to:'2026-08-31',basis:'sale',tab:'daily'};
  let daily;
  await check('release identity',async()=>{const h=await fetch(`${url}/health`).then(r=>r.json());assert.equal(h.ready,true);if(!o.local)assert.equal(h.build.commit,o['expected-commit']);return h.build;});
  await check('daily data and all-page totals',async()=>{
    daily=await get({...scope,page_size:100});assert.ok(daily.rows.length>0);assert.ok(daily.rows.some(r=>r.status==='CLOSED'));
    const pages=[];for(let page=1;page<=Math.ceil(daily.pagination.total/20);page++){const p=await get({...scope,page_size:20,page});assert.deepEqual(p.summary,daily.summary);pages.push(...p.rows);}
    assert.equal(new Set(pages.map(r=>r.key)).size,daily.pagination.total);
    assert.deepEqual(pages.map(r=>r.key),daily.rows.map(r=>r.key));
    const sum=rows=>Math.round(rows.reduce((n,r)=>n+Number(r.received || 0),0)*100)/100;
    assert.equal(sum(daily.rows),daily.summary.received);
    const confirmations=[...new Map([...daily.rows.filter(r=>r.status==='CLOSED').slice(0,2),...daily.rows.filter(r=>r.adjustments?.length)].map(r=>[r.receipt_id,r])).values()];
    assert.ok(confirmations.length>0,'Closed receipt comparisons missing');
    for(const row of confirmations){
      const response=await fetch(`${url}/api/daily-receipts/${row.receipt_id}`,{headers:{Authorization:`Bearer ${auth.data.token}`},signal:AbortSignal.timeout(30000)});
      assert.equal(response.status,200);const original=(await response.json()).data;
      assert.equal(row.confirmed_variance,original.confirmed_variance_total,'Overview must agree with existing closing evidence');
      const detail=await get({...scope,from:'1900-01-01',to:'1900-01-01',receipt_id:row.receipt_id});
      assert.equal(detail.rows.length,1);assert.equal(detail.rows[0].received,row.received,'Overview and detail receipts must agree');
    }
    await fs.writeFile(path.join(artifacts,'data-summary.json'),JSON.stringify({filters:daily.filters,pagination:daily.pagination,summary:daily.summary},null,2));
    return 'data-summary.json';
  });
  await check('filters and pending evidence remain explicit',async()=>{
    const branch=await get({...scope,branch_id:daily.rows[0].branch_id,page_size:100});assert.ok(branch.rows.every(r=>r.branch_id===daily.rows[0].branch_id));
    const pending=await get({...scope,tab:'followups',basis:'received',page_size:100});assert.equal(pending.basis,'sale');assert.ok(pending.rows.every(r=>r.attention));
    const channel=await get({...scope,channel_id:daily.channels[0].id,page_size:100});assert.ok(channel.rows.every(r=>r.pos===null && r.lines.every(l=>l.channel_id===daily.channels[0].id)));
    const received=await allPages({...scope,basis:'received'});assert.ok(received.rows.length>0);assert.ok(received.rows.every(r=>r.cashier===null));
    const transactions=await allPages({...scope,basis:'received',tab:'transactions'});assert.ok(transactions.rows.every(r=>r.received_date && r.received!==null));
    assert.equal(transactions.summary.received,received.summary.received,'Actual receipts agree between daily and transaction tabs');
    const saleLedger=await allPages({...scope,tab:'transactions'});assert.equal(saleLedger.summary.received,daily.summary.received,'Sale allocations agree between daily and transaction tabs');
    const followups=await allPages({...scope,tab:'followups'});assert.ok(followups.rows.every(r=>r.attention));
  });
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const mutations=[],errors=[];
  await context.route('**/api/**',route=>{
    const req=route.request();if(!['GET','HEAD','OPTIONS'].includes(req.method())){mutations.push(`${req.method()} ${new URL(req.url()).pathname}`);return route.abort();}return route.continue();
  });
  await context.addInitScript(({token,user,scope})=>{localStorage.setItem('cashflow_token',token);localStorage.setItem('cashflow_user',JSON.stringify(user));sessionStorage.setItem('cashflow-overview',JSON.stringify({...scope,page_size:20,page:1}));},{...auth.data,scope});
  page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>{errors.push(e.message);console.error(`Browser runtime error: ${e.message}`);});
  const ready=async()=>{await page.locator('.ro-table-scroll[aria-busy="false"]').waitFor({timeout:60000});assert.equal(await page.locator('.ro-error').count(),0);};
  const act=async fn=>{const response=page.waitForResponse(r=>r.url().includes('/reports/receipts-overview?') && r.status()===200,{timeout:60000});await fn();const payload=await (await response).json();await page.waitForFunction(stamp=>document.querySelector('.ro-workspace')?.dataset.generatedAt===stamp,payload.data.generated_at,{timeout:60000});await ready();};
  await page.goto(`${url}/?view=overview`);await ready();
  await check('desktop 1440 and 1920 layout',async()=>{
    for(const width of [1440,1920]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(artifacts,`desktop-${width}.png`),fullPage:true});
      const layout=await page.locator('.ro-workspace').evaluate(el=>({width:el.getBoundingClientRect().width,viewport:window.innerWidth,clipped:[...el.querySelectorAll('.ro-table .ro-number')].filter(n=>n.scrollWidth>n.clientWidth && getComputedStyle(n).display!=='inline').length}));
      assert.ok(layout.width<=width);assert.equal(layout.clipped,0);
      const frozen=await page.locator('.ro-table tbody .ro-frozen').first().boundingBox();
      await page.locator('.ro-table-scroll').evaluate(el=>{el.scrollLeft=1000;});
      const after=await page.locator('.ro-table tbody .ro-frozen').first().boundingBox();assert.ok(Math.abs(frozen.x-after.x)<2);
      await page.locator('.ro-table-scroll').evaluate(el=>{el.scrollLeft=0;});
    }
    return ['desktop-1440.png','desktop-1920.png'];
  });
  await check('three tabs, basis and branch controls',async()=>{
    for(const name of ['รายการรับเงิน','เงินรอรับและข้อแตกต่าง','สรุปรายวัน']){await act(()=>page.getByRole('tab',{name,exact:true}).click());assert.ok(await page.locator('.ro-table tbody tr').count()>0);}
    await act(()=>page.getByRole('button',{name:'วันที่รับเงินจริง',exact:true}).click());assert.ok(await page.getByRole('columnheader',{name:'วันที่รับเงินจริง / สาขา',exact:true}).count());
    await act(()=>page.getByRole('button',{name:'วันที่ขาย',exact:true}).click());
    await act(()=>page.getByLabel('สาขา',{exact:true}).selectOption(String(daily.rows[0].branch_id)));
    await act(()=>page.getByLabel('สาขา',{exact:true}).selectOption(''));
  });
  await check('detail, original evidence and return to working date',async()=>{
    const row=daily.rows.find(r=>r.receipt_id && r.attachments.length);
    assert.ok(row,'A receipt with real evidence is required');
    await page.getByRole('button',{name:`รายละเอียด ${row.date} ${row.branch_name}`,exact:true}).first().click();
    await page.locator('.ro-receipt-detail').waitFor({timeout:60000});
    assert.equal(await page.locator('.ro-drawer .ro-error').count(),0);
    await page.screenshot({path:path.join(artifacts,'detail.png'),fullPage:true});
    await page.locator('.ro-evidence').first().click();
    await page.locator('.attachment-modal').waitFor({timeout:60000});
    assert.ok(await page.locator('.attachment-modal img,.attachment-modal iframe').count());
    await page.getByRole('button',{name:'ปิดเอกสาร',exact:true}).click();
    await page.getByRole('button',{name:'เปิดงานรับเงิน',exact:true}).click();
    await page.locator('.ro-return').waitFor();
    const scopeSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('general_cashflow_dashboard_filters')));
    assert.equal(scopeSaved.date,row.date);assert.equal(scopeSaved.branch_id,String(row.branch_id));
    await act(()=>page.getByRole('button',{name:'กลับภาพรวมรับเงิน',exact:true}).click());
    assert.equal(await page.getByLabel('จากวันที่',{exact:true}).inputValue(),scope.from);
    assert.equal(await page.getByRole('tab',{name:'สรุปรายวัน',exact:true}).getAttribute('aria-selected'),'true');
    return 'detail.png';
  });
  await check('no writes, no runtime errors and matching frontend build',async()=>{
    assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
    if(!o.local) assert.equal(await page.locator('.ro-workspace').getAttribute('data-build-commit'),o['expected-commit']);
    const health=await fetch(`${url}/health`).then(r=>r.json());if(!o.local)assert.equal(health.build.commit,o['expected-commit']);
  });
  assert.equal(records.length,7,'Every acceptance gate must run');
  await fs.writeFile(path.join(artifacts,'acceptance.json'),JSON.stringify({status:'passed',commit:o['expected-commit'] || 'development',url,checked_at:new Date().toISOString(),checks:records},null,2));
  console.log(`Acceptance evidence: ${artifacts}`);
} catch(error){if(page){await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(artifacts,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}await fs.writeFile(path.join(artifacts,'acceptance.json'),JSON.stringify({status:'failed',checks:records,error:error.message},null,2));console.error(error);process.exitCode=1;}
finally {await browser?.close();}
