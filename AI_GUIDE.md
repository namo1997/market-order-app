# AI Collaboration Guide (SOLAO Market Order App)

เอกสารนี้เป็นไฟล์หลักสำหรับให้ AI หรือทีมงานคนถัดไปอ่านก่อนแก้โปรเจค

อัปเดตล่าสุด: 2026-05-21

## กติกาสำคัญ

- อ่านโครงสร้างจริงในโค้ดก่อนแก้ทุกครั้ง อย่าเดาจากชื่อไฟล์หรือชื่อเก่า
- ห้ามลบหรือ revert งานค้างใน worktree ถ้าไม่ได้รับคำสั่งชัดเจน
- ห้ามแก้ข้อมูลใน ClickHouse เด็ดขาด ใช้อ่านยอดขาย POS เท่านั้น
- งานที่กระทบสต็อกต้องคิดผลต่อ `inventory_transactions` และ `inventory_balance` เสมอ
- ระบบ production อยู่ Railway service `market-order-app`
- ก่อน deploy ควร build ฝั่ง client อย่างน้อยด้วย `npm --prefix client run build`
- `general-purchase` คือระบบ PR/PO แยกขาดจากระบบสั่งซื้อหลัก (`/order`, `/purchase-orders`) ห้ามใช้ตารางหรือ workflow ปนกัน

## ภาพรวมระบบ

ระบบนี้คือ SOLAO market order app สำหรับร้านอาหารหลายสาขา ใช้จัดการ:

- สั่งซื้อสินค้าโดยสาขา/แผนก
- รับสินค้าและรับอัตโนมัติ
- เดินซื้อของ ใส่จำนวนซื้อจริงและราคา
- เช็คสต็อก นับจริง และปรับยอดคงเหลือ
- คลังสินค้า ยอดคงเหลือ บัตรคุมสต็อก ประวัติการเคลื่อนไหว และ Stock Variance
- เบิก/โอนสินค้า ระหว่างแผนกหรือพื้นที่จัดเก็บ
- แปรรูปสินค้า รับเข้าสินค้าผลิต และตัดวัตถุดิบหลักถ้ามีการตั้งค่า
- รายงานซื้อ รับ เบิก โอน วัตถุดิบ ราคา และยอดขาย
- แจ้งเตือนผ่าน Discord/LINE ตาม flow ที่ตั้งค่าไว้

## สถานะล่าสุดที่ AI ควรรู้ (2026-05-21)

- ระบบหลักยังเป็น `orders`/`order_items` สำหรับสั่งซื้อประจำวัน, `/admin/purchase-walk` สำหรับเดินซื้อ, และ `/order/receive` สำหรับรับสินค้าเข้าสต็อก
- ระบบ PO คลังที่ `/purchase-orders` เป็น flow PO/รับสินค้าเข้าคลัง ใช้ตาราง `purchase_orders`, `purchase_order_items`, `purchase_order_receipts` และรับแล้วสร้าง `inventory_transactions` source `purchase_order`
- ระบบ `general-purchase` เป็น PR/PO ทั่วไปสำหรับของไม่เข้าสต็อก แยกจากระบบสั่งซื้อหลักและ PO คลัง ไม่สร้าง stock movement
- หน้า `general-purchase` ปัจจุบันมี hub/review/PO/awaiting/receive และใช้ token เฉพาะผ่าน header `x-general-purchase-token`
- สิทธิ์ `general-purchase` มี 2 ทางหลัก: exchange token จากระบบพนักงานสำหรับหัวหน้างานเพื่อสร้าง PR, หรือ PIN read-only สำหรับดูข้อมูล; action approve/issue/receive ใน backend ถูก guard ด้วย mode `operator`
- นำเข้าพนักงานจากระบบพนักงานเข้า `employee_refs` แล้ว ใช้ตรวจหัวหน้างานของ PR/PO ทั่วไป
- ตั้งค่าหน่วยซื้อรายสินค้าอยู่ที่ `/admin/settings/product-units` และ API `/api/product-unit-settings`; ใช้กับ supplier/product link และหน้า PO คลัง
- แจ้งเตือนรองรับทั้ง LINE และ Discord ผ่าน `/admin/settings/line-notifications`; provider ถูกเก็บใน `system_settings`
- Discord bot ใช้ endpoint raw body `/api/discord/interactions` และมี slash command ฝั่งยอดขาย เช่น `sales_daily`, `ask_sales`
- LINE chatbot ใช้ endpoint raw body `/api/line/webhook`, มี test endpoint `/api/line/test-command`, จำบริบทสนทนาใน `chatbot_memories`, และ log ใน `chatbot_query_logs`
- Railway ใช้ `Dockerfile` build client แล้วให้ Express serve static เมื่อ `SERVE_CLIENT=true`
- GitHub remote หลักคือ `origin https://github.com/namo1997/market-order-app.git`; ตอนนี้ไม่มี `.github/workflows` ใน repo นี้

