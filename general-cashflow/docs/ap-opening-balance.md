# นำเข้ายอดเจ้าหนี้ยกมา — Local เท่านั้น

ใช้ร่วมกับ `ap-ledger-v0.md` งานนี้ไม่มี API เขียนบัญชีและไม่แก้ client ตัวนำเข้ารับเฉพาะ MySQL offline บน SSD ผ่าน Unix socket ไม่โหลด `.env` หรือเชื่อม Production

## วิธีกรอกสำหรับเจ้าของ

แม่แบบอยู่ที่ `/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance/opening-balance-template.csv`

1. ทำสำเนาแม่แบบเป็นไฟล์ใหม่บน SSD เช่น `opening-balance-filled.csv` แล้วเปิดด้วยโปรแกรมตารางที่รองรับ CSV UTF-8
2. กรอกเฉพาะ **ยอดยกมา (บาท)** และ **หมายเหตุ** อย่าแก้ชื่อคอลัมน์ สาขา รหัสซัพ หรือชื่อซัพ รหัสซัพเป็นรหัสของระบบ ให้คงทั้งข้อความไว้
3. ยอดคือเงินที่ร้านยังค้างซัพ ณ สิ้นวันที่ **31 สิงหาคม 2569** แยกตามสาขา รวมบิลก่อนหน้านั้นที่ยังไม่จ่าย ไม่รวมของที่รับเดือนกันยายน
4. ใส่ตัวเลข เช่น `12500.50` ไม่ใส่เครื่องหมายคั่นหลักพัน สัญลักษณ์บาท หรือสูตร ยอดต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง
5. ถ้าไม่มีหนี้ ให้กรอก `0` ถ้ายังไม่ทราบให้เว้นว่าง ระบบจะบอกว่าขาดซัพนั้น ไม่แทนช่องว่างด้วยศูนย์
6. วันที่ยกมาให้คงเป็น **`2026-08-31`** (ปี ค.ศ.) อย่าเปลี่ยนเป็นปี 2569 หรือวันที่แบบ `31/08/2569`
7. เก็บทุกแถวไว้ แต่ละสาขามีซัพชุดเดียวกันได้ เพราะยอดหนี้แยกสาขา หากซัพนั้นไม่ได้ซื้อเลยให้กรอก 0 หลังตรวจแล้ว
8. บันทึก CSV UTF-8 (มี BOM ได้) ลง SSD ส่งให้ผู้ดูแลนำเข้า อย่าบันทึกทับแม่แบบเปล่า

ตัวอย่างสมมติ: ซัพ ก สาขา X มีบิลค้าง 10,000 บาท จ่ายก่อนสิ้นสิงหาคมแล้ว 4,000 บาท → กรอก `6000.00` หากยังไม่ทราบวันครบกำหนด ให้ใส่หลักฐาน/คำอธิบายในหมายเหตุได้

## นำเข้าและ preview

คำสั่งรันจาก `server/` **ใน source snapshot บน SSD** ที่คัดลอก dependencies แล้ว ตั้ง `TMPDIR`, `TMP`, `TEMP`, npm cache และผลทดสอบลง SSD ตาม SSD_POLICY ใช้ผลตรวจ SSD ที่เจ้าของให้มาในงานนี้ ไม่เรียก check/diskutil ซ้ำ

สร้างแม่แบบจาก snapshot (ไฟล์ปลายทางต้องยังไม่มี):

```sh
node scripts/import-ap-opening.mjs \
  --template '/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance/opening-balance-template.csv' \
  --snapshot '/Volumes/SSD Files/SOLAO/market-order-system/backups/cashflow-grab-fee-final-snapshot-1791864456021' \
  --month 2026-09
```

รายการซัพใช้ชุดเดียวกับ `compileSnapshot`: ซัพเครดิต active × สาขา จึงไม่เดาว่าซัพที่ไม่เคยมีการจ่ายในเดือนนั้นมีหนี้เป็นศูนย์ รหัสใน CSV = `credit:<branch>:<pnl_credit_suppliers.id>`

