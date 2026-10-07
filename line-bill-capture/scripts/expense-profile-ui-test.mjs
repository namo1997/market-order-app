import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/expense-profile.js', import.meta.url),'utf8');
const context = vm.createContext({ structuredClone, URLSearchParams, document: { getElementById: () => null } });
vm.runInContext(source + '\nthis.Drafts = ExpenseProfileDrafts; this.evidenceMessages = expenseProfileEvidenceMessages; this.validate = expenseProfileValidation; this.historyChanges = expenseProfileHistoryChanges; this.historyEvidence = expenseProfileHistoryEvidence; this.documentAmount = expenseProfileDocumentAmount; this.generatedDocument = expenseProfileGeneratedDocument; this.reviewDocuments = expenseProfileReviewDocuments; this.sourceHref = expenseProfileSourceHref; this.openOriginalChat = expenseProfileOpenOriginalChat; this.resolveSourceParent = expenseProfileResolveSourceParent; this.prepareSourceParent = expenseProfilePrepareSourceParent; this.requirements = expenseProfileRequirements;',context);
const pending = [];
const store = new context.Drafts((url,options) => new Promise((resolve,reject) => pending.push({ url, options, resolve, reject })));
const profile = (id,revision=0) => ({ item_id:id,revision,status:'draft',fields:{purpose:{value:null,source:'manual',evidence:[]}},suggestions:{purpose:{value:'ผัก',source:'bill',evidence:[{item_id:id}]}},history:[] });
store.activate(1);
const load1 = store.load(1);
store.activate(2);
const load2 = store.load(2);
pending[1].resolve({data:profile(2)}); await load2;
pending[0].resolve({data:profile(1)}); await load1;
assert.equal(store.active,2,'late GET must not change current item');
assert.equal(store.record(1).fields.purpose.value,null,'OCR must never fill saved facts automatically');
store.set(1,'purpose','แก้เอง');
await store.load(1);
assert.equal(pending.length,2,'reopening loaded draft must not request or overwrite it');
assert.equal(store.record(1).fields.purpose.value,'แก้เอง');
const draft = store.record(1); draft.reason='ตรวจรูปแล้ว';
const save1 = store.save(1,'draft');
await store.save(1,'reviewed');
assert.equal(pending.length,3,'double submit must not create second mutation');
const payload = JSON.parse(pending[2].options.body);
assert.equal(payload.expected_revision,0);
assert.equal(payload.fields.purpose.source,'manual');
const conflict = new Error('conflict'); conflict.details={code:'revision_conflict',current_revision:2};
pending[2].reject(conflict); await save1;
assert.equal(draft.fields.purpose.value,'แก้เอง','conflict retains draft');
assert.equal(draft.dirty,true);
assert.match(draft.error,/ร่างของคุณยังอยู่/);
store.set(1,'purpose','',null);
assert.equal(draft.fields.purpose.value,null,'unknown saves null');
store.set(1,'purpose','',draft.suggestions.purpose);
assert.equal(draft.fields.purpose.source,'bill');
assert.equal(draft.fields.purpose.evidence[0].item_id,1,'explicit adoption preserves provenance');
store.activate(1); store.set(1,'transaction_type','purchase'); store.set(1,'supplier_name','ร้านผัก'); draft.reason='ใช้ข้อเสนอ';
const save2=store.save(1,'reviewed'); store.activate(2);
pending[3].resolve({data:{...profile(1,3),status:'reviewed'}}); await save2;
assert.equal(store.active,2,'late save must not navigate or overwrite another item');
assert.equal(store.record(2).revision,0);
store.set(2,'purpose','ร่างระหว่างโหลด');
const reloading=store.load(2,true);
store.set(2,'purpose','แก้ระหว่างรอ');
pending[4].resolve({data:profile(2,8)}); await reloading;
assert.equal(store.record(2).fields.purpose.value,'แก้ระหว่างรอ','late reload must not erase edit');
assert.equal(store.record(2).dirty,true);
const evidenceItem = {id:2,source_id:'branch-a'};
const evidenceEntry = {evidence:[{item_id:2,message_id:'wanted'},{item_id:999,message_id:'unrelated'}]};
const evidenceHistory = [{evidence_snapshot:{messages:[{line_message_id:'wanted',source_id:'branch-a',text:'ซื้อผัก'},{line_message_id:'unrelated',source_id:'branch-a',text:'private'}]}}];
const evidenceLive = [{line_message_id:'wanted',source_id:'branch-a',text:'duplicate'},{line_message_id:'wrong',source_id:'branch-a',text:'other'}];
const evidence = context.evidenceMessages(evidenceEntry,evidenceItem,evidenceHistory,evidenceLive);
assert.equal(evidence.length,1,'disclosure shows only current-item referenced messages, no unrelated chat');
assert.equal(evidence[0].text,'ซื้อผัก');
assert.equal(evidence[0].snapshot,true);
assert.equal(context.evidenceMessages(evidenceEntry,{id:2,source_id:'branch-b'},evidenceHistory,evidenceLive).length,0,'cross-group messages stay hidden');

