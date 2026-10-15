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
  ocr: { status: "none"|"pending"|"done"|"failed", model|null, confidence|null, warnings: [code...] },
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
9. `POST /:id/void` body `{ reason }` (admin หรือเจ้าของเอกสารภายในวันเดียวกันตามเวลาไทยของ `confirmed_at`) → ย้อน `received_quantity`, `quantity`, `actual_price`, `receive_notes` ที่เอกสารนี้ตั้งไว้ + inventory reverse (หากใบสั่งถูกแก้ไขต่อหลังจากเอกสารนี้ยืนยันแล้ว จะปฏิเสธด้วย `409 NOT_DRAFT`)
10. `GET /:id/images/:imageId` → รูป (binary) ตามสิทธิ์

### ตัวเลือกที่ server v1 รองรับอยู่แล้วสำหรับ client
- Admin ใช้ `branch_id` และ `department_id` กับ `GET /expected`, `GET /` และ `POST /` เพื่อเลือกพื้นที่รับสินค้าได้; client ส่งทั้งสองค่าให้ตรงกัน ส่วนผู้ใช้ทั่วไปใช้พื้นที่จากบัญชีเสมอ
- `PUT /:id` รองรับ `lines[].unit_multiplier` แบบ optional (มากกว่า 0 ไม่เกิน 10000): ถ้าไม่ส่งจะเก็บตัวคูณเดิมไว้ เมื่อเลือกสินค้าใหม่เป็นหน่วยฐาน client ส่ง `1` เพื่อไม่สืบทอดตัวคูณ alias ของสินค้าเดิม ฟิลด์นี้ยังไม่อยู่ใน response ของ v1
- รูปที่ส่งด้วย `page_no` เดิมจะทับหน้าเดิมแบบ upsert จึงใช้ลองส่งซ้ำหลังเน็ตหลุดได้ ไม่มี endpoint ลบหน้า; client ให้ลบ/เรียงเฉพาะรูปที่ยังไม่เริ่มส่ง และตรึงเลขหน้าก่อนส่งทั้งชุด

## Warning codes
`SUM_MISMATCH` (ผลรวมบรรทัด ≠ subtotal/total เกิน 1 บาท) · `TOTAL_EQUATION_MISMATCH` (subtotal − discount + vat ≠ total เกิน 1 บาท; ตรวจเมื่อมี subtotal และ total โดย discount/vat ที่ว่างถือเป็น 0) · `PRICE_CHANGE` (ราคาต่างราคาล่าสุด > 15%) · `QTY_SHORT` / `QTY_OVER` (เทียบที่สั่ง) · `UNMATCHED_LINE` · `DUPLICATE_BILL` (supplier+doc_ref+total ซ้ำภายในสาขาเดียวกัน) · `LOW_CONFIDENCE`

- OCR ที่พบ `SUM_MISMATCH` หรือ `TOTAL_EQUATION_MISMATCH` จะมี confidence ไม่เกิน 0.6 และ `LOW_CONFIDENCE` โดยตรวจซ้ำหลังรวมบรรทัดที่ผู้ใช้แก้เอง
- ถ้าเอกสารผูก `order_item_ids` ระบบจะส่งชื่อ/หน่วย/จำนวนที่สั่งเฉพาะรายการที่ผูกและอยู่ในสาขา/แผนกเดียวกันเป็นข้อมูลประกอบ OCR (ไม่ส่งราคาจากแค็ตตาล็อก) บรรทัดที่ไม่มีราคา/เขียน X จะมีจำนวน 0 พร้อม `LOW_CONFIDENCE` และ `QTY_SHORT` เมื่อเทียบกับจำนวนที่สั่ง; บรรทัดที่ OCR ตกหล่นยังคงไว้ด้วยจำนวน 0 และราคา/ยอดว่าง โดยไม่ทับบรรทัดที่ผู้ใช้แก้เอง
- ค่าเริ่มต้นโมเดล OCR คือ `gpt-5.6-terra`; override ตามลำดับ `RECEIVING_OCR_MODEL`, `OPENAI_OCR_MODEL`, `OPENAI_MODEL` ได้เหมือนเดิม

## Error codes
`VALIDATION_FAILED` 422 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `NOT_DRAFT` 409 · `SIGNATURE_REQUIRED` 422 · `RATE_LIMITED` 429 · `OCR_UNAVAILABLE` 503 · `RECEIVING_NOT_READY` 503 · `IMAGE_TOO_LARGE` 413

## ขั้นตอนเตรียมฐานข้อมูลก่อนขึ้น Production (Deployment / Migration)
- ในโหมด `NODE_ENV=production` เซิร์ฟเวอร์จะไม่รัน `CREATE TABLE` / `ALTER TABLE` อัตโนมัติใน request แรก (เว้นแต่ตั้ง `AUTO_ENSURE_RECEIVING_TABLES=true`) และหากตารางยังไม่ถูกสร้าง API จะตอบ `503 RECEIVING_NOT_READY`
- ก่อนเปิดใช้งานบน Production ให้รันคำสั่งสร้างตารางใหม่แบบแยกต่างหาก (ไม่แก้ตารางเดิมของระบบ):
  ```sh
  npm --prefix server run migrate:receiving-documents
  ```
