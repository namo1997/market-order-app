# ผลตรวจรอบ 1 (Claude, 14 ต.ค. 2569) — งาน server ของ Gemini (commit ae5e699..22c028f)

ผลเทสต์บน SSD: **91 tests / 90 pass / 1 fail**
- fail: `receiving-documents-schema defines all additive tables and columns` → `ReferenceError: process is not defined` ใน `ensureReceivingDocumentsTables` (อ่าน `process.env` ตอนสร้างตาราง ซึ่ง vm ของเทสต์ไม่มี) — ส่งค่าเข้ามาเป็น option แทนการอ่าน global
- เทสต์ใหม่มีแค่ 6 ตัว ไม่ครอบคลุมตาม AGENTS.md หัวข้อ 3–4

## ต้องแก้ก่อนส่งรอบถัดไป (เรียงตามความรุนแรง)

| # | ระดับ | ที่ | ปัญหา | ต้องแก้ |
|---|---|---|---|---|
| 1 | **Critical** | `models/receiving-documents.model.js` ~1414–1417, 1494, 1522, 1764–1810 | PUT รับ `order_item_id` จาก client โดยไม่ตรวจสาขา/แผนก และ confirm `UPDATE order_items WHERE id = ?` ทันที (ไม่เช็ค scope และไม่เช็ค `oi.product_id = line.product_id`) → ผู้ใช้สาขา A เขียนทับการรับของ/ราคาของสาขา B ได้ | ตรวจทุก `order_item_id` ทั้งตอน PUT และ confirm ด้วย JOIN orders→users→departments ให้ตรง `doc.department_id`/`doc.branch_id` และ `product_id` ตรงกัน แบบเดียวกับ `order.model.js` ~2271–2290; ไม่ผ่าน = 403/422 + เทสต์ |
| 2 | High | ~897–902, 991–1067 | OCR เช็ค draft ก่อนเรียก AI (≤60 วิ) แล้วเขียนผลโดยไม่ล็อก/ไม่เช็คซ้ำ → เขียนทับเอกสารที่ confirm ไปแล้วระหว่างรอ | ใน transaction ที่เขียนผล `SELECT ... FOR UPDATE` แล้วเช็ค `status='draft'` อีกครั้ง |
| 3 | High | ~1815–1857 เทียบ `order.model.js` ~771–830 | confirm บวกคลังเต็ม `qtyReceived` (flow เดิมบวกเฉพาะส่วนต่าง), ไม่สน `is_countable`, ไม่ตัดคลังต้นทางของกลุ่ม internal → คลังซ้ำ/ผิด | ใช้ฟังก์ชันเดิม `updateOrderItemReceivingWithInventory` (export ออกมา) หรือคำนวณ delta = ใหม่ − เดิม พร้อมเงื่อนไขเดียวกับของเดิม |
| 4 | High | ~1776–1794, 2022–2041 | void คืน order_items ด้วย snapshot ทั้งแถว (ทับงานที่เกิดทีหลัง), 2 บรรทัดชี้ order_item เดียวกันทำ snapshot เพี้ยน | ห้าม order_item_id ซ้ำในเอกสาร; เก็บ `applied_*` ตอน confirm; void ย้อนแบบ delta หรือปฏิเสธถ้าค่าปัจจุบัน ≠ ค่าที่เอกสารนี้ตั้ง |
| 5 | High | ~919–937, `services/receiving-ocr.service.js` ~486–497 | OCR ไม่มี rate limit, ไม่ dedupe ด้วย sha256 (มีคอลัมน์แต่ไม่ใช้), เรียกพร้อมกันได้, สูงสุด 50 หน้า × 3MB detail high → ค่า AI บานได้ | lock ด้วย `UPDATE ... SET ocr_status='pending' WHERE id=? AND ocr_status<>'pending'`; ข้ามถ้า hash ทุกหน้าเท่ารอบก่อน; จำกัดครั้ง/นาที; จำกัด ≤10 หน้า |
| 6 | Medium | `controllers/receiving-documents.controller.js` ~36–44 | error อื่นตอบ 500 พร้อม `error.message` ดิบ → หลุดชื่อคอลัมน์/ข้อความ SQL | ตอบข้อความกลางภาษาไทย log ฝั่ง server (ไม่ log body/base64); validate id ทุกตัวเป็นจำนวนเต็มบวก |
| 7 | Medium | service ~308–395, model ~1042–1066 | ผล OCR ไม่ผ่าน schema validation (ติดลบ/ค่ามหาศาล/บรรทัดไม่จำกัด/ข้อความยาวเกินคอลัมน์); INSERT ล้มแล้ว `ocr_status` ค้าง `pending` | clamp/validate ทุกฟิลด์ (≥0, เพดาน, ≤N บรรทัด, ตัดความยาวตามคอลัมน์) → null + warning; ตั้ง `failed` เมื่อ transaction ล้ม; PUT ก็ต้องมีเพดาน |
| 8 | Medium | ~951–958, 1879–1908 | `supplier_product_aliases` ใช้ร่วมทุกสาขาและ `ON DUPLICATE KEY UPDATE product_id` เขียนทับทุก confirm → ใครก็ทำให้ OCR ทุกสาขาจับคู่ผิด | เปลี่ยน product_id ได้เฉพาะ admin หรือเมื่อมีหลักฐานซ้ำหลายครั้ง; เก็บประวัติ |
| 9 | Low | `routes/receiving-documents.routes.js` 8–10 | body parser 6mb ทำงานก่อน `authenticate` | สลับลำดับ |
| 10 | Low | ~806, 1628 | upload/sign เช็ค draft แบบไม่ล็อก | `UPDATE ... WHERE status='draft'` หรือ FOR UPDATE |
| 11 | Low | ~813–855 | race หน้าเดิม → ER_DUP_ENTRY กลายเป็น 500 | `INSERT ... ON DUPLICATE KEY UPDATE` |
| 12 | Low | schema ~67 | `unit_price` DECIMAL(12,2) แต่ `order_items.actual_price` DECIMAL(12,6) → ราคาถูกปัด | ให้ precision ตรงกัน |
| 13 | Low | ~320–352 | DUPLICATE_BILL ตรวจข้ามสาขา | เพิ่มเงื่อนไข branch_id |
| 14 | Low | ~559–562 | admin ตั้ง branch/department ไม่สอดคล้องกันได้ | ตรวจแผนกอยู่ในสาขา |
| 15 | Low | ~1990–1996 | void "วันเดียวกัน" อิง `delivery_date` ที่ผู้ใช้ตั้งเอง | อิง `confirmed_at` |
| 16 | Low | service ~529–542 | clearTimeout ก่อนอ่าน body | clear หลัง `response.json()` |
| 17 | Low | ~791 | รับ png แต่สัญญาระบุ jpeg/webp | ทำให้ตรงสัญญา |

