# General Cashflow - System And Database Reference

เอกสารนี้สรุปโครงสร้างระบบ `general-cashflow` สำหรับใช้อ้างอิงร่วมกับทีม, Google Sheets, หรือ AI ตัวอื่น โดยระบบนี้แยกจากระบบสั่งของตลาดสดและอ่านข้อมูล POS จาก ClickHouse แบบ read-only เท่านั้น

## ภาพรวมระบบ

- ชื่อระบบ: `general-cashflow`
- ขอบเขตปัจจุบัน: รับเงินหน้าร้านรายวันต่อสาขา
- Frontend: React/Vite
- Backend: Node.js/Express
- Database หลัก: MySQL ชื่อ `general_cashflow_db`
- POS source: ClickHouse database `dedebi`
- Production URL: `https://general-cashflow-production.up.railway.app/`
- หน้าแคชเชียร์: `https://general-cashflow-production.up.railway.app/?cashier=1`

## Role และสิทธิ์ใช้งาน

| Role | หน้าที่หลัก |
| --- | --- |
| `cashier` | เลือกสาขา/วันที่, ดึงยอดจาก POS, กรอกยอดที่นับได้, กรอกเงินทอนตอนเช้า, แนบรูป/เอกสาร, ส่งยอด |
| `auditor` | ตรวจยอดเงินสด/statement, อัปโหลด statement, จับคู่ยอดเข้าบัญชี, บันทึกผลต่าง/เหตุผล, ส่งกลับแก้ไข |
| `recorder` | ตรวจรอบสุดท้ายและปิดเอกสาร |
| `admin` | ทำได้ทุกอย่าง รวมถึงตั้งค่าสาขา, ช่องทางรับเงิน, mapping, บัญชีรับเงินจริง |

## Workflow เอกสารรับเงิน

สถานะหลักของ `daily_receipts.status`:

| Status | ความหมาย |
| --- | --- |
| `DRAFT` | สร้างเอกสารแล้ว ดึงยอดคาดไว้จาก ClickHouse แล้ว แคชเชียร์ยังไม่ส่งยอด |
| `SUBMITTED` | แคชเชียร์ส่งยอดแล้ว รอผู้ตรวจสอบ |
| `CHECKED_OK` | ผู้ตรวจสอบตรวจแล้ว ไม่พบส่วนต่าง |
| `CHECKED_VARIANCE` | ผู้ตรวจสอบตรวจแล้ว พบส่วนต่างและบันทึกเหตุผล |
| `NEEDS_CORRECTION` | ผู้ตรวจสอบส่งกลับให้แคชเชียร์แก้ไข |
| `CLOSED` | ผู้บันทึกปิดเอกสารแล้ว ไม่ควรแก้ไขย้อนหลัง |

Flow ปัจจุบัน:

1. แคชเชียร์เลือก `branch` และ `receipt_date`
2. ระบบดึงยอด expected จาก ClickHouse เข้า `daily_receipts` และ `daily_receipt_lines`
3. แคชเชียร์กรอกยอดที่นับได้ใน `daily_receipt_lines.cashier_amount`
4. แคชเชียร์กรอก `daily_receipts.morning_change_amount` เป็นเงินทอนตอนเช้า
5. แคชเชียร์เพิ่มรายการอื่นๆ เข้า `receipt_misc_items` ถ้ามี
6. ระบบเตือนให้แคชเชียร์ตรวจโต๊ะค้างใน POS ก่อนส่งยอด และบันทึกการยืนยันใน `daily_receipts`
7. ถ้ายอดที่แคชเชียร์กรอกขาดหรือเกินมากกว่า 100 บาท ระบบจะถามยืนยันก่อนส่งยอด
8. แคชเชียร์แนบรูป/เอกสารเข้า `attachments`
9. ผู้ตรวจสอบเทียบเงินสด/statement และบันทึก `statement_amount`, `variance_amount`, `variance_reason`
10. ผู้บันทึกปิดเอกสารเป็น `CLOSED`

## แหล่งข้อมูล ClickHouse

ระบบอ่านข้อมูลจาก ClickHouse เฉพาะตอนสร้างหรือ refresh expected receipt

### ตาราง `doc`

ใช้เป็นยอดขายหลักของบิล

| Field | ความหมาย |
| --- | --- |
| `totalamount` | ยอดขายรวมของบิล ใช้รวมเป็น `gross_sales_expected` |
| `paycashamount` | ยอดเงินสดตาม POS ใช้รวมเป็น `cash_expected` |
| `docdatetime` | วันเวลาเอกสาร POS |
| `docno` | เลขเอกสาร ใช้ join กับ `docpayment` |
| `shopid` | ร้าน/tenant |
| `guidbranch` หรือ `branchid` | สาขา POS |
| `transflag` | ใช้ `44` สำหรับยอดขาย |
| `iscancel` | ใช้ `0` เพื่อไม่เอาบิลยกเลิก |

เงื่อนไขหลัก:

```sql
d.shopid = CASHFLOW_CLICKHOUSE_SHOP_ID
AND d.transflag = 44
AND d.iscancel = 0
AND coalesce(nullIf(d.guidbranch, ''), nullIf(d.branchid, ''), '') = branches.clickhouse_branch_id
AND toDate(addHours(d.docdatetime, 7)) = receipt_date
```

### ตาราง `docpayment`

ใช้เป็นยอดช่องทางไม่ใช่เงินสด

| Field | ความหมาย |
| --- | --- |
| `description` | ชื่อช่องทางรับเงินจาก POS เช่น `เคพลัสช็อป`, `GRAB`, `CREDITCARD`, `SML - พร้อมเพย์` |
| `amount` | ยอดรับเงินในช่องทางนั้น |
| `docno` | เลขเอกสาร ใช้ join กับ `doc` |
| `guidbranch` หรือ `branchid` | สาขา POS |

ระบบ map `docpayment.description` ผ่านตาราง `payment_channel_mappings`

## สูตรยอดสำคัญ

### ยอด expected จาก POS

| ยอด | สูตร |
| --- | --- |
| `gross_sales_expected` | sum(`doc.totalamount`) |
| `cash_expected` | sum(`doc.paycashamount`) |
| `non_cash_expected` | sum(`docpayment.amount`) |
| `daily_receipt_lines.expected_amount` | ยอด POS ต่อ `payment_channel` |

### ยอดที่แคชเชียร์กรอก