## ฐานข้อมูลที่ใช้

### MySQL

MySQL คือฐานข้อมูลหลักของแอป ใช้เก็บข้อมูลที่ระบบเขียนจริง เช่น:

- ข้อมูลพื้นฐาน: `branches`, `departments`, `users`, `units`
- สินค้า: `products`, `product_groups`, `product_group_items`, `supplier_masters`
- คำสั่งซื้อ: `orders`, `order_items`
- เดินซื้อของ/ราคา: ตารางในกลุ่ม purchase walk/manual
- รับสินค้า: ฟิลด์รับสินค้าใน `order_items`
- เช็คสต็อก: `stock_checks`, `stock_templates`, `stock_categories`
- คลัง: `inventory_balance`, `inventory_transactions`
- เบิก/โอน: ตารางในกลุ่ม withdraw และ source mapping
- แปรรูป: ตาราง production transform และ recipe/config
- ตั้งค่าระบบ: `system_settings` และตาราง setting เฉพาะ feature

ไฟล์ connection หลัก: `server/src/config/database.js`

### ClickHouse

ClickHouse ใช้เป็นแหล่งยอดขาย POS แบบ read-only:

- ดูยอดขายสินค้า
- รายงานยอดขาย
- ตัดสต็อกจากยอดขายตามสูตร
- ตรวจเมนู/บิล/ราคาขาย POS

ไฟล์ service หลัก: `server/src/services/clickhouse.service.js`

ตารางหลักที่ใช้บ่อย:

- `doc` = หัวบิลขาย
- `docdetail` = รายการสินค้าในบิล
- `productbarcode` = รายการสินค้า/เมนู POS

กฎยอดขายจริง: ใช้ `transflag = 44` และต้องระวังรายการยกเลิก/void

รายละเอียด ClickHouse อยู่ที่ `AI_DATABASE_SCHEMA.md`

## โครงสร้างโปรเจค

- `client/` = React + Vite + Tailwind frontend
- `server/` = Node.js + Express + MySQL backend
- `server/database/schema.sql` = schema ตั้งต้น แต่ production มี migration/auto-alter หลายจุด
- `server/database/migrations/` = migration สำคัญ
- `server/scripts/` = script ตรวจ/ซ่อม/backfill/ทดลอง หลายไฟล์เป็น temporary script ต้องอ่านก่อนใช้

## Routing สำคัญ

### User

- `/` = เลือกฟังก์ชันตามสาขา/แผนก
- `/order` = สั่งซื้อสินค้า
- `/cart` = ตะกร้าสินค้า
- `/orders` = ประวัติคำสั่งซื้อของผู้ใช้
- `/order/receive` = รับสินค้า
- `/stock-check` = เช็คสต็อก
- `/withdraw` = เบิกสินค้า
- `/production/transform` = แปรรูปสินค้า
- `/inventory/my-stock` = ยอดคงเหลือแผนกฉัน
- `/purchase-orders` = รายการ PO คลัง
- `/purchase-orders/new` = สร้าง PO คลัง
- `/purchase-orders/:id` = รับสินค้า PO คลัง
- `/purchase-orders/history` = ประวัติ PO คลัง
- `/general-purchase` = สร้าง PR ทั่วไปสำหรับของไม่เข้าสต็อก
- `/general-purchase/hub` = hub PR/PO ทั่วไป
- `/general-purchase/review` = ตรวจ/อนุมัติ PR ทั่วไป
- `/general-purchase/po` = ออก PO ทั่วไป
- `/general-purchase/awaiting` = รายการรอรับ PR/PO ทั่วไป
- `/general-purchase/receive` = รับของและลงราคาจริง PR/PO ทั่วไป

### Admin / Super Admin

- `/admin/settings` = ตั้งค่าระบบ
- `/admin/settings/products` = จัดการสินค้า
- `/admin/settings/product-groups` = จัดการกลุ่มสินค้า
- `/admin/settings/suppliers` = จัดการซัพพลายเออร์จริง
- `/admin/settings/departments` = จัดการแผนก
- `/admin/settings/stock-categories` = หมวดเช็คสต็อก
- `/admin/settings/product-units` = ตั้งค่าหน่วยซื้อรายสินค้า
- `/admin/settings/recipes` = ตั้งค่าสูตรเมนูขายหน้าร้าน
- `/admin/settings/production-transform-recipes` = ตั้งค่าวัตถุดิบหลักก่อนแปรรูป
- `/admin/settings/purchase-report` = รายงานการซื้อ
- `/admin/settings/purchase-order-status` = สถานะกลางคำสั่งซื้อ
- `/admin/settings/price-report` = รายงานราคาสินค้า
- `/admin/settings/sales-report` = รายงานยอดขาย
- `/admin/settings/direct-order-rules` = ตั้งค่าสั่งตรงผู้ขายหลังเวลา
- `/inventory/rop` = จุดสั่งผลิต (ROP)
- `/admin/purchase-walk` = เดินซื้อของตามกลุ่มสินค้า
- `/admin/history` = ประวัติคำสั่งซื้อ/พิมพ์
- `/admin/reports` = รายงานเฉพาะ/monitor การทำงาน
- `/inventory` = dashboard ระบบคลัง
- `/inventory/movements` = ประวัติการเคลื่อนไหว
- `/inventory/balance` = ยอดคงเหลือ
- `/inventory/stock-card/:productId/:departmentId` = บัตรคุมสต็อก
- `/inventory/variance` = Stock Variance

