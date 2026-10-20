# ตั้งค่า Google (Gmail) Login — เว็บและแอปรับสินค้า

คู่มือเจ้าของ · 15 ตุลาคม 2569 · โค้ดรอบนี้เป็น Local ยังไม่ได้ deploy หรือเปิดบัญชีจริง

ภาพประกอบด้านล่างเป็นคำอธิบายตำแหน่งบนหน้าจอ ไม่ใช่ภาพหน้าจอจากบัญชีจริง ชื่อเมนู Google อาจต่างเล็กน้อยตามภาษา

## 1. สร้างโปรเจกต์และหน้าขออนุญาต

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชีเจ้าของ
2. กดชื่อโปรเจกต์ด้านบน → **New project** → ตั้งชื่อ เช่น “SOLAO Receiving” → เลือกโปรเจกต์นี้
3. ค้นหา **Google Auth Platform** แล้วเปิด **Branding** (หน้ารุ่นเก่าอยู่ที่ APIs & Services → OAuth consent screen)
4. กรอกชื่อแอป “รับสินค้า โซลาว”, อีเมล support และอีเมลผู้ติดต่อของเจ้าของจริง
5. ไป **Audience** เลือกประเภทดังนี้:
   - **Internal** ใช้เมื่อโปรเจกต์อยู่ในองค์กร Google Workspace และพนักงานทั้งหมดใช้บัญชีองค์กรนั้น
   - **External** ใช้เมื่อมี Gmail ส่วนตัวของพนักงาน ให้เลือกแบบนี้สำหรับการใช้งาน Gmail ทั่วไป
6. ถ้าหน้าจอมี **Test users** ในสถานะ Testing ให้เพิ่มอีเมลที่จะทดลอง เปิดใช้จริงภายหลังตามข้อกำหนดที่ Console แสดง
7. ใช้เพียงข้อมูลเข้าสู่ระบบพื้นฐาน `openid`, `email`, `profile`; งานนี้ไม่ขออ่าน Gmail หรือ Google Drive

**ภาพด้วยคำ:** แถบซ้ายมี Overview / Branding / Audience / Clients / Data Access → เลือก Audience → ด้านขวาเห็น Internal หรือ External และสถานะการเผยแพร่

## 2. สร้าง OAuth client แบบ Web application

1. ในโปรเจกต์เดิม ไป **Clients → Create client** (หรือ Credentials → Create credentials → OAuth client ID)
2. Application type เลือก **Web application** ตั้งชื่อ “SOLAO Receiving Web Test”
3. ที่ **Authorized JavaScript origins** ใส่ origin ที่เปิดเว็บจริง เช่น `http://localhost:5173` และ `http://127.0.0.1:5173` หากใช้ทั้งสองแบบ
4. ถ้าพอร์ตต่างจากตัวอย่าง ให้ใส่พอร์ตที่ใช้จริง ห้ามต่อ `/login` หรือ `/api` ในช่อง origin
5. เมื่อเปิด Production ภายหลัง ให้สร้าง Web client แยกสำหรับ Production และใส่ origin HTTPS ของโดเมนจริง ไม่ใส่ localhost ใน client Production
6. Flow นี้รับ credential ผ่าน callback JavaScript จึงไม่ต้องเพิ่ม redirect URI สำหรับ `/api/auth/google`
7. กด Create → คัดลอก **Client ID** ไปเก็บในตัวจัดการค่าของระบบตามข้อ 4

**ภาพด้วยคำ:** ฟอร์ม Web application → กล่อง “Authorized JavaScript origins” → ปุ่ม Add URI → หนึ่งบรรทัดต่อ origin → หลัง Create มีกล่อง “Client ID” ที่ลงท้าย `.apps.googleusercontent.com`

ดูขั้นตอนและการอนุญาต script จาก [Google Identity Services Setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) และการแยก client Production จาก [Google Production Readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)

## 3. สร้าง OAuth client แบบ Android

1. ใช้โปรเจกต์ Google Cloud เดียวกับ Web client
2. Clients → Create client → Application type **Android** → ชื่อ “SOLAO Receiving Android Debug”
3. ช่อง Package name ใส่ `th.co.solao.receiving`
4. ช่อง SHA-1 certificate fingerprint ใส่ debug SHA-1 ที่เจ้าของให้:

   `EC:DC:48:96:E3:DE:D2:EF:CA:77:5B:0D:CD:93:2F:26:01:69:B0:B0`

5. กด Create เก็บ Android Client ID ไว้สำหรับ server allowlist ของ audience ตามข้อ 4
6. เมื่อทำ release ให้เพิ่ม Android client อีกตัวด้วย package เดิมและ SHA-1 จาก **keystore ที่เซ็น release จริง** ภายหลัง หากเผยแพร่ผ่าน Play ต้องลงทะเบียน SHA-1 ของ Play App Signing ด้วย
7. แอปส่ง **Web Client ID** ให้ Credential Manager เพื่อให้ออก ID token ที่ `aud` เป็น Web Client ID; Android Client ID ใช้ลงทะเบียน package/ลายเซ็นใน Google Console