| ยอด | สูตร |
| --- | --- |
| เงินสดที่กรอก | `daily_receipt_lines.cashier_amount` ของ channel `CASH` |
| ไม่ใช่เงินสดที่กรอก | sum(`cashier_amount`) ของ channel ที่ไม่ใช่ `CASH` |
| รายการอื่นๆ นับได้ | sum(`receipt_misc_items.amount`) |
| รวมที่แคชเชียร์กรอก | sum(`daily_receipt_lines.cashier_amount`) + sum(`receipt_misc_items.amount`) |
| เงินทอนตอนเช้า | `daily_receipts.morning_change_amount` |

### ผลต่างแคชเชียร์

ผลต่างแคชเชียร์ใช้เงินทอนตอนเช้ารวมกับ POS expected:

```text
cashier_variance_with_morning_change =
  รวมที่แคชเชียร์กรอก - (gross_sales_expected + morning_change_amount)
```

### ฐานตรวจของผู้ตรวจสอบ

ผู้ตรวจสอบจะอิงยอดที่แคชเชียร์กรอกเป็นหลัก ไม่ใช่ POS เป็นหลัก

| ช่องทาง | ฐานตรวจจริง |
| --- | --- |
| เงินสด | `cashier_amount(CASH) + misc_total + morning_change_amount` |
| QR / PromptPay / ช่องทางไม่ต้องมี settlement | `cashier_amount` |
| GRAB / บัตรเครดิต ที่ยังไม่บันทึก settlement | `cashier_amount - fee_amount` |
| GRAB / บัตรเครดิต ที่บันทึก settlement แล้ว | `receipt_line_reconciliations.expected_net_amount` |

ใน CSV รายละเอียด ฐานตรวจจริงอยู่ในคอลัมน์:

```text
verification_expected_amount
```

## ตาราง MySQL

### `users`

เก็บบัญชีผู้ใช้และ role

| Column | ความหมาย |
| --- | --- |
| `id` | primary key |
| `username` | login username |
| `password_hash` | password hash |
| `full_name` | ชื่อแสดงผล |
| `role` | `cashier`, `auditor`, `recorder`, `admin` |
| `is_active` | เปิด/ปิดผู้ใช้ |

### `branches`

เก็บสาขาของระบบและรหัสสาขา ClickHouse

| Column | ความหมาย |
| --- | --- |
| `id` | primary key |
| `code` | code ภายในระบบ เช่น `KK`, `SK` |
| `name` | ชื่อสาขา |
| `clickhouse_branch_id` | branch id ใน ClickHouse |
| `is_active` | เปิด/ปิดสาขา |

ค่า seed ปัจจุบัน:

| code | name | clickhouse_branch_id |
| --- | --- | --- |
| `KK` | สาขาคันคลอง | `2PdQF0n9TADAVUEV2dDeqOo7D9N` |
| `SK` | สาขาสันกำแพง | `2PxT0SwTMlORbcER7eaIqi08v4k` |

### `payment_channels`

เก็บช่องทางรับเงิน

| Column | ความหมาย |
| --- | --- |
| `id` | primary key |
| `code` | code ช่องทาง เช่น `CASH`, `QR_KPLUS`, `GRAB` |
| `label` | ชื่อแสดงผล |
| `kind` | `cash`, `qr`, `grab`, `credit_card`, `promptpay`, `other` |
| `provider` | ผู้ให้บริการ/ธนาคาร |
| `account_number` | เลขบัญชี ถ้ามี |
| `sort_order` | ลำดับแสดงผล |
| `is_active` | เปิด/ปิดช่องทาง |

ค่า seed ปัจจุบัน:

| sort | code | label | kind | provider |
| --- | --- | --- | --- | --- |
| 10 | `CASH` | เงินสด | `cash` | หน้าร้าน |
| 20 | `CREDIT_CARD_SCB` | บัตรเครดิต SCB | `credit_card` | SCB |
| 30 | `CREDIT_CARD_KTC` | บัตรเครดิต KTC | `credit_card` | KTC |
| 40 | `QR_KPLUS` | QR กสิกร | `qr` | Kasikorn |
| 50 | `PROMPTPAY` | เข้าธนาคารไทยพาณิชย์ | `promptpay` | SCB |
| 60 | `GRAB` | GRAB food | `grab` | Grab |
| 90 | `QR_KRUNGSRI` | QR กรุงศรี | `qr` | Krungsri |
| 999 | `OTHER_UNKNOWN` | อื่นๆ / ยังไม่จัดหมวด | `other` | Unknown |

### `payment_channel_mappings`

map `docpayment.description` จาก ClickHouse ไปยัง `payment_channels`

| Column | ความหมาย |
| --- | --- |
| `payment_channel_id` | FK ไป `payment_channels.id` |
| `clickhouse_description` | description จาก ClickHouse |

ตัวอย่าง mapping:

| clickhouse_description | channel |
| --- | --- |
| `เคพลัสช็อป` | `QR_KPLUS` |
| `K SHOP` | `QR_KPLUS` |
| `MYQR` | `QR_KPLUS` |
| `GRAB` | `GRAB` |
| `CREDITCARD` | `CREDIT_CARD_SCB` |
| `CREDITCARD KTC` | `CREDIT_CARD_KTC` |
| `SML - พร้อมเพย์` | `PROMPTPAY` |

### `daily_receipts`

เอกสารรับเงินรายวันต่อสาขา เป็นตารางหลักของระบบ

| Column | ความหมาย |
| --- | --- |
| `id` | primary key |
| `receipt_date` | วันที่รับเงิน |
| `branch_id` | FK ไป `branches.id` |
| `status` | workflow status |
| `gross_sales_expected` | ยอดขายรวม expected จาก POS |
| `cash_expected` | เงินสด expected จาก POS |
| `morning_change_amount` | เงินทอนตอนเช้าที่แคชเชียร์กรอก |
| `non_cash_expected` | ยอดไม่ใช่เงินสด expected จาก POS |
| `bill_count` | จำนวนบิลจาก POS |
| `clickhouse_synced_at` | เวลาดึงข้อมูลจาก ClickHouse |
| `submitted_by`, `submitted_at` | ผู้ส่งยอดและเวลา |
| `checked_by`, `checked_at` | ผู้ตรวจและเวลา |
| `closed_by`, `closed_at` | ผู้ปิดเอกสารและเวลา |
| `closed_reconciliation_snapshot` | JSON ยอดที่ยืนยัน ณ ตอนปิดเอกสาร รวมเงินเข้าจริง รายการหัก รายการปรับปรุง ยอด POS + เงินทอน และผลต่างสุดท้าย |
| `table_check_acknowledged_at`, `table_check_acknowledged_by` | เวลาและผู้ยืนยันว่าได้ตรวจโต๊ะค้างก่อนส่งยอด |
| `table_check_status` | ผลตรวจโต๊ะค้างก่อนส่งยอด เช่น `clear`, `open_tables`, `unavailable` |
| `table_check_note` | หมายเหตุกรณีต้องส่งยอดทั้งที่ยังมีโต๊ะค้าง |
| `open_table_count`, `open_table_amount` | จำนวนโต๊ะค้างและยอดรวมที่ระบบอ่านได้ ณ ตอนส่งยอด |
| `cashier_variance_acknowledged_at`, `cashier_variance_acknowledged_by` | เวลาและผู้ยืนยันส่งยอดเมื่อยอดขาด/เกินเกิน 100 บาท |
| `cashier_variance_acknowledged_amount` | ยอดส่วนต่างที่แคชเชียร์ยืนยันส่ง แม้เกิน threshold |
| `correction_note` | เหตุผลส่งกลับแก้ไข |

