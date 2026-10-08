# CHANGELOG — market-order-app

บันทึกประวัติการแก้ไข (ภาษาไทย) ตามกติกาใน `AGENTS.md`

## 2026-10-08 — แก้บั๊กแปลงหน่วย UNIT-01..05 + UX ตัวคูณ (Local, ยังไม่ deploy)

- **สถานะ:** Local — branch `units/conversion-ux-fixes-2026-10-08` (ไม่ push/deploy, ไม่แตะ DB/schema)
- **สิ่งที่ทำ:** UNIT-01 แก้ `saveProductUnitSettings` (500 หลังเขียนข้อมูล) และทำให้ atomic ด้วย transaction เดียว; UNIT-02 สูตรใช้หน่วยฐานของสินค้าที่เลือกเสมอ + server คืน 400 เมื่อหน่วยไม่ตรงและไม่มีตัวแปลง; UNIT-03 รายการตั้งค่าหน่วยโหลดได้ถึง 2000 พร้อม `total` และข้อความ "แสดง X จาก Y"; UNIT-04 ประโยค "1 หน่วย = N หน่วยฐาน" + เตือนเมื่อ N<1 + หัวคอลัมน์ภาษาไทยบอกทิศ + คำอธิบายหน้าแปลงหน่วย; UNIT-05 กันเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง (409, override ด้วย `force_unit_change`)
- **API:** `GET /api/product-unit-settings` เพิ่ม `total`; `PUT /api/product-unit-settings/:id` และ `PUT /api/products/:id` ตอบ 409 (`code: BASE_UNIT_CHANGE_BLOCKED`, `references`) และคืน `warning` เมื่อ force; `POST /api/recipes/:id/items`, `PUT /api/recipes/items/:itemId` ตอบ 400 (`code: RECIPE_UNIT_MISMATCH`)
- **ผลทดสอบ:** node:test 18/18 (เพิ่ม `server/tests/unit-rules.test.mjs` 4 รายการ), client build ผ่าน, import โมดูล server ผ่าน (ไม่มีการทดสอบกับ DB จริง)
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/units-ux-fixes-2026-10-08.md`, `docs/modules/master-data.md`
- **ค้างอยู่:** snapshot ตัวคูณหน่วยซื้อใน PO, หน่วยนับสต๊อกแยกตามแผนก, ผลข้างเคียงที่การตั้งหน่วยซื้อเขียน `unit_conversions` สากล, ทดสอบ flow จริงกับ MySQL ก่อน deploy
- **ตรวจเพิ่มบน DB สำเนา (SSD):** ลบการเขียนทับ `unit_conversions` สากลจากการตั้งหน่วยซื้อ (UNIT-06); แก้ save ค้าง lock wait timeout ตอนเรียกครั้งแรกหลัง restart (ensure/backfill schema ใช้ pool แยกระหว่าง transaction) โดยเตรียม schema ก่อนเปิด transaction; แก้ `updateTemplate` อ้าง `db` ที่ไม่มี (พารามิเตอร์ connection ใส่ผิดฟังก์ชัน); scenario กับ MySQL 8/8 ผ่าน (`logs/units-scenarios.log` ใน previews/inv-bugfix-20261007T151025)

## 2026-10-08 — แก้ชื่อสินค้าซ้ำ/สะกดผิด (Production, แก้ข้อมูล)

- **สถานะ:** Production (แก้ข้อมูลโดยตรง ไม่ลบ/ไม่รวมสินค้า)
- **สิ่งที่ทำ:** เปลี่ยนชื่อ 82 รายการ: สินค้าชื่อเดียวกันคนละกลุ่มเติม "(กลุ่มสินค้า)" เช่น ไข่ไก่ (ตลาดสด)/(ผลิตคันคลอง); คนละหน่วยเติม "(หน่วย)"; แก้สะกด ตะไคร์→ตะไคร้, ฮวด→หวดนึ่งข้าว, เบคกิ้ง→เบกกิ้งโซดา, เขียงพพลาสติก→เขียงพลาสติก, เครติต→เครดิต; ตัดช่องว่างเกิน/เว้นวรรคก่อนวงเล็บ
- **ผลทดสอบ:** ซ้อมบนสำเนา SSD แล้วรันจริงพร้อม guard ชื่อเดิม (ไม่ตรง 0) เปลี่ยน 82 แถว; ไม่มีระบบใดจับคู่สินค้าด้วยชื่อ
- **หลักฐาน:** `docs/releases/2026-10-08-product-names.sql`, `/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-08-product-names/` (pre-products.sql.gz)
- **ค้างอยู่:** ชื่อซ้ำจริงกลุ่มเดียวกัน 2 คู่: หวดนึ่งข้าว (id 609, 886), น้ำมันพริกเผายกเลิก (id 366, 374)

## 2026-10-08 — ล้างหน่วยนับซ้ำ + ตัวย่อภาษาไทย (Production, แก้ข้อมูล)

- **สถานะ:** Production (แก้ข้อมูลโดยตรง ไม่มี deploy)
- **สิ่งที่ทำ:** รวมหน่วยซ้ำ 5 คู่ (กิโลกรัม, กระป๋อง, แกลลอน, ปี๊บ, ตัว), ตัวย่ออังกฤษเป็นไทย, แก้สูตรโค้กซีโร่ให้ใช้หน่วยกระป๋อง ทำให้สูตรขายปลาทับทิม 9 เมนูและโค้กซีโร่ 2 เมนูตัดสต็อกได้
- **ผลทดสอบ:** ซ้อมบนสำเนา SSD แล้วรันจริงใน transaction เดียว ตรวจ: อ้างอิงหน่วยเลิกใช้ 0, สูตรหน่วยไม่ตรง 0, ตัวย่ออังกฤษ 0, health/db 200
- **หลักฐาน:** `docs/releases/2026-10-08-units-cleanup.md`, `/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-08-units-cleanup/`
- **ค้างอยู่:** ทำให้ทุกหน้าใช้รูปแบบแสดงหน่วยเดียวกัน (ต้องแก้โค้ด)

## 2026-10-07 — Deploy ชุดแก้คลัง + ตั้งยอดจากการนับล่าสุด (Production)

- **สถานะ:** Production `80d2e500-494a-47be-b84f-d15304bde15e` SUCCESS, rollback `bbf8d57f-4079-441b-971f-0d302fabcff3`
- **สิ่งที่ทำ:** deploy ไฟล์ชุด INV-01..07 บนฐาน release 2026-10-06; สำรอง DB ลง SSD และทดสอบ restore; รัน reflow (32 คู่) และปรับยอดจากการนับล่าสุด 237 รายการ (`server/scripts/apply-latest-stock-checks.mjs`)
- **ผลทดสอบ:** tests 61/61, client build ผ่าน, health/db 200, ตรวจซ้ำไม่มีการนับค้างและ reflow เหลือ 0
- **หลักฐาน:** `docs/releases/2026-10-07-inventory-ledger.md`, `/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-07-inventory-ledger/`
- **ค้างอยู่:** ยอดติดลบ 526 คู่ของสินค้าที่ยังไม่เคยนับ; INV-08, INV-09

## 2026-10-07 — SQL smoke test ชุดแก้คลังบนสำเนา DB + แก้ deadlock + สคริปต์ reflow (Local, ยังไม่ deploy)

- **สถานะ:** Local — branch `inventory/stock-bugfix-2026-10-07` ยังไม่ push/ไม่ deploy
- **สิ่งที่ทำ**
  - ดึงสำเนา Production แบบอ่านอย่างเดียวลง SSD แล้วรันโค้ดใหม่กับ MySQL ชั่วคราวบน SSD
  - แก้ `lockBalanceRow` จาก INSERT IGNORE เป็น INSERT … ON DUPLICATE KEY UPDATE (deadlock เมื่อเขียนพร้อมกัน พบจาก smoke test)
  - เพิ่ม `server/scripts/reflow-stock-ledger-absolute.mjs` (dry-run เป็นค่าเริ่มต้น, `--apply`, `--report`) สำหรับรันครั้งเดียวตอน deploy
  - ปิด `server/scripts/reflow-transaction-balances.js` (ต้องใส่ `--legacy-running-sum`) เพราะคำนวณแบบเก่าจะทับยอดนับ
  - ตรวจ INV-10: ยอดเปลี่ยน 20/2,996 คู่หลัง reflow ส่วนใหญ่เป็นการแก้ตัดซ้ำจาก INV-01
- **ผลทดสอบ:** scenario 8 กรณี (sync ขาย, แปรรูปย้อนวัน, ลบยอดขาย, init-balance, ล้างเช็ค, เขียนพร้อมกัน 20 ครั้ง, apply+variance, วันที่ไทย) ผ่านทั้งหมดหลังแก้ deadlock และรัน reflow; สคริปต์ reflow รันซ้ำได้ผล 0 คู่ (idempotent)
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/inventory-sql-smoke-2026-10-07.md`
- **ค้างอยู่:** INV-08, INV-09; ขั้นตอน deploy ต้องรัน reflow script หลังปล่อยโค้ด