## หลักการข้อมูลสินค้า

- `product_groups` คือกลุ่มสินค้า ไม่ใช่ซัพพลายเออร์
- `supplier_masters` คือซัพพลายเออร์จริง
- สินค้า 1 ตัวอยู่ได้หลายกลุ่ม
- สินค้า 1 ตัวมีซัพพลายเออร์ได้หลายรายตามโครงที่เพิ่มภายหลัง
- ราคาตั้งต้นอยู่ที่สินค้า ใช้เป็นราคาไกด์
- ราคาล่าสุดอิงจากราคาซื้อจริงล่าสุด หรือ override ตามปุ่มบังคับใช้ราคาตั้งต้น
- การแสดงสินค้าในหน้า order ใช้ scope ของกลุ่มสินค้าและแผนกผู้ใช้
- ถ้าสินค้าอยู่หลายกลุ่มที่ผู้ใช้เห็นได้ ต้องแยก source/group ให้ชัด ไม่รวมมั่วตาม product id อย่างเดียว

## กลุ่มสินค้าและพื้นที่จัดเก็บ

มีแนวคิดสำคัญ 2 แบบ:

- กลุ่มสินค้า = กลุ่มที่ใช้แสดง/สั่ง/เดินซื้อ/รายงาน
- พื้นที่จัดเก็บหรือ source = แหล่งที่สินค้าจะถูกเบิกหรือตัดออก

สำหรับสินค้าที่เบิกจากสโตร์หรือพื้นที่จัดเก็บ ควรยึด explicit source mapping ของกลุ่มสินค้าแทนการเดาจากชื่อกลุ่ม

ระวังเคสสินค้าตัวเดียวอยู่หลายกลุ่ม เช่น เครื่องดื่มคันคลอง/สันกำแพง ห้ามให้ข้ามโซนโดยไม่ได้ตั้งค่า

## Flow สั่งซื้อ

1. ผู้ใช้เลือกสาขา/แผนกตอน login
2. หน้า `/order` แสดงสินค้าตามกลุ่มที่ scope มาถึงแผนกนั้น
3. กดสินค้าเข้าตะกร้า กรอกจำนวน และส่งคำสั่งซื้อ
4. ระบบสร้าง `orders` และ `order_items`
5. ถ้าสินค้ามี direct order rule หลังเวลาที่กำหนด อาจเข้าสู่ flow สั่งตรงผู้ขาย
6. แจ้งเตือนคำสั่งซื้อผ่าน Discord/LINE ตาม setting

## Flow เดินซื้อของ

หน้า `/admin/purchase-walk` ใช้รวมรายการที่สั่งตามกลุ่มสินค้า เพื่อให้ฝ่ายจัดซื้อกรอก:

- จำนวนซื้อจริง
- ราคาซื้อจริง
- เหตุผลถ้าซื้อขาด/เกิน/สั่งนอกรอบ

หลักการราคา:

- จำนวน 0 ต้องไม่บังคับกรอกราคา
- ราคา 0 ไม่ควรบันทึกเป็นราคาซื้อจริง
- สินค้าเพิ่มนอกใบสั่งต้อง link กลับมาให้เดินซื้อใส่จำนวนและราคาได้
- รายงานเช็คซื้อ-รับรวมกลุ่มใช้เทียบสั่งซื้อ/ซื้อจริง/รับจริง
- ปุ่ม `อิงตามการรับ` ในหน้าเดินซื้อของใช้เปลี่ยนจำนวนไกด์จากจำนวนสั่งเป็นจำนวนรับจริง
- ก่อนอิงตามการรับ ต้องเช็คก่อนว่ารายการในกลุ่มนั้นกดรับแล้วหรือยัง
- เงื่อนไข “ยังไม่กดรับ” คือ `order_items.received_quantity IS NULL`
- ถ้าผู้ใช้กดรับเป็น `0` แล้ว ถือว่าเป็นการรับจริง ไม่ใช่ยังไม่รับ
- สินค้าที่เปิด `products.allow_pending_carryover = true` สามารถค้างรับข้ามวันได้และไม่ควรบล็อกปุ่มอิงตามการรับ
- ถ้ายังมีรายการที่ไม่กดรับ ระบบต้องแจ้งชื่อสินค้า สาขา แผนก และจำนวนสั่ง เพื่อให้คนใส่ราคาไปตามให้กดรับก่อน
- ยอด `รวม` ในหน้าเดินซื้อของคือมูลค่าซื้อจริง ส่วน `มูลค่ารับรวม` คือมูลค่าตามจำนวนรับจริง จึงอาจต่างกันได้ เช่นซื้อ 5 กก. รับ 4.4 กก.

