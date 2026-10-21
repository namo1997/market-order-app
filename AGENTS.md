# SOLAO market workspace

อ่านกติกา `/Users/surachart/.solao-tools/SSD_POLICY.md` ก่อนสำรอง ทดสอบ build หรือจำลองข้อมูล ตามคำสั่งผู้ใช้ 4 ต.ค. 2026 ทุกระบบย่อยใช้ SSD เท่านั้นสำหรับข้อมูลที่สร้างใหม่

- ใช้ `node /Users/surachart/.solao-tools/ssd-workspace.mjs check --project market-order-system` ก่อนสร้างไฟล์
- ใช้ตัวรัน `run --project market-order-system --source '/Users/surachart/ระบบสั่งของตลาดสด' -- <command>` สำหรับงานสร้าง test/build output; ตัวรันคัดลอก source ปัจจุบันไป SSD รักษา dirty tree เดิม
- Preview ของ Bill Capture/Cashflow ต้องตรวจ SSD ก่อนเปิดหรือ sync; ไม่ใช้ named volume บน Mac เป็นที่เก็บ DB preview ใหม่
- เก็บสำเนาข้อมูลเดิมไว้ ไม่ย้าย/ลบ backup, audit, uploads หรือไฟล์ที่งานอื่นกำลังใช้โดยอัตโนมัติ
- ห้าม deploy จาก SSD simulation copy. อ่าน AGENTS.md ของ service ที่แก้เพิ่มเติมและใช้ release workflow เดิม

## การค้นหาและการเก็บไฟล์เก่า

- อ่าน `docs/REPOSITORY_HYGIENE.md`. เริ่มจาก source/tests/config และคู่มือของระบบที่แก้ ใช้ `rg` ตาม `.ignore` ไม่สแกนทั้ง repo ด้วย `--hidden --no-ignore`
- `archive/`, `docs/archive/`, docs/evidence, release reports, tmp/output/outputs, preview/recovery DB, cache และ browser artifacts ไม่ใช่ source ปัจจุบัน เปิด exact path เมื่อจำเป็นต่อเรื่องที่ตรวจเท่านั้น
- ดัชนีของ source document/script เก่าคือ `archive/README.md`. เมื่อย้ายเข้าหมวดต้องระบุ original path, วันที่, เหตุผล และแก้ links/imports ที่ได้รับผล ไม่ย้ายแผนที่ยังใช้งานหรือ patch ค้างของแชตอื่น
- Generated data/output และ scratch งานใหม่อยู่ SSD เท่านั้น ห้ามสร้างเพิ่มในโฟลเดอร์ผลลัพธ์บน Mac; source tool ที่ดูแลต่ออยู่ใน scripts ของระบบเจ้าของ
- เมื่อเพิ่ม artifact directory ให้อัปเดต `.ignore`/`.gitignore` ตามประเภท ตรวจว่า source/tests/schema/migrations ยังค้นหาได้ และไม่ลบ originals/backup/raw evidence เพื่อให้ repo ดูสะอาด
- `.ignore` มีผลกับการค้นหาปกติ ไม่ใช่ตัวกัน upload/deploy; คง canonical source/release workflow และตรวจ release scope แยก
- หลังจัดไฟล์หรือแก้ ignore rules รัน `node scripts/check-repository-hygiene.mjs` เป็น read-only check; ผลรายงานที่บันทึกต้องอยู่ SSD

## แผนที่โมดูล

ก่อนแก้ระบบใด เปิด `docs/modules/README.md` และ entry ใน `docs/modules/modules.json` เพื่อดูไฟล์ ตาราง tests และบั๊กที่รู้แล้วของโมดูลนั้น **งานรับสินค้า (receiving-app) ให้เปิด `docs/modules/receiving-codemap.md` ก่อน — ตารางหน้าจอ → component/logic/CSS/API/เทสต์ หาไฟล์ได้ทันทีไม่ต้อง grep ทั้ง repo; เพิ่ม/ย้ายไฟล์ต้องแก้แผนที่ใน commit เดียวกัน (เทสต์ `receiving-codemap` ตรวจ)** อ้างบั๊กด้วยรหัส (เช่น `ORD-01`) และอัปเดตสถานะในเอกสารโมดูลเมื่อแก้แล้ว