## 2026-10-07 — แก้บั๊กระบบคลัง INV-01..INV-07 (Local, ยังไม่ deploy)

- **สถานะ:** Local — branch `inventory/stock-bugfix-2026-10-07` ฐาน commit `265abf4` ยังไม่ push/ไม่ deploy
- **สิ่งที่ทำ**
  - INV-01/02: รายการ stock_check เป็นยอดสัมบูรณ์ใน reflow (`server/src/utils/stock-ledger.js`, `recalculateLedgerBalances`); sync ขายตามสูตร, แปรรูป, ลบยอดขาย reflow ledger ใน transaction เดียวกัน
  - INV-03: ล็อกแถว `inventory_balance` (`lockBalanceRow`) ใน `createTransaction`, แปรรูป, apply, reflow
  - INV-04/06: แก้ `is_applied`/`has_newer_applied` และ `system_quantity` ในรายงาน variance
  - INV-05: กรองวันที่ไทยเป็นช่วง UTC (dashboard, ประวัติแปรรูป, ลบยอดขาย, gate ของ apply, usage report, realtime balance, effective date ของ movement/stock card)
  - INV-07: `init-balance` ตั้งยอดสัมบูรณ์ (`setInitialBalance`); ล้างเช็คสต็อกที่ apply แล้วตอบ 409
  - เอกสาร: `docs/modules/inventory.md` (บั๊กที่รู้แล้ว + บั๊กที่พบเพิ่ม INV-08..10), `docs/modules/modules.json`
