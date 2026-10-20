import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {staticServer} from '../support/static-server.mjs';
import {ssdDirectory} from '../support/ssd-path.mjs';

const base={id:1,type:'return',status:'open',branch_id:1,branch_name:'สาขาสันทราย',owner_user_id:7,owner_name:'คุณบัญชี',document_id:5,
  product_name:'ขา B',supplier_name:'ร้านทดสอบ',quantity:'1.00',unit_text:'กก.',amount:'60.00',version:1,note:'',resolution:null,
  evidence:[],evidence_count:0,history:[],receipt_line:{return_status:'collected'},created_at:'2026-10-19T00:00:00Z',due_at:'2026-10-20T00:00:00Z'};
async function setup(page,role,colorScheme) {
  const server=await staticServer();const errors=[],unexpected=[],writes=[];let row=structuredClone(base);
  const user={id:role==='user'?12:7,name:role==='user'?'ผู้รับทดสอบ':'คุณบัญชี',role,branch_id:1,department_id:10};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({user,colorScheme})=>{
    sessionStorage.setItem('token','SYNTHETIC-local-session');sessionStorage.setItem('user',JSON.stringify(user));
    document.documentElement.dataset.theme=colorScheme;
  },{user,colorScheme});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    if(!url.pathname.startsWith('/api/')) {
      if(url.origin===server.url)return route.continue();
      unexpected.push(`${method} ${url.origin}${url.pathname}`);return route.abort();
    }
    const headers={'access-control-allow-origin':server.url,'access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers});
    const ok=data=>route.fulfill({status:200,headers,json:{success:true,data}});
    if(url.pathname==='/api/auth/me')return ok(user);
    if(url.pathname==='/api/receiving-followups')return ok({items:[],pending_count:0});
    if(url.pathname==='/api/receiving-issues/assignees')return ok({items:[{id:7,name:'คุณบัญชี'}]});
    if(url.pathname==='/api/receiving-issues')return ok({items:[row],next_before_id:null});
    if(url.pathname==='/api/receiving-issues/1/evidence'&&method==='POST'){
      const body=request.postDataJSON();expect(body.collector_name).toBe('คนขับทดสอบ');expect(body.image_data_url).toMatch(/^data:image\//);
      writes.push({kind:'evidence'});row={...row,evidence_count:1,evidence:[{id:1,collector_name:body.collector_name,created_at:base.created_at}]};return ok({id:1,created:true});
    }
    if(url.pathname==='/api/receiving-issues/1/evidence/1')return route.fulfill({status:200,headers,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=','base64')});
    if(url.pathname==='/api/receiving-issues/1'){
      if(method==='PUT'){
        const body=request.postDataJSON();writes.push({kind:'update',body});row={...row,...body,version:row.version+1};
      }
      return ok(row);
    }
    if(url.pathname==='/api/receiving-admin/issues-summary')return ok({items:[],total:0});
    unexpected.push(`${method} ${url.pathname}`);return route.fulfill({status:500,headers,json:{success:false}});
  });
  const directory=ssdDirectory(path.join(process.env.E2E_OUT,'screens',`round-${process.env.E2E_ROUND}`,`${page.viewportSize().width}-${colorScheme}-${role}`));
  async function capture(name) {
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name).toBe(true);
    await page.screenshot({path:path.join(directory,`${name}.png`),fullPage:true});
    const result=await new AxeBuilder({page}).include('.ri-page').withTags(['wcag2a','wcag2aa']).analyze();
    expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  }
  return {server,writes,errors,unexpected,capture,async close(){
    await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify({errors,unexpected,writes},null,2));
    await page.close();await server.close();
  }};
}
const viewports=[{width:360,height:800},{width:390,height:844},{width:412,height:915},{width:1440,height:1000}];
for(const viewport of viewports)for(const colorScheme of ['light','dark'])test.describe(`I ${viewport.width}x${viewport.height} ${colorScheme}`,()=>{
  test.use({viewport,colorScheme});
  test('I1/I3-I8 accounting names, light SOLAO shell, pending reference, confirm/cancel/complete',async({page})=>{
    const h=await setup(page,'accounting',colorScheme);
    try {
      await page.goto(`${h.server.url}/admin/receiving/issues`);
      await expect(page.getByRole('button',{name:'ออกจากระบบ'})).toBeVisible();
      const tabs=page.getByRole('navigation',{name:'งานรับสินค้า'});
      await expect(tabs.getByRole('link',{name:'ใบรับสินค้า',exact:true})).toBeVisible();
      await expect(tabs.getByRole('link',{name:'ปัญหารับของ',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByRole('link',{name:'กลับหน้ารับสินค้า',exact:true})).toHaveCount(0);
      await expect(page.locator('td[data-label="สาขา"]')).toHaveText('สาขาสันทราย');
      await expect(page.locator('td[data-label="สถานะ / ผู้รับผิดชอบ"]')).toContainText('คุณบัญชี');
      expect(await page.locator('.ri-page').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(247, 245, 240)');
      await h.capture('01-list');
      await page.getByRole('button',{name:'ดู/จัดการเรื่อง 1',exact:true}).click();
      await expect(page.locator('.ri-facts')).toContainText('คุณบัญชี');
      await page.getByLabel('สถานะ',{exact:true}).selectOption('resolved');
      await page.getByLabel('ทางจบ',{exact:true}).selectOption('credit_note');
      await page.getByRole('button',{name:'บันทึกทางจบและปิดเรื่อง',exact:true}).click();
      await expect(page.getByRole('alert')).toContainText('กรุณาใส่เลขที่เอกสาร');expect(h.writes).toHaveLength(0);
      await page.getByLabel('ยังไม่มีเลขที่ (ใส่ภายหลัง)',{exact:true}).check();
      await expect(page.getByRole('status')).toContainText('ยังขาดเลขที่ใบลดหนี้');await h.capture('02-pending-reference');
      await page.getByRole('button',{name:'บันทึกทางจบและปิดเรื่อง',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'ยืนยันปิดเรื่อง'});await expect(dialog).toBeVisible();expect(h.writes).toHaveLength(0);
      await h.capture('03-confirm-close');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(h.writes).toHaveLength(0);
      await page.getByRole('button',{name:'บันทึกทางจบและปิดเรื่อง',exact:true}).click();await dialog.getByRole('button',{name:'ยืนยันปิดเรื่อง',exact:true}).click();
      await expect(page.locator('.ri-badge')).toHaveText('ปิดเรื่องแล้ว');expect(h.writes).toHaveLength(1);
      await h.capture('04-closed-pending');await page.getByLabel('เลขที่ใบลดหนี้',{exact:true}).fill('CN-TEST-001');
      await page.getByRole('button',{name:'บันทึกเลขที่ใบลดหนี้',exact:true}).click();
      await expect(page.locator('.ri-detail')).toContainText('CN-TEST-001');await expect(page.getByRole('button',{name:'บันทึกเลขที่ใบลดหนี้',exact:true})).toHaveCount(0);
      expect(Object.keys(h.writes[1].body).sort()).toEqual(['resolution_ref','version']);await h.capture('05-completed');
      await page.reload();await expect(page.locator('.ri-badge')).toHaveCount(0);await page.getByRole('button',{name:'ดู/จัดการเรื่อง 1',exact:true}).click();
      await expect(page.locator('.ri-detail')).toContainText('CN-TEST-001');
      expect(h.errors).toEqual([]);expect(h.unexpected).toEqual([]);
    }finally{await h.close();}
  });
  test('I1/I2 staff Enter submits only evidence and returns to updated list without accounting closure',async({page})=>{
    const h=await setup(page,'user',colorScheme);
    try {
      await page.goto(`${h.server.url}/admin/receiving/issues?issue=1`);
      await page.getByRole('button',{name:'บันทึกการคืน (รูป + ลายเซ็นคนมารับ)',exact:true}).click();
      const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#f7f5f0';ctx.fillRect(0,0,800,600);return canvas.toDataURL('image/jpeg').split(',')[1];});
      await page.getByLabel('รูปหลักฐาน',{exact:true}).setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:Buffer.from(image,'base64')});
      await expect(page.locator('.ri-proof-preview')).toBeVisible();
      await page.getByLabel('ชื่อคนมารับคืน (จำเป็น)',{exact:true}).fill('คนขับทดสอบ');
      await expect(page.getByRole('button',{name:'กลับรายการ',exact:true})).toHaveAttribute('type','button');
      await expect(page.getByRole('button',{name:'รีเฟรช',exact:true})).toHaveAttribute('type','button');
      await page.getByLabel('ชื่อคนมารับคืน (จำเป็น)',{exact:true}).press('Enter');
      await expect(page.locator('.ri-badge')).toHaveText('แนบหลักฐานแล้ว · รอบัญชีตรวจ');expect(h.writes).toEqual([{kind:'evidence'}]);
      await expect(page.getByText('ร้านมารับแล้ว · กรุณาแนบหลักฐาน',{exact:true})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'บันทึกทางจบและปิดเรื่อง',exact:true})).toHaveCount(0);await h.capture('01-evidence-saved');
      await page.getByRole('button',{name:'ยกเลิกการกรอกหลักฐาน',exact:true}).click();
      await page.getByRole('button',{name:'กลับรายการ',exact:true}).click();
      await expect(page.locator('.ri-issue-card')).toContainText('แนบหลักฐานแล้ว · รอบัญชีตรวจ');await h.capture('02-list-awaiting');
      expect(h.errors).toEqual([]);expect(h.unexpected).toEqual([]);
    }finally{await h.close();}
  });
});
