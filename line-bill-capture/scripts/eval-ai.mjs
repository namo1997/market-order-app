// วัดว่า AI ทำถูกกี่ % เทียบกับคำตัดสินของมนุษย์ใน golden set
//
//   node scripts/build-eval-set.mjs     # สร้างชุดข้อสอบก่อน
//   node scripts/eval-ai.mjs            # วัดผล (ฟรี ไม่เรียก OpenAI)
//   node scripts/eval-ai.mjs --verbose  # โชว์รายการที่ทำผิดทีละรายการ
//   node scripts/eval-ai.mjs --min 90   # ออก exit 1 ถ้าคะแนนรวมต่ำกว่า 90 (ใช้ใน CI)
//
// วัด 3 อย่าง ทั้งหมดคำนวณจากข้อมูลที่บันทึกไว้แล้ว ไม่ยิง API ไม่เสียเงิน:
//   1. จับคู่   — ให้ scoreSequencePair เลือกสลิปจากพูลจริง แล้วดูว่าเลือกใบที่คนยืนยันไหม
//   2. หมวดหมู่ — ผลดิบของ AI (ai_result_json.category) ตรงกับที่คนแก้ไหม
//   3. ยอดเงิน  — ยอดที่ AI อ่าน ตรงกับยอดที่คนยืนยันไหม

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSequencePair } from '../src/ai-worker.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const has = (flag) => process.argv.includes(flag);
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const goldenPath = arg('--golden', path.join(rootDir, '.local-preview', 'eval', 'golden.json'));
const verbose = has('--verbose');
const minScore = Number(arg('--min', '0'));

if (!fs.existsSync(goldenPath)) {
  console.error(`ไม่พบชุดข้อสอบ: ${goldenPath}\nรัน node scripts/build-eval-set.mjs ก่อน`);
  process.exit(1);
}

const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const byId = new Map(golden.items.map((item) => [Number(item.id), item]));

// ใช้ค่าเดียวกับที่ ai-worker ใช้จริง เพื่อให้ผลวัดสะท้อนพฤติกรรม production
const config = {
  amountTolerance: Number(process.env.AI_MATCH_AMOUNT_TOLERANCE || 5),
  percentTolerance: Number(process.env.AI_MATCH_PERCENT_TOLERANCE || 0.02),
  maxMatchHours: Number(process.env.AI_MATCH_MAX_HOURS || 48),
  requireSameSource: String(process.env.AI_MATCH_REQUIRE_SAME_SOURCE || 'true') !== 'false',
  sourceFallbacks: {},
  autoMatchMinScore: Number(process.env.AI_AUTO_MATCH_MIN_SCORE || 90),
  sequenceMatchMinScore: Number(process.env.AI_SEQUENCE_MATCH_MIN_SCORE || 50)
};

const pct = (hit, total) => (total ? Math.round((hit / total) * 1000) / 10 : null);
const line = (label, hit, total, extra = '') => {
  const value = pct(hit, total);
  const bar = value === null ? '' : '█'.repeat(Math.round(value / 5)).padEnd(20, '░');
  console.log(
    `  ${label.padEnd(22)} ${String(value ?? '-').padStart(5)}%  ${bar}  ${hit}/${total}${extra ? '  ' + extra : ''}`
  );
};

const failures = { pairing: [], category: [], amount: [] };

// ── 1. การจับคู่ ────────────────────────────────────────────────────────
const slipPool = golden.slip_pool_ids.map((id) => byId.get(Number(id))).filter(Boolean);
let pairTotal = 0;
let pairTop1 = 0;
let pairWouldAutoConfirm = 0;
let pairNoCandidate = 0;

for (const pair of golden.pairs_confirmed) {
  const bill = byId.get(Number(pair.bill_item_id));
  const trueSlip = byId.get(Number(pair.slip_item_id));
  if (!bill || !trueSlip) continue;
  pairTotal += 1;

  const scored = [];
  for (const slip of slipPool) {
    if (config.requireSameSource && slip.source_id !== bill.source_id) continue;
    const result = scoreSequencePair({ bill, slip, config });
    if (result && result.score >= config.sequenceMatchMinScore) scored.push({ slip, ...result });
  }
  scored.sort((a, b) => b.score - a.score || (a.diff ?? Infinity) - (b.diff ?? Infinity));

  const best = scored[0];
  if (!best) {
    pairNoCandidate += 1;
    failures.pairing.push({ bill: bill.id, expect: trueSlip.id, got: 'ไม่เสนอคู่ใดเลย', why: 'คะแนนไม่ถึงเกณฑ์' });
    continue;
  }
  if (Number(best.slip.id) === Number(trueSlip.id)) {
    pairTop1 += 1;
    if (best.score >= config.autoMatchMinScore) pairWouldAutoConfirm += 1;
  } else {
    failures.pairing.push({
      bill: bill.id,
      expect: trueSlip.id,
      got: best.slip.id,
      why: `เลือกใบคะแนน ${best.score} แทน (ยอดต่าง ${best.diff ?? '-'})`
    });
  }
}