const validationRecord = { fields:{}, reason:'' };
assert.equal(context.validate(validationRecord,'reviewed').field,'transaction_type');
validationRecord.fields.transaction_type={value:'purchase'};
assert.equal(context.validate(validationRecord,'reviewed').field,'purpose');
validationRecord.fields.purpose={value:'ผัก'};
assert.equal(context.validate(validationRecord,'reviewed').field,'supplier_name');
validationRecord.fields.supplier_name={value:'ร้านผัก'};
assert.equal(context.validate(validationRecord,'reviewed').field,'reason');
validationRecord.reason='ตรวจรูป';
validationRecord.fields.recipient_name={value:'ผู้รับอีกคน'};
assert.equal(context.validate(validationRecord,'reviewed').field,'supplier_payee_relation');
validationRecord.fields.supplier_payee_relation={value:'unknown'};
assert.equal(context.validate(validationRecord,'reviewed'),null);
validationRecord.fields.transaction_type={value:'unknown'};
assert.equal(context.validate(validationRecord,'reviewed').field,'notes');
validationRecord.fields.notes={value:'ยังรอคำอธิบายจากผู้ส่ง'};
assert.equal(context.validate(validationRecord,'reviewed'),null);
for (const value of ['1234567890','xx123456','xx1234bank']) {
  validationRecord.fields.recipient_account_masked={value}; assert.equal(context.validate(validationRecord,'draft').field,'recipient_account_masked');
}
for (const value of ['xxx-x-1234','●●1234','＊＊1234']) {
  validationRecord.fields.recipient_account_masked={value}; assert.equal(context.validate(validationRecord,'draft'),null);
}
const revisions = {old_fields:{purpose:{value:'ผัก',source:'bill',evidence:[{item_id:2}]}},new_fields:{purpose:{value:'ผักสด',source:'manual',evidence:[]}}};
const immutable = JSON.stringify(revisions);
const changes = context.historyChanges(revisions);
assert.equal(changes.length,1);
assert.equal(changes[0].before.value,'ผัก'); assert.equal(changes[0].after.source,'manual');
assert.equal(JSON.stringify(revisions),immutable,'history inspection never mutates snapshots');
const validationStore = new context.Drafts(() => {throw Error('must not send invalid reviewed data')});
const incomplete = validationStore.activate(3); incomplete.loaded=true;
await validationStore.save(3,'reviewed');
assert.equal(incomplete.errorField,'transaction_type'); assert.equal(incomplete.feedback,'');
incomplete.reason='ตรวจ'; await validationStore.save(3,'reviewed'); assert.equal(incomplete.errorField,'transaction_type');
incomplete.reason='';
const reasonStore=new context.Drafts(()=>{throw Error('x')});const needReason=reasonStore.activate(4);needReason.loaded=true;needReason.fields={transaction_type:{value:'internal_transfer'},notes:{value:'แลกเงินสด'}};
await reasonStore.save(4,'reviewed');assert.equal(needReason.errorField,'reason','reviewed still requires reason');
assert.equal(context.validate(needReason,'draft'),null,'draft needs no reason');
const sent=[];const draftStore=new context.Drafts(async(url,o)=>{sent.push(JSON.parse(o.body));return{data:profile(5,1)}});const d5=draftStore.activate(5);d5.loaded=true;await draftStore.save(5,'draft');
assert.equal(sent[0].reason,'บันทึกร่าง','empty draft reason defaults');d5.reason='เหตุผลของฉัน';await draftStore.save(5,'draft');assert.equal(sent[1].reason,'เหตุผลของฉัน','typed reason preserved');
const req=fields=>context.requirements({fields});const names=x=>[...x.required].sort().join();
assert.equal(names(req({})),'transaction_type');
assert.equal(names(req({transaction_type:{value:'purchase'}})),'purpose,supplier_name,transaction_type');
assert.equal(names(req({transaction_type:{value:'internal_transfer'}})),'notes,transaction_type');
assert.deepEqual([...req({transaction_type:{value:'internal_transfer'}}).collapsed].sort(),['supplier_name','supplier_payee_relation']);
assert.equal(req({transaction_type:{value:'purchase'}}).collapsed.size,0);
assert.equal(names(req({transaction_type:{value:'refund_adjustment'},supplier_name:{value:'ก'},purpose:{value:'ข'}})),'transaction_type','complete non-purchase needs no notes');
assert.equal(names(req({transaction_type:{value:'purchase'},supplier_name:{value:'ก'},recipient_name:{value:'ข'}})),'purpose,supplier_payee_relation,supplier_name,transaction_type'.split(',').sort().join());
assert.equal(draft.feedback,'บันทึกว่าตรวจข้อมูลแล้ว','success only follows successful request');