ปฏิทินใช้ `cashier_variance_total` สำหรับวันที่ยังไม่ปิด และใช้ `confirmed_variance_total`
สำหรับวันที่ `CLOSED` โดยยอดรวมเดือนรวมค่าชุดเดียวกับที่แสดงรายวัน (ไม่นับ `DRAFT`)

สูตรยอดยืนยัน: เงินเข้าจริง + รายการหักสุทธิ + รายการอื่นๆ + ยอดเข้า/ออกปรับปรุง - (POS + เงินทอน)
เงินสดใช้ยอดที่ตรวจบันทึกไว้ ไม่บวกเงินทอนซ้ำ; รายการ KTC ที่เข้ารวมหลายวันใช้ยอดและค่าธรรมเนียมที่จัดสรรให้วันนั้น

API รายการและรายละเอียดส่ง `confirmed_reconciled_total`, `confirmed_variance_total` และ
`confirmed_variance_source` (`CLOSING_SNAPSHOT` หรือ `SAVED_RECONCILIATION`)
เอกสารเก่าที่ไม่มี snapshot อ่านจากยอดตรวจที่บันทึกอยู่ โดยไม่เปลี่ยนสถานะหรือประวัติเดิม
การปิดเอกสารใหม่เก็บ snapshot พร้อม audit action `close` เพื่อไม่ให้ยอดในปฏิทินเปลี่ยนตามการนำเข้าข้อมูลภายหลัง

ข้อจำกัดสำคัญ:

```text
UNIQUE(receipt_date, branch_id)
```

หมายถึง 1 สาขามีเอกสารรับเงินได้ 1 ใบต่อวัน

### `daily_receipt_lines`

รายการยอดต่อช่องทางรับเงินของเอกสาร

| Column | ความหมาย |
| --- | --- |
| `receipt_id` | FK ไป `daily_receipts.id` |
| `payment_channel_id` | FK ไป `payment_channels.id` |
| `expected_amount` | ยอด expected จาก POS/ClickHouse |
| `cashier_amount` | ยอดที่แคชเชียร์กรอก |
| `statement_amount` | ยอดที่ผู้ตรวจสอบยืนยันจากเงินสด/statement |
| `variance_amount` | ค่า compatibility เดิม ปัจจุบันเก็บผลต่างเงินเข้า; งานใหม่ควรอ่านสองคอลัมน์ใน `receipt_line_reconciliations` |
| `variance_reason` | เหตุผลกรณีมีส่วนต่าง |
| `source_description` | description จาก ClickHouse ที่รวมมาเป็นช่องทางนี้ |

ข้อจำกัดสำคัญ:

```text
UNIQUE(receipt_id, payment_channel_id)
```

### `receipt_misc_items`

รายการอื่นๆ ที่บวกเข้าในยอดที่นับได้ เช่น สมาชิก, แลกแต้ม, รถตู้

| Column | ความหมาย |
| --- | --- |
| `receipt_id` | FK ไป `daily_receipts.id` |
| `label` | ชื่อรายการ |
| `amount` | จำนวนเงิน |
| `created_by` | ผู้เพิ่มรายการ |

รายการนี้รวมใน `รวมที่แคชเชียร์กรอก` แต่ไม่ใช่ยอด POS expected

### `receiving_accounts`

บัญชีธนาคารหรือบัญชีรับเงินจริง

| Column | ความหมาย |
| --- | --- |
| `branch_id` | สาขาที่บัญชีนี้ใช้รับเงินจริง ถ้า `NULL` คือบัญชีกลางใช้ได้ทุกสาขา |
| `label` | ชื่อบัญชีแสดงผล |
| `bank_name` | ชื่อธนาคาร |
| `account_number` | เลขบัญชี |
| `account_name` | ชื่อบัญชีตามธนาคาร |
| `account_alias` | ชื่อย่อบัญชีที่ใช้ภายใน |
| `account_type` | ประเภทบัญชีตามธนาคาร |
| `is_active` | เปิด/ปิดบัญชี |

บัญชีรับเงินหน้าร้านที่ตั้งค่าเริ่มต้น:

| สาขา | ธนาคาร | เลขบัญชี | ใช้กับช่องทาง |
| --- | --- | --- | --- |
| สาขาคันคลอง | Kasikornbank | `0308663108` (`030-8-66310-8`) | `QR_KPLUS`, `GRAB` |
| สาขาสันกำแพง | Kasikornbank | `1763147866` (`176-3-14786-6`) | `QR_KPLUS`, `CREDIT_CARD_KBANK` |
| สาขาคันคลอง | Siam Commercial Bank | `4070578401` (`407-057840-1`) | `CREDIT_CARD_SCB`, `PROMPTPAY` |
| สาขาคันคลอง | Krungthai Bank | `4970282439` (`497-0-28243-9`) | `CREDIT_CARD_KTC` |

Statement กสิกรสาขาสันกำแพงนำเข้าช่อง `CREDIT_CARD_KBANK` แยกจาก `QR_KPLUS` ผ่าน
`POST /api/inbox-imports/kbank-monthly-card` โดยรับเฉพาะคำอธิบายรายการ
`รับเงินจากการขาย เต็มจำนวน/ผ่อนชำระ/คะแนนสะสม` เป็นยอดสุทธิจริงและบันทึกวันที่ไม่มีรายการเป็น
closed zero

ข้อมูลบัญชีกสิกรสาขาคันคลอง: ชื่อบัญชี `บจก. โซลาว`, ชื่อย่อบัญชี `คันคลอง`,
ประเภทบัญชี `บัญชีออมทรัพย์`