**ภาพด้วยคำ:** ฟอร์ม Application type = Android → Package name → SHA-1 certificate fingerprint → Create; อย่านำ Android Client ID ไปวางในช่อง build ของแอป

เลือก `@capgo/capacitor-social-login` รุ่น `7.20.0`: รองรับ Capacitor 7 ที่โครงการใช้และเรียก Credential Manager โดยไม่ต้องตั้ง Firebase Authentication ดู [คู่มือผู้พัฒนา Capgo](https://capgo.app/docs/plugins/social-login/google/android/) โค้ดมี native activity callback สำหรับหน้าขออนุญาตแล้ว และปิด provider อื่น

## 4. ใส่ค่าที่ไหน

ห้ามใส่ค่าจริงลง Git หรือสร้าง `.env` ในงานนี้ ให้เจ้าของใส่ผ่าน environment ของ process/build หรือหน้าตั้งค่า environment ของบริการเมื่ออนุมัติ release ภายหลัง

| ที่ตั้ง | ชื่อตัวแปร | ค่าที่ใช้ |
|---|---|---|
| Server process | `GOOGLE_OAUTH_CLIENT_IDS` | Web Client ID และ Android Client ID คั่นด้วยจุลภาค; เพิ่ม Web client อื่นที่ใช้ทดสอบแยกไว้ด้วย |
| เว็บ ก่อน build | `VITE_GOOGLE_WEB_CLIENT_ID` | Web Client ID ของ environment นั้น |
| APK ก่อน `npm run build:receiving` | `VITE_GOOGLE_WEB_CLIENT_ID` | Web Client ID จากโปรเจกต์เดียวกับ Android client |
| Server process เดิม | `JWT_SECRET` | ใช้ค่าลับเดิมของระบบ ต้องมีค่าจริงที่ปลอดภัยก่อน release |

Client ID เป็น public identifier ที่อยู่ใน browser/APK ได้ แต่โครงการนี้รับจาก build และไม่ฝังค่าเฉพาะบัญชีลง source ส่วน Client Secret ไม่ใช้กับ flow นี้

หลังตั้งค่า server ให้ restart process ตาม workflow release ที่ได้รับอนุมัติ หลังเปลี่ยน `VITE_...` ต้อง **build ใหม่** เว็บซ่อนปุ่ม Google เมื่อไม่ได้ตั้งค่า; APK จะแสดงข้อความให้ผู้ดูแลตั้งค่าและปิดปุ่ม ไม่ย้อนกลับไป login แบบเลือกแผนก

Android build บนสำเนา SSD: ตั้ง `VITE_GOOGLE_WEB_CLIENT_ID` ใน build environment → `npm ci --no-audit --no-fund` → `npm run build:receiving` → `npx cap sync android` → Gradle build โดยใช้ SSD tmp/cache/keystore ตาม `scripts/build-apk-on-ssd.sh` ห้าม deploy จากสำเนาจำลอง

ต้องคง `loggingBehavior: none`, minify debug/release และกฎตัด `android.util.Log` เพราะ dependency อาจ log วัตถุ credential โดย variant debug รอบนี้ตั้ง `debuggable false` เพื่อให้ R8 optimize และตัด log ได้จริง จึงใช้แนบ debugger ไม่ได้ ห้ามแก้เป็นตัวอย่างที่พิมพ์ผล login ลง console; แอปส่งเฉพาะ ID token ไป server และเคลียร์ credential cache ของ plugin หลังรับผล

## 5. เพิ่มอีเมลพนักงาน

Google ยืนยันตัวตน ส่วน SOLAO กำหนดสิทธิ์: อีเมลหนึ่งผูกกับ **ผู้ใช้เดิมหนึ่งคน** สาขาและแผนกมาจาก users/departments เดิม ไม่รับ role/branch ที่ client ส่งมา ไม่สร้างผู้ใช้อัตโนมัติ

### ผ่าน admin API

ใช้ session admin/super_admin ของระบบเดิมผ่าน HTTPS โดยไม่พิมพ์ token ลง log:

| การทำงาน | Endpoint | JSON body |
|---|---|---|
| ดูรายชื่อ | `GET /api/auth/google-accounts` | ไม่ต้องส่ง |
| เพิ่มอีเมล | `POST /api/auth/google-accounts` | `{ "email": "staff@example.com", "user_id": 7, "department_id": 4 }` |
| ปิดอีเมล | `POST /api/auth/google-accounts/disable` | `{ "email": "staff@example.com" }` |

ตัวเลขและอีเมลข้างบนเป็นตัวอย่าง ต้องเลือก user ID และ department ID ที่มีอยู่จริง `department_id` จะละได้ แต่ถ้าส่งมาต้องตรงผู้ใช้ Server บันทึก `created_by` จาก session admin เอง

ตารางใหม่ `user_google_accounts` สร้างแบบ `CREATE TABLE IF NOT EXISTS` เมื่อใช้ store ครั้งแรก เป็น additive ไม่แก้ users เดิม ก่อน release ต้องตรวจชนิด `users.id`/สิทธิ์ DDL ในฐานจริงตาม workflow migration ของเจ้าของ งานนี้ไม่ได้แตะฐานจริง

อีเมลถูก trim และทำตัวเล็ก อีเมลซ้ำตอบ 409; การปิดซ้ำสำเร็จโดยไม่ลบข้อมูล รุ่นนี้ยังไม่มี API เปิดกลับหรือย้าย mapping ของอีเมลที่มีอยู่ ให้ผู้พัฒนาทำขั้นตอนที่มี audit ก่อนเปิดกลับ

### สคริปต์สำหรับฐาน local เท่านั้น

เปิด environment ของฐานจำลองที่ตรวจแล้วเป็น local กำหนด `DB_HOST` ชัดเจนเป็น `127.0.0.1`, `localhost` หรือ `::1` พร้อม `DB_PORT`, `DB_USER`, `DB_NAME` และค่าลับผ่าน process environment เท่านั้น สคริปต์ไม่โหลด `.env` และปฏิเสธ `NODE_ENV=production`/host อื่น

รันจาก `server` ของสำเนา SSD:

```sh
node scripts/google-accounts.mjs list
node scripts/google-accounts.mjs add staff@example.com 7 1 4
node scripts/google-accounts.mjs disable staff@example.com
```

คำสั่ง add เรียง `EMAIL USER_ID ADMIN_ID [DEPARTMENT_ID]` โดย ADMIN_ID ต้องเป็น admin ที่ active ในฐาน local ห้ามนำสคริปต์ไปเชื่อม tunnel หรือ port forward ไปฐานจริง

## 6. ทดลองและแก้ปัญหา

1. เพิ่ม Gmail ทดลองใน SOLAO allowlist และใน Google Test users หากหน้า Console กำหนด
2. เว็บ: เปิด origin ที่ลงทะเบียน → เห็นปุ่ม “เข้าสู่ระบบด้วย Google” → เลือกบัญชี → เข้าหน้าระบบและตรวจสาขา/แผนก
3. Android: ติดตั้ง APK ที่เซ็นตรง SHA-1 → ตั้ง API ของระบบทดสอบที่ไว้ใจได้ (ใช้งานจริงต้อง HTTPS) → กด Google → เลือกบัญชี → ตรวจสาขา/แผนก
4. ทดลองบัญชีที่ไม่อยู่ allowlist ต้องเข้าไม่ได้ และปิดอีเมลแล้วทดลอง login ใหม่ต้องเข้าไม่ได้
5. Google origin error: เทียบ scheme/host/port กับ Web client; Android เลือกบัญชีแล้วล้มเหลว: เทียบ package + SHA-1 + Web client/project
6. HTTP 403 `GOOGLE_ACCOUNT_NOT_ALLOWED`: ยังไม่เพิ่มอีเมล, ปิด mapping หรือ users เดิมไม่ active
7. HTTP 401 `INVALID_GOOGLE_TOKEN`: token ผิด/หมดอายุ/ยังไม่ยืนยัน email หรือ audience ไม่ตรง
8. HTTP 422 `INVALID_ID_TOKEN`: ไม่ส่ง `id_token` หรือส่งรูปแบบ/ขนาดผิด
9. HTTP 503 `GOOGLE_AUTH_NOT_CONFIGURED`: server ไม่มี client IDs; `GOOGLE_AUTH_UNAVAILABLE`: JWKS timeout/ฐานข้อมูลยังไม่พร้อม ให้ดูสถานะระบบโดยไม่ log request token
10. HTTP 429 `GOOGLE_LOGIN_RATE_LIMITED`: รอตาม `Retry-After`; จำกัด 10 ครั้ง/IP/นาทีต่อ process ปัจจุบันต้องทบทวน reverse proxy และ shared limiter ก่อนขยายหลาย instance

Server ตรวจ RS256 ด้วย JWKS ของ Google ที่ URL คงที่, audience ใน allowlist, issuer, expiry, subject และ `email_verified === true` ดู [Google token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

**ข้อจำกัดก่อนเปิดจริง:** login เว็บเดิมยังเลือก user/department เพื่อออก JWT ได้โดยไม่มีรหัสผ่านตามคำสั่งเจ้าของ จึงยังสามารถข้าม Google ทาง endpoint เดิมและเข้าบทบาท admin ตามบัญชีเดิมได้ การทำ Google รอบนี้ไม่ได้ทำให้ระบบโดยรวมบังคับ Google ต้องออกแบบปิดช่องเดิมแยกก่อนอ้างว่าระบบปลอดภัยด้วย Google ทั้งหมด นอกจากนี้ disable อีเมลหยุดเฉพาะ login ครั้งถัดไป JWT ที่ออกแล้วใช้ได้ถึงหมดอายุตามระบบเดิม และยังต้องทดสอบบัญชีจริงบนเว็บ/เครื่อง Android หลังตั้ง Console
