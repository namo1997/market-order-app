# ความคืบหน้า (สรุปสำหรับกลับมาทำต่อ)

วันที่บันทึก: 2026-02-17

## อัปเดตล่าสุด (2026-02-24)
- เพิ่ม Chat API เฟส 1 (คำถามมาตรฐาน) ใต้ `/api/ai/chat/*`
  - `GET /api/ai/chat/intents`
  - `POST /api/ai/chat/query`
  - `GET /api/ai/chat/query-logs` (admin only)
- เพิ่มชั้นรายงานสำหรับแชทแบบ flatten
  - `ai_report_inventory_balance_flat`
  - `ai_report_department_stock_check_status`
  - `ai_report_receiving_flat`
- เพิ่ม query log สำหรับ AI chat
  - table: `ai_chat_query_logs`
  - บันทึก `intent`, `question`, `params_json`, `response_json`, `status`, `duration_ms`
- ล็อก read-only สำหรับ AI chat query
  - ใช้ read-only transaction
  - ไม่รับ SQL ดิบจากผู้ใช้ และป้องกันคำสั่งแก้ไขข้อมูลด้วย SQL guard
- เพิ่ม API client helper:
  - `client/src/api/ai.js`: `getChatIntents`, `queryStandardChat`, `getChatQueryLogs`
- เพิ่มหน้าแอดมิน `แชทมาตรฐาน (AI)` ที่ `/admin/settings/ai-standard-chat`
  - เลือก intent มาตรฐาน + กรองสาขา/แผนก + ดูผลและ query log ได้
- วางโครง NL2SQL safe mode:
  - endpoint whitelist/dry-run/query/audit-logs
  - จำกัด query เฉพาะ whitelist views
  - ต้อง `force_execute=true` ตอน execute
  - เก็บ audit ลง `ai_nl2sql_audit_logs`
- เพิ่มสคริปต์สร้าง read-only DB user:
  - `npm --prefix server run setup:ai-readonly-user`

## สิ่งที่ทำแล้ว (ล่าสุดมาก - สำคัญ)
- ปรับโครงสร้างชื่อข้อมูลให้ชัดเจน:
  - `product_groups` = กลุ่มสินค้า
  - `supplier_masters` = ซัพพลายเออร์จริง
- แยกตรรกะ “กลุ่มสินค้า” ออกจาก “ซัพพลายเออร์จริง” ในโค้ดหลักแล้ว

- ทำ DB Cleanup จริง (เฟส 3A + 3B) สำเร็จ
  - เฟส 3A: เพิ่ม `product_group_id` ในตาราง scope + sync สำเร็จ
  - เฟส 3B: ตัด legacy สำเร็จ
    - ลบ `products.supplier_id`
    - ลบ `product_group_scopes.supplier_id`
    - ลบ `product_group_internal_scopes.supplier_id`
    - ลบ view `suppliers` (compatibility view)

- เพิ่มสคริปต์ migration/check/rollback สำหรับงาน cleanup
  - `server/scripts/check-legacy-cleanup-readiness.js`
  - `server/scripts/migrate-product-group-scope-columns.js`
  - `server/scripts/rollback-product-group-scope-columns.js`
  - `server/scripts/migrate-drop-supplier-legacy.js`
  - `server/scripts/rollback-drop-supplier-legacy.js`
  - `server/scripts/check-post-drop-supplier-legacy.js`

- เพิ่มเอกสารแผน cleanup แบบเฟส + rollback
  - `server/database/migrations/LEGACY_CLEANUP_CHECKLIST.md`

- ผลตรวจล่าสุด
  - `check:legacy-cleanup` ผ่านก่อนตัด
  - `check:post-drop-supplier-legacy` ผ่านหลังตัด
  - `npm --prefix client run build` ผ่าน

- ยืนยันบน Railway (production) วันที่ 2026-02-17
  - รัน `migrate:scope-product-groups` แล้ว
  - รัน `migrate:drop-supplier-legacy` แล้ว
  - รัน `check:post-drop-supplier-legacy` ได้ผล `9 passed, 0 failed`
  - backup ที่สร้างใน Railway DB:
    - `bak_prod_drop_sup_20260217065705`
    - `bak_pgs_drop_sup_20260217065705`
    - `bak_pgis_drop_sup_20260217065705`
    - `bak_sview_drop_sup_20260217065705`
  - smoke test API หลัง cleanup ผ่าน:
    - `/api/auth/login`
    - `/api/products`
    - `/api/orders/receiving`
    - `/api/stock-check/my-template`
    - `/api/admin/orders`

## คำสั่งสำคัญ (สำหรับ AI ถัดไป)
- ตรวจความพร้อมก่อน cleanup:
  - `npm --prefix server run check:legacy-cleanup`
- ตรวจหลังตัด legacy:
  - `npm --prefix server run check:post-drop-supplier-legacy`
- rollback ส่วนที่ตัด legacy:
  - `npm --prefix server run rollback:drop-supplier-legacy`
- rollback scope migration:
  - `npm --prefix server run rollback:scope-product-groups`

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
