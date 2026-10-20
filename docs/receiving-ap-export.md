# ส่งออกใบรับของไปบัญชีเจ้าหนี้ v1

สัญญาอ้างอิง: `CONTRACT-receiving-ap-export-v1.md` (20 ต.ค. 2569, integration-2026-10-20 บน SSD) สำหรับ A1 → A2 แบบ Cashflow pull อ่านอย่างเดียว ข้อมูลนี้เป็นหลักฐานซื้อสำหรับจับคู่/เติมช่องว่างใน AP ledger ยอดเจ้าหนี้ยังยึดสมุดรับจ่าย Google Sheets ของเจ้าของ ไม่สร้างยอดจ่ายเงิน

## Endpoint และสิทธิ์

`GET /api/receiving-export/ap/v1/documents`

ใช้ `Authorization: Bearer <service credential>` จาก environment `RECEIVING_EXPORT_TOKEN` โดยผู้ดูแลระบบเป็นผู้ตั้งภายหลัง ไม่มีค่าเริ่มต้น/ไฟล์ค่าลับ/การสร้าง credential ในงานนี้ เปรียบเทียบ SHA-256 digest ขนาดเท่ากันด้วย `timingSafeEqual` ทุกคำขอ สิทธิ์นี้อ่านข้ามสาขาได้สำหรับการเชื่อมบัญชี; JWT พนักงานใช้แทนไม่ได้ ต้องเก็บ credential ฝั่ง server ของระบบบัญชี

| Query | กติกา |
|---|---|
| `limit` | จำนวนเต็ม 1–500; ไม่ระบุ = 100 |
| `updated_since` | ISO timestamp มี `Z` หรือ offset, รองรับมิลลิวินาทีไม่เกิน 3 หลัก; รวม timestamp ที่เท่าขอบเขต (`>=`) |
| `cursor` | opaque cursor จาก `next_cursor`; ส่งกลับโดยไม่แก้ พร้อม `updated_since` เดิม (offset ต่างแต่เวลาเดียวกันได้) |

ต้อง URL-encode `+` ใน offset เป็น `%2B` ไม่รับ query ซ้ำ/array/unknown field หรือ limit นอกช่วง

## รูปแบบ response

สำเร็จ HTTP 200 เป็น object ตรงตามสัญญา **ไม่มี `success/data` wrapper**:

```json
{"version":1,"generated_at":"2026-10-20T18:00:00.000+07:00","next_cursor":null,"documents":[]}
```

ส่งเฉพาะ `confirmed` / `void` เรียง `(receiving_documents.updated_at, id)` ขาขึ้น คงลำดับเดิมเมื่อข้อมูลไม่เปลี่ยน ใช้ keyset แทน offset และอ่านเพิ่มหนึ่งแถวเพื่อกำหนด `next_cursor=null` เมื่อหมด

| ฟิลด์เอกสาร | ความหมาย |
|---|---|
| `document_id`, `status` | ID ตลาดสดและ `confirmed`/`void` |
| `updated_at`, `confirmed_at`, `voided_at` | ISO-8601 เวลาไทย `+07:00`; วันที่ยังไม่เกิดเป็น null |
| `receipt_date` | `delivery_date` ของระบบรับของ (วันรับของไทย) `YYYY-MM-DD` |
| `branch` | `{id, code, name}`; metadata ที่ไม่มีเป็น null |
| `department` | `{id, name}`; metadata ที่ไม่มีเป็น null |
| `receiving_scope` | `department`/`branch` |
| `supplier` | `{key, master_id, product_group_id, name, ap_code, ap_code_source}` |
| `doc_kind` | `bill`/`no_bill`/`statement_only` |
| `doc_ref`, `doc_date` | เลขอ้างอิงบิล/วันในบิล ค.ศ.; ไม่มีเป็น null |
| `bill_totals_satang` | `{subtotal, discount, vat, total}` แต่ละค่าเป็น integer สตางค์หรือ null เมื่อไม่ทราบ |
| `received_value_satang` | ผลรวม `lines[].amount_satang`; ขาดราคาบรรทัดที่รับแม้หนึ่งรายการ = null |
| `price_status` | `from_bill` เมื่อคำนวณมูลค่าได้ / `needs_accounting_price` เมื่อไม่ทราบ |
| `lines` | อาร์เรย์บรรทัดเดิม เรียง `(line_no, id)` |
| `open_issues` | `{type, status, credit_note_ref}` จาก issues/followup ที่ผูกเอกสารโดยตรง รวม resolved ตามสัญญา |
| `image_count` | จำนวนรูปเท่านั้น |