## Flow รับสินค้า

หน้า `/order/receive` ใช้ให้แผนกรับสินค้า:

- บันทึกรับจริงทีละกลุ่มสินค้า
- ถ้ารับครบทุกตัวในกลุ่มแล้วค่อยส่งแจ้งเตือนรับสินค้า
- สินค้าที่รับจริงเท่านั้นที่เข้าสต็อก
- การรับ `0` คือรับจริงเป็นศูนย์ ต้องเก็บเป็น `received_quantity = 0`
- ห้ามใช้เงื่อนไข `received_quantity <= 0` เพื่อบอกว่ายังไม่รับ เพราะจะทำให้กรณีรับจริงเป็น 0 เพี้ยน
- ถ้ารับไม่ครบและสินค้าอนุญาตค้างรับข้ามวัน จะค้างรับต่อ
- ถ้าไม่อนุญาตค้างรับข้ามวัน ให้ปิดยอดขาดวันนี้
- งาน auto receive ปลายวันใช้กับกลุ่มที่ไม่ได้ปิด auto receive
- การเพิ่มสินค้านอกใบสั่งจากหน้ารับสินค้า ต้องสร้างรายการ mirror ไปที่ `purchase_walk_manual_items` ด้วย เพื่อให้หน้าเดินซื้อของใส่ราคาได้ภายหลัง
- mirror จากหน้ารับสินค้าใช้ `receiving_order_item_id` เพื่อกันซ้ำและเชื่อมกลับ order item เดิม

## Flow คลังสินค้า

ตารางหลัก:

- `inventory_transactions` = ประวัติทุกการเคลื่อนไหว
- `inventory_balance` = ยอดคงเหลือปัจจุบันต่อสินค้า/แผนก

ประเภท movement:

- `receive` = รับเข้า
- `sale` = ขายออกจาก POS ตามสูตร
- `adjustment` = ปรับปรุงจากนับจริง
- `transfer_in` = โอนเข้า
- `transfer_out` = โอนออก
- `initial` = ยอดตั้งต้น

กฎสำคัญ:

- ยอดคงเหลือคือระดับแผนก ไม่ใช่ยอดรวมทั้งระบบ
- บัตรคุมสต็อกคือรายการเคลื่อนไหวของสินค้าในแผนกนั้น
- การปรับปรุงจากนับจริงควรอิงเวลานับจริง ไม่ใช่เวลาที่กดตรวจทีหลัง
- ถ้ามีการ reflow/backfill movement ต้องระวังยอดก่อน/ยอดหลังในประวัติให้ต่อกัน

## Flow เช็คสต็อก

หน้า `/stock-check`:

- แสดงรายการตาม `stock_templates` และ `stock_categories`
- ใช้คีย์แพด/ตัวเลขเพื่อกันกรอกผิดบนมือถือ
- มีประวัติการเช็คสต็อก
- สามารถปรับยอดจากการนับจริง โดยทุก adjustment ต้องบันทึกลง `inventory_transactions`
- บางสินค้าถูกตั้งเป็นสินค้ามูลค่าสูง/ต้องนับพิเศษ

## Flow เบิก/โอน

หน้า `/withdraw`:

- แผนกต้นทางคือแผนกผู้ใช้งานปัจจุบัน
- เลือกสาขา/แผนกปลายทาง
- สินค้าเบิกต้องมาจากสินค้าที่ต้นทางมีสิทธิ์/มี source ถูกต้อง
- เมื่อบันทึก จะเกิด movement ออกต้นทางและเข้า destination ตามตรรกะที่กำหนด
- ระวังมากกับการข้ามพื้นที่เก็บ เช่น คันคลอง/สันกำแพง

## Flow แปรรูปสินค้า

หน้า `/production/transform`:

- ใช้กับแผนกฝ่ายผลิต
- กรอกจำนวนสินค้าปลายทางบนการ์ด
- หลังบันทึก สินค้าที่ผลิตได้จะรับเข้าแผนกนั้นทันที
- ถ้าสินค้านั้นถูกตั้งค่าวัตถุดิบหลักก่อนแปรรูป จะต้องกรอกวัตถุดิบที่ใช้
- วัตถุดิบหลักที่ใช้ถือเป็นการใช้ทันทีและตัดออกจากสต็อก ไม่ใช่การโอน
- ถ้าวัตถุดิบไม่พอ ระบบอนุญาตให้ติดลบได้ แต่ต้องแจ้งเตือนก่อนบันทึก
- มีประวัติการแปรรูปและพิมพ์ label

