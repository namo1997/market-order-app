# Receiving documents API (สัญญากลางระหว่าง server กับแอป) — v1

ฐาน: `/api/receiving-documents` ใน market order server · Auth: JWT Bearer เดิม (`authenticate`) · ผู้ใช้เห็น/แก้ได้เฉพาะสาขา/แผนกของตัวเอง เว้นแต่ admin
ทุกยอดเงินเป็น string ทศนิยม 2 ตำแหน่ง ("1234.50"); จำนวนเป็น string ทศนิยมสูงสุด 2 ตำแหน่งตามคอลัมน์ `DECIMAL(10,2)` ของระบบ (ตัดศูนย์ท้าย เช่น `"10"`, `"2.5"`, `"1.25"`); วันที่ `YYYY-MM-DD` เวลา Bangkok
ทุก response: `{ success: true, data }` หรือ `{ success: false, code, message }` (HTTP 4xx/5xx) — code ภาษาอังกฤษ, message ภาษาไทย

## Objects

ReceivingDocument
```
{ id, status: "draft"|"confirmed"|"void", branch_id, department_id,
  supplier_master_id|null, product_group_id|null, supplier_name_text,
  delivery_date, doc_ref|null, doc_date|null, kind: "bill"|"manual_receipt",
  subtotal|null, discount|null, vat|null, total|null,
  ocr: { status: "none"|"pending"|"done"|"failed", model|null, confidence|null,
    doc_kind: "bill"|"slip"|"other"|null,
    line_sum_proposal: "1234.50"|null, unreadable_line_count: integer|null, warnings: [code...] },
  receiver_user_id, receiver_name, courier_name|null,
  has_receiver_signature, has_courier_signature,
  images: [{ id, page_no, mime, width, height }],
  lines: [ReceivingLine], warnings: [{code, message, line_no|null}],
  created_at, updated_at, confirmed_at|null, client_uuid }
```
ReceivingLine
```
{ id, line_no, bill_text, product_id|null, product_name|null, order_item_id|null,
  unit_text|null, unit_id|null, quantity_billed|null, quantity_received,
  unit_price|null, amount|null, match: { source: "alias"|"order"|"manual"|"none", confidence|null } }
```

## Endpoints

1. `GET /expected?date=YYYY-MM-DD` → ของที่ควรมาวันนี้ จาก order_items ของสาขา/แผนกผู้ใช้ จัดกลุ่มตาม supplier/product group:
   `[{ supplier_key, supplier_name, items:[{ order_item_id, product_id, product_name, unit_name, quantity_ordered, received_quantity|null, is_received }] }]`
2. `POST /` body `{ client_uuid, delivery_date, kind, supplier_master_id?, product_group_id?, supplier_name_text?, order_item_ids?: [] }` → ReceivingDocument (draft). `client_uuid` ซ้ำ = คืนเอกสารเดิม (idempotent สำหรับคิวออฟไลน์)
3. `POST /:id/images` body `{ page_no, image_data_url }` (jpeg/webp ≤ 3 MB หลังย่อ) → `{ image_id }`
4. `POST /:id/ocr` → เริ่มอ่านบิลทุกหน้า (sync ได้ถ้า ≤ 60s) → ReceivingDocument ที่เติม header + lines + match + warnings แล้ว; ไม่ทับบรรทัดที่ผู้ใช้แก้เองแล้ว
5. `GET /:id` → ReceivingDocument · `GET /?date=&status=` → รายการ (ไม่มี lines)
6. `PUT /:id` body `{ header fields..., lines: [ReceivingLine without id → สร้าง, with id → แก้] , deleted_line_ids: [] }` → เฉพาะ draft
7. `POST /:id/signatures` body `{ role: "receiver"|"courier", image_data_url (png) , name? }`
8. `POST /:id/confirm` → ต้องมี receiver signature, ≥1 line ที่ quantity_received > 0, ทุก line มี product_id (หรือ flag `unmatched_ok` สำหรับ manual_receipt) → ใน transaction เดียว:
   - อัปเดต `order_items` ที่ผูกแบบ **บวกสะสม** (`received_quantity = COALESCE(prev_received_quantity, 0) + quantity_received`), `actual_price` = ราคาต่อหน่วยฐาน (`base_unit_price`), `is_received`, `received_by_user_id`, `received_at` (รองรับหลายบิลต่อใบสั่งเดียวกันโดยไม่ทับยอดบิลก่อนหน้า)
   - บรรทัดที่ผูก `order_item_id` แต่มี `quantity_received = 0` จะถูกข้ามการอัปเดต `order_items` เพื่อไม่ให้ล้างยอดรับเดิม และบันทึกคำเตือน `QTY_SHORT`
   - เพิ่ม `inventory_transactions` ผ่านตรรกะรับของเดิม (`updateOrderItemReceivingWithInventory` รองรับทั้งรับปกติและโอนคลังภายใน)
   - บันทึก/อัปเดต `supplier_product_aliases` และประวัติ `supplier_product_alias_events` จากบรรทัดที่ยืนยัน (เมื่อมี `supplier_key` ที่ไม่ใช่ `none`)
   - `status=confirmed`, audit
   → ReceivingDocument