## บันทึกประวัติการทำงาน (บังคับทุกงาน)

ตามคำสั่งผู้ใช้ 6 ต.ค. 2026 ทุกงานที่แก้ source, config, schema, flow หรือ deploy ต้องบันทึกประวัติในการแก้เดียวกัน ทั้ง Claude, Codex และ AI อื่น

- เพิ่มหัวข้อใน `CHANGELOG.md` ของระบบที่แก้ (ถ้ายังไม่มีให้สร้าง) เป็นภาษาไทย: วันที่, สิ่งที่ทำ, สถานะ Local หรือ Production (ระบุ deployment id ถ้า deploy), ผลทดสอบโดยย่อ, path หลักฐาน/รายงานบน SSD และสิ่งที่ยังค้าง
- อัปเดต `AGENTS.md` ของระบบเมื่อแตะตาราง/คอลัมน์, route, env var, enum, flow หลัก หรือขั้นตอน deploy ตามกติกาของระบบนั้น
- แก้บั๊กที่มีรหัสแล้ว ให้อัปเดตสถานะใน `docs/modules/`
- งานที่ยังไม่เสร็จหรือหยุดกลางทาง ให้บันทึกสถานะที่ค้างและเหตุผลด้วย ไม่ปล่อยให้งานหายไปกับแชท
- รายงานรายละเอียดหรือ log ยาวเก็บบน SSD แล้วใส่ path ใน CHANGELOG ห้ามใส่ข้อมูลลับ เลขบัญชีเต็ม หรือ token

## งานขนานหลายแชท / หลาย AI

Checkout หลัก `/Users/surachart/ระบบสั่งของตลาดสด` มี dirty work ของหลายแชทและไม่ตรงกับ Production จึงไม่ใช้เป็นฐานงานขนาน. Production บางระบบ deploy ด้วย `railway up` จากไฟล์ ไม่ใช่จาก commit

1. **ฐานงาน**: แต่ละระบบมี branch ฐานที่ตรงกับ Production ล่าสุด เช่น `lbc/production-base` ของ line-bill-capture (ตรงกับ deployment bbfd4352 ซึ่ง hash ตรง release manifest). งานใหม่ต้องแตก branch จากฐานนี้ ห้ามแตกจาก branch รวมเก่า และห้ามแก้ branch ฐานโดยตรง
2. **หนึ่งงาน หนึ่ง worktree หนึ่ง branch**: `git worktree add -b <ระบบ>/<งาน> <path> <ระบบ>/production-base` แล้วแก้เฉพาะใน worktree นั้น ห้ามแก้ไฟล์ใน checkout หลักด้วย absolute path. ทดสอบด้วย `ssd-workspace.mjs run --project <slug> --source <worktree>`
3. **ลดการชน**: โค้ดใหม่อยู่ในไฟล์ใหม่ แตะไฟล์ร่วม (`server.js`, `db.js`, `public/index.html`) เฉพาะจุดเชื่อมสั้น ๆ. ถ้างานต้องพึ่งงานอื่นที่ยังไม่รวม ให้ระบุในสรุป ไม่คัดลอกโค้ดของอีกงานมาใส่เอง
4. **ก่อนส่งงาน**: commit ใน branch ของตัวเอง (ไม่ push), อัปเดต CHANGELOG/AGENTS ของระบบใน branch นั้น, รายงานไฟล์ร่วมที่แตะและจุดที่อาจชน
5. **รวมงาน**: ทำทีละ branch บน branch รวมแยก (เช่น `<ระบบ>/integration-<วันที่>`) ที่แตกจาก production-base แก้ conflict แล้วรันเทสต์ครบหลังรวมแต่ละ branch. ปล่อยได้จาก branch รวมที่ผ่านเทสต์เท่านั้น
6. **Mobile V3 ของ line-bill-capture**: `npm run check` build `mobile-admin-v3/dist` ใหม่ จึงต้องรันผ่านตัวรัน SSD เสมอ ห้าม commit การเปลี่ยน `mobile-admin-v3/dist` นอกงานปล่อย Mobile โดยตรง (source ใน branch ฐานใหม่กว่า dist ที่ให้บริการอยู่). ใช้ Node 24 ตาม AGENTS ของระบบ
7. **หลัง deploy**: เลื่อน `<ระบบ>/production-base` ไปยัง commit ที่ปล่อยจริง และบันทึก deployment id ใน CHANGELOG เพื่อให้งานถัดไปเริ่มจาก Production ล่าสุด
8. งานขนานที่เริ่มไปก่อนกติกานี้และแก้ checkout หลักอยู่แล้ว ไม่ต้องย้ายกลางทาง แต่ต้องรายงานไฟล์ที่แก้ให้ครบเพื่อแยกเข้า branch ตอนรวม
9. การ deploy, push และการเลื่อน branch ฐานต้องได้รับอนุมัติจากผู้ใช้ทุกครั้ง

