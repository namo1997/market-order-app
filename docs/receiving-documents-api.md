# Receiving documents API (สัญญากลางระหว่าง server กับแอป) — v1

ฐาน: `/api/receiving-documents` ใน market order server · Auth: JWT Bearer เดิม (`authenticate`) · ผู้ใช้เห็น/แก้ได้เฉพาะสาขา/แผนกของตัวเอง เว้นแต่ admin
ทุกยอดเงินเป็น string ทศนิยม 2 ตำแหน่ง ("1234.50"); จำนวนเป็น string ทศนิยมสูงสุด 3 ตำแหน่ง; วันที่ `YYYY-MM-DD` เวลา Bangkok
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
   - อัปเดต order_items ที่ผูก: received_quantity, actual_price=unit_price, is_received, received_by_user_id, received_at
   - เพิ่ม inventory_transactions type `receive` (ใช้ model เดิม)
   - บันทึก/อัปเดต supplier_product_aliases จาก line ที่ผู้ใช้ยืนยัน
   - status=confirmed, audit
   → ReceivingDocument
9. `POST /:id/void` body `{ reason }` (admin หรือเจ้าของเอกสารภายในวันเดียวกัน) → ย้อน received ที่เอกสารนี้ตั้งไว้ + inventory reverse
10. `GET /:id/images/:imageId` → รูป (binary) ตามสิทธิ์

## Warning codes
`SUM_MISMATCH` (ผลรวมบรรทัด ≠ subtotal/total เกิน 1 บาท) · `PRICE_CHANGE` (ราคาต่างราคาล่าสุด > 15%) · `QTY_SHORT` / `QTY_OVER` (เทียบที่สั่ง) · `UNMATCHED_LINE` · `DUPLICATE_BILL` (supplier+doc_ref+total ซ้ำ) · `LOW_CONFIDENCE`

## Error codes
`VALIDATION_FAILED` 422 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `NOT_DRAFT` 409 · `SIGNATURE_REQUIRED` 422 · `OCR_UNAVAILABLE` 503 · `IMAGE_TOO_LARGE` 413