ข้อมูลบัญชีกสิกรสาขาสันกำแพง: ชื่อบัญชี `บจก. โซลาว`, ชื่อย่อบัญชี `สันกำแพง`,
ประเภทบัญชี `บัญชีออมทรัพย์`

ข้อยกเว้นของ GRAB: เงินจากทั้งสาขาคันคลองและสาขาสันกำแพงเข้าบัญชี `030-8-66310-8` บัญชีเดียว ระบบเก็บสิทธิ์ข้ามสาขาเฉพาะคู่ `สาขาสันกำแพง + GRAB` ใน `receiving_account_channel_branches` จึงไม่ทำให้ QR หรือบัตรของสันกำแพงเลือกบัญชีคันคลองได้

statement กสิกรรายเดือนนำเข้า Grab ผ่าน provider `KASIKORN_MONTHLY_GRAB_STATEMENT` แยกจาก QR
รายการ X3812 ใช้วันขายก่อนวันเงินเข้า 1 วัน และเก็บเหตุผลการจับคู่ทุกแถวไว้ใน audit payload

ลำดับแหล่งข้อมูล Grab: statement ของบัญชี `030-8-66310-8` เป็นหลักฐานสูงสุดสำหรับ
`เงินเข้าบัญชี`; รายงาน Grab เป็นหลักสำหรับยอดขาย ค่าธรรมเนียม และโปรโมชั่น และใช้ยอดสุทธิ
จากรายงานแทนชั่วคราวจนกว่า statement จะเข้าระบบ; ยอดแคชเชียร์ใช้เฉพาะเมื่อยังไม่มีรายงาน Grab

### `receiving_account_channel_branches`

สิทธิ์เพิ่มเติมแบบระบุพร้อมกัน 3 ค่า: บัญชีรับเงิน + ช่องทาง + สาขา ใช้สำหรับกรณีบัญชีเดียวรับ GRAB ของสองสาขา

### `branch_grab_stores`

จับคู่สาขาในระบบกับร้านในรายงาน Grab:

| สาขา | Grab store id | ชื่อร้านในรายงาน |
|---|---|---|
| สาขาคันคลอง | `c30f837b-0067-41ce-9d19-767cca330e94` | ส้มตำ Hello solao - ถนนรอบเมืองเชียงใหม่ |
| สาขาสันกำแพง | `ff32e3d6-5cea-4517-b543-4d7db1e528c6` | โซลาวบ้านเจ๊ - ต้นเปา |

เมื่อผู้ตรวจแนบ `Transaction_Store_*.csv` ในช่องทาง GRAB ระบบจะเลือกเฉพาะร้านของสาขาและวันที่ขายของเอกสาร แล้วคำนวณ:

- ยอดขายขั้นต้น = ผลรวมคอลัมน์ `ยอด`
- ยอดสุทธิที่ต้องโอน = ผลรวมคอลัมน์ `ทั้งหมด`
- ค่าธรรมเนียม = ยอดขายขั้นต้น - ยอดสุทธิที่ต้องโอน
- วันที่ settlement = คอลัมน์ `วันที่โอน`

รายการธนาคารสำหรับ GRAB ต้องเป็นรายการ `รับโอนเงิน` จาก `X3812 บจก. แกร็บแท็กซี่ ++` และยอดต้องตรงกับยอดสุทธิจากรายงาน Grab ระบบจะไม่เสนอรายการเงินเข้าอื่นที่ยอดเท่ากันเป็นตัวเลือก GRAB

### SCB credit card and incoming transfers

บัญชี SCB `407-057840-1` รับเฉพาะสาขาคันคลองในเฟสนี้

- `CREDIT CARD DIVISION(EDC)` = บัตรเครดิต SCB เท่านั้น
- ยอดเงินเข้าอื่นในไฟล์ SCB เดียวกัน = `PROMPTPAY` / `เข้าธนาคารไทยพาณิชย์` แยกจากยอดบัตร
- ไฟล์ SCB Historical Statement CSV มีเฉพาะยอดเงินเข้า ไม่มีค่าธรรมเนียมแยก ระบบจึงคำนวณค่าธรรมเนียมต่อรายการเป็น `ยอดบัตรเครดิต SCB ที่แคชเชียร์กรอก - ยอด EDC ที่ธนาคารโอนเข้า` หลังจับคู่ยอด EDC สำเร็จ

### `receiving_account_channels`

ตารางเชื่อมบัญชีรับเงินจริงกับช่องทางรับเงิน

| Column | ความหมาย |
| --- | --- |
| `receiving_account_id` | FK ไป `receiving_accounts.id` |
| `payment_channel_id` | FK ไป `payment_channels.id` |

ใช้บอกว่าบัญชีใดใช้ตรวจช่องทางใดได้

### `receipt_line_reconciliations`

ข้อมูลตรวจ settlement และ statement ต่อ 1 receipt line

| Column | ความหมาย |
| --- | --- |
| `receipt_line_id` | FK ไป `daily_receipt_lines.id`, unique |
| `receiving_account_id` | บัญชีที่ใช้ตรวจ |
| `expected_gross_amount` | ยอดขั้นต้นของ settlement |
| `fee_amount` | ค่าธรรมเนียม |
| `expected_net_amount` | ยอดสุทธิที่ควรเข้า |
| `matched_amount` | ยอด statement ที่จับคู่แล้ว |
| `settlement_date` | วันที่ยอดเข้า |
| `settlement_status` | สถานะการจับคู่ |
| `settlement_source` | แหล่งยอดอ้างอิง: `NONE`, `MANUAL`, `BANK_SETTLEMENT`, `BANK_STATEMENT`, `GRAB_REPORT`, `LEGACY_EVIDENCE` |
| `cashier_reference_variance_amount` | แคชเชียร์กรอก - ยอดก่อนหักจากหลักฐาน |
| `settlement_variance_amount` | เงินเข้าจริง - ยอดสุทธิที่ควรเข้าจากหลักฐาน |
| `exception_category` | หมวดเหตุผิดปกติ |
| `exception_note` | หมายเหตุ |
| `evidence_attachment_id` | ไฟล์หลักฐาน settlement |
| `manual_checked_without_reference` | ติ๊กว่าตรวจแล้วแต่ยังไม่มีเอกสารอ้างอิง |
| `manual_checked_at` | เวลาที่ติ๊กตรวจแบบไม่มีเอกสาร |
| `manual_checked_by` | ผู้ติ๊กตรวจแบบไม่มีเอกสาร |

