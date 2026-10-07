# คลังสินค้า (`inventory`)

> status: candidate-split · review: in-progress · อัปเดต: 2026-10-07

## หน้าที่
เก็บยอดคงเหลือต่อ (สินค้า, แผนก) ใน `inventory_balance` และประวัติการเคลื่อนไหวใน `inventory_transactions` (ledger) ผู้ใช้ปลายทางคือแผนก/สาขา (ดูยอด, บัตรคุมสต็อก), แอดมิน (ปรับยอด, ตั้งยอดเริ่มต้น, รายงาน variance) และฝ่ายผลิต (แปรรูป) ระบบอื่นเขียนเข้าตารางนี้: รับสินค้า (`ordering`/`receiving`), PO คลัง, เช็คสต็อก (`stock-check`), ขายตามสูตรจาก POS และแปรรูป (`production`)

## Flow
1. รับสินค้า / PO / เบิก-โอน → `createTransaction` ต่อท้าย ledger ณ เวลาปัจจุบัน (ล็อกแถว `inventory_balance` ก่อนอ่านยอด)
2. เช็คสต็อก `POST /api/stock-check/my-check` บันทึก `stock_checks` → แอดมิน apply ที่ `POST /api/inventory/apply-adjustment` (`applyStockAdjustment`) สร้างรายการ `adjustment` `reference_type='stock_check'` ที่ `created_at` = เวลานับ
3. ดึงตัดสต็อกขายตามสูตร `POST /api/recipes/usage/sync` (`syncUsageToInventory`) แทรกรายการ `sale` / `recipe_sale` ที่ `created_at` = เวลาบิลจริง (ย้อนหลังได้) แล้ว reflow ledger
4. แปรรูป `POST /api/inventory/production/transform` แทรกรายการ `production_transform` ที่ `created_at` = วันที่แปรรูปที่เลือก แล้ว reflow ledger
5. รายงานส่วนต่าง `GET /api/inventory/variance-report` (`getStockVarianceReport`) เทียบยอดระบบ ณ เวลานับ กับยอดนับ

## ไฟล์และตาราง
ดู entry ใน [`modules.json`](modules.json) ตรรกะล้วนของ ledger อยู่ที่ `server/src/utils/stock-ledger.js` (ทดสอบใน `server/tests/stock-ledger.test.mjs`)

## กติกา (ห้ามผิด)
- `inventory_transactions.quantity` = ส่วนต่างมีเครื่องหมาย, `balance_before/after` เป็นผลของ reflow ตามลำดับ `created_at, id`; `created_at` เก็บเป็น **UTC** (MySQL บน Railway) ส่วนวันที่ทางธุรกิจเป็น **เวลาไทย**
- **รายการนับสต็อก (`adjustment` + `reference_type='stock_check'`) เป็นยอดสัมบูรณ์**: `balance_after` คือยอดนับจริงและห้ามถูก reflow เปลี่ยน ส่วน `quantity` ถูกคำนวณใหม่ = ยอดนับ − ยอดก่อนหน้า (`reflowLedgerRows`). ห้ามเขียนโค้ดใหม่ที่พึ่ง `quantity` ของรายการนี้เป็นค่าคงที่
- รายการใดที่แทรก **ย้อนหลัง** (created_at ไม่ใช่ปัจจุบัน) ต้องเรียก `recalculateLedgerForPairs` ใน transaction เดียวกันกับ INSERT/DELETE ห้ามอัปเดต `inventory_balance` แบบ relative อย่างเดียว
- ลำดับล็อกมาตรฐาน: `lockBalanceRow` (`inventory_balance ... FOR UPDATE` หลัง `INSERT IGNORE` แถวศูนย์) ก่อน แล้วค่อยแถว ledger; หลาย (สินค้า, แผนก) ให้ล็อกเรียง `department_id, product_id`
- `reference_id` ของ stock_check: ปัจจุบัน `date:id`, เก่า `date:id:<ts>`, apply ซ้ำ `date:id:reapply:<ms>` — ตรวจ "apply แล้ว" ด้วย `= 'date:id' OR LIKE 'date:id:%'`; ตรวจ "มีรายการวันหลังกว่า" ด้วย `reference_id >= <วันถัดไป>` (ห้ามเทียบกับ `date:`)
- กรองวันที่ของ ledger ต้องแปลงวันที่ไทยเป็นช่วง UTC (`bangkokDateRangeToUtc` / `buildBangkokDateRangeSql`) ห้ามใช้ `DATE(created_at) = <วันที่ไทย>`
- ห้ามลบ `stock_checks` ที่ถูก apply เข้า ledger แล้ว (จะเหลือรายการปรับยอดกำพร้า)
- `POST /api/inventory/init-balance` รับ `quantity` เป็นยอดเป้าหมาย (สัมบูรณ์) ไม่ใช่ส่วนต่าง

