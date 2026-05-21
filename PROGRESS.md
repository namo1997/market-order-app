# ความคืบหน้า (สรุปสำหรับกลับมาทำต่อ)

วันที่บันทึกล่าสุด: 2026-05-21

## อัปเดตล่าสุด (2026-05-21)
- อัปเดตเอกสารสำหรับ AI ถัดไป โดยไม่แก้โค้ดแอป
- ยืนยันว่า worktree มีงานค้างหลายไฟล์ทั้ง frontend/backend และมีไฟล์ `.md` ถูกแก้อยู่ก่อนแล้ว จึงห้าม revert งานคนอื่น
- ปรับ `AI_GUIDE.md` ให้สรุปสถานะล่าสุดของ:
  - ระบบสั่งซื้อหลัก `/order`, `/admin/purchase-walk`, `/order/receive`
  - ระบบคลังและ PO คลัง `/purchase-orders`
  - ระบบ `general-purchase` สำหรับ PR/PO ทั่วไปที่ไม่เข้าสต็อก
  - LINE/Discord notification และ chatbot
  - ClickHouse read-only, Railway deploy, GitHub remote/workflow
- เพิ่มสรุปใน `README.md` ให้คนเปิด repo เห็นภาพรวมปัจจุบันทันที เพราะรายละเอียดเดิมบางส่วนยังอิงเวอร์ชันเริ่มต้น
- เพิ่มหมายเหตุใน `AI_DATABASE_SCHEMA.md` ว่า ClickHouse เป็น POS read-only และ MySQL เป็นฐานเขียนจริงของแอป พร้อมตารางกลุ่มสำคัญ

## สถานะระบบล่าสุดที่ควรจำ
- MySQL เป็นฐานข้อมูลหลักของแอป ใช้เขียนคำสั่งซื้อ รับสินค้า เดินซื้อ คลัง PR/PO และ setting
- ClickHouse ใช้อ่านยอดขาย POS เท่านั้น ห้ามแก้ข้อมูล และควร filter `shopid`, `transflag = 44`, branch/date ให้ชัด
- ระบบสั่งซื้อประจำวันใช้ `orders`/`order_items`; รับสินค้าเข้าสต็อกจาก `/order/receive`; เดินซื้อใส่จำนวนซื้อจริง/ราคาจริงที่ `/admin/purchase-walk`
- ระบบ PO คลังที่ `/purchase-orders` รับแล้วสร้าง `inventory_transactions` source `purchase_order`
- ระบบ `general-purchase` แยกจากคลัง ไม่สร้าง movement และใช้ตาราง `general_purchase_orders`, `general_purchase_order_items`, `general_purchase_order_logs`
- `general-purchase` ใช้ header `x-general-purchase-token`; หัวหน้างานสร้าง PR ผ่าน employee token exchange ส่วน approve/issue/receive ใน backend ต้องใช้ session mode `operator`
- ตั้งค่าหน่วยซื้อรายสินค้าอยู่ที่ `/admin/settings/product-units` และ API `/api/product-unit-settings`
- LINE chatbot ใช้ `/api/line/webhook`, มี `/api/line/test-command`, จำบริบทใน `chatbot_memories`, log ใน `chatbot_query_logs`
- Discord interaction ใช้ `/api/discord/interactions`; slash command register ด้วย `npm --prefix server run discord:register-commands`
- Railway deploy service `market-order-app`; `Dockerfile` build client และให้ Express serve static ด้วย `SERVE_CLIENT=true`
- GitHub remote คือ `https://github.com/namo1997/market-order-app.git`; ยังไม่พบ `.github/workflows` ใน repo นี้

