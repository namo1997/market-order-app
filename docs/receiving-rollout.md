# การเลิกใช้เมนู "รับสินค้า" แบบเดิม (ทางเลือก ข — 2 ระยะ)

สถานะ: **ทางเลือก** รอเจ้าของตัดสินใจรวม ที่มา: parity audit ข้อ #10 (`reports/receiving-old-menu-parity/PARITY.md`)

## ตอนนี้ (2026-10-21): กลับไปใช้เมนูเดิมเป็นหลัก
เจ้าของสั่ง "เปลี่ยนเป็นรับของระบบเดิมก่อน" → `client/src/pages/user/legacy-receiving.js` `LEGACY_RECEIVING_PRIMARY = true`:
หน้าเลือกฟังก์ชั่นแสดงการ์ด "รับสินค้า" เดิม (`/order/receive`) ให้ทุกคน ไม่มีแถบเตือน; การ์ดระบบใหม่ซ่อน แต่ `/receiving` และแอปมือถือยังเปิดได้ (ทดสอบ)
กลับไปใช้ระยะที่ 1 = เปลี่ยนเป็น `false` บรรทัดเดียว (เทสต์ `client/tests/legacy-receiving-hidden.test.mjs` ครอบทั้งสองค่า)

## ระยะที่ 1
| ส่วน | พฤติกรรม |
|---|---|
| หน้าเลือกฟังก์ชั่น (`FunctionSelect`) | ซ่อนการ์ด "รับสินค้า" เดิม เหลือการ์ดเดียว "รับสินค้า (ระบบใหม่)" -> `/receiving` |
| URL เดิม `/order/receive` | ผู้ใช้ทั่วไปเห็นหน้า "เมนูนี้ย้ายไประบบรับสินค้าใหม่แล้ว" พร้อมปุ่มไประบบใหม่ และวิธีเปิด (ปุ่ม / การ์ดในหน้าเลือกฟังก์ชั่น / แอปรับสินค้าบนมือถือ) |
| admin / super_admin | ยังเปิดหน้าเดิมได้ (กู้คืนฉุกเฉิน) โดยมีแถบเตือนสีเหลืองด้านบนเสมอ |
| endpoint เขียนเดิม | ยังทำงานเหมือนเดิม แต่ **ทุกครั้งที่เรียก log `[LEGACY-RECEIVING] DEPRECATED write <METHOD> <path> user=<id> role=<role>`** (ไม่ log query string, body, header, token) |
| `GET /api/orders/receiving/bill-photos` และ GET อื่น | อ่านอย่างเดียว ใช้ได้ตามเดิม ไม่ถูกบล็อกทั้งสองระยะ |

endpoint เขียนที่ถูกครอบด้วย guard (`server/src/middleware/legacy-receiving.js`):
`POST /api/orders/receiving/bill-photos`, `PUT /api/orders/receiving`, `POST /api/orders/receiving/manual-item`,
`PUT /api/admin/orders/receiving`, `POST /api/admin/orders/receiving/bulk`

## สวิตช์
`server/src/config/legacy-receiving.js` -> `LEGACY_RECEIVING_WRITES_ENABLED = true` (ค่าคงที่ในโค้ด ไม่ใช่ env/.env; เปลี่ยนต้องผ่าน review)

## ระยะที่ 2 (ภายหลัง ทำเมื่อพร้อม)
1. ดู log ว่าไม่มี `DEPRECATED write` จากผู้ใช้จริงแล้วในช่วงที่เจ้าของกำหนด
2. เปลี่ยนบรรทัดเดียวเป็น `LEGACY_RECEIVING_WRITES_ENABLED = false`
3. ผลลัพธ์: endpoint เขียนข้างต้นตอบ `410 Gone` `{ success:false, code:'LEGACY_RECEIVING_DISABLED', message:'เมนูรับสินค้าแบบเดิมปิดการใช้งานแล้ว กรุณาใช้ระบบรับสินค้าใหม่ (รับสินค้า / อ่านบิล)' }` โดยไม่ถึง controller; GET ยังใช้ได้
4. หลังจากนั้นค่อยลบหน้า `ReceiveOrders`, ฟังก์ชันใน `client/src/api/orders.js` / `admin.js` และ `getPendingReceivingReminderSummary` (งานแยก)

เทสต์ที่พิสูจน์ว่าสลับค่าเป็น `false` ได้ 410 จริง: `server/tests/legacy-receiving-rollout.test.mjs` (โหลดไฟล์ config/middleware/route จริง แล้วแทนค่าคงที่ตัวเดียว)

## ย้อนกลับระยะที่ 1
revert commit นี้ -- ไม่มี schema/ข้อมูลเปลี่ยน
