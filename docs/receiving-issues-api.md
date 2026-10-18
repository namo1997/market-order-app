# ระบบติดตามปัญหารับของ (Local implementation)

ใช้ `/api/receiving-issues` และ auth Bearer เดิม ทุกคำตอบ JSON เป็น `{success:true,data:...}`; รูปตอบ binary พร้อม `private, no-store` / `nosniff` ทุก endpoint ต้อง login (401 เมื่อหาย/ผิด/หมดอายุ)

## ข้อมูลและสิทธิ์

แยก `receiving_issues` จาก followups เพราะหนึ่งปัญหามีวงจรชีวิต ทางจบ หลักฐาน และประวัติของตน ส่วน followup เป็นเพียงการเตือนหนึ่งกำหนดตาม ไม่ใช่ตัวปิดเรื่องบัญชี

พนักงานสร้าง/อ่านเรื่องและเอกสารต้นทางของสาขาตนได้ทุกแผนก; แนบหลักฐานได้เฉพาะเรื่องประเภท return ของสาขาตน บัญชี (`accounting`, `accountant`) และผู้ดูแล (`admin`, `super_admin`) จัดการทุกสาขาได้ ใช้ role/scope จาก auth เดิม ห้ามส่ง branch/supplier/status ของเอกสารมาแทนข้อมูลต้นทาง API นี้ไม่เปลี่ยนสิทธิ์ API เอกสารรับสินค้าเดิม

- type: `shortage|damaged|wrong_item|return|over`
- status: `open → waiting_supplier → resolved|cancelled`; เปิดแล้วปิดโดยตรงได้ ไม่ย้อน waiting กลับ open; terminal แก้ไม่ได้
- resolution: `redelivered|new_bill|credit_note|returned|written_off`
- quantity / amount / resolution_amount ส่ง decimal string ไม่เกิน 2 ตำแหน่ง (สูงสุด 9999999999.99), quantity > 0; ราคาอัตโนมัติคง 6 ตำแหน่งแล้วคำนวณ BigInt ปัด half-up ครั้งเดียวต่อบรรทัดเป็นสตางค์
- due_at ต้องเป็น ISO timestamp มี offset; API คืน UTC (`Z`), UI แสดง/รับเวลา Asia/Bangkok
- client_uuid: `[A-Za-z0-9_-]{8,100}`, prefix `auto-` สงวนให้ระบบ; คำขอเดิมซ้ำได้ผลเดิม/200 ต่าง payload หลักตอบ409
- version: positive integer จากเรื่องล่าสุด ต้องส่งทุกครั้งที่ PUT เพื่อกัน lost update

## Endpoints

| Method / path | คำขอ / ผลลัพธ์ |
|---|---|
| GET `/` | query `status=pending` (default), `all` หรือสถานะหนึ่ง; `type`, `supplier` ชื่อร้าน, `branch_id`, `min_age_days` 1–3650, `overdue=true`, `before_id`; คืน `{items,next_before_id}` หน้าไม่เกิน100 แถว |
| GET `/assignees` | บัญชี/ผู้ดูแลเท่านั้น; `{items:[{id,name}]}` ผู้ใช้งานบัญชี/ผู้ดูแลที่ active สูงสุด200 |
| GET `/documents/:documentId` | ข้อมูลอ้างอิงเอกสาร `{id,status,branch_id,department_id,supplier_name_text,lines:[{id,line_no,bill_text}]}`; ใช้ scope ของปัญหา ไม่ขยายสิทธิ์รูปต้นฉบับ |
| GET `/:id` | เรื่องพร้อม `evidence` metadata และ `history`; ไม่ส่งรูป/ลายเซ็น base64 |
| POST `/` | `{client_uuid,document_id,line_id?,type,product_name?,quantity,amount?,note?,due_at?}`; เอกสารต้อง confirmed, line ต้องเป็นของเอกสารนี้; source/supplier/branch มาจาก DB; คืน `{issue,created}` 201 หรือ200เมื่อซ้ำ; due default อีก24ชั่วโมง |
| PUT `/:id` | บัญชี/ผู้ดูแล; `{version,status?,owner_user_id?,due_at?,note?,resolution?,resolution_amount?,resolution_ref?}`; `owner_user_id=null` ยกเลิกมอบหมาย; ผู้รับผิดชอบต้อง active และเป็นบัญชี/ผู้ดูแล; คืน issue ล่าสุด |
| POST `/:id/evidence` | `{client_uuid,image_data_url,collector_name?,signature_data_url?,note?}`; JPG/WebP ไม่เกิน3MiB ตรวจ magic bytes, signature PNG ไม่เกิน3MiB, สูงสุด10ชุด/เรื่อง; return ต้องมีชื่อคนรับคืน; รูป+ลายเซ็น+ชื่อ+audit บันทึก transaction เดียว; คืน `{id,created}` 201/200; UUID เดิมข้อมูลเปลี่ยน409 |
| GET `/:id/evidence/:evidenceId?kind=image` | `kind=image|signature`; binary ต้องเป็นหลักฐานของเรื่องนี้ และอ่านได้ตามสาขา/role |