## อัปเดตล่าสุด (2026-05-03)
- อัปเดต `AI_GUIDE.md` ให้ตรงกับ flow ล่าสุดของหน้าเดินซื้อของและรับสินค้า
- เพิ่ม/ยืนยัน flow เชื่อม `เพิ่มสินค้านอกใบสั่ง` จาก `/order/receive` กลับไป `/admin/purchase-walk`
  - เมื่อเพิ่มสินค้านอกใบสั่งจากหน้ารับสินค้า ระบบสร้าง `order_items` เพื่อรับเข้าเหมือนเดิม
  - พร้อมสร้าง mirror ใน `purchase_walk_manual_items`
  - mirror ใช้ `receiving_order_item_id` เพื่อเชื่อมกลับรายการรับเดิมและลดความเสี่ยงซ้ำ
  - ฝ่ายเดินซื้อของจะเห็นรายการนั้นใน `/admin/purchase-walk` เพื่อใส่จำนวน/ราคา
- ปรับหน้า `/admin/purchase-walk` ตอน `+ เพิ่มสินค้า`
  - ต้องเลือกสาขาและแผนก
  - รายการที่เพิ่มจากหน้าเดินซื้อของจะไปสร้างรายการรอรับในแผนกนั้นผ่าน order/purchase-walk flow
- เพิ่มปุ่ม `อิงตามการรับ` ในหน้าเดินซื้อของ
  - ค่าเริ่มต้นของจำนวนไกด์ยังอิงตามจำนวนสั่ง
  - เมื่อกด `อิงตามการรับ` จะเปลี่ยนจำนวนไกด์ของรายการที่ยังไม่บันทึกให้เท่าจำนวนรับจริง
  - ปุ่มจะสลับเป็น `อิงตามสั่ง` เพื่อเปลี่ยนกลับได้
  - ระบบไม่แก้ข้อมูลจริงจนกด `✓`
- เพิ่ม guard ให้ปุ่ม `อิงตามการรับ`
  - ก่อนอิงตามการรับ ระบบเช็คว่ารายการในกลุ่มนั้นกดรับจริงแล้วหรือยัง
  - นิยามยังไม่กดรับคือ `received_quantity IS NULL`
  - ถ้าผู้ใช้กดรับเป็น `0` ถือว่าเป็นการรับจริง ไม่ใช่ยังไม่รับ
  - สินค้าที่เปิด `allow_pending_carryover` หรือค้างรับข้ามวันได้ จะไม่บล็อกปุ่มนี้
  - ถ้ายังมีรายการไม่กดรับ ระบบแจ้งสินค้า สาขา แผนก และจำนวนสั่ง เพื่อให้ฝ่ายใส่ราคาไปตามให้กดรับก่อน
- เพิ่มข้อมูลจาก backend ให้หน้าเดินซื้อของรู้:
  - `order_items.is_received`
  - `products.allow_pending_carryover`
- ตรวจพบตัวอย่างความต่างยอดใน `ตลาดสด`
  - `รวม ฿10,140` คือมูลค่าซื้อจริง
  - `มูลค่ารับรวม ฿10,107` คือมูลค่าตามจำนวนรับจริง
  - ส่วนต่าง `฿33` มาจาก `ปลาดุก` สาขาสันกำแพง/แผนกครัว ซื้อ 5 กก. รับ 4.4 กก. ราคา 55 บาท/กก.
- ยืนยัน `ค่าที่จอดรถ`
  - ถูกเก็บเป็นสินค้า `PRD366` ชื่อ `จอดรถ`
  - อยู่กลุ่ม `ตลาดสด`
  - มักลงที่ `สาขาผลิตคันคลอง / แผนกครัว`
  - ยังไม่ได้แยกเป็นค่าใช้จ่ายกลาง
- Build ตรวจล่าสุดผ่าน:
  - `node --check server/src/models/admin.model.js`
  - `npm --prefix client run build`
- อัป Railway ล่าสุดแล้วด้วย `railway up --service market-order-app --detach`

