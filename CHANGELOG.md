# CHANGELOG — market-order-app

บันทึกประวัติการแก้ไข (ภาษาไทย) ตามกติกาใน `AGENTS.md`

## 2026-10-21 — สร้างตารางรับสินค้าบน Production DB (เพิ่มอย่างเดียว, สถานะ: Production DB เท่านั้น — ไม่ deploy โค้ด)

- เจ้าของอนุมัติ ("อนุมัติทั้งหมดเลย") หลังแก้ collation ที่ 36d5ba7; รัน `migrate-receiving-documents.js`, `migrate-receiving-issues.js`, `migrate-receiving-push.js` จาก source สะอาดที่ 1f0a3b9 (สำเนา SSD) ผ่าน `railway run -s MySQL` ได้ exit 0 ทั้งสามตัว
- Backup ก่อนรัน: `/Volumes/SSD Files/SOLAO/market-order-system/backups/market-pre-receiving-tables-20261021b/market_order_db.sql.gz` 340,103,242 bytes sha256 `8f87445bb55eec8c456d89c46cd1c17834a4f8f35687b8d9ff99605963d6ef2f` · restore ตรวจบน SSD ครบ 117 ตาราง จำนวนแถวไม่น้อยกว่า backup (ต่าง inventory_transactions +10 จากการเขียนปกติ) · hold
- สร้างตารางใหม่ 23 ตาราง (InnoDB, utf8mb4_unicode_ci, ว่าง): receiving_documents/_document_lines/_document_images/_document_audits/_document_notifications, receiving_supplier_{product_guard,product_imports,profiles,branch_codes,admin_audits}, supplier_product_aliases, supplier_product_alias_events, receiving_issues/_issue_{evidence,history,reminders,scans,stock_returns}, receiving_followups/_followup_locks/_supplier_leads, receiving_push_{devices,deliveries}
- ตรวจ: information_schema ของตารางเดิม 117 ตาราง (columns/indexes/FKs/engine/collation) เหมือนก่อน migrate ทุกบรรทัด; ไม่มีตารางเดิมแถวลด; /health, /health/db, /, /api/auth/branches ของ Production = 200; **ไม่ deploy โค้ด ไม่ push ไม่แตะ Railway variables**
- รายงาน/หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/prod-db-receiving-tables/REPORT.md` (+ schema-before-migrate.json, schema-after.json, migrate-logs/)
- ค้าง: โค้ดรับสินค้ายังไม่ถูก deploy ขึ้น Production (ต้องขออนุมัติแยก); ตั้งค่า env ที่เกี่ยวข้อง (เช่น RECEIVING_EXPORT_TOKEN) ตอน deploy

## 2026-10-21 — Staging ระบบรับสินค้า รอบ 2 (36d5ba7)

- Railway `solao-receiving-staging` / `receiving-staging` deployment `5ac85ff7` SUCCESS 10:39 ICT ด้วย `railway up -m "staging: receiving release-port + collation fix + clock-independent tests 36d5ba7"`
- Docker build tests 670/670; `/api/receiving-admin/suppliers` 200 (เดิม 500 collation); asset หน้าเว็บ `index-IiVKDTrw.js` (ไม่เปลี่ยนจากรอบก่อน — แก้เฉพาะ server)
- ตั้งตัวแปร staging: `RECEIVING_OCR_MODEL=gpt-6-luna` (Claude) และ `OPENAI_API_KEY` (เจ้าของใส่เอง) เพื่อทดลองอ่านบิลบน staging · deployment ก่อนหน้า daaecb9f/db2885a5 FAILED เพราะเทสต์ผูกวันที่ (แก้แล้ว 36d5ba7)
- ยังไม่ push รอบนี้ · Production ยังไม่ deploy · ตารางบนฐานจริงยังไม่สร้าง

## 2026-10-21 — แก้เทสต์ server ที่ผูกกับวันที่จริง (ล้มทุกวันหลัง 2026-10-20) — Local

- **สถานะ:** Local — branch `receiving/release-port-20261020` ยังไม่ deploy / ไม่ push; ไม่แก้พฤติกรรม production (กฎ void คงเดิม: แอดมินเมื่อไรก็ได้, ฝ่ายบัญชีภายใน 7 วัน, เจ้าของเอกสารวันเดียวกัน)
- **อาการ:** 14 เทสต์ใน `server/tests` ผ่านเฉพาะเมื่อวันที่จริงเป็น 2026-10-20 (Asia/Bangkok) ส่วนใหญ่เป็น flow void; Dockerfile รัน `server/tests/*.test.mjs` ก่อน build จึงทำให้ deploy ล้มตั้งแต่วันถัดไป
- **สาเหตุ:** harness `server/tests/helpers/receiving-fake-db.mjs` ตรึง `getBangkokDateKey` ด้วย `testDate` แต่ตั้ง `confirmed_at/created_at/voided_at/counted_at` ด้วยนาฬิกาจริง ทำให้ `mayVoid` เห็นวัน -1 หรือเกิน 7 วัน; อีกข้อ `receiving-review-v2` ใช้วันส่งตามนาฬิกาจริงกับบิลลงวันที่ 17/10/2569 ซึ่งหลุดหน้าต่าง OCR 180 วันเมื่อเลย ~2027-04
- **แก้ (เฉพาะเทสต์):** harness มี business clock — เมื่อระบุ `testDate` เวลาแถวทั้งหมดอยู่ในวันนั้น (เที่ยงเวลาไทย เดินตามเวลาจริงเพื่อคงลำดับ) ไม่ระบุก็ใช้นาฬิกาจริงเหมือนเดิม; `receiving-review-v2` ตรึง `testDate: '2026-10-18'`; เพิ่ม `server/tests/receiving-clock-independence.test.mjs` กันถอยหลัง (ตรึงวันอดีต/อนาคต แล้วต้อง confirm + void ในวันเดียวกันได้)
- **ทดสอบ:** server 670 / client 808 / pilot 48 ผ่านทั้งหมด 2 รอบ ที่นาฬิกาจริง, faketime +3d, +40d; สำรวจเพิ่ม -400d ถึง +800d, ข้ามเที่ยงคืนไทย/ปีใหม่, TZ=UTC (แบบ Railway) ผ่านครบ
- รายงาน/หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/clock-tests/`

## 2026-10-21 — สำรอง Production DB ก่อนสร้างตารางรับสินค้า (หยุดก่อน migrate)

- เจ้าของอนุมัติ backup + สร้างตารางใหม่แบบเพิ่มอย่างเดียว; ทำ backup สำเร็จ แต่ **ยังไม่ migrate** เพราะ Claude สั่งหยุดหลัง staging พบ collation ชน (ตารางใหม่เป็น utf8mb4_unicode_ci; `supplier_masters` และกลุ่ม product_group_*/purchase_order* เป็น utf8mb4_0900_ai_ci) — ต้องแก้โค้ดก่อน
- Backup: `/Volumes/SSD Files/SOLAO/market-order-system/backups/market-pre-receiving-tables-20261021/market_order_db.sql.gz` 340,101,858 bytes sha256 `399c565376ddfd0d54e66bb43e468f316e0bfe2fa4f9f2ab098c41addd93423a` (mysqldump --single-transaction 117 ตาราง) · restore ตรวจบน SSD (MySQL 9.5 port 3318) ครบ 117 ตาราง จำนวนแถวตรงกับ Production (ต่าง line_group_message_archive +1 จากการเขียนปกติ)
- Production: ยังไม่มีตารางรับสินค้าตาม migration (ตรวจแล้วไม่มีตารางเป้าหมายใดอยู่); **ไม่มีการเขียน/แก้/ลบใด ๆ บน Production, ไม่ deploy, ไม่ push**
- รายงาน/หลักฐาน (รวมข้อเท็จจริง collation): `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/prod-db-receiving-tables/REPORT.md`
- ค้าง: แก้ collation แล้วทดสอบ, ขออนุมัติเจ้าของอีกครั้งก่อนรัน migrate-receiving-documents/issues/push

