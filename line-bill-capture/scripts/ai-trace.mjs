// อ่านร่องรอยการอ่านรูปของ AI ที่ ai-trace.js บันทึกไว้
//
//   node scripts/ai-trace.mjs                 # สรุปของวันนี้
//   node scripts/ai-trace.mjs --date 2026-08-17
//   node scripts/ai-trace.mjs --item 664      # ดูเฉพาะรูปนี้ แบบเต็ม
//   node scripts/ai-trace.mjs --failures      # เฉพาะที่ล้มเหลว
//   node scripts/ai-trace.mjs --slow 8000     # เฉพาะที่ใช้เวลาเกิน 8 วิ

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const has = (flag) => process.argv.includes(flag);
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const dataDir = process.env.CAPTURE_DATA_DIR || path.join(rootDir, '.local-preview', 'data');
const bangkokToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const date = arg('--date', bangkokToday);
const file = path.join(dataDir, 'ai-trace', `${date}.jsonl`);

if (!fs.existsSync(file)) {
  console.log(`ยังไม่มี trace ของวันที่ ${date}`);
  console.log(`มองหาที่ ${path.relative(rootDir, file)}`);
  const dir = path.join(dataDir, 'ai-trace');
  if (fs.existsSync(dir)) {
    const days = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    if (days.length) console.log(`วันที่ที่มี: ${days.map((d) => d.replace('.jsonl', '')).join(', ')}`);
  }
  process.exit(0);
}

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

const itemFilter = Number(arg('--item', 0));
const slowMs = Number(arg('--slow', 0));
let view = rows;
if (itemFilter) view = view.filter((r) => Number(r.item_id) === itemFilter);
if (has('--failures')) view = view.filter((r) => r.event === 'failure');
if (slowMs) view = view.filter((r) => Number(r.duration_ms || 0) >= slowMs);

// โหมดเจาะรูปเดียว: โชว์เต็มเพื่อสืบว่าทำไม AI ตัดสินแบบนั้น
if (itemFilter) {
  console.log(`ร่องรอยของรูป #${itemFilter} วันที่ ${date} — ${view.length} ครั้ง\n`);
  for (const row of view) console.log(JSON.stringify(row, null, 2));
  process.exit(0);
}

const analyses = rows.filter((r) => r.event === 'analysis');
const failures = rows.filter((r) => r.event === 'failure');
const sum = (list, pick) => list.reduce((total, row) => total + Number(pick(row) || 0), 0);
const durations = analyses.map((r) => Number(r.duration_ms || 0)).sort((a, b) => a - b);
const at = (q) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * q))] : 0);

console.log(`trace วันที่ ${date}`);
console.log('─'.repeat(64));
console.log(`  อ่านสำเร็จ            ${analyses.length}`);
console.log(`  ล้มเหลว               ${failures.length}`);
if (durations.length) {
  console.log(`  เวลาต่อรูป            กลาง ${(at(0.5) / 1000).toFixed(1)}s · p90 ${(at(0.9) / 1000).toFixed(1)}s · สูงสุด ${(durations.at(-1) / 1000).toFixed(1)}s`);
}
const totalTokens = sum(analyses, (r) => r.tokens?.total);
if (totalTokens) {
  const cached = sum(analyses, (r) => r.tokens?.cached);
  console.log(`  token                 รวม ${totalTokens.toLocaleString()} · เฉลี่ย ${Math.round(totalTokens / Math.max(1, analyses.length)).toLocaleString()}/รูป · cached ${cached.toLocaleString()}`);
}

const byCategory = {};
for (const row of analyses) {
  const key = row.decision?.category || '(ไม่ระบุ)';
  byCategory[key] = (byCategory[key] || 0) + 1;
}
if (Object.keys(byCategory).length) {
  console.log('  จัดหมวดเป็น           ' + Object.entries(byCategory).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`).join(' · '));
}
const noAmount = analyses.filter((r) => r.decision?.category === 'bill' && !Number(r.decision?.bill_total_value));
const conflicts = analyses.filter((r) => r.decision?.amount_conflict);
if (noAmount.length) console.log(`  ⚠ บิลที่อ่านยอดไม่ออก  ${noAmount.length}  (#${noAmount.slice(0, 8).map((r) => r.item_id).join(', #')})`);
if (conflicts.length) console.log(`  ⚠ ยอดขัดกับที่แจ้ง     ${conflicts.length}  (#${conflicts.slice(0, 8).map((r) => r.item_id).join(', #')})`);

if (failures.length) {
  console.log('');
  console.log('  ล้มเหลว:');
  for (const row of failures.slice(0, 10)) {
    console.log(`    #${row.item_id}  ครั้งที่ ${row.attempt}  ${row.error_kind || '-'}${row.retryable ? ' (ลองใหม่ได้)' : ''}  ${row.message || ''}`);
  }
}

if ((has('--failures') || slowMs) && view.length) {
  console.log('');
  for (const row of view.slice(0, 20)) console.log('  ' + JSON.stringify(row));
}
console.log('');
