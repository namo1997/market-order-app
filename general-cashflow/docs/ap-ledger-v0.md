# เจ้าหนี้ & สมุดรายวันซื้อ v0

สถานะ: โค้ด Local และ importer สำหรับตรวจทานเท่านั้น ห้ามนำงบทดลองการเคลื่อนไหว AP ไปแทนงบทดลองบริษัท ข้อมูลซื้อ/ยอดยกมา/ภาษีที่ไม่มีหลักฐานต้องเป็น unknown ไม่ใช่ศูนย์ ไม่มีการ migrate AP ตอนเริ่ม Cashflow และไม่มี API เขียนบัญชี

ส่วนเพิ่มยอดยกมา: ดู [วิธีกรอก CSV และตัวนำเข้า AP opening](ap-opening-balance.md) รองรับ `--ap-opening <csv>` ใน local preview; สาขาที่รับรองยอดครบคำนวณคงค้างได้ ส่วนอายุยอดยกมาใช้วันยกมาเป็นฐานประมาณ พร้อมธงและข้อจำกัดใบรับของ/การจ่ายที่ยังไม่ครบ

ส่วนเพิ่ม A2: ดู [นำเข้าหลักฐานใบรับของจากตลาดสด](ap-receiving-import.md) สำหรับ additive schema, admin pull, การจับคู่ LBC และ void โดยไม่สร้างยอดจ่ายหรือ posting อัตโนมัติ

## โครงสร้างและสิทธิ์

- `server/src/ap/schema.js`: CREATE TABLE IF NOT EXISTS เฉพาะตาราง `ap_*` เงิน DECIMAL(14,2) ไม่ ALTER/เขียนตาราง Cashflow เดิม
- `domain.js`: เงินสตางค์แบบ integer; journal สมดุล; ภาษีซื้อ gross × 7/107 เฉพาะหลักฐานเต็มรูป; กลับรายการแบบ append เชื่อม journal เดิม; คืนบางส่วนที่ไม่ระบุ allocation จะถูกปฏิเสธ
- `snapshot.js`: allowlist ตารางการเงิน ตรวจ SHA256/จำนวนแถวจาก manifest ไม่อ่าน credentials/users/attachments ไม่อ่านไฟล์สมุดรับจ่ายหรือเรียกบริการภายนอก
- `report.js`: รายงานจาก journal ที่ persist จริง; opening/closing/aging เป็น null เมื่อหลักฐานไม่ครบ; FIFO เป็นเพียงการจัดอายุหนี้ในขอบเขตที่รับรองว่าครบแล้ว
- `GET /api/ap/report?month=YYYY-MM&branch=KK`: authenticate + `report:pnl` ตามระบบเดิม (ปัจจุบัน admin เท่านั้น) ไม่เพิ่มสิทธิ์ให้ recorder/auditor/cashier และไม่สร้าง role บัญชีใหม่เอง; POST/PUT/DELETE = 405 ยกเว้น POST `/api/ap/receiving/sync` สำหรับหลักฐานใบรับของ (ไม่เขียนบัญชี)
- `ApLedger.jsx`: เมนู admin บน desktop และปุ่ม AP ใน header มือถือ (พร้อมปุ่มกลับไปรับเงิน), รองรับ `?view=ap` หลัง login มีทะเบียนเจ้าหนี้ สมุดรายวัน งบทดลอง และกระทบยอด ไทย/สว่าง/มืด

## การรับรู้และป้องกันนับซ้ำ

source key `lbc:bill:<id>` ใช้ร่วมกับ P&L ต้นทาง `ap_source_links` ระบุ SAME_PNL_EVENT ไม่มีการบวกยอด AP เข้า P&L เดิม ไม่มีการแก้ overrides/period ของเดิม

snapshot รายจ่ายเป็นหลักฐานจ่าย ไม่มีวันที่รับของและข้อมูลใบกำกับภาษีเต็มรูป จึงลงเฉพาะรายการชั่วคราวจากหลักฐานจ่าย:

- ซัพเครดิตที่จับทะเบียนได้ชัดเจน: Dr AP / Cr เงินสดหรือธนาคารยังไม่ระบุบัญชี ไม่สร้างบิลรับของให้เอง
- purchase ที่ไม่พบในทะเบียนเครดิต: Dr หมวดค่าใช้จ่ายเดิม / Cr เงินจ่าย พร้อมธงยังไม่ทราบวันรับของ ไม่อ้างว่าเป็นยอดซื้อเกณฑ์คงค้างที่ยืนยันแล้ว
- pass-through พี่เก้ง: Dr สินทรัพย์เงินผ่าน ไม่ใช่ต้นทุน/ภาษีซื้อ
- ประเภทไม่ชัด/ซัพตรงหลายกฎ/รอบไม่ปิด: รายการรอตรวจ ไม่มี posting อัตโนมัติ
- ธนาคารต้องมี debit และ reference ผูกซัพก่อนนำมาหักหนี้ ไม่มีการจับคู่ด้วยยอดเท่ากัน การรับเงินผ่านช่องทางรับเงินไม่ใช่การจ่ายซัพ

