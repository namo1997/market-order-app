# Android debug รอบ 3 — รับสินค้า โซลาว

APK ใช้ entry `client/receiving.html` → `src/receiving-app/main.jsx` และหน้า
`pages/receiving/Receiving.jsx` ชุดล่าสุดร่วมกับเว็บ รวมภาพประกอบ 10 สถานะ
กล้อง native ถูก inject ด้วย Vite adapter; เว็บยังใช้ file input ตามเดิม
API และ auth context ของ APK ใช้ adapter แยกจาก client/auth ของเว็บหลัก

## Build บน SSD

ใช้ผลตรวจ SSD ที่เจ้าของให้เมื่อ 16 ต.ค. 2569 เวลา 00:03:38 rc=0
UUID `AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B` ตามคำสั่งไม่ตรวจซ้ำ

```sh
SOLAO_SSD_VERIFIED_UUID=AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B scripts/build-apk-on-ssd.sh
```

สคริปต์ตรวจเพียง mount ที่ยังอยู่และพื้นที่ว่าง ≥5 GiB จากนั้นคัดลอก source
ไป snapshot ใหม่บน SSD โดยตัด `.git`, environment files, credential files,
dependencies และ output เก่าออก รัน `npm ci` ฝั่ง server/client,
server tests ทั้งหมดและ client/adapter/Google tests ทั้งหมดอย่างละ 2 รอบ,
Vite receiving build, Capacitor sync, Gradle `assembleDebug`, aapt2 และ apksigner
ไม่มีการเรียก SSD check/diskutil จากสคริปต์นี้

ทุก snapshot, dependency, cache, temp, debug signing และ build output อยู่บน SSD
ผลส่งมอบอยู่ที่ `/Volumes/SSD Files/SOLAO/market-order-system/reports/receiving-apk-codex/r3/`:

- `receiving-debug.apk` — versionName `0.3.0-debug`, versionCode `3`
- `receiving-debug.apk.sha256` และ `apk-badging.txt`
- `latest-run.txt` — snapshot และ log ที่ใช้ build

ใช้ JDK 17, Gradle 8.11.1, Capacitor 7.4.3, Android SDK 36 ที่ติดตั้งไว้
ห้ามดาวน์โหลด SDK/ยอมรับ license เพิ่ม ไม่มี release keystore
Java locale en_US ป้องกันปี พ.ศ. เกินช่วง ZIP timestamp; วันในแอปใช้ Asia/Bangkok
AGP 8.7.2 มี warning ว่าทดสอบถึง compileSdk 35; ต้องทบทวนก่อนเปลี่ยน toolchain
debug variant ใช้ R8 และ `debuggable false` เพื่อ strip native credential logs
APK นี้ยังเป็น build สำหรับทดลองภายในและลงชื่อด้วย standard debug signing

## เลือกโหมดเข้าสู่ระบบจากค่า build

โค้ดชุดเดียวเลือกด้วย `VITE_RECEIVING_AUTH_MODE`:

| ค่า | พฤติกรรม |
| --- | --- |
| `auto` หรือไม่กำหนด | มี `VITE_GOOGLE_WEB_CLIENT_ID` ที่ไม่ว่าง → Google; ไม่มี → pilot |
| `google` | ต้องมี Web OAuth client ID ไม่เช่นนั้น build ล้มเหลว |
| `pilot` | เลือกสาขา/แผนกสำหรับทดลองภายใน พร้อมป้าย DEBUG · PILOT |

ส่งค่าผ่าน environment ของคำสั่ง build เท่านั้น ไม่สร้างหรืออ่าน environment files
ใน worktree นี้ ค่า Web OAuth client ID เป็น public configuration; ห้ามใส่ client secret
ไม่มีการสลับโหมดจาก runtime UI หรือ fallback เป็น pilot เมื่อ Google login ล้มเหลว
Vite ตัด UI อีกโหมดออกจาก bundle ที่ build

Google ใช้ SocialLogin plugin ฝั่ง Android ผ่าน Credential Manager แล้วส่ง ID token
ไป `/api/auth/google`; เซิร์ฟเวอร์เป็นผู้ตรวจบัญชีและกำหนด user/branch/department
ล้าง provider credentials หลังแลก session และเก็บ session เฉพาะ memory
การ login Google จริงยังต้องทดสอบบน Android ที่ตั้งค่า OAuth/บัญชีอนุญาตแล้ว

Pilot อ่าน `/api/auth/branches` และ `/api/auth/departments/:branchId` แล้วส่ง
`{ departmentId }` ไป `/api/auth/login` ตามสัญญาเดิม ไม่มี user จำลองในแอป
เปลี่ยนสาขาแล้วล้างแผนก ทิ้ง response เก่า ล็อก submit ซ้ำ และล็อกการเปลี่ยน API
ระหว่าง login สิทธิ์ทั้งหมดมาจากเซิร์ฟเวอร์ โหมดนี้ใช้ทดลองภายในกับเซิร์ฟเวอร์ทดสอบ

## ทดลองใช้งาน

1. ติดตั้ง APK บน Android 6 (API 23) ขึ้นไป
2. ตั้งค่า origin ของ API ทดสอบ เช่น `http://192.168.1.10:3000` ไม่เติม `/api`
3. เข้าด้วย Google หรือเลือกสาขา/แผนกตามโหมดที่ build
4. ใช้หน้ารับสินค้า: สร้างใบรับ → ถ่ายบิล → ส่งรูป → OCR → ตรวจรายการ → เซ็น → ยืนยัน
5. ตรวจสถานะเอกสารและทดลอง void พร้อมเหตุผลบนข้อมูลทดสอบ

กล้องใช้ Capacitor Camera, ขอสิทธิ์กล้อง และไม่บันทึกรูปลง gallery
รูปยังผ่าน compression/validation/upload pipeline เดียวกับเว็บ
OCR ใช้เซิร์ฟเวอร์; ชุดเทสต์ใช้ mock provider เท่านั้น

Native API ใช้ CapacitorHttp; เว็บใช้ fetch มี timeout และไม่ตาม redirect
401/ออกจากระบบ/เปลี่ยน API ล้าง memory session; Preferences เก็บเฉพาะ API origin
manifest หลักปฏิเสธ cleartext; `src/debug/` อนุญาต HTTP สำหรับ LAN ทดสอบ
ไม่มี durable offline queue: ข้อมูลที่ยังไม่ส่งอาจหายเมื่อปิดแอป

## ไอคอนและ splash

ใช้ PNG จาก `client/src/assets/brand/android/` ครบทุก density ตาม README brand
legacy/round launcher ใช้รูปเต็ม ส่วน Android 8+ ใช้ adaptive foreground/background
native splash ใช้ `splash_icon` 288dp และ night-qualified asset;
พื้น light `#F7F5F0`, night `#101522` ผ่าน DayNight theme
ใช้ native SplashScreen API ทั้งก่อน/หลัง Android 12 ไม่ใช้ full-screen master แบบ cover
ตรวจ bytes/resources ในเทสต์และ APK แล้ว; mask/crop/rotation/กล้องและ OAuth จริง
ยังต้องตรวจบนอุปกรณ์ Android