เริ่ม preview ใน root ใหม่บน SSD ที่สร้างไว้ก่อนแล้ว (ห้ามใช้ root ที่ MySQL ยังทำงานอยู่):

```sh
node scripts/local-preview.mjs \
  --ap-snapshot '/Volumes/SSD Files/SOLAO/market-order-system/backups/cashflow-grab-fee-final-snapshot-1791864456021' \
  --ap-opening '/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance/opening-balance-filled.csv' \
  --root '/Volumes/SSD Files/SOLAO/cashflow/runs/ap-opening-preview' \
  --output '/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance' \
  --port 5191
```

เปลี่ยน CSV ระหว่าง preview ทำงานอยู่:

```sh
node scripts/import-ap-opening.mjs \
  --csv '/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance/opening-balance-filled-v2.csv' \
  --socket '/Volumes/SSD Files/SOLAO/cashflow/runs/ap-opening-preview/mysql.sock' \
  --output '/Volumes/SSD Files/SOLAO/cashflow/reports/ap-opening-balance' \
  --database ap_ledger_preview_202609 --month 2026-09
```

ไฟล์ผล `ap-opening-report.json` และ `opening-import.json` เป็นข้อมูลภายในบน SSD ห้ามนำเข้า git ส่วน `ap-report.json` เดิมเป็นผลก่อนนำเข้ายอดยกมา ให้ใช้รายงาน opening หรือ GET API ปัจจุบัน

## พฤติกรรมบัญชีและประวัติ

- CSV แต่ละฉบับ **แทนทั้งเดือนทุกสาขา** ไม่ใช่การเติมเฉพาะแถว แถวที่หาย/ยอดว่างในฉบับใหม่ทำให้ซัพนั้นกลับเป็นไม่ทราบ
- ตรวจทั้งไฟล์ก่อนลงยอดบัญชี: คอลัมน์ตรงแม่แบบ, UTF-8, รหัส/ชื่อ/สาขาตรงทะเบียน, ไม่ซ้ำ, เงินใน DECIMAL(14,2), วันตรงวันก่อนเดือนเปิด ข้อผิดพลาดระบุแถว CSV โดยไม่ log ข้อมูลส่วนตัว การเตรียมตาราง/ผังบัญชีแบบ idempotent ทำก่อน transaction ตาม importer เดิม
- fingerprint คำนวณจาก month + รายการยอดที่ยืนยัน เรียงรหัสซัพ; BOM, newline, quoting, ลำดับแถว และ `100`/`100.00` ให้ผลเหมือนกัน เปลี่ยนหมายเหตุของยอดที่กรอกถือเป็นฉบับใหม่
- เทียบกับ **ฉบับล่าสุด** เท่านั้น นำเข้าไฟล์เดิมไม่เพิ่มแถว หาก A → B → A ต้องสร้างการแก้กลับเป็น A จริง
- ยอดบวกสร้าง journal `opening`: Dr OPENING_CLEARING / Cr AP ผูกซัพ ยอดศูนย์มีหลักฐานรับรองในเอกสารนำเข้า ไม่สร้าง journal ศูนย์ที่ขัดข้อกำหนดบัญชี
- ฉบับใหม่สร้าง reversal เชื่อม journal opening ของฉบับก่อน แล้วสร้าง opening ใหม่ วันที่ลงทั้งสองรายการเป็นวันยกมาเดิม เพราะเป็นการแก้ฐานเปิดงวด ไม่ใช่ค่าใช้จ่ายเดือนปัจจุบัน `created_at` เก็บเวลานำเข้าและ `previous_id` เชื่อมประวัติ ไม่ DELETE/UPDATE journal เก่า
- เพิ่มตาราง `ap_opening_imports` ด้วย CREATE TABLE IF NOT EXISTS เท่านั้น ไม่ ALTER ตาราง Cashflow เดิม ใช้ lock ที่ batch ของเดือนเพื่อ serialize รวมถึงการนำเข้าครั้งแรก รายการ, หลักฐาน, control และ import history อยู่ใน transaction เดียว
- snapshot ใหม่จะตรึงรหัสซัพของแต่ละสาขาใน period control; ฐาน preview เก่าที่ไม่มีรายการตรึงใช้ทะเบียน AP เดิมเป็น fallback
- ตั้ง `ap_period_controls.opening_complete` รายสาขาเมื่อซัพเครดิตทุกตัวมีจำนวนเงินรวมศูนย์ รายงานรวมจะ complete เมื่อทุกสาขาครบ