## ระบบรับสินค้า (receiving) — กติกาสำหรับเอเจนต์ (Gemini / Codex / อื่นๆ)

อ่านไฟล์นี้ทุกครั้งก่อนเริ่มและก่อนส่งงาน งานจะถือว่า "เสร็จ" ก็ต่อเมื่อผ่าน **ทุกข้อในหัวข้อ 3–5** และรายงานตามหัวข้อ 6 เท่านั้น
แผน: `docs/receiving-apk-plan.md` · สัญญา API: `docs/receiving-documents-api.md`

### 1. ขอบเขต (ห้ามฝ่าฝืน)
- ทำงานเฉพาะใน worktree ของงานรับสินค้าที่ได้รับมอบหมาย (ตามกติกา "งานขนานหลายแชท / หลาย AI" ด้านบน) บน branch ที่ checkout อยู่ ห้ามสลับ branch
- ห้ามแตะ `/Users/surachart/ระบบสั่งของตลาดสด` และ worktree อื่น
- ห้ามรัน `railway`, `git push`, deploy, migration บนฐานจริง, `mysql` เชื่อมเครื่องจริง
- ห้ามสร้าง/อ่าน `.env`, token, รหัสผ่าน, คีย์ API ห้ามใส่คีย์ในโค้ด/เทสต์/log
- ห้ามลบหรือทำให้เทสต์เดิมหลวมลงเพื่อให้ผ่าน ห้าม `.skip`/`.only`/`todo` ในเทสต์ที่ส่งมอบ
- แก้ไฟล์เดิมเท่าที่จำเป็น และอธิบายทุกจุดที่แก้ไฟล์เดิมในรายงาน

### 2. การรันเทสต์ (ต้องรันบน SSD เท่านั้น)
```sh
node /Users/surachart/.solao-tools/ssd-workspace.mjs check --project market-order-system
node /Users/surachart/.solao-tools/ssd-workspace.mjs run --project market-order-system --source <worktree-ของงาน> -- sh -c 'cd server && npm ci --no-audit --no-fund && node --experimental-vm-modules --test tests/*.test.mjs'
```
ถ้า SSD check ไม่ผ่าน: หยุดและรายงาน ห้ามรันเทสต์ในเครื่องแทน
- **การเทสต์หน้าจอ UI/UX (Mobile Screen Testing):**
  - ระหว่างพัฒนา/ปรับแก้ UI: ให้จำลองและเทสต์หน้าจอมือถือในเครื่อง Mac (`360×800`, `390×844`, `412×915` ผ่าน Browser Mobile Viewport / Playwright / Test Harness บนสำเนา SSD) ให้ผ่านครบทุกสถานะก่อน เพื่อความรวดเร็ว
  - ขั้นตอนตรวจรับ APK / เมื่อเชื่อมต่อมือถือจริง: ต้องติดตั้งและเทสต์หน้าจอในเครื่องจริง (`adb`) เพื่อตรวจขอบจอ Safe Area, Native Dialog, ธีมสว่าง/มืด และการจัดวางภาพประกอบ (`ReceivingIllustration`) พร้อมบันทึกภาพหน้าจอและ `log.md` ลง SSD