`supplier.key` ใช้ฟังก์ชันเดิม `buildSupplierKey`: `sm:<id>` ก่อน `pg:<id>` ก่อนชื่อ normalized/`none` ตามระบบเดิม ชื่อใช้ชื่อที่บันทึกในใบรับก่อนชื่อ master/group

ลำดับ AP code: แถว active ใน `receiving_supplier_branch_codes` ที่มี `supplier_key` ตรง และ **`branch_id` ตรงสาขาเอกสาร** → `supplier_masters.code` → null (`ap_code_source=branch_code/master_code/none`) ไม่ใช้ `product_groups.code` แทนรหัส master ไม่เดาสาขาจาก `branch_note` และไม่เอา OCR supplier code มาแทน mapping

| ฟิลด์บรรทัด | กติกา |
|---|---|
| `line_id`, `product_id`, `product_name` | identity ของบรรทัด/สินค้า; product ไม่ผูกเป็น null |
| `item_code`, `bill_text` | รหัสสินค้าบนบิล/ข้อความรายการที่ผ่านระบบรับของ ไม่ใช่ OCR payload ดิบ |
| `quantity_received`, `unit` | จำนวนสตริงทศนิยมสองตำแหน่งเสมอ เช่น `"10.00"` และหน่วยที่เก็บในบรรทัด |
| `unit_price_satang` | ราคาบิลต่อหน่วยฐาน ปัด half-up เป็น integer สตางค์; ไม่ทราบ = null |
| `amount_satang` | จำนวนรับ × ราคาฐานความละเอียด 6 ตำแหน่ง แล้วปัด half-up เป็นสตางค์ต่อบรรทัด |
| `decision` | ค่า `review_decision` เดิม เช่น accept/short/over/not_delivered/not_received/price_review/missing_bill; legacy ไม่มี = null |

ใช้ `base_unit_price` ก่อน หากไม่มีใช้ `unit_price / unit_multiplier` โดยคง 6 ตำแหน่งก่อนคูณ ใช้ `scaledInteger/decimalString` เดิมและ BigInt ไม่มีการบวกเงินด้วย float ราคาที่ปัดเป็นสตางค์สำหรับแสดงอาจคูณกลับแล้วต่างจากยอดที่คงความละเอียด 6 ตำแหน่ง ให้ใช้ `amount_satang` เป็นยอดบรรทัด ยอดเกิน safe integer หรือข้อมูลตัวเลขเสียทำให้คำขอล้มเหลวทั้งหน้า ไม่ส่งยอดที่คลาดเคลื่อน

`manual_receipt` ส่ง `no_bill`; หากมีราคาที่เก็บไว้คำนวณได้ตามปกติ หากไม่มีราคาส่ง null/needs_accounting_price ไม่เติมจากยอดหัวบิลหรือราคาใบสั่งเดิม เอกสารไม่มีบรรทัดรับเก่าให้มูลค่า null ไม่ตีความเป็นศูนย์ ยกเว้น `statement_only`: metadata OCR ที่ผ่านระบบระบุ `statement` และไม่มีบรรทัดรับ ส่ง lines ว่างและมูลค่ารับ 0 เพื่อเป็นข้อมูลอ้างอิงเท่านั้น ห้ามตั้งซื้อจากยอดหัวใบวางบิล บรรทัดรับ 0 มีมูลค่า 0 ได้แม้ไม่ทราบราคา

Issues: `shortage` → `short`, `waiting_supplier` → `open`, `resolved` คงเดิม; `credit_note_ref` มีค่าเฉพาะ resolution `credit_note`; ไม่ส่ง cancelled. `missing_bill` ที่ผูก wrong_item claim → `request_bill`. ใบขอบิล/ตรวจราคาจาก `receiving_followups.pending_items_json` ต้องมี `document_id` ตรงและ decision `missing_bill`/`price_review` เท่านั้น; acknowledged → open. รวมรายการ type/status/ref ซ้ำเป็นรายการเดียว ชนิดอื่นที่สัญญาเปิดไว้ด้วย `…` คงค่าจากระบบ เช่น damaged/wrong_item/over

`void` เป็นสถานะล่าสุดของ ID เดิม มี confirmed_at เดิม/voided_at ใหม่ ส่งยอดบวกดั้งเดิมและบรรทัดเพื่อให้ฝั่งรับกลับรายการหนึ่งครั้งเอง ไม่ส่งยอดติดลบหรือเขียนบัญชี ไม่ลบประวัติในตลาดสด