## Flow ยอดขาย POS และตัดสต็อกขาย

- ยอดขายมาจาก ClickHouse
- ตัดสต็อกขายจากสูตรเมนูที่ตั้งไว้ในระบบ MySQL
- ตัดเฉพาะสาขาที่ผูกกับ ClickHouse branch id
- ควรใช้เวลาขายจริงระดับบิล
- Job อัตโนมัติควรรันช่วงปิดร้าน เช่น 23:30 เวลาไทย และ retry ถ้าล่ม
- ถ้าดึงยอดขายไม่ได้ ต้องแจ้งเตือนในหน้า inventory

## รายงานสำคัญ

- `/admin/settings/purchase-report`
  - รายงานการซื้อจากหน้าเดินซื้อของ
  - เลือกช่วงวันที่, สาขา, แผนก, กลุ่มสินค้า
  - เลือกฐานจำนวน: ซื้อจริง หรือ รับเข้าจริง
  - เลือกฐานราคา: ราคาตั้งต้น, ราคาล่าสุด, ราคาในวันนั้น
  - กดดูรายละเอียดรายการสินค้า และ export CSV/Excel/PDF

- `/admin/settings/purchase-order-status`
  - หน้าสถานะกลางของรายการสั่งซื้อ
  - ใช้ตรวจรายการเดียวตั้งแต่สั่งซื้อ เดินซื้อ ใส่ราคา และรับสินค้า
  - เป็นหน้า read/report ไม่ใช่หน้าแก้ข้อมูล
  - สถานะหลัก: ยังไม่เดินซื้อ, ยังไม่ใส่ราคา, ยังไม่รับ, รับขาด, รับเกิน, ครบ
  - ใช้ช่วยหาจุดที่ทำให้ระบบเพี้ยนก่อนแก้ไขข้อมูลจริง

- `/admin/settings/price-report`
  - รายงานราคาล่าสุดและการเปลี่ยนแปลงราคา
  - ราคาล่าสุดควรเป็นราคาล่าสุดในระบบ ไม่จำกัดช่วงที่ filter
  - การเปลี่ยนแปลงเทียบกับราคาย้อนหลัง 1 เดือนหรือราคาใกล้เคียงถ้าไม่มีข้อมูลตรงวัน

- `/admin/purchase-walk`
  - มีเช็คซื้อ-รับรวมกลุ่ม
  - ใช้ตรวจว่าสั่งซื้อ ซื้อจริง และรับจริง ขาด/เกิน/ครบ

- `/inventory/*`
  - dashboard, movements, balance, stock card, variance

## Notification

ระบบมีทั้ง LINE และ Discord ในหลาย flow:

- คำสั่งซื้อใหม่/แก้ไข/ยกเลิก
- รับสินค้า เมื่อกดบันทึกรับของกลุ่มสินค้านั้นจริง
- รับอัตโนมัติ
- รายการค้างรับตามเวลา เช่น 13:00, 15:00, 17:00

กฎรับสินค้า:

- ถ้ายังไม่ครบทุกสินค้าในกลุ่ม ไม่ควรส่งแจ้งเตือนรับสินค้า
- แจ้งเฉพาะขาด/เกิน รายการครบไม่ต้องแตกบรรทัด
- ต้องระบุวันที่ เวลา สาขา จำนวนรายการ และรายละเอียดผิดปกติ

## Direct Order Rule

หน้า `/admin/settings/direct-order-rules` ใช้ตั้งค่าสินค้าที่ถ้าสั่งเกินเวลาจะส่งคำสั่งตรงไปผู้ขาย:

- ตั้งสินค้า
- ตั้งกลุ่ม
- ตั้งเวลา cutoff
- ตั้ง target group/channel
- หากสินค้าอยู่ group เดียวกัน ควรรวมคำสั่งซื้อก่อนส่ง

## ROP จุดสั่งผลิต

หน้า `/inventory/rop`:

- ใช้เฉพาะแผนกที่เกี่ยวข้องกับการผลิต
- คำนวณจากโอนออกเท่านั้น
- สูตร: `ROP = (ค่าเฉลี่ยใช้ต่อวัน * lead time วัน) + safety stock`
- เลือกช่วงย้อนหลัง 1, 2, 4 สัปดาห์
- ค่าเริ่มต้น lead time = 1 วัน, safety stock = 0.8 วัน
- ต้องเก็บ audit ว่าใครแก้ค่า เมื่อไร

## Environment สำคัญ

Backend:

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `PORT`, `HOST`, `CORS_ORIGIN`
- `RAILWAY_DB_URL`
- `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_PORT`, `CLICKHOUSE_SECURE`
- Discord/LINE webhook หรือ token ตาม notification setting
- OpenAI env มีได้ แต่ถ้าไม่ใช้ chatbot ให้ระวังอย่าเรียกโดยไม่จำเป็น

