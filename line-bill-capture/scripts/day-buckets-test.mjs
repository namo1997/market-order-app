// ทดสอบว่า "ป้ายบอกงานค้าง" กับ "ปุ่มปิดรอบ" ตรงกันเสมอ
//
// บั๊กที่เคยเจอ: หน้าวันขึ้นว่า "เคลียร์ครบ" แต่กดปิดรอบแล้วเด้ง "มีงานค้าง 1 รายการ"
// เพราะสองที่นี้เคยเขียนเงื่อนไขแยกกัน จึงเพี้ยนกันได้ทุกครั้งที่เพิ่มสถานะใหม่
//
// เทสต์นี้ดึงตรรกะจริงออกมาจาก public/index.html แล้วไล่ทุกชุดสถานะที่เป็นไปได้
// เพื่อกันไม่ให้ช่องโหว่แบบเดิมกลับมาอีกเมื่อมีคนเพิ่ม category หรือ match_status ใหม่

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');

const grab = (pattern, label) => {
  const match = html.match(pattern);
  assert.ok(match, `หา ${label} ใน public/index.html ไม่เจอ — ตรรกะถูกย้ายหรือเปลี่ยนชื่อแล้ว`);
  return match[0];
};

// ดึงนิยามจริงจากหน้าเว็บ ไม่ได้คัดลอกมาเขียนใหม่ ถ้าโค้ดจริงเปลี่ยน เทสต์นี้จะเห็นด้วย
const source = [
  grab(/const isOrphanPage=[^\n]*?;/, 'isOrphanPage'),
  grab(/const isSlip=x=>[^\n]*?;/, 'isSlip'),
  grab(/const liveItem=[^\n]*?;/, 'liveItem'),
  grab(/const outstandingItem=[^\n]*?;/, 'outstandingItem'),
  grab(/const inPendingMatch=[^\n]*?;/, 'inPendingMatch'),
  grab(/const inReviewBucket=[^\n]*?;/, 'inReviewBucket'),
  grab(/const CLAIMED_BUCKETS=[^\n]*?;/, 'CLAIMED_BUCKETS'),
  grab(/const BUCKET_FILTER=\{[\s\S]*?\};/, 'BUCKET_FILTER')
].join('\n');

const build = new Function('S', 'docHasPayable', 'matchItemIds', `
  ${source}
  return { BUCKET_FILTER, outstandingItem, inReviewBucket, CLAIMED_BUCKETS };
`);

const S = { matches: [] };
const { BUCKET_FILTER, outstandingItem, inReviewBucket } = build(
  S,
  (ref) => ref !== 'orphan',
  (match) => match.itemIds || []
);

const FIELDS = {
  status: ['sent', 'unsent', 'duplicate'],
  category: ['bill', 'transfer', 'transfer_notice', 'bill_page', 'other'],
  match_status: ['pending', 'manual_review', 'unmatched', 'rejected', 'needs_amount', 'confirmed'],
  ai_status: ['done', 'pending', 'processing', 'failed', 'paused'],
  generated_document_type: [null, 'batch_payment_line'],
  payment_role: [null, 'reimbursement'],
  reimbursement_status: [null, 'pending', 'confirmed', 'rejected'],
  reimbursement_related_item_id: [0, 1],
  inPendingMatchFlag: [false, true]
};

const keys = Object.keys(FIELDS);
const combos = [];
(function walk(index, acc) {
  if (index === keys.length) return combos.push({ id: combos.length + 1, doc_ref: 'ok', ...acc });
  for (const value of FIELDS[keys[index]]) walk(index + 1, { ...acc, [keys[index]]: value });
})(0, {});

const WORK_BUCKETS = ['ai_pending', 'needs_amount', 'orphan_page', 'batch', 'slip', 'bill', 'leftover'];

const bucketsFor = (item) => {
  S.matches = item.inPendingMatchFlag ? [{ itemIds: [Number(item.id)] }] : [];
  const hit = WORK_BUCKETS.filter((key) => BUCKET_FILTER[key](item));
  if (inReviewBucket(item)) hit.unshift('review');
  return hit;
};

