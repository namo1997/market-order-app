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
const baseline=process.env.EXPENSE_PHASE45_BASELINE || '/Volumes/SSD Files/SOLAO/line-bill-capture/runs/2026-10-06T15-42-04-877Z-67b8af56/source';
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
try {
 const before=await start(baseline,'before'), beforePage=await pageFor(before.base);
 await beforePage.getByRole('button',{name:'ข้อมูลสำหรับค่าใช้จ่ายของคู่นี้',exact:true}).click();await loaded(beforePage);await screenshot(beforePage,'before-form-2335');await beforePage.close();
 const after=await start(process.cwd(),'after'), page=await pageFor(after.base), errors=[];page.on('pageerror',e=>errors.push(e.message));
 const sql=new DatabaseSync(after.dbPath), original=financial(sql);
 await page.getByRole('button',{name:'ข้อมูลสำหรับค่าใช้จ่ายของคู่นี้',exact:true}).click();await loaded(page);
 const field=key=>page.locator(`#expense-profile-${key}`);
 const box=key=>page.locator('.expense-profile-field').filter({has:field(key)});
 const read=async()=> (await (await page.request.get(after.base+'/api/admin/items/2335/expense-profile')).json()).data;
 assert.equal((await read()).revision,0);assert.equal(await field('purpose').inputValue(),'');
 assert.doesNotMatch(await page.locator('.expense-profile-dialog').innerText(),/ฉบับ 0|ที่มาของข้อมูล: ยังไม่ทราบ|ซื้ออะไร|ซื้อจากใคร|เงินจ่ายให้ใคร|ใช้ที่ไหน/u);
 assert.equal(await page.locator('.expense-profile-state:visible').count(),1);checks.push('one status, neutral field order, no revision-zero or repeated unknown metadata');
 await box('transaction_type').getByRole('button',{name:'ใช้ค่านี้',exact:true}).click();
 await box('recipient_name').getByRole('button',{name:'ใช้ค่านี้',exact:true}).click();
 assert.equal(await box('transaction_type').locator('.expense-profile-suggestion:visible').count(),0);assert.equal(await box('recipient_name').locator('.expense-profile-suggestion:visible').count(),0);
 await screenshot(page,'after-partial-2335');checks.push('user-reported partial adoption: adopted proposals removed, remaining two still actionable');
 await page.locator('#expense-profile-apply-all').click();
 for(const key of ['purpose','transaction_type','recipient_name','branch'])assert.ok(await field(key).inputValue());
 assert.equal(await page.locator('.expense-profile-suggestion:visible').count(),0);assert.equal(await field('supplier_name').isVisible(),false);
 for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]){
  await page.setViewportSize(size);const fit=await page.evaluate(()=>{const d=document.querySelector('.expense-profile-dialog'), b=document.querySelector('#expense-profile-save-reviewed').getBoundingClientRect();return{overflow:d.scrollWidth>d.clientWidth||document.documentElement.scrollWidth>innerWidth,saveVisible:b.bottom<=innerHeight&&b.top>0};});assert.equal(fit.overflow,false);assert.equal(fit.saveVisible,true);await screenshot(page,`after-filled-${size.width}x${size.height}`);
 }checks.push('all proposals filled without duplicate panels; desktop 1280/1440/1920 fits and save remains visible');
 await page.setViewportSize({width:1440,height:900});await box('purpose').locator('.expense-profile-evidence summary:visible').click();assert.match(await box('purpose').locator('blockquote:visible').innerText(),/ค่า กยศ/u);await screenshot(page,'after-evidence');checks.push('chat provenance remains available on demand');
 await page.locator('#expense-profile-additional>summary').click();await field('notes').fill('ร่างทดสอบ UX บน SSD');await page.locator('#expense-profile-additional>summary').click();
 await page.locator('#expense-profile-pair-document').selectOption('2345');await loaded(page);await screenshot(page,'after-form-2345');assert.equal(await field('purpose').inputValue(),'');
 await page.locator('#expense-profile-pair-document').selectOption('2335');await loaded(page);assert.equal(await field('notes').inputValue(),'ร่างทดสอบ UX บน SSD');assert.ok(await field('purpose').inputValue());checks.push('optional fields and per-document drafts survive switching without auto-save');
 await field('transaction_type').selectOption('purchase');assert.equal(await field('supplier_name').isVisible(),true);await field('transaction_type').selectOption('government_remittance');assert.equal(await field('supplier_name').isVisible(),false);
 await field('purpose').fill('');assert.equal(await box('purpose').locator('.expense-profile-suggestion').isVisible(),true);await page.locator('#expense-profile-save-reviewed').click();assert.equal(await field('purpose').getAttribute('aria-invalid'),'true');assert.equal((await read()).revision,0);
 await field('purpose').fill('นำส่ง กยศ.');await page.locator('#expense-profile-save-reviewed').click();assert.equal(await field('reason').getAttribute('aria-invalid'),'true');
 await field('reason').fill('เทียบหลักฐานบน SSD แล้ว');await page.locator('#expense-profile-save-reviewed').click();await page.waitForFunction(()=>document.querySelector('.expense-profile-history')&&!document.querySelector('.expense-profile-dialog').getAttribute('aria-busy').includes('true'));
 assert.equal((await read()).status,'reviewed');checks.push('purchase/remittance requirements, required focus, reason and audited reviewed save preserved');
 const saved=await read();
 // Simulate a second operator on this isolated SSD database, then exercise the real 409/reload UI.
 await field('purpose').fill('ร่างที่ต้องเก็บเมื่อชนกัน');
 const advance=await page.evaluate(payload=>api('/api/admin/items/2335/expense-profile',{method:'PUT',body:JSON.stringify(payload)}),{expected_revision:saved.revision,status:'draft',fields:saved.fields,reason:'ทดสอบการบันทึกจากอีกหน้าบน SSD'});
 assert.equal(advance.data.revision,saved.revision+1);
 await page.locator('#expense-profile-save-draft').click();await page.locator('.expense-profile-global-error').waitFor();
 assert.match(await page.locator('.expense-profile-global-error').innerText(),/ร่างของคุณยังอยู่/u);assert.equal(await field('purpose').inputValue(),'ร่างที่ต้องเก็บเมื่อชนกัน');
 await page.locator('.expense-profile-record-tools>summary').click();page.once('dialog',d=>d.accept());await page.locator('#expense-profile-reload').click();await page.waitForFunction(expected=>document.querySelector('.expense-profile-dialog')?.getAttribute('aria-busy')==='false'&&!document.querySelector('.expense-profile-global-error')&&document.querySelector('#expense-profile-purpose')?.value===expected,saved.fields.purpose.value);
 assert.equal(await field('purpose').inputValue(),saved.fields.purpose.value);checks.push('409 retains draft; explicit reload within record details resolves conflict');
 assert.equal(saved.fields.recipient_name.source,'paired_ocr');assert.equal(saved.fields.branch.source,'group_label');assert.ok(saved.history.length);assert.deepEqual(financial(sql),original);sql.close();assert.deepEqual(errors,[]);
 checks.push('provenance/history and protected financial/chat tables preserved; no page errors');await screenshot(page,'after-saved-2335');
 await fs.writeFile(path.join(out,'expense-form-ux-browser.json'),JSON.stringify({passed:true,checks,images:browserOut},null,2));console.log(JSON.stringify({passed:true,checks,images:browserOut},null,2));
} catch(error){if(diagnosticPage&&!diagnosticPage.isClosed()){await screenshot(diagnosticPage,'failure');await fs.writeFile(path.join(out,'expense-form-ux-failure.txt'),String(error.stack)+'\n'+await diagnosticPage.locator('body').innerText());}throw error;}
finally{await browser.close();for(const child of servers)child.kill('SIGTERM');await fs.writeFile(path.join(out,'expense-form-ux-servers.log'),serverLog);}