## บั๊กที่รู้แล้ว
ยืนยันจากการอ่านโค้ดเมื่อ 2026-10-07 · แก้ใน branch `inventory/stock-bugfix-2026-10-07` (Local ยังไม่ deploy) · test: `server/tests/stock-ledger.test.mjs` (ตรรกะล้วน: reflow, reference_id, ช่วงวันที่ไทย) ส่วนที่เป็น SQL ยังไม่ได้ทดสอบกับ MySQL จริง ต้อง smoke test บน DB จำลองใน SSD ก่อน deploy

| รหัส | ระดับ | ตำแหน่ง | อาการ | วิธีแก้ที่เสนอ | สถานะ |
|---|---|---|---|---|---|
| INV-01 | สูง | `recipe.controller.js` `syncUsageToInventory` · `inventory.model.js` `recalculateLedgerBalances` | แทรกรายการขายย้อนหลังก่อน stock_check ที่ apply แล้ว ทำให้ยอดถูกหักซ้ำ เพราะรายการนับเก็บส่วนต่างตายตัว และ sync ปรับ `inventory_balance` แบบ relative | รายการ stock_check เป็นยอดสัมบูรณ์ในการ reflow (เก็บยอดนับไว้ที่ `balance_after` ซึ่ง reflow ไม่แตะ แล้วคำนวณ `quantity` ใหม่); sync ขาย reflow ทุก (สินค้า, แผนก) ที่แตะใน transaction เดียวกัน | fixed (deploy `80d2e500`) |
| INV-02 | สูง | `inventory.model.js` `createProductionTransform` · `inventory.controller.js` `deleteSaleMovements` | แปรรูปย้อนหลังใช้ยอดปัจจุบันเป็น balance_before และไม่ reflow; ลบยอดขาย SELECT นอก transaction, ไม่ reflow, `last_transaction_id` ชี้แถวที่ถูกลบ | แปรรูป reflow ทุกสินค้าที่แตะ; ลบยอดขาย SELECT ... FOR UPDATE ใน transaction, ลบตาม id แล้ว reflow แทน UPDATE แบบ manual | fixed (deploy `80d2e500`) |
| INV-03 | สูง | `inventory.model.js` `createTransaction`, `createProductionTransform` | อ่าน `inventory_balance` โดยไม่ล็อกแล้วเขียนค่าสัมบูรณ์ → lost update เมื่อมี request พร้อมกัน | `lockBalanceRow` (INSERT … ON DUPLICATE KEY UPDATE แถวศูนย์ + SELECT FOR UPDATE; รุ่นแรกใช้ INSERT IGNORE แล้ว deadlock เมื่อเขียนพร้อมกัน แก้แล้วจาก smoke test) ก่อนคำนวณ; apply และ reflow ล็อกแถวเดียวกันก่อนเสมอ | fixed (deploy `80d2e500`) |
| INV-04 | กลาง | `inventory.model.js` `getStockVarianceReport` | `is_applied` ใช้ `LIKE 'date:id:%'` ไม่ตรงรูปแบบใหม่ `date:id`; `has_newer_applied` เทียบ `> 'date:'` จึงนับรายการวันเดียวกันของตัวเอง | `is_applied` = `'date:id' OR LIKE 'date:id:%'` (ใช้ `DATE_FORMAT`); `has_newer_applied` เทียบ `>=` วันถัดไป เหมือน `applyStockAdjustment`; ตรวจแล้ว `StockVariance.jsx` ไม่ต้องแก้ (ใช้ `!isApplied && has_newer_applied`) | fixed (deploy `80d2e500`) |
| INV-05 | กลาง | `getDashboardStats`, `getProductionTransformHistory`, `getTransactions`/`getProductStockCard` (ผ่าน `buildEffectiveTransactionDateExpr`), `deleteSaleMovements`, `applyAdjustment` (gate), `getRealtimeBalance`, `recipe.controller.js` `getUsageReport` | `DATE(created_at)` (UTC) เทียบกับวันที่ไทย ช่วง 00:00–07:00 ICT ตกวันก่อนหน้า | ช่วง `created_at >= start AND < nextDayStart` เป็น UTC จาก `bangkokDateRangeToUtc`; ฝั่ง effective date ใช้ `CONVERT_TZ(created_at,'+00:00','+07:00')` เฉพาะกิ่ง created_at (recipe_sale ที่อ่านจาก reference_id เป็นเวลาไทยอยู่แล้ว); `effective_at` ที่ส่งให้ client ไม่เปลี่ยน | fixed (deploy `80d2e500`) |
| INV-06 | กลาง | `inventory.model.js` CTE `system_qty_cte` | รายงานอ่าน `balance_after` ของแถวล่าสุด ≤ เวลานับ ขณะที่ apply ใช้ `SUM(quantity)` ทำให้ยอดระบบไม่ตรงกัน | ใช้ `SUM(quantity)` ≤ เวลานับ และ **ไม่นับรายการ stock_check ของการนับครั้งนี้เอง** ⇒ ยอดระบบ = ยอด "ก่อนปรับ" เสมอ ทั้งก่อนและหลัง apply; ส่วนต่างหลัง apply จึงยังเท่าเดิม เว้นแต่มีรายการย้อนหลังแทรกภายหลัง (ซึ่งแสดงส่วนต่างที่เป็นจริง) | fixed (deploy `80d2e500`) |
| INV-07 | ต่ำ | `inventory.model.js` `setInitialBalance` (เรียกจาก `initializeBalance`) · `stock-check.model.js` `clearStockChecksByDepartmentAndDate` | (a) `init-balance` บวก quantity เป็นส่วนต่างแทนที่จะตั้งยอด (b) ล้างเช็คสต็อกหลัง apply ทำให้รายการปรับยอดกำพร้า | (a) `delta = เป้าหมาย − ยอดปัจจุบัน(ล็อก)` บันทึก `initial`; ถ้า delta=0 ไม่สร้างรายการ ตอบ 200 `changed:false`; ค่าติดลบ → 400 (b) มีรายการ apply แล้ว → 409 ข้อความไทย (ยังไม่มีทางบังคับล้างสำหรับแอดมิน; client ปัจจุบันไม่มีหน้าที่เรียก `clearMyDepartmentCheck`) | fixed (deploy `80d2e500`) |

