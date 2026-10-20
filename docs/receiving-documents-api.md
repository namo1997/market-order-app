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
    doc_kind: "bill"|"slip"|"other"|"unknown"|null,
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
  unit_price|null, amount|null, match: { source: "alias"|"order"|"manual"|"none"|"ai", confidence|null } }
```

## Endpoints

1. `GET /expected?date=YYYY-MM-DD` → คิวจำนวนค้างของสาขา/แผนกผู้ใช้ ตั้งแต่วันที่เลือกย้อนหลัง 7 วันจนถึงวันที่เลือก (รวมปลายทั้งสองด้าน) จัดกลุ่มตาม supplier/product group:
   `[{ supplier_key, supplier_name, items:[{ order_item_id, product_id, product_name, unit_name, quantity_ordered, received_quantity|null, is_received }] }]`
2. `POST /` body `{ client_uuid, delivery_date, kind, supplier_master_id?, product_group_id?, supplier_name_text?, order_item_ids?: [], resume_draft?: boolean }` → ReceivingDocument (draft). `client_uuid` ซ้ำ = คืนเอกสารเดิม (idempotent สำหรับคิวออฟไลน์)
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
   - ปฏิเสธ `409 NOT_DRAFT` ถ้าย้อนแล้วจำนวนรับในใบสั่งติดลบ หรือใบสั่งถูกยกเลิก (รวมกรณีรายการใบสั่งหาย); void ซ้ำได้ 409 โดยไม่ย้อนซ้ำ สิทธิ์/validation เดิมยังบังคับใช้
   - คลังติดลบไม่บล็อก void: ย้อน inventory transaction ตามจำนวนจริงทั้งรายการผูกใบสั่ง/ไม่ผูก/โอนคลังภายใน โดยไม่ clamp ยอดเป็น 0; ถ้ายอดสุดท้ายของสินค้า/แผนกที่ void นี้เปลี่ยนมีค่าติดลบ ให้เพิ่ม `INVENTORY_NEGATIVE_AFTER_VOID` หนึ่งครั้งใน `warnings` ของเอกสาร (`line_no: null`) และเก็บใน `warnings_json` เพื่อคืนผ่าน GET/list ด้วย พร้อม `details_json.warnings: ["INVENTORY_NEGATIVE_AFTER_VOID"]` ใน audit action `void` (ถ้าไม่มีคลังที่เปลี่ยนติดลบเป็น `[]`); warning/audit/status/ledger commit หรือ rollback พร้อมกัน ไม่ใส่ warning นี้ใน `ocr.warnings` เพราะไม่ได้เกิดจาก OCR
   - alias และประวัติการเรียนรู้จาก confirm คงไว้เป็นหลักฐาน ไม่ลบเมื่อ void; order/คลัง/snapshot/audit/status ต้อง commit หรือ rollback พร้อมกัน
10. `GET /:id/images/:imageId` → รูป (binary) ตามสิทธิ์
11. `GET /:id/signatures/:role` (`role` = `receiver` หรือ `courier`) → ภาพลายเซ็น PNG (binary ไม่มี JSON envelope), `Content-Type: image/png`, `Cache-Control: private, no-store`; ใช้ JWT และสิทธิ์สาขา/แผนกเดียวกับ GET images (admin/super_admin อ่านข้ามพื้นที่ได้) อ่านได้ทั้ง draft/confirmed/void โดยไม่เปลี่ยนสถานะหรือ audit
    - ไม่มี/ผิด/หมดอายุ JWT → 401 ตาม auth เดิม; ข้ามสาขาหรือแผนก → `403 FORBIDDEN`; เอกสารหายหรือไม่มีลายเซ็นของ role นั้น → `404 NOT_FOUND`; role ไม่ถูกต้องหรือ id ผิดรูปแบบ → `422 VALIDATION_FAILED`
    - ไม่ส่งภาพใน GET document/list และไม่บันทึกข้อมูลภาพลง log; client โหลดผ่าน authenticated API เป็น Blob และคืน object URL เมื่อเลิกใช้ ไม่เก็บลายเซ็นใน browser storage

### ตัวเลือกที่ server v1 รองรับอยู่แล้วสำหรับ client
- Admin ใช้ `branch_id` และ `department_id` กับ `GET /expected`, `GET /` และ `POST /` เพื่อเลือกพื้นที่รับสินค้าได้; client ส่งทั้งสองค่าให้ตรงกัน ส่วนผู้ใช้ทั่วไปใช้พื้นที่จากบัญชีเสมอ
- `PUT /:id` รองรับ `lines[].unit_multiplier` แบบ optional (มากกว่า 0 ไม่เกิน 10000): ถ้าไม่ส่งจะเก็บตัวคูณเดิมไว้ เมื่อเลือกสินค้าใหม่เป็นหน่วยฐาน client ส่ง `1` เพื่อไม่สืบทอดตัวคูณ alias ของสินค้าเดิม ฟิลด์นี้ยังไม่อยู่ใน response ของ v1
- รูปที่ส่งด้วย `page_no` เดิมจะทับหน้าเดิมแบบ upsert จึงใช้ลองส่งซ้ำหลังเน็ตหลุดได้ ไม่มี endpoint ลบหน้า; client ให้ลบ/เรียงเฉพาะรูปที่ยังไม่เริ่มส่ง และตรึงเลขหน้าก่อนส่งทั้งชุด

## Warning codes
`DOC_DATE_INVALID`: วันที่ OCR อ่านไม่ได้หรือไม่มีผู้สมัครในช่วง 180 วันก่อนถึง 7 วันหลัง `delivery_date` (รวมขอบเขต) คืน `doc_date: null` พร้อมข้อความ "วันที่ในบิลอ่านไม่ได้/ผิดปกติ กรุณาตรวจ" ผ่าน `ocr.warnings` และ `warnings` ระดับเอกสาร รวม GET/list/image-hash cache; เก็บใน metadata เดิม ไม่เพิ่ม schema DB และไม่ทับวันที่ที่คนแก้เอง คำเตือนเป็นหลักฐานผล OCR แม้แก้ header ภายหลัง

- OCR ใช้วันรับของเป็นจุดอ้างอิง ไม่ใช้เวลาปัจจุบัน: แปลง พ.ศ. 4 หลักด้วย −543; ปี พ.ศ. ย่อ 2 หลัก หรือ 19xx/20xx ที่ตีความปี พ.ศ. ย่อผิด จะลองศตวรรษ พ.ศ. ใกล้วันรับของ โดยคงเลขสองหลักท้าย วัน และเดือนเดิม เลือกได้เมื่อมีผู้สมัครในช่วงเพียงวันเดียวเท่านั้น ปี ค.ศ. ที่อยู่ในช่วงคงเดิม; ไม่มีปีให้ลองปีก่อน/ปีรับของ/ปีถัดไปในช่วงเดียวกัน
- ตัวอย่าง `2009-09-16` กับวันรับ `2026-10-18` คืน null + `DOC_DATE_INVALID`: ไม่สามารถพิสูจน์ว่า 09 คือ 69 จึงไม่เดาเป็น 2026; `2569-09-16`, `2069-09-16`, `1969-09-16` แก้เป็น `2026-09-16` ได้ ผลเก่าที่อยู่ใน cache ก่อนใช้กติกานี้ไม่ถูกแก้ย้อนหลังหรือเรียก OCR ใหม่อัตโนมัติ

`SUM_MISMATCH` (ผลรวมบรรทัด ≠ subtotal/total เกิน 1 บาท) · `TOTAL_EQUATION_MISMATCH` (subtotal − discount + vat ≠ total เกิน 1 บาท; ตรวจเมื่อมี subtotal และ total โดย discount/vat ที่ว่างถือเป็น 0) · `PRICE_CHANGE` (ราคาต่างราคาล่าสุด > 15%) · `QTY_SHORT` / `QTY_OVER` (เทียบที่สั่ง) · `UNMATCHED_LINE` · `DUPLICATE_BILL` (supplier+doc_ref+total ซ้ำภายในสาขาเดียวกัน) · `LOW_CONFIDENCE` · `TOTAL_MISSING_LINE_SUM` · `NOT_A_BILL` · `DOC_KIND_UNCERTAIN` · `INVENTORY_NEGATIVE_AFTER_VOID` (ยอดคลังที่ void เปลี่ยนมีค่าติดลบ เป็น warning ไม่ใช่ error)

- G1: เมื่อภาพไม่มียอดรวม `total` ยังเป็น null ไม่เติมจากผลรวมบรรทัดโดยอัตโนมัติ; `ocr.line_sum_proposal` เป็น string 2 ตำแหน่ง คำนวณผลรวมเฉพาะจำนวนเงินบรรทัดที่อ่าน/คำนวณได้ด้วยสตางค์จำนวนเต็ม (ไม่หัก discount/บวก vat เพราะเป็นเพียงผลรวมบรรทัด); ถ้าไม่มีจำนวนเงินที่อ่านได้เป็น null และเตือน `TOTAL_MISSING_LINE_SUM` เมื่อมีบรรทัด ผลรวมอาจไม่ครบ ห้ามใช้เป็นยอดยืนยันโดยอัตโนมัติ
- `ocr.unreadable_line_count` นับบรรทัด OCR ที่ไม่มีชื่อหรือไม่สามารถหายอดบรรทัดได้ รวมแถวที่ถูกกรอง/เกินขอบเขต; ไม่ใช่จำนวนบรรทัดที่ทราบว่าตกหล่นจากภาพ ข้อมูลนี้และข้อเสนอเป็น snapshot ผล OCR เดิม แม้ผู้ใช้แก้ total/รายการเองภายหลัง
- G2: schema/prompt OCR ยังคงขอ `doc_kind` = bill (รวมใบสั่งตลาด), slip หรือ other; ผลที่ขาด/null/ผิด enum ถูก normalize เป็น `unknown` ไม่ถือว่า provider ระบุ other โดยชัดแจ้ง (ค่าผิด enum ยังลด confidence ตาม schema validation เดิม); `unknown` เป็นค่า fallback ของ server และรับซ้ำได้ เอกสารยังเป็น draft ให้ผู้ใช้ตรวจสอบ `kind` ของ ReceivingDocument ยังเป็น bill/manual_receipt เช่นเดิม
- `NOT_A_BILL` ใช้เมื่อไม่มีบรรทัดที่ผ่าน normalization เลย ไม่ว่าประเภทใด (รวม bill/unknown และแถวว่างที่ถูกกรองทั้งหมด); บรรทัดที่ใช้ได้ในที่นี้คือแถวที่ผ่านตัวกรองเดิม มีชื่อสินค้า หรือยอด/จำนวนที่อ่านได้ ไม่จำเป็นต้องจับคู่สินค้าในแค็ตตาล็อกแล้ว
- ถ้า provider ระบุ slip/other โดยชัดแจ้งแต่ยังมีบรรทัดที่ใช้ได้ ให้ `DOC_KIND_UNCERTAIN` แทน `NOT_A_BILL`: เป็นคำเตือนระดับอำพันให้ตรวจภาพ/รายการก่อนยืนยัน ไม่ใช่สถานะอ่านรายการไม่ได้; warning object ใช้ `{code, message, line_no: null}` ตามเดิม ไม่มีฟิลด์สีเพิ่มใน API
- Custom OCR provider ที่ไม่ส่ง `doc_kind` ใช้ fallback `unknown`; ถ้ามีรายการจะไม่เตือน `NOT_A_BILL` หรือ `DOC_KIND_UNCERTAIN` จากการขาดฟิลด์เพียงอย่างเดียว และต้องบันทึก OCR สำเร็จได้ (ไม่ใช่ `500 INTERNAL_ERROR`)
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

## ตรวจหลังอ่านบิล v2 (additive, ยังไม่ติดตั้งฐานจริง)
- `bill_text`/provider `text` เป็นข้อความดิบตามภาพเท่านั้น ห้ามใช้ expected_items หรือ product_name แทน; provider ส่ง `suggested_product_name` และ `suggestion_reason` แยก (nullable string จำกัด 255 อักขระ)
- จับคู่ตามลำดับ alias ร้านเดียวกันที่ข้อความดิบ normalized ตรงกัน → ชื่อสินค้าตรง → ข้อเสนอ AI ที่ชื่ออยู่ในรายการ → ไม่จับคู่ ไม่มี fuzzy alias ข้ามร้าน
- `match.source=ai` เป็นข้อเสนอ confidence ไม่เกิน 0.4; confirm คืน 422 VALIDATION_FAILED จนคนยืนยันเป็น manual; ไม่เปลี่ยนสูตรจำนวน/ราคา
- `lines[].suggested_product_name`, `suggestion_reason`, `bill_read: { quantity_billed, unit_price, amount }` เป็น optional response metadata เก็บใน ocr_result_json; bill_read คือค่าที่อ่านได้ก่อนคำนวณเติมช่องว่าง ค่า null แปลว่าไม่พบในภาพ ห้ามใช้ยอดคำนวณมาอ้างว่า AI อ่านได้
- `ocr.raw_read: { doc_date, total, line_count } | null` เก็บสรุปผลอ่านเดิมแยกจาก header ที่คนแก้; GET/list/OCR cache คืนค่าเดียวกัน เอกสารเก่าไม่มีหลักฐานนี้คืน null
- `lines[].remember_alias` เป็น boolean optional ใน PUT/response ค่าเริ่มต้น true (คงพฤติกรรมเดิม) false ไม่เรียนรู้ alias จากบรรทัดนั้นตอน confirm; ไม่เปลี่ยน inventory/order transaction และกฎ admin/ผู้ยืนยันต่างคนเดิม
- ใช้ migration `server/scripts/migrate-receiving-documents.js` เดิมในขั้น release ที่ได้รับอนุมัติ เพื่อเพิ่ม remember_alias BOOLEAN DEFAULT true และขยาย enum match_source โดยต่อท้าย ai แบบ idempotent; ไม่แตะตาราง order/inventory และไม่รัน migration ฐานจริงในงานนี้


## คิวข้ามวันและตามของ (17 ต.ค. 2026)
- `GET /expected` คง `supplier_key`, `supplier_name`, `items` และทุกฟิลด์เดิม; คัดเฉพาะ quantity_ordered > received_quantity โดยไม่ใช้ is_received ตัดของขาดออก (ในคิวจึงคืน is_received=false) รวม submitted/confirmed/completed เท่านั้น
- เพิ่ม group `{branch_id, department_id, lead_days, due_date, due_status, status, has_partial, overdue_days}` และ item `{order_date, due_date, due_status, remaining_quantity}`; จำนวนค้างเป็น string สองตำแหน่ง คงสูตรเงินเดิม
- `due_date = order_date + lead_days`; ร้านที่มีหลายใบสั่งใช้วันควรถึงที่เก่าสุดของรายการค้าง; due_status = overdue/due_today/upcoming; status ให้ overdue > due_today > partial > upcoming (partial ใช้เมื่อมีรับแล้วและยังไม่ถึงกำหนด); has_partial ยังแสดงข้อเท็จจริงการรับบางส่วนแม้ overdue
- config `RECEIVING_QUEUE_LOOKBACK_DAYS` จำนวนเต็ม 1–90 ค่าเริ่ม 7 (ผิดรูปแบบใช้ 7); ร้านในคิวนี้คือ product_group (`pg:<id>`); การตั้ง lead time ใช้ key เดียวกับร้าน ไม่สร้าง mapping supplier_master ซ้ำ
- expected วันที่ปัจจุบันตาม Asia/Bangkok สร้างเรื่อง overdue ผ่านกลไกเดิมทั้งเมื่อเปิดแอปและจาก job แจ้งเตือนบน server ทุก 60 วินาที; date preview ย้อนหลังไม่สร้างเรื่อง เก็บ snapshot เฉพาะรายการเลยกำหนด

ฐานใหม่ `/api/receiving-followups` ใช้ JWT authenticate เดิมก่อนอ่าน JSON (จำกัด 8kb):

บัญชี/accountant อ่าน list/count และ PATCH เฉพาะสาขาของตน (ไม่มีสาขาตอบ 403); admin/super_admin คงขอบเขตดูแลเดิม ส่วนแจ้งเตือนเบื้องหลังและรายละเอียดจาก push จำกัดสาขาของผู้รับทุกบทบาท ดูสัญญา `/api/receiving-push` และขั้นตอนตั้งค่าใน [push-setup.md](push-setup.md)
- `POST /` สำหรับผู้รับในสาขา/แผนกตนเอง หรือ admin ที่เลือก scope: `{supplier_key, branch_id?, department_id?, note?: string<=300}`; ไม่รับรายการค้างจาก client แต่โหลดจากคิวจริงฝั่ง server; ไม่พบร้านค้าง 404, ข้าม scope 403, input ผิด 422
- ผล 201 เมื่อสร้าง / 200 เมื่อซ้ำ: `{created, followup, message}`; ซ้ำร้านและสาขา/แผนกเดียวกันภายใน 60 นาทีแบบ sliding window (รวมรายการอัตโนมัติ/ปิดแล้ว) คืนเรื่องเดิม; ใช้ transaction กับ scope row lock ข้าม worker
- `GET /?status=open|acknowledged|resolved|pending` เฉพาะ admin/super_admin/accounting/accountant; pending = open+acknowledged; คืน `{items:[Followup], pending_count, notification:{channel:"in_app",version:1}}` ไม่เกิน 200 เรื่องล่าสุด แต่ pending_count นับทุกเรื่องค้าง
- Followup: `{id,supplier_key,supplier_name,branch_id,department_id,pending_items,actor_user_id,actor_name,note,source:"manual"|"overdue",status,created_at,updated_at,updated_by_user_id}`; timestamps UTC ISO มี Z, UI แสดง Asia/Bangkok; auto_key เป็น internal marker
- `PATCH /:id` `{status:"acknowledged"|"resolved"}` เฉพาะบัญชี/admin; 404 ไม่พบ, 422 input ผิด, 409 NOT_DRAFT เมื่อพยายามเปิดเรื่องที่ปิดแล้ว; ส่งสถานะเดิมซ้ำสำเร็จ 200
- `GET /lead-times` เฉพาะบัญชี/admin คืน `{items:[{supplier_key,lead_days}]}`; `PUT /lead-times/:supplierKey` เฉพาะ admin/super_admin `{lead_days:0..90}` ค่า default 0; 404 ไม่มี product_group, 422 input ผิด, 403 ไม่มีสิทธิ์
- ทุก endpoint ใหม่ตอบ 401 เมื่อ credential ไม่มี/ผิด/หมดอายุ; ไม่ส่ง SQL/stack กลับ client; JSON เสียตอบ 422 และ body >8kb ตอบ 413 REQUEST_TOO_LARGE; ไม่มีบริการภายนอก
- อัตโนมัติบันทึก marker ต่อชุด order_item_id ที่เลยกำหนด เพื่อไม่สร้างซ้ำทุก refresh/ทุกวัน แม้เรื่องเดิมปิดแล้ว; รับของครบแล้วเรื่องเดิมยังให้บัญชีปิดเอง เก็บประวัติไว้
- ผู้ดูแลตั้ง lead_days ในตัวเลือก → วันส่งของแต่ละร้าน (ร้านที่มีในคิว); ร้านอื่นตั้งผ่าน endpoint ได้
- กระดิ่งในหน้ารับสินค้าเฉพาะบัญชี/admin โหลดเมื่อเปิด/กลับเข้าแอปและทุก 30 วินาที; รับทราบยังนับค้างจนปิดเรื่อง ไม่ใช่ Web Push

### เตรียม schema แบบ additive (ยังไม่รันบนฐานจริง)
นอกจาก migration receiving-documents เดิม ต้องเตรียมตารางใหม่ก่อนปล่อยเวอร์ชันนี้ โดย operator รันจาก server ที่ระบุสภาพแวดล้อมแล้ว:
```sh
node --input-type=module -e "import pool from './src/config/database.js'; import {ensureQueueTables} from './src/models/receiving-queue-schema.js'; try { await ensureQueueTables(pool,{force:true}); } finally { await pool.end(); }"
```
สร้างเฉพาะ receiving_supplier_leads / receiving_followup_locks / receiving_followups ด้วย CREATE TABLE IF NOT EXISTS; ไม่มี ALTER ตารางเดิม; production ไม่ auto ensure เว้นแต่เปิด AUTO_ENSURE_RECEIVING_TABLES ตามกติกาเดิม หากยังไม่เตรียมตารางตอบ 503 RECEIVING_NOT_READY

## ใบรับทั้งสาขา (scope=branch)

- `GET /expected`, `GET /` และ `POST /` รับ `scope: "department" | "branch"` (query สำหรับ GET, body สำหรับ POST); default `department` คงสิทธิ์แผนกเดิม
- สิทธิ์ branch เหมือนเมนู `/api/orders/receiving?scope=branch`: ทุกบัญชีที่ authenticate และมีสาขา (route เดิมใช้ authenticate ไม่มี role gate) ใช้ได้ในสาขาของบัญชี; admin/super_admin เลือก `branch_id` ได้ ต้องมีสาขาเมื่อใช้ branch ไม่มีการเปิดสิทธิ์เอกสารแบบแผนกของแผนกอื่น
- branch ไม่ใช้ `department_id` กรอง expected/list; POST ของ admin ไม่ต้องส่งแผนก ระบบเลือกแผนกแรกของสาขาเป็น header anchor เพื่อคง schema NOT NULL เดิม แต่การเข้าคลังใช้แผนกเจ้าของ order_item แต่ละรายการ
- expected คืนหนึ่ง group ต่อร้านต่อสาขา, `scope:"branch"`, `department_id:null`; สินค้ารหัสและหน่วยเดียวกันรวมหนึ่ง item พร้อม `order_item_ids`, `remaining_quantity`, `departments:[{department_id,department_name,quantity_ordered,received_quantity}]` และยอดสั่ง/รับรวม รวมบริบทแผนกที่รับครบแล้วของสินค้าที่แผนกอื่นยังค้าง เพื่อรักษาฐานสัดส่วนเดิม วันที่ overdue ใช้เฉพาะรายการที่ค้าง
- สร้างใบเดียวด้วย `scope:"branch"`, `order_item_ids` ของทุกรายการที่เลือกร้านเดียวกัน; ไม่รับรายการว่างหรือหลายร้าน (422) เก็บ physical lines ต่อ order_item เพื่อใช้ transaction/snapshot/inventory/void เดิม; response รวมเป็นหนึ่งบรรทัดต่อสินค้า+หน่วย มี `departments:[{order_item_id,department_id,department_name,quantity_ordered,quantity_received}]` และ document `scope`
- จำนวนเริ่มต้นของใบใหม่เป็นยอดค้างแต่ละรายการ (ไม่รับซ้ำยอดเดิม); การแก้ **จำนวนรับของใบนี้** เป็นยอดรวมจะแบ่งตามสัดส่วนจำนวนที่สั่งเดิมเหมือน legacy ทั้งรับขาดและรับเกิน ใช้จำนวนเต็ม 1/100 และ largest remainder ให้ผลรวมตรงยอดที่กรอก กรณีเศษเท่ากันให้ order_item_id น้อยก่อน; ถ้าฐานสั่งรวมเป็นศูนย์แบ่งเท่ากัน ยอดยืนยันบวกสะสมกับที่รับไว้แล้วตาม lifecycle receiving-documents (legacy update เป็นยอดสะสมทับเดิม)
- `PUT /:id` ใช้ id บรรทัดรวมที่ server คืนมา ส่งยอดรวมปกติ ไม่รับ allocation จาก client; server กระจายจำนวนบิล/จำนวนรับ/amount พร้อมกันใน transaction เดียว ห้ามสร้าง/relink สินค้า หน่วย หรือ order_item ใหม่ในใบสาขา (422) ลบ anchor จะลบ physical lines ของสินค้านั้นทั้งหมด
- จำนวนที่ไม่ได้ส่งใน PUT คง allocation เดิม; client ส่งเฉพาะบรรทัด/จำนวน/ราคาที่เปลี่ยน จึงไม่กระจายยอดค้างใหม่เมื่อแก้เลขบิลหรือราคาอย่างเดียว ยอดเงินเริ่มต้นรวมค่ารายแผนกก่อนปัดสตางค์ครั้งเดียว; PUT ที่ส่ง `amount:null` คำนวณยอดรวมจากจำนวนและราคาก่อนกระจายสตางค์ตามจำนวนบิล (หรือจำนวนรับ) พร้อม largest remainder เพื่อไม่เพิ่ม/หายหนึ่งสตางค์จากการปัดหลายแผนก
- confirm เรียก `updateOrderItemReceivingWithInventory` เดิมทุก order_item (รวม internal transfer) ใน transaction เดียว บันทึก alias ครั้งเดียวต่อบรรทัดรวม; void ย้อน delta/snapshot ตามรายการเดิมทุกแผนก หากแผนกเจ้าของ order เปลี่ยนหลังรับ ให้ตรวจสอบก่อน (409) แทนย้อนผิดคลัง; กฎ owner+วันเดียวกันหรือ admin ยังคงเดิม
- `client_uuid` ยังคง unique ทั้งระบบ; retry UUID เดิมข้ามแผนกในสาขาเดียวกันคืนใบเดิม และ UUID ที่ใช้ข้าม receiving scope/สาขาตอบ 409 ไม่มี unique ร้านตลอดวัน เพราะร้านเดียวส่งได้หลายเที่ยว/หลายบิล
- read/update/image/signature/confirm/void อนุญาตบัญชีที่มี branch scope ในสาขาเอกสารเท่านั้น; ต่างสาขา 403, ไม่ login 401 ตาม middleware เดิม ทุก query ใช้ placeholder
- `POST /:id/ocr` รองรับใบ `scope=branch` ที่เป็น draft และผู้ใช้มีสิทธิ์สาขาเดียวกัน (admin ตามสิทธิ์เดิม); ต่างสาขา 403/ไม่พบ 404/สถานะไม่ใช่ draft หรือกำลังอ่าน 409/ไม่มีรูป 422 ก่อนเรียก provider ใช้ provider เดิมทั้งจริงและ pilot Codex พร้อม schema validation, hash cache, quota และ atomic claim เดิม ไม่รับ expected_items/known_aliases/allocation จาก client
- expected_items OCR ใช้เฉพาะ order_item ที่ผูกใบนี้ในสาขา รวมสินค้า+หน่วยเป็นบรรทัดเดียวและรวม quantity_ordered; ไม่มีราคาในบริบท และ known_aliases เฉพาะ supplier เดียวกัน จับคู่ผลอ่านกับบรรทัดรวมก่อนใช้ expandBranchUpdate/receiving-branch-policy กระจายจำนวนบิล/สตางค์ตามสัดส่วนสั่งเดิม โดยคงจำนวนรับที่นับไว้ ไม่ลบหรือสร้าง physical lines ใหม่ คง ID/branch_weight/แผนกให้ confirm/void ใช้ transaction เดิม
- ผล OCR ที่จับคู่ไม่ได้ สินค้าซ้ำ หรือหน่วยกำกวม/ไม่ตรง ตอบ 422 VALIDATION_FAILED โดยไม่เปลี่ยนยอดบรรทัดและเปลี่ยนสถานะ OCR เป็น failed ให้แก้ยอดรวมเอง; รายการเดิมที่ไม่ได้อ่านพบตั้งจำนวนบิล/ราคาเป็น null และคงจำนวนรับให้ตรวจ ไม่ใช้ยอดสั่งยืนยันแทนของจริง; บรรทัดที่คนแก้แล้วคงทั้งกลุ่มสินค้า+หน่วย และ header ที่คนแก้ยังคงเดิม
- เว็บ `/receiving` และแอปที่ใช้ Receiving/BranchDocumentEditor ร่วมกันเปิดปุ่ม “อ่านบิลด้วย AI” ต้องบันทึก/ส่งรูปที่ค้างให้เสร็จและนับครบก่อนอ่าน แสดงผลรวม/แยกแผนก/ข้อความบิล/คำเตือนและให้คนตรวจ; AI suggestion ต้องกด “ยืนยันจับคู่” เป็น manual ก่อน confirm ตามกติกาเดิม กรณีเพิ่มของที่ไม่มีใบสั่งใช้โหมดแผนก; manual followup ของคิว branch ยังไม่เปิด แต่ automatic overdue ยังคงส่งแยกแผนก
- schema additive เฉพาะ receiving tables: `receiving_documents.receiving_scope`, `receiving_document_lines.branch_weight`, `branch_department_id`, `branch_department_name`; เพิ่ม index `(branch_id, receiving_scope, delivery_date)` แบบตรวจชื่อก่อนเพิ่ม และใช้ index document/line เดิม ไม่มี ALTER ตาราง order/inventory เดิม ไม่มี migration Production ในงานนี้

## แนว A: นับของจริงก่อนเปิดบิล (2026-10-18)

ใช้ร่วมกันทั้ง `department` และ `branch` และทุก role รวม admin ใน receiving API เท่านั้น
ลำดับ APK: บิล (ถ่าย/อัปโหลดได้ แต่ปิด preview) → นับของ → เทียบบิล → สรุปก่อนเซ็น → เซ็นรับ
ใบ confirmed/void เดิมอ่านได้ตามสิทธิ์เดิม; draft เก่าที่ยังไม่มีหลักฐานนับต้องนับใหม่ทั้งใบ ไม่ใช้ OCR หรือจำนวนสั่งเป็นหลักฐานย้อนหลัง

### `POST /:id/count`

ต้อง authenticate และผ่าน `assertDocumentAccess` เดิม; ใช้ `client_uuid` เดียวกับเอกสาร:

```json
{"client_uuid":"same-draft-uuid","lines":[{"id":12,"counted_quantity":"4.50"},{"id":13,"counted_quantity":"0"}]}
```

- ส่งทุกสินค้าในใบพร้อมกัน ช่องว่าง/null/ลบ/เลข exponential/เกิน 2 ตำแหน่ง/เกินเพดานจำนวนเดิมถูกปฏิเสธด้วย 422 `VALIDATION_FAILED`; 0 คือไม่มีของอย่างตั้งใจ
- รายการเพิ่มที่ไม่อ้างใบสั่ง (เฉพาะ department) ส่ง `{product_id, unit_text, counted_quantity}` โดยไม่ใส่ id; server ใช้ชื่อสินค้าจาก catalog บันทึกพร้อม count ใน transaction เดียว ไม่ใช้ชื่อจาก client
- สาขาส่ง id ของแถวรวมและจำนวนรวม; server แจกแจงตามสัดส่วนสั่งด้วย largest remainder เดิม เก็บ provenance ทุก physical line และคืนจำนวนรวมในแถวรวม
- ใช้ document `FOR UPDATE` lock ก่อนล็อก lines; retry UUID/จำนวนเดิม (รวมพร้อมกัน) ตอบ 200 และเอกสารเดิม ไม่เพิ่ม audit/count ซ้ำ; เปลี่ยนจำนวนหลังเปิดบิลตอบ 409 `NOT_DRAFT` ให้ใช้ PUT แก้หลังเปิดบิลแทน
- 403 ต่างสาขา/แผนก, 404 ไม่พบ, 409 ไม่ใช่ draft, 422 UUID ไม่ตรง/นับไม่ครบ/ไม่ถูกต้อง
- ผล 200 `{success:true,data:document}` เปิดข้อมูลเทียบบิลเมื่อ commit สำเร็จเท่านั้น; inventory/order/alias ยังไม่เปลี่ยน

### Redaction และ enforcement

ก่อน `counted_complete_at`: create/retry/get/list คืน `blind:true`, ไม่คืน bill_text, quantity_received, quantity_billed, quantity_ordered, ราคา, amount, bill_read, ข้อมูล OCR หรือ department weights ใน lines; header เงิน/เลขบิล/วันที่บิลเป็น null, warnings ว่าง, `ocr.status="locked"` ส่วน images คืนเฉพาะ metadata

`GET /expected` คืน identity/unit/scope/due metadata และ `has_pending:boolean` แทนจำนวน/ราคา/สัดส่วนทุก role เพื่อไม่ส่งยอดชี้นำในคิว (ข้อมูลของเดิมใน `/api/orders/receiving` ไม่ได้เปลี่ยน)

อ่านภาพ binary, OCR, PUT, signature และ confirm ก่อนนับครบตอบ 409 แม้เรียกข้าม UI; image response หลังเปิดใช้ `private, no-store` เพื่อไม่เก็บภาพตัวเลขใน cache

หลังนับครบ line มี `counted_quantity` (2 decimal string), `counted_at` (ISO UTC), `counted_by`, `review_decision` และบริบท `quantity_ordered`, `ordered_unit`, `ordered_price` จากใบสั่งที่มีสิทธิ์ ส่วน timestamp จัดแสดงด้วย Asia/Bangkok ตามระบบเดิม

### การเทียบและการแก้หลังเปิดบิล

PUT lines รองรับ `review_decision`: null (ยังไม่ตัดสินใจ), `accept`, `short`, `over`, `wrong_product`, `price_review`, `missing_bill` (รับและให้บัญชีตามบิล), `not_received` (ไม่รับ: quantity_received=0, remember_alias=false; เก็บ counted_quantity เดิม) ทุกแถวยังต้องผ่าน validation/scope เดิม และบันทึกใน transaction เดิม

รอบ K: เพิ่ม `not_delivered` สำหรับนับ=รับ=0 และบิลไม่มีจำนวนหรือเป็น 0 เท่านั้น (ห้าม remember_alias/return_status): แสดง “ไม่ได้มาส่ง · ค้างตามใบสั่ง (ตามของ)” ไม่สร้างเรื่องขอบิล/คืนหลัง confirm; ของค้างยังอยู่ในคิวตามใบสั่ง เพิ่ม `over_order` สำหรับยืนยันรับเกินใบสั่งเมื่อจำนวนรับตรงบิล: แสดงส่วนเกินเป็นข้อมูลประกอบและแยกจากปุ่มยืนยันทั้งหมดที่ตรง เก็บการยืนยันใน audit; issue hook ยังเทียบกับบิล จึงไม่สร้างเรื่องเกินบิลเมื่อรับ=บิล

`resume_draft: true` (หน้ารับสินค้าใหม่ส่งเสมอ) ให้ server คืนร่างเดิมที่ id ต่ำสุดของร้าน+delivery_date+branch+receiving scope เดียวกัน; department scope ต้องตรงแผนกด้วย ส่วน branch scope ทำต่อข้ามแผนกในสาขาเดียวกันได้ ร้านใช้ product_group_id ก่อน supplier_master_id แล้วจึงชื่อร้านที่ไม่มีทั้งสองรหัส ไม่รวมร่างไร้ชื่อ/รหัสและไม่รวม confirmed/void คืน HTTP 200 เมื่อทำต่อร่างเดิม และ 201 เมื่อสร้างใหม่ ไม่เปลี่ยนชนิด/รายการ/หลักฐานของใบเดิม ล็อกแถว branch และค้นร่างด้วย FOR UPDATE ภายใน transaction เดียวเพื่อกัน UUID ใหม่ที่ส่งพร้อมกัน; validation/scope ของคำขอใหม่ยังต้องผ่านก่อน การไม่ส่ง flag/ส่ง false คงพฤติกรรม API เดิมสำหรับผู้เรียกที่ตั้งใจสร้างคนละบิล (ชนิด flag ผิด 422)
การแก้ line โดยไม่ส่ง decision จะล้าง decision ของแถวนั้น; การแก้เอกสารทุกครั้งล้างลายเซ็นทั้งสอง เพื่อให้ลงชื่อบนข้อมูลล่าสุด
signature/confirm ต้องมี decision ครบทุก physical line จึงดำเนินการได้

`counted_quantity/at/by` แก้ผ่าน PUT ไม่ได้ (422); original blind evidence คงเดิมเสมอ การแก้ `quantity_received` หลังเปิดใช้ค่ารับใหม่และ audit `edit_after_bill_reveal` ไม่อ้างเป็นการนับ blind เดิม UI แสดงจำนวนเดิมพร้อมบอกการแก้หลังเปิดบิล

OCR เก็บข้อมูลบิล/ผล raw แยกจาก count อัปเดตเฉพาะข้อมูลบิลของแถวที่จับคู่และยังไม่แก้เอง ไม่ลบ/สร้างทับ ID หรือ quantity_received/count เดิม; สินค้าบิลใหม่ที่ไม่จับคู่เพิ่มแถวรับ 0, count null และยังไม่ตัดสินใจ ต้องให้คนจับคู่และกรอกหลังเปิดบิล ไม่มีปุ่มใช้ AI ทับการนับ OCR ใหม่ล้าง decisions/signatures; hash-cache ยังคงไม่เรียก provider ซ้ำ

alias เริ่มไม่เลือก ต้องเลือก “จำชื่อย่อร้านนี้” อย่างตั้งใจ และเรียนรู้เมื่อ confirm เท่านั้น
confirm ที่มี `short`/`price_review`/`wrong_product`/`missing_bill` เรียก followup store เดิมใน transaction รับของเดียวกัน โดยแนบ document_id และการจัดการใน pending_items พร้อม dedupe ตาม scope เดิม; หากสร้าง/ผูก followup ไม่ได้ rollback คลัง/order/alias/เอกสารทั้งหมด ไม่สร้างเรื่องจาก draft ที่ยังไม่ confirm
ledger แยกยอดบิล / ส่วนต่างมูลค่าสินค้าขาดเกิน / มูลค่ารับ และภาษี/ส่วนลด ไม่ใช่ยอดอนุมัติชำระ

### Schema / migration

เพิ่มเฉพาะตาราง receiving เดิมของฟีเจอร์ ด้วย additive `SHOW COLUMNS` → `ALTER ADD COLUMN` ใน `ensureReceivingDocumentsTables` ที่รันซ้ำได้:

| ตาราง | คอลัมน์ |
|---|---|
| receiving_documents | counted_complete_at TIMESTAMP NULL, count_client_uuid VARCHAR(100) NULL |
| receiving_document_lines | counted_quantity DECIMAL(10,2) NULL, counted_at TIMESTAMP NULL, counted_by INT NULL, review_decision VARCHAR(40) NULL |

ใช้ index document/line เดิมและ unique client_uuid เดิม ไม่มี DDL ของตาราง legacy order/inventory ในการเปลี่ยนนี้ ไม่มี migration บนฐานจริงในรอบนี้; Production ปิด auto ensure ตามกติกาเดิม ต้องให้ Claude ตรวจ migration/schema ก่อน release

การตามของแบบ manual เก็บ snapshot จำนวนเต็มสำหรับบัญชีจาก model option ภายใน `includeInternalQuantities` (ไม่รับจาก query/body API) แต่ create-followup response ของผู้รับคืนเฉพาะชื่อ/id/หน่วย จึงไม่ใช้การตามของเปิดยอดสั่งก่อนนับ
การอัปโหลด/แทนรูปบิลใหม่จะล้าง decisions และ signatures เช่นกัน โดยไม่เปลี่ยน count evidence เพื่อให้ตรวจเอกสารล่าสุดก่อนเซ็นใหม่

หลังเปิดผลนับ line มี `bill_entered_manually` (boolean จาก persisted is_user_edited + quantity_billed) เพื่อให้การกรอกจำนวนบิลเองยังตรวจต่อได้หลังเปิดเอกสารใหม่ โดยไม่อ้างว่า OCR เสร็จ และไม่แสดง alias จากชื่อใบสั่งก่อนมี raw text จาก OCR จริง


## ทะเบียนใบรับสำหรับบัญชีและแอดมิน (เว็บ `/admin/receiving`)

เพิ่ม API ฐาน `/api/receiving-admin` แบบ **GET เท่านั้น** สำหรับ `admin`, `super_admin`,
`accounting`, `accountant` ทั้งสี่บทบาทอ่านข้ามสาขา/แผนกได้ ส่วนสิทธิ์เขียนเอกสารเดิมไม่เปลี่ยน
ทุก route ผ่าน `authenticate` เดิม; response ใช้ envelope/error เดิม และ `Cache-Control: private, no-store`
โมดูลนี้รัน SELECT เท่านั้น ไม่สร้าง/อัปเกรดตารางระหว่างอ่าน; ตารางยังไม่พร้อมตอบ 503 `RECEIVING_NOT_READY`

- `GET /` รับ query `date_from`, `date_to` (YYYY-MM-DD ค.ศ. รวมวันต้น/ปลาย),
  `branch_id`, `department_id` (จำนวนเต็มบวก), `scope=department|branch`,
  `supplier` (ส่วนหนึ่งของชื่อร้าน ไม่เกิน 255 ตัวอักษร; `%`/`_` เป็นข้อความธรรมดา),
  `status=draft|confirmed|void`, `discrepancy=yes|no`, `page` (1–1000000, default 1),
  `page_size` (1–100, default 25). ไม่ระบุ filter หมายถึงทั้งหมด
  เรียง `delivery_date DESC, id DESC` คงที่; หน้าที่เกินข้อมูลคืน `items: []`
  ตัวกรองผิดชนิด/ค่า/ช่วงวันที่ตอบ 422 `VALIDATION_FAILED`
- คืน `{ items: [ReceivingDocument without lines + branch_name + department_name + has_discrepancy],
  pagination: {page, page_size, total, total_pages},
  summary: {today, today_count, draft_count, confirmed_total, unknown_total_count} }`.
  summary ทั้งหมดใช้ตัวกรองเดียวกับรายการและนับครบทุกหน้า; `today` คือวันที่ Asia/Bangkok,
  `confirmed_total` รวมเฉพาะยอดที่ระบุในใบ confirmed ด้วย DECIMAL SQL (string),
  `unknown_total_count` นับใบ confirmed ที่ total เป็น NULL แยกต่างหาก
  `has_discrepancy` คือมีบรรทัด `quantity_billed IS NOT NULL` และ `quantity_received != quantity_billed`
  จำนวนบิล NULL ถือว่าไม่ทราบ ไม่ได้ถือว่าขาด/เกิน
- `GET /options` คืน `{branches: [{id,name}], departments: [{id,name,branch_id}]}`
  เฉพาะสาขา/แผนกที่มีเอกสาร ใช้เป็นตัวเลือกค้นหาทั้งข้อมูลเก่าและใหม่
- `GET /:id` คืน ReceivingDocument พร้อม `branch_name`, `department_name`, `voided_at`, `void_reason`,
  `audits: [{id,action,actor_name,created_at,line_count?,decisions?}]` เรียงเวลา/id ขึ้น (ไม่ส่ง details_json ดิบ)
  `blind_count` เพิ่ม line_count จากหลักฐานนับ; `edit_after_bill_reveal` เพิ่ม line_count และ decisions
  ที่เก็บ snapshot ภายใน transaction แก้ไขเดิม: `{id,product_name,unit_text,counted_quantity,quantity_received,quantity_billed,review_decision,return_status}`.
  เฉพาะบรรทัดที่ส่งการตัดสินใจครั้งนั้น ไม่คัดข้อมูลบิล/รูป/ลายเซ็นหรือ metadata อื่น;
  audit เก่าที่ไม่มี snapshot แสดงเพียงจำนวนรายการที่แก้ ห้ามอนุมานประวัติจากบรรทัดปัจจุบัน.
  เพิ่ม `issues: [{id,document_id,type,status,product_name,auto_key}]` จาก document_id ของใบนี้เท่านั้น
  รวมทุกสถานะ เรียง id ลง ไม่มีการตัดจำนวนที่ 100 เรื่อง; ไม่ปะปนกับ followup ที่โยงรายการสั่ง.
  ใบร่างที่นับยังไม่ครบคืน issues ว่างและไม่คืน decisions ใน audits เพื่อคง blind gate.
  และ lines เพิ่ม `counted_quantity|null`, `quantity_ordered|null`, `department_name|null`.
  คงบรรทัดแยกแผนกของใบทั้งสาขาไว้เพื่อบัญชีตรวจสอบได้; counted_quantity อ่านเมื่อมีฟิลด์นี้
  ในข้อมูลเดิม ไม่เพิ่ม migration ในงานนี้; ถ้าไม่มีคืน NULL ไม่ใช้ quantity_received แทน
  quantity_ordered อ้างอิง `order_items.quantity` ปัจจุบันของรายการที่ผูก ไม่ใช่ snapshot วันที่รับ
  ไม่พบเอกสารตอบ 404 `NOT_FOUND`; id ผิดรูปแบบตอบ 422

บทบาทอื่นตอบ 403 ก่อน query เอกสาร; ไม่ login/ข้อมูลยืนยันตัวตนไม่ถูกต้องหรือหมดอายุตอบ 401
ไม่มีการเขียนและไม่มี state conflict 409 ใน API ใหม่นี้
รูปใช้ `GET /api/receiving-documents/:id/images/:imageId` และลายเซ็นใช้
`GET /api/receiving-documents/:id/signatures/:role` เดิม โดยอนุญาตบัญชีทั้งสองบทบาทอ่านข้ามสาขา
เฉพาะ binary GET เหล่านี้; ตรวจ imageId ผูกกับ documentId เสมอ; ไม่ขยายสิทธิ์ upload/แก้/เซ็น/OCR/confirm/void

สรุปเรื่องตามของใช้ `GET /api/receiving-followups?status=pending` เดิมแบบอ่านเท่านั้น:
บัญชีเห็นตามสาขาของผู้ใช้ตาม API เดิม (ไม่ขยายสิทธิ์), pending_count ไม่ขึ้นกับตัวกรองใบรับ
ลิงก์เรื่องที่เกี่ยวข้องเทียบ branch/department และ order_item_id จากรายการ pending ล่าสุดสูงสุด 200 เรื่อง
หน้าปัญหารับของเป็น `/admin/receiving/issues?followup_id=<id>`;
รุ่นรวม 0.7.2 ใช้หน้าติดตามปัญหาจริง route เดียว และแสดงบริบท followup_id แบบอ่านอย่างเดียว หรือเปิด issue ที่ผูกไว้

Binary GET รูปบิลเปลี่ยน cache policy จาก private max-age=3600 เป็น private no-store เช่นเดียวกับลายเซ็น เพื่อไม่คงรูปบิลไว้ใน browser cache หลังสลับผู้ใช้


### การรวม 0.7.2: blind count ครอบคลุมบัญชี
ทุก role ในทะเบียนบัญชีใช้กฎเดียวกัน: draft ที่ยังนับไม่ครบ redact เลขบิล/วันที่บิล/ยอด/รายละเอียด OCR และจำนวนบิล/สั่ง; has_discrepancy เป็น null และตัวกรอง discrepancy ไม่ตรวจจำนวนในใบที่ยัง locked. หลังนับครบ หรือใบ confirmed/void จึงอ่านได้ตามสิทธิ์. บัญชีอ่านข้ามสาขาได้เฉพาะ ledger GET และ binary GET; ไม่ขยายสิทธิ์เขียน. รูปบิลและลายเซ็นก่อนนับครบตอบ 409 แม้เป็นบัญชี/แอดมิน.

### 0.7.2 branch OCR ร่วมแนว A
BranchDocumentEditor ใช้ DocumentEditor แนว A ร่วมกัน; OCR อัตโนมัติ/กดอ่านเองได้หลัง count ครบเท่านั้น. OCR จับคู่และกระจายจำนวนบิล/ยอดเงินด้วย largest remainder แต่ไม่เขียน quantity_received, counted_quantity, ID, owner หรือ weight. สินค้าที่ไม่พบในบิลล้างเฉพาะข้อมูลบิลและรอผู้รับตัดสินใจ. การอ่านใหม่ยกเลิก decision/ลายเซ็นเดิม.

### ปัญหารับของหลังยืนยัน

Confirm audit เพิ่ม metadata `issue_candidates` สำหรับสร้างเรื่อง shortage/over หลัง commit แบบไม่รอผล ไม่เปลี่ยน response ของ confirm หรือยอด order/inventory ของ flow เดิม สัญญาระบบติดตามปัญหาและหลักฐานคืนของ: [receiving-issues-api.md](receiving-issues-api.md)

### 0.7.2 issue hook ร่วมแนว A
confirm ยังคง linkReceivingExceptions ภายใน transaction เดิม พร้อม freeze issue_candidates ใน confirm audit ก่อน commit แล้วค่อย release connection/เรียก afterReceivingConfirm. ใบที่มี counted_quantity/review_decision เทียบจำนวนรับสุดท้ายกับจำนวนบิลเท่านั้น เก็บ count และ decision ใน candidate/audit/note. ขาดจากใบสั่งอยู่คิวเดิม ไม่กลายเป็น claim ขาดจากบิล. missing_bill/not_received ไม่สร้าง shortage จากใบสั่ง; missing_bill/price_review ใช้ followup แนว A เดิม; wrong_product สร้าง wrong_item. ใบ legacy ไม่มี count/decision คง frozen outstanding เดิม.

Pilot รุ่นรวม mount receiving-admin/receiving-issues/receiving-followups router จริงกับ database/auth adapter จำลองเดิม; ไม่เปิด src/server.js, cron, OpenAI API หรือ Production.


### Round C: followup และสรุปก่อนเซ็น

การตัดสินใจเดิมไม่เปลี่ยนรูปแบบ PUT: `not_received` สร้างเรื่อง `return` จากจำนวนนับเดิม และ `missing_bill` สร้าง `wrong_item` พร้อม note ให้บัญชีขอบิล ผ่าน hook หลัง commit เดิมแบบไม่บล็อก confirm/ไม่เพิ่ม inventory ซ้ำ ดูรายละเอียดและ dedupe ใน `receiving-issues-api.md`.

สรุปเงินแสดงยอดบิล / ปรับตามการตัดสินใจ / รายการรอราคา / มูลค่าที่รับส่วนที่ทราบราคา ใช้ BigInt สตางค์และราคา 6 ตำแหน่ง ปัด half-up ต่อบรรทัด ราคาที่ไม่ทราบแยกเป็นรายการรอราคา (ไม่แทนเป็นสินค้าราคา 0) ของนอกบิลไม่รวมเป็นยอดบิล ถ้าไม่มี unit_price แต่มี amount และจำนวนบิล ใช้มูลค่าบรรทัดตามสัดส่วนจำนวนรับ ส่วนลด/ภาษีคงค่าบิลเดิมและแสดงประกอบ บัญชีตรวจยอดชำระต่อ ถ้า header total ไม่เท่ารายการสุทธิ แสดงส่วนต่างอีกบรรทัดให้สมการตรวจได้ ไม่ปรับเงียบ ตัวอย่าง 600 - 60 = 540 บาท + 2 รายการรอราคา.


### รอบ D: สถานะคืนร้าน

PUT line เพิ่ม `return_status: "waiting" | "collected" | null` ใช้เฉพาะ `review_decision=not_received`; ไม่ส่งใช้ waiting เพื่อรองรับ client เดิม ค่าผิด/ส่งพร้อม decision อื่นตอบ 422 เก็บใน receiving_document_lines.return_status VARCHAR(20) NULL ด้วย ensure แบบ idempotent (ต้องเตรียม schema ในขั้น release; งานนี้ไม่รัน migration จริง) API แสดงค่าเฉพาะ decision คืนร้าน; เปลี่ยน decision จะล้างค่า สถานะ collected หมายถึงพนักงานแจ้งว่าร้านรับแล้ว ยังต้องแนบหลักฐานและให้บัญชีปิดเรื่อง ไม่ใช่การปิดเรื่องอัตโนมัติ

UI แสดงจำนวนคืนจากจำนวนนับเดิม ให้ยืนยันใน dialog ของแอปพร้อมเลือกว่าร้านมารับหรือยัง PUT จำนวนรับเป็น 0 และ remember_alias=false ใน transaction เดิม; หลัง confirm hook สร้าง return แบบ idempotent ตามเดิม ไม่มีการเพิ่มคลังของรายการที่คืน

### รอบ E: ตัวเลขเว็บบัญชีและการเปิดรายละเอียดตรง

`GET /api/receiving-admin` เพิ่ม `items[].receipt_value` (GET /:id เพิ่ม receipt_value รูปแบบเดียวกัน) เป็น `{received_known, received_net, pending_price_count}` หรือ `null` เมื่อนับยังไม่ครบ/ไม่มีบรรทัดให้คำนวณ/ข้อมูลเก่ามีตัวเลขผิดรูปแบบ ยอดเงินเป็น decimal string บาท ใช้ `reviewLedger` ชุดเดียวกับแอป (BigInt สตางค์, ราคา 6 ตำแหน่ง, half-up ต่อบรรทัด) `received_known` ก่อนส่วนลด/ภาษี; `received_net` ใช้ส่วนลด/ภาษีตามบิลเดิม เป็นยอดหลักที่แสดงตรงกับสรุปในแอป ใบทั้งสาขารวม product/unit ด้วย aggregateBranchLines เดิมก่อนปัดสตางค์และนับรายการรอราคา เพื่อไม่เพิ่ม/ลดสตางค์หรือจำนวนรายการจากการแยกแผนก ทั้งสองยังไม่รวมมูลค่าของรายการรอราคา ไม่ใช่ยอดเจ้าหนี้ที่รับรอง

`summary` คง `confirmed_total` เป็นยอดบิลเพื่อเข้ากันกับ client เดิม และเพิ่ม `received_known_total`, `received_net_total`, `pending_price_count`, `unvalued_document_count` สรุปเฉพาะใบ confirmed **ทั้งหมดตามตัวกรอง** ไม่ใช่เฉพาะหน้าตารางปัจจุบัน ใบเก่าที่ไม่มีบรรทัดไม่ถูกนับเป็นมูลค่ารับศูนย์ แต่รวมใน `unvalued_document_count`; draft ที่ยังนับไม่ครบไม่คืนข้อมูลมูลค่าบรรทัด

`GET /api/receiving-admin/issues-summary` เพิ่มแบบอ่านเท่านั้น คืน `{pending_issue_count}` นับทุกประเภทในสถานะ open/waiting_supplier ทุกสาขาที่บัญชี/แอดมินมีสิทธิ์ตาม issues API เดิม ไม่ขึ้นกับตัวกรองใบรับและไม่จำกัดที่ 100 แถว ไม่เกี่ยวกับ pending_count ของ followup สาขา ทั้งสี่บทบาทบัญชี/แอดมินอ่านได้; บทบาทอื่น 403, ไม่ login/หมดอายุ/ไม่ถูกต้อง 401, error sanitized และ private no-store เช่น endpoint บัญชีเดิม ไม่มี write หรือ conflict 409

หน้ารายละเอียด `/admin/receiving/:id` โหลดได้ตรง แยก loading/error/retry และตรวจ ID ก่อน render เพื่อไม่แสดงใบเดิมระหว่างเปลี่ยน URL การกลับรายการปัญหาในแอปใช้ปุ่มเดียวตามขั้น: รายละเอียดเรื่อง → รายการปัญหา → รับสินค้า เปิดฟอร์มหลักฐานแล้วเลื่อน/ย้าย focus ไปฟอร์มทันที


## แก้คิวรับของรอบ G (19 ต.ค. 2026)
- `GET /expected` เพิ่ม group `receipt_summary: {short, over, received_items}` เฉพาะร้านที่มีบรรทัดผูกใบสั่งในเอกสาร `confirmed` ภายในชุดใบสั่ง lookback ที่เลือก (ไม่รวม draft/void/ต่าง scope) เปรียบเทียบยอดรับสะสมปัจจุบันกับยอดสั่งด้วยจำนวนเต็มสองตำแหน่ง; รับ 0/คืนร้านที่ยืนยันแล้วนับเป็นขาดได้ ไม่เปิดจำนวนสั่ง/รับของรายการที่ยังไม่ได้นับ
- แผนกนับแยก order item; ทั้งสาขานับสินค้า+หน่วยไม่ซ้ำต่อทิศทางขาด/เกิน หากคนละแผนกขาดและเกินสินค้าเดียวกันจะแสดงในทั้งสองตัวนับ ไม่หักกลบกัน
- ร้านที่รับหมดหรือเกินและไม่มีงานค้างคืน group `summary_only: true, items: []` พร้อม `receipt_summary` เพื่อให้ตัวนับเกินยังเห็นได้; ห้ามนำ group นี้ไปสร้างใบรับ/ตามของ นับร้านรอรับและรายการค้างจาก `items[].has_pending` เท่านั้น ฟังก์ชัน internal สำหรับตามของ/จัดสรรยังคืนเฉพาะงานค้างเหมือนเดิม
- ร้านที่มีของรับแล้วและยังค้างแสดง “รับแล้วบางส่วน · ค้าง X รายการ”; ป้ายกำหนดส่งใช้วันที่ปัจจุบัน Asia/Bangkok และ `due_date` แทนการเชื่อสถานะค้างจากหน้าจอเก่า รีเฟรชเมื่อกลับแอปและเปลี่ยนวัน (คงวันที่ย้อนหลังที่ผู้ใช้เลือกเอง)
- audit `edit_after_bill_reveal.details.decisions` เก็บ snapshot เฉพาะบรรทัดที่การตัดสินใจ/จำนวน/สินค้า/หน่วย/สถานะคืนเปลี่ยนจริงใน transaction นั้น ส่งบรรทัดเดิมซ้ำไม่ทำให้ประวัติสะสมการตัดสินใจก่อนหน้าซ้ำ; audit เก่าไม่แก้ย้อนหลัง

### ใบรับไม่มีบิล (รอบ J)
`kind=manual_receipt` ยังคง blind จน `POST /:id/count` บันทึกจำนวนครบ (รวม 0 อย่างตั้งใจ).
การยืนยันนับบันทึก `review_decision=missing_bill` ทุกแถวใน transaction เดียวกับหลักฐานนับ
เพื่อให้ตรวจสรุปเทียบใบสั่งแล้วเซ็นและ confirm ได้โดยไม่ต้องมีรูปบิลหรือ OCR.
รูปของเป็นทางเลือกหลังนับครบ; ไม่ส่งเข้า OCR อัตโนมัติ. ยังต้องมีลายเซ็นผู้รับก่อน confirm
และติดตามขอบิล/ราคาโดยกฎเดิม. ใบ `bill` ใช้ขั้นเทียบบิลและตัดสินใจเดิม.