## สัญญารายงานสำหรับต่อ UI

`GET /api/ap/report?month=2026-09&branch=KK` ใช้สิทธิ์เดิมและอ่านอย่างเดียว:

- `controls.openingComplete`, `controls.missingSuppliers[]` และ `controls.byBranch[]` ระบุความครบ/ชื่อซัพที่ขาด สาขาที่กรอกครบคำนวณได้แม้อีกสาขายังขาด แต่ละสาขามี `openingImportId`/`openingFingerprint` อ้างฉบับล่าสุด (`fingerprint` ระดับรายงานยังเป็น fingerprint ของ snapshot เดิม)
- `ledger[].opening`, `closing`, `aging`, `advance` คำนวณเมื่อ opening ครบทั้งสาขา; `missingOpening`/`openingConfirmed` บอกสถานะรายซัพ
- `ledger[].purchases` ยังเป็น null หากใบรับของไม่ครบ; `observedPurchases` คือยอดที่พบ ไม่ใช่ยอดซื้อที่รับรองครบ
- `branchRows[].closing` รวมยอดซัพเมื่อสาขาครบ `provisional` และ purchases/payments controls ยังคงแสดงข้อจำกัดข้อมูล
- อายุหนี้ใช้ FIFO เรียงวันที่ และตัดคู่รายการกลับ/ต้นฉบับออกจากกองหนี้ก่อนจัดอายุ ไม่ปล่อยให้ยอดยกมาเก่ากินยอดจ่ายของชุดใหม่
- **ข้อจำกัดอายุหนี้:** CSV ไม่มีวันครบกำหนดบิลเดิม ยอดยกมาใช้วันยกมาเป็นฐานอายุประมาณ (`agingBasis=AS_OF_DATE_ESTIMATE`, journal flag `OPENING_AGE_FROM_AS_OF_DATE`) เช่น 31 ส.ค. ถึง 30 ก.ย. = 30 วัน ไม่อ้างว่าเป็น overdue จริงของบิลสิงหาคม ส่วนบิลใหม่ที่มี due date ใช้ due date ตามปกติ ยอดจ่ายเกินแสดงเป็น `advance` และ closing ติดลบ ไม่แสดงอายุหนี้ติดลบ
- opening ครบช่วยคำนวณจากยอดที่มี แต่ไม่รับรองว่าใบรับของ/จ่ายเงินเดือนกันยายนครบ และไม่แก้ P&L หรือจับคู่ statement เพิ่มเอง

## ทดสอบ

```sh
node --test test/apLedger.test.js test/apOpening.test.js
AP_OPENING_TEST_SOCKET='/Volumes/SSD Files/SOLAO/cashflow/runs/ap-opening-preview/mysql.sock' \
  node --test test/apOpening.test.js
CASHFLOW_DECISION_REASON_REQUIRED=0 node --test
```

MySQL test สร้างฐานชื่อ `ap_ledger_preview_opening_test_<time>` แยกบน instance offline เดิม ใช้ข้อมูลสมมติ ตรวจ SQL จริง, replay, replacement, A-B-A, Dr=Cr, rollback หลัง insert fail และการนำเข้าพร้อมกัน ไม่แตะฐาน preview หลัก หากไม่ระบุ socket จะ skip เฉพาะเทสต์นี้ เทสต์ transaction model แยกตรวจ importer ได้โดยไม่เปิด socket แต่ไม่ทดแทนผล MySQL จริง

สถานะทดสอบจริงและข้อจำกัด sandbox ดู REPORT.md บน SSD