## 2026-10-21 — แก้ ER_CANT_AGGREGATE_2COLLATIONS ของทะเบียนร้าน (receiving-admin/suppliers) — Local

- **สถานะ:** Local — branch `receiving/release-port-20261020` ยังไม่ deploy / ไม่ push / ไม่แตะฐานจริง (staging 58e637fc ยังเป็นโค้ดเดิม; ต้อง deploy ใหม่ก่อนตรวจซ้ำ)
- **อาการ:** `GET /api/receiving-admin/suppliers` ตอบ 500 `Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT) for operation '='`
- **สาเหตุ:** Production/staging collation ปนกัน (ข้อเท็จจริงจาก preflight แบบอ่านอย่างเดียว): `branches/departments/users/units/products/product_groups/orders/order_items` เป็น `utf8mb4_unicode_ci` แต่ `supplier_masters`, `product_supplier_master_links`, `product_group_*` เป็น `utf8mb4_0900_ai_ci` (ค่าเริ่มต้นของฐานคือ 0900) คำสั่ง `TRIM(pg.name) = TRIM(sm.name)` (หาร้านคู่แฝด master/group) และ UNION ของ `sm.name/sm.code` กับ `pg.name/pg.code` จึงล้ม ตารางรับสินค้าเองเป็น unicode_ci ถูกต้องแล้ว **ไม่แก้ DDL และไม่แปลง collation ของตารางใด**
- **แก้:** ใส่ `COLLATE utf8mb4_unicode_ci` ชัดเจนฝั่ง `supplier_masters` ใน `receiving-suppliers-admin.model.js` (`twinPairs` + UNION ของ `listSuppliers`) และ `receiving-supplier-catalog.js` (ค้นร้าน 2 จุด + UNION) ใช้ได้ไม่ว่าตารางฝั่งไหนจะเป็น collation ใด (explicit ชนะ implicit, charset เดียวกัน) ส่วน SQL อื่นของระบบรับสินค้าเทียบกับตารางเดิมด้วย id (INT) หรือคอลัมน์ unicode_ci เหมือนกัน ตรวจแล้วไม่ต้องแก้
- **Pilot/fixture ให้เหมือน Production:** ฐานทดลอง (`pilot/start-server.mjs`, `server/scripts/run-receiving-mysql-it.mjs`) สร้างด้วย default `utf8mb4_0900_ai_ci`; `LEGACY_FIXTURE_DDL` ใช้ unicode_ci กับตารางแกนเก่า และ 0900 กับ `supplier_masters`, `product_supplier_master_links`, `product_group_links/scopes`; `pilot/seed.mjs` สร้าง `supplier_masters` เป็น 0900
- **ทดสอบใหม่:** `server/tests/receiving-collation.test.mjs` (DDL รับสินค้าทุกตารางต้องเป็น unicode_ci, fixture เป็นแบบ Production, ตัวสแกน SQL ห้าม compare/UNION `supplier_masters` โดยไม่มี COLLATE) และ `pilot/collation.test.mjs` (MySQL จริงบน SSD: ยืนยัน collation ของตาราง, คำสั่งแบบเดิมล้มด้วย error เดิมบนฐานนี้, `GET /api/receiving-admin/suppliers` และ catalog ตอบ 200 ในฐานะบัญชี SYNTHETIC) — ก่อนแก้เทสต์ HTTP ล้ม 2 ข้อ หลังแก้ผ่าน
- รายงาน/หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/collation-fix/`

## 2026-10-21 — Staging ระบบรับสินค้า (release-port 4e88466)

- Deploy ขึ้น Railway โปรเจค `solao-receiving-staging` service `receiving-staging` deployment `58e637fc` (SUCCESS 2026-10-20 23:57 ICT) ด้วย `railway up -m "staging: receiving release-port (production-base 3daf3a5 + receiving system) 4e88466"` จาก snapshot `releases/receiving-staging-4e88466`
- ตรวจ: server tests ใน Docker build 662/662; เว็บ 200, `/api/auth/branches` 200, `/api/receiving-export/ap/v1/documents` 503 (ยังไม่ตั้ง token ตามตั้งใจ); asset ที่ให้บริการ `index-IiVKDTrw.js` ตรงกับ build ของ commit 4e88466
- **ยังไม่ push** (เจ้าของสั่งห้าม git push) · Production ยังไม่ deploy / ยังไม่ migrate · Cashflow ยังไม่ขึ้น staging

## 2026-10-20 — ตัวกันลบหน่วยนับนับการใช้ในตารางระบบรับสินค้า (UNIT-07 ต่อเนื่อง, Local)

- **สถานะ:** Local — branch `receiving/release-port-20261020` ยังไม่ deploy / ไม่ push / ไม่ได้แตะฐานจริง
- **ปัญหา:** ตัวกันลบหน่วย (`usageQueries` ใน `unit-usage.model.js`) ไม่นับ `unit_id` ในตารางที่ระบบรับสินค้าเพิ่มเข้ามา (ไม่มี FK) หน่วยที่ใช้เฉพาะที่นั่นจึงลบได้และทำให้ unit_id ค้าง
- **แก้:** เพิ่ม query 3 ตาราง `receiving_document_lines` (รายการรับสินค้า), `supplier_product_aliases` (ชื่อบิลที่ระบบจำไว้), `supplier_product_alias_events` (ประวัติชื่อบิลที่ระบบจำไว้) — เป็นตารางเดียวในระบบรับสินค้าที่มีคอลัมน์ unit_id; ยังข้ามตาราง/คอลัมน์ที่ไม่มีด้วย try/catch เดิม; เพิ่มคีย์ใน `emptyUnitUsage`, ป้ายไทยใน `server/src/utils/unit-master-rules.js` และ `client/src/utils/unit-management.js` (หน้าจัดการหน่วยแสดงในคอลัมน์ "ใช้อยู่" และเหตุผลปุ่มลบโดยไม่ต้องแก้คอมโพเนนต์)
- **ทดสอบ:** เพิ่ม `server/tests/unit-usage-receiving.test.mjs` (4 เทสต์: หน่วยที่ใช้เฉพาะตารางรับสินค้าลบไม่ได้, ตารางรับสินค้ายังไม่ถูกสร้างไม่พัง, ขาดคอลัมน์ข้าม/ข้อผิดพลาดอื่นโยนต่อ, ป้าย server/client ตรงกัน) ผลรันเต็มบนสำเนา SSD 2 รอบ: server ทั้งหมด 662/662, release-invariants+order-safety 43/43, client 808/808, vite build หลัก+`build:receiving` ผ่าน, pilot 51/51 (ผลเท่ากันทั้ง 2 รอบ; ไม่ได้รัน e2e/gradle/MySQL จริง) หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/unit-guard/` (REPORT.md, verify.sh)
- **เอกสาร:** `docs/modules/master-data.md`, `docs/modules/modules.json`
- **หมายเหตุ:** ประวัติชื่อบิล (`supplier_product_alias_events`) นับเป็นการใช้งานด้วย เพื่อกัน unit_id ค้างในหลักฐาน; หากเจ้าของต้องการให้ลบหน่วยได้เมื่อเหลือแค่ประวัติ ให้เอา query นี้ออก

