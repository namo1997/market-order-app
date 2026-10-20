# E2E หน้ารับสินค้า — mock API เท่านั้น

รันจาก branch `receiving/server` ใน worktree นี้:

```sh
E2E_OUT='/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-e2e-codex' ./e2e/run-on-ssd.sh
```

สคริปต์ใช้ผลยืนยัน SSD ของ Claude ที่ผู้ใช้ส่งให้ (2026-10-15 22:02:30 rc=0, UUID `AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B`) ไม่เรียก `diskutil` หรือ `ssd-workspace check/run` ซ้ำ ตรวจเพียงว่าจุด mount ยังอยู่ เป็น filesystem ภายนอกจริง ปลายทางไม่หลุด SSD และเหลือ ≥5 GiB ถ้าไม่ตรงจะหยุด ไม่มี fallback

ทุกครั้งสร้าง snapshot ใหม่ใน SSD `runs/receiving-e2e-*` คัดลอกเฉพาะ `client/` และ `e2e/` โดยตัด `.env*`, `.git`, `node_modules`, `dist`, ผลเทสต์ออก ล้างตัวแปร credential ที่รู้จักก่อนรันลูก ติดตั้ง/build client ใน snapshot และใช้ `client/dist` ที่ได้กับ static server loopback ภายใน fixture ไม่มี dev server หรือ server/API จริง

Dependency, browser, npm cache, Chromium profile/temp, HTML/JSON และภาพอยู่ SSD ทั้งหมด ไม่มี symlink/node_modules/browser ใน worktree ไฟล์ภาพจำลองสร้างในหน่วยความจำ browser เท่านั้น ปิด network trace เพื่อไม่ฝัง raw upload/signature body ลง artifact ใช้ภาพและ sanitized browser-evidence แทน `package-lock.json` เป็นไฟล์ source ที่ล็อก dependency ของชุด E2E

รัน Playwright สองรอบโดยไม่มี retry; บางเทสต์ล้มเหลวก็ยังรันรอบสองและ exit nonzero `E2E_OUT` กำหนดโฟลเดอร์รายงาน; `E2E_DIST` ใช้ชี้ dist บน SSD เมื่อรัน Playwright โดยตรง สคริปต์เตรียม snapshot จะกำหนดค่าเอง ภาพอยู่ `screens/round-1|2/<width>-<theme>/<test>/` ค่า Date ถูกตรึงไว้ 2026-10-15 เวลา Bangkok; timer/debounce ทำงานปกติ

กรองเพื่อวิเคราะห์ปัญหาเฉพาะจุดได้ เช่น:

```sh
./e2e/run-on-ssd.sh --project=360-light --grep='complete receiving'
```

การกรองไม่ใช่ผลตรวจครบทุก viewport/theme; คำสั่งส่งมอบต้องรันแบบไม่มี filter

`./e2e/run-on-ssd.sh --prepare-only` ใช้ตรวจ build, dependency, mock harness และรายการเทสต์โดยไม่เปิด browser สำหรับ sandbox ที่ปฏิเสธ Chromium; ไม่ใช่ผล E2E ผ่าน

## ขอบเขตที่ทดสอบ

- Chromium 360×844, 390×844, 1440×1000 × light/dark
- Login จำลองผ่านสาขา/แผนก และ session จำลองสำหรับเทสต์อื่น ไม่อ่านบัญชี/token/คีย์จริง
- `page.route('**/*')` mock ทุก `/api/*` รวม expected, list/detail, create, รูป binary, upload, OCR, PUT, signatures, confirm, void และ auth; endpoint ไม่รู้จักทำให้เทสต์ fail ทุกปลายทางภายนอกถูกบล็อก ไม่มี OpenAI API
- สร้าง → รูป → OCR → แก้จำนวนและสีเขียว/อำพัน/แดง → วาด canvas จริง → PUT → เซ็น → สถานะกำลังบันทึก → confirm → void ต้องใส่เหตุผล
- Double activation ก่อน rerender, คำตอบ create สูญหายหลัง server mock สร้างแล้ว, offline banner, ส่งซ้ำหลังปิด/เปิด dialog ต้องใช้ payload/client_uuid เดิม
- 409 confirm บังคับ reload, 422 PUT เก็บข้อมูลแก้ไว้, 429/503 OCR พร้อมลองใหม่, 403/404 รูป, 401 session กลับ login
- Screenshot รายขั้น, no horizontal overflow, primary ≥48×48 และอยู่ล่าง viewport มือถือ, Tab/focus/modal trap และ axe serious/critical fail
- Console/page errors ทำให้ fail; browser-generated resource error จาก HTTP/transport ที่จงใจจำลองใน negative tests เก็บแยกใน `browser-evidence.json` ไม่ซ่อน application console errors

## ที่มาข้อมูลและข้อจำกัด

ตัวเลข 392/472 อ้างอิงกรณี `F4 header equation detects real-bill-shaped total errors independently of line sums` ใน `server/tests/receiving-ocr-findings.test.mjs` ชื่อ/สินค้า/วันที่/ID/ปริมาณสร้างจำลอง ไม่มีภาพบิลต้นฉบับที่ตรวจยืนยันได้ จึงยังไม่อ้างว่า fixture นี้เป็นข้อมูลถอดจากบิลจริงหรือวัดความแม่น OCR (เทสต์นี้ mock ผล OCR ที่ normalize แล้วตามสัญญา)

UI mock E2E ไม่พิสูจน์ SQL, transaction/rollback, inventory/alias, IDOR/auth จริง, race ใน DB, OCR provider validation/cost, migration หรือ release invariants ฝั่ง server รายงานต้องแยกสถานะเหล่านี้ ไม่ใช้ผล mock อ้างว่าพร้อม Production

ไม่มีการแก้ client/server หรือ commit งานจากเอเจนต์อื่น ข้อความ commit ที่เสนอ: `test(receiving): add SSD-only mocked Playwright E2E and accessibility checks`
