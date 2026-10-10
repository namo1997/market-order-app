# ประวัติ General Cashflow

## 2026-10-10 — รายจ่ายประจำยอดคงที่สำหรับ P&L (Local)

- เพิ่ม schema/API/admin UI รายจ่ายประจำ ตั้งครั้งเดียว นับอัตโนมัติทุกเดือน; แก้แบบมีผลตั้งแต่เดือน/ประวัติเวอร์ชัน/หยุด/ข้ามพร้อมเหตุผลและ audit. STAFF ปฏิเสธและใช้ decision guard เดิม.
- รวมค่าใช้จ่าย/COGS/สาขา/ส่วนกลางใน report พร้อม matched proration ตามวันเหมือน manual; เตือน LINE ยอดใกล้กัน ±5% โดยไม่หักเอง. HRMS/POS fallback/ค่าธรรมเนียมคงเดิม.
- Full SSD: server327 pass + skip1 เดิม, client48 pass, build ผ่าน; browser fixture 768px/form/loading/history ผ่าน. รายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/recurring-expenses-handoff.md` พร้อม path log และภาพ.
- Local เท่านั้น ไม่มี push/deploy/Production writes; Claude ตรวจ MySQL 8.4 tmpfs ต่อ. npm dependency vulnerabilities และ Vite chunk warning เดิมยังคงอยู่.

## 2026-10-10 — Production: HRMS ยอดจ่ายจริง + ทิป + POS + ค่าธรรมเนียม

- ผู้ใช้อนุมัติตั้งค่าเชื่อมและ deploy; integration จาก source Production 4c0f1d9 ของ deployment 7d7fce05 คง cashier issue UI แล้ว merge POS/HRMS scope ไม่รวม source dirty อื่น
- HRMS GET-only net LOCKED + APPROVED advance principal + FINALIZED separate tips; ส.ค. 1,084,636 ก.ย. 990,457 ต.ค.ร่างจึง 0 ตามคำยืนยันเจ้าของว่าจ่ายครบ; ตรวจ IDs/ยอดรวมทุกแหล่ง ไม่บวกดอกเบี้ย/หักคืน/ทิป INFO ซ้ำ
- Production audited overrides: #2283 โอนระหว่างบัญชีบริษัท 330,000 ไม่นับซ้ำ; #1299 2,520 + #1374 เงินสด 360 นอก HRMS นับเพิ่ม STAFF พร้อมเหตุผลและประวัติ คง LINE ต้นฉบับและ HRMS ทั้งหมด; #1862 กระดาษการตลาด740 จัด MARKETING และ #1061 ค่าเดินทาง Grab1,500 จัด TRANSPORT จากข้อความต้นทาง ไม่ซ้ำ platform fees
- ค่าธรรมเนียม ส.ค.124,167.37 ก.ย.61,634.84 จาก CLOSED receipts; ใช้ batch allocation ครั้งเดียว และการตลาดรวมใน gross-to-net ไม่บวกซ้ำ ไม่มี schema migration
- เพิ่ม /health source SHA256 จาก runtime source จริง และ build commit argument สำหรับ CLI deployment; JWT ปกติ 90 วันเก็บเฉพาะ server secret ต้องต่ออายุก่อนหมดอายุ
- หลักฐาน read-only/audit ที่ SSD reports/pnl-v0/production-*.json (private files permission600), full SSD server318 pass/1 skip เดิม + client48 pass + Vite build ผ่าน: /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T05-42-16-732Z-82159604/reports/command.log; deployment verification บันทึกตาม release ด้านล่าง

- Deployment สุดท้าย `194febf6-f412-4d60-8889-49ca0362a23e` SUCCESS, source `af749b6b0c5305e9a275cda087fd64f649bdb81f`; รอบแรก `d2d6ee7f` SUCCESS แล้วแทนด้วยรอบสุดท้ายเพื่อให้ Docker ใช้ Git commit ก่อน CLI fallback เมื่อมี Git metadata
- `/health` ready/commit ตรง และ source_sha256 `3fea60805a00bddfa33f5158e8386bc572a28927dfd9934aa81a6f75cec17bf4` ตรง 82 source files กับ worktree; report ไม่มี auth ตอบ401; API ส.ค.–ต.ค. + branch filter KK511,758/SK357,329 ผ่าน, Browser Admin โม แสดง ส.ค.1,084,636/ก.ย.990,457 และตัด330,000 จริง
- เปรียบเทียบ HRMS LOCKED ส.ค./ก.ย.และ approved advance payloads ไม่เปลี่ยน, payroll financial fields ต.ค.ไม่เปลี่ยน (attendance/freshness ต.ค.รับ scan ใหม่จาก live usage); P&L LINE378/manual0 คงเดิม, overrides5รายการตาม audit. Native startup repair เดิมเขียน timestamp/attachment และ audit94รายการ ทำให้ full receipt/line/reconciliation hashes เปลี่ยน; ตรวจ gross/status ของใบรับเงินและ fee allocations ในขอบเขต ส.ค.–ต.ค.ไม่เปลี่ยน ไม่อ้างว่าทุกคอลัมน์ทั่วฐาน byte-identical
- หลักฐาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/production-pnl-verification-summary.json`, production-branch-verification.json, hrms-protected-deltas.json และ production-startup-audit-private.json. JWT หมดอายุ 8 ม.ค.2570 12:35 ICT ต้องต่ออายุก่อนวันนั้น; เมื่อ token/upstreamเสีย UI แสดง incomplete
- POS ส่วนเสริมไม่มีวันที่ต้องใช้ในข้อมูล Production ปัจจุบัน (มีใบรับเงินทุกวันแล้ว แม้บางวันยังไม่ CLOSED). ไม่แสดงยอด POS ที่ไม่เกิดขึ้นว่าเป็นรายรับใหม่. ทิป ก.ย./ต.ค.ยัง DRAFT ไม่นับ; post-payment corrections ปัจจุบัน0 และยังไม่ import โดยอัตโนมัติ. คำเตือนค่าแรง LINE2,880 ส.ค.เป็นความเสี่ยงแบบกว้าง; ตรวจแล้วเป็นค่าแรงนอก HRMS ตามหลักฐาน/คำยืนยันเจ้าของ