## 2026-10-20 — ย้ายระบบรับสินค้า (receiving) ขึ้น production-base (Local release candidate, ยังไม่ deploy)

- **สถานะ:** Local release candidate — branch `receiving/release-port-20261020` ต่อจาก `main/production-base` (3daf3a5 = Production deployment `68bee663`, release `2026-10-20-units-usage`) **ยังไม่ deploy / ยังไม่ push / ไม่ได้แตะฐานจริง**
- **ที่มา:** `receiving/integration-20261020` @ `8f22c87` (ประวัติแยก ราก `f372771` = snapshot release `2026-10-08-super-admin-line`) นำ delta `f372771..8f22c87` มาแบบ 3-way (`git apply --3way`) ตัดไฟล์ `client/tests/*.browser.mjs` 4 ไฟล์ (เครื่องมือเปิดดูด้วยมือ ไม่ใช่ source ที่ปล่อย)
- **รวมอะไรบ้าง:** แอปรับสินค้า (เว็บ `/receiving` + Android Capacitor), OCR/blind-count/เซ็นรับ, หน้าบัญชี (ใบรับของ ร้านค้า ชื่อย่อ รหัสเจ้าหนี้ตามสาขา นำเข้าสินค้า CSV), ติดตามปัญหา/คืนของ/push, ส่งออก AP (`/api/receiving-export/ap/v1/documents`), ซ่อนเมนูรับสินค้าเดิมระยะที่ 1, `pilot/` + `e2e/`, Dockerfile Node 22 + COPY/rm pilot ตอน build. Production ที่ปล่อยแล้ว (หน่วยนับ + หน่วยใช้ UNIT-07..13) อยู่ครบ — ไฟล์ร่วมที่ production แก้และ receiving แก้ซ้ำกันมีเพียง `.gitignore`, `AGENTS.md`, `CHANGELOG.md` (แก้ conflict แล้ว)
- **ทดสอบบนสำเนา SSD (2 รอบ ผลเท่ากัน, Node 23.11 ในเครื่อง):** server `tests/*.test.mjs` 658/658 (ชุดเดิมของ production 12 ไฟล์ 101/101 ผ่านครบ), release-invariants+order-safety 43/43, client `tests/*.test.mjs src/receiving-app/*.test.mjs` 808/808, pilot `pilot/*.test.mjs` 51/51, vite build หลัก + `build:receiving` ผ่าน; เปิด pilot `--port=8846 --ocr=mock --seed=all` บน MySQL จริงบน SSD (ข้อมูล SYNTHETIC) สร้างตาราง receiving_* ได้ 10 ตารางแล้วปิด. ไม่ได้รัน: e2e Playwright, gradle/APK
- **ผลทดสอบ / หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/integration-2026-10-20/release-port/REPORT.md`
- **ต้องทำก่อนปล่อยจริง:** รันสคริปต์สร้างตาราง `server/scripts/migrate-receiving-*.js` ในขั้น release ที่อนุมัติ (production ไม่สร้างตารางรับสินค้าอัตโนมัติ), ตั้ง env ตาม AGENTS.md หัวข้อระบบรับสินค้า, เจ้าของอนุมัติ deploy

## 2026-10-20 — ปล่อยชุดหน่วยนับ + หน่วยใช้ (UNIT-07..13) (Production)

- **ฐาน Production:** deployment ล่าสุด `e4a28baa` (14 ต.ค.) เป็น *redeploy* ของ `557b0769` (release `2026-10-08-super-admin-line`) ยืนยันจากชื่อ asset ที่ให้บริการตรงกับ build ใน deploy.log; release นั้นต่างจาก commit `c8c8884` 43 ไฟล์ (Discord, LINE group capture, order-safety ฯลฯ ที่ไม่เคย commit) → commit `ef18db1` sync ไฟล์เหล่านั้นจาก release ยกเว้นไฟล์ที่ชุดนี้แก้ (Production = c8c8884 ทุกไฟล์ที่แก้ จึงไม่ทับงานใคร)
- **Release:** `/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-20-units-usage/` = release เดิม + 24 ไฟล์ server/client ของชุดนี้ (256 ไฟล์) hash ตรงกับ commit ทุกไฟล์ (`release-manifest.sha256`)
- **ทดสอบ release (SSD):** server tests ทั้งหมด 101/101, preDeploy tests 45/45, client build ผ่าน (`tests.log`); server จาก release กับ DB สำเนา: หน่วยนับ 18/18, หน่วยใช้ 13/13, แท็บแปรรูป 11/11
- **Backup ก่อนเปลี่ยน schema (ตาราง `product_usage_units` ใหม่):** `/Volumes/SSD Files/SOLAO/market-order-system/backups/market-pre-units-usage-20261020/` mysqldump --single-transaction (336 MB gz), gzip -t ผ่าน, SHA256SUMS; **กู้คืนลง MySQL บน SSD ผ่าน** ครบ 116 ตาราง จำนวนแถวตรงกับ Production ทุกตาราง (`row-counts.tsv`, `manifest.json` hold=true)
- **Production:** SUCCESS `68bee663-3106-4188-9b00-fc8cfba45151` (20 ต.ค. 2026 17:50) ผู้ใช้อนุมัติ; จุด rollback `e4a28baa` (= 557b0769); `railway up . --path-as-root --ci -m "หน่วยนับ+หน่วยใช้แปรรูป db2c156"` จาก release directory; healthcheck `/health/db` ผ่าน, `/health` 200; asset ที่ให้บริการ (index-Cp-Mkfuc.js, index-CPRZQrt0.css, vendor, react-vendor) ตรงกับ build ใน `deploy.log` และ chunk ProductionTransform มีแท็บ "ตั้งค่าแปลงหน่วย"; route ใหม่ตอบ 401 เมื่อไม่มี token
- **ตั้งค่าหลัง deploy (Production DB):** สร้างตาราง `product_usage_units` ด้วย DDL เดียวกับโค้ด, เพิ่มหน่วย มิลลิลิตร (มล.) id 40, ตั้ง น้ำปลาทิพรส (229) และ น้ำปลาจันเพชร (706) หน่วยใช้ มล. ×4500 ใน transaction เดียว
- **ค้างอยู่:** ผู้ใช้ต้องการเริ่มสต๊อกใหม่ทั้งหมด (งานแยก ต้องอนุมัติแผน); หน่วยใช้ของ น้ำปรุงรสยำ 4.5 ลิตร / น้ำส้มสายชู / กระเทียมเจียว 300 กรัม รอตัวเลขจากผู้ใช้; รวมหน่วยซ้ำ (ข้อ 3) รออนุมัติ

 ในหน้าแปรรูป (UNIT-13)

- **สถานะ:** Local (ยังไม่ deploy) — branch `units/usage-unit-20261020` (ต่อจาก UNIT-12)
- **สิ่งที่ทำ:** `/production/transform` เพิ่มแท็บที่ 3 "ตั้งค่าแปลงหน่วย" แสดงเฉพาะวัตถุดิบ active ที่อยู่ในสูตรแปรรูปของแผนกผู้ใช้ (พร้อม "ใช้ใน" สินค้าปลายทาง) ค้นหาได้ ตั้ง/ยกเลิกหน่วยใช้ + จำนวนต่อ 1 หน่วยฐาน; บันทึกแล้วหน้าสร้างการแปรรูปโหลดค่าใหม่ทันที
- **API ใหม่:** `GET /api/inventory/production/usage-units?department_id=`, `PUT /api/inventory/production/usage-units/:productId` — แอดมินเลือกแผนกได้, ผู้ใช้ฝ่ายผลิตใช้ได้เฉพาะแผนกตัวเอง (แผนกอื่น 403), สินค้าที่ไม่อยู่ในสูตรแผนก 404; ใช้ตาราง `product_usage_units` เดียวกับหน้าตั้งค่าหน่วยสินค้า (ค่าเป็นของสินค้า ใช้ร่วมทุกแผนก)
- **ไฟล์:** `server/src/controllers/production-usage-unit.controller.js`, `client/src/pages/production/ProductionUsageUnitTab.jsx` (ใหม่); `server/src/models/product-usage-unit.model.js`, `server/src/routes/inventory.routes.js`, `server/src/controllers/inventory.controller.js` (export `canUseProductionTransform`), `client/src/api/inventory.js`, `client/src/pages/production/ProductionTransform.jsx`
- **ทดสอบบน SSD:** node:test 41/41; build ผ่าน; API สิทธิ์/ขอบเขตแผนกกับ DB สำเนา 11/11 (`previews/unit-mgmt-20261020/logs/usage-tab-scenarios.log`): แผนก 20 เห็น 41 รายการตรงกับสูตร; UI มือถือ 375 ไม่เลื่อนแนวนอน, 1440 ตรวจแล้ว

## 2026-10-20 — หน่วยใช้ต่อสินค้า: หน้าแปรรูปกรอกวัตถุดิบเป็น มล. ได้ (UNIT-12)

- **สถานะ:** Local (ยังไม่ deploy) — branch `units/usage-unit-20261020` ต่อจาก `units/unit-management-safety-20261020` (ต้องปล่อยพร้อมกัน)
- **ปัญหา (Production อ่านอย่างเดียว 20 ต.ค.):** น้ำปลาทิพรส/จั่นเพชรเก็บสต๊อกเป็นแกลลอน แต่ครัวกรอกวัตถุดิบเป็น มล. ในหน้าแปรรูป ช่วง มี.ค.–ส.ค. มีรายการกรอก 2,000–12,800 ลงช่องแกลลอน (ทิพรส 16 ครั้ง, จั่นเพชร 18 ครั้ง) ยอดแผนก 20 ติดลบ -109,898.70 / -134,495.90 แกลลอน; พบรูปแบบเดียวกับ น้ำปรุงรสยำ 4.5 ลิตร, น้ำส้มสายชู, กระเทียมเจียว 300 กรัม
- **สิ่งที่ทำ:** ตารางใหม่ `product_usage_units` (หน่วยใช้ + `usage_per_base` = 1 หน่วยฐานเท่ากับกี่หน่วยใช้) ตั้งที่ `/admin/settings/product-units` คอลัมน์ "หน่วยใช้ (แปรรูป)"; `GET /api/inventory/production/configs` ส่ง `required_ingredients[].usage_unit`; `POST /api/inventory/production/transform` รับ `ingredients[].input_unit_id` แล้ว server แปลงเป็นหน่วยฐาน ปัดทศนิยม 2 ตำแหน่ง (คอลัมน์สต๊อก DECIMAL(10,2) ตามที่ผู้ใช้เลือก) ต่ำกว่า 0.01 หรือหน่วยไม่ตรงคืน 400; ไม่ส่ง `input_unit_id` ทำงานเหมือนเดิม; หน้าแปรรูปแสดง "1 แกลลอน = 4,500 มล. → ตัดสต๊อก X" และสรุป "(ตัด X แกลลอน)"; หน่วยที่เป็นหน่วยใช้ถูกนับใน usage ของหน้าจัดการหน่วยนับ (ลบไม่ได้)
- **ไฟล์:** `server/src/utils/usage-unit-rules.js`, `server/src/models/product-usage-unit.model.js`, `server/tests/usage-unit-rules.test.mjs` (ใหม่); `server/src/controllers/inventory.controller.js`, `server/src/models/production-transform-config.model.js`, `server/src/models/product-unit-settings.model.js`, `server/src/controllers/product-unit-settings.controller.js`, `server/src/models/unit-usage.model.js`, `server/src/utils/unit-master-rules.js`, `client/src/utils/usage-unit.js` (ใหม่), `client/src/pages/production/ProductionTransform.jsx`, `client/src/pages/admin/masters/ProductUnitSettings.jsx`, `client/src/utils/unit-management.js`
- **ทดสอบบน SSD:** node:test ทั้งหมด 41/41; client build ผ่าน; scenario กับ DB สำเนา Production (backup 7 ต.ค.) 13/13 (`previews/unit-mgmt-20261020/logs/usage-scenarios.log`): 9000 มล. → -2.00, 3200 มล. → -0.71, payload เก่าไม่เปลี่ยน, 10 มล. 400, หน่วยผิด 400, ลบหน่วยใช้แล้วส่ง มล. 400, client เก่าบันทึกตั้งค่าไม่ลบหน่วยใช้; UI หน้าแปรรูปบันทึกจริงในสำเนาได้ -2.00 แกลลอน
- **ค้างอยู่:** ตั้งหน่วยใช้บน Production (เพิ่มหน่วย มิลลิลิตร แล้วตั้ง ทิพรส/จั่นเพชร ×4500) หลัง deploy; ผู้ใช้ต้องการเริ่มสต๊อกใหม่ทั้งหมด (งานแยก ต้อง backup + อนุมัติ); สูตรเมนูขายหน้าร้านยังใช้ตารางแปลงหน่วยสากลเหมือนเดิม

## 2026-10-20 — หน้าจัดการหน่วยนับ: กันลบหน่วยที่ใช้อยู่ + ปรับหน้า (UNIT-07..11)

- **สถานะ:** Local (ยังไม่ deploy) — branch `units/unit-management-safety-20261020`; รอบแก้ตามผลตรวจ Claude แก้ source ใน worktree เท่านั้น ไม่ build/install/เชื่อม DB/เปลี่ยน schema/commit/push
- **สิ่งที่ทำ:** กันลบหน่วยที่มีข้อมูลอ้างอิงทุกตารางที่กำหนดรวมสินค้าปิดใช้ (409 พร้อม usage); เพิ่ม query ดูการใช้งาน/หน่วยที่ลบแล้วและ route กู้คืนเฉพาะแอดมิน; ตรวจชื่อ/ตัวย่อและความยาว 50/10 code point คืน 400/404/409; ดักชื่อซ้ำรวมหน่วยที่ลบแล้ว
- **หน้าใช้งาน:** ค้นหา/จำนวนที่แสดง/สรุปการใช้งาน ปิดปุ่มลบพร้อมเหตุผล สวิตช์หน่วยที่ลบแล้วและปุ่มกู้คืน ลิงก์ไปตั้งค่าหน่วยสินค้า/แปลงหน่วย error ภาษาไทย; CSV นำเข้าตามลำดับ ข้ามชื่อซ้ำและสรุปเลขแถวพร้อมเหตุผล; แก้สินค้าเก็บ unit_id เดิมเมื่อหน่วยถูกลบ ไม่จับคู่ชื่อบางส่วน
- **ไฟล์:** `server/src/utils/unit-master-rules.js`, `server/src/models/unit-usage.model.js`, `server/src/models/unit.model.js`, `server/src/controllers/units.controller.js`, `server/src/routes/units.routes.js`, `server/tests/unit-master-rules.test.mjs`, `client/src/api/master.js`, `client/src/utils/unit-management.js`, `client/src/pages/admin/masters/UnitManagement.jsx`, `client/src/pages/admin/masters/ProductManagement.jsx`, `docs/modules/master-data.md`, `docs/modules/modules.json`, `AI_GUIDE.md`
- **รอบแก้ตามผลตรวจ Claude:** คอลัมน์จัดการเหลือปุ่มแก้ไข/ลบบรรทัดเดียวชิดขวา gap เท่ากันทุกแถว ย้ายเหตุผลเป็นคำอธิบายรวมสีเทา คง tooltip และเพิ่ม aria-disabled/aria-label พร้อมเหตุผล; การนับ usage รองรับทั้งตารางที่ยังไม่มีและคอลัมน์ lazy ที่ยังไม่ถูก ensure (`ER_BAD_FIELD_ERROR`/1054)
- **ผลตรวจที่ Claude รายงานก่อนรอบแก้นี้:** node:test 3 ไฟล์ที่เกี่ยวข้อง (`unit-master-rules`, `unit-rules`, `stock-ledger`) ผ่าน; `super-admin-line-login.test.mjs` ล้มใน SSD runner เพราะสำเนาไม่มี `server/node_modules` (`jsonwebtoken`) ไม่เกี่ยวกับงานนี้; client build บน SSD ผ่าน; API scenario กับ DB สำเนา Production (backup 7 ต.ค. 2026) บน SSD ผ่าน 18/18
- **ผลตรวจ UI ที่ Claude รายงานก่อนรอบแก้นี้:** desktop 1440 / มือถือ 375 ไม่มี horizontal scroll; แอปไม่มี dark mode ทั้งระบบ; ลบ/กู้คืน/สวิตช์หน่วยที่ลบแล้ว/ปุ่มลบ disabled ทำงาน และ UNIT-08 แสดง “ตัว (ถูกลบแล้ว)” ไม่เปลี่ยนเป็น “ตัวนับ”; หน่วยที่ไม่มีการใช้เลยในสำเนา = กรัม, ฝอง
- **ทดสอบหลังแก้รอบนี้ (Claude รันบน SSD):** node:test `unit-master-rules`, `unit-rules`, `stock-ledger` ผ่าน 29/29; client build ผ่าน; API scenario กับ DB สำเนา Production บน SSD ผ่าน 18/18 (`logs/api-scenarios-v2.log`); UI 1440 คอลัมน์จัดการปุ่มตรงแนวทุกแถว, มือถือ 375 หน้าไม่เลื่อนแนวนอน (ตารางเลื่อนในกรอบเหมือนหน้าแอดมินอื่น); `git diff --check` ผ่าน
- **หลักฐาน/รายงาน:** `/Volumes/SSD Files/SOLAO/market-order-system/previews/unit-mgmt-20261020/` (`api-scenarios.mjs`, `logs/api-scenarios.log`); ผล node:test รอบแก้แสดงในแชต ไม่มีไฟล์ผลลัพธ์ใหม่
- **ค้างอยู่:** Production มี deployment `e4a28baa` (14 ต.ค. 2026) ที่ไม่มีบันทึก ต้องเทียบฐานก่อน deploy งานนี้; รวมหน่วยซ้ำ เช่น กก./กิโลกรัม ยังไม่ทำ — รออนุมัติข้อ 3; การตรวจอ้างอิงก่อนลบยังไม่ได้ล็อกร่วมกับ writer ทุกโมดูล ต้องประเมิน concurrent writes ก่อนปล่อยจริง

## 2026-10-08 — Super Admin เข้าสู่ระบบด้วย LINE + ปิด PIN 1997 (Production)

- **สถานะ:** Production `557b0769-045e-4fb6-8714-a42cfee181c1` (rollback `0af75d5f`), branch `auth/super-admin-line-2026-10-08`
- **สิ่งที่ทำ:** ตั้ง `SUPER_ADMIN_PIN` สุ่มใน Railway (PIN 1997 ใช้ไม่ได้แล้ว); ลบปุ่ม PIN จากหน้า login; เพิ่ม LINE Login สำหรับ Super Admin ใช้ channel เดียวกับ HRMS อนุญาตเฉพาะ LINE userId ใน `SUPER_ADMIN_LINE_USER_IDS`; env/route ใหม่ดู `docs/releases/2026-10-08-super-admin-line.md`
- **ผลทดสอบ:** tests 85/85, build ผ่าน, ทดสอบ endpoint บน server จริงกับ DB สำเนา SSD, Production health 200
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/releases/2026-10-08-super-admin-line/`
- **ค้างอยู่ (ผู้ใช้):** เพิ่ม Callback URL ใน LINE Developers และใส่ `LINE_LOGIN_CHANNEL_SECRET` ใน Railway; `STORE_PIN`/`GENERAL_PURCHASE_READONLY_PIN` ยังเป็น 1997

