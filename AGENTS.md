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

ก่อนแก้ระบบใด เปิด `docs/modules/README.md` และ entry ใน `docs/modules/modules.json` เพื่อดูไฟล์ ตาราง tests และบั๊กที่รู้แล้วของโมดูลนั้น อ้างบั๊กด้วยรหัส (เช่น `ORD-01`) และอัปเดตสถานะในเอกสารโมดูลเมื่อแก้แล้ว

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
7. **ทุกครั้งที่ deploy (บังคับ ทั้ง Claude, Codex และ AI อื่น — คำสั่งผู้ใช้ 7 ต.ค. 2026)**:
   - ก่อน deploy: commit งานให้ครบ ห้าม deploy จากไฟล์ที่ยังไม่ commit
   - ใส่ข้อความเสมอ: `railway up ... -m "<สรุปงาน> <commit สั้น>"` ห้าม deploy โดยไม่มี message
   - หลัง deploy สำเร็จ: ตรวจ hash ไฟล์ runtime ตรงกับ commit นั้น แล้ว `git push origin <branch งาน>`
   - เลื่อน `<ระบบ>/production-base` ไปยัง commit ที่ปล่อยจริง แล้ว `git push origin <ระบบ>/production-base` (ผู้ใช้อนุมัติขั้นตอนนี้ไว้แล้ว ไม่ต้องขอซ้ำ เมื่อ hash ตรง)
   - บันทึก deployment id, commit และหลักฐานใน CHANGELOG ของระบบ
   - ถ้าทำขั้นใดไม่ได้ ให้แจ้งผู้ใช้ทันทีว่า Production ไม่ตรงกับ GitHub/branch ฐาน
8. งานขนานที่เริ่มไปก่อนกติกานี้และแก้ checkout หลักอยู่แล้ว ไม่ต้องย้ายกลางทาง แต่ต้องรายงานไฟล์ที่แก้ให้ครบเพื่อแยกเข้า branch ตอนรวม
9. การ deploy ต้องได้รับอนุมัติจากผู้ใช้ทุกครั้ง; push และเลื่อน branch ฐานหลัง deploy ทำตามข้อ 7 ได้เลย


## Bill Capture ordered-product references — Local, 2026-10-08

Market GET /api/bill-order-reference/lines requires dedicated BILL_ORDER_REFERENCE_TOKEN (x-bill-order-reference-token) and explicit BILL_ORDER_REFERENCE_ALLOWED_BRANCH_IDS. New factory model/controller/routes use SELECT only, never ensure DDL or receiving helpers. Exact order_date is the selected receiving/purchase day; delivery_date stays null. Branch comes from current ordering department, supplier_masters catalog identity is separate from product_group legacysupplier. Bound1000 rows +truncated; missing schema/config returns unavailable, not zero. No received flags/prices, conversions or order writes. LBC keeps optional OCR product data separate and reads references via its server; no confirmed product mapping or receipts are written.

Source/testing completed in isolated codex/lbc-invoice-lines-20261008 worktree. This market source is not verified against current deployed runtime: do not release market code from this branch without scoping/rebasing the two-line mount and new files against current market canonical release. No Production setup, token or branch mapping has been applied. See CHANGELOG.md and docs/modules/ordering.md. Tests are mockDB/loopbackHTTP on verified SSD only, not live MySQL.