## 2026-10-10 — Local: เสริมรายรับ POS สำหรับวันที่ไม่มีใบรับเงิน

- ตามตัวเลือกที่ผู้ใช้อนุมัติ เพิ่ม read-only POS fallback เฉพาะวันก่อนวันนี้ที่ไม่มี daily_receipts; ใบรับเงินทุกสถานะ/ยอดศูนย์ชนะเสมอ ไม่สร้างหรือแก้ใบรับเงิน
- แยกยอดใบรับเงิน/POS ส่วนเสริม พร้อมวันที่/สถานะ และความครบของใบรับเงินที่ยังไม่ปิด; matched mode ยอมรับ POS + LINE ปิดโดยไม่อ้างว่าตรวจใบรับเงินแล้ว
- ป้องกันนับซ้ำ/ต่างเดือน/วันปัจจุบัน/ต่างสาขา; POS error timeout20s หรือไม่มี mapping แสดงคำเตือน ไม่เติมศูนย์ ไม่เปิดเผย upstream error
- SSD full server311 pass/1 skip เดิม, client48/build ผ่าน. Log: /Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-47-47-919Z-d2b64d42/reports/command.log
- Browser component กับ API fixture สมมติ: matched/month/drill-down/POS fail ผ่าน และ 768px scrollWidth=768; ภาพอยู่ reports/pnl-v0/.playwright-cli/ บน SSD ไม่ใช่ Production UI
- รายงาน /Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/pos-fallback-20261010-handoff.md; ไม่มี migration/new env/Production writes/push/deploy รอ Claude ตรวจและผู้ใช้อนุมัติปล่อย


## 10 ตุลาคม 2026 — Production: หน้ากำไรขาดทุน P&L v0