Frontend:

- `VITE_API_URL`

## Commands ที่ใช้บ่อย

รัน backend:

```bash
npm --prefix server start
```

รัน frontend:

```bash
npm --prefix client run dev
```

Build frontend:

```bash
npm --prefix client run build
```

Deploy Railway:

```bash
railway up --service market-order-app
```

ดูสถานะ Railway:

```bash
railway status
```

## ข้อควรระวังในการแก้โค้ด

- Worktree มักมีไฟล์แก้ค้างหลายไฟล์ ต้องดู `git status -sb` ก่อนเสมอ
- อย่า commit ไฟล์ temporary ใน `server/scripts/.tmp-*` หรือ `output/` ถ้าไม่ได้ตั้งใจ
- Route `/meta/*` ต้องอยู่ก่อน `/:id`
- หลาย model มี auto-alter column ตอนเริ่ม backend อย่าเพิ่ม column ซ้ำโดยไม่เช็ค
- ถ้าหน้า local เจอ 404 จาก API ให้รีสตาร์ต backend ก่อนสรุปว่าโค้ดผิด
- ถ้า Railway เจอ unknown column มักแปลว่า schema production ยังไม่ทันโค้ด
- งานสต็อกต้องระวัง timezone `Asia/Bangkok`
- งาน ClickHouse ต้องจำว่าเป็นแหล่งข้อมูลขายจริงแบบอ่านอย่างเดียว

## ไฟล์อ้างอิงเพิ่มเติม

- `AI_DATABASE_SCHEMA.md` = schema/query ClickHouse สำหรับ AI
- `server/database/schema.sql` = schema ตั้งต้น MySQL
- `server/database/migrations/001_create_inventory_tables.sql` = โครง inventory สำคัญ
- `PROGRESS.md` = ประวัติความคืบหน้าเก่า
- `ROUND1_WORKTREE_CHECKLIST.md` = ประวัติการจัด worktree รอบเก่า


## General Purchase / PR-PO Workflow

ฟังก์ชัน `สั่งซื้อทั่วไป` เป็นระบบ PR/PO สำหรับรายการที่ไม่เข้าสต๊อก และบันทึกลงตาราง `general_purchase_*` โดยแยกจากระบบสั่งซื้อหลักทั้งหมด

### Workflow หน้าใช้งาน
อยู่ที่ `/general-purchase` และเปิดจากการ์ด `สั่งซื้อทั่วไป` ในหมวด `ระบบอื่นๆ` ที่หน้า `/login`

ขั้นตอนใช้งาน:
1. `PR` = สร้างคำขอซื้อ: วันที่, สาขา, แผนก, ประเภทค่าใช้จ่าย, เหตุผล
2. `ตรวจสอบ` = ตรวจรายการและจำนวนที่ขอซื้อก่อนออก PO
3. `PO` = ออกใบสั่งซื้อ พิมพ์ PO และกรอกข้อมูลผู้ขาย/ภาษี/การจ่ายเงิน/กำหนดรับ
4. `รอรับ` = ติดตามของที่สั่ง ยังไม่ใส่ราคา
5. `รับเสร็จ` = ใส่จำนวนรับจริงและราคารวมตามบิล แล้วพิมพ์ใบรับ/ส่งบัญชี

### หลักสำคัญ
- ไม่สร้าง stock movement
- ไม่ปรับ inventory balance
- ราคาให้กรอกตอนรับเสร็จตามบิลจริง ไม่ต้องกรอกตอน PR
- ปิด PO ได้หลังรับและใส่ราคาแล้ว

### หมายเหตุจาก draft เก่า
ตอนแรกเคยวาง status draft เช่น `pr_draft`, `reviewed`, `po_issued`, `waiting_receive` แต่โค้ด backend ล่าสุดใช้ status จริงในหัวข้อ "สถานะจริงล่าสุด" ด้านล่าง ให้ยึดสถานะจริงจากโค้ดก่อนเสมอ

### Backend phase started (2026-05-11)
เพิ่ม backend แยกสำหรับ `general-purchase` แล้ว โดยไม่แตะระบบ PO สต๊อกเดิม

API prefix: `/api/general-purchase`
- `GET /` list/filter เอกสาร
- `POST /` สร้าง PR
- `GET /:id` อ่านรายละเอียดพร้อม items/timeline
- `POST /:id/approve` อนุมัติ PR
- `POST /:id/reject` ไม่อนุมัติ PR
- `POST /:id/issue-po` ออก PO และส่งไปรอรับ
- `POST /:id/receive` รับของ + ลงราคาจริง แล้วปิดเป็น received

ตารางใหม่ที่แยกระบบเก่า:
- `general_purchase_orders`
- `general_purchase_order_items`
- `general_purchase_order_logs`