รับของ 1–15 ครบกำหนด 20; รับของ 16–สิ้นเดือนครบกำหนด 5 เดือนถัดไป วันที่จ่าย 5–6 ของซัพเครดิตจัดเป็นของเดือนก่อน แต่ไม่สร้างวันรับของหรือยอดยกมาจากข้อสันนิษฐานนี้

## สัญญา adapter ใบสั่ง–รับของ–บิล

`threeWayMatch({ order_items, receiving_documents, bill_items })` รับ array ทั้งสามชุด แต่ละแถวเป็น `{ itemKey, quantity, unitPrice, unit }` quantity เป็น decimal string ได้ 6 ตำแหน่ง ราคาเป็น decimal text สองตำแหน่ง `itemKey` ต้องอ้าง order_items เดียวกัน ห้ามเดา key จากชื่อสินค้า

ตัวอย่างสมมติ: `{ itemKey: 'order:item:example', quantity: '1.125', unitPrice: '107.00', unit: 'kg' }` ทั้งสามชุดตรงกันจึง matched; unit/จำนวน/ราคาไม่ตรงแยก differences เป็นรายการรอตรวจ เอกสารหายยัง pending ไม่มี dependency/network/write ไปยังงาน APK ใช้ `ap_match_cases` เก็บสถานะรอเอกสาร การรับ adapter เข้าฐานในอนาคตต้องผ่านการตรวจและ API ที่มี audit แยกต่างหาก

## Import/preview (SSD เท่านั้น)

ใช้สำเนา source+node_modules บน SSD ไม่มี symlink dependencies กลับ Mac และไม่มี `.env` ตั้ง TMPDIR/TMP/TEMP/npm cache ลง SSD ก่อนทุกคำสั่ง

`server/scripts/local-preview.mjs --ap-snapshot <snapshot-directory> --root <SSD-run-preview-directory> --output <SSD-report-directory> --port 5189`

AP mode แยกจาก preview เดิม ใช้ native MySQL บน SSD ผ่าน Unix socket แบบ skip-networking ไม่มีรหัสผ่าน/โทเคน/คีย์ที่สร้างขึ้นสำหรับ preview, ไม่โหลด config หรือ dotenv; directory สิทธิ์ 0700, ไม่เปิด DB ทาง TCP และไม่ติดต่อ DB เดิม ต้องตรวจ native binary/SSD policy ก่อนใช้ ไม่ retry ล้าง datadir ที่ initialize ไม่สมบูรณ์

`import-ap-snapshot.mjs --snapshot <snapshot-directory> --socket <SSD-run-preview-directory>/mysql.sock --output <SSD-report-directory>` ใช้ได้เฉพาะ offline MySQL ที่ตรวจ @@datadir/@@socket อยู่บน SSD และ @@skip_networking เท่านั้น ชื่อฐานต้องเป็น `ap_ledger_preview_*` Import transaction เดียว + journal validation; snapshot fingerprint เดิมไม่เพิ่มรายการซ้ำ snapshot เปลี่ยนในเดือนเดิมหยุดให้ตรวจ ไม่ overwrite ประวัติ

Docker preview เดิมยังเป็น workflow เดิม งาน AP ไม่เรียก Docker หาก DataFolder ไม่ผ่าน SSD policy ไม่ย้ายหรือหยุด Docker ของผู้ใช้อัตโนมัติ

`export-ap-review.mjs <snapshot-directory> <SSD-report-directory>` สร้าง JSON + HTML offline จากผลคำนวณเดียวกัน ใช้เมื่อจำเป็นต้องตรวจข้อมูลแยกจาก DB **ไม่ใช่หลักฐานว่า MySQL/API/localhost ใช้งานได้** ไฟล์มีข้อมูลภายใน ห้ามนำขึ้น git/เว็บสาธารณะ

## Validation และการรับช่วงต่อ

- `node --test test/apLedger.test.js` ครอบคลุมบัญชีคู่/กลับรายการ/รอบจ่าย/วันที่ 5–6/เงินผ่าน/แหล่งซ้ำ/VAT/สตางค์/adapter/สิทธิ์/API อ่านอย่างเดียว (ทดสอบ router โดยตรง ไม่ใช่ HTTP E2E)
- server `CASHFLOW_DECISION_REASON_REQUIRED=0 node --test`; client `node --test` และ `npm run build` จาก SSD snapshot ที่คัดลอก node_modules แล้ว
- ต้องรัน import สองรอบบน MySQL จริงและตรวจแถว/ยอด/fingerprint เท่าเดิม ก่อนถือว่า import idempotency ผ่านจริง
- ต้องทดสอบ authenticated API และ browser localhost เมื่อสภาพแวดล้อมอนุญาต listen แล้ว ภาพหน้าจอ offline อย่างเดียวไม่ยืนยันการผูก API
- SQL `server/scripts/ap-gap-export.sql` เป็น read-only template ให้เจ้าของตรวจ schema ระบบใบสั่ง/รับของก่อนรัน ไม่ใช่ migration และยังไม่เคย execute ตาราง/column อาจยังไม่เกิดขึ้นในระบบ APK
- ข้อจำกัด ผลตรวจจริง และตัวเลขจริงอยู่บน SSD ที่ `reports/ap-ledger-v0/REPORT.md` เท่านั้น ไม่เก็บข้อมูลจริงลง fixture/git