- สถานะ: Production ตามอนุมัติผู้ใช้ “ดีพลอยได้เลยครับ”; deployment `b04bfda1-553f-4915-9600-7a45f2ab060a` SUCCESS จาก source commit `61a032e` (branch `cashflow/pnl-v0` บนฐาน `d1d7fdb` = deployment เดิม `55b6cf9a`)
- ความพยายามแรก `a386ccac` FAILED ตอน build เพราะอัปโหลดด้วย `--path-as-root` จากโฟลเดอร์ general-cashflow ขณะที่ service ตั้ง root directory = `general-cashflow`; ไม่มีผลกับ runtime เดิม แก้โดยอัปโหลดจาก root ของ worktree
- env ใหม่: `PNL_LINE_BILL_BASE_URL`, `PNL_LINE_BILL_EXPORT_TOKEN` (ค่าเดียวกับ token export ของ LINE Bill), `PNL_LINE_GROUP_BRANCH_MAP` (สันกำแพง→SK, คันคลอง→KK) ตั้งด้วย `--skip-deploys` ก่อน upload
- ตรวจหลังปล่อย: `/health` ready, `/api/pnl/report` ไม่มี token ตอบ 401, client bundle มีหน้า P&L, server เริ่มทำงานหลัง migrate ตาราง pnl_* โดยไม่มี error; Claude ไม่ได้ login Admin Production (ไม่ใช้ PIN จริงของผู้ใช้) ผู้ใช้เป็นผู้กดดึงรายจ่ายครั้งแรก
- ก่อนปล่อย Claude ตรวจ E2E กับ MySQL 8.4 จริง + LINE Bill งาน A + ยอด POS ก.ย. จริง: `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/claude-e2e-review-20261010.md`
- ค้าง: ผู้ใช้ดึงรายจ่าย ส.ค.–ต.ค., ย้ายบิลสรุปเจ้าหนี้ ส.ค. (467,281.73) ไปเดือน ส.ค., กรอกรายจ่ายที่ไม่ผ่าน LINE (เงินเดือน ค่าเช่า ฯลฯ)

## 10 ตุลาคม 2026 — P&L v0 fix2 (G1 ย้ายเดือนรับรู้รายจ่าย LINE, Local)

- เพิ่ม period_month DATE NULL ทั้ง DDL และ information_schema ensure column ที่รันซ้ำได้. Override รับ YYYY-MM/null, ย้อนหลังได้ไม่เกิน 3 เดือน, ห้ามเดือนอนาคต, เดือนเดียวกับวันจ่ายเก็บ NULL; audit ใช้ item ID integer และรักษาหมวด/การไม่นับเดิม.
- Report โหลดรายการตามวันที่พร้อมรายการย้ายเข้าที่รอบปิดแล้ว และ overrides ครบทั้งสองกลุ่ม. ทั้งเดือนนับเต็มในเดือนปลายทาง; matched เฉลี่ยรายการย้ายเข้าตามวันครบของสาขา/วันเดือน ปัด cents ต่อรายการ และตัดไม่ระบุสาขา. เพิ่ม moved_in/moved_out พร้อมรายการ ยอดเต็ม และยอดหลังตัดไม่นับ.
- คำแนะนำชื่อเดือนไทยเต็ม/ย่อ + ปี พ.ศ. หรือไม่มีปี เป็น pure function และ suggested_period_month เท่านั้น. UI ต้องกดเอง มีช่องเดือน/ย้ายเดือนทั้งรอจัดหมวดและ drill-down, กล่องย้ายเข้า/ออก, วันจ่ายจริง, ย้ายกลับ พร้อมจัดหมวด/ไม่นับได้ตามเดิม; เดือนแสดงไทย + พ.ศ.
- Full SSD suite: server 306 ผ่าน / 1 skip เดิม (opt-in DB), client 48 ผ่าน, Vite build ผ่าน. รวม invariant ยอดสองเดือนคงเดิม และต้นทางลดเท่าปลายทางเพิ่ม. ไม่สร้าง MySQL บน Mac ไม่ push/deploy.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-10T01-07-17-615Z-e4225fe8/reports/command.log`; handoff `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix2-handoff.md`. รอ Claude ตรวจ MySQL 8 จริงและ browser/integration; ไม่มีการย้ายบิลจริงในงานนี้.

## 10 ตุลาคม 2026 — P&L v0 fix1 ตาม Claude (F1–F6, Local)

- F1–F2: override audit ใช้ expense item ID; rule audit อ่าน ID หลัง upsert, stable_key อยู่ payload. ทุก mutation มี fake audit ตรวจ integer/null. Public error เฉพาะ pnlError; unexpected error ตอบ PNL_REQUEST_FAILED และ log ข้อความปลอดข้อมูลลับ; permission ยังคง 403.
- F3–F4: ดึงล่าสุดแสดง UTC DATETIME เป็นเวลาไทยตาม Cashflow. UI เริ่มที่เฉพาะวันที่ข้อมูลครบ; POS CLOSED/LINE ปิดรอบตรงกันต่อสาขา, manual เฉลี่ยรายเดือนด้วย cents, ส่วนกลางใช้วันที่ทุกสาขาครบ, ไม่รวมไม่ระบุสาขาพร้อมแสดงยอด. โหมดทั้งเดือนเตือนกำไรสูงเกินจริงเมื่อมีรายรับ CLOSED แต่รายจ่ายไม่ครบ. กล่องจัดหมวด/รายการยังแสดงทั้งเดือน.
- F5: เพิ่ม TRANSPORT/ADMIN และกฎตั้งต้น normalized 14 กฎเมื่อสร้าง rules table ครั้งแรกเท่านั้น; created_by NULL แสดงระบบ พร้อม ALTER MODIFY ที่รันซ้ำได้. ลบกฎแล้ว migrate ซ้ำไม่เติมกลับ.
- F6: vendor frozen consumer/fixtures 20 assets byte-identical กับ manifest รอบก่อนพร้อม provenance, เปลี่ยนเฉพาะ path ของเทสต์เดิมและเลิกใช้ helper เตรียม dependency.
- Full SSD command ตรงตามผู้ใช้ ไม่มี prepare: server 299 ผ่าน / 1 skip เดิม (opt-in DB), client 47 ผ่าน, Vite build ผ่าน. ไม่สร้าง MySQL บน Mac ไม่ push/deploy.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-09T19-33-38-665Z-199998f5/reports/command.log`; handoff `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-fix1-handoff.md`. รอบแรกพบ permission error 500 และแก้จน rerun ผ่าน; Claude ต้องตรวจ fix1 กับ MySQL 8.4/LINE preview/POS จริงอีกครั้ง.