หลักฐาน `QR_KRUNGSRI` ใช้ HTML รวมหนึ่งไฟล์ต่อ receipt line: รวม ALIPAY, PROMPTPAY
และไฟล์รายละเอียดอื่นที่ผูกกับวัน/สาขานั้น แสดงยอดก่อนหัก ค่าธรรมเนียม ยอดสุทธิตามรายงาน
ยอดรวมแต่ละไฟล์ และรายการย่อย โดยไม่เอาไฟล์ SUMMARY มาบวกซ้ำ
เก็บไฟล์ต้นทางเดิมไว้ และอ่านค่าจาก `bank_inbox_transactions` ที่เชื่อมกับรายการ statement ที่ใช้จับคู่
ไม่ใช้ยอดแคชเชียร์มาสร้างหลักฐาน ค่าธรรมเนียมหรือยอดสุทธิที่รายงานไม่ระบุจะแสดงเป็น `-`

การนำเข้าจะอัปเดตหลักฐานรวมอัตโนมัติ ส่วนข้อมูลเดิมซ่อมด้วย `repairKrungsriCombinedEvidence`
โดยแก้เฉพาะ BLOB และ `evidence_attachment_id` ไม่เปลี่ยนยอดเงินหรือสถานะ (รวมถึง `CLOSED`)
และเพิ่ม audit action `combine_krungsri_evidence` เมื่อเนื้อหาหรือลิงก์เปลี่ยนเท่านั้น

สูตรตรวจหลักฐานต้องแยกสองจุดและห้ามนำมาหักล้างกัน:

```text
cashier_reference_variance_amount = cashier_amount - expected_gross_amount
settlement_variance_amount = statement_amount - expected_net_amount
```

ถ้าไม่มีหลักฐานยอดก่อนหัก ระบบใช้ยอดแคชเชียร์เป็นฐานแทน และห้ามใช้ payment split จาก ClickHouse เป็นหลักฐานธนาคาร เอกสารที่มีผลต่างจุดใดจุดหนึ่งต้องมี `variance_reason` ก่อนยืนยันตรวจหรือปิดเอกสาร

`repairLegacyKplusReferences` ซ่อมฐาน QR กสิกรเก่าที่เป็น `LEGACY_EVIDENCE` และยังเท่ากับ
payment split จาก POS เฉพาะเอกสาร `DRAFT`, `SUBMITTED`, `NEEDS_CORRECTION` ที่จับคู่อัตโนมัติ
ต้องมีอีเมล K SHOP หลักเพียงรายการเดียวที่ตรงวัน สาขา ช่องทาง และเนื้อหาไฟล์หลักฐาน
จึงใช้ยอดจากอีเมลเป็นก่อนหัก/สุทธิ (ค่าธรรมเนียมศูนย์) และเปลี่ยนแหล่งเป็น `BANK_SETTLEMENT`
ไม่แก้ยอด POS แคชเชียร์ เงินเข้าจริง หรือเอกสารตรวจ/ปิดแล้ว และบันทึกก่อน/หลังด้วย
audit action `repair_kplus_pos_reference` การรันซ้ำไม่แก้หรือเพิ่ม audit ซ้ำ

คำนวณผลต่างใหม่ทั้งสองสาขาได้ด้วย `node scripts/recalculate-receipts.mjs --dry-run`
และใช้ `--apply` เมื่อจะบันทึก คำสั่งใช้ `calculateStoredLineEvidence` สูตรเดียวกับ API
แก้เฉพาะผลต่างสองจุดและ `daily_receipt_lines.variance_amount` พร้อมคำนวณยอดรวมใหม่
สำหรับเอกสารที่ตรวจแล้วอาจเปลี่ยนเฉพาะ `CHECKED_OK` / `CHECKED_VARIANCE` ตามผลคำนวณ
เอกสาร `CLOSED` อ่านเพื่อตรวจเท่านั้น ไม่เขียนทับยอดยืนยันหรือประวัติเดิม
การจัดสรรเงินเข้า KTC หลายวันยังใช้ค่าจัดสรรเดิม ไม่มีการจับคู่ statement ใหม่หรือแก้ค่าธรรมเนียม
บันทึกการเปลี่ยนด้วย audit action `recalculate_evidence_variances` เฉพาะใบที่ค่าเปลี่ยน
ผลลัพธ์ระบุ `pending_channels` เพื่อไม่ตีความยอดยังไม่ตรวจเป็นเงินขาดยืนยันแล้ว

ค่า `settlement_status`:

| Status | ความหมาย |
| --- | --- |
| `PENDING_EVIDENCE` | รอแนบหลักฐาน |
| `READY_FOR_STATEMENT` | พร้อมตรวจ statement |
| `MATCHED_AUTO` | จับคู่ตรงอัตโนมัติ |
| `MATCHED_MANUAL` | ผู้ตรวจเลือกจับคู่เอง |
| `EXCEPTION` | มีข้อยกเว้น/ส่วนต่าง |

### `statement_imports`

ไฟล์ statement ที่อัปโหลดเพื่อใช้ตรวจ

| Column | ความหมาย |
| --- | --- |
| `receipt_id` | เอกสารที่เกี่ยวข้อง |
| `payment_channel_id` | ช่องทางที่ตรวจ |
| `receiving_account_id` | บัญชีรับเงินจริง |
| `original_name` | ชื่อไฟล์เดิม |
| `stored_path` | path บน server |
| `mime_type` | MIME type |
| `status` | `IMPORTED` หรือ `FAILED` |
| `row_count` | จำนวน row ที่อ่านได้ |
| `duplicate_count` | จำนวนรายการซ้ำ |
| `total_amount` | ยอดรวมรายการที่เลือก |
| `error_message` | error ถ้า import ไม่สำเร็จ |
| `imported_by` | ผู้ import |

### `statement_transactions`

รายการย่อยที่ parse ได้จาก statement

| Column | ความหมาย |
| --- | --- |
| `import_id` | FK ไป `statement_imports.id` |
| `receipt_id` | FK ไป `daily_receipts.id` |
| `receipt_line_id` | line ที่จับคู่ ถ้ามี |
| `receiving_account_id` | บัญชีรับเงินจริง |
| `payment_channel_id` | ช่องทางที่จับคู่ |
| `transaction_date` | วันที่ transaction |
| `description` | รายละเอียด statement |
| `reference_no` | เลขอ้างอิง |
| `amount` | จำนวนเงิน |
| `unique_hash` | hash กันรายการซ้ำ |
| `raw_payload` | row ดิบที่ parse มา |
| `match_status` | `matched_auto`, `matched_manual`, `classified`, `customer_deposit`, `unmatched`, `unrelated` |

