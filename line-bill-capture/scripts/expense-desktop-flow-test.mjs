import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {storage} from './ssd-storage.mjs';

// Browser actions use the Playwright CLI and fresh accessibility references.
// Fictional loopback fixture only; all generated evidence is written to verified SSD.
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1','Use the SOLAO SSD runner');
storage.assertSSD();
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const fixturePath=storage.assertSSDPath(arg('fixture'));
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
assert.equal(fixture.fictional,true);
assert.match(fixture.base_url,/^http:\/\/127\.0\.0\.1:\d+$/);
const out=storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR);
const browserDir=path.join(out,'output','playwright');await fs.mkdir(browserDir,{recursive:true});
const session=arg('session')||'lbc-expense-pc';
process.env.npm_config_offline='true';
process.env.PWTEST_SOCKETS_DIR=storage.assertSSDPath('/Volumes/SSD Files/SOLAO/line-bill-capture/tmp/pw');
await fs.mkdir(process.env.PWTEST_SOCKETS_DIR,{recursive:true});
const phase=arg('phase')||'start';
const wrapper='/Users/surachart/.codex/skills/playwright/scripts/playwright_cli.sh';
const logPath=path.join(out,`expense-browser-${phase}-${new Date().toISOString().replaceAll(':','-')}.log`);
let log='',checks=[];
async function cli(...args){
  if(args[0]==='run-code'&&!args[1].startsWith('async page'))args[1]=`async page => { ${args[1]} }`;
  const child=spawn('bash',[wrapper,'--session',session,...args],{cwd:browserDir,env:process.env,stdio:['ignore','pipe','pipe']});
  let text='';for(const stream of[child.stdout,child.stderr])stream.on('data',data=>{text+=data});
  const code=await new Promise(resolve=>child.once('exit',resolve));
  log+=`\n$ playwright-cli ${args[0]} ${args.slice(1).join(' ')}\n${text}`;
  await fs.writeFile(logPath,log);
  assert.equal(code,0,text);assert.ok(!text.includes('### Error'),text);
  return text;
}
async function snapshot(){
  const text=await cli('snapshot');
  const inline=text.match(/```yaml\n([\s\S]*?)```/);if(inline)return inline[1];
  const match=text.match(/\[Snapshot\]\(([^)]+)\)/);assert.ok(match,text);
  return fs.readFile(path.resolve(browserDir,match[1]),'utf8');
}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function ref(role,name,nth=0){
  const text=await snapshot();
  const re=new RegExp(`- '?${escape(role)} \\"${escape(name)}\\"[^\\n]*?\\[ref=([^\\]]+)\\]`,'g');
  const matches=[...text.matchAll(re)];assert.ok(matches[nth],`Missing ${role} ${name}\n${text}`);return matches[nth][1];
}
async function act(command,role,name,value,nth=0){const target=await ref(role,name,nth);return cli(command,target,...(value===undefined?[]:[value]));}
async function value(expression){
  const text=await cli('eval',`JSON.stringify(${expression})`);
  const segment=text.split('### Result\n')[1]?.split('\n###')[0]?.trim();assert.ok(segment,text);
  const parsed=JSON.parse(segment);return typeof parsed==='string'?JSON.parse(parsed):parsed;
}
async function until(expression,expected,description){
  for(let attempt=0;attempt<12;attempt++){
    const actual=await value(expression);if(typeof expected==='function'?expected(actual):actual===expected){checks.push(description);return actual;}
    if(attempt===11)assert.fail(`${description}: ${JSON.stringify(actual)}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}
const scopeUrl=(item,bucket='bill',group=fixture.groups[0])=>{const url=new URL(fixture.admin_url);url.searchParams.set('bucket',bucket);url.searchParams.set('item',item);url.searchParams.set('group',group);return url.href};
const modalState="(()=>{const d=document.querySelector('.expense-profile-dialog');return {open:d?.open,state:d?.querySelector('[role=status]')?.textContent,text:d?.textContent,focus:document.activeElement?.id}})()";
const openProfile=async()=>{await actPrefix('click','button','ข้อมูลสำหรับค่าใช้จ่าย');await until('document.querySelector(\'.expense-profile-dialog\')?.textContent?.includes(\'ฉบับ\')',true,'expense profile loads');};
async function prefixRef(role,prefix,nth=0){const tree=await snapshot();const lines=tree.split('\n').filter(line=>line.replace("- '","- " ).includes(`- ${role} \"${prefix}`));assert.ok(lines[nth],`Missing ${role} ${prefix}\n${tree}`);return lines[nth].match(/\[ref=([^\]]+)\]/)[1];}
async function actPrefix(command,role,prefix,value,nth=0){return cli(command,await prefixRef(role,prefix,nth),...(value===undefined?[]:[value]));}
const fill=(name,text)=>act('fill','textbox',name,text);
const select=(name,text)=>act('select','combobox',name,text);
const saveDraft=()=>act('click','button','บันทึกร่าง');
const saveReviewed=()=>act('click','button','บันทึกว่าตรวจข้อมูลแล้ว');
const financialSnapshot=()=>{
  const sql=new DatabaseSync(storage.assertSSDPath(fixture.db_path),{readOnly:true});sql.exec('PRAGMA query_only=ON');
  try{return Object.fromEntries(['capture_items','capture_matches','capture_cash_payments','capture_daily_closings','ai_learning_examples','ai_category_learning_examples','line_transfer_requests'].map(table=>[table,sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row=>({...row}))]));}finally{sql.close();}
};
try{
  if(phase==='start'){
    await cli('open',scopeUrl(1,'done'));
    await cli('resize','1440','900');
    const tree=await snapshot();
    if(tree.includes('button "d dot"'))await act('click','button','d dot');
    else if(tree.includes('combobox')){throw Error('Inspect operator selector before choosing a name');}
    await until('document.querySelector(\'.expense-profile-entry\')!==null',true,'authenticated day document renders');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')),'opening page must not mutate financial facts');
    checks.push('operator login and opening real admin page preserve fictional baseline');
    await cli('screenshot');
  }else if(phase==='inspect'){
    await snapshot();await cli('screenshot');console.log(JSON.stringify(await value(modalState)));
  }else if(phase==='draft'){
    await cli('goto',scopeUrl(3));await openProfile();
    assert.equal(await value("document.getElementById('expense-profile-required-transaction_type').hidden"),false);checks.push('transaction type marked required before any choice');
    assert.equal(await value("document.getElementById('expense-profile-reason-hint').textContent.includes('บันทึกร่างเว้นว่างได้')"),true);
    await saveReviewed();await until('document.activeElement?.id','expense-profile-transaction_type','reviewed without type focuses type before reason');
    await fill('เหตุผลการบันทึก','ตรวจบิลสมมติและกรอกข้อมูลเอง');
    await saveReviewed();await until('document.activeElement?.id','expense-profile-transaction_type','missing transaction type focused');
    await select('ประเภทรายการ','purchase');
    assert.deepEqual(await value("['purpose','supplier_name','transaction_type','notes'].filter(k=>!document.getElementById('expense-profile-required-'+k).hidden)"),['purpose','supplier_name','transaction_type']);checks.push('purchase marks purpose and supplier required');
    await saveReviewed();
    await until('document.activeElement?.id','expense-profile-purpose','missing purchase purpose focused');
    await fill('รายการซื้อ / วัตถุประสงค์','ผักสดสำหรับครัว\nหมายเหตุบรรทัดที่สองตามใบเสร็จ');await saveReviewed();
    await until('document.activeElement?.id','expense-profile-supplier_name','missing purchase supplier focused');
    await fill('ร้าน / ซัพพลายเออร์','ร้านทดสอบชื่อตามบิล');
    await fill('ผู้รับเงินจริง','ผู้รับเงินที่ร้านมอบหมาย');await saveReviewed();
    await until('document.activeElement?.id','expense-profile-supplier_payee_relation','different supplier/payee relation focused');
    await select('ความสัมพันธ์ร้านกับผู้รับเงิน','authorized_payee');
    await fill('ธนาคารผู้รับ','ธนาคารทดสอบ');await fill('บัญชีผู้รับ (ปิดบังเลข)','1234567890');await saveDraft();
    await until('document.activeElement?.id','expense-profile-recipient_account_masked','full account blocked/focused');
    await fill('บัญชีผู้รับ (ปิดบังเลข)','XXXX9876');
    await fill('สาขา','สาขาทดสอบหลัก');await fill('หน่วยงาน','ครัว');await fill('หมายเหตุ / เหตุผลที่ข้อมูลยังไม่ครบ','ข้อความยาวสำหรับตรวจการตัดบรรทัด '.repeat(18));
    await fill('เหตุผลการบันทึก','');
    await saveDraft();await until('document.querySelector(\'.expense-profile-dialog\').textContent.includes(\'ฉบับ 1\')',true,'manual draft saved without typing a reason');
    {const sql=new DatabaseSync(fixture.db_path,{readOnly:true});assert.equal(sql.prepare('SELECT reason FROM capture_expense_profile_revisions WHERE item_id=3 AND revision=1').get().reason,'บันทึกร่าง');sql.close();checks.push('empty-reason draft stored default reason');}
    assert.match((await value(modalState)).text,/บันทึก.*แล้ว/,'actual API success is visible');
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างยังไม่บันทึกของเอกสารสาม');await cli('press','Escape');await openProfile();
    await until('document.getElementById(\'expense-profile-purpose\').value','ร่างยังไม่บันทึกของเอกสารสาม','Escape/reopen retains unsaved draft');
    assert.match((await value(modalState)).text,/ยังไม่บันทึก/);
    await cli('screenshot');
    await cli('reload');await openProfile();
    await until('document.getElementById(\'expense-profile-purpose\').value','ผักสดสำหรับครัว\nหมายเหตุบรรทัดที่สองตามใบเสร็จ','saved draft survives browser reload');
    await fill('เหตุผลการบันทึก','ตรวจข้อมูลครบแล้ว');await saveReviewed();
    await until('document.querySelector(\'.expense-profile-dialog\').textContent.includes(\'ตรวจข้อมูลแล้ว\')',true,'reviewed save with all manual fields succeeds');
    await cli('screenshot');
    const size=await value("(()=>{const d=document.querySelector('.expense-profile-dialog');return {width:d.getBoundingClientRect().width,scroll:d.scrollWidth,client:d.clientWidth,viewport:innerWidth,image:[...d.querySelectorAll('img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.getAttribute('src')}))}})()");
    assert.ok(size.width>1000,'desktop workspace must be wide');assert.equal(size.scroll,size.client,'no horizontal overflow');assert.ok(size.image.some(i=>i.loaded),'actual original document preview loaded');checks.push('wide desktop dialog, no overflow and actual document image');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('profile form writes preserve all original financial/AI/LINE tables');
  }else if(phase==='evidence'){
    await cli('goto',scopeUrl(1,'done'));await openProfile();
    assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'');
    assert.equal(await value("document.getElementById('expense-profile-supplier_name').value"),'');checks.push('OCR suggestions do not autofill confirmed facts');
    await act('click','button','ใช้ข้อเสนอนี้ในร่าง',undefined,0);
    await until("document.getElementById('expense-profile-purpose').value",'ผักสำหรับครัวสาขาทดสอบ','explicit chat purpose adoption');
    await act('click','generic','หลักฐานของข้อมูลนี้',undefined,0);
    assert.match((await value(modalState)).text,/ผู้รับในสลิปเป็นบัญชีรับแทนร้าน/);checks.push('referenced same-group chat text visible');
    await act('click','button','ใช้ข้อเสนอนี้ในร่าง',undefined,1);
    await until("document.getElementById('expense-profile-supplier_name').value",'ร้านครัวสมมติ','explicit bill supplier adoption');
    await act('click','link','เปิดรูป #1 ขนาดเต็ม');await cli('tab-select','1');
    assert.match(await value('document.documentElement.textContent'),/ชุดทดสอบสมมติ/);checks.push('open full original protected image works');await cli('tab-close','1');await cli('tab-select','0');
    await select('ประเภทรายการ','purchase');await fill('เหตุผลการบันทึก','ใช้ข้อเสนอจากบิลและข้อความอ้างอิง');await saveDraft();
    await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 1')",true,'source-linked draft saved');
    let sql=new DatabaseSync(fixture.db_path,{readOnly:true});sql.exec('PRAGMA query_only=ON');
    let facts=JSON.parse(sql.prepare('SELECT fields_json FROM capture_expense_profiles WHERE item_id=1').get().fields_json);sql.close();
    assert.equal(facts.purpose.source,'chat');assert.equal(facts.purpose.evidence[0].message_id,'fictional-chat-101');assert.equal(facts.supplier_name.source,'bill');checks.push('saved provenance matches explicit UI adoption');
    await fill('รายการซื้อ / วัตถุประสงค์','ผักสดที่คนแก้จากหลักฐาน');await fill('เหตุผลการบันทึก','แก้คำอธิบายให้ตรงบิล');await saveDraft();
    await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 2')",true,'manual correction creates second revision');
    sql=new DatabaseSync(fixture.db_path,{readOnly:true});sql.exec('PRAGMA query_only=ON');facts=JSON.parse(sql.prepare('SELECT fields_json FROM capture_expense_profiles WHERE item_id=1').get().fields_json);sql.close();assert.equal(facts.purpose.source,'manual');assert.deepEqual(facts.purpose.evidence,[]);checks.push('manual edit clears inherited provenance');
    await act('click','generic','ประวัติการบันทึก 2 ครั้ง');
    let tree=await snapshot();const revisionLine=tree.split('\n').find(line=>line.includes('generic \"ฉบับ 2 ·'));assert.ok(revisionLine,tree);await cli('click',revisionLine.match(/\[ref=([^\]]+)\]/)[1]);
    const history=await value("document.querySelector('.expense-profile-history').textContent");assert.match(history,/ก่อนแก้/);assert.match(history,/หลังแก้/);assert.match(history,/ผักสำหรับครัวสาขาทดสอบ/);assert.match(history,/ผักสดที่คนแก้จากหลักฐาน/);assert.match(history,/กรอกเอง/);assert.match(history,/dot/);checks.push('history exposes old/new/source/actor/reason');await cli('screenshot');
    await act('click','button','กลับไปดูแชทของรายการนี้');await until("document.querySelector('.expense-profile-dialog').open",false,'return-to-chat closes dialog');assert.equal(await value('document.activeElement.id'),'chatlist');checks.push('return-to-chat focuses original timeline');
    await cli('goto',scopeUrl(5,'slip'));await openProfile();await select('ประเภทรายการ','refund_adjustment');await fill('เหตุผลการบันทึก','ตรวจรายการคืนเงินตามแชท');await saveReviewed();await until('document.activeElement.id','expense-profile-notes','nonpurchase missing explanation focused');await fill('หมายเหตุ / เหตุผลที่ข้อมูลยังไม่ครบ','คืนเงินลูกค้า ไม่ใช่การซื้อ ไม่สร้างชื่อร้านปลอม');await saveReviewed();await until("document.querySelector('.expense-profile-dialog').textContent.includes('บันทึกว่าตรวจข้อมูลแล้ว')",true,'refund reviewed without fictitious supplier');
    await cli('goto',scopeUrl(4,'slip'));await openProfile();await select('ประเภทรายการ','unknown');await fill('เหตุผลการบันทึก','ยังไม่ทราบซื้ออะไร');await saveReviewed();await until('document.activeElement.id','expense-profile-notes','unknown transaction explanation required');await fill('หมายเหตุ / เหตุผลที่ข้อมูลยังไม่ครบ','รอคำอธิบายจากผู้ส่ง ยังไม่ทราบผู้รับ');await saveReviewed();await until("document.querySelector('.expense-profile-dialog').textContent.includes('บันทึกว่าตรวจข้อมูลแล้ว')",true,'unknown exception saved explicitly');
    await cli('goto',scopeUrl(5,'slip'));await openProfile();await select('ประเภทรายการ','internal_transfer');
    assert.equal(await value("document.getElementById('expense-profile-collapsed-supplier_name')?.tagName"),'DETAILS');
    assert.equal(await value("document.querySelector('#expense-profile-collapsed-supplier_name').open"),false);checks.push('internal_transfer collapses shop/relationship section');
    assert.equal(await value("document.getElementById('expense-profile-required-notes').hidden"),false);assert.equal(await value("document.getElementById('expense-profile-required-supplier_name').hidden"),true);checks.push('internal_transfer requires notes, not shop');
    assert.match(await value("document.getElementById('expense-profile-type-hint').textContent"),/จัดเป็นอื่น ๆ/);checks.push('internal_transfer hint points to Other for outstanding slips');
    await select('ประเภทรายการ','purchase');assert.equal(await value("document.getElementById('expense-profile-collapsed-supplier_name')"),null);checks.push('switching back to purchase expands shop fields');
    const options=await value("[...document.getElementById('expense-profile-transaction_type').options].map(o=>o.value)");assert.deepEqual(options,['','purchase','advance_payment','reimbursement','internal_transfer','loan','refund_adjustment','unknown']);checks.push('all transaction choices rendered');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('review exceptions preserve financial/AI/LINE baseline');
  }else if(phase==='conflict'){
    await cli('goto',scopeUrl(3));await openProfile();
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างจากหน้าจอ A ที่ต้องเก็บไว้');await fill('เหตุผลการบันทึก','ตรวจจากหน้าจอ A');
    await cli('tab-new',scopeUrl(3));await openProfile();await fill('รายการซื้อ / วัตถุประสงค์','คำอธิบายใหม่ที่หน้าจอ B บันทึก');await fill('เหตุผลการบันทึก','อีกคนแก้ข้อมูลก่อน');await saveDraft();await until("document.querySelector('.expense-profile-dialog').textContent.includes('บันทึกร่างแล้ว')",true,'second tab save succeeds');
    await cli('tab-select','0');await saveDraft();await until("document.querySelector('.expense-profile-dialog').textContent.includes('ร่างของคุณยังอยู่')",true,'stale revision conflict is visible');
    assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างจากหน้าจอ A ที่ต้องเก็บไว้');checks.push('conflict retains manual draft');
    await act('click','button','โหลดฉบับล่าสุด');await cli('dialog-dismiss');assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างจากหน้าจอ A ที่ต้องเก็บไว้');checks.push('cancel reload preserves dirty draft');
    await act('click','button','โหลดฉบับล่าสุด');await cli('dialog-accept');await until("document.getElementById('expense-profile-purpose').value",'คำอธิบายใหม่ที่หน้าจอ B บันทึก','accepted reload loads actual latest server revision');
    await cli('tab-close','1');await cli('tab-select','0');await cli('screenshot');
    await act('click','button','ปิด · เก็บร่างไว้');await until("document.querySelector('.expense-profile-dialog').open",false,'close button works');
    assert.equal(await value("document.activeElement.classList.contains('btn') && document.activeElement.textContent.includes('ข้อมูลสำหรับค่าใช้จ่าย')"),true);checks.push('close restores entry focus');
    await openProfile();await cli('press','Shift+Tab');assert.equal(await value('document.activeElement.id'),'expense-profile-reload');await cli('press','Tab');assert.equal(await value('document.activeElement.id'),'expense-profile-close');checks.push('Tab/ShiftTab remain in modal and wrap');
    await fill('รายการซื้อ / วัตถุประสงค์','พิมพ์ตัวอักษรในฟอร์ม');await cli('press','End');await cli('press','Enter');await cli('type','บรรทัดเพิ่ม');assert.match(await value("document.getElementById('expense-profile-purpose').value"),/\nบรรทัดเพิ่ม/);checks.push('Enter adds multiline text without saving/navigation');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('concurrent facts edits preserve financial baseline');
  }else if(phase==='failure'){
    // Network simulation is deliberately limited to this fictional browser route.
    // It tests displayed retry/failure states; it does not replace UI actions with API mutations.
    await cli('run-code',"await page.route('**/items/6/expense-profile',r=>r.abort('failed'))");
    await cli('goto',scopeUrl(6,'bill',fixture.groups[1]));await actPrefix('click','button','ข้อมูลสำหรับค่าใช้จ่าย');await until("document.querySelector('.expense-profile-dialog').textContent.includes('ลองโหลดข้อมูลอีกครั้ง')",true,'GET failure exposes retry');
    await cli('run-code',"await page.unroute('**/items/6/expense-profile')");await act('click','button','ลองโหลดข้อมูลอีกครั้ง');await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 0')",true,'retry actual GET succeeds');
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างหลังโหลดใหม่');await fill('เหตุผลการบันทึก','ทดสอบข้อขัดข้องชั่วคราว');
    await cli('run-code',"await page.route('**/items/6/expense-profile',r=>r.request().method()==='PUT'?r.abort('failed'):r.continue())");await saveDraft();await until("document.querySelector('.expense-profile-dialog [role=alert]')?.textContent",text=>typeof text==='string'&&text.length>0,'PUT failure shown without false success');
    assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างหลังโหลดใหม่');assert.equal(await value("document.querySelector('.expense-profile-state').classList.contains('saved')"),false);checks.push('failed save keeps draft and does not claim success');
    await cli('run-code',"await page.unroute('**/items/6/expense-profile')");await saveDraft();await until("document.querySelector('.expense-profile-dialog').textContent.includes('ฉบับ 1')",true,'retry actual PUT persists draft');
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างระหว่างรอบันทึก');await fill('เหตุผลการบันทึก','ทดสอบกดซ้ำระหว่างรอ');
    await cli('run-code',"await page.route('**/items/6/expense-profile',async r=>{if(r.request().method()==='PUT')await new Promise(resolve=>setTimeout(resolve,3000));await r.continue()})");
    const beforeSql=new DatabaseSync(fixture.db_path,{readOnly:true});const before=beforeSql.prepare('SELECT revision FROM capture_expense_profiles WHERE item_id=6').get().revision;beforeSql.close();
    const saveRef=await ref('button','บันทึกร่าง');await cli('dblclick',saveRef);await until("document.querySelector('.expense-profile-state').textContent.includes('บันทึกร่างแล้ว')",true,'delayed save finishes');
    const afterSql=new DatabaseSync(fixture.db_path,{readOnly:true});assert.equal(afterSql.prepare('SELECT revision FROM capture_expense_profiles WHERE item_id=6').get().revision,before+1);afterSql.close();checks.push('double click produces one persisted revision');await cli('run-code',"await page.unroute('**/items/6/expense-profile')");
    await cli('run-code',"await page.route('**/items/6/image',r=>r.abort('failed'))");await act('click','button','โหลดฉบับล่าสุด');await until("document.querySelector('.expense-profile-image-link').textContent.includes('โหลดภาพไม่ได้')",true,'image load failure gives usable fallback');await cli('screenshot');await cli('run-code',"await page.unroute('**/items/6/image')");await act('click','button','โหลดฉบับล่าสุด');await until("document.querySelector('.expense-profile-image-link img')?.naturalWidth>0",true,'image retry recovers');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('failure and retry leave original financial facts intact');
  }else if(phase==='stale'){
    await cli('run-code',"await page.route('**/items/6/expense-profile',async r=>{if(r.request().method()==='GET')await new Promise(resolve=>setTimeout(resolve,30000));await r.continue()})");
    await cli('goto',scopeUrl(6,'bill',fixture.groups[1]));await actPrefix('click','button','ข้อมูลสำหรับค่าใช้จ่าย');
    assert.match(await value("document.querySelector('.expense-profile-dialog').textContent"),/กำลังโหลด/);checks.push('delayed GET shows loading state');
    await cli('press','Escape');await act('select','combobox','เลือกกลุ่ม LINE',fixture.groups[0]);await actPrefix('click','button','บิลไม่เข้าคู่');await openProfile();
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างกลุ่มหลักระหว่างรอคำตอบของอีกรูป');
    await until("performance.getEntriesByType('resource').some(e=>e.name.endsWith('/items/6/expense-profile')&&e.responseEnd>0)",true,'old delayed response finishes after switching group');
    assert.match(await value("document.querySelector('.expense-profile-dialog').textContent"),/รูป #3/);
    assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างกลุ่มหลักระหว่างรอคำตอบของอีกรูป');checks.push('late response cannot overwrite another group document or its draft');
    await cli('run-code',"await page.unroute('**/items/6/expense-profile')");assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('delayed navigation does not mutate financial facts');
  }else if(phase==='other'){
    const readItem=id=>{const sql=new DatabaseSync(fixture.db_path,{readOnly:true});sql.exec('PRAGMA query_only=ON');try{return {...sql.prepare('SELECT * FROM capture_items WHERE id=?').get(id)}}finally{sql.close()}};
    const learningCount=()=>{const sql=new DatabaseSync(fixture.db_path,{readOnly:true});try{return sql.prepare('SELECT COUNT(*) n FROM ai_category_learning_examples').get().n}finally{sql.close()}};
    const learningRows=()=>{const sql=new DatabaseSync(fixture.db_path,{readOnly:true});sql.exec('PRAGMA query_only=ON');try{return sql.prepare('SELECT * FROM ai_category_learning_examples ORDER BY id').all().map(row=>({...row}))}finally{sql.close()}};
    const before=readItem(4),beforeLearning=learningCount();
    const openOther=async()=>{
      let tree=await snapshot();
      if(!tree.includes('button "จัดเป็นอื่น ๆ"')){
        await act('click','generic','ตัวเลือกอื่นและแก้ข้อมูล');
      }
      await act('click','button','จัดเป็นอื่น ๆ');await until("!document.getElementById('not-document-bg').hidden",true,'Other dialog opens');
    };
    const choose=kind=>actPrefix('select','combobox','รูปนี้เป็นอะไร',kind);
    const useAI=on=>actPrefix(on?'check':'uncheck','checkbox','ให้ AI ช่วยวิเคราะห์ก่อนตัดสินใจ');
    const learn=on=>actPrefix(on?'check':'uncheck','checkbox','ใช้การแก้ครั้งนี้เป็นตัวอย่างสอน AI');
    const submitOther=()=>actPrefix('click','button','ยืนยัน');
    await cli('goto',scopeUrl(4,'slip'));await openOther();
    assert.equal(await value("document.getElementById('not-document-use-ai').checked || document.getElementById('not-document-learn').checked"),false);checks.push('both AI analysis and learning default off');
    for(const kind of['account','notice','quotation','conversation','cashswap','general']){await choose(kind);assert.equal(await value("document.getElementById('not-document-submit').disabled"),false);assert.deepEqual(readItem(4),before);}
    checks.push('all six presets enable manual save without mutation');await choose('custom');assert.equal(await value("document.getElementById('not-document-submit').disabled"),true);checks.push('custom reason cannot be empty');
    await actPrefix('fill','textbox','ระบุว่ารูปนี้คืออะไร','ก'.repeat(1000));assert.equal(await value("document.getElementById('not-document-submit').disabled"),false);checks.push('1000-character custom reason accepted without truncation');
    await choose('account');assert.equal(await value("document.getElementById('not-document-submit').disabled"),true);assert.match(await value("document.getElementById('not-document-reason-length').textContent"),/กรุณาย่อ/);checks.push('combined preset and detail beyond server limit visibly blocked');
    await choose('custom');await actPrefix('fill','textbox','ระบุว่ารูปนี้คืออะไร','');
    await act('click','button','ยกเลิก');assert.deepEqual(readItem(4),before);checks.push('Cancel preserves original category');await openOther();await act('click','button','ปิด');assert.deepEqual(readItem(4),before);checks.push('Close preserves original category');await openOther();await cli('press','Escape');await until("document.getElementById('not-document-bg').hidden",true,'Escape closes Other');assert.deepEqual(readItem(4),before);
    await openOther();await cli('mousemove','5','5');await cli('mousedown');await cli('mouseup');await until("document.getElementById('not-document-bg').hidden",true,'backdrop dismissal works');assert.deepEqual(readItem(4),before);
    await openOther();await choose('custom');await actPrefix('fill','textbox','ระบุว่ารูปนี้คืออะไร','ภาพตัวอย่างเพื่อทดสอบการแก้ประเภทเอง ไม่ใช่สลิปจริง');await submitOther();await until("document.getElementById('not-document-bg').hidden",true,'manual no-AI category save closes dialog');assert.equal(readItem(4).category,'other');assert.equal(learningCount(),beforeLearning);checks.push('manual save reaches API without learning');await act('click','button','ย้อนกลับ');assert.equal(readItem(4).category,'transfer');checks.push('Undo restores original category');
    await cli('goto',scopeUrl(4,'slip'));await openOther();await choose('custom');await actPrefix('fill','textbox','ระบุว่ารูปนี้คืออะไร','รูป');await useAI(true);assert.equal(await value("document.getElementById('not-document-submit').disabled"),true);await actPrefix('click','button','ให้ AI วิเคราะห์รูปและเหตุผล');await until("document.getElementById('not-document-ai-status').textContent.includes('ข้อสงสัย')",true,'mock AI clarification shown');await learn(true);assert.equal(await value("document.getElementById('not-document-submit').disabled"),true);checks.push('clarify outcome cannot teach AI');await act('fill','textbox','คำตอบเพิ่มเติมให้ AI','เป็นภาพแจ้งบัญชีประกอบการทดสอบที่ผู้ใช้ตรวจแล้ว');await until("document.getElementById('not-document-submit').disabled",true,'editing clarification invalidates prior analysis');await actPrefix('click','button','ส่งคำตอบให้ AI วิเคราะห์อีกครั้ง');await until("document.getElementById('not-document-ai-status').textContent.includes('เห็นตรง')",true,'mock accepted reanalysis shown');assert.equal(await value("document.getElementById('not-document-submit').disabled"),false);await submitOther();await until("document.getElementById('not-document-bg').hidden",true,'explicit accepted teaching saved');assert.equal(learningCount(),beforeLearning+1);checks.push('learning only recorded after explicit accepted consent');const approvedLearning=learningRows();assert.equal(approvedLearning.at(-1).corrected_category,'other');await act('click','button','ย้อนกลับ');assert.equal(readItem(4).category,'transfer');assert.deepEqual(learningRows(),approvedLearning,'Undo must not rewrite the approved example or create reverse learning');checks.push('Undo preserves training history without creating or rewriting learning');
    await cli('goto',scopeUrl(4,'slip'));await openOther();await choose('account');await useAI(true);
    await cli('run-code',"await page.route('**/items/4/category-learning/review',r=>r.abort('failed'))");await actPrefix('click','button','ให้ AI วิเคราะห์รูปและเหตุผล');await until("document.getElementById('not-document-ai-status').textContent",'AI วิเคราะห์ไม่สำเร็จ','AI error gives manual fallback');await useAI(false);assert.equal(await value("document.getElementById('not-document-submit').disabled"),false);assert.equal(await value("document.getElementById('not-document-learn').checked"),false);checks.push('AI failure can fall back to no-AI manual save');await cli('run-code',"await page.unroute('**/items/4/category-learning/review')");await act('click','button','ยกเลิก');
    const final=financialSnapshot(),baseline=JSON.parse(await fs.readFile(fixture.baseline_path,'utf8'));assert.deepEqual(final.capture_matches,baseline.capture_matches);for(const id of[1,2,3,4,5,6]){const item=readItem(id),original=baseline.capture_items.find(row=>row.id===id);assert.equal(item.bill_total_value,original.bill_total_value);assert.equal(item.slip_amount_value,original.slip_amount_value)}checks.push('Other decisions preserve all document amounts and confirmed pair');await cli('screenshot');
  }else if(phase==='layout'){
    await cli('goto',scopeUrl(3));await openProfile();
    for(const [width,height]of[[1280,800],[1440,900],[1920,1080]]){
      await cli('resize',String(width),String(height));
      const measured=await value("(()=>{const d=document.querySelector('.expense-profile-dialog'),f=d.querySelector('.expense-profile-footer'),head=d.querySelector('.expense-profile-head'),form=d.querySelector('.expense-profile-form'),img=d.querySelector('img'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,dialog:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width},overflow:d.scrollWidth>d.clientWidth,footer:f.getBoundingClientRect().bottom,head:head.getBoundingClientRect().top,imageLoaded:img.complete&&img.naturalWidth>0,formScrollable:form.scrollHeight>form.clientHeight}})()");
      assert.equal(measured.overflow,false);assert.ok(measured.dialog.width>=1100);assert.ok(measured.dialog.x>=0&&measured.dialog.right<=width);assert.ok(measured.head>=0&&measured.footer<=height);assert.equal(measured.imageLoaded,true);assert.equal(measured.formScrollable,true);checks.push(`${width}x${height}: bounded wide workspace, actual image, footer visible, no horizontal overflow`);await cli('screenshot');
    }
    await cli('console','error');await cli('requests');
  }else if(phase==='finish'){
    await cli('close');checks.push('own fictional browser closed; fixture evidence retained');
  }else if(phase==='scope'){
    await cli('goto',scopeUrl(6,'bill',fixture.groups[1]));await openProfile();await fill('รายการซื้อ / วัตถุประสงค์','ร่างเฉพาะของกลุ่มอื่นที่ยังไม่บันทึก');await act('click','button','ปิด · เก็บร่างไว้');
    await act('select','combobox','เลือกกลุ่ม LINE',fixture.groups[0]);await until("document.querySelector('.expense-profile-entry')!==null",true,'switch group loads main document');await actPrefix('click','button','บิลไม่เข้าคู่');await openProfile();
    await fill('รายการซื้อ / วัตถุประสงค์','ร่างเฉพาะกลุ่มหลักที่ยังไม่บันทึก');await act('click','button','ปิด · เก็บร่างไว้');
    await act('select','combobox','เลือกกลุ่ม LINE',fixture.groups[1]);await until("document.querySelector('.expense-profile-entry')!==null",true,'switch back to other group');await openProfile();assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างเฉพาะของกลุ่มอื่นที่ยังไม่บันทึก');checks.push('other group unsaved draft retained separately');await act('click','button','ปิด · เก็บร่างไว้');
    await act('select','combobox','เลือกกลุ่ม LINE',fixture.groups[0]);await until("document.querySelector('.expense-profile-entry')!==null",true,'return to main group');await actPrefix('click','button','บิลไม่เข้าคู่');await openProfile();assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างเฉพาะกลุ่มหลักที่ยังไม่บันทึก');checks.push('main group draft retained without contamination');
    await act('click','button','ปิด · เก็บร่างไว้');await act('click','button','โหลดข้อมูลล่าสุด ไม่เรียก AI');await until("document.querySelector('.expense-profile-entry')!==null",true,'background-style reload finishes');await openProfile();assert.equal(await value("document.getElementById('expense-profile-purpose').value"),'ร่างเฉพาะกลุ่มหลักที่ยังไม่บันทึก');checks.push('main reload preserves dirty expense draft');
    assert.deepEqual(financialSnapshot(),JSON.parse(await fs.readFile(fixture.baseline_path,'utf8')));checks.push('in-page scope changes do not write financial data');await cli('screenshot');
  }else throw Error(`Unknown phase ${phase}`);
  const report={phase,fictional:true,checks,fixture:fixturePath,browser_dir:browserDir,log_path:logPath,passed:true,production_mutations:false};
  await fs.writeFile(path.join(out,`expense-browser-${phase}.json`),JSON.stringify(report,null,2));
  console.log(`${phase}: ${checks.length} browser checks passed; ${logPath}`);
}catch(error){
  await fs.writeFile(path.join(out,`expense-browser-${phase}.json`),JSON.stringify({phase,fictional:true,checks,passed:false,error:error.message,log_path:logPath},null,2));
  throw error;
}