## 10 ตุลาคม 2026 — กำไรขาดทุนเบื้องต้น v0 (B1–B7)

- สถานะ Local เท่านั้นใน `cashflow/pnl-v0`; เพิ่ม schema/cache sync/report/API Admin และหน้ากำไรขาดทุนภาษาไทย ไม่ push/deploy/ต่อ Production.
- ยึด export v2 งาน A: list fingerprint แยก snapshot fingerprint, dedupe บิลครั้งเดียว, counts คืนเงิน/เงินเข้าไม่นับยอด, รองรับ payments_without_bill; override/rules/manual ไม่ถูกลบโดย sync.
- การคำนวณใช้ integer cents, แยกไม่ระบุสาขา/ส่วนกลาง และความครบถึงเมื่อวานเวลาไทย; mutation มี audit และคง decision reason flow เดิม.
- ผล full SSD suite: server 294 ผ่าน / 1 skip เดิม (opt-in DB), client 45 ผ่าน, Vite build ผ่าน. Pure functions + fake query/fetch ไม่สร้าง MySQL. Browser fixture 768px ไม่มี horizontal scroll ทั้งหน้า, negative แดง, category rule payload และ copy previous month ไม่บันทึกอัตโนมัติผ่านการสังเกต.
- Log `/Volumes/SSD Files/SOLAO/market-order-system/runs/2026-10-09T19-11-28-110Z-924f1d0e/reports/command.log`; รายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/cashflow-pnl-v0-handoff.md`.
- ข้อจำกัด: worktree ฐานไม่มี frozen accounting test dependencies; copy 20 ไฟล์แบบ read-only ลง SSD snapshot พร้อม hashes ก่อน full test ไม่แก้ต้นฉบับ. Schema ยังไม่ทดสอบกับ MySQL จริง; รอ Claude ตรวจ integration และ preview snapshot จริงก่อน release.

## 9 ตุลาคม 2026 — เพิ่มผู้ใช้งาน Admin เพ็ญและจุ๋ม

- เพิ่ม เพ็ญ (`admin_pen`) และ จุ๋ม (`admin_jum`) ในตัวเลือก Admin และ allowlist ฝั่ง server โดยใช้การตรวจ PIN 6 หลักเดิม; บัญชีแยกถูกสร้างเมื่อเข้าสู่ระบบสำเร็จครั้งแรก ไม่ต้องเปลี่ยน schema.
- สถานะ: Production ตามอนุมัติผู้ใช้; deployment `55b6cf9a-3863-4bfd-8b1a-85bbbbc17ba8` SUCCESS จาก source commit `dc8f956` ผ่าน branch รวม `cashflow/integration-20261009-admin-pen-jum`.
- ผลทดสอบบน SSD: auth/domain 4/4, client 44/44 และ Vite build ผ่าน; browser แสดงรายชื่อครบห้าคน เลือกทั้งสองชื่อเปิดช่อง PIN ได้ และเปลี่ยนชื่อแล้วล้าง PIN เดิม.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-09T08-08-38-333Z-bfc4cc46/reports/command.log`; รายงาน `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.md`; ภาพ `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-local-20261009.jpg`.
- ตรวจ Production: `/health` ready, หน้าเลือกผู้ใช้งานมีครบห้าชื่อ, เพ็ญ/จุ๋มเข้าได้ด้วย PIN เดิมและ `/auth/me` คืนตัวตน Admin แยกกัน; PIN ผิด/ไม่กรอกถูกปฏิเสธ 401. หลักฐาน `/Volumes/SSD Files/SOLAO/cashflow/reports/admin-pen-jum-production-20261009.json` และภาพชื่อเดียวกัน `.jpg`.
- ตรวจฐานก่อน release: deployment เดิม `630c9563` ยังเป็นตัวออนไลน์ล่าสุด ตรง release `066d515` ที่มีรายงาน runtime hash ยืนยันไว้; diff executable source มีเพียงสองรายการรายชื่อ. Upload จาก canonical worktree โดย service root เป็น `general-cashflow`, ไม่ใช้ SSD simulation deploy; Railway staged changes 11 รายการของงานอื่นคงเดิม.
- ข้อจำกัด: `/health` รายงาน commit `unknown` สำหรับ CLI upload จึงอ้าง source commit, deployment id/message, image digest และผลตรวจพฤติกรรมจริง; ไม่ได้อ้างว่าอ่าน runtime hash ใหม่หรือเทียบข้อมูลรับจ่ายทั้งหมด.

