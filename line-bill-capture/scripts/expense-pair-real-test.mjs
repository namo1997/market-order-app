import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { storage } from './ssd-storage.mjs';
assert.equal(process.env.SOLAO_LOCAL_SIMULATION,'1'); storage.assertSSD();
const manifestPath=storage.assertSSDPath(path.resolve(process.argv[2] || ''));
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const original=storage.assertSSDPath(manifest.file);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await fs.readFile(original)),manifest.sha256);
const dir=await fs.mkdtemp(path.join(storage.assertSSDPath(os.tmpdir()),'real-pair-'));
const copy=path.join(dir,'working.sqlite');await fs.copyFile(original,copy);await fs.chmod(copy,0o600);
process.env.CAPTURE_DATA_DIR=dir;process.env.CAPTURE_DB_PATH=copy;
const api=await import('../src/db.js');await api.initDatabase();
const db=new DatabaseSync(copy);
const protectedTables=['capture_items','capture_matches','capture_cash_payments','capture_daily_closings','ai_learning_examples','ai_category_learning_examples','line_transfer_requests','line_messages'];
const facts=()=>Object.fromEntries(protectedTables.map(t=>[t,sha(JSON.stringify(db.prepare('SELECT * FROM '+t+' ORDER BY id').all()))]));
const before=facts(),results=[];
const date="CASE WHEN ci.event_timestamp_ms>0 THEN date(ci.event_timestamp_ms/1000+25200,'unixepoch') ELSE substr(ci.created_at,1,10) END";
const edges=db.prepare(`SELECT cm.id,cm.bill_item_id,cm.slip_item_id FROM capture_matches cm JOIN capture_items ci ON ci.id=cm.slip_item_id WHERE cm.status IN ('pending','manual_review','confirmed') AND (${date}) BETWEEN ? AND ? ORDER BY cm.id`).all(manifest.start,manifest.end);
for(const edge of edges){
 const record=await api.getExpenseProfile(edge.bill_item_id,{pairMatchId:edge.id});
 if(!record || record.pair_scope?.error){results.push({match_id:edge.id,skipped:record?.pair_scope?.error||'missing'});continue;}
 const slipBefore=db.prepare('SELECT * FROM capture_expense_profiles WHERE item_id=?').get(edge.slip_item_id);
 const ctx=record.pair_scope;
 const response=await api.updateExpenseProfile({id:edge.bill_item_id,actor:'isolated-real-pair-trial',input:{expected_revision:record.revision,status:'draft',reason:'ทดลองตรวจคู่บนสำเนา SSD',fields:record.fields,pair_context:{match_id:ctx.match_id,item_ids:ctx.item_ids,expected_revisions:ctx.expected_revisions}}});
 if(response.error){results.push({match_id:edge.id,blocked:response.error});continue;}
 assert.equal(response.pair_scope.membership_valid,true);assert.equal(response.pair_scope.shared_status,'draft');
 assert.deepEqual(db.prepare('SELECT * FROM capture_expense_profiles WHERE item_id=?').get(edge.slip_item_id),slipBefore);
 const reloaded=await api.getExpenseProfile(edge.bill_item_id,{pairMatchId:edge.id});assert.equal(reloaded.pair_scope.shared_status,'draft');
 results.push({match_id:edge.id,bill_id:edge.bill_item_id,slip_id:edge.slip_item_id,passed:true});
}
assert.deepEqual(facts(),before);assert.equal(sha(await fs.readFile(original)),manifest.sha256);
db.close();
const report={isolated:true,range:{start:manifest.start,end:manifest.end},original_unchanged:true,financial_and_matching_unchanged:true,shared_drafts:results.filter(r=>r.passed).length,results};
await fs.writeFile(path.join(storage.assertSSDPath(process.env.SOLAO_TEST_OUTPUT_DIR),'real-pair-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