const firstSnapshot = {revision:1,evidence_snapshot:{messages:[{line_message_id:'wanted',source_id:'branch-a',text:'ข้อความ ณ ฉบับแรก'}]}};
const newerSnapshot = {revision:2,evidence_snapshot:{messages:[{line_message_id:'wanted',source_id:'branch-a',text:'ข้อความ ณ ฉบับใหม่'}]}};
const allSnapshots = [newerSnapshot,firstSnapshot];
const oldProof = context.historyEvidence(allSnapshots,firstSnapshot,'after');
const newProof = context.historyEvidence(allSnapshots,newerSnapshot,'after');
assert.equal(context.evidenceMessages(evidenceEntry,evidenceItem,oldProof)[0].text,'ข้อความ ณ ฉบับแรก','old revision evidence must not be substituted with latest chat text');
assert.equal(context.evidenceMessages(evidenceEntry,evidenceItem,newProof)[0].text,'ข้อความ ณ ฉบับใหม่');
assert.equal(context.evidenceMessages(evidenceEntry,evidenceItem,context.historyEvidence(allSnapshots,newerSnapshot,'before'))[0].text,'ข้อความ ณ ฉบับแรก');


assert.equal(context.documentAmount({category:'bill',bill_total_value:100,announced_amount:999,slip_amount_value:777}),100,'evidence amount must be actual bill value, never announced or matched slip value');
for (const category of ['bill_page','payment_voucher']) assert.equal(context.documentAmount({category,bill_total_value:45,announced_amount:999}),45,'bill-like document evidence shows its stored total');
assert.equal(context.documentAmount({category:'transfer',slip_amount_text:'120.50',bill_total_value:999}),120.5);
assert.equal(context.documentAmount({category:'bill',bill_total_value:0,announced_amount:999}),0,'zero document amount is known');
for (const document of [{category:'bill'},{category:'bill',bill_total_text:''},{category:'bill',bill_total_text:'อ่านไม่ชัด'},{category:'other',announced_amount:999}]) assert.equal(context.documentAmount(document),null,'unavailable/non-numeric document amount stays unknown');