let ghosts = 0;
let doubles = 0;
for (const item of combos) {
  const hit = bucketsFor(item);
  const outstanding = outstandingItem(item);

  // 1) ทุกอย่างที่นับว่าค้าง ต้องมีถังให้คนกดเข้าไปจัดการได้
  if (outstanding && hit.length === 0) {
    if (ghosts === 0) console.error('งานผี:', JSON.stringify(item));
    ghosts += 1;
  }
  // 2) ถังซ้อนกันได้ตามการออกแบบ (เช่น อยู่ในคู่รอตรวจ และ AI ยังอ่านไม่เสร็จ)
  //    จึงไม่ถือเป็นข้อผิดพลาด แต่ dayWorkCount ต้องนับเป็นรายการไม่ซ้ำ ไม่ใช่บวกความยาวทุกถัง
  if (hit.length > 1) doubles += 1;
}

assert.equal(ghosts, 0, `พบสถานะที่นับว่าค้างแต่ไม่มีถังรองรับ ${ghosts} แบบ`);
assert.ok(
  /const dayWorkCount=\(\)=>\{const seen=new Set\(\)/.test(html),
  'dayWorkCount ต้องนับรายการไม่ซ้ำ ไม่ใช่บวกความยาวของทุกถัง (ถังซ้อนกันได้)'
);

// 3) ป้ายนับกับปุ่มปิดรอบต้องเรียกฟังก์ชันเดียวกัน ไม่ใช่ต่างคนต่างคำนวณ
assert.ok(
  /const dayLeftoverLive=\(\)=>dayWorkCount\(\);/.test(html),
  'ปุ่มปิดรอบต้องใช้ dayWorkCount() ตัวเดียวกับป้ายนับ'
);
assert.equal(
  (html.match(/const work=dayWorkCount\(\);/g) || []).length, 2,
  'ป้ายนับทั้งสองจุดต้องใช้ dayWorkCount()'
);

console.log(`✅ ตรวจ ${combos.length} ชุดสถานะ · ไม่มีงานผี · ${doubles} ชุดอยู่ได้หลายถัง (นับแบบไม่ซ้ำแล้ว) · ป้ายนับกับปุ่มปิดรอบใช้ตัวเลขเดียวกัน`);

// ถัง "ตกหล่น" ต้องบอกสาเหตุและมีปุ่มให้กด ไม่ใช่แค่โชว์รายการแล้วปล่อยให้เดา
const leftoverSrc = html.match(/const leftoverReason=x=>\{[\s\S]*?\n\};/);
assert.ok(leftoverSrc, 'ต้องมี leftoverReason() อธิบายสาเหตุรายตัว');
const leftoverReason = new Function('isSlip', `${leftoverSrc[0]}\nreturn leftoverReason;`)(
  (x) => ['transfer', 'transfer_notice'].includes(x?.category)
);

const CASES = [
  { label: 'สถานะค้าง pending', item: { category: 'bill', match_status: 'pending' }, expect: /pending/ },
  { label: 'สลิปผูกคืนเงิน', item: { category: 'transfer', match_status: 'unmatched', reimbursement_related_item_id: 892 }, expect: /คืนเงิน/ },
  { label: 'สลิป needs_amount', item: { category: 'transfer', match_status: 'needs_amount' }, expect: /ต้องแก้ยอด/ },
  { label: 'กรณีอื่น', item: { category: 'bill', match_status: 'rejected' }, expect: /ไม่ตรงเงื่อนไข/ }
];
for (const test of CASES) {
  const reason = leftoverReason(test.item);
  assert.match(reason.why, test.expect, `สาเหตุของ "${test.label}" ต้องอธิบายให้ตรงกรณี`);
  assert.ok(reason.how && reason.how.length > 10, `"${test.label}" ต้องบอกว่าทำอะไรต่อ`);
}

assert.ok(/repair-match-state/.test(html), 'ต้องมีปุ่มเรียก API ซ่อมสถานะ');
console.log(`✅ ถังตกหล่นอธิบายสาเหตุครบ ${CASES.length} กรณี และมีปุ่มซ่อมสถานะ`);
