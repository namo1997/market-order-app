# Pilot ภายใน — ข้อมูล SYNTHETIC เท่านั้น

สคริปต์ชุดนี้เปิด receiving API ของ source ปัจจุบันบนสำเนา SSD และ MySQL ใหม่แบบ socket-only
ไม่ได้เปิด market-order server เต็มระบบ ไม่มี cron, Railway, LINE, OpenAI API หรือฐาน Production
สร้าง source ใหม่เฉพาะ `pilot/`; ไม่แก้ server/client/APK และไม่สลับ branch

ใช้ผลตรวจ SSD จาก Claude วันที่ 2026-10-17 12:59:06 rc=0, UUID
`AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B` ตามคำสั่งเจ้าของ ไม่เรียก diskutil หรือ ssd-workspace
สคริปต์ตรวจเพียงว่ายังเข้าถึง mount และเขียน path ที่อยู่บน device นั้นได้ โดยไม่สร้าง mount ทดแทน
ถ้า SSD หลุดให้หยุด และให้ผู้ดูแลตรวจ identity อีกครั้งก่อนเปิดใหม่

## สถานะที่ลองจริง (รอบ 2)

- Claude แจ้งว่า MySQL บน SSD และ API :8841 ทำงานจริง; smoke เดิมสองรอบได้ 7 pass / 1 fail ที่ upload
- สาเหตุจากโค้ด: helper คาด HTTP 200 แต่ upload ตอบ 201; แก้ให้คาด 201 โดยยังตรวจ ID, MIME และไบต์ตรงกัน
- pilot tests บน SSD: 13 tests / pass 13 / fail 0 / skip 0 สองรอบ รวมทดสอบบั๊กเดิมและ Google route ใน process
- regression บน snapshot ล่าสุด: 148 tests / pass 145 / fail 3 / skip 0 สองรอบ
  สองข้อของ `google-auth.test.mjs` เปิด listener ไม่ได้ (`listen EPERM 127.0.0.1`)
  อีกข้อ `G1 G2 OCR metadata and warnings survive GET, image hash cache and manual header edits`
  ล้มใน harness เดิมด้วย `controllerMod.namespace[handlerName] is not a function`; ไม่แก้ไฟล์นอก pilot/
  snapshot ก่อนหน้ามี 137 tests / pass 135 / fail 2; source ของ server มีการเปลี่ยนจากภายนอกระหว่างงาน
- smoke จาก sandbox รอบนี้: 1 test / pass 0 / fail 1 / skip 0 เพราะ fetch health ถูกปฏิเสธ `EPERM`
  จึงยังไม่ได้ยืนยัน smoke หลังข้อ 8 บน MySQL จริง; ต้องรันครบสองรอบนอก sandbox
- สถานะ emulator จากรอบก่อน: SDK image `system-images;android-36;google_apis;arm64-v8a` ขอ
  **`android-sdk-arm-dbt-license` เพิ่ม** จึงหยุด; รอบนี้ไม่ได้รัน emulator/APK

ผลและ log รอบนี้อยู่ที่ `/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-pilot/REPORT-r2.md`
จึงยังไม่ถือว่าทดลองแอปจริงครบหรือผ่านเกณฑ์รวมงาน/Production

## เปิด server (Claude รันนอก sandbox ได้)

ต้องมี Node/npm, `/opt/homebrew/bin/mysqld` และ `/usr/bin/sips` บน Mac
สคริปต์ใช้ MySQL ที่ติดตั้งอยู่ ไม่ลง Homebrew package เพิ่มลงดิสก์ภายใน

```sh
cd /Users/surachart/solao-worktrees/market-receiving-apk
sh pilot/start-server.sh
```

ค่าเริ่มต้น `--port=0` ให้ OS จัดพอร์ตว่างจริงบน `0.0.0.0`; หรือกำหนด `--port=8841`
หากพอร์ตที่ระบุถูกใช้จะหยุด ไม่ฆ่า process อื่น
เมื่อพร้อมจะแสดง Mac URL, emulator URL, LAN URL และ evidence directory
เปิด terminal นี้ไว้; Ctrl+C จะปิด API และ MySQL เฉพาะ child ที่สคริปต์นี้เปิด