const generatedBatch = {id:2534,category:'bill',generated_document_type:'batch_payment_line',generated_from_item_id:2523,bill_total_value:100,generated_document_json:JSON.stringify({line_no:2,source_item_id:888,supplier_name:'ร้านสมมติ',payee_name:'ชื่อบัญชีสมมติ',account_no:'1234567890',amount:999,note:'<img src=x onerror=alert(1)>'})};
const generatedImmutable = JSON.stringify(generatedBatch);
const generatedView = context.generatedDocument(generatedBatch);
assert.equal(generatedView.sourceItemId,2523,'canonical parent reference takes precedence over JSON hint');
assert.equal(generatedView.facts.find(([label])=>label==='ชื่อร้านตามใบสรุป')[1],'ร้านสมมติ');
assert.equal(generatedView.facts.find(([label])=>label==='ชื่อบัญชีตามใบสรุป')[1],'ชื่อบัญชีสมมติ','account holder remains a distinct document role, never a verified payee');
assert.equal(generatedView.facts.find(([label])=>label.includes('(ปิดบัง)'))[1],'••••7890');
assert.equal(generatedView.facts.find(([label])=>label==='หมายเหตุตามใบสรุป')[1],'<img src=x onerror=alert(1)>','document text is preserved as inert text, not HTML');
assert.equal(context.documentAmount(generatedBatch),100,'generated JSON amount never replaces stored document amount');
assert.equal(context.documentAmount({category:'other',generated_document_type:'receipt_substitute',bill_total_value:15000,generated_document_json:JSON.stringify({amount:999999}),announced_amount:88888}),15000,'generated receipt keeps capture amount even when classified other');
assert.equal(context.documentAmount({category:'other',bill_total_value:15000}),null,'regular other item stays unknown');
assert.equal(JSON.stringify(generatedBatch),generatedImmutable,'render model leaves original metadata immutable');
for (const id of [3321,3358]) {
  const view = context.generatedDocument({id,generated_document_type:'receipt_substitute',generated_from_item_id:4000,generated_document_json:JSON.stringify({payee_name:'ผู้รับตามใบแทน',payee_account:'XXX12345678',description:'ซื้อของสมมติ'})});
  assert.equal(view.title,'ใบแทนใบเสร็จรับเงิน'); assert.equal(view.facts.find(([label])=>label.includes('(ปิดบัง)'))[1],'••••5678');
}
assert.equal(context.generatedDocument({generated_document_type:'receipt_substitute',generated_document_json:'not-json'}).valid,false);
assert.equal(context.generatedDocument({generated_document_type:'receipt_substitute',generated_document_json:'[]'}).valid,false);
assert.equal(context.generatedDocument({generated_document_type:'receipt_substitute',generated_from_item_id:-1,generated_document_json:'{}'}).sourceItemId,null);
assert.equal(context.generatedDocument({generated_document_type:'other',generated_document_json:'{}'}),null);
assert.ok(!source.includes('innerHTML'),'generated document content must use text nodes');