### 2.1 Collation (Production ปนกัน)
- ตารางรับสินค้าทั้งหมดเป็น `utf8mb4_unicode_ci` (ตามตารางแกนเก่า) แต่ `supplier_masters`, `product_supplier_master_links`, `product_group_*` ใน Production เป็น `utf8mb4_0900_ai_ci` ห้ามพึ่ง default ของฐาน ห้ามแปลง collation ตารางใด
- SQL ที่เทียบ/UNION คอลัมน์ข้อความของ `supplier_masters` กับตารางอื่นต้องใส่ `COLLATE utf8mb4_unicode_ci` ชัดเจน (`server/tests/receiving-collation.test.mjs` สแกน) fixture pilot/IT ต้องคง collation แบบเดียวกับ Production (`pilot/collation.test.mjs` รันบน MySQL จริง)

### 3. ด่านเทสต์ (ต้องผ่านทั้งหมด)
- [ ] เทสต์เดิมทั้งหมดใน `server/tests/` ผ่าน (โดยเฉพาะ `release-invariants`, `order-safety`, `hrms-sales-product-catalog` ที่ Production รันก่อน deploy)
- [ ] เทสต์ใหม่ครอบคลุมทุก endpoint ในสัญญา: กรณีสำเร็จ + validation 422 + ไม่มีสิทธิ์ 403 + ไม่พบ 404 + สถานะผิด 409
- [ ] confirm/void: ทดสอบว่า order_items, inventory, alias เปลี่ยนครบใน transaction เดียว และ **rollback ทั้งหมด** เมื่อขั้นใดล้มเหลว
- [ ] idempotency: ส่ง `client_uuid` เดิมซ้ำ (รวมกรณีส่งพร้อมกัน 2 คำขอ) ได้เอกสารเดียว
- [ ] OCR: ทดสอบด้วย mock provider เท่านั้น (ห้ามเรียก API จริงในเทสต์) รวมกรณี timeout, JSON เสีย, ค่าตัวเลขเป็น string มีคอมมา, ปี พ.ศ.
- [ ] เงินและจำนวน: คิดเป็นสตางค์/จำนวนเต็ม ไม่มีทศนิยมลอยตัวคลาด (เช่น 0.1+0.2), ปัด 2 ตำแหน่งแบบเดียวทั้งระบบ
- [ ] รันเทสต์ซ้ำ 2 รอบได้ผลเท่ากัน (ไม่มีเทสต์ที่พึ่งเวลาจริง/ลำดับ/สุ่ม)

