// เก็บประวัติการสอนทุกประเภท แต่ใช้ใน AI เฉพาะการแก้รุ่นปัจจุบันที่ยังมีผล
//
// บั๊กเดิม: กลไกสอน AI สร้างไว้ครบแล้ว แต่ต่อสายไว้แค่ปุ่ม "ไม่ใช่บิล/สลิป → อื่น ๆ"
// ส่วนการแก้ที่มีค่าที่สุดคือ บิล↔สลิป กลับไม่ได้เก็บอะไรเลย ตารางตัวอย่างจึงว่างเปล่า
//
// เทสต์นี้ยิงผ่าน db layer จริงบนฐานข้อมูลชั่วคราว

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.ok(process.env.SOLAO_LOCAL_SIMULATION === '1' && os.tmpdir().startsWith('/Volumes/SSD Files/SOLAO/'), 'Use SOLAO SSD runner');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lbc-learn-'));
process.env.CAPTURE_DATA_DIR = dataDir;

const { initDatabase, recordCategoryLearningExample, listAiLearningExamples, getItemById, updateCategory } = await import('../src/db.js');
await initDatabase();

const db = new DatabaseSync(path.join(dataDir, 'line-bill-capture.sqlite'));
const now = new Date().toISOString();
const seed = (id, category) => db.prepare(
  `INSERT INTO capture_items (id, line_message_id, source_type, source_id, category, status,
     file_sha256, storage_path, storage_relative_path, match_status, raw_event_json, created_at, updated_at)
   VALUES (?, ?, 'group', 'G1', ?, 'downloaded', ?, ?, ?, 'unmatched', '{}', ?, ?)`
).run(id, `m${id}`, category, `sha${id}`, path.join(dataDir, 'images', `${id}.jpg`), `${id}.jpg`, now, now);

seed(1, 'other');
seed(2, 'transfer');
seed(3, 'bill');
const correctAndTeach = async (id, correctedCategory, reason = '', aiResponse = '') => {
  const before = await getItemById(id);
  const current = await updateCategory({ id, category: correctedCategory, reason, editedBy: 'learning-test' });
  return recordCategoryLearningExample({ item: before, originalCategory: before.category, correctedCategory,
    categoryEditedAt: current.category_edited_at, reason, aiResponse, approvedBy: 'learning-test' });
};
const contextualIds = async () => (await listAiLearningExamples({ limit: 100 })).filter(row => row.outcome === 'category_correction')
  .map(row => JSON.parse(row.example_json).item_id);

// 1) แก้ประเภทโดยไม่พิมพ์เหตุผล ต้องยังถูกเก็บ (ระดับ auto)
const auto = await correctAndTeach(1, 'bill');
assert.ok(auto, 'การแก้ประเภทโดยไม่มีเหตุผล ต้องยังถูกเก็บเป็นตัวอย่าง');
assert.equal(auto.teaching, 'auto');
assert.match(auto.owner_reason, /อื่น ๆ.*บิล/, 'ต้องบันทึกว่าแก้จากอะไรเป็นอะไร');

// 2) บิล↔สลิป ต้องเก็บได้ ไม่ใช่เฉพาะ "อื่น ๆ"
const billToSlip = await correctAndTeach(3, 'transfer', 'มีเลขอ้างอิงการโอนและชื่อธนาคาร จึงเป็นสลิป',
  'เข้าใจแล้ว รูปที่มีเลขอ้างอิงการโอนให้จัดเป็นสลิปโอน');
assert.ok(billToSlip, 'การแก้ บิล→สลิป ต้องถูกเก็บ');
assert.equal(billToSlip.teaching, 'explained');
assert.equal(billToSlip.corrected_category, 'transfer');

// 3) ตัวอย่างที่คนอธิบายไว้ ต้องมาก่อนตัวอย่างที่เก็บอัตโนมัติ
//    ไม่งั้นของคุณภาพต่ำจะเบียดของดีออกจาก prompt เพราะดึงมาแค่ 12 รายการ
const slipAuto = await correctAndTeach(2, 'bill');
assert.equal(slipAuto.teaching, 'auto');

