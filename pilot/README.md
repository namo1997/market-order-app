# Pilot ภายใน — ข้อมูล SYNTHETIC เท่านั้น

สคริปต์ชุดนี้เปิด receiving API ของ source ปัจจุบันบนสำเนา SSD และ MySQL ใหม่แบบ socket-only
ไม่ได้เปิด market-order server เต็มระบบ ไม่มี cron, Railway, LINE, OpenAI หรือฐาน Production
สร้าง source ใหม่เฉพาะ `pilot/`; ไม่แก้ server/client/APK และไม่สลับ branch

ใช้ผลตรวจ SSD จาก Claude วันที่ 2026-10-15 22:47:54 rc=0, UUID
`AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B` ตามคำสั่งเจ้าของ ไม่เรียก diskutil หรือ ssd-workspace
สคริปต์ตรวจเพียงว่ายังเข้าถึง mount และเขียน path ที่อยู่บน device นั้นได้ โดยไม่สร้าง mount ทดแทน
ถ้า SSD หลุดให้หยุด และให้ผู้ดูแลตรวจ identity อีกครั้งก่อนเปิดใหม่

## สถานะที่ลองจริง

- สำเนา SSD และ dependencies เตรียมได้; pilot tests 4/pass 4/fail 0/skip 0 สองรอบ
- regression tests ของ snapshot: 137/pass 127/fail 10/skip 0 สองรอบ
  10 failures เป็น `Unexpected specifier: ./receiving-documents-alias.js` ใน harness เดิม
  ไม่ได้แก้/ลดความเข้มเทสต์ เพราะงานนี้อนุญาต source ใหม่เฉพาะ pilot/
- MySQL 9.5.0 ที่ติดตั้งอยู่เกิด signal 11 ระหว่าง initialization (rc=2) ใน environment นี้
  ยังไม่ได้พิสูจน์ว่าเป็น sandbox หรือ binary; ไม่มีการลองใช้ DB อื่น
- SDK image `system-images;android-36;google_apis;arm64-v8a` ที่ repository เสนอจริงขอ
  **`android-sdk-arm-dbt-license` เพิ่ม** จึงหยุดโดยไม่ยอมรับ license
  ยังไม่สร้าง AVD/ติดตั้ง APK/ถ่าย screenshot และยังไม่ได้รัน HTTP+DB smoke

ผลและ log อยู่ที่ `/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-pilot/REPORT.md`
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

receiving router/controller/models และ inventory/settlement ใช้ source เดิมบน snapshot
เปลี่ยนเพียง database/auth adapter ผ่าน VM loader; ไม่ import `src/server.js` หรือ dotenv
OCR ลงทะเบียน `setCustomOcrProvider` ก่อนเปิด HTTP และปิด outbound fetch/http/https ใน source context
ทุกภาพให้คำตอบสมมติหนึ่งบรรทัด: รับ 2.50 กก. ราคา 10.00 รวม 25.00
ไม่ได้อ่านภาพจริง; เลือกสินค้าจาก expected รายการแรกที่ผูก หรือให้ผู้ใช้ผูกสินค้าเอง
metadata/catalog endpoints เป็น read-only adapter สำหรับ receiving UI; ไม่เปิด route ของระบบอื่น

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
ผลที่ตรวจจริงรอบนี้ขอ `android-sdk-arm-dbt-license`; สคริปต์จึงจะหยุดจนกว่าจะมีทางเลือก
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