PUT resolved ต้องเลือก resolution; new_bill/credit_note ต้องมี resolution_ref, returned ต้องมีรูปพร้อมชื่อผู้รับคืน, written_off ต้องมี note; cancelled ต้องมีเหตุผลใน note ไม่มีการแก้ order/inventory/AP จากการปิดปัญหาหรือบันทึกคืนของ **การรับของส่งตามและตัดคลังคืนยังใช้ workflow เดิมแยกต่างหาก**

Error: 401 auth, 403 ไม่มีสิทธิ์, 404 ไม่พบเรื่อง/เอกสาร/บรรทัด/หลักฐาน, 409 `NOT_DRAFT` สถานะผิด/ปิดแล้ว/versionเก่า/UUIDต่างข้อมูล, 422 `VALIDATION_FAILED`, 413 `IMAGE_TOO_LARGE`, 503 `RECEIVING_NOT_READY` ตารางยังไม่พร้อม, 500 `INTERNAL_ERROR` ข้อความทั่วไปไม่คืน SQL/stack Parser จำกัด16KiBสำหรับmetadata และ9MiBเฉพาะ evidence route หลัง auth

## Confirm และการเตือน

Confirm เดิมบันทึก `issue_candidates` ใน confirm audit เดียวกับ transaction เดิม โดยคำนวณจากจำนวนสั่งที่ยังค้างก่อนรับ (`ordered - previously received`, ต่ำสุด0) ของบรรทัด linked; บรรทัดไม่มี order ใช้ billed เมื่อรู้จำนวน ไม่เดาจาก null สร้าง shortage/over ต่อ physical line จำนวนที่รับเป็น0ยังสร้าง shortage ได้ การคำนวณ candidates ล้มเหลวไม่ทำให้ confirm ล้มเหลว

หลัง commit/release เรียกสแกนแบบไม่รอผล มี key `auto-document-line-type` และ lock บนเอกสารเพื่อกันซ้ำ Cron นาทีละครั้งตามเก็บเฉพาะเอกสารยืนยันที่มี `issue_candidates` ใน audit และยังไม่มี scan marker จึงไม่เปิดปัญหาย้อนหลังให้ทุกเอกสารเก่า หากสแกนบางบรรทัดล้มเหลว รอบถัดไปใช้ audit frozen เดิมและทำส่วนที่เหลือต่อ ไม่เติมยอดคลังซ้ำ

เรื่องเลยกำหนดสร้าง followup เดิมพร้อม pending item `issue_id`; unique `(issue_id,due_at)` + row lock กันแจ้งซ้ำข้าม worker/อุปกรณ์ เมื่อปิด/ยกเลิก/เลื่อนกำหนด จะปิด followup เก่าใน transaction เดียวกัน กำหนดใหม่เตือนได้อีกครั้ง เรื่องเดิมเตือนหนึ่งครั้งต่อกำหนดและคงในรายการค้างจนปิด ไม่แจ้งทุกนาที/ทุกวัน

ใช้ in-app inbox/poll + push/WorkManager ที่มีอยู่ ไม่เรียก LINE/Discord ไม่เพิ่มบริการเสียเงิน Push/inboxเดิมยังจำกัดสาขาของผู้รับตามสัญญาเดิม; บัญชีดู/จัดการปัญหาข้ามสาขาผ่านหน้าปัญหาได้ แต่อุปกรณ์ไม่ได้รับ push ข้ามสาขาโดยอัตโนมัติ ต้องจัดบัญชีประจำสาขาตามระบบเดิม

## Schema และ release

ตารางใหม่5ตาราง: receiving_issues, receiving_issue_evidence, receiving_issue_history, receiving_issue_reminders, receiving_issue_scans; CREATE TABLE IF NOT EXISTS ทั้งหมด ไม่แก้ schema orders/inventory รัน `node server/scripts/migrate-receiving-issues.js` **เฉพาะในขั้น release ที่เจ้าของอนุมัติภายหลัง** (ยังไม่ได้รันกับฐานจริง) Production auto-ensure ปิดตามกติกาเดิม

หน้า `/admin/receiving/issues` มีตาราง/มือถือ กรองประเภท ร้าน สาขา อายุ และสถานะ; พนักงานเข้าหน้านี้ได้แต่สิทธิ์ API บังคับสาขาและซ่อนการปิดเรื่อง แอปรับสินค้ามีทางเข้าแยกจากหน้าตรวจรายการ ยังไม่เชื่อม AP และยังไม่ใช่หลักฐานตรวจรับ APK เครื่องจริง