const confirmedPair = {id:77,bills:[{id:3600,category:'bill'}],slips:[{id:3624,category:'transfer'}]};
const docLookup = id => [...confirmedPair.bills,...confirmedPair.slips].find(row=>row.id===Number(id));
const doneState = {bucket:'done',selected:3600,matches:[]};
const doneBefore = JSON.stringify(doneState);
const doneDocuments = context.reviewDocuments(doneState,docLookup,()=>confirmedPair,m=>m.bills,m=>m.slips);
assert.equal(doneDocuments.length,2); assert.equal(doneDocuments[1].id,3624,'done review must expose original matched recipient slip');
assert.equal(JSON.stringify(doneState),doneBefore,'collecting expense documents never changes financial selection');
const bulk = {id:88,bills:[{id:2557,category:'bill'}],slips:Array.from({length:24},(_,index)=>({id:2600+index,category:'transfer'}))};
const bulkDocuments = context.reviewDocuments({bucket:'review',selected:88,matches:[bulk]},()=>null,()=>null,m=>m.bills,m=>[...m.slips,m.slips[0]]);
assert.equal(bulkDocuments.length,25,'bulk expense selector must reach every bill and slip exactly once');
assert.equal(bulkDocuments.at(-1).id,2623);
assert.equal(context.reviewDocuments({bucket:'review',selected:999,matches:[]},()=>({id:999}),()=>null,m=>m.bills,m=>m.slips).length,0,'missing match must not treat match ID as document ID');
const originalParent = {id:2315,category:'transfer',source_id:'source-slip',date:'2026-05-01'};
const billTarget = {id:3321,source_id:'source-bill',date:'2026-05-02'};
const sourceRoute = new URL(context.sourceHref(originalParent,{bucket:'review',itemId:900,billId:3321,transactionDate:'2026-05-03',transactionSource:'source-transaction'},billTarget,row=>row.date,'/admin'),'http://localhost');
assert.equal(sourceRoute.searchParams.get('bucket'),'review'); assert.equal(sourceRoute.searchParams.get('item'),'900');
assert.equal(sourceRoute.searchParams.get('date'),'2026-05-03'); assert.equal(sourceRoute.searchParams.get('group'),'source-transaction');
const doneSourceRoute = new URL(context.sourceHref(originalParent,{bucket:'done',itemId:3321,billId:3321},billTarget,row=>row.date,'/admin'),'http://localhost');
assert.equal(doneSourceRoute.searchParams.get('bucket'),'done'); assert.equal(doneSourceRoute.searchParams.get('item'),'3321'); assert.equal(doneSourceRoute.searchParams.get('date'),'2026-05-02'); assert.equal(doneSourceRoute.searchParams.get('group'),'source-bill');
assert.equal(context.sourceHref(null,null,null,row=>row.date,'/admin'),null,'unknown parent metadata must not fabricate copied links');


const captureScope = {view:'day',start:'2026-09-06',source:'group2',dayLoading:false,dayLoadError:null};
const captureCalls=[];
const originalBill = {id:2931,date:'2026-09-10',source_id:'group1'};
assert.equal(await context.openOriginalChat(originalBill,captureScope,row=>row.date,async(date,source)=>{captureCalls.push([date,source]);captureScope.start=date;captureScope.source=source;return true}),true);
assert.equal(captureCalls[0][0],'2026-09-10'); assert.equal(captureCalls[0][1],'group1','cross-group matched bill chat must open captured source, not transaction source');
assert.equal(await context.openOriginalChat(originalBill,captureScope,row=>row.date,()=>{throw Error('same capture scope should not reload')}),true);
const supersededScope = {view:'day',start:'2026-09-06',source:'group2'};
assert.equal(await context.openOriginalChat(originalBill,supersededScope,row=>row.date,async()=>{supersededScope.start='2026-09-12';supersededScope.source='another-group';return true}),false,'superseded capture navigation must not focus wrong chat');
assert.equal(await context.openOriginalChat(originalBill,{view:'day',start:'2026-09-06',source:'group2'},row=>row.date,async()=>false),false,'failed day load must not claim chat navigation success');
assert.equal(store.record(2).fields.purpose.value,'แก้ระหว่างรอ','read-only source navigation helpers preserve cached drafts');