const examples = await listAiLearningExamples({ limit: 12 });
assert.equal(examples.length, 3, 'ต้องเก็บครบทั้งสามตัวอย่าง');
const explainedIndex = examples.findIndex((row) => /เลขอ้างอิงการโอน/.test(String(row.review_note || '')));
assert.equal(explainedIndex, 0, 'ตัวอย่างที่คนอธิบายไว้ต้องถูกดึงมาก่อน');

// การยกเลิกไม่สร้างตัวอย่างย้อนกลับ และคงแถวประวัติเดิมครบทุกค่า
seed(4, 'bill');
const approvedReason = 'เป็นภาพประกอบ ไม่ใช่เอกสารซื้อหรือการโอน';
const approved = await correctAndTeach(4, 'other', approvedReason, 'เห็นตรงกันว่าเป็นภาพประกอบ');
assert.equal(approved.category_edit_binding.category_edit_reason, approvedReason);
assert.equal(approved.category_edit_binding.category_edited_at, (await getItemById(4)).category_edited_at);
assert.ok((await contextualIds()).includes(4), 'ตัวอย่างที่อนุมัติและยังตรงกับรายการปัจจุบันต้องใช้ได้');
const preserved = db.prepare('SELECT * FROM ai_category_learning_examples WHERE item_id=4').get();
await updateCategory({ id: 4, category: 'bill', reason: 'ย้อนกลับโดยไม่สอน AI', editedBy: 'learning-test' });
assert.ok(!(await contextualIds()).includes(4), 'Undo ต้องไม่นำตัวอย่างเดิมไปใส่บริบท AI');
assert.deepEqual(db.prepare('SELECT * FROM ai_category_learning_examples WHERE item_id=4').get(), preserved);
await updateCategory({ id: 4, category: 'other', reason: approvedReason, editedBy: 'learning-test' });
assert.ok(!(await contextualIds()).includes(4), 'กลับประเภทและเหตุผลเดิมโดยไม่สอน ต้องไม่คืนตัวอย่างอนุมัติรุ่นเก่า');

// การแก้ด้วยประเภท/เหตุผล/ผู้บันทึกเดิมในมิลลิวินาทีเดียวกันก็เป็นรุ่นใหม่
await updateCategory({ id: 4, category: 'bill', reason: 'เตรียมแก้ประเภทใหม่โดยไม่สอน', editedBy: 'learning-test' });
const taughtAgain = await correctAndTeach(4, 'other', approvedReason, 'ยืนยันใหม่โดยตั้งใจสอน');
const oldEditTime = taughtAgain.category_edit_binding.category_edited_at;
const realDateNow = Date.now;
Date.now = () => Date.parse(oldEditTime);
try { await updateCategory({ id: 4, category: 'other', reason: approvedReason, editedBy: 'learning-test' }); }
finally { Date.now = realDateNow; }
assert.ok((await getItemById(4)).category_edited_at > oldEditTime, 'เวลาแก้ประเภทต้องเพิ่มแม้นาฬิกาอยู่มิลลิวินาทีเดิม');
assert.ok(!(await contextualIds()).includes(4), 'การแก้เดิมแต่ไม่สอนต้องไม่คืนตัวอย่างรุ่นก่อน');

const explainedStored = db.prepare('SELECT * FROM ai_category_learning_examples WHERE item_id=3').get();
await updateCategory({ id: 3, category: 'transfer', reason: 'เหตุผลใหม่ ไม่ส่งให้ AI เรียนรู้', editedBy: 'learning-test' });
assert.ok(!(await contextualIds()).includes(3), 'เปลี่ยนเหตุผลต้องเลิกใช้ตัวอย่างเหตุผลเก่า');
assert.deepEqual(db.prepare('SELECT * FROM ai_category_learning_examples WHERE item_id=3').get(), explainedStored);