## 2026-10-08 — แก้บั๊กแปลงหน่วย UNIT-01..06 + UX ตัวคูณ (Production)

- **สถานะ:** Production `27ab75c3` — branch `units/conversion-ux-fixes-2026-10-08` (ไม่ push, ไม่แตะ schema)
- **สิ่งที่ทำ:** UNIT-01 แก้ `saveProductUnitSettings` (500 หลังเขียนข้อมูล) และทำให้ atomic ด้วย transaction เดียว; UNIT-02 สูตรใช้หน่วยฐานของสินค้าที่เลือกเสมอ + server คืน 400 เมื่อหน่วยไม่ตรงและไม่มีตัวแปลง; UNIT-03 รายการตั้งค่าหน่วยโหลดได้ถึง 2000 พร้อม `total` และข้อความ "แสดง X จาก Y"; UNIT-04 ประโยค "1 หน่วย = N หน่วยฐาน" + เตือนเมื่อ N<1 + หัวคอลัมน์ภาษาไทยบอกทิศ + คำอธิบายหน้าแปลงหน่วย; UNIT-05 กันเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง (409, override ด้วย `force_unit_change`)
- **API:** `GET /api/product-unit-settings` เพิ่ม `total`; `PUT /api/product-unit-settings/:id` และ `PUT /api/products/:id` ตอบ 409 (`code: BASE_UNIT_CHANGE_BLOCKED`, `references`) และคืน `warning` เมื่อ force; `POST /api/recipes/:id/items`, `PUT /api/recipes/items/:itemId` ตอบ 400 (`code: RECIPE_UNIT_MISMATCH`)
- **ผลทดสอบ:** node:test 18/18 (เพิ่ม `server/tests/unit-rules.test.mjs` 4 รายการ), client build ผ่าน, import โมดูล server ผ่าน (ไม่มีการทดสอบกับ DB จริง)
- **หลักฐาน:** `/Volumes/SSD Files/SOLAO/market-order-system/reports/units-ux-fixes-2026-10-08.md`, `docs/modules/master-data.md`
- **ค้างอยู่:** snapshot ตัวคูณหน่วยซื้อใน PO, หน่วยนับสต๊อกแยกตามแผนก, ผลข้างเคียงที่การตั้งหน่วยซื้อเขียน `unit_conversions` สากล, ทดสอบ flow จริงกับ MySQL ก่อน deploy
- **ตรวจเพิ่มบน DB สำเนา (SSD):** ลบการเขียนทับ `unit_conversions` สากลจากการตั้งหน่วยซื้อ (UNIT-06); แก้ save ค้าง lock wait timeout ตอนเรียกครั้งแรกหลัง restart (ensure/backfill schema ใช้ pool แยกระหว่าง transaction) โดยเตรียม schema ก่อนเปิด transaction; แก้ `updateTemplate` อ้าง `db` ที่ไม่มี (พารามิเตอร์ connection ใส่ผิดฟังก์ชัน); scenario กับ MySQL 8/8 ผ่าน (`logs/units-scenarios.log` ใน previews/inv-bugfix-20261007T151025)

