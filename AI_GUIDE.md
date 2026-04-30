# AI Collaboration Guide (SOLAO Market Order App)

เอกสารนี้เป็นไฟล์หลักสำหรับให้ AI หรือทีมงานคนถัดไปอ่านก่อนแก้โปรเจค

อัปเดตล่าสุด: 2026-04-30

## กติกาสำคัญ

- อ่านโครงสร้างจริงในโค้ดก่อนแก้ทุกครั้ง อย่าเดาจากชื่อไฟล์หรือชื่อเก่า
- ห้ามลบหรือ revert งานค้างใน worktree ถ้าไม่ได้รับคำสั่งชัดเจน
- ห้ามแก้ข้อมูลใน ClickHouse เด็ดขาด ใช้อ่านยอดขาย POS เท่านั้น
- งานที่กระทบสต็อกต้องคิดผลต่อ `inventory_transactions` และ `inventory_balance` เสมอ
- ระบบ production อยู่ Railway service `market-order-app`
- ก่อน deploy ควร build ฝั่ง client อย่างน้อยด้วย `npm --prefix client run build`

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

### Admin / Super Admin

- `/admin/settings` = ตั้งค่าระบบ
- `/admin/settings/products` = จัดการสินค้า
- `/admin/settings/product-groups` = จัดการกลุ่มสินค้า
- `/admin/settings/suppliers` = จัดการซัพพลายเออร์จริง
- `/admin/settings/departments` = จัดการแผนก
- `/admin/settings/stock-categories` = หมวดเช็คสต็อก
- `/admin/settings/recipes` = ตั้งค่าสูตรเมนูขายหน้าร้าน
- `/admin/settings/production-transform-recipes` = ตั้งค่าวัตถุดิบหลักก่อนแปรรูป
- `/admin/settings/purchase-report` = รายงานการซื้อ
- `/admin/settings/price-report` = รายงานราคาสินค้า
- `/admin/settings/sales-report` = รายงานยอดขาย
- `/admin/settings/direct-order-rules` = ตั้งค่าสั่งตรงผู้ขายหลังเวลา
- `/admin/settings/rop` = จุดสั่งผลิต (ROP)
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

## Flow รับสินค้า

หน้า `/order/receive` ใช้ให้แผนกรับสินค้า:

- บันทึกรับจริงทีละกลุ่มสินค้า
- ถ้ารับครบทุกตัวในกลุ่มแล้วค่อยส่งแจ้งเตือนรับสินค้า
- สินค้าที่รับจริงเท่านั้นที่เข้าสต็อก
- ถ้ารับไม่ครบและสินค้าอนุญาตค้างรับข้ามวัน จะค้างรับต่อ
- ถ้าไม่อนุญาตค้างรับข้ามวัน ให้ปิดยอดขาดวันนี้
- งาน auto receive ปลายวันใช้กับกลุ่มที่ไม่ได้ปิด auto receive

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

หน้า `/admin/settings/rop`:

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
