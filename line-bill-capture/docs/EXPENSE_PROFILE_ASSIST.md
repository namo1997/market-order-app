# ข้อมูลสำหรับค่าใช้จ่าย — ระยะ 2: ช่วยลดงานซ้ำ (2026-10-06)

สถานะ: Local branch `lbc/phase2-expense-assist` ยังไม่ deploy ไม่แตะ Production ข้อเสนอทั้งหมดเป็น *ข้อเสนอ* ผู้ใช้ต้องกดใช้และกดบันทึกเอง ไม่แก้ยอด คู่เอกสาร เงินสด ปิดวัน หรือ Mobile V3 และไม่ส่งออกบัญชี

## ความสามารถ

1. **เอกสารคู่** (`source = paired_document`): เมื่อบิลกับสลิปมี `capture_matches.status='confirmed'` และอีกใบมี profile (ร่างหรือตรวจแล้ว; ตรวจแล้วมาก่อน แล้วล่าสุด) ระบบเสนอค่าของใบนั้นในใบนี้ ทุกช่องยกเว้น `notes` (หมายเหตุเป็นคำอธิบายเฉพาะเอกสาร) ข้อเสนอจากเอกสารเอง (OCR/แชท) ชนะเอกสารคู่ จับคู่ที่ยัง pending/manual_review หรือเอกสาร unsent/duplicate ไม่ถูกใช้
2. **ใช้ข้อเสนอทั้งหมด**: เติมเฉพาะช่องที่ว่าง (ทั้งร่างและค่าที่บันทึกไว้) และมองเห็นอยู่ ไม่ทับค่าที่กรอก ข้ามช่องที่ระยะ 1 ย่อไว้ (หมวดที่เป็น `details.expense-profile-collapsed` ซึ่งปิดอยู่) ประเมิน `transaction_type` ก่อนแล้ว render ใหม่ จึงตามผลการย่อ/ขยาย ลงร่างเท่านั้น ไม่บันทึก
3. **รายชื่อให้เลือก**: `GET /api/admin/expense-profile-options` (อ่านอย่างเดียว ผ่าน auth `/api/admin`) คืน `{suppliers, recipients, banks}` ของ `{value,count,reviewed}` สูงสุด 300 รายการต่อชนิด จาก `capture_expense_profiles` ของเอกสารที่ไม่ใช่ unsent/duplicate ไม่มีเลขบัญชีหรือหมายเหตุ ใช้ `<datalist>` ของ browser
4. **จำคู่ร้าน-ผู้รับ** (`source = remembered_pair`): จาก profile ที่ `reviewed` ของเอกสารอื่นเท่านั้น จับคู่ชื่อแบบไม่สนช่องว่าง/ตัวพิมพ์ รู้ร้านเสนอผู้รับ+ธนาคาร+ความสัมพันธ์ รู้ผู้รับเสนอร้าน+ความสัมพันธ์ รู้ทั้งคู่เสนอความสัมพันธ์/ธนาคาร ถ้ามีหลายคู่คะแนนเท่ากันไม่เดา ไม่จำเลขบัญชี (แม้ปิดบังแล้ว)

## กฎ validation ของ source ใหม่ (`validateAssistedEntry`)

- ใช้ได้เฉพาะ entry ที่มี key `value/source/evidence` เท่านั้น (schema เดิม) evidence เป็น `{item_id}` ของ *เอกสารอื่น* 1–8 รายการ ห้าม `message_id` ห้ามอ้างตัวเอง
- `paired_document`: ต้องมีแถวใน `capture_matches` ระหว่างสองรายการ (สถานะใดก็ได้ในอดีต) และค่านั้นเคยอยู่ใน revision ของเอกสารอ้างอิง (revision เป็น immutable จึงตรวจย้อนหลังได้ — ค่าที่บันทึกไว้แล้วจึงผ่านซ้ำทุกฉบับถัดไปแม้ต้นทางแก้ภายหลัง) ช่อง `notes` ใช้ไม่ได้
- `remembered_pair`: เฉพาะ `supplier_name, recipient_name, recipient_bank, supplier_payee_relation` และค่าต้องเคยอยู่ใน revision สถานะ `reviewed` ของเอกสารอ้างอิง
- เลขบัญชีต้องปิดบังเหลือไม่เกิน 4 หลักเสมอ (ตรวจก่อนถึงส่วน assist) ข้อเสนอที่มีค่าไม่ปิดบังจะไม่ถูกส่งออก
- รหัสผิดพลาดใหม่: `paired_document_not_linked`, `assist_evidence_mismatch` (HTTP 400 ข้อความทั่วไปเดิม)

## ไฟล์

ใหม่: `src/expense-profile-assist.js`, `public/expense-profile-assist.js` (โหลดก่อน `expense-profile.js`), `scripts/expense-profile-assist-test.mjs`, `scripts/expense-profile-assist-ui-test.mjs`, `scripts/expense-assist-flow-test.mjs` (`npm run expense:assist:flow`, ต้องมี fixture จาก `expense-desktop-preview.mjs` บน SSD)
จุดเชื่อมในไฟล์ร่วม: `src/expense-profile.js` (import, `SOURCES`, ท้าย `suggestionsFor`, ก่อน loop evidence ใน `validateFields`), `src/db.js` (import + `getExpenseProfileOptions`), `src/server.js` (import + route options), `public/expense-profile.js` (ป้ายที่มา + `ExpenseProfileAssist.attach(...)` ท้าย IIFE), `public/index.html` (script tag), `package.json`

## ความสัมพันธ์กับระยะ 1

ไม่คัดลอกโค้ดระยะ 1 `ใช้ข้อเสนอทั้งหมด` ตรวจช่องที่ซ่อนจาก DOM จึงทำงานได้ทั้งก่อนและหลังรวมระยะ 1 (ก่อนรวม: ไม่มีช่องที่ซ่อน) flow test ตรวจส่วน "ข้ามช่องที่ซ่อน" เฉพาะเมื่อพบ `expenseProfileRequirements` ถ้าระยะ 1 เปลี่ยนชื่อ class/โครง `details.expense-profile-collapsed` ต้องปรับ `hidden()` ใน `public/expense-profile-assist.js`