### 4. ด่านหาช่องโหว่ (ตรวจเองก่อนส่ง และเขียนเทสต์พิสูจน์ทุกข้อที่ทำได้)
| หัวข้อ | ต้องพิสูจน์ว่า |
|---|---|
| สิทธิ์ (IDOR) | ผู้ใช้สาขา/แผนก A อ่าน/แก้/ยืนยัน/void/ดูรูปของ B ไม่ได้ ทุก endpoint รวม `GET /:id/images/:imageId`; admin ได้ตามที่สัญญากำหนด |
| ไม่ login | ทุก endpoint ตอบ 401 เมื่อไม่มี/token ผิด/หมดอายุ |
| SQL | ทุก query ใช้ placeholder ไม่มีการต่อ string จาก input (รวม ORDER BY/LIMIT/ชื่อคอลัมน์) |
| รูป/อัปโหลด | จำกัดขนาดก่อน decode, ตรวจ magic bytes จริง (ไม่เชื่อ mime ที่ส่งมา), จำกัดจำนวนหน้าต่อเอกสาร, body limit ของ Express ไม่เปิดกว้างทั้งแอป |
| ค่าใช้จ่าย AI | จำกัดจำนวนครั้ง OCR ต่อเอกสาร/ผู้ใช้/นาที, OCR ซ้ำไม่เสียเงินซ้ำถ้ารูปเดิม (ดู sha256), timeout ชัดเจน |
| Prompt injection | ข้อความในบิลถูกใช้เป็นข้อมูลเท่านั้น ไม่มีผลต่อคำสั่ง/สิทธิ์; ผล OCR ผ่าน schema validation ก่อนบันทึก; ยอดติดลบ/ยอดมหาศาล/บรรทัดเกินจำนวนถูกปฏิเสธหรือเตือน |
| สถานะเอกสาร | แก้/เซ็น/OCR ได้เฉพาะ draft; confirm ซ้ำไม่บวกคลังซ้ำ; void ย้อนเฉพาะที่เอกสารนี้ทำ และ void ซ้ำไม่ย้อนซ้ำ |
| พร้อมกัน (race) | 2 คนกด confirm เอกสารเดียวพร้อมกัน → สำเร็จครั้งเดียว (ใช้ row lock / unique / version) |
| ข้อมูลรั่ว | error ไม่ส่ง stack/SQL/คีย์ กลับ client; log ไม่มีรูป base64, token, คีย์, ลายเซ็น |
| วันที่/เวลา | ใช้เวลา Asia/Bangkok ตามระบบเดิม; วันข้ามเที่ยงคืนไม่ทำให้เอกสารผิดวัน |
| ของเดิมไม่พัง | endpoint `/api/orders/receiving` เดิมยังทำงานเหมือนเดิม; ไม่มีการเปลี่ยน schema ตารางเดิมแบบไม่ย้อนได้ |
| Schema | `CREATE TABLE IF NOT EXISTS` / ALTER แบบ idempotent, รันซ้ำได้, DECIMAL สำหรับเงิน, มี index ที่ query ใช้ |

ถ้าพบช่องโหว่ที่แก้ไม่ได้ในงานนี้ ห้ามซ่อน — ใส่ในรายงานหัวข้อ "ความเสี่ยงที่เหลือ"

### 5. ด่านคุณภาพโค้ด
- [ ] ไฟล์ไม่ใหญ่เกินจำเป็น (เกิน ~800 บรรทัดให้แยก module ตามหน้าที่)
- [ ] ไม่มีโค้ดตาย/console.log ดีบัก/TODO ที่ไม่บอกเหตุผล
- [ ] ใช้ฟังก์ชันเดิมของระบบ (auth, order receiving, inventory) แทนการเขียน SQL ซ้ำ ถ้าเขียนซ้ำต้องอธิบาย
- [ ] สัญญา API ตรงกับ `docs/receiving-documents-api.md` ทุกฟิลด์/รหัส error; ถ้าเปลี่ยน ต้องแก้เอกสารและบอกเหตุผล

### 6. รูปแบบรายงานส่งงาน (ภาษาไทย)
1. สรุปสิ่งที่ทำ + รายการไฟล์ที่เพิ่ม/แก้ (แยกไฟล์เดิมที่ถูกแก้)
2. ผลเทสต์จริง: คำสั่งที่รัน + จำนวน tests/pass/fail/skip จาก output (ห้ามเขียนว่า "ผ่าน" โดยไม่มีตัวเลข)
3. ตาราง checklist หัวข้อ 3–5 ทุกข้อ: ✅ พร้อมชื่อเทสต์ที่พิสูจน์ / ❌ / ⚠️ พร้อมเหตุผล
4. ช่องโหว่ที่พบและแก้แล้วในรอบนี้
5. ความเสี่ยงที่เหลือ / สิ่งที่ยังไม่ทำ
6. commit ทีละขั้นพร้อมข้อความอธิบาย (ห้าม push)