แต่ละครั้งสร้างฐาน `receiving_pilot` ใน datadir ใหม่ที่
`runs/receiving-pilot-<timestamp>-<pid>/data` บน SSD และ Unix socket ใน run เดียวกัน
ไม่เปิด TCP ของ MySQL ไม่มีรหัสผ่าน/คีย์ใน environment; source ถูกคัดลอกโดยตัด `.env*`
และ dependencies ถูกคัดลอกจาก SSD ที่ lockfile ตรงกัน หรือ `npm ci` บน SSD
ไม่ใช้ `server/scripts/start-test-mysql-on-ssd.sh` เพราะตัวนั้นรัน integration แล้วปิด DB
ใช้ flags ของ daemon ตามแนวทางเดิม แต่ pilot ต้องเปิดค้างให้แอปใช้งาน

ข้อมูลสมมติ: 2 สาขา, ครัวสาขาละ 1 แผนก, ผู้รับสาขาละ 1 คน,
3 ซัพพลายเออร์ใน `product_groups` ตาม supplier key `pg:<id>` ของ API,
สินค้า 30 รายการ, ใบสั่งวันนี้ตามเวลา Bangkok 2 ใบ/60 order_items
ชื่อสาขา/แผนก/ผู้ใช้/ร้าน/สินค้ามี `SYNTHETIC`; หน่วยเป็นกิโลกรัม
วันใหม่ให้เปิด pilot session ใหม่เพื่อให้ expected มีรายการวันนี้ ไม่แก้วันที่ DB เดิมอัตโนมัติ

Login ใช้หน้าตา API เดิม `{departmentId: 1|2}` และคืน user/token ตามที่ APK ต้องการ
แต่เป็น **adapter เฉพาะ pilot** ใช้ session สุ่มใน RAM อายุ 8 ชั่วโมง ไม่มี JWT secret
ใช้ผู้ใช้ role `user` เพื่อทดสอบขอบเขตสาขา; ไม่ได้พิสูจน์ JWT/LINE/admin ของ Production
หลัง restart ให้ login ใหม่ ไม่บันทึก session ลงไฟล์/log

## เปิด Google login (เจ้าของตั้งค่าก่อนเปิด session ใหม่)

pilot เปิด `POST /api/auth/google` body `{ "id_token": "<Google ID token จาก client>" }`
โดยใช้ `google-auth.controller.js`, ตัวตรวจลายเซ็น RS256/issuer/audience/expiry/email_verified
และ allowlist store เดิมจาก snapshot จริง ไม่ยอมรับอีเมลหรือสิทธิ์จาก request body แทน token
คืน `{ success: true, data: { token, user } }`; token ของ pilot เป็น session ใน RAM เหมือน department login

ตั้งเฉพาะตัวแปรที่ไม่ใช่ความลับสองตัว ไม่ต้องมี client secret หรือไฟล์ `.env`:

```sh
GOOGLE_OAUTH_CLIENT_IDS='YOUR_WEB_CLIENT_ID.apps.googleusercontent.com' \
PILOT_GOOGLE_EMAILS='[{"email":"owner@example.com","user_id":1},{"email":"tester@example.com","user_id":2}]' \
sh pilot/start-server.sh --port=8841
```

ใช้ Google OAuth client ID ของเจ้าของแทน placeholder; หลาย audience คั่นด้วย comma
`PILOT_GOOGLE_EMAILS` เป็น JSON array ผูกอีเมลที่ Google ยืนยันแล้วกับผู้ใช้ SYNTHETIC 1 หรือ 2 เท่านั้น
user 1 อยู่สาขา/แผนก 1, user 2 อยู่สาขา/แผนก 2; ทั้งคู่ role `user`
seed ตาราง allowlist ในฐาน pilot ใหม่โดยใช้ placeholder ไม่สร้างบัญชีหรือสิทธิ์ Production
อีเมลไม่ถูกพิมพ์ใน log/ready.json แต่ถูกเก็บในฐาน SYNTHETIC บน SSD ตามการ seed ที่ตั้งไว้

หากตัวแปรใดไม่มี/ว่าง Google จะปิดชัดเจน: `GET /api/auth/google/status` คืน `enabled: false`
และ POST คืน 503 `GOOGLE_AUTH_NOT_CONFIGURED` โดยไม่เรียกเครือข่าย/DB
หากตั้งทั้งคู่แต่รูปแบบผิดจะหยุด startup โดยไม่พิมพ์ค่า config
เมื่อเปิด Google อนุญาต outbound เฉพาะ Google JWKS URL คงที่เพื่ออ่าน public certificates
มี timeout 5 วินาที, cache และ rate limit 10 requests/IP/นาทีจาก source เดิม
source receiving ยังปิด outbound; ค่าเริ่มต้นใช้ mock ส่วน `--ocr=codex` อ่านภาพผ่าน Codex CLI แยก process (ไม่ใช้ OpenAI API/คีย์)

