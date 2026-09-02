import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(source, /async function renderCurrentDayChat\(chat,token\)/);
assert.match(source, /if\(!allTargets\.length\)return renderCurrentDayChat\(chat,token\)/);
assert.match(source, /fetchAllRows\('\/api\/admin\/messages',\{source_id:sourceId,date\},500\)/);
assert.match(source, /id="review-flag-document"/);
assert.match(source, /id="review-flag-announced"/);
assert.match(source, /id="review-flag-manual"/);
assert.match(source, /async function resolveReviewFlag\(item,body,matchId\)/);
assert.match(source, /review-flag-document'\)\.onclick=\(\)=>resolveReviewFlag\(flagItem,\{bill_total_text:String\(flagInfo\.printed\)\}/);
assert.match(source, /เคลียร์ธงแล้ว · ตรวจภาพอีกครั้งก่อนกดยืนยันคู่/);
assert.match(source, /data-group-sort="ai"/);
assert.match(source, /data-group-sort="date_asc"/);
assert.match(source, /data-group-sort="date_desc"/);
assert.match(source, /AI อ่านแล้ว \$\{aiRead\}\/\$\{groupDocuments\.length\} รูป/);
assert.match(source, /matchBills=m=>matchBillIds\(m\).*\.sort\(documentTimeOrder\)/);
assert.doesNotMatch(source, /sorted\.slice\(0,120\)/);
assert.match(source, /id="slip-preview-bg"/);
assert.match(source, /function previewSlipCandidate\(m,b,s,n\)/);
assert.match(source, /alt="สลิป #\$\{s\.id\}" src="\/api\/admin\/items\/\$\{s\.id\}\/image"/);
assert.match(source, /button\.onclick=\(\)=>s&&previewSlipCandidate\(m,b,s,Number\(button\.dataset\.score\)\)/);
assert.match(source, /เลือกสลิปนี้และส่งไปรอตรวจ/);
assert.match(source, /function syncChatPanelToReviewActions\(\)/);
assert.match(source, /actionBar=\$\('reviewpanel'\)\?\.querySelector\('\.bar'\)/);
assert.match(source, /--chat-panel-height/);
assert.match(source, /requestAnimationFrame\(syncChatPanelToReviewActions\)/);
assert.match(source, /function alignSelectedChatMessage\(expectedKey\)/);
assert.match(source, /markerRect\.top-chatRect\.top/);
assert.match(source, /image\.addEventListener\('load'.*alignSelectedChatMessage/);
assert.match(source, /\['needs_amount','bill','slip','batch'\]\.includes\(S\.bucket\)/);
assert.match(source, /แก้ยอดบิลและจับคู่ใหม่/);

const doneReviewSource = source.slice(
  source.indexOf('function doneReview('),
  source.indexOf('async function teachDoneMatch'),
);
assert.ok(doneReviewSource.includes('done-doc-columns'));
assert.ok(doneReviewSource.includes('${aiPanel}'));
assert.ok(
  doneReviewSource.indexOf('done-doc-columns') < doneReviewSource.lastIndexOf('${aiPanel}'),
  'completed-match AI reasoning must appear below the bill and slip documents',
);

console.log('day chat UI fallback checks passed');
