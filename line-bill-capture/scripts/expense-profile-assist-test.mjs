import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ระยะ 2: ข้อเสนอจากเอกสารคู่, จำคู่ร้าน-ผู้รับ, รายชื่อ autocomplete และ validation ของ source ใหม่
// รันผ่าน SSD snapshot runner เท่านั้น ใช้ฐานข้อมูลจำลองใน TMPDIR บน SSD
const tempRoot = path.resolve(os.tmpdir());
assert.ok(tempRoot.startsWith('/Volumes/SSD Files/SOLAO/'), 'Run using ssd-workspace.mjs run --project line-bill-capture');
const dataDir = await fs.mkdtemp(path.join(tempRoot, 'expense-assist-'));
process.env.CAPTURE_DATA_DIR = dataDir;
process.env.CAPTURE_DB_PATH = path.join(dataDir, 'assist.sqlite');
const api = await import('../src/db.js');
await api.initDatabase();
const raw = new DatabaseSync(process.env.CAPTURE_DB_PATH);
const now = '2026-10-06T03:00:00.000Z';
const ts = Date.parse(now);
const insert = raw.prepare(`INSERT INTO capture_items
  (id,line_message_id,source_type,source_id,category,status,vendor_name,supplier_name,bill_total_value,slip_amount_value,
   ai_status,ai_result_json,raw_event_json,event_timestamp_ms,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const addItem = (id, category, { status = 'downloaded', supplier = null, ai = {} } = {}) => insert.run(id, `m${id}`, 'group', 'TEST', category, status,
  null, supplier, category === 'bill' ? 23290 : null, category === 'transfer' ? 23290 : null, 'done', JSON.stringify(ai), '{}', ts, now, now);
const match = (bill, slip, status) => raw.prepare(`INSERT INTO capture_matches(bill_item_id,slip_item_id,score,status,reason_json,created_by,created_at,updated_at)
  VALUES(?,?,90,?,'[]','manual',?,?)`).run(bill, slip, status, now, now);

const field = (value, source = 'manual', evidence = []) => ({ value, source, evidence });
const full = (overrides = {}) => ({
  transaction_type: field('purchase'), supplier_name: field('ร้านผักสด'), purpose: field('ค่าผัก'),
  recipient_name: field('นายสมชาย ใจดี'), recipient_bank: field('ธนาคารกสิกรไทย'), recipient_account_masked: field('xxx-x-x1234-x'),
  supplier_payee_relation: field('authorized_payee'), branch: field('สันกำแพง'), department: field('ครัว'), notes: field('หมายเหตุเฉพาะใบนี้'), ...overrides
});
const save = (id, fields, { revision = 0, status = 'reviewed', reason = 'ตรวจจากหลักฐานจำลอง' } = {}) =>
  api.updateExpenseProfile({ id, input: { expected_revision: revision, status, fields, reason }, actor: 'ผู้ทดสอบ' });
const read = (id) => api.getExpenseProfile(id);
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const rejects = async (promise, code, message) => { const result = await promise; assert.equal(result.error, code, message); checks += 1; };

// --- เอกสารคู่: บิล #3600 (ไม่มีชื่อร้านจาก OCR) ↔ สลิป #3624 ยอด 23,290 ---
addItem(3600, 'bill'); addItem(3624, 'transfer'); match(3600, 3624, 'confirmed');
addItem(3700, 'bill'); addItem(3724, 'transfer'); match(3700, 3724, 'pending');
addItem(3800, 'bill'); addItem(3824, 'transfer', { status: 'unsent' }); match(3800, 3824, 'confirmed');
const beforeItems = JSON.stringify(raw.prepare('SELECT * FROM capture_items ORDER BY id').all());
const beforeMatches = JSON.stringify(raw.prepare('SELECT * FROM capture_matches ORDER BY id').all());

eq((await read(3600)).suggestions, {}, 'ไม่มีข้อเสนอเมื่อคู่ยังไม่มี profile');
const saved = await save(3624, full());
ok(!saved.error, `บันทึกสลิปคู่ได้ ${saved.error}`);
const paired = (await read(3600)).suggestions;
eq(paired.supplier_name, { value: 'ร้านผักสด', source: 'paired_document', evidence: [{ item_id: 3624 }] }, 'ข้อเสนอต้องระบุเอกสารคู่เป็นหลักฐาน');
eq(paired.recipient_account_masked.value, 'xxx-x-x1234-x', 'บัญชีที่ปิดบังแล้วส่งต่อได้เฉพาะรูปปิดบัง');
ok(!('notes' in paired), 'ไม่ส่งหมายเหตุเฉพาะเอกสารไปอีกใบ');
for (const suggestion of Object.values(paired)) eq(Object.keys(suggestion).sort(), ['evidence', 'source', 'value'], 'รูปแบบข้อเสนอต้องส่งกลับเข้า PUT ได้ตรง ๆ');
eq((await read(3600)).fields.supplier_name.value, null, 'ข้อเสนอไม่ถูกบันทึกอัตโนมัติ');
eq((await read(3600)).revision, 0, 'อ่านข้อเสนอไม่สร้างฉบับบันทึก');
eq((await read(3700)).suggestions, {}, 'จับคู่ที่ยังไม่ยืนยันไม่ใช้เป็นเอกสารคู่');
eq((await read(3800)).suggestions, {}, 'เอกสารคู่ที่ถูกยกเลิกไม่ใช้เป็นแหล่งข้อเสนอ');
const reverse = await save(3600, full({ supplier_name: field('ร้านบนบิล') }), { status: 'draft' });
ok(!reverse.error, 'บันทึกฝั่งบิลได้');
eq((await read(3624)).suggestions.supplier_name?.evidence, [{ item_id: 3600 }], 'ข้อเสนอเกิดได้ทั้งสองทิศทาง');

// ข้อเสนอจากเอกสารเอง (OCR) ต้องชนะเอกสารคู่
addItem(3900, 'bill', { supplier: 'ร้านตาม OCR', ai: { supplier_name: 'ร้านตาม OCR' } }); addItem(3924, 'transfer'); match(3900, 3924, 'confirmed');
ok(!(await save(3924, full())).error, 'เตรียมสลิปคู่');
eq((await read(3900)).suggestions.supplier_name.source, 'bill', 'ข้อเสนอจากเอกสารเองมาก่อน');
eq((await read(3900)).suggestions.recipient_name.source, 'paired_document', 'ช่องที่เอกสารเองไม่มีให้เติมจากเอกสารคู่');

// เลขบัญชีเต็มที่หลุดมาใน profile เดิมต้องไม่ถูกส่งต่อ
addItem(4000, 'bill'); addItem(4024, 'transfer'); match(4000, 4024, 'confirmed');
raw.prepare(`INSERT INTO capture_expense_profiles(item_id,revision,status,fields_json,updated_by,updated_at) VALUES(4024,1,'draft',?,'x',?)`)
  .run(JSON.stringify({ recipient_account_masked: field('1234567890'), recipient_name: field('ผู้รับทดสอบ') }), now);
const leaked = (await read(4000)).suggestions;
ok(!leaked.recipient_account_masked, 'ห้ามเสนอเลขบัญชีที่ไม่ปิดบัง');
eq(leaked.recipient_name.value, 'ผู้รับทดสอบ', 'ช่องอื่นยังเสนอได้');
ok(!/\d{6,}/u.test(JSON.stringify(leaked)), 'response ห้ามมีเลขยาวคล้ายเลขบัญชี');

// --- การบันทึกค่าที่มาจาก source ใหม่ ---
const draft = await read(3600);
const apply = (key, evidence, value = paired[key]?.value, source = 'paired_document') => ({ [key]: field(value, source, evidence) });
const base = { revision: draft.revision, status: 'draft' };
const ok1 = await save(3600, apply('recipient_name', [{ item_id: 3624 }]), base);
ok(!ok1.error, `ใช้ข้อเสนอเอกสารคู่ได้ ${ok1.error}`);
eq(ok1.fields.recipient_name, { value: 'นายสมชาย ใจดี', source: 'paired_document', evidence: [{ item_id: 3624 }] }, 'เก็บ source และหลักฐานเอกสารคู่');
eq(ok1.history[0].new_fields.recipient_name.source, 'paired_document', 'ประวัติเก็บที่มา');
ok(ok1.history[0].evidence_snapshot.suggestions.recipient_name, 'snapshot เก็บข้อเสนอที่เห็นตอนบันทึก');
await rejects(save(3600, apply('recipient_name', [{ item_id: 3724 }]), { revision: ok1.revision, status: 'draft' }), 'paired_document_not_linked', 'หลักฐานต้องเป็นเอกสารที่จับคู่กัน');
await rejects(save(3600, apply('recipient_name', [{ item_id: 3624 }], 'ชื่อที่ไม่เคยอยู่ใน profile คู่'), { revision: ok1.revision, status: 'draft' }), 'assist_evidence_mismatch', 'ค่าต้องตรงกับ profile เอกสารคู่');
await rejects(save(3600, apply('recipient_name', []), { revision: ok1.revision, status: 'draft' }), 'evidence_required', 'ต้องมีหลักฐาน');
await rejects(save(3600, apply('recipient_name', [{ item_id: 3600 }]), { revision: ok1.revision, status: 'draft' }), 'evidence_item_invalid', 'อ้างตัวเองไม่ได้');
await rejects(save(3600, apply('recipient_name', [{ item_id: 3624, message_id: 'x' }]), { revision: ok1.revision, status: 'draft' }), 'evidence_item_invalid', 'ไม่รับ message_id ใน source ใหม่');
await rejects(save(3600, apply('notes', [{ item_id: 3624 }], 'หมายเหตุเฉพาะใบนี้'), { revision: ok1.revision, status: 'draft' }), 'source_invalid', 'notes ไม่รับ source เอกสารคู่');
await rejects(save(3600, apply('recipient_account_masked', [{ item_id: 3624 }], '1234567890'), { revision: ok1.revision, status: 'draft' }), 'account_must_be_masked', 'ห้ามบันทึกเลขเต็มแม้ source ใหม่');
await rejects(save(3600, { recipient_name: { value: 'x', source: 'paired_document', evidence: [{ item_id: 3624 }], extra: 1 } }, { revision: ok1.revision, status: 'draft' }), 'field_invalid', 'ยังคงเข้ม schema เดิม');
await rejects(save(3600, apply('recipient_name', [{ item_id: 3624 }], undefined, 'unknown_source'), { revision: ok1.revision, status: 'draft' }), 'field_invalid', 'source นอกรายการยังถูกปฏิเสธ');

// ค่าที่เคยบันทึกจาก source ใหม่ต้องผ่านซ้ำในฉบับถัดไป แม้เอกสารคู่แก้ค่าไปแล้ว
const partnerRead = await read(3624);
ok(!(await save(3624, { recipient_name: field('นายสมชาย ใจดี (แก้)') }, { revision: partnerRead.revision, status: 'draft' })).error, 'คู่แก้ค่าภายหลัง');
const later = await save(3600, { branch: field('สาขาใหม่') }, { revision: ok1.revision, status: 'draft' });
ok(!later.error, `ฉบับถัดไปยังบันทึกได้หลังคู่แก้ค่า ${later.error}`);
eq(later.fields.recipient_name.source, 'paired_document', 'ค่าเดิมยังคง source');
const reviewed = await save(3600, { supplier_name: field('ร้านบนบิล'), purpose: field('ค่าผัก'), transaction_type: field('purchase'), supplier_payee_relation: field('authorized_payee', 'paired_document', [{ item_id: 3624 }]) }, { revision: later.revision, status: 'reviewed' });
ok(!reviewed.error, `บันทึกว่าตรวจแล้วพร้อมค่าจากเอกสารคู่ ${reviewed.error}`);

// --- จำคู่ร้าน ↔ ผู้รับเงิน ↔ ความสัมพันธ์ ---
const memoryBill = (id, supplier) => { addItem(id, 'bill', { supplier }); return id; };
const reviewPair = async (id, supplier, recipient, relation, bank = 'ธนาคารกรุงไทย', status = 'reviewed') => {
  memoryBill(id, supplier);
  const result = await save(id, full({ supplier_name: field(supplier), recipient_name: field(recipient), supplier_payee_relation: field(relation),
    recipient_bank: field(bank), recipient_account_masked: field('xxx-x-x9999-x') }), { status });
  ok(!result.error, `เตรียมประวัติ ${id} ${result.error}`);
};
await reviewPair(5001, 'ร้านเนื้อ ก', 'นายเจ้าของ เนื้อ', 'owner');
await reviewPair(5002, 'ร้านเนื้อ ก', 'นายเจ้าของ เนื้อ', 'owner');
await reviewPair(5003, 'ร้านเนื้อ ก', 'นายเจ้าของ เนื้อ', 'owner', 'ธนาคารกรุงไทย', 'draft');
memoryBill(5100, '  ร้านเนื้อ  ก ');
const remembered = (await read(5100)).suggestions;
eq({ ...remembered.recipient_name, evidence: [...remembered.recipient_name.evidence].sort((a, b) => a.item_id - b.item_id) },
  { value: 'นายเจ้าของ เนื้อ', source: 'remembered_pair', evidence: [{ item_id: 5001 }, { item_id: 5002 }] }, 'จำผู้รับจากร้านที่ตรวจแล้ว ไม่นับร่าง และไม่สนช่องว่าง/ตัวพิมพ์');
eq(remembered.supplier_payee_relation.value, 'owner', 'จำความสัมพันธ์');
eq(remembered.recipient_bank.value, 'ธนาคารกรุงไทย', 'จำธนาคาร');
ok(!remembered.recipient_account_masked, 'ไม่จำเลขบัญชี แม้ปิดบังแล้ว');
ok(remembered.supplier_name?.source !== 'remembered_pair', 'ช่องที่รู้อยู่แล้วไม่ถูกเสนอซ้ำจากประวัติ');
// ทิศทางกลับ: รู้ผู้รับแต่ยังไม่รู้ร้าน
addItem(5200, 'transfer', { ai: { recipient_name: 'นายเจ้าของ เนื้อ' } });
const reverseMemory = (await read(5200)).suggestions;
eq(reverseMemory.recipient_name.source, 'slip', 'OCR ของเอกสารเองยังชนะ');
eq(reverseMemory.supplier_name.value, 'ร้านเนื้อ ก', 'รู้ผู้รับแล้วเสนอร้าน');
eq(reverseMemory.supplier_name.source, 'remembered_pair', 'ที่มาคือประวัติที่ตรวจแล้ว');
// ผู้รับสองรายคะแนนเท่ากัน: ไม่เดา
await reviewPair(5301, 'ร้านผักกำกวม', 'ผู้รับ P', 'owner');
await reviewPair(5302, 'ร้านผักกำกวม', 'ผู้รับ Q', 'platform');
memoryBill(5300, 'ร้านผักกำกวม');
const memoryOf = (profile) => Object.keys(profile.suggestions).filter((key) => profile.suggestions[key].source === 'remembered_pair');
eq(memoryOf(await read(5300)), [], 'ไม่เดาเมื่อมีผู้รับที่น่าจะเป็นได้เท่ากัน');
await reviewPair(5303, 'ร้านผักกำกวม', 'ผู้รับ P', 'owner');
eq((await read(5300)).suggestions.recipient_name.value, 'ผู้รับ P', 'เมื่อมีคู่เด่นชัดจึงเสนอ');
// ผู้รับที่ผู้ใช้กรอกไว้แล้วจำกัดความสัมพันธ์ให้ตรงผู้รับนั้น
const q = await save(5300, { recipient_name: field('ผู้รับ Q') }, { status: 'draft' });
eq(q.suggestions.supplier_payee_relation.value, 'platform', 'ความสัมพันธ์ตามคู่ร้าน-ผู้รับที่กรอกอยู่');
ok(!q.suggestions.recipient_name || q.suggestions.recipient_name.source !== 'remembered_pair', 'ไม่เสนอผู้รับอื่นทับ');

// validation ของ remembered_pair
memoryBill(5400, 'ร้านเนื้อ ก');
const remember = (key, value, evidence) => save(5400, { [key]: field(value, 'remembered_pair', evidence) }, { status: 'draft' });
const good = await remember('recipient_name', 'นายเจ้าของ เนื้อ', [{ item_id: 5001 }, { item_id: 5002 }]);
ok(!good.error, `บันทึกจากประวัติได้ ${good.error}`);
eq(good.fields.recipient_name.source, 'remembered_pair', 'เก็บ source ประวัติ');
await rejects(save(5400, { recipient_name: field('นายเจ้าของ เนื้อ', 'remembered_pair', [{ item_id: 5003 }]) }, { revision: good.revision, status: 'draft' }), 'assist_evidence_mismatch', 'ร่างที่ไม่ได้ตรวจแล้วไม่ใช่หลักฐานของประวัติ');
await rejects(save(5400, { recipient_name: field('ชื่อมั่ว', 'remembered_pair', [{ item_id: 5001 }]) }, { revision: good.revision, status: 'draft' }), 'assist_evidence_mismatch', 'ค่าต้องตรงกับประวัติจริง');
await rejects(save(5400, { purpose: field('ค่าผัก', 'remembered_pair', [{ item_id: 5001 }]) }, { revision: good.revision, status: 'draft' }), 'source_invalid', 'ช่อง purpose ไม่อยู่ในประวัติ');
await rejects(save(5400, { recipient_account_masked: field('xxx-x-x9999-x', 'remembered_pair', [{ item_id: 5001 }]) }, { revision: good.revision, status: 'draft' }), 'source_invalid', 'ห้ามใช้ประวัติเติมเลขบัญชี');

// --- รายชื่อสำหรับ autocomplete ---
addItem(6001, 'bill', { status: 'unsent' });
raw.prepare(`INSERT INTO capture_expense_profiles(item_id,revision,status,fields_json,updated_by,updated_at) VALUES(6001,1,'draft',?,'x',?)`)
  .run(JSON.stringify({ supplier_name: field('ร้านที่ถูกยกเลิก'), recipient_account_masked: field('xxx-x-x0000-x') }), now);
const options = await api.getExpenseProfileOptions();
const suppliers = options.suppliers.map((entry) => entry.value);
ok(suppliers.includes('ร้านเนื้อ ก') && suppliers.includes('ร้านผักสด'), 'มีชื่อร้านจาก profile');
ok(!suppliers.includes('ร้านที่ถูกยกเลิก'), 'ไม่รวมเอกสารที่ถูกยกเลิก');
eq(options.suppliers.find((entry) => entry.value === 'ร้านเนื้อ ก'), { value: 'ร้านเนื้อ ก', count: 3, reviewed: 2 }, 'นับจำนวนและจำนวนที่ตรวจแล้ว');
ok(options.recipients.some((entry) => entry.value === 'นายเจ้าของ เนื้อ') && options.banks.some((entry) => entry.value === 'ธนาคารกรุงไทย'), 'มีผู้รับและธนาคาร');
eq(Object.keys(options).sort(), ['banks', 'recipients', 'suppliers'], 'ไม่คืนช่องบัญชีหรือหมายเหตุ');
ok(!/xxx|\d{5,}/u.test(JSON.stringify(options)), 'รายชื่อต้องไม่มีเลขบัญชี');

// อ่านทั้งหมดต้องไม่แตะ capture_items/capture_matches
for (const id of [3600, 3624, 3700, 3800, 3900, 4000, 5100, 5200, 5300]) await read(id);
const afterItems = JSON.stringify(raw.prepare('SELECT * FROM capture_items WHERE id IN (3600,3624,3700,3724,3800,3824) ORDER BY id').all());
eq(afterItems, JSON.stringify(JSON.parse(beforeItems).filter((row) => [3600, 3624, 3700, 3724, 3800, 3824].includes(row.id))), 'ไม่แก้เอกสาร');
eq(JSON.stringify(raw.prepare('SELECT * FROM capture_matches WHERE id<=3 ORDER BY id').all()), beforeMatches, 'ไม่แก้คู่เอกสาร');
console.log(`expense profile assist backend OK (${checks} checks)`);