const parentCache = new Map([[2315,{id:2315,category:'transfer'}]]), parentRequests = new Map();
let visibleParent = {id:2315,category:'other'};
const currentLookup = () => visibleParent;
assert.equal(context.resolveSourceParent(2315,currentLookup,parentCache).category,'other','current recategorized source must outrank old cached copied-link metadata');
let sourceReads = 0;
assert.equal((await context.prepareSourceParent(2315,currentLookup,parentCache,parentRequests,()=>{sourceReads++;throw Error('visible source must not trigger another read')})).category,'other');
assert.equal(sourceReads,0);
visibleParent = null; parentCache.set(2315,{id:2315,category:'transfer'});
let resolveParent;
const parentRefresh = context.prepareSourceParent(2315,currentLookup,parentCache,parentRequests,()=>{sourceReads++;return new Promise(resolve=>{resolveParent=resolve})});
assert.equal(context.resolveSourceParent(2315,currentLookup,parentCache),null,'outside-scope stale copied link must disappear while fresh context is loading');
assert.equal(sourceReads,1);
resolveParent({data:{item:{id:2315,category:'other'}}}); await parentRefresh;
assert.equal(context.resolveSourceParent(2315,currentLookup,parentCache).category,'other');
const refreshedSource = context.resolveSourceParent(2315,currentLookup,parentCache);
const refreshedHref = new URL(context.sourceHref({...refreshedSource,source_id:'group1',date:'2026-09-01'},{bucket:refreshedSource.category,itemId:2315},null,row=>row.date,'/admin'),'http://localhost');
assert.equal(refreshedHref.searchParams.get('bucket'),'other','copied source link uses refreshed classification');
let resolveReopened;
const readAgain = () => { sourceReads++; return new Promise(resolve=>{resolveReopened=resolve}); };
const reopenedRefresh = context.prepareSourceParent(2315,currentLookup,parentCache,parentRequests,readAgain);
const simultaneousRefresh = context.prepareSourceParent(2315,currentLookup,parentCache,parentRequests,readAgain);
assert.equal(sourceReads,2,'reopening an absent parent refetches once, with simultaneous opens deduplicated');
assert.equal(context.resolveSourceParent(2315,currentLookup,parentCache),null,'reopening clears previous outside-scope cached metadata');
resolveReopened({data:{item:{id:2315,category:'transfer'}}});
await Promise.all([reopenedRefresh,simultaneousRefresh]);
assert.equal(context.resolveSourceParent(2315,currentLookup,parentCache).category,'transfer','reopened child receives new source classification');
const openFunction = source.slice(source.indexOf('  async function open(observedRow, button)'),source.indexOf('  function sync()'));
assert.ok(openFunction.includes('prepareSourceParent(generated.sourceItemId)'),'generated parent metadata must be prepared on actual open, not only retry');