9. `POST /:id/void` body `{ reason }` (admin หรือเจ้าของเอกสารภายในวันเดียวกันตามเวลาไทยของ `confirmed_at`) → ใน transaction เดียว ล็อกเอกสารและแถวใบสั่ง (`FOR UPDATE`) แล้วลบเฉพาะ delta จำนวนที่เอกสารนี้บวกไว้จาก `received_quantity` ปัจจุบันและย้อนคลังเท่ากัน (รวมโอนคลังภายใน); เช่น บิลแรก 2.25 + บิลสอง 3.50 = 5.75 → void บิลแรกเหลือ 3.50 และบิลสองยัง confirmed
   - การรับบิลหลังหรือแก้ราคา/หมายเหตุภายหลังไม่ทำให้ void ถูกปฏิเสธ: คงราคา/หมายเหตุของบิลหลังหรือค่าที่แก้เอง คืน snapshot ก่อนหน้าเฉพาะเมื่อหมายเหตุปัจจุบันยังชี้เอกสารที่ void และราคายังตรงค่าที่เอกสารนั้นตั้ง; ปรับ snapshot ของบิลถัดไปเพื่อไม่ให้ void ภายหลังดึงราคา/หมายเหตุของบิลที่ void แล้วกลับมา
   - ไม่ลด `quantity` ที่สั่ง; คืนค่าเฉพาะ quantity ที่เติมอัตโนมัติจากค่าก่อนหน้า ≤ 0 เมื่อรับคงเหลือเป็น 0 และค่าไม่ถูกแก้ต่อ; `is_received` คำนวณใหม่ผ่าน receiving เดิมสำหรับยอดคงเหลือ
   - ปฏิเสธ `409 NOT_DRAFT` ถ้าย้อนแล้วจำนวนรับ/คลังติดลบ หรือใบสั่งถูกยกเลิก (รวมกรณีรายการใบสั่งหาย); void ซ้ำได้ 409 โดยไม่ย้อนซ้ำ สิทธิ์/validation เดิมยังบังคับใช้
   - alias และประวัติการเรียนรู้จาก confirm คงไว้เป็นหลักฐาน ไม่ลบเมื่อ void; order/คลัง/snapshot/audit/status ต้อง commit หรือ rollback พร้อมกัน
10. `GET /:id/images/:imageId` → รูป (binary) ตามสิทธิ์

### ตัวเลือกที่ server v1 รองรับอยู่แล้วสำหรับ client
- Admin ใช้ `branch_id` และ `department_id` กับ `GET /expected`, `GET /` และ `POST /` เพื่อเลือกพื้นที่รับสินค้าได้; client ส่งทั้งสองค่าให้ตรงกัน ส่วนผู้ใช้ทั่วไปใช้พื้นที่จากบัญชีเสมอ
- `PUT /:id` รองรับ `lines[].unit_multiplier` แบบ optional (มากกว่า 0 ไม่เกิน 10000): ถ้าไม่ส่งจะเก็บตัวคูณเดิมไว้ เมื่อเลือกสินค้าใหม่เป็นหน่วยฐาน client ส่ง `1` เพื่อไม่สืบทอดตัวคูณ alias ของสินค้าเดิม ฟิลด์นี้ยังไม่อยู่ใน response ของ v1
- รูปที่ส่งด้วย `page_no` เดิมจะทับหน้าเดิมแบบ upsert จึงใช้ลองส่งซ้ำหลังเน็ตหลุดได้ ไม่มี endpoint ลบหน้า; client ให้ลบ/เรียงเฉพาะรูปที่ยังไม่เริ่มส่ง และตรึงเลขหน้าก่อนส่งทั้งชุด

## Warning codes
`SUM_MISMATCH` (ผลรวมบรรทัด ≠ subtotal/total เกิน 1 บาท) · `TOTAL_EQUATION_MISMATCH` (subtotal − discount + vat ≠ total เกิน 1 บาท; ตรวจเมื่อมี subtotal และ total โดย discount/vat ที่ว่างถือเป็น 0) · `PRICE_CHANGE` (ราคาต่างราคาล่าสุด > 15%) · `QTY_SHORT` / `QTY_OVER` (เทียบที่สั่ง) · `UNMATCHED_LINE` · `DUPLICATE_BILL` (supplier+doc_ref+total ซ้ำภายในสาขาเดียวกัน) · `LOW_CONFIDENCE` · `TOTAL_MISSING_LINE_SUM` · `NOT_A_BILL`

