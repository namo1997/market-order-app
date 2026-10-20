import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness, track, cleanup, doc, row, text, deferred, chooseFile } from './review-a-port-harness.mjs';
import { reviewLedger } from '../src/pages/receiving/review-ledger.js';
import { receiptFacts, receiptExplanation, evidenceAction } from '../src/receiving-app/issue-labels.mjs';
import { relatedFollowups } from '../src/pages/admin/receiving/receiving-ledger.js';
afterEach(cleanup);
const fixture = doc({ status:'confirmed', total:'600.00', discount:'0', vat:'0', audits:[], receipt_value:{received_known:'540.00',received_net:'540.00',pending_price_count:2},
  branch_name:'สาขาทดสอบ', department_name:'ครัว', lines:[
    row(1,{quantity_billed:'10',quantity_received:'9',unit_price:'60',amount:'600'}),
    row(2,{quantity_billed:null,quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'}),
    row(3,{quantity_billed:null,quantity_received:'5',unit_price:null,amount:null,review_decision:'missing_bill'}),
  ] });
const data={items:[{...fixture,receipt_value:{received_known:'540.00',received_net:'540.00',pending_price_count:2}}],
  pagination:{page:1,total_pages:1,total:1,page_size:25},summary:{today:'2026-10-18',today_count:1,draft_count:0,
    confirmed_total:'600.00',received_known_total:'540.00',received_net_total:'540.00',pending_price_count:2}};
const admin = (location, api={}) => harness('AdminReceiving', {}, {
  list:async()=>data, options:async()=>({branches:[],departments:[]}), get:async()=>fixture,
  issuesSummary:async()=>({pending_issue_count:3}), followups:async()=>({items:[],pending_count:1}), ...api,
}, {}, {location}, {AbortController}, null, '../src/pages/admin/receiving/AdminReceiving.jsx').then(track);

test('E1 direct /admin/receiving/:id waits safely, requests ID, renders loaded detail and handles delayed followups',async()=>{
  const pending=deferred(), followups=deferred(), calls=[];
  const h=await admin({pathname:'/admin/receiving/5'},{get:(id,signal)=>{calls.push([id,signal]);return pending.promise;},followups:()=>followups.promise});
  assert.match(text(h),/กำลังโหลดใบรับสินค้า/);assert.equal(calls[0][0],'5');assert.equal(calls[0][1].aborted,false);
  pending.resolve(fixture);await h.settle();assert.match(text(h),/ใบรับสินค้า #5/);assert.match(text(h),/กำลังโหลดเรื่องตามของ/);
  followups.resolve({items:[],pending_count:0});await h.settle();assert.match(text(h),/ไม่พบเรื่องค้าง/);
  assert.equal(relatedFollowups(undefined,[{branch_id:1}]).length,0);
});

for(const status of [403,404,500])test(`E1 direct URL error ${status} keeps retry and back; retry loads detail`,async()=>{
  let fail=true,reads=0;
  const h=await admin({pathname:'/admin/receiving/5'},{get:async()=>{reads++;if(fail)throw {response:{status,data:{message:`อ่านใบรับไม่ได้ ${status}`}}};return fixture;}});
  assert.match(text(h),new RegExp(`อ่านใบรับไม่ได้ ${status}`));assert.ok(h.all().some(n=>n.props.role==='alert'));
  assert.ok(h.all().some(n=>n.type==='a'&&n.props.to==='/admin/receiving'));
  fail=false;await h.click('ลองใหม่');assert.equal(reads,2);assert.match(text(h),/ใบรับสินค้า #5/);
});

test('E1 list -> detail -> another ID never renders stale doc before the new request resolves; late requests ignored',async()=>{
  const location={pathname:'/admin/receiving'},first=deferred(),second=deferred();const ids=[];
  const h=await admin(location,{get:id=>{ids.push(id);return id==='5'?first.promise:second.promise;}});
  assert.match(text(h),/ทะเบียนใบรับสินค้า/);
  location.pathname='/admin/receiving/5';await h.settle();assert.match(text(h),/กำลังโหลดใบรับสินค้า/);
  location.pathname='/admin/receiving/6';await h.settle();assert.deepEqual(ids,['5','6']);
  first.resolve(fixture);await h.settle();assert.doesNotMatch(text(h),/ใบรับสินค้า #5/);
  second.resolve({...fixture,id:6});await h.settle();assert.match(text(h),/ใบรับสินค้า #6/);
});

test('E2 E3 E4 rendered accounting list separates bill 600 / received 540 / 2 pending prices and 1 followup / 3 issues',async()=>{
  const h=await admin({pathname:'/admin/receiving'});
  const articles=h.all().filter(n=>n.type==='article').map(n=>h.text(n));
  for(const expected of ['ยอดบิลที่ยืนยัน600.00 บาท','มูลค่ารับ (ทราบราคา)540.00 บาท','รอราคา2 รายการ','เรื่องตามของค้าง1 เรื่อง','ปัญหารับของค้าง3 เรื่อง'])assert.ok(articles.some(s=>s.includes(expected)),expected);
  const ledger=reviewLedger(fixture);assert.equal(ledger.bill,60000n);assert.equal(ledger.received,54000n);assert.equal(ledger.pendingPrices.length,2);
  const cells=h.all().filter(n=>n.type==='td').map(n=>h.text(n));assert.ok(cells.includes('600.00 บาท'));assert.ok(cells.includes('540.00 บาท'));assert.ok(cells.includes('2 รายการ'));
  assert.equal(h.all().filter(n=>n.type==='nav'&&n.props['aria-label']==='เมนูรับสินค้า').length,0);
  assert.ok(h.all().some(n=>n.type==='a'&&n.props.to==='/admin/receiving/issues'&&h.text(n)==='ดูเรื่องค้าง'));
});

test('E2 detail computes shared ledger values; E3 issues-count error cannot appear as zero or hide valid ledger',async()=>{
  const h=await admin({pathname:'/admin/receiving/5'});
  for(const expected of ['ยอดบิล600.00 บาท','มูลค่ารับ (ทราบราคา)540.00 บาท','รอราคา2 รายการ'])assert.match(text(h),new RegExp(expected.replace(/[()]/g,'\\$&')));
  let failed=true;
  const list=await admin({pathname:'/admin/receiving'},{issuesSummary:async()=>{if(failed)throw Error('offline');return {pending_issue_count:3};}});
  assert.match(text(list),/โหลดจำนวนปัญหารับของไม่สำเร็จ/);assert.doesNotMatch(text(list),/ปัญหารับของค้าง0 เรื่อง/);assert.match(text(list),/540.00 บาท/);
  failed=false;await list.click('ลองโหลดจำนวนปัญหาอีกครั้ง');assert.match(text(list),/ปัญหารับของค้าง3 เรื่อง/);
});

test('E2 accounting detail and list use the same net-after-discount/tax as the app summary',async()=>{
  const net={...fixture,discount:'10.00',vat:'7.00',receipt_value:{received_known:'540.00',received_net:'537.00',pending_price_count:2}};
  const h=await admin({pathname:'/admin/receiving/5'},{get:async()=>net});
  assert.match(text(h),/มูลค่ารับ \(ทราบราคา\)537.00 บาท/);
  assert.equal(reviewLedger(net).receivedNet,53700n);
  const list=await admin({pathname:'/admin/receiving'},{list:async()=>({...data,items:[net],summary:{...data.summary,received_net_total:'537.00'}})});
  const card=list.all().find(n=>n.type==='article'&&list.text(n).startsWith('มูลค่ารับ'));
  assert.match(list.text(card),/537.00 บาท/);assert.ok(list.all().some(n=>n.type==='td'&&list.text(n)==='537.00 บาท'));
});

test('E4 accounting page keeps one issues tab in the existing global navigation, with no redundant header shortcut',async()=>{
  const source=await readFile(new URL('../src/pages/admin/receiving/AdminReceiving.jsx',import.meta.url),'utf8');
  const navigation=await readFile(new URL('../src/components/layout/Navigation.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/ra-tabs|ra-issues-link/);
  assert.equal((navigation.match(/to="\/admin\/receiving\/issues"/g)||[]).length,1);
});

test('E UI palette text/control colors meet AA in accounting and light/dark issue facts',async()=>{
  const luminance=hex=>hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  for(const [fg,bg]of [['24304a','f7f5f0'],['596275','ffffff'],['596275','f7f5f0'],['1e3168','edf0f7'],['1e3168','ffffff'],['ffffff','1e3168'],['3e4758','ffffff'],['e0e5ee','1b2334']]){
    const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg}`);
  }
  for(const [fg,bg]of [['3158ba','ffffff'],['3158ba','f7f5f0'],['737d92','ffffff'],['737d92','f7f5f0']]){
    const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=3,`${fg}/${bg}`);
  }
  const css=await readFile(new URL('../src/pages/admin/receiving/receiving-admin.css',import.meta.url),'utf8');
  assert.match(css,/:focus-visible[^}]*outline: 3px solid var\(--sg-focus\)/);assert.match(css,/ra-filters input[^}]*border: 1px solid var\(--sg-control-border\)/);
});

const runtime={URLSearchParams,__shell:{Capacitor:{isNativePlatform:()=>false}},fetch:()=>{throw Error('No outbound network');}};
const staff={id:12,role:'user',branch_id:1};
const issue={id:3,type:'return',status:'open',branch_id:1,document_id:5,quantity:'5.00',unit_text:'กิโลกรัม',amount:'0',product_name:'อกไก่',supplier_name:'ร้านทดสอบ',note:'ไม่รับ · คืนร้าน',evidence:[],history:[],created_at:'2026-10-18T00:00:00Z',due_at:'2026-10-19T00:00:00Z',receipt_line:{counted_quantity:'5',quantity_received:'0',quantity_billed:null,review_decision:'not_received'}};

test('E5 return evidence opens, scrolls and receives focus; dirty cancel preserves proof until confirmed',async()=>{
  let discard=false;const dirty=[];
  const h=track(await harness('ReceivingIssueDetail',{id:3,user:staff,api:{detail:async()=>issue},onDirtyChange:v=>dirty.push(v)}, {}, {}, {confirm:()=>discard},runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx'));
  await h.click(evidenceAction(issue));assert.ok(h.scrolled.includes('return-evidence-3'));assert.ok(h.focused.includes('return-evidence-3'));
  assert.equal(h.find(n=>n.type==='button'&&h.text(n)==='ยกเลิกการกรอกหลักฐาน').props['aria-expanded'],true);
  await chooseFile(h);await h.select('ชื่อคนมารับคืน','คนขับ');assert.equal(dirty.at(-1),true);
  await h.click('ยกเลิกการกรอกหลักฐาน');assert.ok(h.all().some(n=>n.type==='form'));
  discard=true;await h.click('ยกเลิกการกรอกหลักฐาน');assert.equal(h.all().some(n=>n.type==='form'),false);assert.equal(dirty.at(-1),false);
});

test('E6 detail -> list -> receiving has exactly one back button at each stage, including direct issue entry',async()=>{
  let returned=0;const api={list:async()=>({items:[issue],next_before_id:null}),detail:async()=>issue};
  const h=track(await harness('ReceivingIssues',{embedded:true,initialId:3,onBackToReceiving:()=>returned++},api,{user:staff},{},runtime,null,'../src/receiving-app/ReceivingIssues.jsx'));
  const backs=()=>h.all().filter(n=>n.type==='button'&&/^กลับ/.test(h.text(n))).map(n=>h.text(n));
  assert.deepEqual(backs(),['กลับรายการ']);await h.click('กลับรายการ');assert.deepEqual(backs(),['กลับรับสินค้า']);
  await h.click('เปิดเรื่อง 3');assert.deepEqual(backs(),['กลับรายการ']);await h.click('กลับรายการ');await h.click('กลับรับสินค้า');assert.equal(returned,1);
});

test('E7 detail renders semantic label/value rows, missing-bill copy and units; unknown legacy bill remains unknown',async()=>{
  const h=track(await harness('ReceivingIssueDetail',{id:3,user:staff,api:{detail:async()=>issue}}, {}, {}, {},runtime,null,'../src/receiving-app/ReceivingIssueDetail.jsx'));
  const facts=h.all().filter(n=>n.type==='dl').flatMap(n=>h.all(n).filter(c=>c.type==='div').map(c=>h.text(c)));
  for(const value of ['นับได้5 กิโลกรัม','รับจริง0 กิโลกรัม','ในบิลไม่มีในบิล','จำนวน5 กิโลกรัม','มูลค่ารอราคา'])assert.ok(facts.includes(value),value);
  assert.doesNotMatch(text(h),/ในบิลไม่ทราบจำนวน/);
  assert.equal(receiptFacts({...issue,receipt_line:{quantity_billed:null}}).find(([label])=>label==='ในบิล')[1],'ไม่ทราบจำนวน');
  assert.match(receiptExplanation({...issue,receipt_line:{...issue.receipt_line,quantity_billed:'0'}}),/ในบิล 0 กิโลกรัม/);
  const css=await readFile(new URL('../src/receiving-app/receiving-issues.css',import.meta.url),'utf8');assert.match(css,/ri-facts > div[^}]*grid-template-columns/);
});