- **Production:** SUCCESS `27ab75c3-0729-4b20-9eee-e452d883a745` (8 ต.ค. 12:03) ฐาน release discord-format `7a9826b4`; รอบแรก `36cb15fe` ใช้ฐานเก่าทำงาน Discord หาย ~2 นาที ไม่มีออเดอร์ช่วงนั้น ดู `docs/releases/2026-10-08-units-ux.md`
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

# ประวัติงานรับสินค้า (ยกมาจาก CHANGELOG ของ branch receiving/integration-20261020)

### 2026-10-20 — แก้ UX จากการทดสอบมือถือจริง 072q (branch receiving/ui-device-fixes-q, ยังไม่ commit)
- Q3 หน้านับ: แถวเดียวต่อสินค้า (ชื่อ | ช่องนับ | ปุ่ม 0 ขนาด 44px) คำอธิบาย "ว่าง = ยังไม่นับ" แสดงครั้งเดียวด้านบน; 360×800 เห็น 4 รายการ (เดิม 1)
- Q2 หมายเหตุรายการ: ปุ่ม "+ หมายเหตุ" แล้วค่อยเปิดช่อง (เปิดเองเมื่อมีหมายเหตุ); เหตุผลของนอกใบสั่งยังแสดงเสมอ
- Q1 สรุปใบไม่มีบิล: บรรทัดเดียว "ไม่มีบิล · บัญชีขอบิลและตรวจราคา" รายละเอียดมูลค่าพับไว้
- Q4 คิว: การ์ดร้านใช้เลือกร้านอย่างเดียว ปุ่มเริ่มรับของมีปุ่มเดียวด้านล่าง
- ทดสอบบน SSD 2 รอบ: server 642 · client 808 · pilot 51 · vite build ทั้งสองผ่าน (ไม่มีการเปลี่ยน server/API)