หมายเหตุ: `customer_deposit` คือเงินโอนมัดจำลูกค้าที่เข้า statement แต่ไม่ได้เป็นยอดขายใน POS/ClickHouse และไม่ถูกนำไปรวมเป็น `statement_amount` ของช่องทางรับเงิน

### `bank_inbox_imports` และ `bank_inbox_transactions`

กล่องรับไฟล์ธนาคารจาก Gmail อัตโนมัติ ปัจจุบันใช้กับรายงาน ZIP ของ `Krungsri Biz Mung-Mee` โดยแยกออกจาก `statement_imports` เพราะไฟล์ยังไม่ได้เลือกเอกสารรับเงินหรือช่องทางที่จะจับคู่

| Table | หน้าที่ |
| --- | --- |
| `bank_inbox_imports` | เก็บอีเมลต้นทาง, ZIP ต้นฉบับ, checksum, สถานะ, จำนวนไฟล์/รายการ และยอดรวม |
| `bank_inbox_transactions` | เก็บแต่ละรายการที่ parse ได้จาก CSV/XLSX/XLS/PDF ใน ZIP |

สถานะเริ่มต้นคือ `PENDING_REVIEW` เท่านั้น: การนำเข้า Gmail จะไม่แก้ยอดแคชเชียร์, ไม่จับคู่กับ POS และไม่รวมเงินมัดจำลูกค้าเข้ายอดขายอัตโนมัติ

การกันข้อมูลซ้ำใช้ทั้ง `provider + source_message_id` จาก Gmail และ `provider + archive_checksum` ของ ZIP

### `attachments`

ไฟล์แนบ เช่น รูปสรุปแคชเชียร์, statement, settlement evidence

| Column | ความหมาย |
| --- | --- |
| `receipt_id` | เอกสารที่แนบ |
| `statement_import_id` | statement import ที่เกี่ยวข้อง ถ้ามี |
| `attachment_type` | `cashier_summary`, `cash_slip`, `statement`, `other` |
| `original_name` | ชื่อไฟล์เดิม |
| `stored_path` | path บน server |
| `document_path` | path PDF ที่แปลงเป็นเอกสาร |
| `mime_type` | MIME type ไฟล์ต้นฉบับ |
| `document_mime_type` | MIME type ของเอกสาร |
| `size_bytes` | ขนาดไฟล์ต้นฉบับ |
| `document_size_bytes` | ขนาด PDF |
| `file_data` | binary สำรองของไฟล์ต้นฉบับใน MySQL |
| `document_data` | binary สำรองของ PDF ใน MySQL |
| `document_status` | `original_pdf`, `document_pdf`, `original_only`, `failed` |
| `document_error` | error ถ้าแปลงเอกสารไม่สำเร็จ |
| `uploaded_by` | ผู้แนบไฟล์ |

หมายเหตุ: ไฟล์แนบรุ่นใหม่เก็บ binary ใน MySQL ด้วย เพื่อไม่ให้ไฟล์หายเมื่อ Railway redeploy

### `audit_logs`

บันทึก action สำคัญ

| Column | ความหมาย |
| --- | --- |
| `entity_type` | ประเภท entity เช่น `daily_receipt` |
| `entity_id` | id ของ entity |
| `action` | action ที่เกิดขึ้น |
| `actor_user_id` | ผู้ทำรายการ |
| `actor_role` | role ตอนทำรายการ |
| `before_payload` | JSON ก่อนแก้ไข |
| `after_payload` | JSON หลังแก้ไข |
| `note` | หมายเหตุ |
| `created_at` | วันเวลาที่เกิด action |

## ความสัมพันธ์หลัก

```text
branches 1 -- many daily_receipts
daily_receipts 1 -- many daily_receipt_lines
payment_channels 1 -- many daily_receipt_lines
payment_channels 1 -- many payment_channel_mappings
daily_receipts 1 -- many receipt_misc_items
daily_receipt_lines 1 -- 1 receipt_line_reconciliations
receiving_accounts many -- many payment_channels ผ่าน receiving_account_channels
daily_receipts 1 -- many statement_imports
statement_imports 1 -- many statement_transactions
bank_inbox_imports 1 -- many bank_inbox_transactions
daily_receipts 1 -- many attachments
daily_receipts 1 -- many audit_logs ผ่าน entity_type/entity_id
```

## Google Sheets / AI Export

ระบบมี read-only CSV endpoint สำหรับ Google Sheets หรือ AI ตัวอื่น

### ยอดขายรายวันรายเดือนสำหรับชีตรับ–จ่าย

```text
GET /api/google-sheets/monthly-daily.csv?month=YYYY-MM
Authorization: Bearer <CASHFLOW_SHEETS_EXPORT_TOKEN>
```

ส่ง 1 แถวต่อวันต่อสาขา (`KK`, `SK`) พร้อม `business_date`, `day`, `branch_code`,
`gross_sales_expected`, `cash_plus_change`, `morning_change`, `qr_kplus_amount`,
`qr_krungsri_amount`, `grab_sales_amount`, `grab_fee_20_amount`, `grab_ads_promotion_amount`, `grab_bank_amount`,
`grab_source`, `cashier_misc_total`, `cashier_misc_note`, คอลัมน์ยอดและหมายเหตุของรายการแคชเชียร์
ทั้ง 6 หมวด, `status`, `status_label`, `updated_at`
โดยยอดขายอ่านจาก ClickHouse แบบ
read-only ตามนิยามเดียวกับ expected receipt ส่วนสถานะอ่านจาก `daily_receipts` หาก ClickHouse ไม่มี
เอกสารขายในวันนั้น ระบบส่งยอด `0.00` จริง ไม่ส่งช่องว่าง

`qr_kplus_amount` ใช้ยอดจริงจากรายงานปิดยอด K SHOP ก่อนเสมอ หากรายงานยังไม่เข้าจึงใช้ยอดที่
แคชเชียร์ส่งแล้ว เมื่อรายงานปิดยอดเข้าภายหลัง รอบ sync ถัดไปจะแทนที่ยอดแคชเชียร์โดยอัตโนมัติ

`qr_krungsri_amount` ใช้ยอดรวมจากรายงาน Krungsri Biz Mung-Mee ที่จับคู่กับวันและสาขาแล้วก่อนเสมอ
หากรายงานยังไม่เข้าจึงใช้ยอดที่แคชเชียร์ส่งแล้ว

ข้อมูล Grab ใช้รายงาน settlement ที่สมบูรณ์ก่อนเสมอ โดยมีนิยามดังนี้:

- `grab_sales_amount` = ยอดหลังหักโปรโมชั่นที่ร้านรับผิดชอบ
- `grab_fee_20_amount` = commission/tax + additional commission
- `grab_ads_promotion_amount` = marketing fee + merchant delivery discount
- `grab_bank_amount` = net amount จากรายงานโดยตรง เพื่อรวมผลของ income adjustment
- `grab_source` = `GRAB_REPORT` เมื่อใช้รายงานจริง หรือ `CASHIER` เมื่อใช้ยอดที่แคชเชียร์ส่ง

ถ้ารายงานมียอดขายเป็นบวกแต่ net เป็นศูนย์ ระบบถือว่ารายงานยังไม่สมบูรณ์และส่งเฉพาะยอดขายจาก
แคชเชียร์ ส่วนค่าธรรมเนียม โปรโมชั่น และเงินเข้าบัญชีจะเป็นช่องว่าง เพื่อไม่ล้างข้อมูลเดิมในชีต

รายการที่แคชเชียร์เพิ่มถูกแจกแจงลง 6 คอลัมน์: `ค่าอาหารรถตู้/พนักงาน`, `บ้านพี่จุ๋ม`,
`บ้านพี่เพ็ญ`, `บ้านคุณย่า`, `เครดิตพี่จุ๋ม/พี่เพ็ญ`, และ `สมาชิก` โดย `สมาชิก` รับเฉพาะ
ป้ายชื่อที่มีคำว่า สมาชิก, แลกแต้ม หรือ รีวิว รายการอื่นที่ไม่ตรงห้าหมวดเฉพาะจะเข้าคอลัมน์
`ค่าอาหารรถตู้/พนักงาน` ซึ่งถือเป็นรายการจ่ายเงินสด และเก็บป้ายชื่อเดิมกับจำนวนเงินไว้ในหมายเหตุเซลล์
`cashier_misc_total` และ `cashier_misc_note` ยังคงส่งยอดรวมทั้งหมดไว้สำหรับตรวจสอบย้อนกลับ

หมายเหตุ: endpoint นี้ส่ง POS expected สำหรับยอดขาย และส่งยอดช่องทางรับเงินตามกฎ
“ยอดปิดจริงก่อน หากยังไม่มีจึงใช้ยอดที่แคชเชียร์ส่ง” โดยไม่ส่ง variance, สลิป หรือเอกสารอ้างอิงออกไปใน CSV
ชุดนี้

### สรุปรายวันต่อสาขา - cashier only

```text
GET /api/google-sheets/reconciliation.csv?token=...&from=YYYY-MM-DD&to=YYYY-MM-DD
```

คอลัมน์สำคัญ:

| Column | ความหมาย |
| --- | --- |
| `morning_change_amount` | เงินทอนตอนเช้า |
| `cashier_cash_amount` | เงินสดที่แคชเชียร์กรอก |
| `cashier_non_cash_amount` | ยอดไม่ใช่เงินสดที่แคชเชียร์กรอก |
| `cashier_channel_total` | รวมยอดทุกช่องทางที่แคชเชียร์กรอก |
| `misc_total` | รายการอื่นๆ ที่แคชเชียร์เพิ่ม |
| `cashier_counted_total` | `cashier_channel_total + misc_total` |
| `is_checked` | เอกสารผ่านขั้นตรวจแล้วหรือยัง (`TRUE` เมื่อ status เป็น `CHECKED_OK`, `CHECKED_VARIANCE`, หรือ `CLOSED`) |
| `checked_at` | เวลาที่เอกสารถูกตรวจ |
| `submitted_at` | เวลาที่แคชเชียร์ส่งยอด |

### รายละเอียดแยกช่องทาง - cashier only

```text
GET /api/google-sheets/receipt-lines.csv?token=...&from=YYYY-MM-DD&to=YYYY-MM-DD
```

คอลัมน์สำคัญ:

| Column | ความหมาย |
| --- | --- |
| `channel_code` | code ช่องทาง เช่น `CASH`, `QR_KPLUS`, `GRAB`, `MISC_ITEM` |
| `channel_label` | ชื่อช่องทาง หรือชื่อรายการอื่นๆ |
| `channel_kind` | ประเภทช่องทาง เช่น `cash`, `qr`, `credit_card`, `misc` |
| `provider` | ผู้ให้บริการ หรือ `cashier` สำหรับรายการอื่นๆ |
| `cashier_amount` | ยอดที่แคชเชียร์กรอก |
| `misc_item_id` | id รายการอื่นๆ ถ้าเป็นแถว `MISC_ITEM` |
| `misc_item_label` | ชื่อรายการอื่นๆ ถ้าเป็นแถว `MISC_ITEM` |
| `line_is_checked` | ช่องทางนี้ผ่านการตรวจแล้วหรือยัง |
| `receipt_is_checked` | เอกสารนี้ผ่านขั้นตรวจแล้วหรือยัง |
| `manual_checked_without_reference` | ช่องทางนี้ถูกติ๊กว่าตรวจแล้วแต่ไม่มีเอกสารอ้างอิงหรือไม่ |
| `manual_checked_at` | เวลาที่ติ๊กตรวจแบบไม่มีเอกสาร |
| `checked_at` | เวลาที่เอกสารถูกตรวจ |
| `submitted_at` | เวลาที่แคชเชียร์ส่งยอด |

สามารถกรองสาขาได้ด้วย:

```text
&branch_id=1
&branch_id=2
```

## API หลัก

| Method | Path | ใช้ทำอะไร |
| --- | --- | --- |
| `POST` | `/api/auth/login` | login สำหรับ auditor/recorder/admin |
| `POST` | `/api/auth/cashier` | เข้า cashier โดยไม่ใช้รหัสใน phase นี้ |
| `GET` | `/api/branches` | รายการสาขา |
| `GET` | `/api/payment-channels` | รายการช่องทางรับเงิน |
| `POST` | `/api/daily-receipts/from-clickhouse` | สร้าง/refresh receipt จาก ClickHouse |
| `POST` | `/api/daily-receipts/backfill-clickhouse` | backfill หลายวัน/หลายสาขา (admin, รองรับ dry run) |
| `GET` | `/api/daily-receipts` | รายการ receipt |
| `GET` | `/api/daily-receipts/:id` | รายละเอียด receipt |
| `GET` | `/api/daily-receipts/:id/open-tables` | ตรวจโต๊ะค้างจาก POS ก่อนแคชเชียร์ส่งยอด |
| `PUT` | `/api/daily-receipts/:id/submit` | แคชเชียร์ส่งยอด |
| `PUT` | `/api/daily-receipts/:id/cashier-amounts` | ผู้ตรวจแก้ยอดที่แคชเชียร์กรอก พร้อมบันทึก audit trail |
| `POST` | `/api/daily-receipts/:id/misc-items` | เพิ่มรายการอื่นๆ |
| `POST` | `/api/daily-receipts/:id/attachments` | แนบไฟล์ |
| `POST` | `/api/reconciliations/statement-preview` | preview statement ก่อนยืนยัน รองรับ CSV/XLSX/PDF KBank |
| `POST` | `/api/reconciliations/statement-confirm` | ยืนยันรายการ statement |
| `PUT` | `/api/reconciliations/:lineId/manual-check` | ติ๊ก/ยกเลิกว่าช่องทางนี้ตรวจแล้วแต่ยังไม่มีเอกสารอ้างอิง |
| `PUT` | `/api/daily-receipts/:id/check` | ผู้ตรวจสอบยืนยันยอด |
| `PUT` | `/api/daily-receipts/:id/request-correction` | ส่งกลับแก้ไข |
| `PUT` | `/api/daily-receipts/:id/close` | ปิดเอกสาร |
| `GET` | `/api/reports/reconciliation` | รายงาน reconciliation แบบ JSON หลัง login |