// คำขอสอนที่มาช้าหลังอีกคำขอแก้ข้อมูล ต้องไม่ผูกเหตุผลเก่าเข้ากับรุ่นใหม่
const current = await getItemById(3);
assert.equal(await recordCategoryLearningExample({ item: current, originalCategory: 'bill', correctedCategory: 'transfer',
  reason: explainedStored.reason, aiResponse: 'คำตอบที่ล่าช้า', approvedBy: 'learning-test' }), null);
assert.equal(await recordCategoryLearningExample({ item: current, originalCategory: 'bill', correctedCategory: 'transfer',
  categoryEditedAt: billToSlip.category_edit_binding.category_edited_at, reason: current.category_edit_reason,
  aiResponse: 'คำตอบที่ล่าช้า แม้เหตุผลตรง', approvedBy: 'learning-test' }), null);
assert.deepEqual(db.prepare('SELECT * FROM ai_category_learning_examples WHERE item_id=3').get(), explainedStored);

// ตัวอย่างเดิมก่อนมี binding: รองรับเหตุผลว่างแบบ auto และเหตุผลจริง แต่ไม่คืนหลังแก้ใหม่
for (const [id, corrected, reason, response] of [[7, 'bill', '', ''], [8, 'other', 'ตัวอย่างเดิมมีเหตุผล', 'AI เห็นตรงกัน']]) {
  seed(id, 'transfer');
  const legacyExample = await correctAndTeach(id, corrected, reason, response);
  delete legacyExample.category_edit_binding;
  const editedAt = (await getItemById(id)).category_edited_at;
  db.prepare('UPDATE ai_category_learning_examples SET example_json=?,updated_at=? WHERE item_id=?').run(JSON.stringify(legacyExample),
    new Date(Date.parse(editedAt) + 1).toISOString(), id);
  assert.ok((await contextualIds()).includes(id), 'ตัวอย่างเดิมที่ยังสอดคล้องกับการแก้ปัจจุบันต้องใช้ได้');
  await updateCategory({ id, category: corrected, reason, editedBy: 'learning-test' });
  assert.ok(!(await contextualIds()).includes(id), 'ตัวอย่างเดิมต้องไม่คืนหลังแก้ประเภท/เหตุผลเดิมใหม่โดยไม่สอน');
}
db.prepare("UPDATE capture_items SET status='unsent' WHERE id=1").run();
db.prepare("UPDATE capture_items SET status='duplicate' WHERE id=2").run();
assert.deepEqual(await contextualIds(), [], 'รูปที่ยกเลิก/ซ้ำ และตัวอย่างที่หมดผลต้องไม่เข้า AI');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_category_learning_examples').get().n, 6, 'เก็บประวัติทุกแถวโดยไม่ลบหรือ backfill');

// 4) route ต้องส่งประเภทปลายทางจริงให้ AI ทวน ไม่ใช่ฝัง 'other' ไว้ตายตัว
const serverSrc = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
assert.ok(
  /targetCategory = normalizeCategory\(req\.body\?\.target_category\)/.test(serverSrc),
  'review route ต้องรับ target_category จาก client'
);
assert.ok(
  !/reviewCategoryCorrection\(\{ item, reason, targetCategory: 'other' \}\)/.test(serverSrc),
  "review route ต้องไม่ฝัง targetCategory: 'other' ไว้ตายตัว"
);

// 5) หน้าจอต้องต่อปุ่มบิล/สลิปเข้าระบบสอน และไม่ส่งเหตุผลปลอม
const uiSrc = await fs.readFile(new URL('../mobile-admin-v3/src/App.tsx', import.meta.url), 'utf8');
assert.ok(/askOrClassify\('bill'\)/.test(uiSrc), 'ปุ่ม "เป็นบิล" ต้องผ่านเส้นทางที่สอน AI ได้');
assert.ok(/askOrClassify\('transfer'\)/.test(uiSrc), 'ปุ่ม "เป็นสลิป" ต้องผ่านเส้นทางที่สอน AI ได้');
assert.ok(!/ผู้ใช้เลือกจากหน้ารวมเอกสาร/.test(uiSrc), 'ต้องไม่ส่งเหตุผลปลอมที่บอกแค่ชื่อหน้าจอ');

