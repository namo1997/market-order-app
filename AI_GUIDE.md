# AI Collaboration Guide (Market Order App)

เอกสารนี้สรุปทุกประเด็นหลักของโปรเจค เพื่อให้ AI/ทีมงานหลายหน่วยเข้าใจระบบได้ครบและทำงานร่วมกันได้ทันที

## เป้าหมายระบบ (ภาพรวม)
- ระบบสั่งซื้อสินค้าและเช็คสต็อกสำหรับหลายสาขา/หลายแผนก
- แอดมินส่วนกลางดูยอดรวม/พิมพ์รายงาน/เดินซื้อของตามซัพพลายเออร์
- พนักงานทั่วไปสั่งสินค้าและเช็คสต็อกตามรายการของประจำของแผนก

## โครงสร้างโปรเจค
- `client/` : Frontend (React + Vite + Tailwind)
- `server/` : Backend (Node.js + Express + MySQL)
- `mobile/` : โปรเจคมือถือ (ยังไม่อัป GitHub ตอนนี้)

## บทบาทผู้ใช้ (Roles)
- `admin` : แอดมินของ “สาขาส่วนกลาง”
- `user` : แผนกทั่วไปในสาขาต่างๆ
- การ login เลือก “สาขา -> แผนก” แล้วระบบสร้าง user ของแผนกอัตโนมัติ

## การทำงานหลัก (Core Flows)
1) Login
   - เลือกสาขา -> เลือกแผนก -> ได้ JWT token
   - เข้าหน้าเลือกฟังก์ชั่น (สั่งซื้อ / เช็คสต็อก / เบิกสินค้า)
2) สั่งสินค้า (User)
   - เลือกวันที่ -> เพิ่มสินค้าเข้าตะกร้า -> ส่งคำสั่งซื้อ
3) เช็คสต็อก (User)
   - เลือกวันที่ -> กรอกจำนวนคงเหลือ -> ระบบคำนวณต้องสั่ง
4) รับสินค้า (User)
   - เลือกวันที่ -> โหลดรายการรับของ (เฉพาะคำสั่งซื้อของตัวเอง)
   - กรอก “รับจริง” ทีละรายการ (มีปุ่ม ✓ เพื่อเติมตามที่สั่ง)
   - บันทึกทีละซัพพลายเออร์ และแก้ไขไม่ได้หลังบันทึก
5) ประวัติคำสั่งซื้อ (User/Admin)
   - ดูย้อนหลัง + พิมพ์
6) เดินซื้อของ (Admin)
   - รวมรายการตามซัพพลายเออร์ -> กรอกจำนวน/ราคา -> บันทึกซื้อจริง
   - พิมพ์สำหรับบัญชี: เลือกซัพ 1 ราย, รูปแบบเอกสารบัญชี (A4 แนวตั้ง) + ช่องลายเซ็น
7) คำสั่งซื้อ (ฝ่ายผลิต SUP003)
   - ใช้หลักการเดียวกับหน้า “ประวัติคำสั่งซื้อ” (admin history)
   - พิมพ์ได้ และมีบันทึก log การพิมพ์
   - แสดงเฉพาะรายการของซัพ “ผลิตสันกำแพง”
7) ตั้งค่าระบบ (Admin)
   - จัดการสาขา/แผนก/สินค้า/หน่วย/ซัพพลายเออร์/รายการของประจำ

## Frontend (client)
โครงหลักอยู่ใน `client/src/pages`
- `auth/Login.jsx` : เลือกสาขา/แผนก แล้ว login
- `user/FunctionSelect.jsx` : หน้าเลือกฟังก์ชั่นของผู้ใช้งาน
- `user/FunctionSelect.jsx` เพิ่มปุ่ม “รับสินค้า” (ลิงก์ไป `/order/receive`)
- `user/ProductList.jsx` : หน้า “สั่งซื้อสินค้า” (หัวฟิกซ์, เลื่อนเฉพาะรายการสินค้า, ไม่มีเลื่อนซ้าย/ขวา) ใช้รายการสินค้าเฉพาะแผนก (`department_products`)
- `user/ReceiveOrders.jsx` : หน้า “รับสินค้า” (UI คล้ายเดินซื้อของซัพพลายเออร์, แสดงเป็นบรรทัดเดียว, ใส่จำนวนรับจริงเท่านั้น, บันทึกทีละซัพ)
  - เลือกขอบเขตรับสินค้าได้: เฉพาะของฉัน หรือทั้งสาขา (query `scope=branch`)
- หน้าฝ่ายผลิตใช้ `admin/OrderHistory.jsx` โดยตรงที่เส้นทาง `/production/print-orders`
- `user/StockCheck.jsx` : เช็คสต็อก, เลือกหมวดสินค้า, รองรับการปิดฟังก์ชั่น, สินค้าแบบ “กรอกทุกวัน” (`daily_required`)
- `user/Withdraw.jsx` : หน้าเบิกสินค้า (ยังเป็น placeholder)
- `user/OrderHistory.jsx` : ประวัติคำสั่งซื้อของพนักงาน