APK 0.2.0 ยังใช้ `{departmentId}` adapter เดิมได้; งานนี้ต่อ backend เท่านั้น ไม่เพิ่มปุ่ม Google ใน APK
การ login ด้วย Google จริงต้องให้ client ของเจ้าของขอ ID token ที่ audience ตรงกับค่าข้างต้น
ทดสอบรอบนี้ใช้ JWKS mock และ token ลงลายเซ็นสมมติใน RAM ไม่ได้ login Google ของเจ้าของจริง
server ที่เปิดไว้ก่อนแก้จะยังใช้ snapshot เก่า: ต้องปิด session เดิมด้วย terminal ของผู้ดูแลแล้วเปิดใหม่
ไม่รัน seed ซ้ำใส่ฐานเดิม และไม่แก้วันที่คำสั่งซื้อใน session ที่ข้ามเที่ยงคืน

receiving router/controller/models และ inventory/settlement ใช้ source เดิมบน snapshot
เปลี่ยนเพียง database/auth adapter ผ่าน VM loader; ไม่ import `src/server.js` หรือ dotenv
OCR ลงทะเบียน `setCustomOcrProvider` ก่อนเปิด HTTP และปิด outbound fetch/http/https ใน source context
ในโหมด mock ทุกภาพให้คำตอบสมมติหนึ่งบรรทัด: รับ 2.50 กก. ราคา 10.00 รวม 25.00
โหมด mock ไม่ได้อ่านภาพจริง; เลือกสินค้าจาก expected รายการแรกที่ผูก หรือให้ผู้ใช้ผูกสินค้าเอง
metadata/catalog endpoints เป็น read-only adapter สำหรับ receiving UI; ไม่เปิด route ของระบบอื่น

## อ่านบิลจริงด้วย Codex CLI + ชุดร้านเจ๊แวว

```sh
sh pilot/start-server.sh --port=8841 --ocr=codex --seed=jae-waew
# เปลี่ยนเฉพาะ model/effort (ไม่ต้องตั้ง API key)
PILOT_CODEX_MODEL=gpt-6-luna PILOT_CODEX_EFFORT=medium sh pilot/start-server.sh --port=8841 --ocr=codex --seed=jae-waew
```

ต้องมี `codex` ใน PATH และบัญชี ChatGPT ที่ login แล้วใน Mac ของผู้เปิด server
pilot ส่งต่อเฉพาะ HOME/CODEX_HOME ซึ่งเป็น path สำหรับ login เดิม โดยไม่อ่าน/คัดลอกไฟล์ auth
ไม่ส่งต่อ API key env; ใช้ `forced_login_method=chatgpt`, `--ignore-user-config` และ `--ephemeral`
เพื่อไม่ใช้ user MCP/config และไม่เก็บ transcript ของบิล; log_dir/sqlite_home/temp/output ตั้งลง SSD และปิด history.persistence
CLI ส่งภาพไปให้โมเดลผ่านบัญชี ChatGPT จึงยังต้องเชื่อมอินเทอร์เน็ตและใช้โควตาของบัญชีนั้น
ไม่ใช่ OCR offline และไม่มี fallback ไป mock/API เมื่อผิดพลาด
health แสดง `ocr: "codex"`; ready.json ระบุ ocr และ seedProfile ของ session

ภาพถูกเขียนเป็นไฟล์ mode 0600 ใน `<run>/tmp/codex-ocr-*` ตามลำดับหน้า
ใช้ BILL_OCR_SYSTEM_PROMPT ของ source เดิมและ expected_items ฟิลด์เดียวกับ provider เดิม
spawn ไม่ผ่าน shell, sandbox read-only, รอไม่เกิน 180 วินาที, พร้อมกันได้หนึ่งงานต่อ pilot
คำขอที่ชนกันตอบ OCR_UNAVAILABLE; timeout ฆ่า process group และล้างภาพ/output ชั่วคราวหลังงานจบ
ไม่บันทึก stdout/stderr ของ Codex หรือเนื้อภาพลง log; ผลผ่าน normalizer/cache/rate-limit เดิม
ผู้ใช้อาจต้องรอถึง 180 วินาที; client source ตั้ง OCR timeout 70 วินาที
หาก Codex ช้ากว่านั้น APK อาจแจ้งหมดเวลาก่อน backend จบ และต้องเปิดเอกสารเดิมตรวจผล
ยังไม่ได้ยืนยันกับ APK/มือถือจริงในรอบนี้

