# ตั้งค่าแจ้งเตือนรับสินค้า Android แบบฟรี

เลือก **Firebase Cloud Messaging (FCM)** เป็นหลัก เพราะส่ง data message ถึงแอปที่อยู่เบื้องหลังได้ และ FCM ไม่มีค่าใช้บริการ ใช้เซิร์ฟเวอร์เดิมส่งตรง ไม่ใช้ Cloud Functions, LINE, Discord หรือบริการอื่น เมื่อยังไม่ตั้งค่า FCM แอปใช้ WorkManager ดึงข้อมูลทุก **อย่างน้อย 15 นาที** ไม่ต้องมีคีย์

APK ที่ build โดยไม่มี config ใช้สำรองได้ทันทีหลังเข้าสู่ระบบด้วยบทบาทบัญชี/ผู้ดูแลและเปิดสิทธิ์แจ้งเตือน ต้องใช้ API แบบ HTTPS และ server รุ่นนี้พร้อมตารางตามด้านล่าง

## 1. เจ้าของสร้างโปรเจกต์เอง

1. เข้า [Firebase Console](https://console.firebase.google.com/) ด้วยบัญชีของเจ้าของ กด **Add project / Create a project** ตั้งชื่อ เช่น SOLAO Receiving
2. ใช้แพ็กเกจ **Spark (ไม่มีค่าใช้จ่าย)** ไม่ต้องเพิ่มบัตร ไม่ต้องเปิด Analytics, Cloud Functions, Firestore หรือ Storage สำหรับงานนี้
3. ใน Project overview กดเพิ่มแอป **Android** กรอก package name **`th.co.solao.receiving`** ให้ตรงทุกตัว ชื่อเล่นเลือกได้
4. ดาวน์โหลด **google-services.json** เก็บไว้ในโฟลเดอร์ส่วนตัวที่อยู่นอก repository บน SSD อย่าใส่ไฟล์ใน `client/android/app/` อย่าส่งไฟล์ทางแชตหรือใส่ในรายงาน
5. Project settings → Cloud Messaging ตรวจว่า **Firebase Cloud Messaging API (V1)** เปิดแล้ว ถ้ามีลิงก์ Manage API ให้เปิด API ของโปรเจกต์นี้ ไม่ต้องเปิด Legacy API
6. Project settings → Service accounts → Firebase Admin SDK → **Generate new private key** ให้เจ้าของเป็นผู้กดเอง เก็บ JSON ที่ดาวน์โหลดในพื้นที่ส่วนตัวนอก git และจำกัดสิทธิ์เฉพาะบัญชีรัน server ไฟล์นี้เป็นความลับ ห้ามใส่ใน APK
7. งานนี้ไม่ต้องเพิ่ม SHA สำหรับ FCM ส่วน Google Sign-In ยังคงใช้การตั้งค่าเดิมแยกกัน

## 2. ตั้ง Android ตอน build ที่ได้รับอนุมัติ

ตั้งตัวแปร **`RECEIVING_GOOGLE_SERVICES_FILE`** เป็น absolute path ของ google-services.json ภายนอก repository แล้ว build ตาม workflow SSD เดิม Gradle อ่านไฟล์จาก path นี้โดยตรงและสร้าง Android resources เท่านั้น ไม่คัดลอก JSON เข้าซอร์ส

- ไม่มีตัวแปร: ไม่ apply Google Services plugin, Firebase initialize ไม่ได้ → ใช้ WorkManager สำรอง
- อย่าใส่ service account JSON หรือ private key ในตัวแปรฝั่ง client, `VITE_*`, Android resources หรือ APK
- ไม่ต้องเปลี่ยนเลข package หรือสร้าง Firebase project เพิ่มต่ออุปกรณ์
- การ build ของรอบนี้ไม่มี config และไม่มีคีย์จริง จึงยังไม่ใช่ APK ที่เปิด FCM แล้ว

## 3. ตั้งเซิร์ฟเวอร์ตอน release ที่ได้รับอนุมัติ

1. สำรองและตรวจสภาพแวดล้อมตาม workflow release เดิมก่อน เจ้าของ/operator ต้องอนุมัติ release และ migration แยกจากงาน Local นี้
2. เตรียมตาราง follow-up เดิม และรัน **`node scripts/migrate-receiving-push.js`** จากโฟลเดอร์ server ในสภาพแวดล้อมที่เลือกแล้ว สร้างเฉพาะ `receiving_push_devices` / `receiving_push_deliveries` ด้วย `CREATE TABLE IF NOT EXISTS` ไม่ ALTER ตาราง order/inventory
3. เก็บ service account JSON เป็นไฟล์ที่อ่านได้เฉพาะ process server **นอก git** แล้วตั้ง **`RECEIVING_FCM_SERVICE_ACCOUNT_FILE`** เป็น absolute path ของไฟล์นั้นผ่านตัวจัดการ secret ของสภาพแวดล้อม ไม่ใส่เนื้อหา JSON ลงซอร์สหรือ log
4. Restart server ตาม workflow ที่อนุมัติ ตัวส่งตรวจทุก 60 วินาที จึงมีเวลารอตรวจได้ประมาณหนึ่งนาทีก่อนส่ง FCM
5. ไม่มีตัวแปรนี้ = ไม่อ่าน credential / ไม่เรียก FCM / ไม่ส่งข้อความ การสร้าง follow-up และสำรอง WorkManager ยังทำงาน; ถ้าไฟล์มีปัญหา sender เลื่อนส่งและ retry สูงสุด 3 ครั้งต่อเรื่อง/อุปกรณ์ ไม่แสดง provider error หรือ token ใน log
6. ตรวจข้อมูล role และ department ของผู้ใช้จริง: รับเฉพาะ `accounting`, `accountant`, `admin`, `super_admin` ที่ active และสาขาตรงกับเรื่อง ไม่ส่งให้ admin ของสาขาอื่น อุปกรณ์ต้องลงทะเบียนใหม่อย่างน้อยทุก 30 วัน (แอปทำให้ทุกครั้งที่ sync)

Production ไม่ auto-create ตารางเมื่อ `AUTO_ENSURE_RECEIVING_TABLES` ไม่ได้ opt in อย่าเปิด flag นี้เพื่อข้าม workflow migration

## 4. เปิดใช้งานบนมือถือ

1. ติดตั้ง APK ที่ build ด้วย config ของโปรเจกต์นี้ เข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์
2. อนุญาตแจ้งเตือน Android ด้วยคำขอสิทธิ์เดิม เปิดช่อง **เรื่องด่วนรับสินค้า** และทดสอบเสียงผ่านเมนูแอป
3. ในการตั้งค่า Android ตรวจว่าเปิดเสียง/ความดังแจ้งเตือน และระบบไม่ได้ปิด channel, DND หรือจำกัดแบตเตอรี่แอป
4. ให้ผู้ใช้สาขาเดียวกันสร้างเรื่องตามของ ทดสอบขณะสลับไปแอปอื่น/ดับหน้าจอ และลองเรื่องเลยกำหนด เสียง `question_003` ใช้ `FLAG_INSISTENT` ช่องเดิม แตะแจ้งเตือน/รับทราบแล้วเสียงหยุดและเปิดรายละเอียดเรื่องนั้น
5. ทดสอบผู้ใช้สาขาอื่นต้องไม่ได้รับ ทดสอบส่งซ้ำต้องไม่ดังซ้ำ เรื่องที่ปิด/รับทราบแล้วต้องไม่ดังจาก push ที่มาช้า
6. ออกจากระบบ/เปลี่ยน server ต้องหยุดรับสำหรับ session เดิม แอปถอนทะเบียนแบบ best effort และลบ Firebase token; แม้ offline ตัวรับตรวจ session/สิทธิ์ server อีกครั้งก่อนแจ้ง

**ข้อจำกัด:** WorkManager ไม่ตรงทุก 15 นาที อาจช้ากว่านั้นจาก Doze/ประหยัดแบตเตอรี่ ทั้ง FCM และ WorkManager ไม่รับประกันเสียงทันทีและไม่ข้ามการตั้งค่าของผู้ใช้ ถ้ากด **Force stop** ใน Settings ต้องเปิดแอปใหม่ก่อน ถ้า session หมดอายุให้เข้าสู่ระบบใหม่ ไม่มีการต่ออายุ session โดยอัตโนมัติ

## API ที่เพิ่ม (ใช้ Bearer session เดิม)

ทุก endpoint อยู่ใต้ `/api/receiving-push` และ authenticate ก่อน parse JSON จำกัด body 8kb ไม่มีสิทธิ์/ไม่มีสาขาที่ active ตอบ 403, ไม่ login/invalid/expired ตอบ 401 ผลสำเร็จ 200 `{success:true,data:...}` ไม่คืน token

| Method / path | Request | `data` / พฤติกรรม |
|---|---|---|
| GET `/capabilities` | ไม่มี | `{fcm:boolean}` ดูว่ามี path config ฝั่ง server; ไม่รับรองว่า credential ใช้งานได้ |
| POST `/devices` | `{token:string}` 20–4096 ตัว อักขระ FCM | `{registered:true}` upsert hash ของ token ผูก user จาก DB; ไม่รับ user/role/branch จาก body |
| DELETE `/devices` | `{token:string}` | `{registered:false}` ลบเฉพาะ token ของผู้ขอ ลบซ้ำได้ |
| GET `/followups/:id` | รหัสจำนวนเต็มบวก | `{id,supplier_name,note,pending_items,status,branch_id}`; ไม่พบ/คนละสาขา 404 แม้เป็น admin; input ผิด 422 |

JSON เสีย/validation 422 `VALIDATION_FAILED`, body เกิน 413 `REQUEST_TOO_LARGE`, ตารางยังไม่มี 503 `RECEIVING_NOT_READY`, ข้อผิดพลาดภายใน 500 `INTERNAL_ERROR` ข้อความตอบกลับไม่ส่ง stack/SQL/provider details

FCM เป็น **data-only/high priority** มีเฉพาะ kind, followup_id, user_id, branch_id, channel ไม่มีรูป/ราคา/ชื่อร้าน/หมายเหตุ ตัวรับอ่านรายละเอียดจาก API โดยใช้ session ปัจจุบันและตรวจว่าเรื่องยัง open ก่อนแสดง

เซิร์ฟเวอร์ใช้ durable delivery PK `(followup_id,token_hash)` + lease 2 นาที กันหลาย replica ส่งพร้อมกัน retry อย่างมาก 3 ครั้ง/เรื่อง/อุปกรณ์ เว้นอย่างน้อย 2 นาที; token UNREGISTERED ถูกลบ มี dedupe ใน Android รวม foreground/FCM/WorkManager อีกชั้น เมื่อ crash หลัง FCM รับแต่ก่อนบันทึกผลอาจมี redelivery แต่เครื่องจะไม่ดังซ้ำ

เก็บ token ในตาราง app-private ของ server สำหรับส่งจริง ต้องใช้สิทธิ์ DB/backup เดิม ไม่คืน token ทาง API และไม่มี log token เต็ม token_hash ใช้เป็นคีย์ dedupe ไม่ใช่ credential

## เอกสารอ้างอิง

- [ราคา Firebase: FCM ไม่มีค่าใช้บริการ](https://firebase.google.com/pricing)
- [รับ FCM Android และ data payload](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
- [HTTP v1 และ service account](https://firebase.google.com/docs/cloud-messaging/auth-server)
- [Google Services plugin](https://firebase.google.com/docs/android/google-services-plugin-and-file)
- [WorkManager: minimum 15 นาทีและข้อจำกัด OS](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest)

ไม่มีการสร้าง Firebase project, credential หรือส่งข้อความจริงในงาน Local นี้