## ข้อควรระวัง

- อย่าส่ง credential MySQL หรือ ClickHouse ให้ AI ตัวอื่นโดยตรง ให้ใช้ CSV export read-only แทน
- `expected_amount` หมายถึงยอด POS ไม่ใช่ยอดที่แคชเชียร์กรอก
- การตรวจหลังบ้านต้องดู `verification_expected_amount` เป็นฐานตรวจจริง
- เงินทอนตอนเช้ารวมกับ POS expected เพื่อคำนวณผลต่างแคชเชียร์ แต่ยังแสดงแยกเพื่อให้ตรวจสอบง่าย
- รายการอื่นๆ รวมในยอดที่แคชเชียร์กรอก แต่ไม่ได้มาจาก POS
- เอกสาร `CLOSED` ไม่ควรแก้ไขย้อนหลัง ควรใช้ adjustment note ใน phase ถัดไป
# ใบปรับปรุงยอดหลังปิดเอกสาร (2026-08-26)

- เอกสารยังเป็น `CLOSED` เสมอ ไม่เปิดกลับ ไม่เขียนทับยอด POS, แคชเชียร์, เงินเข้าจริง, ค่าหัก, ยอดปรับปรุงก่อนปิด, ผู้ปิด, เวลาปิด หรือ `closed_reconciliation_snapshot`
- ผู้ตรวจสอบ ผู้บันทึก และแอดมินมีสิทธิ์ `receipt:adjust-closed`; แคชเชียร์ไม่มีสิทธิ์
- ปุ่ม `ปรับยอด` อยู่รายช่องทาง เปิดแบบฟอร์มใต้แถวนั้น เลือกเพิ่มหรือลด ระบุจำนวนเงินและเหตุผล แล้วกด `บันทึกปรับยอด` จุดเดียว ไม่มีหน้าต่างแยก
- หน้าปิดเอกสารแสดงยอดเป็นตัวเลขอ่านอย่างเดียวและผลต่างยืนยันล่าสุดเป็นหลัก ประวัติและวิธีคำนวณพับเก็บ แต่เปิดอ่านได้; แบบฟอร์มแยกตัวอย่างยอดปรับปรุงสะสมรายช่องทางกับผลต่างทั้งวันอย่างชัดเจน
- `POST /api/daily-receipts/:id/post-close-adjustments`: `{ receipt_line_id, amount, reason, expected_revision, request_id }`
- `amount` เป็นส่วนเพิ่ม/ลดของครั้งนี้ ไม่ใช่ยอดรวมใหม่ ไม่เปลี่ยนยอดเงินจริงจากธนาคาร จึงไม่ใช่หลักฐานว่าเงินเข้าธนาคารเพิ่มขึ้น
- ตาราง `receipt_post_close_adjustments` เป็นประวัติแบบเพิ่มรายการเท่านั้น เก็บยอดก่อน/หลัง ผลต่างก่อน/หลัง ช่องทาง ชื่อผู้ยืนยัน เหตุผล เวลา และลำดับรุ่น
- ล็อกเอกสารใน transaction, ตรวจ revision กันการแก้พร้อมกัน และใช้ UUID request_id ป้องกันการส่งซ้ำ ระบบไม่เปิด API แก้/ลบใบปรับปรุงที่ยืนยันแล้ว การกลับรายการต้องสร้างใบใหม่ด้วยจำนวนตรงข้ามและอ้างเหตุผล/เลขใบเดิม
- ทุกใบสร้าง audit action `post_close_adjustment` ใน transaction เดียวกัน หากผิดพลาด rollback ทั้งใบและ audit
- ยอดยืนยันล่าสุด = ยอดกระทบตอนปิด + ผลรวมใบปรับปรุงหลังปิด; ผลต่างล่าสุด = ผลต่างตอนปิด + ผลรวมใบปรับปรุงหลังปิด ไม่บวกเงินทอนหรือค่าธรรมเนียมซ้ำ
- API รายละเอียดคืน `post_close_adjustments`, `post_close_adjustment_total`, `post_close_adjustment_count`, `original_confirmed_reconciled_total`, `original_confirmed_variance_total` เมื่อมีใบปรับปรุง และ `post_close_adjustment_amount` รายช่องทาง
- `confirmed_reconciled_total` / `confirmed_variance_total` ใช้ยอดยืนยันล่าสุด (source `POST_CLOSE_ADJUSTMENT` เมื่อปรับแล้ว) ในหน้ารายละเอียดและปฏิทิน; ปฏิทินแสดง `ปิด/ปรับแล้ว`
- ยอดปรับปรุงในตาราง/งานพิมพ์รวมทั้งก่อนและหลังปิด แต่ยอดเดิมแต่ละแหล่งยังแยกอยู่ในฐานข้อมูล งานพิมพ์แนบใบปรับปรุงแยกหน้าพร้อมเหตุผลและผู้ยืนยัน
- CSV ที่นิยามเป็นยอดแคชเชียร์/ยอดเงินเข้าธนาคารยังคงยอดต้นทาง ไม่แฝงใบปรับปรุงเข้าไปเป็นเงินจริง
- ทดสอบในเครื่อง: `node scripts/verify-post-close-adjustments.mjs` จาก `server` (ต้องเปิด preview API 8100 และ MySQL preview 3317) ตรวจ retry, concurrency, permission, เหตุผล, ยอดปฏิทิน และยืนยันว่าข้อมูลต้นฉบับไม่เปลี่ยน