- **ผลทดสอบ (รันผ่านตัวรัน SSD):** `node --test server/tests/*.test.mjs` 14 ผ่าน/0 ล้มเหลว ทั้ง TZ=UTC และ TZ=Asia/Bangkok; import controllers/models ที่แก้ได้ทั้ง 5 ไฟล์; `vite build` ของ client สำเร็จ; SQL ยังไม่ได้ทดสอบกับ MySQL จริง
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/inventory-stock-bugfix-2026-10-07.md`
- **ค้างอยู่ก่อน deploy**
  - SQL ที่แก้ยังไม่เคยรันกับ MySQL จริง ต้อง smoke test บน DB สำเนาใน SSD (variance report, sync ขาย, ลบยอดขาย, แปรรูป)
  - ตรวจ INV-10 (stock_check เก่าที่ `balance_after` อาจไม่ใช่ยอดนับ) เทียบกับ `stock_checks.stock_quantity` ก่อน deploy
  - INV-08, INV-09 ยังไม่แก้
  - ยังไม่ได้แก้ `AGENTS.md` (ไม่มี route/ตาราง/enum ใหม่) ค่าความหมายของ `init-balance` เปลี่ยนเป็นสัมบูรณ์ ต้องแจ้งผู้ใช้หน้าจอที่เรียก
