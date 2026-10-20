# ใบรับของจากตลาดสด → หลักฐาน AP (Local)

สัญญา `CONTRACT-receiving-ap-export-v1.md` วันที่ 20 ต.ค. 2569 ฝั่งรับ A2. ดึงทางเดียวด้วย GET เท่านั้น ไม่มีการเรียก API จ่ายเงิน, OpenAI, LINE, Discord หรือเขียนข้อมูลกลับตลาดสด

## การตั้งค่าและสิทธิ์

- `MARKET_RECEIVING_EXPORT_URL` คือ URL เต็มที่ลงท้าย `/api/receiving-export/ap/v1/documents` (ไม่ใช่เพียง base URL) ไม่มี query, fragment หรือ userinfo. ใช้ HTTPS; HTTP อนุญาตเฉพาะ loopback สำหรับ mock
- `MARKET_RECEIVING_EXPORT_TOKEN` ใช้บน server ใน Authorization header เท่านั้น ไม่ส่งให้ client ไม่เก็บใน sync run/history/audit/error. งานนี้ไม่สร้าง/อ่าน `.env` หรือค่าลับ และไม่ได้ตั้งค่าจริง
- ไม่ตั้งค่าครบ/URL ไม่ผ่าน → `configured:false`, ปุ่ม “ดึงใบรับของ” ปิด, POST ตอบ 503 `RECEIVING_DISABLED` ก่อนเปิด DB. ยังอ่านหลักฐานเก่าที่มีได้
- `GET /api/ap/receiving/status`, `GET /api/ap/receiving/documents?month=YYYY-MM&branch=SK`, `POST /api/ap/receiving/sync` ใช้ authenticate + `report:pnl` admin เดิมทั้งหมด. POST ผ่าน human decision เดิมเมื่อเปิดบังคับ และบันทึก audit ที่มี integer run ID ใน transaction เดียวกับหลักฐาน
- preview/offline UI ปิดการดึงโดยตรง. local-preview server เดิมปฏิเสธ mutation เช่นเดิม. การเปิดหน้า AP ไม่เริ่ม sync อัตโนมัติ; ดึงเฉพาะกดปุ่ม
- GET documents กรองตาม **เดือนวันรับของ** ไม่ใช่เดือนบัญชี และไม่ต้องมี AP batch ของเดือนนั้น จึงตรวจใบรับของได้แม้รายงานบัญชีเดือนนั้นยังไม่ import

## Schema และการนำเข้า

`migrateAp(connection)` ใน `ap/schema.js` รวม DDL ใหม่ `CREATE TABLE IF NOT EXISTS` สามตาราง ไม่มี ALTER/DELETE ตารางเดิม และไม่ลงทะเบียนใน startup migration:

- `ap_receiving_sync_runs`: สถานะ RUNNING/SUCCEEDED/FAILED, cursor ที่เกิดข้อผิดพลาด, updated_since/watermark, hash ของ URL ต้นทาง, จำนวนที่อ่าน/เปลี่ยน, public error code และเวลา
- `ap_receiving_documents`: current state ตาม market document_id, JSON ที่คัดฟิลด์, SHA-256, status, match/link และ run อ้างอิง
- `ap_receiving_history`: append ทุกการเปลี่ยนเอกสาร/ผลจับคู่, previous_hash และ run. void ไม่ลบแถวเก่า ไม่สร้าง journal reversal เพราะ importer นี้ไม่เคยสร้าง posting

การเตรียม schema ต้องผ่าน workflow AP เดิมบนฐาน offline SSD และ release workflow ที่เจ้าของอนุมัติในภายหลัง งานนี้ไม่ execute migration หรือเชื่อม MySQL จริง. HTTP sync ไม่รัน DDL และ GET แจ้ง `schemaReady:false` เมื่อยังไม่มีตาราง

Sync serialize ด้วย MySQL named lock; fetch/ตรวจทุกหน้าก่อนเริ่ม transaction. ตรวจ version=1, typed fields, ISO date/time, integer satang, null unknown, ขนาดต่อหน้าไม่เกิน 8 MiB, 500 documents และสูงสุด 100 หน้า พร้อมกัน cursor วน. ไม่มี redirect เพื่อไม่ส่ง Authorization ไปปลายทางอื่น

ใช้ watermark เฉพาะ run SUCCEEDED ของ URL เดียวกัน และ replay ย้อน 1 วินาทีเพื่อไม่พลาดแถวที่ updated_at เท่ากัน. Failed run ไม่ขยับ watermark; cursor เก็บเพื่อวิเคราะห์ ไม่ resume จากหน้าที่ล้มเหลว. นำเข้ารอบถัดไปเริ่มจาก watermark สำเร็จเดิม. เอกสารเก่ากว่าที่เก็บจะถูกละไว้; timestamp เท่ากันแต่เนื้อหาต่างหยุด `RECEIVING_REVISION_CONFLICT`. revision ใหม่กลับเป็นเนื้อหาเดิมได้ตามประวัติใหม่

Current state + history + run success + audit commit พร้อมกัน. history/audit ล้มเหลว rollback หลักฐานทั้งชุด แล้วบันทึก run FAILED แยก. Failed run จึงไม่อ้างจำนวนเปลี่ยนที่ commit แล้ว. ข้อมูล raw OCR, รูป และฟิลด์บัญชี/เลขภาษี/โทรศัพท์ผู้ขายไม่อยู่ใน allowlist

