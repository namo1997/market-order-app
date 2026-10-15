# Android debug — รับสินค้า โซลาว

โครงนี้ใช้ React/dependencies ของ `client/` แต่มี entry แยก `client/receiving.html`
→ `client/src/receiving-app/main.jsx` → `dist-receiving/index.html` สำหรับ Capacitor เท่านั้น
เว็บหลักยังใช้ `index.html` และ `npm run build` ตามเดิม

## Build บน SSD

ใช้ผล SSD verification ล่าสุดที่ยืนยัน volume UUID ถูกต้องก่อนรัน และหยุดถ้า SSD ไม่พร้อม
รอบ 15 ต.ค. 2569 ใช้ผล Claude เวลา 21:17:23 rc=0 ตามคำสั่งเจ้าของ โดยไม่รัน check/diskutil ซ้ำ

```sh
SOLAO_SSD_VERIFIED_UUID=AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B scripts/build-apk-on-ssd.sh
```

สคริปต์ตรวจว่า mount ยังอยู่และมีพื้นที่เกิน 5 GiB จากนั้น rsync source ไป snapshot
ใหม่ใต้ `/Volumes/SSD Files/SOLAO/market-order-system/runs/apk-build/` แล้วทำ
`npm ci`, เทสต์ adapter, Vite build, `cap sync android`, `assembleDebug`, ตรวจ APK และ SHA-256
ทุก dependency/cache/temp/build/APK อยู่ SSD; ห้าม build ใน worktree โดยตรง
ผลสุดท้ายอยู่ `reports/receiving-apk-codex/receiving-debug.apk` พร้อม `.sha256`
และ `latest-run.txt` ชี้ไปยัง build log ของ snapshot ล่าสุด

ใช้ JDK 17 ที่เจ้าของกำหนด, Gradle 8.11.1, Capacitor 7.4.3 และ Android platform 36
ที่ติดตั้งอยู่แล้ว ไม่มีการดาวน์โหลด SDK/ยอมรับ license เพิ่ม
`android/build.gradle` override Java target เป็น 17 หลัง config ของ Capacitor ทุก module
เพราะ template Capacitor 7 ตั้ง Java 21; ต้องทบทวน override เมื่ออัปเกรด Capacitor
กำหนด Java locale en_US เฉพาะ build เพื่อเลี่ยงปี พ.ศ. เกินช่วง ZIP DOS timestamp
ส่วนวันในแอปคำนวณด้วย Asia/Bangkok
มีเพียง standard debug keystore ที่สร้างบน SSD ไม่มี release keystore

## ทดลองใช้งาน

1. ติดตั้ง APK debug บน Android 6 (API 23) ขึ้นไป
2. เปิด “ตั้งค่า API” ใส่ origin ของเซิร์ฟเวอร์ทดสอบ เช่น `http://192.168.1.10:3000`
   ไม่เติม `/api`; ค่าเริ่มต้นว่าง เก็บเฉพาะ URL ใน Preferences
3. เลือกสาขาและแผนก → เข้าสู่ระบบผ่าน `/api/auth/login` ด้วย `{ departmentId }` ตามระบบเดิม
4. หน้า “รายการรับของวันนี้” อ่าน `GET /api/receiving-documents/expected?date=YYYY-MM-DD`
   แสดงผู้ขาย/รายการ/จำนวนสั่ง/รับแล้ว โดยคง decimal string ตาม API
5. ทดลองถ่ายบิล: Android ใช้ Camera plugin และขอสิทธิ์กล้อง; เว็บใช้ input capture
   รูปเป็น preview เท่านั้น ยังไม่อัปโหลด ไม่เรียก OCR/confirm/void

Native API ใช้ `CapacitorHttp.request` จึงไม่พึ่ง CORS ของ WebView;
บนเว็บใช้ fetch จึงต้องให้เซิร์ฟเวอร์ทดสอบอนุญาต CORS ถ้าใช้คนละ origin
มี timeout 15 วินาทีและไม่ตาม redirect, bearer อยู่เฉพาะ memory,
401/ออกจากระบบ/เปลี่ยน API ล้าง session; ปิดแอปแล้ว login ใหม่
API URL ที่เป็น HTTP ใช้สำหรับ debug LAN ที่ไว้ใจได้เท่านั้น
manifest หลักปฏิเสธ cleartext; manifest และ network security config ใน `src/debug/` เปิดเฉพาะ debug
การเชื่อม API จริง/กล้องจริงยังต้องตรวจบนอุปกรณ์ Android

## จุดรวมหน้า receiving หลัง merge

แทนที่ placeholder `ReceivingApp` ใน `src/receiving-app/main.jsx` ด้วยหน้าที่ merge เข้ามา
โดยคง entry และ `vite.receiving.config.js` แยกจากเว็บหลัก
อย่านำ fallback API URL ของเว็บหลักหรือ debug log ของ auth เดิมเข้ามาใน APK
adapter `api.mjs` ใช้สัญญา auth/API เดิม แต่แยก transport เพื่อรองรับ URL ที่ผู้ใช้ตั้งค่า
และ native HTTP โดยไม่เก็บ session ใน Preferences/localStorage
ยังไม่มีสาขา/แผนกแบบ admin override, LINE super-admin login, offline queue,
OCR, signature, confirm/void หรือประวัติใน prototype นี้