`--seed=jae-waew` ใช้ฐาน disposable ใหม่ โดยแทน catalog ตัวอย่าง 30 รายการด้วยกลุ่ม
"เจ๊แววไก่สด ตลาดเมืองใหม่": ขา B 60, ปีกบน 76, ปีกกลาง 135, อกไก่ 80 บาท/กก.
มี alias ต่อ `pg:1`: ทB/ทร, ป.บน, ป.กลาง, ต.ไก่ ตามลำดับสินค้า
ออเดอร์วันนี้ Asia/Bangkok ของ SYNTHETIC ครัว 1 สั่งทั้งสี่ตัว ตัวละ 10 กก.

`--seed=ice-vic` สำหรับร้าน "ร้านน้ำแข็ง vic" (ไม่มีใบสั่ง / สั่งหน้าร้าน):
สินค้าหน่วยถุง ราคา 35 บาท: น้ำแข็งหลอดใหญ่, น้ำแข็งบด (ใช้ครัว), น้ำแข็งสำหรับกาแฟ, น้ำแข็งบด (ใช้ผลิต)
มี alias: หลอดใหญ่, โม่ครัว, กาแฟ, โม่โรงงาน รองรับทั้ง `pg:1` และ `name:ร้านน้ำแข็ง vic`
ไม่มีใบสั่ง (orders: 0) รับของผ่าน "รับสินค้าเพิ่ม (ไม่อ้างอิงใบสั่ง)" ในแอปได้ทันที

`--seed=suppliers-2026-10` (ข้อมูล SYNTHETIC ทั้งหมด) ใส่ 7 ร้านจากทะเบียน `supplier-setup/SUPPLIERS.md`:
เจ๊แววไก่สด, ร้านน้ำแข็ง vic, ร้านต้นพยอมพานิช, สุพรค้าหมูเจริญ, ร้านแพปลาภูเก็ต, เบทาโกร, เอเซียเกษตรรุ่งวิไล
แต่ละร้านมีทั้ง `product_groups` (`pg:N`) และ `supplier_masters` (`sm:N`) พร้อมสินค้า หน่วย ราคาตามทะเบียน,
รูปแบบการสั่ง (ผ่านระบบ / สั่งหน้าร้าน-โทรสั่ง / ผสม / ยังไม่ทราบ) หมายเหตุสาขาและรูปแบบบิลใน `receiving_supplier_profiles`,
และชื่อย่อที่เจ้าของยืนยัน 15 รายการ (เก็บทั้งสอง key = 30 แถว): ทB/ทร/ป.บน/ป.กลาง/ปีกกลาง (ญ.)/ต.ไก่, หลอดใหญ่/โม่ครัว/กาแฟ/โม่โรงงาน,
ไข่เบอร์ 1/ไข่ไก่ NO1/6 × 14/8 × 16, บดB — ร้านที่พิมพ์ชื่อเต็มไม่มี alias (ทดลองเพิ่มจากหน้า `/admin/receiving/suppliers`)
ออเดอร์ SYNTHETIC วันนี้มีเฉพาะร้านที่สั่งผ่านระบบ/ผสม (เจ๊แวว ต้นพยอม สุพรค้าหมู แพปลาภูเก็ต เบทาโกร); ร้านน้ำแข็ง vic และเอเซียเกษตรไม่มีออเดอร์
ค่าที่ทะเบียนไม่ระบุและตั้งสมมติไว้ (ดู `assumed` ใน `pilot/seed-suppliers.mjs`): ถุงหิ้ว 6×14/8×16 หน่วย "ห่อ" 400 บาท (ทะเบียนมีแต่ "บิลละ 400"),
หมูบดเกรด B 120 บาท/กก. (ทะเบียน 117–125), และสินค้าเอเซียเกษตรที่ไม่มีราคา = NULL หน่วย กก.
ไม่มีเลขบัญชี เลขภาษี หรือเบอร์โทรในชุดข้อมูล

