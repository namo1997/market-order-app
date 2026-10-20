import { test, expect } from '@playwright/test';
import path from 'node:path';
import { staticServer } from '../support/static-server.mjs';
import { ssdDirectory } from '../support/ssd-path.mjs';
for (const viewport of [{width:360,height:800},{width:390,height:844},{width:412,height:915}]) for(const colorScheme of ['light','dark']) {
 test.describe(`P ${viewport.width} ${colorScheme}`,()=>{
  test.use({viewport,colorScheme});
  test('blind unusual count, correction/confirmation and manual notes',async({page})=>{
   const server=await staticServer(), errors=[], unexpected=[];
   const out=ssdDirectory(path.join(process.env.E2E_OUT,`${viewport.width}-${colorScheme}`));
   const user={id:12,name:'IT receiver',role:'user',branch_id:1,department_id:10};
   let doc={id:5,client_uuid:'P-e2e',supplier_name_text:'ร้าน P',product_group_id:3,branch_id:1,department_id:10,scope:'department',kind:'manual_receipt',status:'draft',receiver_user_id:12,delivery_date:'2026-10-20',counted_complete_at:null,lines:[{id:1,line_no:1,product_id:7,product_name:'น้ำแข็ง',order_item_id:50,unit_text:'ถุง'}],images:[],warnings:[],ocr:{status:'locked'}};
   let saves=0;
   page.on('pageerror',e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
   await page.addInitScript(({user,colorScheme})=>{sessionStorage.setItem('token','SYNTHETIC-local-session');sessionStorage.setItem('user',JSON.stringify(user));localStorage.setItem('solao.receiving.theme.v1',colorScheme);},{user,colorScheme});
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url()),method=route.request().method();
    if(!url.pathname.startsWith('/api/')){if(url.origin===server.url)return route.continue();unexpected.push(url.origin);return route.abort();}
    const headers={'access-control-allow-origin':server.url,'access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers});
    const ok=data=>route.fulfill({status:200,headers,json:{success:true,data}});
    if(url.pathname==='/api/auth/me')return ok(user);
    if(url.pathname==='/api/receiving-followups')return ok({items:[],pending_count:0});
    if(url.pathname.endsWith('/expected'))return ok([{supplier_key:'pg:3',supplier_name:'ร้าน P',items:[{order_item_id:50,product_id:7,product_name:'น้ำแข็ง',has_pending:true,age_days:90}]}]);
    if(url.pathname==='/api/receiving-documents')return ok([doc]);
    if(url.pathname.endsWith('/5/count')){
      const body=route.request().postDataJSON();
      if(body.check_only)return ok({count_warnings:[{product_id:7,quantity:body.lines[0].counted_quantity,unit:'ถุง'}]});
      saves++;doc={...doc,counted_complete_at:'2026-10-20T03:00:00Z',lines:doc.lines.map(line=>({...line,counted_quantity:'10144',quantity_received:'10144',quantity_ordered:'2',review_decision:'missing_bill'}))};return ok(doc);
    }
    if(url.pathname.endsWith('/5')&&method==='PUT'){const body=route.request().postDataJSON();doc={...doc,lines:body.lines.map(l=>({...doc.lines.find(row=>row.id===l.id),...l}))};return ok(doc);}
    if(url.pathname.endsWith('/5'))return ok(doc);
    if(url.pathname.endsWith('/5/signatures')){doc={...doc,has_receiver_signature:true};return ok(doc);}
    if(url.pathname.endsWith('/5/confirm')){doc={...doc,status:'confirmed',confirmed_at:'2026-10-19T03:00:00Z'};return ok(doc);}
    unexpected.push(`${method} ${url.pathname}`);return route.fulfill({status:500,headers,json:{}});
   });
   const capture=async name=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});};
   try{
    await page.goto(`${server.url}/receiving`);
    await page.getByRole('button',{name:'เลือกร้าน ร้าน P',exact:true}).click();await expect(page.getByText('ค้าง 90 วัน',{exact:true})).toBeVisible();await capture('01-carryover');
    await page.getByRole('button',{name:'รับของ ร้าน P',exact:true}).click();await page.getByRole('button',{name:'ทำต่อใบ #5',exact:true}).click();
    await page.getByRole('textbox',{name:'นับได้ น้ำแข็ง',exact:true}).fill('10144');await page.getByRole('button',{name:'ยืนยันการนับ',exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toContainText('จำนวน 10144 ถุง ถูกต้องไหม?');await expect(dialog).not.toContainText('สั่ง');expect(saves).toBe(0);await capture('02-count-warning');
    for(const label of ['แก้ไข','ยืนยัน']){const box=await dialog.getByRole('button',{name:label,exact:true}).boundingBox();expect(box.height).toBeGreaterThanOrEqual(48);}
    await dialog.getByRole('button',{name:'แก้ไข',exact:true}).click();await expect(page.getByRole('textbox',{name:'นับได้ น้ำแข็ง',exact:true})).toHaveValue('10144');
    await page.getByRole('button',{name:'ยืนยันการนับ',exact:true}).click();await dialog.getByRole('button',{name:'ยืนยัน',exact:true}).click();expect(saves).toBe(1);
    await page.getByRole('textbox',{name:'หมายเหตุรายการ (ไม่เกิน 300 ตัวอักษร)',exact:true}).fill('โทรสั่ง เพิ่มน้ำแข็ง');await capture('03-note-summary');
    await page.getByRole('button',{name:'ไปเซ็นรับของ',exact:true}).click();expect(doc.lines[0].note).toBe('โทรสั่ง เพิ่มน้ำแข็ง');
    await capture('04-before-sign');expect(errors).toEqual([]);expect(unexpected).toEqual([]);
   }finally{await server.close();}
  });
 });
}