### 2026-10-20 — รวมงานรับสินค้า + เชื่อมบัญชีเจ้าหนี้ + สต๊อก + ออกแบบ UI (สถานะ: Local / Staging บางส่วน)

ผู้ทำ: Codex gpt-6.1-sol (A1, B, C, D, UI-1..UI-5), Sonnet subagents (แก้/รวม), Claude ตรวจ/รวม/ทดสอบ
ผลทดสอบล่าสุด (int-r4, 2 รอบบน SSD): server 642/642 · client 797/797 · pilot 51/51 · vite build ทั้งสองผ่าน · APK `reports/receiving-int-r4/receiving-debug.apk`

#### งานที่รวมใน branch นี้
- **ฐาน receiving/apk 0e9cda5** (งาน 20 ต.ค. ก่อนหน้า): คิวรวมร้านไม่บังคับรับ, หน้าร้านค้าและชื่อย่อ (1 แถว/ร้าน, รหัสเจ้าหนี้ตามสาขา, ลิงก์ไปหน้าซัพเดิม), เตือนจำนวนผิดปกติ, หมายเหตุต่อบรรทัด, void ข้ามวันโดยบัญชี 7 วัน, ใบวางบิล/ใบสรุปรอบ (statement), ส่วนลดบรรทัดติดลบ, จับคู่ด้วยรหัสสินค้าในบิล, แผ่นเซ็นเต็มจอ, รับของค้าง (รับก่อนหน้า/ยังขาด), 11ข (ยืนยันรับไม่เขียน actual_price), 10ข (ซ่อนเมนูรับสินค้าเดิม + สวิตช์ LEGACY_RECEIVING_WRITES_ENABLED), Dockerfile Node 22
- **A1** `fa6d38c` endpoint ส่งออกใบรับของให้บัญชีเจ้าหนี้ `GET /api/receiving-export/ap/v1/documents` (env `RECEIVING_EXPORT_TOKEN`, ไม่ตั้ง = 503) + `receiving_supplier_branch_codes.branch_id` + index — สัญญา `reports/integration-2026-10-20/CONTRACT-receiving-ap-export-v1.md`
- **B** `78283c1` สต๊อก: ล็อกยอดคงคลังร่วม, คืนของลดสต๊อกแบบระบุจำนวนหน่วยฐาน (ตาราง `receiving_issue_stock_returns`), กันลดซ้ำตอน void, ลิงก์ที่มาใบรับใน StockMovements/StockCheck
- **C** `5509367` + `b6426c4` เพิ่มสินค้าให้ร้าน/นำเข้า CSV พร้อม preview + ชื่อย่อ/รหัสในบิล ใน transaction + audit; pilot seed แม่ริม SYNTHETIC; แก้ DDL pilot ที่ MODIFY คอลัมน์ FK บน MySQL จริง
- **UI-1** `7e96f09` คิว: แยกว่าง/ผิดพลาด, CTA ตามร้าน, ฟอร์มนับ/IME
- **UI-2** `4b5d303` เทียบบิล/สรุป/เซ็น/สำเร็จ: ป้าย blocker, ledger ที่ทราบ/ไม่ทราบ, ลำดับขั้น 4 ช่อง (นับ·ตรวจ·สรุป·เซ็น), AI provenance
- **UI-3** `cd2f0f6` โทเคนดีไซน์ร่วม + หน้าแอดมินรับของ/ร้านค้า + เลือกสาขาจริงให้รหัสเจ้าหนี้
- **UI-4** `6dfc11f` ลำดับชั้นหน้าติดตามปัญหา
- รวม/แก้หลังรวม: `10d0e5a`, `0627ea1`, `62c2266`, `01434cf` (เทสต์ class shell ตามพฤติกรรม), `d8315ef`