- G1: เมื่อภาพไม่มียอดรวม `total` ยังเป็น null ไม่เติมจากผลรวมบรรทัดโดยอัตโนมัติ; `ocr.line_sum_proposal` เป็น string 2 ตำแหน่ง คำนวณผลรวมเฉพาะจำนวนเงินบรรทัดที่อ่าน/คำนวณได้ด้วยสตางค์จำนวนเต็ม (ไม่หัก discount/บวก vat เพราะเป็นเพียงผลรวมบรรทัด); ถ้าไม่มีจำนวนเงินที่อ่านได้เป็น null และเตือน `TOTAL_MISSING_LINE_SUM` เมื่อมีบรรทัด ผลรวมอาจไม่ครบ ห้ามใช้เป็นยอดยืนยันโดยอัตโนมัติ
- `ocr.unreadable_line_count` นับบรรทัด OCR ที่ไม่มีชื่อหรือไม่สามารถหายอดบรรทัดได้ รวมแถวที่ถูกกรอง/เกินขอบเขต; ไม่ใช่จำนวนบรรทัดที่ทราบว่าตกหล่นจากภาพ ข้อมูลนี้และข้อเสนอเป็น snapshot ผล OCR เดิม แม้ผู้ใช้แก้ total/รายการเองภายหลัง
- G2: schema/prompt OCR ต้องคืน `doc_kind` = bill (รวมใบสั่งตลาด), slip หรือ other; ค่าขาด/ผิด enum ถูก normalize เป็น other อย่างระมัดระวัง และเตือน `NOT_A_BILL` เมื่อไม่ใช่ bill หรืออ่านได้ 0 บรรทัด (จึงอาจหมายถึงภาพบิลที่อ่านไม่ออกด้วย); เอกสารยังเป็น draft ให้ผู้ใช้ตรวจสอบ `kind` ของ ReceivingDocument ยังเป็น bill/manual_receipt เช่นเดิม
- metadata G1/G2 เก็บใน `receiving_documents.ocr_result_json` และคืนเหมือนกันผ่าน OCR, GET, list และ image-hash cache; เอกสารเก่าที่ยังไม่มี metadata คืน null ทั้งสามฟิลด์ ต้องใช้ migration เดิมเพื่อเพิ่มคอลัมน์แบบ additive/idempotent ก่อนเปิดเวอร์ชันนี้ ไม่แก้ตารางเดิม order/inventory
- OCR ที่พบ `SUM_MISMATCH` หรือ `TOTAL_EQUATION_MISMATCH` จะมี confidence ไม่เกิน 0.6 และ `LOW_CONFIDENCE` โดยตรวจซ้ำหลังรวมบรรทัดที่ผู้ใช้แก้เอง
- ถ้าเอกสารผูก `order_item_ids` ระบบจะส่งชื่อ/หน่วย/จำนวนที่สั่งเฉพาะรายการที่ผูกและอยู่ในสาขา/แผนกเดียวกันเป็นข้อมูลประกอบ OCR (ไม่ส่งราคาจากแค็ตตาล็อก) บรรทัดที่ไม่มีราคา/เขียน X จะมีจำนวน 0 พร้อม `LOW_CONFIDENCE` และ `QTY_SHORT` เมื่อเทียบกับจำนวนที่สั่ง; บรรทัดที่ OCR ตกหล่นยังคงไว้ด้วยจำนวน 0 และราคา/ยอดว่าง โดยไม่ทับบรรทัดที่ผู้ใช้แก้เอง
- ค่าเริ่มต้นโมเดล OCR คือ `gpt-6.1-sol`; override ตามลำดับ `RECEIVING_OCR_MODEL`, `OPENAI_OCR_MODEL`, `OPENAI_MODEL` ได้เหมือนเดิม
- ตระกูล `gpt-<n>` เมื่อ n ≥ 5 และ o-series ไม่ส่ง `temperature` และใช้ `max_completion_tokens=65536`; โมเดลเก่าใช้ `temperature=0.1` และ `max_completion_tokens=16384`
- ถ้า provider ตอบ HTTP 400 ระบุว่าไม่รองรับ `temperature`, `max_tokens` หรือ `max_completion_tokens` ที่ส่งจริง จะลองซ้ำได้เพียงครั้งเดียวโดยตัดพารามิเตอร์นั้น (หากตัดเพดาน token จะใช้ค่าเริ่มต้นของ provider); คง model/messages/strict schema และใช้ timeout รวมเดิม ไม่ลองซ้ำสำหรับ error อื่น และไม่ส่ง raw provider error กลับ client

## Error codes
`VALIDATION_FAILED` 422 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `NOT_DRAFT` 409 · `SIGNATURE_REQUIRED` 422 · `RATE_LIMITED` 429 · `OCR_UNAVAILABLE` 503 · `RECEIVING_NOT_READY` 503 · `IMAGE_TOO_LARGE` 413

## ขั้นตอนเตรียมฐานข้อมูลก่อนขึ้น Production (Deployment / Migration)
- ในโหมด `NODE_ENV=production` เซิร์ฟเวอร์จะไม่รัน `CREATE TABLE` / `ALTER TABLE` อัตโนมัติใน request แรก (เว้นแต่ตั้ง `AUTO_ENSURE_RECEIVING_TABLES=true`) และหากตารางยังไม่ถูกสร้าง API จะตอบ `503 RECEIVING_NOT_READY`
- ก่อนเปิดใช้งานบน Production ให้รันคำสั่งสร้างตารางใหม่แบบแยกต่างหาก (ไม่แก้ตารางเดิมของระบบ):
  ```sh
  npm --prefix server run migrate:receiving-documents
  ```