### พบเพิ่มระหว่างแก้ (ยังไม่แก้)
| รหัส | ระดับ | ตำแหน่ง | อาการ | สถานะ |
|---|---|---|---|---|
| INV-08 | กลาง | `inventory.controller.js` `getRealtimeBalance` | เช็ค `transaction_type = 'recipe_sale'` แต่ค่า enum ไม่มี (รายการขายตามสูตรคือ `transaction_type='sale'`, `reference_type='recipe_sale'`) จึงนับได้ 0 เสมอ → `already_synced` เป็น false ตลอด และอาจหัก ClickHouse ซ้ำกับยอดที่ sync แล้ว (แก้ช่วงวันที่ INV-05 แล้ว แต่ไม่แตะเงื่อนไขนี้เพราะเปลี่ยนพฤติกรรมหน้าจอ) | open |
| INV-09 | ต่ำ | `getTransactions` / `getProductStockCard` ORDER BY | เรียงด้วย `effective_at` ที่ผสมเวลาไทย (recipe_sale) กับ UTC (อื่น ๆ) ลำดับในหน้า movement/stock card จึงเหลื่อม 7 ชม. ระหว่างชนิดรายการ | open |
| INV-10 | กลาง | ข้อมูลเดิมใน production | ตรวจบนสำเนา 2026-10-07: stock_check 57/1,775 แถว `balance_after` ≠ ยอดนับ (19 แถวเป็นแถวล่าสุดของการนับ); reflow ใหม่เปลี่ยนยอด 20 คู่ ส่วนใหญ่เป็นการแก้ตัดซ้ำจาก INV-01 | ใช้ `balance_after` ต่อ (ต่างจากใช้ยอดนับแค่ 2 คู่); ตอน deploy รัน `scripts/reflow-stock-ledger-absolute.mjs` (dry-run แล้ว `--apply`) ครั้งเดียว; ปิดสคริปต์ reflow เก่า | fixed (reflow รันแล้ว 2026-10-07) |

## จุดเชื่อมระบบอื่น
- `ordering`/`receiving`, `store-po`, `withdraw`: เขียน ledger ผ่าน `createTransaction` หรือ SQL ของตัวเอง (ณ เวลาปัจจุบัน)
- `stock-check`: ต้นทางยอดนับ (`stock_checks`) และ safety gate ก่อน apply (ต้องมี recipe_sale ของวันนั้นหรือผ่าน ClickHouse)
- `production`: `recipe.controller.js` sync ขายตามสูตร, `createProductionTransform`/`updateProductionTransform`