db.close();
await fs.rm(dataDir, { recursive: true, force: true });
console.log('✅ การแก้ประเภททุกแบบ (บิล / สลิป / อื่น ๆ) ถูกเก็บเป็นตัวอย่างสอน AI · ตัวอย่างที่มีคำอธิบายถูกจัดลำดับก่อน');

// 6) คนต้องสั่งได้ว่าจะส่งให้ AI เรียนรู้หรือไม่ และ AI ต้องขวางการแก้ประเภทไม่ได้
const serverSrc2 = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
assert.ok(
  /const recordLearning = req\.body\?\.record_learning !== false;/.test(serverSrc2),
  'server ต้องรับ record_learning เพื่อให้คนสั่งไม่เก็บเป็นตัวอย่างได้'
);
assert.ok(
  /\(!recordLearning \|\| before\.category === category\)/.test(serverSrc2),
  'เมื่อ record_learning=false ต้องไม่บันทึกตัวอย่าง'
);

const uiSrc2 = await fs.readFile(new URL('../mobile-admin-v3/src/App.tsx', import.meta.url), 'utf8');
assert.ok(/const \[learn, setLearn\] = useState\(true\)/.test(uiSrc2), 'มือถือต้องมีปุ่มเลือกสอน AI และเปิดไว้เป็นค่าเริ่มต้น');
assert.ok(/if \(!learn\) \{ await onSave\(teaching, ''\); return; \}/.test(uiSrc2), 'ไม่ติ๊กสอน = ต้องข้ามขั้นให้ AI ทวนความเข้าใจ');
assert.ok(/record_learning: !\(reason && !learningResponse\)/.test(uiSrc2), 'มือถือต้องส่ง record_learning ตามที่ผู้ใช้เลือก');

const deskSrc = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
assert.ok(/id="not-document-learn" checked/.test(deskSrc), 'หน้าเดสก์ท็อปต้องมีปุ่มเลือกสอน AI และเปิดไว้เป็นค่าเริ่มต้น');
assert.ok(/record_learning:false/.test(deskSrc), 'หน้าเดสก์ท็อปต้องส่ง record_learning:false เมื่อไม่ติ๊ก');
assert.ok(
  /id="not-document-analyze"/.test(deskSrc) && /AI เห็นตรงกับเหตุผลของคุณ/.test(deskSrc),
  'หน้าเดสก์ท็อปต้องมีขั้นให้ AI อ่านรูปและแสดงว่าเห็นตรงกับเหตุผลหรือไม่'
);
assert.ok(
  /actions=\$\('classification-box'\)\?\.querySelector\('\.actions'\)/.test(deskSrc),
  'ปุ่มจัดเป็นอื่น ๆ ต้องอยู่ในชุดตัวเลือก รูปนี้คือเอกสารประเภทไหน'
);
assert.ok(/reviewResult\?\.decision==='accept'&&reviewResult\.reason===reason/.test(deskSrc), 'ผล AI ที่ใช้ยืนยันต้องตรงกับเหตุผลฉบับล่าสุด');
assert.ok(!/prompt\(review\.data\.question/.test(deskSrc), 'หน้าเดสก์ท็อปต้องถามเพิ่มใน modal ไม่ใช้ prompt ที่ขาดบริบท');
assert.ok(/ถ้าไม่อยากอธิบายต่อ/.test(uiSrc2), 'มือถือยังต้องบอกทางออกเมื่อ AI ไม่เข้าใจเหตุผล');

console.log('✅ ทั้งสองหน้าจอมีปุ่มเลือก "ส่งให้ AI เรียนรู้" และ AI ขวางการแก้ประเภทไม่ได้');