## ความสอดคล้องและการดึงซ้ำ

แต่ละหน้าอ่านด้วย InnoDB `REPEATABLE READ` + `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` จึงเห็น header/lines/issues สอดคล้องกัน ไม่มี schema ensure/INSERT/UPDATE/OCR/ส่งข้อความใน endpoint นี้ อ่าน timestamp ด้วย UNIX_TIMESTAMP จึงไม่ผูกกับ TZ ของ process; SQL DATE ใช้ DATE_FORMAT เพื่อไม่เลื่อนวัน

Cursor เป็นตำแหน่งของสถานะเอกสารล่าสุด ไม่ใช่ immutable event log หรือ snapshot ข้าม HTTP หลายหน้า ถ้ามีการแก้เอกสารระหว่างหน้า เอกสารอาจเลื่อนไปข้างหน้า/ถูกพบซ้ำได้ ฝั่งรับต้อง upsert/dedupe ด้วย document_id + updated_at/hash และอ่าน overlap แบบ inclusive รอบถัดไป ห้ามใช้ generated_at เป็น watermark เพราะเวลาตอบอาจใหม่กว่า transaction ที่ยังไม่ commit

`updated_since` อ้างอิง **document.updated_at**; การแก้ master/AP mapping หรือปิด issue/followup อย่างเดียวที่ไม่ได้แก้เอกสารจะไม่เลื่อน watermark ของใบรับในระบบเดิม หากต้องการ refresh metadata/สถานะเรื่องเหล่านี้ให้ดึงเต็มหรือช่วง overlap ที่ครอบคลุมใบเดิม ภายหลังอาจเพิ่ม change log แยกตามสัญญารุ่นใหม่

## Schema และการเปิดใช้งาน

เพิ่มใน schema receiving เดิมเท่านั้น:

- `receiving_supplier_branch_codes.branch_id INT NULL`; แถวเก่าที่มีเพียง branch_note ยังคงอยู่และไม่ถือว่าเป็น mapping ที่ยืนยันแล้ว
- unique index `(supplier_key, branch_id)` โดย null ยังอนุญาตหลายแถวเก่า ป้องกันสองรหัส active ที่กำกวมในสาขาเดียว
- index `receiving_documents(updated_at,id)` สำหรับ keyset scan; index document ของ lines/images/issues ใช้ของเดิม

ใช้ SHOW COLUMNS/SHOW INDEX ก่อน ALTER ตามรูปแบบ idempotent เดิม ไม่มี migration บนฐานจริงในงานนี้ ผู้ดูแลต้องใช้ workflow migration ที่อนุมัติแยกและผูก branch_id ให้รหัสเก่าก่อนคาดหวัง branch override หน้าจอจัดการรหัสเดิมยังไม่รองรับ branch_id ในงาน A1 นี้ การ disable รหัสยังคงใช้ is_active ได้ตามเดิม

## Error และการคัดข้อมูล

| HTTP | code |
|---|---|
| 503 | `EXPORT_DISABLED` เมื่อไม่ตั้งค่า/ว่าง |
| 401 | `UNAUTHORIZED` เมื่อไม่มี/ผิดรูปแบบ/credential ไม่ตรง |
| 422 | `VALIDATION_FAILED` สำหรับ query/cursor |
| 503 | `RECEIVING_NOT_READY` เมื่อยังไม่มีตาราง/คอลัมน์ |
| 500 | `EXPORT_FAILED` ความผิดพลาดอื่น โดยไม่ส่ง stack/SQL |

ทุก response ตั้ง `Cache-Control: private, no-store`; ไม่มี route เขียน ไม่มีรูป/base64/signature/raw OCR/บัญชีธนาคาร/เลขภาษี/เบอร์โทรใน SELECT หรือ response ใช้ projection allowlist แยกจาก object สำหรับหน้ารับของเดิม ค่า `doc_kind` ดึงเพียง metadata scalar ผ่าน JSON_EXTRACT ไม่โหลด OCR ทั้งก้อน

## การตรวจสอบ

`server/tests/receiving-ap-export.test.mjs` ทดสอบ route Express จริงในหน่วยความจำ + SQL mock พร้อม snapshot/rollback assertions ไม่มีการเชื่อม MySQL จริง; schema idempotence ใช้ VM/mock เช่นกัน ผล full regression/build สองรอบและข้อจำกัดอยู่ในรายงานงาน A1 บน SSD ไม่ได้ยืนยัน Production หรือ execution plan/MySQL integration จริง