// ── 2. หมวดหมู่ ─────────────────────────────────────────────────────────
let catTotal = 0;
let catHit = 0;
for (const fix of golden.category_fixes) {
  let aiCategory = null;
  try {
    aiCategory = JSON.parse(fix.ai_result_json || '{}')?.category ?? null;
  } catch { aiCategory = null; }
  if (!aiCategory) continue;
  catTotal += 1;
  if (aiCategory === fix.human_category) catHit += 1;
  else failures.category.push({ item: fix.id, expect: fix.human_category, got: aiCategory, why: fix.category_edit_reason || '' });
}

// ── 3. ยอดเงิน ──────────────────────────────────────────────────────────
// ระวังกับดัก: ชุด amount_fixes คือ "รูปที่คนเข้ามาแก้ยอด" ซึ่งคนจะแก้ก็ต่อเมื่อ
// AI อ่านผิดอยู่แล้ว ถ้าวัดความแม่นจากชุดนั้นจะได้ค่าต่ำเสมอโดยธรรมชาติ ไม่ใช่ความจริง
// จึงวัดจากบิลทุกใบในคู่ที่คนยืนยัน แล้วถามว่า "AI อ่านยอดได้เองโดยไม่ต้องมีคนแก้กี่ใบ"
let amtTotal = 0;
let amtHit = 0;
const seenBills = new Set();
for (const pair of golden.pairs_confirmed) {
  const bill = byId.get(Number(pair.bill_item_id));
  if (!bill || seenBills.has(bill.id)) continue;
  seenBills.add(bill.id);
  amtTotal += 1;
  const neededHuman = Boolean(bill.bill_total_edited_at || bill.flag_resolved_at);
  const readSomething = Number(bill.bill_total_value) > 0;
  if (!neededHuman && readSomething) amtHit += 1;
  else {
    failures.amount.push({
      item: bill.id,
      expect: Number(bill.bill_total_value) || '—',
      got: !readSomething ? 'อ่านไม่ออก' : 'คนต้องเข้ามาแก้'
    });
  }
}

// รายการที่คนเข้ามาแก้ยอด เก็บไว้เป็น "ภาระงาน" ไม่ใช่ตัวชี้วัดความแม่น
const humanAmountEdits = golden.amount_fixes.length;

// ── รายงาน ──────────────────────────────────────────────────────────────
console.log('');
console.log('ผลวัด AI เทียบกับคำตัดสินของมนุษย์');
console.log(`ชุดข้อสอบสร้างเมื่อ ${new Date(golden.generated_at).toLocaleString('th-TH')}`);
console.log('─'.repeat(72));
line('จับคู่ถูกใบ', pairTop1, pairTotal, pairNoCandidate ? `(ไม่เสนอคู่เลย ${pairNoCandidate})` : '');
line('หมวดหมู่ถูก', catHit, catTotal);
line('อ่านยอดได้เอง', amtHit, amtTotal, humanAmountEdits ? `(คนเข้าไปแก้ยอดรวม ${humanAmountEdits} ใบ)` : '');
console.log('─'.repeat(72));

const scores = [pct(pairTop1, pairTotal), pct(catHit, catTotal), pct(amtHit, amtTotal)].filter((v) => v !== null);
const overall = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
console.log(`  คะแนนรวม ${overall}%`);
if (pairTotal) {
  console.log(`  ในคู่ที่จับถูก ${pairWouldAutoConfirm}/${pairTop1} จะถูก auto-confirm (คะแนน ≥ ${config.autoMatchMinScore}) ที่เหลือรอคนตรวจ`);
}

const failCount = failures.pairing.length + failures.category.length + failures.amount.length;
if (failCount) {
  console.log('');
  console.log(`ทำผิด ${failCount} รายการ${verbose ? '' : ' — ใส่ --verbose เพื่อดูรายละเอียด'}`);
  if (verbose) {
    for (const [name, rows] of Object.entries(failures)) {
      if (!rows.length) continue;
      const label = { pairing: 'จับคู่', category: 'หมวดหมู่', amount: 'ยอดที่ AI อ่านเองไม่ได้' }[name];
      console.log(`\n  [${label}]`);
      for (const row of rows) {
        const target = row.bill ? `บิล #${row.bill}` : `รูป #${row.item}`;
        console.log(`    ${target}  ควรได้ ${row.expect}  แต่ได้ ${row.got}${row.why ? '  · ' + row.why : ''}`);
      }
    }
  }
}
console.log('');

if (minScore && overall < minScore) {
  console.error(`❌ คะแนนรวม ${overall}% ต่ำกว่าเกณฑ์ ${minScore}%`);
  process.exit(1);
}
