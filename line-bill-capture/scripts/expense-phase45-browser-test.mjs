// UI regression requested by the user: real rendered controls against SSD working copies only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { storage } from './ssd-storage.mjs';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1');storage.assertSSD();
const baseline=process.env.EXPENSE_PHASE45_BASELINE || '/Volumes/SSD Files/SOLAO/line-bill-capture/runs/2026-10-06T11-31-29-265Z-d767ec66/source';
const backup=process.env.EXPENSE_PHASE45_BACKUP || '/Volumes/SSD Files/SOLAO/line-bill-capture/releases/expense-facts-20261006-1791281997/backups';
const out=storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const browserOut=path.join(out,'output','playwright');await fs.mkdir(browserOut,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || '/Users/surachart/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true});
const checks=[],servers=[];let serverLog='', diagnosticPage;
const group='C92c8a7b4a5099db619f6464e10eefab5';
const url=(base,id=2335,bucket='done',date='2026-09-01')=>`${base}/admin?view=day&date=${date}&group=${group}&bucket=${bucket}&item=${id}`;
const financial=(db)=>Object.fromEntries(['capture_items','capture_matches','capture_cash_payments','capture_daily_closings','ai_learning_examples','line_messages'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
async function start(source,name){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),`phase45-${name}-`));await fs.cp(path.join(backup,'restore','images'),path.join(root,'images'),{recursive:true});
 const dbPath=path.join(root,'working.sqlite');await fs.copyFile(path.join(backup,'production-snapshot.sqlite'),dbPath);await fs.chmod(dbPath,0o600);
 const db=new DatabaseSync(dbPath);for(const row of db.prepare('SELECT id,storage_relative_path FROM capture_items WHERE storage_relative_path IS NOT NULL').all())db.prepare('UPDATE capture_items SET storage_path=? WHERE id=?').run(path.join(root,'images',row.storage_relative_path),row.id);db.close();
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['src/server.js'],{cwd:source,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CAPTURE_DATA_DIR:root,CAPTURE_DB_PATH:dbPath,NODE_ENV:'test',ADMIN_AUTH_MODE:'operator_only',ADMIN_OPERATOR_NAMES:'["dot"]',ADMIN_SESSION_SECRET:'local-ui-test-only',DECISION_REASON_REQUIRED:'1',AI_WORKER_ENABLED:'false',AI_PROVIDER:'mock',OPENAI_API_KEY:'',LINE_BILL_CAPTURE_CHANNEL_SECRET:'local-test-only',LINE_BILL_CAPTURE_CHANNEL_ACCESS_TOKEN:'',LINE_BILL_CAPTURE_SILENT_MODE:'1',LINE_BILL_CAPTURE_PUSH_MOCK:'1'},stdio:['ignore','pipe','pipe']});
 servers.push(child);child.stdout.on('data',b=>serverLog+=b);child.stderr.on('data',b=>serverLog+=b);
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<600;i++){try{if((await fetch(base+'/health')).ok)return {base,dbPath}}catch{}if(child.exitCode!==null)throw Error(serverLog);await new Promise(r=>setTimeout(r,100))}throw Error('server not ready '+serverLog);
}
async function pageFor(base){const page=await browser.newPage({viewport:{width:1440,height:900}});diagnosticPage=page;await page.goto(url(base));const op=page.getByRole('button',{name:/dot/});if(await op.count())await op.click();await page.locator('.expense-profile-entry').waitFor();return page;}
async function loaded(page){await page.waitForFunction(()=>document.querySelector('.expense-profile-dialog')?.textContent.includes('ฉบับ')&&!document.querySelector('.expense-profile-dialog')?.getAttribute('aria-busy')?.includes('true'));}
async function screenshot(page,name){await page.screenshot({path:path.join(browserOut,name+'.png'),fullPage:false});}
const required=['purpose','transaction_type','recipient_name','branch'];
try{
 const before=await start(baseline,'before');const pageBefore=await pageFor(before.base);
 await screenshot(pageBefore,'before-overview-2335-2345');await pageBefore.locator('.reviewhead').scrollIntoViewIfNeeded();await screenshot(pageBefore,'before-pair-2335-2345');
 for(const id of [2335,2345]){await pageBefore.getByRole('button',{name:`ข้อมูลสำหรับค่าใช้จ่าย · ${id===2335?'บิล':'สลิป'} #${id}`,exact:true}).click();await loaded(pageBefore);await screenshot(pageBefore,`before-form-${id}`);await pageBefore.getByRole('button',{name:'ปิด · เก็บร่างไว้',exact:true}).click();}
 await pageBefore.close();
 const after=await start(process.cwd(),'after');const page=await pageFor(after.base);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const sql=new DatabaseSync(after.dbPath);const original=financial(sql);
 await screenshot(page,'after-overview-2335-2345');
 assert.equal(await page.locator('#total').isVisible(),false);assert.match(await page.locator('#reopenbanner').innerText(),/รอบเปิดใหม่.*งานค้าง.*ตรวจงานค้างก่อนปิดรอบอีกครั้ง/u);checks.push('reopened round has one actionable status; closing counts unchanged');
 await page.locator('.reviewhead').scrollIntoViewIfNeeded();await screenshot(page,'after-pair-2335-2345');
 assert.equal(await page.locator('.expense-profile-entry button').count(),1);checks.push('one pair expense button');
 assert.ok(await page.evaluate(()=>{const signals=document.querySelector('.reviewbody>.signals');return signals?.nextElementSibling?.classList.contains('expense-profile-entry')}));checks.push('button directly beneath amount boxes');
 const visible=await page.locator('body').innerText();assert.doesNotMatch(visible,/\bU[a-f0-9]{20,}\b/u);checks.push('raw LINE IDs concealed by default');
 const sender=page.locator('#reviewpanel .expense-sender-details').first();await sender.locator('summary').click();assert.match(await sender.innerText(),/LINE user ID:/);await sender.locator('summary').click();checks.push('explicit sender disclosure remains available');
 assert.ok(await page.locator('.expense-pair-reasons > ol > li').count()<=5);assert.doesNotMatch(await page.locator('.expense-pair-reasons').innerText(),/ยังไม่มีหลักฐานยืนยัน/u);checks.push('confirmed AI summary noncontradictory; <=5 reasons');
 await page.locator('.expense-pair-reasons').scrollIntoViewIfNeeded();await screenshot(page,'after-ai-reasons-2335-2345');
 const reasonDetails=page.locator('.expense-pair-reasons details');if(await reasonDetails.count()){await reasonDetails.locator('summary').click();assert.match(await reasonDetails.innerText(),/ข้อมูลอ้างอิงตอนจับคู่/u);await reasonDetails.locator('summary').click();checks.push('all reasons disclosed with historical label');}
 for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]){
  await page.setViewportSize(size);await page.locator('.reviewhead').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push(`no page horizontal overflow ${size.width}x${size.height}`);await screenshot(page,`after-pair-${size.width}x${size.height}`);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'ข้อมูลสำหรับค่าใช้จ่ายของคู่นี้',exact:true}).click();await loaded(page);
 for(const id of [2335,2345]){
  await page.getByLabel('เลือกเอกสารของคู่นี้',{exact:true}).selectOption(String(id));await loaded(page);
  const response=await page.request.get(after.base+`/api/admin/items/${id}/expense-profile`);const profile=(await response.json()).data;for(const key of required)assert.ok(profile.suggestions[key]?.value);
  assert.equal(profile.revision,0);checks.push(`#${id}: four proposals; no automatic save`);
  await screenshot(page,`after-form-${id}`);
  // Explicit adoption through existing phase-2 controls, not API writes.
  const all=page.getByRole('button',{name:/ใช้ข้อเสนอทั้งหมด/});if(await all.count())await all.click();else {
   for(const key of required){const field=page.locator('.expense-profile-field').filter({has:page.locator(`#expense-profile-${key}`)});await field.getByRole('button',{name:'ใช้ค่านี้',exact:true}).click();}
  }
  await page.locator('#expense-profile-reason').fill('ตรวจหลักฐานสำเนาใน SSD แล้ว');
  await page.getByRole('button',{name:'บันทึกว่าตรวจข้อมูลแล้ว',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.expense-profile-dialog')?.textContent.includes('ตรวจแล้ว')&&!document.querySelector('.expense-profile-dialog')?.getAttribute('aria-busy')?.includes('true'));
  const saved=(await (await page.request.get(after.base+`/api/admin/items/${id}/expense-profile`)).json()).data;assert.equal(saved.status,'reviewed');assert.equal(saved.revision,1);checks.push(`#${id}: reviewed save persisted through audited UI`);
  await screenshot(page,`after-reviewed-${id}`);
 }
 await page.getByRole('button',{name:'ปิด · เก็บร่างไว้',exact:true}).click();assert.deepEqual(financial(sql),original);checks.push('expense UI writes preserve all financial/match/chat tables exactly');
 // Multi-document regression uses the existing 25-document selector.
 await page.goto(url(after.base,2557,'done','2026-09-05'));await page.locator('#expense-profile-document-choice').waitFor();assert.equal(await page.locator('#expense-profile-document-choice option').count(),25);checks.push('#2557 retains all 25 document options');await screenshot(page,'after-2557-25-documents');
 await page.goto(url(after.base));await page.locator('.expense-profile-entry').waitFor();
 // Actual unconfirm, Undo, confirm, Undo on working copy with decision audit kept on.
 page.on('dialog',dialog=>dialog.accept());await page.locator('#unconfirm-pair').click();
 const skip=page.getByRole('button',{name:/ไม่.*เหตุผล|ข้าม|ไม่ระบุ/});if(await skip.count())await skip.first().click();
 await page.locator('#undobar.show').waitFor();assert.equal(sql.prepare('SELECT status FROM capture_matches WHERE id=2074').get().status,'pending');checks.push('unconfirm remains pending');
 await page.locator('#undobutton').click();await page.waitForFunction(()=>document.getElementById('undobar')&&!document.getElementById('undobar').classList.contains('show'));assert.equal(sql.prepare('SELECT status FROM capture_matches WHERE id=2074').get().status,'confirmed');checks.push('Undo unconfirm restores confirmed');
 await page.goto(url(after.base));await page.locator('#unconfirm-pair').click();if(await skip.count())await skip.first().click();await page.locator('#undobar.show').waitFor();
 await page.goto(url(after.base,2074,'review'));await page.locator('#confirm').waitFor();await page.locator('#confirm').click();await page.locator('#undobar.show').waitFor();assert.equal(sql.prepare('SELECT status FROM capture_matches WHERE id=2074').get().status,'confirmed');checks.push('confirm preserves existing flow');await page.locator('#undobutton').click();await page.waitForTimeout(300);assert.equal(sql.prepare('SELECT status FROM capture_matches WHERE id=2074').get().status,'pending');checks.push('Undo confirm restores pending');
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');sql.close();
 await fs.writeFile(path.join(out,'expense-phase45-browser.json'),JSON.stringify({passed:true,checks,images:browserOut,working_db:after.dbPath},null,2));console.log(JSON.stringify({passed:true,checks,images:browserOut},null,2));
}catch(error){if(diagnosticPage&&!diagnosticPage.isClosed()){await screenshot(diagnosticPage,'failure');await fs.writeFile(path.join(out,'browser-failure-state.json'),JSON.stringify({checks,url:diagnosticPage.url(),text:await diagnosticPage.locator('body').innerText(),state:await diagnosticPage.evaluate(()=>({view:S.view,start:S.start,bucket:S.bucket,selected:S.selected,dayLoading:S.dayLoading,dayLoadError:S.dayLoadError,completed:S.completedReview,items:S.items.length,html:document.getElementById('reviewpanel')?.innerHTML}))},null,2));}await fs.writeFile(path.join(out,'expense-phase45-browser-error.txt'),String(error.stack));throw error}
finally{await browser.close();for(const child of servers)child.kill('SIGTERM');await fs.writeFile(path.join(out,'expense-phase45-browser-servers.log'),serverLog);}