## เทสต์ที่ต้องเพิ่ม (พิสูจน์ทุกข้อข้างบนที่ทำได้)
401 ทุก endpoint · IDOR ของ PUT/confirm/void/images/ocr · order_item ข้ามสาขา (ข้อ 1) · confirm พร้อมกัน 2 คำขอ · OCR พร้อมกัน/ระหว่าง confirm (ข้อ 2) · คลังเมื่อเคยรับผ่าน flow เดิมแล้ว (ข้อ 3) · void หลังมีการแก้ทีหลัง / void ซ้ำ (ข้อ 4) · OCR ซ้ำรูปเดิมไม่เรียก AI (ข้อ 5) · error ไม่หลุด SQL (ข้อ 6) · ผล OCR ติดลบ/ยาวเกิน (ข้อ 7)

## สิ่งที่ตรวจแล้วผ่าน
authenticate ครอบทุก endpoint · assertDocumentAccess ทุก `:id` · รูปกรองตาม document · SQL ใช้ placeholder ทั้งหมด · ตรวจ magic bytes + ขนาดก่อน decode · confirm/void ใช้ FOR UPDATE + client_uuid unique · transaction มี rollback · ไม่ log base64/คีย์ · วันที่ Bangkok + แปลง พ.ศ. ถูก · schema idempotent ไม่ auto-migrate บน production