#### งานคู่ใน general-cashflow (branch แยก ยังไม่รวม)
- **A2** `cashflow/ap-receiving-import` `a1ebcc8` นำเข้าใบรับของเป็นหลักฐานซื้อใน AP ledger (ไม่สร้างยอดจ่าย), กันซ้ำกับ LBC, env `MARKET_RECEIVING_EXPORT_URL`/`MARKET_RECEIVING_EXPORT_TOKEN` — server 398 · client 81
- **UI-5** `cashflow/ap-ui-redesign` `f626b02` หน้า AP ledger/ใบรับของตามโทเคนร่วม — server 398 · client 83

#### Deploy / สถานะ
- Staging `solao-receiving-staging`: deployment `1216ff56` (commit 4631bd0 ของ receiving/apk) SUCCESS 2026-10-20 17:35 — **deploy ครั้งนั้นไม่ได้ใส่ `-m` และยังไม่ได้ตรวจ hash runtime** (ผิดข้อ 7 AGENTS.md — รอบหน้าทำครบ)
- Production: **ยังไม่ deploy / ยังไม่ migrate / ยังไม่ push** — รอเจ้าของอนุมัติ; ต้องประกอบ branch รวมจาก production-base ก่อนปล่อย
- Schema ใหม่ (additive) ที่ต้องมีก่อนปล่อย: ดู `reports/receiving-overnight-2026-10-18/RELEASE-PLAN.md` + ตาราง `receiving_issue_stock_returns`, คอลัมน์ `receiving_supplier_branch_codes.branch_id`, index `idx_receiving_documents_export`, `uq_receiving_supplier_branch`

#### ค้าง
- ตรวจภาพหน้าจอ 375/1440 สว่าง/มืด ของ UI ใหม่ และทดสอบบนมือถือจริงกับ build int-r4
- รหัสเจ้าหนี้ตามสาขาที่บันทึกก่อนมี branch_id ต้องผูกสาขาใหม่ในหน้าร้านค้า
- MODIFY COLUMN เก่าใน supplier.model.js:87, purchase-order.model.js:37 (นอกเส้นทางงานนี้)
- โทรศัพท์ทดสอบต่อ Wi-Fi ที่ไม่มีอินเทอร์เน็ต — ใช้ proxy ผ่าน USB (127.0.0.1:8842 → staging) ชั่วคราว