### Admin Pages
อยู่ใน `client/src/pages/admin`
- `OrdersToday.jsx` : รายการคำสั่งซื้อวันนี้ (ปุ่มลบ/รีเซ็ตถูกถอดออกแล้ว)
- `OrderHistory.jsx` : ประวัติคำสั่งซื้อ + พิมพ์ (รองรับ “ทุกรูปแบบ”)
- `PurchaseWalk.jsx` : เดินซื้อของตามซัพพลายเออร์ (ชื่อสินค้าแสดงเต็ม)
- `AdminSettings.jsx` : เมนูตั้งค่าระบบ (แสดงเฉพาะไอคอน + ชื่อเมนู) + ปุ่มเปิด/ปิดฟังก์ชั่นเช็คสต็อก

### Masters / ตั้งค่าระบบ
อยู่ใน `client/src/pages/admin/masters`
- `ProductManagement.jsx` : เพิ่มสินค้า (หน่วยนับพิมพ์ค้นหาได้, ซัพพลายเออร์เลือกจาก dropdown)
- `SupplierManagement.jsx` : เลือกสินค้าเดิมให้เข้าซัพพลายเออร์
- `DepartmentManagement.jsx` : ซ่อน/แสดงแผนก + ปุ่ม “ซ่อนทั้งหมด”
- `StockTemplateManagement.jsx` : รายการของประจำต่อแผนก + หมวดสินค้า
- `BranchManagement.jsx` : จัดการสาขา + ปุ่ม “ซิงก์ ClickHouse ID”
- `RecipeManagement.jsx` : ตั้งค่าสูตรเมนูจาก ClickHouse
- `UnitConversionManagement.jsx` : ตั้งค่าแปลงหน่วย
- `UsageReport.jsx` : รายงานใช้วัตถุดิบ (กดดูเมนูที่ใช้วัตถุดิบได้)
- `SalesReport.jsx` : รายงานยอดขาย + ค้นหา + AI Chat

### Context / State สำคัญ
- `client/src/contexts/AuthContext.jsx`
  - เก็บ token + user ใน `sessionStorage`
  - ย้าย token จาก `localStorage` ไป `sessionStorage` ถ้ามี
- `client/src/contexts/CartContext.jsx`
  - ตะกร้าสินค้า, จำนวน, ราคา, หมายเหตุสินค้า, วันที่สั่ง

### พิมพ์ (Print)
- `admin/OrderHistory.jsx` มีตัวเลือกพิมพ์
  - `department`, `branch`, `supplier`, และ `all`
  - `all` จะพิมพ์ครบทุกหมวดในครั้งเดียว
- `admin/PurchaseWalk.jsx` พิมพ์สำหรับบัญชีแบบเอกสารรับสินค้า/บันทึกซื้อ (A4 แนวตั้ง, 1 หน้า, มีช่องลายเซ็น)
- `user/ProductionPrintOrders.jsx` พิมพ์สำหรับฝ่ายผลิต (เลือกสาขา/แผนก/วันที่ + watermark)

## Backend (server)
โครงหลักอยู่ใน `server/src`
- `server.js` : Express app + CORS
- `routes/` : เส้นทาง API
- `controllers/` : รับ request/response
- `models/` : คุยกับ MySQL
- `middleware/` : auth + error handler

### จุดสำคัญของ API
- `auth` : เลือกสาขา/แผนก -> สร้าง user ของแผนกอัตโนมัติ
- `products` : `/products/meta/*` ต้องอยู่ก่อน `/:id` เพื่อไม่ชน route
- `stock-check` : มี feature toggle ผ่าน `system_settings`
- `admin` : รวมคำสั่งซื้อ, ปิด/เปิดรับออเดอร์, เดินซื้อของ
- `orders/receiving` : รับสินค้าเฉพาะคำสั่งซื้อของผู้ใช้ (Admin ถูก redirect ไม่ให้ใช้หน้า user)
- `orders/production/*` : Log การพิมพ์สำหรับฝ่ายผลิต (เฉพาะ SUP003)

### Routes ที่ใช้บ่อย (สรุป)
- `POST /api/auth/login`
- `GET /api/auth/branches`
- `GET /api/auth/departments/:branchId`
- `GET /api/products`
- `GET /api/products/meta/units`
- `GET /api/products/meta/suppliers`
- `POST /api/orders`
- `GET /api/orders/:id`
- `GET /api/orders/receiving`
- `PUT /api/orders/receiving`
- `POST /api/orders/production/print-log`
- `GET /api/admin/orders`
- `GET /api/admin/orders/items`
- `PUT /api/admin/purchases/by-product`
- `GET /api/stock-check/my-template`
- `GET /api/stock-check/my-check?date=YYYY-MM-DD`
- `POST /api/stock-check/my-check`
- `GET /api/stock-check/admin/status`
- `PUT /api/stock-check/admin/status`
- `GET /api/recipes`
- `GET /api/recipes/usage`
- `GET /api/reports/sales`
- `POST /api/ai/sales-report`
- `POST /api/branches/sync-clickhouse`

