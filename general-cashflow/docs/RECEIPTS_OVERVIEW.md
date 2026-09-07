# ภาพรวมรับเงิน

หน้า `/?view=overview` สำหรับ admin, auditor และ recorder มีสรุปรายวัน รายการรับเงิน และเงินรอรับ/ข้อแตกต่าง โดยเปิดงานเดิมต่อได้ งานรอบนี้สำหรับคอมพิวเตอร์ ไม่มีงานส่งออก Excel หรือออกแบบเฉพาะมือถือ

## ฐานข้อมูลและตัวเลข

`GET /api/reports/receipts-overview` ใช้ `report:overview` และ transaction แบบ READ ONLY / REPEATABLE READ ทุกครั้ง ไม่มีการสร้างเอกสาร ซิงค์ POS หรือปรับยอดจากการอ่านรายงาน

ตัวกรอง: `basis=sale|received`, `tab=daily|transactions|followups`, `from`, `to` (ไม่เกิน 366 วัน), `branch_id`, `channel_id`, `account_id`, `status`, `attention=true`, `page`, `page_size` (1–100), `receipt_id` สำหรับรายละเอียด

ผลลัพธ์มี `rows`, `summary` ของทุกหน้าตามผลกรอง, `pagination`, `generated_at`, `basis`, `note` และรายการสาขา/ช่องทาง/บัญชีที่แสดงเลขท้ายบัญชีเท่านั้น

- `sale` ยึดวันที่ขาย; `received` ยึดธุรกรรมรับเงินจริงและรองรับยอดขายนอกช่วงวันรับ
- แท็บ followups ใช้วันที่ขายเสมอและบอกฐานนี้บนหน้าจอ เพื่อรวมรายการที่ยังไม่มีวันที่รับจริง
- ยอดรับที่ยืนยันอาจเป็นยอดบางส่วน ค่า `null` ไม่ใช่ศูนย์; จำนวนช่องทางที่ยังยืนยันไม่ได้แสดงแยก
- รายการรับต้องผ่านการจับคู่และมี provenance จาก parser ธนาคาร/รายการจ่าย QR ธนาคาร ไม่ใช้สถานะของ reconciliation หรือวันที่คาดรับแทนหลักฐาน
- Grab daily และ K SHOP email เป็นรายงานอ้างอิง ไม่ใช่รายการธนาคาร จึงยังต้องยืนยันวันที่รับจริง
- เงินสดที่ตรวจนับแล้วหักเงินทอนหนึ่งครั้ง โดยใช้วันขายเป็นวันที่ตรวจนับเงินสด; ไม่อ้างว่าเป็นยอดขายเงินสด
- ชุดโอนต้องมีหลักฐานครบเท่ายอดจัดสรรก่อนรับรองยอดตามวันขาย ในฐานวันรับใช้ธุรกรรมธนาคารจริงเพียงครั้งเดียว
- ใช้ closing snapshot / post-close adjustments สำหรับยอดยืนยันปิดวัน แยกจากหลักฐานเงินรับใหม่
- ค่าธรรมเนียมในแต่ละธุรกรรมไม่ถูกคัดลอกจากยอดรวมช่องทางซ้ำ เปิดรายละเอียดเพื่อดูยอดก่อนหัก/รายการหักของช่องทางนั้น
- ไม่มีนโยบายวันครบกำหนดที่ยืนยันในข้อมูลเดิม จึงแสดงจำนวนวันที่รอ ไม่กล่าวว่าเกินกำหนดหรือเป็นเงินขาด
- การกรองช่องทาง/บัญชีไม่แสดงยอด POS และผลต่างปิดวันทั้งใบ เพื่อไม่ให้สับสนกับยอดเฉพาะส่วน

## การตรวจส่งมอบ

ติดตั้งเครื่องมือทดสอบด้วย `npm ci` ที่โฟลเดอร์ general-cashflow ใช้ Chrome ที่ติดตั้งใน macOS และ Railway CLI ที่ล็อกอินแล้วสำหรับตรวจแบบอ่านอย่างเดียว (ไม่มี token/password อยู่ในสคริปต์หรือ artifact)

1. `node general-cashflow/scripts/overview-preview.mjs` เปิด preview อ่านข้อมูลจริงผ่าน pool แยก ห้าม import server.js เพื่อหลีกเลี่ยง startup maintenance
2. Build client ด้วย `VITE_CASHFLOW_API_URL=/api npm run build` แล้วใช้ `node general-cashflow/scripts/verify-receipts-overview.mjs --url http://127.0.0.1:8111 --local`
3. หลัง commit/deploy รัน `node general-cashflow/scripts/release-check.mjs` จาก repository หลัก

สคริปต์ตรวจทุก test suite (ห้าม fail/skip/cancel/todo), build, deployment SUCCESS และ commit เดียวกันทั้ง frontend/backend, API totals/pagination/filter, สามแท็บ, หลักฐานจริง, เปิดงาน/กลับหน้าเดิม, 1440/1920px และไม่มี request เขียนข้อมูลขณะทดสอบ browser โดยหลักฐานอยู่ใน `output/playwright/`

Docker ใช้ build argument `RAILWAY_GIT_COMMIT_SHA` สร้าง `server/build-info.json` และ `VITE_BUILD_COMMIT` หากไม่ได้รับ commit จริง การตรวจส่งมอบ Production จะล้มและไม่ประกาศผ่าน

แก้ความเข้ากันได้ของ accounting export ด้วย: `OPEN_STATUS_ONLY` เป็นสถานะ ไม่ใช่ validation issue เพื่อให้ consumer ไม่นับเอกสารที่ยังไม่ปิดเป็นข้อมูลเสีย ยังคง null ทุกยอดการเงินของเอกสารที่ยังไม่ปิด