Frontend `GeneralPurchaseContext` เริ่มอ่าน/เขียนผ่าน backend แล้ว ไม่ใช้ localStorage mock เป็นแหล่งหลัก

## Employee Ref Import

เริ่มนำเข้ารายชื่อพนักงานจากโปรเจคพนักงานมาเก็บในระบบสั่งของแล้ว เพื่อใช้ทำสิทธิ์ PR/PO ทั่วไปใน phase ถัดไป

แหล่งข้อมูล local เริ่มต้น:
- `/Users/surachart/สำหรับระบบพนักงาน/backend/data/leave_system.db`
- override ได้ด้วย env `EMPLOYEE_DB_PATH`

ตารางใหม่ในระบบสั่งของ:
- `employee_refs`

API prefix: `/api/employee-refs`
- `POST /sync` อ่าน SQLite จากโปรเจคพนักงานแล้ว upsert เข้า `employee_refs`
- `GET /` list/search/filter พนักงานที่ sync แล้ว
- `GET /stats` ดูจำนวนรวม, active, active head, role summary

หลักการระบุหัวหน้าเบื้องต้น:
- role เป็น `APPROVER_L1`, `APPROVER_L2`, `APPROVER_L3`, `HR`, `ADMIN`
- หรือ position level >= 3
- หรือชื่อตำแหน่งมีคำว่า หัวหน้า/ผู้จัดการ/manager/lead

ตอนนี้ `general-purchase` เริ่มใช้ permission จริงแล้ว: หัวหน้างานสร้าง PR ผ่าน employee token exchange ได้, PIN ใช้ดู read-only, และ action approve/issue/receive ถูก guard ด้วย mode `operator`

### สถานะจริงล่าสุด (2026-05-21)

Backend ใช้สถานะจริง:
- `pending_review` = PR รอตรวจ
- `approved` = อนุมัติ PR แล้ว
- `awaiting_receipt` = ออก PO แล้ว รอรับ
- `received` = รับของและลงราคาจริงแล้ว
- `rejected` = ไม่อนุมัติ
- `closed` = ปิดเอกสาร

ข้อควรจำ:
- ตาราง item มี `item_image_data_url` และ `item_image_name` สำหรับรูปประกอบรายการ
- `received_quantity` และ `actual_price` ถูกลงตอนรับของ ไม่ใช่ตอนสร้าง PR
- `actual_total_amount` ถูกคำนวณหลังรับ
- ทุก transition ควรเขียน `general_purchase_order_logs`
- ห้ามเอา flow นี้ไปผูก `inventory_transactions`

## Store PO / Purchase Orders

ระบบ `/purchase-orders` เป็น PO คลังที่รับแล้วเข้า inventory ต่างจาก `general-purchase`

API prefix: `/api/purchase-orders`
- `GET /` list/filter PO
- `POST /` สร้าง PO
- `GET /:id` อ่าน PO พร้อมรายการและประวัติรับ
- `POST /:id/receive` รับสินค้า
- `PUT /:id/cancel` ยกเลิก PO

ตารางหลัก:
- `purchase_orders`
- `purchase_order_items`
- `purchase_order_receipts`

สถานะ:
- `draft`, `confirmed`, `partial`, `completed`, `cancelled`

หลักสำคัญ:
- รับสินค้าแล้วเพิ่ม `quantity_received`
- รับแล้วสร้าง movement `receive` ใน `inventory_transactions` โดย source เป็น `purchase_order`
- ใช้ supplier จริงจาก `supplier_masters`
- ตั้งค่าหน่วยซื้อได้ผ่าน `product_supplier_master_links.purchase_unit_id` และ `purchase_to_base_multiplier`

## Discord / LINE Chatbot และ Notification

Notification setting:
- หน้า `/admin/settings/line-notifications`
- API `/api/admin/line-notifications`
- provider เลือกได้ `line` หรือ `discord`
- เก็บค่าใน `system_settings` เช่น `notification_provider`, `line_notification_groups`, `discord_notification_groups`, `discord_webhook_url`, `discord_receiving_webhook_url`, `discord_po_webhook_url`

Discord:
- endpoint `/api/discord/interactions` ต้องรับ raw body เพื่อ verify signature
- script ลง slash command: `npm --prefix server run discord:register-commands`
- command ที่รองรับใน controller ตอนนี้คือ `sales_daily` และ `ask_sales`

LINE chatbot:
- endpoint `/api/line/webhook` ต้องรับ raw body เพื่อ verify `x-line-signature`
- test endpoint: `/api/line/test-command`
- env สำคัญ: `LINE_OA_CHANNEL_SECRET` หรือ `LINE_CHANNEL_SECRET`, `LINE_OA_CHANNEL_ACCESS_TOKEN` หรือ `LINE_CHANNEL_ACCESS_TOKEN`, `OPENAI_API_KEY` ถ้าต้องใช้คำถามวิเคราะห์
- รองรับคำถามยอดขายธรรมชาติ เช่น `ยอดขายวันนี้`, `สรุปวันนี้`, `สรุปสัปดาห์นี้`, `สรุปเดือนนี้`, `/sales_daily`, `/ask_sales`
- จำบริบทผู้คุยผ่าน `chatbot_memories`
- log คำถามผ่าน `chatbot_query_logs`
- ใช้ ClickHouse แบบ read-only เท่านั้น

