# ความคืบหน้า (สรุปสำหรับกลับมาทำต่อ)

วันที่บันทึก: 2026-02-05

## สิ่งที่ทำแล้ว (ล่าสุด)
- เพิ่มหน้า “รับสินค้า” สำหรับผู้ใช้ (`/order/receive`)
  - UI คล้ายหน้าเดินซื้อของ (จัดกลุ่มตามซัพพลายเออร์)
  - แสดงเป็นบรรทัดเดียวบนมือถือ + ช่องกรอก “รับจริง”
  - มีปุ่ม ✓ เติมจำนวนรับจริงตามที่สั่ง
  - บันทึกทีละซัพพลายเออร์เท่านั้น (ตัดปุ่มบันทึกทั้งหมดออก)
  - หลังบันทึกแล้วแก้ไขไม่ได้ (ช่องถูก disable หากมี `received_at`)
  - เลือกขอบเขตได้: เฉพาะของฉัน หรือทั้งสาขา (`scope=branch`)
- เมนู user เพิ่มแท็บ “รับสินค้า” ในแถบนำทาง (แยกจาก “สั่งซื้อสินค้า”)
- ย้ายปุ่ม “รับสินค้า” ไปอยู่หน้าเลือกฟังก์ชั่น (`/`) แทนเมนูสั่งซื้อ
- เพิ่ม API สำหรับรับของ:
  - `GET /api/orders/receiving`
  - `PUT /api/orders/receiving`
- เพิ่มฟิลด์รับสินค้าใน `order_items` และ auto‑alter ผ่าน `ensureOrderReceivingColumns`
- เดินซื้อของ (Admin): พิมพ์สำหรับบัญชีเป็นเอกสาร A4 แนวตั้ง (1 หน้า) + ช่องลายเซ็น + สรุปยอด
- เดินซื้อของ (Admin): ถอดการเติมรายการ “ค่ารถเข็น” อัตโนมัติออกจากหน้าเดินซื้อของ
- ฝ่ายผลิต (SUP003) ใช้หน้าเดียวกับ “ประวัติคำสั่งซื้อ” (admin history)
  - เส้นทาง `/production/print-orders`
  - ล็อกสิทธิ์เฉพาะผู้ใช้สาขาผลิตสันกำแพง
  - บันทึก log ทุกครั้งที่พิมพ์ลงตาราง `production_print_logs`
  - กรองเฉพาะรายการสินค้าของซัพ “ผลิตสันกำแพง”
- เพิ่มปุ่ม “ซิงค์ข้อมูลจาก Railway” ที่หน้า `/login` (เฉพาะ local)
  - ต้องกรอก PIN + พิมพ์ `SYNC`
  - API: `POST /api/auth/sync-railway` (ปิดใน production)

## สิ่งที่ทำแล้ว (ก่อนหน้า)
- หน้ารายการของประจำ (`/admin/settings/stock-templates`) เป็นตารางขนาดเล็ก + มีตัวกรองซัพพลายเออร์
- เพิ่มตัวเลือก "ไม่มี Max/Min" ต่อสินค้า และช่อง Min/Max แบบกรอกง่าย
- เพิ่มคอลัมน์ "กรอกทุกวัน" สำหรับสินค้า (เก็บใน `stock_templates.daily_required`)
- หน้าประวัติคำสั่งซื้อ (พิมพ์ตามสาขา/ซัพพลายเออร์):
  - เรียงสาขาตามการเดินซื้อของเป็นลำดับ: ผลิตคันคลอง -> สาขาคันคลอง -> ผลิตสันกำแพง -> สาขาสันกำแพง
  - ตัดทศนิยม .0 ออก (เช่น 5.0 -> 5)
- เมนูหน้า "สั่งซื้อสินค้า": แสดงเฉพาะ "สั่งซื้อสินค้า" และ "การสั่งซื้อของฉัน" พร้อมปุ่มย้อนกลับ
- เพิ่มปุ่มย้อนกลับในหน้าเช็คสต็อกและเบิกสินค้า (รวมหน้าเช็คสต็อกที่ปิดการใช้งาน)
- หน้าเช็คสต็อก: สินค้าแบบ "กรอกทุกวัน" ต้องกรอกเสมอ ส่วนสินค้าไม่บังคับสามารถเว้นว่างได้ (ไม่คำนวณสั่งซื้อ)

## ไฟล์ที่แก้ไขหลัก
- `client/src/pages/user/ReceiveOrders.jsx`
- `client/src/components/layout/Navigation.jsx`
- `client/src/pages/user/ProductList.jsx`
- `client/src/App.jsx`
- `client/src/api/orders.js`
- `client/src/api/admin.js`
- `client/src/api/auth.js`
- `client/src/pages/auth/Login.jsx`
- `client/src/pages/admin/AdminSettings.jsx`
- `server/src/controllers/orders.controller.js`
- `server/src/controllers/admin.controller.js`
- `server/src/controllers/auth.controller.js`
- `server/src/routes/orders.routes.js`
- `server/src/routes/admin.routes.js`
- `server/src/routes/auth.routes.js`
- `server/src/services/db-sync.service.js`
- `server/src/models/order.model.js`
- `client/src/pages/admin/masters/StockTemplateManagement.jsx`
- `client/src/pages/admin/OrderHistory.jsx`
- `client/src/components/layout/Navigation.jsx`
- `client/src/pages/user/StockCheck.jsx`
- `client/src/pages/user/Cart.jsx`
- `client/src/pages/user/OrderHistory.jsx`
- `client/src/pages/user/FunctionSelect.jsx` (ใหม่)
- `client/src/pages/user/Withdraw.jsx` (ใหม่)
- `client/src/api/stock-check.js`
- `server/src/models/stock-check.model.js`
- `server/src/controllers/stock-check.controller.js`
- `server/database/schema.sql`

## หมายเหตุสำคัญ
- เพิ่มคอลัมน์ `daily_required` ใน `stock_templates` (มี auto-alter ใน model)
- ฟีเจอร์รับสินค้าเพิ่มคอลัมน์ใน `order_items` ผ่าน `ensureOrderReceivingColumns` (ต้องรีสตาร์ท backend หลังอัปเดต)
- ต้องรีสตาร์ท backend หลังอัปเดตโครงสร้างเพื่อให้คอลัมน์ใหม่ถูกสร้าง

## สถานะ Git ตอนนี้
มีไฟล์ที่ยังไม่ได้ commit/push:
- `AI_GUIDE.md`
- `PROGRESS.md`
- `client/src/pages/user/ReceiveOrders.jsx`
- `client/src/pages/user/ProductList.jsx`
- `client/src/components/layout/Navigation.jsx`
- `client/src/App.jsx`
- `client/src/api/orders.js`
- `client/src/api/admin.js`
- `client/src/api/stock-check.js`
- `client/src/pages/admin/OrderHistory.jsx`
- `client/src/pages/admin/masters/StockTemplateManagement.jsx`
- `client/src/pages/user/Cart.jsx`
- `client/src/pages/user/OrderHistory.jsx`
- `client/src/pages/user/StockCheck.jsx`
- `client/src/pages/user/FunctionSelect.jsx`
- `client/src/pages/user/Withdraw.jsx`
- `server/database/schema.sql`
- `server/src/controllers/orders.controller.js`
- `server/src/controllers/admin.controller.js`
- `server/src/controllers/stock-check.controller.js`
- `server/src/routes/orders.routes.js`
- `server/src/routes/admin.routes.js`
- `server/src/models/order.model.js`
- `server/src/models/stock-check.model.js`