const snapshotArgument = process.argv.indexOf('--generated-snapshot');
if (snapshotArgument !== -1) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(process.argv[snapshotArgument + 1], { readOnly: true });
  try {
    database.exec('PRAGMA query_only=ON');
    const rows = database.prepare('SELECT id, category, generated_document_type, generated_document_json, generated_from_item_id, bill_total_value, bill_total_text FROM capture_items WHERE id IN (2534,3321,3358) ORDER BY id').all();
    assert.equal(rows.length,3,'all three observed generated cases must exist in readonly real-data snapshot');
    rows.forEach(row => {
      const view = context.generatedDocument(row); assert.ok(view?.valid,'actual generated document JSON must be renderable'); assert.ok(view.sourceItemId,'actual generated document must retain parent reference');
      view.facts.filter(([label])=>label.includes('(ปิดบัง)')).forEach(([,account]) => { if (account) assert.ok((account.match(/\d/g)||[]).length<=4,'actual document account stays masked'); });
      assert.equal(context.documentAmount(row),row.bill_total_value==null ? Number(row.bill_total_text) : Number(row.bill_total_value),'actual document amount must preserve stored amount');
    });
    assert.equal(context.generatedDocument(rows.find(row=>row.id===2534)).sourceItemId,2523);
    assert.equal(context.documentAmount(rows.find(row=>row.id===3321)),300000);
    assert.equal(context.documentAmount(rows.find(row=>row.id===3358)),15000);
    const actualDoc = database.prepare('SELECT id, category, bill_total_value, bill_total_text, slip_amount_value, slip_amount_text FROM capture_items WHERE id=?');
    const confirmedMembers = database.prepare("SELECT slip_item_id FROM capture_matches WHERE bill_item_id=? AND status='confirmed' ORDER BY id");
    for (const [billId, expectedSlips] of [[3600,1],[2557,24]]) {
      const actualBill = actualDoc.get(billId); assert.ok(actualBill);
      const actualSlips = [...new Set(confirmedMembers.all(billId).map(edge=>edge.slip_item_id))].map(id=>actualDoc.get(id));
      assert.equal(actualSlips.length,expectedSlips,'actual confirmed group must preserve all matched slip members');
      const actualMatch = {bills:[actualBill],slips:actualSlips};
      const documents = context.reviewDocuments({bucket:'done',selected:billId,matches:[]},id=>actualDoc.get(id),()=>actualMatch,m=>m.bills,m=>m.slips);
      assert.equal(documents.length,expectedSlips+1,'actual done workspace must make every matched document selectable');
      if (billId===3600) assert.equal(documents[1].id,3624);
    }
    console.log('readonly actual done pair and 25-document bulk selector cases passed; no financial records changed');
    console.log('readonly real-data generated document cases passed: 2534, 3321, 3358; no personal data printed');
  } finally { database.close(); }
}
console.log('expense-profile UI draft/stale/conflict/provenance tests passed');

const pendingClassification = {fields:{expense_category:{value:'pending'}},reason:'ตรวจแล้ว'};
assert.equal(context.validate(pendingClassification,'draft'),null);
assert.equal(context.validate(pendingClassification,'reviewed').field,'expense_category');
assert.equal(context.validate({fields:{expense_period:{value:'2026-13'}}},'draft').field,'expense_period');
assert.equal(context.validate({fields:{expense_period:{value:'2026-08'}}},'draft'),null);
console.log('preparation draft/period/pending-review validation passed');

for (const type of ['internal_transfer','loan','government_remittance']) {
 const record={fields:{transaction_type:{value:type},expense_category:{value:'ingredients'}},reason:'ตรวจ'};
 assert.equal(context.validate(record,'draft'),null);
 assert.equal(context.validate(record,'reviewed').field,'transaction_type');
}
console.log('stale category on nonexpense transaction is blocked in UI; draft retained');

for (const type of ['internal_transfer','loan','government_remittance']) {
 const record={fields:{transaction_type:{value:type},supplier_name:{value:'ร้านเดิม'},recipient_name:{value:'ผู้รับใหม่'},purpose:{value:'รายการสมมติ'},branch:{value:'คันคลอง'},notes:{value:'ทดสอบ'}},reason:'ตรวจ'};
 assert.equal(context.validate(record,'reviewed'),null,'hidden legacy supplier must not require relationship');
 assert.equal(context.requirements(record).required.has('supplier_payee_relation'),false);
}
assert.equal(context.validate({fields:{transaction_type:{value:'purchase'},expense_category:{value:'non_expense'}},reason:'ตรวจ'},'reviewed').field,'expense_category');
console.log('legacy category and hidden supplier relationship guards passed');