งานทุกชิ้นจะถูก Claude ตรวจซ้ำก่อนรวมหรือขึ้น Production

### สิ่งที่ระบบรับสินค้าเพิ่มบน production-base (ยกมาเมื่อ 20 ต.ค. 2026 — Local release candidate)
- **โค้ดใหม่:** `server/src/**/receiving-*` (controller/model/routes/services), `client/src/receiving-app/` (แอปรับของ build ด้วย `client/vite.receiving.config.js` -> `client/dist-receiving/`), `client/android/` (Capacitor), `pilot/` (ชุดทดสอบ MySQL จริงบน SSD), `e2e/`
- **env ใหม่ (ทั้งหมดเป็นค่าเสริม):** `RECEIVING_EXPORT_TOKEN` (ไม่ตั้ง = endpoint ส่งออก AP ตอบ 503), `GOOGLE_OAUTH_CLIENT_IDS`, `RECEIVING_OCR_MODEL`/`RECEIVING_OCR_TIMEOUT_MS` (ใช้ `OPENAI_API_KEY` เดิม), `RECEIVING_FCM_SERVICE_ACCOUNT_FILE` (push), `AUTO_ENSURE_RECEIVING_TABLES` — **บน NODE_ENV=production ตารางรับสินค้าจะไม่ถูกสร้างอัตโนมัติ เว้นแต่ตั้ง `true`** ต้องรันสคริปต์ `server/scripts/migrate-receiving-*.js` (documents/issues/push) ในขั้น release ที่เจ้าของอนุมัติ ก่อน deploy โค้ดนี้ (ไม่เช่นนั้น API ตอบ 503 `RECEIVING_NOT_READY` และ query alias/admin จะ error) ดู `docs/receiving-documents-api.md`, `docs/push-setup.md`, แผนที่ SSD `reports/receiving-overnight-2026-10-18/RELEASE-PLAN.md`
- **ตารางใหม่ (additive):** `receiving_documents`, `receiving_document_lines/images/audits/notifications`, `receiving_issues*`, `receiving_issue_stock_returns`, `receiving_followups*`, `receiving_push_devices/deliveries`, `receiving_supplier_profiles/branch_codes/leads/product_guard/product_imports/admin_audits` — สัญญาใน `docs/receiving-documents-api.md`, `docs/receiving-issues-api.md`, `docs/receiving-accounting.md`
- **Dockerfile:** Node 22; image build รันเทสต์ server ซึ่ง import `pilot/app.mjs` จึง COPY `pilot` เฉพาะตอน build แล้ว `rm -rf pilot`
- **Flow scan-first (21 ต.ค. 2026):** แตะร้านในคิว → ปุ่มล่าง "สแกนบิล <ร้าน>" สร้างใบ bill ค่าเริ่มต้นแล้วเปิดสแกนเนอร์ทันที (`client/src/pages/receiving/start-receiving.js`, prop `scanFirst` ของ `DocumentEditor`), ไป "นับ" โดยซ่อนภาพ/OCR ตามกฎ blind; "ไม่มีบิล" ในคิวสร้าง manual_receipt; ใบตั้งค่าเดิมอยู่ที่ ตัวเลือก → "ตั้งค่าใบรับเอง"; `PUT /:id` ก่อนนับรับเฉพาะ `{kind:'manual_receipt'}` ตัวเดียว (audit `switch_to_manual`)
- **ห้าม deploy** จนกว่าเจ้าของอนุมัติ; การเลิกใช้เมนูรับสินค้าเดิม (ระยะ 1) อธิบายใน `docs/receiving-rollout.md`