สาขา/แผนก/ผู้ใช้ SYNTHETIC เดิมยังครบ; `--seed=default` หรือไม่ใส่ flag ใช้ชุดเดิม

มือถือที่ต่อ USB ใช้ adb ตัวเดิม/serial ที่ผู้ดูแลเลือก:

```sh
adb -s <serial-มือถือ> reverse tcp:8841 tcp:8841
```

ตั้ง API ใน APK เป็น `http://127.0.0.1:8841` (ไม่ใส่ `/api`) แล้วเลือก SYNTHETIC ครัว 1
เลือกกลุ่มเจ๊แวว/รายการสั่งก่อนถ่ายบิล เพื่อให้เอกสารผูก product_group และ order_item_ids
กดอ่านบิลใน flow ของ APK; ตรวจจำนวน/ราคา/การจับคู่ก่อนยืนยันรับสินค้า
งาน bridge นี้ยังไม่ได้ยืนยันผล OCR จากภาพจริงหรือการทำงานบนมือถือ USB

## เปิด emulator / ติดตั้ง APK

ต้องมี Java 17 ที่ `/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`
และ command-line tools เดิมที่ `/opt/homebrew/share/android-commandlinetools`
สคริปต์คัดลอกเครื่องมือเดิมลง SSD แล้วติดตั้ง package ใหม่ใน `cache/android/pilot-sdk`
เรียก Java entry point โดยส่ง argv โดยตรง เพื่อรองรับชื่อ SSD ที่มีช่องว่าง

```sh
sh pilot/android-emulator.sh
# หรือ APK ที่เจ้าของเลือก (absolute path)
sh pilot/android-emulator.sh '/absolute/path/receiving-debug.apk'
```

ค่าเริ่มต้น APK คือ
`/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-apk-codex/r2/receiving-debug.apk`
ตั้งเป้า Android 16/API 36/google_apis/arm64-v8a; ใช้ AVD `solao-receiving-api36`, serial `emulator-5580`
และ adb server แยกพอร์ต 5047 ไม่ใช้ default 5037
AVD, user prefs, SDK, data, temp/cache และ adb key ที่สร้างใหม่อยู่ใต้ `cache/android/`
ไม่มีการล้างข้อมูลแอป/AVD เก่า ไม่มี `--force` หรือ uninstall

**เมื่อ SDK ขอ license ใหม่ต้องหยุด**: input เป็น EOF ไม่ส่ง `yes` ไม่เรียก `--licenses`
คัดลอกเพียงไฟล์ `android-sdk-license` ที่ยอมรับไว้แล้ว
ผลที่บันทึกจากรอบก่อนขอ `android-sdk-arm-dbt-license`; สคริปต์จึงจะหยุดจนกว่าจะมีทางเลือก
package ที่อยู่ใน license เดิม หรือเจ้าของกำหนดขอบเขตเรื่อง license ใหม่แยกต่างหาก
งานนี้ไม่ได้ยอมรับ license เพิ่ม และไม่ได้เปลี่ยนไปใช้ image อื่นเอง

เมื่อเปิดแอปได้: กด **ตั้งค่า API** → ใส่ `http://10.0.2.2:<port>` ตามข้อความจาก server
**ไม่ใส่ `/api`** → เลือกสาขา/แผนก SYNTHETIC → เข้าสู่ระบบ → หน้ารับสินค้า
สคริปต์ติดตั้งและเปิด APK แต่การเลือก API/login ใน UI ทำเอง

ภาพหน้าจอเริ่มต้นใช้ `adb exec-out screencap -p` ลง
`reports/receiving-pilot/screens/`; ถ่ายซ้ำหลังทำ flow ในแอปได้ด้วย:

```sh
sh pilot/android-emulator.sh --screenshot
sh pilot/android-emulator.sh --stop
```

คำสั่ง stop ตรวจชื่อ AVD ก่อนปิด emulator เฉพาะ pilot; adb server แยกอาจยังทำงานอยู่
หากต้องปิด adb ของ pilot หลังเลิกใช้ทั้งหมด:

```sh
'/Volumes/SSD Files/SOLAO/market-order-system/cache/android/pilot-sdk/platform-tools/adb' -P 5047 kill-server
```

## มือถือ Android จริงใน Wi-Fi เดียวกัน

