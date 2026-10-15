# Receiving MySQL integration (R3-3)

รันจาก branch `receiving/server` ของ worktree นี้ หลังผู้ควบคุมยืนยัน SSD แล้ว:

```sh
sh server/scripts/start-test-mysql-on-ssd.sh --ssd-verified-by-claude
```

สคริปต์ใช้ผลตรวจ SSD ที่ Claude ให้ใน session นี้ (15 ต.ค. 2569 21:45:50)
ไม่เรียก `diskutil` หรือ `ssd-workspace check/run` ซ้ำ ทั้ง source snapshot,
datadir, socket, tmp, cache, log อยู่ใต้ SSD เท่านั้น ไม่มี Docker/TCP listener
และปิด MySQL child ของตัวเองเมื่อจบ ไม่ใช้งานฐานเดิมหรืออ่าน `.env`/คีย์
ปิดการสร้าง SSL/RSA key อัตโนมัติของ MySQL และไม่เรียก OCR/บริการภายนอก
Dependencies ใช้สำเนาบน SSD ที่ package-lock ตรงกัน หรือ `npm ci --offline`
จาก npm cache บน SSD เท่านั้น ไม่มี symlink กลับ node_modules ภายใน Mac

สคริปต์เก็บ snapshot layout `source/server` และ `source/client` เพื่อให้เทสต์เดิม
อ่าน sibling client ได้ รัน syntax/module validation และเทสต์เดิมสองรอบ จากนั้น
initialize MySQL 9.5 แบบ insecure เฉพาะฐานทิ้งได้ `receiving_it` ผ่าน socket
พร้อม `--skip-networking --mysqlx=OFF --no-defaults` สร้าง schema แล้วรัน integration
สองรอบ สถานะรวมไม่ผ่านหากมีเทสต์ล้ม แม้ MySQL เริ่มไม่ได้ก็เก็บผลเทสต์เดิมไว้

Log แต่ละ invocation อยู่ที่
`/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-mysql-integration/<timestamp>/`
พร้อม `result.json`, SSD receipt และ `source-sha256.json` ไม่มีการล้าง run เก่า
ถ้า MySQL initialize ไม่ได้ `opt-in-disabled-{1,2}.log` พิสูจน์เพียงการข้ามโดยอัตโนมัติ
**ห้ามนับ skip นี้เป็นผลทดสอบ MySQL จริง**

ไฟล์ integration แยกจาก glob `tests/*.test.mjs` ใช้งานฐานที่เริ่มไว้เองได้เฉพาะ
socket รูปแบบ `/Volumes/SSD Files/SOLAO/market-order-system/runs/mysql-it-*/m.sock`
และตรวจ `@@datadir`, `@@skip_networking`, version, schema ก่อนล้าง fixture:

```sh
# รันคำสั่งนี้ใน SSD snapshot/server และตั้ง TMPDIR/TMP/TEMP บน SSD ด้วย
RECEIVING_IT_MYSQL_SOCKET='/Volumes/SSD Files/SOLAO/market-order-system/runs/mysql-it-<timestamp>/m.sock' \
  node --experimental-vm-modules --test tests/integration/receiving-mysql.it.mjs
```

ขอบเขตหลักฐาน:

- SQL, InnoDB transactions, row locks, unique constraint และ DECIMAL ใช้ MySQL จริง
  ไม่มี fake DB; SQL barrier เปลี่ยนเฉพาะจังหวะ ไม่แก้ query/ผลลัพธ์ และต้องเห็น
  connection ID ต่างกันสองตัว การสร้างซ้ำต้องเกิด `ER_DUP_ENTRY` จริง
- ส่งคำขอผ่าน Express router/controller จริงแบบ in-process; auth เป็น fixture
  identity injection เพื่อไม่สร้าง token จึงไม่ใช่ HTTP transport/JWT acceptance test
- โหลด source จาก path/export เดิมด้วย VM loader ที่รองรับ module ที่แยกใหม่
  เปลี่ยนเฉพาะ database/auth adapters; network ถูกบล็อกและ OCR provider เป็น mock
- เวลาของ application VM และ SQL session ถูกตรึงเป็น 15 ต.ค. 2569 10:00 ICT
  fixture IDs/UUIDs ไม่ใช้สุ่ม แต่ละเทสต์ล้างเฉพาะข้อมูลในฐานทิ้งได้ที่ตรวจ identity แล้ว
- **checkout นี้ไม่มี `server/schema.sql` หรือ SQL migrations** จึงใช้ legacy schema
  ขั้นต่ำที่ประกาศชัดใน `legacy-receiving-schema.mjs` จาก queries/ensures ใน repo
  และ precision จาก `docs/review-round1.md` ตาราง inventory/receiving ใช้ ensure จริง
  ต้องเทียบ schema จริงก่อนอ้างความเท่าเทียมกับ Production
- เทสต์ `two bills ... void FIRST ...` ตั้ง expectation ตามโจทย์อย่างเข้มงวด
  โค้ดปัจจุบันมี guard ที่อาจตอบ 409 เมื่อมีบิลถัดมา ห้ามปรับเทสต์ให้ผ่านด้วยการ
  ยอมรับ 409 หรือเปลี่ยนเป็น void บิลที่สอง ต้องรายงานให้เจ้าของ server ตัดสินใจ

ผู้ใช้ให้ Claude commit แทนหาก sandbox commit ไม่ได้ จึงไม่ stage/commit
ไฟล์ร่วมของเอเจนต์อื่น ดูข้อความ commit ที่เสนอในรายงานบน SSD