## 7 ตุลาคม 2026 — token อ่านแยกสำหรับ Business MCP

- เพิ่ม `CASHFLOW_DOT_EXTRA_TOKENS_JSON` ให้ endpoint reconciliation ตรวจ token hash และสิทธิ์สาขา/วันหมดอายุแยกกัน โดยไม่เปลี่ยน token เดิมและยังอ่านอย่างเดียว.
- สถานะ: Local ยังไม่ deploy Production.
- ผลทดสอบ: `dotReconciliation.test.js` ผ่านบน SSD 22/22 รวม token ใหม่/เดิม, สิทธิ์สาขา, GET-only และข้อมูลที่ไม่รู้ต้องคง null.
- หลักฐาน: `/Volumes/SSD Files/SOLAO/cashflow/runs/2026-10-07T14-37-44-802Z-941486ea/source` และรายงาน `/Volumes/SSD Files/SOLAO/market-order-system/reports/business-mcp-local-2026-10-07.md`.
- ค้าง: ตั้ง token ใหม่ใน secret store, ผูก Gateway, ตรวจ live ครบ และขออนุมัติ deploy.

### Local — 10 ต.ค. 2026 เงินจ่ายพนักงาน HRMS และค่าธรรมเนียม

- เจ้าของยืนยันว่า HRMS ถือว่าจ่ายครบ: เพิ่มตัวอ่าน GET เงินเดือนสุทธิรอบ LOCKED + เงินต้นเบิกกลางเดือน APPROVED; ไม่บวกดอกเบี้ย/ยอดหักคืนซ้ำ และไม่แก้ข้อมูล HRMS.
- แยกสาขาผลิต/ส่วนกลาง คืนเฉพาะยอดรวม ปกปิดข้อมูลรายคน; เตือนเชื่อมไม่ได้/สาขาไม่ตรง/ค่าแรง LINE หรือกรอกเองที่อาจซ้ำ. เงินเดือนใช้เดือนรอบเพราะไม่มีวันที่โอนทั้งรอบ; matched เก็บยอด HRMS เต็มพร้อมคำเตือน.
- รวมค่าธรรมเนียมและการตลาดจากใบรับเงิน CLOSED ครั้งเดียว; ชำระเป็นชุดใช้ allocated fee ต่อวัน. รายการอื่นในใบรับเงินยังไม่เหมารวมเป็นรายจ่ายเงินสด.
- ทดสอบ SSD: server 316 ผ่าน + 1 skip เดิม, client 48 ผ่าน, build ผ่าน (มีคำเตือน bundle ขนาดเดิม); browser สมมติตรวจยอด 12,000 + 3,000 = 15,000, ค่า fee, หมวดค่าแรง และ upstream failure.
- หลักฐาน: /Volumes/SSD Files/SOLAO/market-order-system/reports/pnl-v0/hrms-paid-expenses-20261010-handoff.md; full run 2026-10-10T02-18-20-697Z-0f61aed4.
- ค้างก่อน release: ตั้ง HRMS ADMIN read bearer/branch map อย่างปลอดภัย, ตรวจยอดจริงและ MySQL integration, ตรวจซ้ำข้าม LINE/manual. ทิปจ่ายแยกและ post-payment corrections ยังไม่ดึงอัตโนมัติ. ยังไม่ push/deploy.
