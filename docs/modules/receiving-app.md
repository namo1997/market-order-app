# ระบบรับสินค้าใหม่ (`receiving-app`)

> status: core · review: in-progress · อัปเดต: 2026-10-20 · **Local release candidate** (branch `receiving/release-port-20261020` ต่อจาก production-base `68bee663`) — ยังไม่ deploy, ยังไม่ migrate ฐานจริง

## หน้าที่
แผนก/สาขารับของจากซัพพลายเออร์ผ่านเว็บ `/receiving` หรือแอป Android (Capacitor) ถ่ายรูปบิล ให้ OCR อ่านแล้วนับของแบบ blind-count เทียบบิล เซ็นรับ แล้วยืนยันเพื่อบันทึกยอดรับ/สต๊อกใน transaction เดียว ฝ่ายบัญชีดูใบรับของ จัดการร้านค้า/ชื่อย่อ/รหัสเจ้าหนี้ตามสาขา และติดตามปัญหา (ของขาด/เสีย/ผิด/คืนของ) จนปิดเรื่อง; ส่งออกใบรับของให้ระบบบัญชีเจ้าหนี้แบบอ่านอย่างเดียว

## Flow
1. คิวรับของ (`/api/receiving-documents` ตามสาขา/ร้าน) -> เริ่มเอกสาร (idempotent ด้วย `client_uuid`)
2. ถ่ายรูปบิล -> OCR (provider ผ่าน `OPENAI_API_KEY`, จำกัดอัตรา, แคชตาม sha256) -> จับคู่สินค้าด้วยชื่อ/ชื่อย่อ/รหัสในบิล
3. นับ blind-count -> เทียบบิล -> สรุป -> เซ็น -> confirm (เปลี่ยน `order_items`/inventory/alias ใน transaction เดียว; void ย้อนเฉพาะที่เอกสารนี้ทำ)
4. ปัญหาที่พบ -> `/api/receiving-issues` + follow-up/push (`/api/receiving-followups`, `/api/receiving-push`)
5. บัญชี: `/api/receiving-admin` (ใบรับของ, ร้านค้า, สินค้าของร้าน, CSV preview) และ `/api/receiving-export/ap/v1/documents` (token)

สัญญา API: `docs/receiving-documents-api.md`, `docs/receiving-issues-api.md`, `docs/receiving-ap-export.md`, `docs/receiving-accounting.md`

## ไฟล์และตาราง
ดู entry `receiving-app` ใน [`modules.json`](modules.json). Schema เป็น additive ทั้งหมด (`CREATE TABLE IF NOT EXISTS`) และสร้างได้ 2 ทาง: สคริปต์ `server/scripts/migrate-receiving-{documents,issues,push}.js` (ใช้ใน Production ในขั้น release ที่อนุมัติ) หรือ auto-ensure เมื่อไม่ใช่ production / ตั้ง `AUTO_ENSURE_RECEIVING_TABLES=true`

## กติกา (ห้ามผิด)
- Production ไม่สร้างตารางรับสินค้าอัตโนมัติ; ถ้ายังไม่ migrate API ตอบ `503 RECEIVING_NOT_READY` — ต้องรันสคริปต์ก่อน deploy โค้ดนี้
- confirm ซ้ำไม่บวกสต๊อกซ้ำ; ยอดคงคลังล็อกด้วย `inventory-balance-lock` (ลำดับล็อก balance ก่อน ledger)
- `order_items.actual_price` ไม่ถูกแก้ตอน confirm (option 11b)
- ห้ามอ่าน/ส่ง token, รูป base64, ลายเซ็น ใน log หรือ error
- เมนูรับสินค้าเดิม (`/order/receive`, module `receiving`) อยู่ในระยะที่ 1 ของการเลิกใช้: write endpoint เดิมยังทำงานแต่ถูก log `[LEGACY-RECEIVING]` — ดู `docs/receiving-rollout.md`

## บั๊กที่รู้แล้ว
| รหัส | ระดับ | ตำแหน่ง | อาการ | วิธีแก้ที่เสนอ | สถานะ |
|---|---|---|---|---|---|
| REC-01 | ต่ำ | `supplier.model.js` (MODIFY COLUMN เก่า), `purchase-order.model.js` | MODIFY COLUMN บนคอลัมน์ที่เป็น FK อาจล้มบน MySQL จริง (pilot แก้เฉพาะ DDL ของ pilot) | แยกงานแก้ DDL เดิมให้ idempotent ไม่ MODIFY คอลัมน์ FK | เปิด (นอกเส้นทางงานนี้) |
| REC-02 | กลาง | หน้าร้านค้า admin | รหัสเจ้าหนี้ที่บันทึกก่อนมี `branch_id` ต้องผูกสาขาใหม่ | ผูกสาขาในหน้าร้านค้าก่อนเปิดใช้บัญชี | เปิด |

## จุดเชื่อมระบบอื่น
- **general-cashflow (AP ledger):** branch `cashflow/ap-receiving-import` (ยังไม่รวม) ดึง endpoint ส่งออกด้วย `RECEIVING_EXPORT_TOKEN`
- **inventory:** confirm/void/คืนของเขียน `inventory_transactions` ผ่าน lock กลาง
- **master-data:** สร้างสินค้าให้ร้านผ่าน `createProduct(data, { connection })` พร้อมชื่อย่อใน transaction เดียว