ติดตั้ง debug APK ที่เลือกผ่าน USB เช่น
`adb -s <serial-มือถือ> install -r '<absolute-APK-path>'` โดยใช้ adb/สภาพแวดล้อม SSD ของผู้ดูแล
หรือเปิดไฟล์ APK บนมือถือ เลือกอนุญาตติดตั้งตามขั้นตอนของ Android
เปิด server บน Mac และอนุญาต incoming Node ใน firewall หาก macOS แจ้ง
ใช้ IP ของ interface Wi-Fi จาก LAN URL ที่สคริปต์แสดง เช่น `http://192.168.1.10:8841`
ตั้งค่านี้ในแอปโดยไม่ใส่ `/api`; มือถือจริงไม่ใช้ `10.0.2.2`
ตรวจ `http://<IP Mac>:<port>/health` จากมือถือก่อน login หากเชื่อมไม่ได้ให้ตรวจ Wi-Fi/VPN/AP isolation/firewall
HTTP รองรับเฉพาะ debug/LAN; ใช้เครือข่ายภายในและข้อมูล SYNTHETIC เท่านั้น
ยังไม่ได้ทำการติดตั้งหรือทดสอบกับมือถือจริงรอบนี้

## Smoke API + ตรวจฐานข้อมูล

เปิดอีก terminal หลัง server แสดง ready และอย่าแก้ข้อมูลพร้อมกับ smoke:

```sh
sh pilot/smoke.sh
# กรณีหลาย session ระบุ ready.json ของ session ที่ต้องการ
sh pilot/smoke.sh '/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-pilot/<run-id>/ready.json'
```

ตรวจ instance/DB identity ก่อนเขียน → login สาขา 1/2 → expected → create UUID พร้อมกัน 2 คำขอ
→ รูป JPEG สมมติจริงจาก sips → download รูป → OCR mock → แก้ → เซ็นผู้รับ/ผู้ส่ง
→ confirm พร้อมกัน 2 คำขอ (200/409) → confirm ซ้ำ → void → void ซ้ำ
ตรวจ order quantity/price, inventory delta, alias row/event, audit และยอดหลัง void ผ่าน SQL
ทดสอบ 401 ทุก receiving route, 403 ข้ามสาขา, 422, 404 และสถานะ 409 ด้วย
session ไม่ลง log; ภาพ fixture/ผลสรุป pass/fail/skip อยู่ใน evidence directory บน SSD
void คืนยอดรับ/คลัง แต่ alias และประวัติยังอยู่ตาม source เดิม; ไม่ลบ audit/เอกสารที่ void
ถ้า assert ใดไม่ผ่านจะหยุดด้วย exit 1 และเก็บ `result.json`; ไม่แก้ข้อมูลทดสอบให้ผ่านเอง

## ตรวจซ้ำโดยไม่เปิด MySQL/emulator

```sh
sh pilot/start-server.sh --prepare-only
# คัดลอก prepared.json path จาก evidence ที่คำสั่งก่อนหน้าแสดง
node pilot/verify.mjs '/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-pilot/<run-id>/prepared.json'
```

ตัว verify รัน regression เดิมกับ pilot tests รอบละสองครั้งจาก snapshot เดียวกัน
ทุก log/cache/temp อยู่ SSD และ exit 1 เมื่อมี fail/skip หรือไม่พบจำนวน tests
ไม่ถือว่าทดแทน MySQL smoke, emulator UI, JWT security หรือเกณฑ์ AGENTS.md ทั้งหมด
ปิด server/emulator เมื่อเสร็จ; เก็บ run/log หลักฐานไว้ ไม่มีการลบอัตโนมัติ


### SYNTHETIC accounting (รอบ D)

ทั้ง default/jae-waew seed เพิ่มแผนก 3 "SYNTHETIC บัญชี" ในสาขา 1 และ user 3 role accounting (active) มีเฉพาะ schema/seed pilot ใหม่ เลือกสาขา 1 → บัญชี หรือ POST /api/auth/login {"departmentId":3} เพื่อทดสอบหน้า /admin/receiving และ /admin/receiving/issues ใช้ session RAM เดิม ไม่ต้องมีรหัสผ่าน/คีย์ role จาก client ไม่มีผล ผู้รับ 1/2 ยังเป็น user และถูกจำกัดสาขาเหมือนเดิม ไม่มีการเปลี่ยน Production auth