## จับคู่และ ledger เป็นแหล่งจริง

1. เฉพาะสาขาเดียวกัน จับผู้ขายด้วย AP code หรือชื่อ normalize; ถ้าทั้งสองมี code แต่ขัดกัน แม้ชื่อตรงก็รอตรวจ
2. เลขบิลตรง (trim/NFKC/ไม่แยกตัวใหญ่เล็ก), **วันบิลที่ระบุจริง** ต่างไม่เกิน 3 วัน และยอดเต็มบิลต่างไม่เกิน 100 สตางค์
3. ตรงรายการเดียว → `LINKED` ผูก source key LBC โดยไม่สร้างรายการซ้ำ. หลาย LBC หรือหลายใบรับของอ้าง LBC เดียว → `REVIEW` และไม่ผูกลิงก์อัตโนมัติ
4. ขาดเลข/วันบิล/ราคา, no_bill หรือข้อมูลที่มีไม่ตรง → `REVIEW`; ไม่พบผู้ขายใน LBC ชุดที่นำเข้า → `NO_LBC` และยังรอตรวจสมุดรับจ่าย. ไม่ใช่ข้อสรุปว่าไม่มีบิลใน LBC ทั้งระบบ
5. statement_only → `REFERENCE` ไม่มีการซื้อ; void → `VOID` และ linked_source_key เป็น null. เมื่อ void ใบซ้ำที่ขัดกัน ใบที่เหลือจับคู่ใหม่ได้
6. ประเด็น open issue ยังคง `reviewRequired:true` แม้จับบิลได้. รายงานอ่านแสดง match ปัจจุบันจาก LBC ทุกครั้งภายใน read transaction; sync ถัดไปเก็บประวัติการเปลี่ยนลิงก์ด้วย

LBC เดิมไม่เก็บเลขและวันบิลใน AP snapshot. เพิ่ม optional allowlist จาก export ที่มี `doc_ref`, `doc_date` หรือ `invoice_date`, `ap_code` เท่านั้น ผ่าน pnl snapshotItems → raw_json ที่คัดแล้ว → AP compileSnapshot (`docRef/docDate/apCode`). ไม่เดาเลขจาก description และไม่ใช้วันจ่าย/วันรอบแทนวันบิล. Export รุ่นเก่าที่ไม่มีข้อมูลเหล่านี้ยังใช้ได้โดยแสดงรอตรวจ; ต้องเพิ่มข้อมูล explicit ที่ LBC export แยกก่อนจะจับคู่อัตโนมัติจากข้อมูลจริงได้ งานนี้ไม่แก้ฝั่ง LBC

**ไม่มีการเขียน ap_journals/ap_journal_lines/ap_period_controls, P&L, ยอดยกมา หรือยอดจ่าย**. มูลค่ารับของแสดงแยกจากยอดบิล; ไม่บวกเข้า purchases/closing/aging และไม่เปลี่ยน completeness ให้เป็นครบจากการ sync. เจ้าของยังยึดสมุดรับจ่ายเป็นแหล่งจริงก่อนลงบัญชี

วันครบกำหนดเป็นข้อมูลประกอบจาก `dueDate()` เดิม: รับ 1–15 → 20, รับ 16–สิ้นเดือน → 5 เดือนถัดไป. `periodMonth:null` เสมอจนมีการตรวจ: กฎเดิมระบุ **วันจ่าย 5–6** ของซัพเครดิตเป็นเดือนก่อน แต่สัญญารวมกล่าวถึงวันที่ 1–10 ซึ่งยังไม่ชัดว่าหมายถึงวันจ่ายหรือวันเอกสาร จึงไม่ขยายกฎเอง. ข้อเสนอให้เจ้าของกำหนดข้อยกเว้นรายซัพพร้อมหลักฐานก่อนเพิ่ม human decision สำหรับ posting/เดือนบัญชีในงานถัดไป

## UI และ validation

หน้า AP มีส่วน “หลักฐานซื้อ · ใบรับของ” แยกจากยอดบัญชี แสดงตรงกับ LBC/รอตรวจ/ไม่มีใน LBC/void/ใบวางบิล, วันที่รับ/วันบิล/กำหนดจ่าย, ราคา unknown, เดือนบัญชีรอตรวจ และลิงก์ `/admin/receiving/documents/<id>` ที่สร้างจาก origin ที่ตั้งไว้เท่านั้น. ใช้ theme tokens เดิม, ปุ่ม/ลิงก์/disclosure ใหม่ ≥48px และเรียงคอลัมน์เดียวบนมือถือ

รันจาก source snapshot บน SSD โดยตั้ง TMPDIR/TMP/TEMP และ npm_config_cache บน SSD และไม่โหลดค่าลับ:

```sh
node --test test/apReceiving.test.js
npm test # server
npm test # client
npm run build # client
```

ทดสอบครอบคลุม HTTP mock จริงบน loopback (ไม่มีบริการตลาดสด), pagination/replay/void/ambiguity/unknown, SQL transaction model + audit rollback, guards และ React UI. Model ไม่ทดแทนการ execute DDL บน MySQL จริง. ผลสองรอบและข้อจำกัด sandbox ดู REPORT.md บน SSD ของงาน A2; ไม่เรียก server suite ว่าผ่านหาก mock listener ถูก EPERM
