// สร้าง "ชุดข้อสอบ" ของ AI จากคำตัดสินที่มนุษย์ทำไปแล้วในระบบ
//
// แนวคิด: ทุกครั้งที่คนกดยืนยันคู่ แก้หมวด หรือเคลียร์ธงยอด คือการบอกคำตอบที่ถูก
// เอาคำตอบเหล่านั้นมารวมเป็น golden set แล้วใช้วัดว่า AI ทำถูกกี่ % ได้ฟรี ๆ
// โดยไม่ต้องมานั่ง label เพิ่ม
//
//   node scripts/build-eval-set.mjs [--db <path>] [--out <path>]
//
// ผลลัพธ์เขียนลง .local-preview/eval/golden.json ซึ่งถูก .gitignore ไว้
// เพราะมีชื่อร้าน ยอดเงิน และชื่อผู้ส่งจริง — ห้ามขึ้น git

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const dbPath = arg('--db', path.join(rootDir, '.local-preview', 'data', 'line-bill-capture.sqlite'));
const outPath = arg('--out', path.join(rootDir, '.local-preview', 'eval', 'golden.json'));

if (!fs.existsSync(dbPath)) {
  console.error(`ไม่พบฐานข้อมูล: ${dbPath}\nรัน npm run preview:sync ก่อน`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);

// ── 1. การจับคู่ที่คนตรวจแล้ว ───────────────────────────────────────────
// reviewed_by ไม่ว่าง = มีมนุษย์กดยืนยัน/ปฏิเสธจริง ไม่ใช่ auto-confirm
const pairsConfirmed = all(`
  SELECT m.id, m.bill_item_id, m.slip_item_id, m.score, m.reviewed_by, m.reviewed_at
  FROM capture_matches m
  WHERE m.status = 'confirmed' AND m.reviewed_by IS NOT NULL`);

// คนกดปฏิเสธเอง = ตัวอย่างเชิงลบ (ห้ามนับการรีเซ็ตของระบบ)
const pairsRejected = all(`
  SELECT m.id, m.bill_item_id, m.slip_item_id, m.score, m.reason_json
  FROM capture_matches m
  WHERE m.status = 'rejected'
    AND m.created_by = 'admin-web'
    AND COALESCE(m.reason_json, '') NOT LIKE '%รีเซ็ต%'
    AND COALESCE(m.reason_json, '') NOT LIKE '%จัดคู่ใหม่%'`);

// ── 2. หมวดหมู่ที่คนแก้เอง ─────────────────────────────────────────────
const categoryFixes = all(`
  SELECT id, category AS human_category, category_edit_reason, category_edited_at, ai_result_json
  FROM capture_items
  WHERE category_edited_at IS NOT NULL`);

// ── 3. ยอดเงินที่คนแก้/ยืนยันเอง ────────────────────────────────────────
const amountFixes = all(`
  SELECT id, category, bill_total_value AS human_amount, announced_amount,
         bill_total_edited_at, flag_resolved_at, ai_result_json
  FROM capture_items
  WHERE (bill_total_edited_at IS NOT NULL OR flag_resolved_at IS NOT NULL)
    AND category = 'bill'`);

// ── เก็บ snapshot ของรูปที่เกี่ยวข้อง เพื่อให้ eval รันซ้ำได้โดยไม่ต้องพึ่ง DB ──
const itemIds = new Set();
for (const p of [...pairsConfirmed, ...pairsRejected]) {
  itemIds.add(p.bill_item_id);
  itemIds.add(p.slip_item_id);
}
for (const row of [...categoryFixes, ...amountFixes]) itemIds.add(row.id);

const ITEM_COLUMNS = `id, source_id, source_type, category, status, match_status,
  bill_total_value, bill_total_text, slip_amount_value, announced_amount,
  vendor_name, supplier_name, bill_purpose, doc_ref, vendor_tax_id,
  payment_role, reimbursement_status, reimbursement_related_item_id,
  event_timestamp_ms, sender_user_id,
  ai_confidence, ai_summary, ai_raw_text, ai_result_json,
  bill_total_edited_at, flag_resolved_at`;

const items = itemIds.size
  ? all(`SELECT ${ITEM_COLUMNS} FROM capture_items WHERE id IN (${[...itemIds].join(',')})`)
  : [];

// พูลผู้สมัครสำหรับวัดการจับคู่: ต้องมีสลิปอื่น ๆ ในกลุ่มเดียวกันให้ AI เลือกผิดได้ด้วย
// ไม่งั้นวัดแล้วได้ 100% ตลอดเพราะมีตัวเลือกเดียว
const billDays = pairsConfirmed
  .map((p) => items.find((i) => i.id === p.bill_item_id))
  .filter(Boolean);
const poolIds = new Set();
for (const bill of billDays) {
  const from = Number(bill.event_timestamp_ms || 0) - 72 * 3600 * 1000;
  const to = Number(bill.event_timestamp_ms || 0) + 72 * 3600 * 1000;
  for (const row of all(
    `SELECT ${ITEM_COLUMNS} FROM capture_items
     WHERE source_id = ? AND category IN ('transfer','transfer_notice')
       AND status NOT IN ('unsent','duplicate')
       AND event_timestamp_ms BETWEEN ? AND ?`,
    bill.source_id, from, to
  )) {
    poolIds.add(row.id);
    if (!items.some((i) => i.id === row.id)) items.push(row);
  }
}

const golden = {
  generated_at: new Date().toISOString(),
  source_db: path.basename(dbPath),
  note: 'สร้างจากคำตัดสินของมนุษย์ในระบบ · มีข้อมูลธุรกิจจริง ห้าม commit',
  counts: {
    pairs_confirmed: pairsConfirmed.length,
    pairs_rejected: pairsRejected.length,
    category_fixes: categoryFixes.length,
    amount_fixes: amountFixes.length,
    items_snapshotted: items.length,
    slip_pool: poolIds.size
  },
  pairs_confirmed: pairsConfirmed,
  pairs_rejected: pairsRejected,
  category_fixes: categoryFixes,
  amount_fixes: amountFixes,
  slip_pool_ids: [...poolIds],
  items
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2));
db.close();

console.log('สร้างชุดข้อสอบแล้ว →', path.relative(rootDir, outPath));
console.log('');
console.log('  คู่ที่คนตรวจและยืนยัน   ', golden.counts.pairs_confirmed);
console.log('  คู่ที่คนปฏิเสธเอง       ', golden.counts.pairs_rejected);
console.log('  หมวดที่คนแก้เอง         ', golden.counts.category_fixes);
console.log('  ยอดที่คนแก้/ยืนยันเอง   ', golden.counts.amount_fixes);
console.log('  สลิปในพูลให้เลือกผิดได้ ', golden.counts.slip_pool);
if (!golden.counts.pairs_confirmed && !golden.counts.category_fixes) {
  console.log('');
  console.log('⚠️  ยังไม่มีคำตัดสินของมนุษย์พอจะวัดผล — ใช้งานระบบไปสักพักแล้วรันใหม่');
}
