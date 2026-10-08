# Super Admin เข้าสู่ระบบด้วย LINE วันที่ 8 ตุลาคม 2026

Production SUCCESS: `557b0769-045e-4fb6-8714-a42cfee181c1` ฐาน release `2026-10-08-units-ux-v2` (`27ab75c3`/`0af75d5f`)

## ปัญหาเดิม
- ปุ่ม Super Admin บนหน้า login เรียก `POST /api/auth/super-admin` ด้วย PIN `1997` ที่ฝังในหน้าเว็บ และ Railway ไม่ได้ตั้ง `SUPER_ADMIN_PIN` (ค่าเริ่มต้นในโค้ดคือ 1997) ใครเปิดหน้า login ก็เป็น Super Admin ได้

## สิ่งที่ทำ
1. 12:11 ตั้ง `SUPER_ADMIN_PIN` แบบสุ่ม (24 ตัว) ใน Railway → PIN 1997 ตอบ 401 (deployment `0af75d5f` redeploy โค้ดเดิม)
2. โค้ด (`557b0769`):
   - ลบปุ่ม PIN 1997 ออกจากหน้า login; ปุ่มใหม่ "Super Admin — เข้าสู่ระบบด้วย LINE" แสดงเมื่อ config ครบเท่านั้น
   - `POST /api/auth/super-admin` ไม่มีค่าเริ่มต้นแล้ว ใช้ได้เฉพาะเมื่อตั้ง `SUPER_ADMIN_PIN` (สำรองฉุกเฉิน)
   - route ใหม่: `GET /api/auth/line/super-admin/status`, `GET /api/auth/line/super-admin/start`, `GET /api/auth/line/callback`, `POST /api/auth/line/super-admin/exchange`
   - state เป็น JWT ผูกกับ nonce ใน cookie HttpOnly (กัน login CSRF); หลัง callback ส่งโค้ดใช้ครั้งเดียว (60 วินาที, เก็บในหน่วยความจำ) กลับหน้า `/login` แล้วหน้าเว็บแลกเป็น token — ไม่ใส่ JWT ใน URL
   - อนุญาตเฉพาะ LINE userId ใน `SUPER_ADMIN_LINE_USER_IDS`
3. env ใหม่ของ `market-order-app`: `LINE_LOGIN_CHANNEL_ID` (2003142917 = channel เดียวกับ HRMS), `LINE_LOGIN_CHANNEL_SECRET`, `LINE_LOGIN_REDIRECT_URI`, `LINE_STATE_SECRET`, `SUPER_ADMIN_LINE_USER_IDS` (LINE userId ของคุณสุรชาติ ดึงจาก HRMS employee_code 1)

## ผลตรวจ
- Tests 85/85 (เพิ่ม `server/tests/super-admin-line-login.test.mjs` 7 เคส), client build ผ่าน
- server จริงบนเครื่องกับ DB สำเนา SSD: status/start (302 ไป access.line.me + cookie)/callback state ผิด/exchange ผิด/PIN 1997 ตอบตามคาด, หน้า login แสดงปุ่มและข้อความผิดพลาดภาษาไทย
- Production: `/health/db`, `/login`, `/apps` 200, PIN 1997 → 401, LINE status `enabled:false` จนกว่าจะใส่ channel secret

## ผู้ใช้ต้องทำ
1. LINE Developers → channel 2003142917 → LINE Login → Callback URL เพิ่ม `https://market-order-app-production.up.railway.app/api/auth/line/callback` (คงของ HRMS ไว้)
2. Railway → market-order-app → Variables: ใส่ `LINE_LOGIN_CHANNEL_SECRET` ค่าเดียวกับ hrms-backend (Railway จะ redeploy เอง)

## ค้างอยู่
- `STORE_PIN` และ `GENERAL_PURCHASE_READONLY_PIN` ยังเป็น 1997 (ฝังในหน้าเว็บ/ค่าเริ่มต้น)
