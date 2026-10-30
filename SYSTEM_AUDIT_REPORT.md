# รายงาน Audit ระบบ + จำลองสถานการณ์ App ล่ม

วันที่: 2026-10-30
ขอบเขต: backend (`server/`), frontend (`client/`), การ deploy (Dockerfile), ข้อมูลใน repo

## วิธีทดสอบ

- รัน backend จริงกับ MariaDB 10.11 ในเครื่องทดสอบ โหลดข้อมูลจาก dump ใน `server/database/backups/`
- จำลองเหตุการณ์ด้วยสคริปต์: ปิด DB, DB host ไม่ตอบ (network blackhole), lock ตาราง, TCP proxy หน่วง 15ms เลียนแบบ DB บน cloud, ยิง request พร้อมกัน 40–100 รายการ
- ทดสอบหน้าเว็บจริงด้วย Playwright (Chromium)
- ตรวจโค้ดทั้งหมดแบบ static: async handler 195 ตัว, จุดใช้ `getConnection()` 48 จุด, outbound HTTP 9 จุด, ESLint และ build ของ client

## ผลจำลอง: ก่อนแก้เทียบกับหลังแก้

| # | สถานการณ์ | ก่อนแก้ | หลังแก้ |
|---|---|---|---|
| 1 | **สั่งออเดอร์พร้อมกัน 40 รายการ** (DB latency 15ms) | **ระบบค้างถาวรทั้งระบบ**: ทั้ง 40 request timeout 60 วินาที, `/health/db` ค้าง, หน้าอื่นใช้ไม่ได้ ต้อง restart | สำเร็จ 40/40 ใน 2.9 วินาที (ทดสอบ 100 รายการ: สำเร็จ 100/100 ใน 4.7 วินาที) |
| 2 | สั่งออเดอร์พร้อมกัน 40 รายการ (DB local) | 15/40 ล้มด้วย `Duplicate entry` (เลขออเดอร์ซ้ำ) | สำเร็จทั้งหมด เลขไม่ซ้ำ |
| 3 | ตาราง `products` ถูก lock 25 วินาที (migration หรือ transaction ค้าง) | pool ถูกใช้หมด 20/20, request ค้างจน client timeout, `/health/db` ค้าง | ตอบ 503 ภายใน 5–8 วินาที, `/health/db` ตอบ 503 ใน 5 วินาทีพร้อมสถานะ pool, endpoint อื่นยังใช้งานได้, ฟื้นตัวเองเมื่อ lock หาย |
| 4 | DB ปิด (connection refused) | 500 ใน 1.5 วินาที, ส่ง error ภายในให้ client | 503 พร้อมข้อความภาษาไทยและ `Retry-After`, client retry ได้ |
| 5 | DB host ไม่ตอบ (blackhole) | 500 หลังรอ 31.5 วินาที, `/health/db` รอ 31.5 วินาที | `/health/db` ตอบ 503 ใน 5 วินาที, API ตอบ 503 (ยังใช้ 31.5 วินาทีตาม `DB_CONNECT_TIMEOUT_MS` × retry ลดได้ผ่าน env) |
| 6 | Railway ส่ง SIGTERM ตอน deploy | process ถูกฆ่าทันที transaction ที่กำลังทำถูกตัดกลางทาง | ปิดแบบรอ request ที่ค้างอยู่ให้เสร็จ แล้วปิด DB pool (`[Shutdown] Completed`) |
| 7 | หน้าเว็บ: reload ตอน DB ล่ม | `/auth/me` ล้ม → user ถูกเตะไปหน้า login | ยังอยู่หน้าเดิม ใช้ข้อมูล user เดิม |
| 8 | หน้าเว็บ: deploy ใหม่ระหว่างที่แท็บเปิดค้างไว้ (ไฟล์ chunk เก่าหาย) | จอ error ค้าง ต้อง reload เอง | reload อัตโนมัติ 1 ครั้ง ถ้ายังไม่ได้จะแสดง "มีเวอร์ชันใหม่ของระบบ" พร้อมปุ่ม |

Regression: GET endpoint 77 ตัวให้ status เหมือนเดิมทุกตัวทั้งก่อนและหลังแก้

## สิ่งที่แก้ใน PR นี้