// ตรวจ readiness ทั้งฝั่งร่างและ API รวมสถานะ เพื่อไม่แสดงตรวจหลักฐานเป็นพร้อมเข้ารอบ
const { expensePreparationReadiness } = await import('../src/expense-profile.js');
vm.runInContext('this.preparation = expenseProfilePreparation;', context);
const readyFields = Object.fromEntries(Object.entries({transaction_type:'purchase',purpose:'วัตถุดิบ',branch:'คันคลอง',expense_category:'ingredients',expense_period:'2026-08'}).map(([key,value])=>[key,{value}]));
const readinessCases = [readyFields, {}, ...['purchase','advance_payment','reimbursement','refund_adjustment','unknown','internal_transfer','loan','government_remittance','invalid'].map(type=>({...readyFields,transaction_type:{value:type}})), ...['pending','mixed','asset_review','non_expense','invalid',''].map(category=>({...readyFields,expense_category:{value:category}})), ...['2026-13','1999-12',''].map(period=>({...readyFields,expense_period:{value:period}})), ...['purpose','branch','expense_category','expense_period'].map(key=>({...readyFields,[key]:{value:''}}))];
for (const fields of readinessCases) for (const status of ['draft','reviewed']) assert.deepEqual(JSON.parse(JSON.stringify(context.preparation(fields,status))),expensePreparationReadiness(fields,status),'UI and backend readiness must agree');
assert.equal(context.preparation(readyFields,'draft').status,'not_ready');
assert.equal(context.preparation(readyFields,'draft').fields_complete,true);
assert.equal(context.preparation(readyFields,'reviewed').status,'ready');
assert.equal(context.validate({fields:{...readyFields,expense_category:{value:'mixed'}},reason:'เทียบหลักฐาน'},'reviewed').field,'expense_category');
for (const type of ['internal_transfer','loan','government_remittance']) {
 const record={fields:{...readyFields,transaction_type:{value:type},expense_category:{value:null},supplier_name:{value:'ร้านเก่า'},recipient_name:{value:'ผู้รับ'},notes:{value:null}},reason:'ตรวจ'};
 assert.equal(context.validate(record,'reviewed').field,'notes','stale supplier and purpose cannot bypass excluded-type notes');
 assert.equal(context.requirements(record).required.has('notes'),true);
}
console.log('UI/API readiness parity, reviewed/mixed distinction and excluded notes guards passed');

let lockRequests=0;
const lockedStore=new context.Drafts(async()=>{lockRequests++;throw new Error('unexpected request');});
const lockedRecord=lockedStore.record(90);Object.assign(lockedRecord,{loaded:true,fields:{purpose:{value:'ร่างเดิม',source:'manual',evidence:[]}},dirty:true,edit_lock:{code:'round_closed',rounds:[]}});
lockedStore.set(90,'purpose','ค่าใหม่');await lockedStore.save(90,'draft');
assert.equal(lockedRecord.fields.purpose.value,'ร่างเดิม');assert.equal(lockedRecord.dirty,true);assert.equal(lockRequests,0,'known round lock prevents mutation');
const racedStore=new context.Drafts(async()=>{const error=new Error('round closed');error.details={code:'round_closed',rounds:[{business_date:'2026-08-01',source_id:'fictional'}]};throw error;});
const racedRecord=racedStore.record(91);Object.assign(racedRecord,{loaded:true,fields:{purpose:{value:'ร่างก่อนปิดรอบ',source:'manual',evidence:[]}},dirty:true});
await racedStore.save(91,'draft');assert.equal(racedRecord.edit_lock.code,'round_closed');assert.equal(racedRecord.fields.purpose.value,'ร่างก่อนปิดรอบ');assert.equal(racedRecord.dirty,true);assert.equal(racedRecord.revision,0);assert.equal(racedRecord.feedback,'');assert.match(racedRecord.error,/ปิดแล้ว/);
console.log('known and concurrent round locks preserve unsaved drafts and prevent false saves');

const notice = vm.runInContext('expenseProfilePeriodNotice',context);
assert.match(notice('2026-08','2026-10-06'),/เดือนที่เลือกต่าง/);
assert.equal(notice('2026-10','2026-10-06'),'');
assert.equal(notice('2026-08',''),'');
assert.equal(notice('2569-08','2026-10-06'),'');
console.log('month mismatch notice does not invent a reference date or block valid periods');
