# Monthly Sales Close API

ชุดนี้ใช้ส่งยอดขายที่ปิดแล้วจาก General Cashflow ให้ระบบบัญชีหรือระบบสรุปอื่น โดยยอดขายอ้างอิง `business_date` และเงินเข้าจริงอ้างอิง `settlement_date` เสมอ

## ขั้นตอนปิดเดือน

1. ปิดเอกสารรับเงินรายวันให้ครบทุกวันของแต่ละสาขา
2. เปิด Preview จาก `GET /api/monthly-sales-closes/preview?month=YYYY-MM&branch=ALL`
3. ระบบบล็อกเฉพาะเดือนที่ยังไม่จบ เอกสารรายวันขาด/ยังไม่ปิด ยอดขายต้นทางขาด ซ้ำ หรือข้อมูลยอดขายเสีย
4. เงิน Grab บัตร หรือ QR ที่ยังรอ statement ไม่บล็อกการปิดยอดขาย ระบบเก็บไว้ใน `pending_receipts`, `pending_line_count` และ `warnings`
5. ผู้มีสิทธิ์ปิดยอดยืนยันทีละสาขาด้วย `POST /api/monthly-sales-closes` พร้อม `preview_revision`
6. เมื่อทุกสาขาปิดครบ `company.status` จะเป็น `CLOSED_READY`

การแก้ข้อมูลหลังปิดเดือนไม่เขียนทับชุดเดิม Preview จะแสดงว่าข้อมูลเปลี่ยน และการยืนยันครั้งต่อไปสร้าง `revision_number` ใหม่โดยเชื่อม `revision_of` กับรุ่นก่อนหน้า

## API สำหรับระบบอื่น

ใช้ `Authorization: Bearer <CASHFLOW_ACCOUNTING_EXPORT_TOKEN>` หรือ `x-accounting-sync-token` เหมือน accounting export เดิม ห้ามส่ง token ใน query string

### อ่าน manifest ล่าสุด

```http
GET /accounting-export/monthly-sales-closes?month=2026-08&branch=ALL
```

ระบุรหัสสาขาแทน `ALL` เพื่ออ่านสาขาเดียว และใส่ `revision=2` เมื่อต้องการรุ่นที่กำหนด Response มีสถานะรวมบริษัท ยอดรวมของแต่ละสาขา checksum และจำนวนแถวของทุก section

### อ่านรายละเอียดจาก snapshot ที่ปิดแล้ว

```http
GET /accounting-export/monthly-sales-close-data?month=2026-08&branch=SK&revision=1&section=daily_sales&limit=100&offset=0
```

ค่า `section` ที่รองรับ:

| section | ความหมาย |
|---|---|
| `daily_sales` | ยอดขาย POS รายวัน ใช้รับรู้ยอดขาย |
| `daily_receipts` | snapshot การปิดรับเงินรายวัน |
| `receipt_lines` | ยอดควรรับแยกช่องทาง |
| `settlements` | เงินเข้าจริงและหลักฐาน |
| `adjustments` | รายการปรับหลังปิดรายวัน |
| `payment_channels` | master ช่องทางรับเงิน |
| `receiving_accounts` | master บัญชีแบบปกปิดเหลือเลขท้ายสี่หลัก |

จำนวนเงินส่งเป็น decimal string สองตำแหน่ง ข้อมูลไม่ทราบเป็น `null` และทุก section มี pagination ระบบปลายทางต้องเก็บ `close_id + revision` เป็น idempotency key ตรวจ checksum ก่อนรับข้อมูล และไม่ควรแก้ข้อมูลย้อนกลับเข้า General Cashflow

## ความหมายยอดสำคัญ

- `recognized_sales` คือยอดขาย POS ของวันที่ขายที่ปิดรายวันแล้ว
- `confirmed_received` คือเงินเข้าที่มีหลักฐานตามกติกา รวมเงินสดจากการปิดวัน
- `pending_receipts` คือยอดสุทธิที่ยังรับไม่ครบหรือยังขาดหลักฐาน เป็นลูกหนี้/เงินระหว่างทาง ไม่ใช่ยอดขายขาด
- `acknowledged_daily_variance` คือส่วนต่างที่ผู้ใช้รับทราบตอนปิดวัน รวมรายการปรับหลังปิด ใช้ตรวจสอบย้อนหลังและไม่ทำให้เดือนกลับเป็นปัญหาเอง
- `expected_fees` แยกจากยอดขาย ห้ามหักออกจาก `recognized_sales`