### Backend
1. **Deadlock ตอนสร้าง/แก้/ส่งออเดอร์** (`order.model.js`): `getOrderStatus()` ขอ connection ที่สองจาก pool ระหว่างถือ transaction อยู่ เมื่อมีออเดอร์พร้อมกันถึงขนาด pool (20) ทุก request จะรอกันเองตลอดไป แก้โดยให้ใช้ connection ของ transaction เดิม
2. **เลขเอกสารซ้ำ** (ORD/RCV/WDR/PW): เดิมสร้างจาก millisecond เดียวกันจึงซ้ำได้ แก้เป็นตัวสร้างกลางใน `utils/code.js` ที่ timestamp เพิ่มขึ้นเสมอ รูปแบบเลขเหมือนเดิม
3. **DB pool** (`config/database.js`)
   - query timeout 30 วินาที (`DB_QUERY_TIMEOUT_MS`) และทิ้ง connection ที่ query หมดเวลา
   - acquire timeout 15 วินาที (`DB_ACQUIRE_TIMEOUT_MS`) ถ้าหมดเวลา connection ที่ได้มาทีหลังจะถูกคืนโดยไม่รันคำสั่ง
   - `queueLimit` 200 (`DB_QUEUE_LIMIT`) เดิมเป็น 0 คือรอไม่จำกัด
   - **retry ไม่ทำให้ข้อมูลซ้ำ**: เดิม retry ทุกคำสั่งรวมถึง INSERT เมื่อเจอ `ECONNRESET`/lock timeout จึงอาจบันทึกซ้ำ ตอนนี้คำสั่งเขียนจะ retry เฉพาะเมื่อ error เกิดก่อนคำสั่งถูกส่งไปถึง DB
   - TCP keepalive 30 วินาที (เดิมใช้ค่า default ของ OS ประมาณ 2 ชั่วโมง)
4. **Process safety net** (`server.js`): `unhandledRejection` → log แล้วทำงานต่อ, `uncaughtException` → ปิดอย่างนุ่มนวลให้ platform restart, รองรับ SIGTERM/SIGINT, `keepAliveTimeout` 65 วินาที (กัน 502 จาก proxy)
5. **`/health/db`** ตอบภายใน 5 วินาทีเสมอและแสดงสถานะ pool (`total/free/queued`)
6. **errorHandler**: DB ล่ม/pool เต็ม/timeout → 503 + `Retry-After`, JSON เสีย → 400, payload ใหญ่ → 413, production ไม่ส่งข้อความ SQL ให้ client
7. **Outbound timeout**: LINE push (เดิมไม่มี timeout เลย และ route สร้างออเดอร์รอผลนี้อยู่) 10 วินาที, Discord 10 วินาที, OpenAI/ClickHouse 60 วินาที
8. **`settings.model.js`**: เดิมรัน `ALTER TABLE system_settings` ทุกครั้งที่อ่าน setting (สูงสุด 6 ครั้งต่อการแจ้งเตือนออเดอร์ 1 ครั้ง ทุกครั้ง lock ตาราง) เปลี่ยนเป็นรันครั้งเดียวต่อ process

### Frontend
1. **ErrorBoundary ระดับ route**: reset เมื่อเปลี่ยนหน้า, ข้อความภาษาไทยพร้อมปุ่ม, ซ่อน stack trace ใน production
2. **ไฟล์ chunk หายหลัง deploy**: รองรับ `vite:preloadError` ให้ reload อัตโนมัติ (มี cooldown กัน reload วน)
3. **axios timeout 60 วินาที** (เดิมไม่มี spinner จึงค้างตลอดไป) ยกเว้น sync-railway, timeout ไม่ retry ซ้ำ
4. **ไม่เตะ user ออกเมื่อ backend ล่มชั่วคราว**: logout เฉพาะเมื่อได้ 401
5. **token PR/PO หมดอายุไม่ logout ผู้ใช้หลัก**: เดิม reload ทุกครั้งจะถูกเตะไปหน้า login
6. **ReceiveOrders**: แก้กฎ hooks (return ก่อนเรียก hooks) ที่ทำให้ทั้ง app พังเมื่อ role เปลี่ยน
7. **Login**: กันจอขาวเมื่อ API คืนค่ารายการสาขา/แผนกที่ไม่ใช่ array

ESLint: error 51 → 45 (`rules-of-hooks` 5 → 0), build ผ่าน

## ⚠️ ปัญหาที่ยังไม่ได้แก้: ต้องให้เจ้าของระบบตัดสินใจ

### Critical: ความปลอดภัย
1. **Login ไม่มีรหัสผ่าน**: `POST /api/auth/login` ด้วย `{"userId": 1}` ได้ token admin ทันที (ยืนยันแล้วบนเครื่องทดสอบ) และ `GET /api/auth/branches|departments|users` เปิดสาธารณะ จึงหา id ของ admin ได้
   - แนวทาง: ใช้ PIN/รหัสผ่านต่อแผนกหรือต่อผู้ใช้ (bcrypt มีใน dependency แล้วแต่ยังไม่ถูกใช้)