## Database (MySQL)
อยู่ใน `server/database/schema.sql`

### ตารางหลัก
- `branches`, `departments`, `users`
- `units`, `suppliers`, `products`
- `orders`, `order_items`, `order_status_settings`
- `order_items` มีฟิลด์รับสินค้า: `received_quantity`, `received_by_user_id`, `received_at`, `receive_notes`, `is_received`
- `stock_categories`, `stock_templates` (มี `min_quantity`, `daily_required`), `stock_checks`, `department_products`
- `system_settings` (เก็บ `stock_check_enabled`)

### ความสัมพันธ์หลัก
- `departments.branch_id -> branches.id`
- `users.department_id -> departments.id`
- `products.unit_id -> units.id`
- `products.supplier_id -> suppliers.id`
- `orders.user_id -> users.id`
- `order_items.order_id -> orders.id`
  - `order_items.received_by_user_id -> users.id`
- `stock_templates.department_id -> departments.id`
- `department_products.department_id -> departments.id`
- `stock_templates.product_id -> products.id`
- `stock_categories.department_id -> departments.id`
- `branches.clickhouse_branch_id` ใช้สำหรับรายงานยอดขาย

## Feature Toggles / Settings
- `system_settings.stock_check_enabled`
  - `true` = เปิดหน้าเช็คสต็อก
  - `false` = user จะเห็นข้อความว่า “ปิดการใช้งานชั่วคราว”

## CSV Import / Export
การนำเข้า/ดาวน์โหลดทำผ่านแต่ละหน้า master โดยตรง (ไม่มีเทมเพลตในหน้า AdminSettings แล้ว)

## พฤติกรรม UI สำคัญ
- หน้า “สั่งซื้อสินค้า” ไม่มีการเลื่อนแนวนอน
- กดการ์ดสินค้าเพิ่มจำนวนได้ทันที
- มีช่องหมายเหตุในรายการสั่งซื้อ
- “เดินซื้อของ” แสดงชื่อสินค้าแบบเต็ม
- รายงานยอดขายมี AI Chat ถามจากข้อมูลรายงานที่โหลดไว้เท่านั้น
- รายงานใช้วัตถุดิบสามารถกดดูเมนูที่ใช้วัตถุดิบได้

## Environment / Config
Backend `.env` (ตัวอย่าง):
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `PORT`, `HOST`
- `CORS_ORIGIN`
- `RAILWAY_DB_URL` (ใช้ซิงค์ฐานข้อมูลเฉพาะเครื่อง local)
- ClickHouse: `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_SHOP_ID`, `CLICKHOUSE_TZ_OFFSET`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`

Frontend `.env`:
- `VITE_API_URL=http://localhost:8000/api`

## การรันในเครื่อง
Backend:
```
npm --prefix server start
```
Frontend:
```
npm --prefix client run dev
```

## Deploy
- ใช้ Railway (`railway up`)
- ถ้าเปลี่ยนฐานข้อมูล ต้องอัปเดต schema/ข้อมูลให้ตรงกับ Railway
- CORS รองรับหลาย origin

## Known Pitfalls / ข้อควรระวัง
- ถ้าเพิ่ม route `/meta/*` ต้องวางก่อน `/:id`
- `mobile/` ถูก ignore ใน Git
- ปิดฟังก์ชั่นเช็คสต็อกจะตอบ 403 ใน user routes ของ stock-check
- ถ้าปุ่มหรือ dropdown หาย ให้เช็คว่า backend รีสตาร์ตแล้วหรือไม่
- ฟีเจอร์รับสินค้าเพิ่มคอลัมน์ใน `order_items` อัตโนมัติผ่าน `ensureOrderReceivingColumns` (ต้องรีสตาร์ท backend หลังอัปเดต)
- ปุ่ม “ซิงค์ข้อมูลจาก Railway” จะแสดงเฉพาะ local (`/login`) และ endpoint ถูกปิดใน production
- ClickHouse ใช้แบบ read-only ห้ามแก้ข้อมูล

## แนวทางการทำงานร่วมกัน
- อัปเดตไฟล์นี้เมื่อเพิ่มฟังก์ชั่นใหม่
- ถ้าแก้ API ให้ระบุ endpoint ที่เปลี่ยน
- ระบุไฟล์ที่แก้หลักๆ เพื่อให้ทีมตามง่าย