## Railway / GitHub Workflow

Railway:
- service production ที่ใช้อยู่คือ `market-order-app`
- `Dockerfile` build ทั้ง server/client, ตั้ง `VITE_API_URL=/api`, build client, แล้วรัน `node src/server.js`
- ใน production ต้องมี `SERVE_CLIENT=true` เพื่อให้ Express serve `client/dist`
- endpoint ตรวจสุขภาพ: `/health` และ `/health/db`
- deploy ปกติใช้ `railway up --service market-order-app`

GitHub:
- remote หลัก: `origin https://github.com/namo1997/market-order-app.git`
- branch ปัจจุบันมักทำงานบน `main`
- repo นี้ยังไม่มี `.github/workflows` ให้ CI อัตโนมัติ
- ก่อน push/deploy ควรตรวจ `git status --short` และห้ามเอาไฟล์ temporary เช่น `.tmp-*`, `output/`, log, csv ชั่วคราว ไป commit โดยไม่ตั้งใจ

## Update 2026-05-21: Current Operational Map For AI Agents

### Core Data Sources
- Primary app database is MySQL on Railway for production and local MySQL for development/sync workflows.
- ClickHouse is read-only and used for POS sales reports, sales chatbot answers, and sales-driven inventory deduction. Do not write to ClickHouse.
- Railway service name used in deployment is `market-order-app`; app URL is `https://market-order-app-production.up.railway.app`.
- Local frontend normally runs on `http://localhost:5174`; local backend normally runs on `http://localhost:8000`.

### Ordering / Receiving / Purchase Walk
- `/order` is department ordering. Products are scoped by product groups and department visibility rules.
- `source_product_group_id` on order items is important. When the same product belongs to multiple groups, reports must use the chosen source group, not only `products.product_group_id`.
- `/order/receive` is department receiving. Inventory movement is created only from actual received quantity.
- Extra items added from receiving must also create/link purchase-walk data so admin can later fill actual quantity and price.
- `/admin/purchase-walk` is the purchase walking/pricing page. It is the place where actual purchase quantity and actual total price are recorded.
- Purchase-walk reconciliation compares ordered, purchased, and received quantities by date/group/branch/department.
- For store groups, guide price can use forced/latest product price. PO-derived price should only be applied manually when the UI action explicitly requests it.

### Inventory Rules
- Inventory balance is department/branch scoped, not global.
- Stock card (`/inventory/stock-card/...`) shows movement history for one product in one branch/department.
- Stock adjustment from stock count should insert an adjustment transaction at the real count time, and later sales/movements should be recalculated from that point.
- Transfer/withdraw movements must preserve source and destination context. When showing transfer out, include destination if available.
- Sales deduction from ClickHouse must be recipe-based and limited to POS branches that are mapped to ClickHouse branch IDs.

### Store / Storage Product Groups
- Product groups can represent storage areas such as store Kanklong/Sankamphaeng or beverage groups.
- A product can belong to multiple product groups. Do not assume one product has only one group.
- For zone-sensitive ordering, source product group and explicit storage/source mapping are the reliable fields.
- Be careful when merging product-group links: never remove cross-group links unless the task explicitly asks and a backup/rollback path exists.

### General Purchase / PR-PO
- `/general-purchase` is for non-stock PR/PO. It must not write inventory movements.
- General purchase flow: PR -> review/approve -> issue PO -> receive -> closed/received.
- Discord notification for general PR should use a distinct icon/message style from normal purchase/order notifications.

### Notifications And Chatbots
- LINE and Discord notification settings are stored in `system_settings` and managed from `/admin/settings/line-notifications`.
- Discord webhooks are separated by purpose, for example ordering/receiving/PO.
- LINE chatbot endpoint is `/api/line/webhook`; Discord interactions endpoint is `/api/discord/interactions`.
- Chatbots should answer from safe read-only queries and log questions in chatbot query log tables.
- Never commit real tokens/secrets. They belong in Railway variables or local `.env` only.

### Development Rules For Future AI
- Always check `git status --short` before edits. This repo often has many unrelated dirty files.
- Do not stage temporary scripts, logs, generated CSVs, `output/`, `.cache/`, or files named `.tmp-*`.
- Before push, prefer running `npm --prefix client run build --silent`. Server has no full test suite yet; at minimum syntax-check changed server files when possible.
- When using Railway CLI and it says `Unauthorized`, the user must run `railway login` again before production DB/deploy commands can work.