2. **PIN super admin เป็นค่า default 4 หลักและฝังอยู่ใน JS ฝั่ง client** (`Login.jsx` เรียก `loginSuperAdmin(...)` อัตโนมัติ) ไม่มี rate limit จึงเดาได้ในไม่ถึง 1 วินาที (ทดสอบแล้ว) และใช้ค่าเดียวกันเป็น PIN ปรับสต็อกและ PIN ระบบจัดซื้อ
   - แนวทาง: ย้าย PIN ไปไว้ฝั่ง server เท่านั้น, ไม่มีค่า fallback, ใส่ rate limit
3. **SQL injection เข้า ClickHouse ผ่าน endpoint สาธารณะ** `/api/public/reports/sales` (`escapeValue` ไม่ escape `\`) และอีก 4 จุด
   - แนวทาง: ใช้ query parameters ของ ClickHouse และตรวจรูปแบบวันที่
4. **มี LINE channel access token และข้อมูลธุรกิจทั้งหมดอยู่ใน git**: `server/database/backups/*.sql`
   - ต้อง **revoke token ใน LINE console** แล้วลบไฟล์ออกจาก repo และประวัติ git

### High
- Endpoint ที่ไม่ต้อง login: `/api/ai/sales-report` (ใช้ OpenAI key ของระบบ), `/api/line/test-command` (เปิดอยู่โดย default), `/api/employee-refs` (ข้อมูลพนักงานและ `POST /sync`)
- มี secret fallback: `JWT_SECRET='default-secret-key'`, `EMPLOYEE_JWT_SECRET`, ถ้าไม่ได้ตั้ง env จะปลอม token ได้
- session PR/PO แบบอ่านอย่างเดียวยังเรียก `issue-po` / `receive` ได้
- ยังไม่มี rate limiting และ helmet ทั้งระบบ

### ความเสี่ยงด้านการกู้คืนระบบ (Disaster Recovery)
- **`schema.sql` ไม่ตรงกับโค้ดปัจจุบัน**: สร้าง DB ใหม่จาก repo แล้ว login ไม่ได้ (`Unknown column d.can_view_stock_balance`) และ dump ล่าสุดใน repo ก็ขาดคอลัมน์นี้ แปลว่าถ้า DB production หาย จะกู้ระบบจาก repo ไม่ได้
  - แนวทาง: export schema จาก production เป็นระยะ หรือใช้ระบบ migration จริงแทนการ `ALTER TABLE` ตอน runtime (มี helper `ensure*` อยู่ 72 ตัว)
- **ไฟล์ backup 5 ไฟล์ใน `server/database/backups/` มีขนาด 0 byte**: สคริปต์ backup ล้มเหลวแบบไม่มีใครรู้
  - แนวทาง: ตั้ง backup อัตโนมัติ (เช่น Railway backup) และตรวจขนาดไฟล์หรือทดลอง restore
- **cron ตัดสต็อกขายรันอยู่ใน web process**: ถ้า scale มากกว่า 1 instance จะตัดสต็อกซ้ำ
  - แนวทาง: ใช้ lock ใน DB หรือแยก worker
- **sync ยอดขาย (`recipe.controller.js`) เป็น transaction ใหญ่ก้อนเดียว** ที่ `FOR UPDATE` ทุกสินค้า ถ้าช่วงวันที่กว้างจะ lock สต็อกนานหลายนาที
  - แนวทาง: จำกัดช่วงวันและ commit เป็นชุด

### Medium
- รายงานหลายตัวไม่จำกัดช่วงวันที่ และใช้ `DATE(created_at)` ที่ใช้ index ไม่ได้
- หน้าใหญ่ไม่มี pagination/virtualization เช่น `PurchaseWalk.jsx` 3,758 บรรทัด และ `ProductManagement`
- หน้า inventory ยิง request ซ้ำประมาณ 4 ครั้งตอนเปิด และใช้ `alert()` เมื่อ error (ทั้ง client มี 340 จุด) ถ้า backend ล่มจะมี dialog เด้งต่อกันหลายอัน

## ค่า env ใหม่ (ทั้งหมดมีค่า default ไม่ต้องตั้งก็ใช้งานได้)

| ตัวแปร | ค่า default |
|---|---|
| `DB_QUERY_TIMEOUT_MS` | 30000 |
| `DB_ACQUIRE_TIMEOUT_MS` | 15000 |
| `DB_QUEUE_LIMIT` | 200 |
| `HEALTH_DB_TIMEOUT_MS` | 5000 |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | 65000 |
| `SHUTDOWN_TIMEOUT_MS` | 10000 |
| `LINE_REQUEST_TIMEOUT_MS` | 10000 |
| `CLICKHOUSE_TIMEOUT_MS` | 60000 |

> หมายเหตุ: ถ้ามีรายงานหรือ query ไหนที่ปกติใช้เวลาเกิน 30 วินาที ให้เพิ่ม `DB_QUERY_TIMEOUT_MS`