## อัปเดตล่าสุด (2026-04-30)
- อัปเดตเอกสารหลักสำหรับ AI ตัวอื่นใน `AI_GUIDE.md` ให้ตรงกับระบบปัจจุบัน
- ยืนยันภาพรวมฐานข้อมูลปัจจุบัน:
  - MySQL เป็นฐานหลักของแอป ใช้เขียนข้อมูลจริง เช่นสินค้า คำสั่งซื้อ รับสินค้า เดินซื้อของ สต็อก เบิก โอน แปรรูป และรายงาน
  - ClickHouse เป็นแหล่งยอดขาย POS แบบ read-only ใช้ดูยอดขายและตัดสต็อกตามสูตร ห้ามแก้ข้อมูล
- สถานะระบบปัจจุบันที่ต้องจำ:
  - `product_groups` คือกลุ่มสินค้า
  - `supplier_masters` คือซัพพลายเออร์จริง
  - สินค้า 1 ตัวอยู่ได้หลายกลุ่ม และอาจมีหลายซัพพลายเออร์
  - งานที่กระทบสต็อกต้องมีผลต่อ `inventory_transactions` และ `inventory_balance`
  - งานขายจาก POS ต้องอิง ClickHouse โดยใช้กฎขายจริง และเชื่อมสูตรจาก MySQL
- เพิ่มสรุป flow ปัจจุบันในเอกสาร:
  - สั่งซื้อสินค้า
  - เดินซื้อของ
  - รับสินค้าและค้างรับ
  - เช็คสต็อกและปรับยอด
  - คลังสินค้าและบัตรคุมสต็อก
  - เบิก/โอนสินค้า
  - แปรรูปสินค้าและวัตถุดิบหลัก
  - รายงานซื้อ ราคา ยอดขาย และแจ้งเตือน
- เพิ่มหน้า `สถานะกลางคำสั่งซื้อ` ที่ `/admin/settings/purchase-order-status`
  - เป็นหน้าอ่านอย่างเดียวสำหรับตรวจรายการสั่งซื้อทั้งวงจร
  - รวมข้อมูล สั่งซื้อ / ซื้อจริง / รับจริง / ราคา / สาขา / แผนก / กลุ่มสินค้า ในรายการเดียว
  - เพิ่ม API `GET /api/admin/reports/purchase-order-status-ledger`
  - ใช้สถานะกลาง: ยังไม่เดินซื้อ, ยังไม่ใส่ราคา, ยังไม่รับ, รับขาด, รับเกิน, ครบ
- เพิ่มข้อควรระวังสำหรับ AI/ทีมงาน:
  - ห้าม revert งานค้างใน worktree ถ้าไม่ได้รับคำสั่ง
  - ห้าม commit temporary scripts/output โดยไม่ตั้งใจ
  - ถ้า Railway เจอ unknown column ให้เช็ค schema production ก่อน
  - ถ้า API local 404 หลังแก้ route ให้รีสตาร์ต backend ก่อนสรุปว่าโค้ดผิด

## ประวัติเก่า (2026-02-24)

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

## Update 2026-05-21
- อัปเดตเอกสารสำหรับ AI ตัวถัดไปให้เข้าใจสถานะระบบล่าสุด:
  - ระบบสั่งซื้อ/รับสินค้า/เดินซื้อของ
  - inventory และ stock card
  - การใช้ `source_product_group_id` เพื่อกันสินค้าชนิดเดียวกันไปรวมผิดกลุ่ม
  - ระบบ PR/PO ทั่วไปที่ไม่เกี่ยวกับสต๊อก
  - Discord/LINE chatbot และ notification
  - Railway/GitHub workflow
- เพิ่ม `.gitignore` กันไฟล์ชั่วคราวที่พบบ่อย เช่น `.tmp-*`, `.cache/`, `output/`, log files เพื่อป้องกันการ commit ไฟล์ไม่เกี่ยวข้อง
- สถานะสำคัญล่าสุด:
  - Local login branch API ตรวจแล้ว `/api/auth/branches` ตอบปกติ
  - Railway CLI อาจต้อง `railway login` ใหม่ หากเจอ `Unauthorized`
  - ClickHouse ใช้ตรวจยอดขายแบบ read-only เท่านั้น
