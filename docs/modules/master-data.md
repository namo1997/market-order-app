# ข้อมูลหลัก (`master-data`)

> status: core · review: not-started · อัปเดต: 2026-10-20

## หน้าที่
แอดมินตั้งค่าสินค้า ซัพพลายเออร์ หน่วย แผนก ผู้ใช้ ฯลฯ ที่ระบบอื่นอ้างอิง เอกสารนี้บันทึกบั๊กเรื่องหน่วยและตัวคูณแปลงหน่วย (UNIT-01..11)

## Flow (หน่วย)
- หน่วยฐาน = `products.unit_id` (หน่วยที่เก็บสต๊อก)
- หน่วยซื้อ: `product_supplier_master_links.purchase_unit_id` + `purchase_to_base_multiplier` (1 หน่วยซื้อ = N หน่วยฐาน)
- หน่วยนับสต๊อก: `stock_templates.check_input_unit_id` + `check_to_base_multiplier` (1 หน่วยนับ = N หน่วยฐาน)
- `unit_conversions` เป็นตารางสากล (ทุกสินค้า) ใช้เฉพาะตัดสต๊อกจากสูตรเมนู (`convertQuantity` ใน `recipe.controller.js`, หาได้ทั้งสองทิศ)
- ตั้งค่ารวม: `PUT /api/product-unit-settings/:productId`, รายการ: `GET /api/product-unit-settings`
- `GET /api/units` เดิมคืนเฉพาะหน่วย active รูปแบบเดิม; `with_usage=1` เพิ่ม `usage`; `include_inactive=1` รวมหน่วยที่ลบแล้วพร้อม usage เฉพาะ admin/super_admin
- `POST /api/units/:id/restore` (admin/super_admin) กู้คืนหน่วยเดิมโดยไม่เปลี่ยน id และไม่เขียนทับชื่อ/ตัวย่อจากฟอร์มเพิ่ม

## กติกา (ห้ามผิด)
- การบันทึกตั้งค่าหน่วยของสินค้าหนึ่งตัวต้อง atomic (สินค้า + หน่วยซื้อ + หน่วยนับ ใน transaction เดียว)
- หน่วยของวัตถุดิบในสูตรต้องเป็นหน่วยฐานของสินค้า หรือมีตัวแปลงใน `unit_conversions`
- ห้ามเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง เว้นแต่ยืนยันด้วย `force_unit_change: true` (ระบบไม่แปลงจำนวนเดิมให้)
- ลบหน่วยได้เฉพาะเมื่อไม่มีข้อมูลอ้างอิง: สินค้าทั้งเปิดใช้/ปิดใช้, หน่วยซื้อ, แบบเช็คสต๊อก, สูตร, วัตถุดิบแปรรูป และตัวแปลงทั้งสองทิศ (ประวัติ `stock_checks.input_unit_id` ไม่กันลบ)
- `usage` ใช้ key `products_active`, `products_inactive`, `purchase_unit_links`, `stock_templates`, `menu_recipe_items`, `production_ingredients`, `usage_units` (หน่วยใช้แปรรูป), `unit_conversions`; นับทุกแถวอ้างอิงโดยไม่กรองสถานะ ยกเว้นแยกสถานะสินค้า; ตาราง/คอลัมน์ lazy ที่ยังไม่มี (`ER_NO_SUCH_TABLE`/1146, `ER_BAD_FIELD_ERROR`/1054 เช่น `purchase_unit_id` ก่อน ensure) นับ 0 แต่ข้อผิดพลาดอื่นส่งต่อ
- ชื่อ/ตัวย่อต้องไม่ว่าง ตัดช่องว่างหน้าหลังและยุบช่องว่างซ้ำ ยาวไม่เกิน 50/10 code point; ชื่อซ้ำรวมหน่วยที่ลบแล้วคืน 409 (`UNIT_NAME_EXISTS`/`UNIT_NAME_INACTIVE`); ลบหน่วยที่ยังใช้คืน 409 `UNIT_IN_USE`
- แก้สินค้าเลือกหน่วยเดิมด้วย id เท่านั้น หากไม่อยู่ในรายการ active ให้เก็บ id เดิมพร้อม option ชั่วคราว ไม่เดาจากชื่อบางส่วน
- UNIT-06 (แก้แล้วใน branch): เดิมการบันทึกหน่วยซื้อ (`updateProductSupplierUnitConfig`) เขียนทับแถวหน่วยซื้อ→หน่วยฐานลง `unit_conversions` สากล ทำให้สูตรของสินค้าอื่นที่ใช้หน่วยคู่เดียวกันคำนวณผิด ตอนนี้ตัวคูณหน่วยซื้อเก็บเฉพาะใน `product_supplier_master_links`

## บั๊กที่รู้แล้ว
| รหัส | ระดับ | ตำแหน่ง | อาการ | วิธีแก้ | สถานะ |
|---|---|---|---|---|---|
| UNIT-01 | สูง | `product-unit-settings.model.js` `saveProductUnitSettings` | `const [rows] = await listProductUnitSettings()` destructure array ผิด → throw → API 500 ทั้งที่เขียนข้อมูลแล้ว และไม่ atomic | ใช้ผลลัพธ์ตรง ๆ ผ่าน `findSettingsRow` (utils/unit-rules.js) และห่อทั้งชุดใน transaction เดียว (`updateProduct`/`updateProductSupplierUnitConfig`/`updateTemplate` รับ connection ภายนอก) | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-02 | สูง | `RecipeManagement.jsx` bulk add, `recipe.controller.js` | เลือกสินค้าใหม่แล้วหน่วยยังค้างของสินค้าก่อนหน้า สูตรหน่วยไม่ตรงหน่วยฐานทำให้ตัดสต๊อกไม่ได้ | client ตั้งหน่วยเป็นหน่วยฐานของสินค้าที่เลือกเสมอ + แสดงหน่วยฐาน/คำเตือน; server `addRecipeItem`/`updateRecipeItem` คืน 400 `RECIPE_UNIT_MISMATCH` ถ้าหน่วย ≠ หน่วยฐานและไม่มีตัวแปลง (ทั้งสองทิศ) | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-03 | กลาง | `ProductUnitSettings.jsx` | โหลดแค่ 500 จาก ~814 สินค้า แถวที่เหลือมองไม่เห็นโดยไม่มีข้อความ | limit สูงสุด 2000 (client ขอ 2000), API คืน `total` เพิ่ม (`data` เหมือนเดิม), UI แสดง "แสดง X จาก Y รายการ" | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-04 | กลาง | หน้าตั้งค่าหน่วยทั้งหมด | ไม่รู้ว่าตัวคูณทิศไหน (กรอกกลับทิศได้ง่าย) | แสดงประโยค "1 {หน่วย} = {N} {หน่วยฐาน}" สดข้างช่องกรอก, เปลี่ยนหัวคอลัมน์เป็นภาษาไทยบอกทิศ, เตือน (ไม่บล็อก) เมื่อ N < 1, หน้าแปลงหน่วยมีคำอธิบายว่าใช้กับทุกสินค้า/ตัดสต๊อกสูตรเท่านั้น | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-05 | สูง | `product.model.js` `updateProduct`, `saveProductUnitSettings` | เปลี่ยน `products.unit_id` ไม่แปลงสต๊อก/ledger/สูตร/ตัวคูณเดิม | ถ้ามี inventory_transactions, inventory_balance ≠ 0, menu_recipe_items, stock_checks, หน่วยซื้อ, หรือรายการ PO ที่ยังไม่ปิด → 409 พร้อมจำนวนอ้างอิง; ส่ง `force_unit_change: true` เพื่อบังคับ (ได้ `warning` กลับ); client เตือนใน inline และ confirm() ก่อนส่งซ้ำ | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-06 | สูง | `product.model.js` `updateProductSupplierUnitConfig` | ตั้งค่าหน่วยซื้อเขียนทับตัวแปลงสากล กระทบสูตรสินค้าอื่น | เก็บตัวคูณเฉพาะ `product_supplier_master_links` | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-07 | สูง | `units.controller.js` `deleteUnit` | ลบหน่วยที่สินค้า/หน่วยซื้อ/สูตร/ตัวแปลงยังใช้อยู่ ทำให้หายจาก dropdown | ตรวจทุกตารางอ้างอิง คืน 409 พร้อม usage และปิดปุ่มลบในหน้าแอดมิน | fixed in branch units/unit-management-safety-20261020 |
| UNIT-08 | สูง | `ProductManagement.jsx` `openEdit` | fallback ชื่อบางส่วนทำให้บันทึกแล้วเปลี่ยนหน่วยเงียบ ๆ หรือ id ว่าง | จับคู่ id เท่านั้น คงหน่วยเดิมที่ถูกลบเป็น option ชั่วคราวและล้างเมื่อเปิดฟอร์มใหม่ | fixed in branch units/unit-management-safety-20261020 |
| UNIT-09 | กลาง | `units` UNIQUE(name) + soft delete | เพิ่มชื่อซ้ำรวมหน่วยที่ถูกลบได้ 500 และกู้คืนไม่ได้ | ตรวจชื่อซ้ำ/ดัก ER_DUP_ENTRY คืน 409 พร้อมหน่วยที่ชน และเพิ่ม route/ปุ่มกู้คืน | fixed in branch units/unit-management-safety-20261020 |
| UNIT-10 | กลาง | `updateUnit` | ไม่ตรวจ/trim/จำกัดความยาว ไม่คืน 404 และชื่อซ้ำได้ 500 | normalize ชื่อ/ตัวย่อ นับ code point 50/10 คืน 400/404/409 ตามกรณี | fixed in branch units/unit-management-safety-20261020 |
| UNIT-11 | ต่ำ | `UnitManagement.jsx` นำเข้า CSV | ไม่บอกแถว/เหตุผลของชื่อซ้ำหรือข้อความยาวเกิน | นำเข้าตามลำดับ ข้ามชื่อ active/ซ้ำในไฟล์ ตรวจความยาว และสรุปสำเร็จ/ข้าม/ล้มเหลวพร้อมเลขบรรทัดจริง | fixed in branch units/unit-management-safety-20261020 |

## การตรวจชุด UNIT-07..11 (Local)
- สถานะ Local ยังไม่ deploy; ผลต่อไปนี้เป็นผลตรวจที่ Claude รายงานก่อนรอบแก้ตามรีวิว 2026-10-20
- node:test 3 ไฟล์ที่เกี่ยวข้อง (`unit-master-rules`, `unit-rules`, `stock-ledger`) ผ่าน; `super-admin-line-login.test.mjs` ล้มใน SSD runner เพราะสำเนาไม่มี `server/node_modules` (`jsonwebtoken`) ไม่เกี่ยวกับงานนี้
- client build บน SSD ผ่าน; API scenario กับ DB สำเนา Production (backup 7 ต.ค. 2026) บน SSD ผ่าน 18/18
- UI desktop 1440 / มือถือ 375 ตรวจแล้วไม่มี horizontal scroll; แอปไม่มี dark mode ทั้งระบบ; ลบ/กู้คืน/สวิตช์หน่วยที่ลบแล้ว/ปุ่มลบ disabled ทำงาน และ UNIT-08 คง “ตัว (ถูกลบแล้ว)” ไม่เปลี่ยนเป็น “ตัวนับ”
- หน่วยที่ไม่มีการใช้เลยในสำเนา = กรัม, ฝอง
- หลักฐาน: `/Volumes/SSD Files/SOLAO/market-order-system/previews/unit-mgmt-20261020/` (`api-scenarios.mjs`, `logs/api-scenarios.log`)
- ตัวกันลบนับตารางระบบรับสินค้าด้วย (UNIT-07 ต่อเนื่อง, 2026-10-20, Local บน branch `receiving/release-port-20261020`): `receiving_document_lines.unit_id` (รายการรับสินค้า), `supplier_product_aliases.unit_id` (ชื่อบิลที่ระบบจำไว้), `supplier_product_alias_events.unit_id` (ประวัติชื่อบิลที่ระบบจำไว้) — ตารางเหล่านี้ไม่มี FK หน่วยที่ใช้เฉพาะที่นี่เดิมลบได้ ตอนนี้คืน 409 พร้อม usage และหน้าแอดมินแสดงเหตุผลเดียวกับแหล่งอื่น; ตารางที่ยังไม่ถูกสร้าง (production ไม่สร้างตารางรับสินค้าอัตโนมัติ) ถูกข้ามเหมือนเดิม; ทดสอบด้วย `server/tests/unit-usage-receiving.test.mjs`
- รอบแก้ตามรีวิว: จัดปุ่มแก้ไข/ลบบรรทัดเดียวชิดขวา gap เท่ากัน เอาเหตุผลซ้ำใต้แถวออกและใส่คำอธิบายรวมสีเทา คง tooltip พร้อมเพิ่ม aria-disabled/aria-label บอกเหตุผล; รองรับตาราง/คอลัมน์ lazy ที่ยังไม่มีใน usage
- หลังแก้รอบนี้: `node --test server/tests/unit-master-rules.test.mjs server/tests/unit-rules.test.mjs` ผ่าน 15/15; `git diff --check` ผ่าน; ไม่ได้รัน build/API/UI ซ้ำ
- การนับก่อนลบเป็นการตรวจข้อมูล ณ เวลานั้น ยังไม่ได้เปลี่ยน writer ทุกโมดูลให้ล็อกหน่วยร่วมกัน จึงต้องทดสอบ/ประเมินกรณีเพิ่มข้อมูลอ้างอิงพร้อมกับลบก่อนปล่อยจริง

## หน่วยใช้ (UNIT-12)
- `product_usage_units(product_id PK, usage_unit_id, usage_per_base)` — 1 หน่วยฐาน = `usage_per_base` หน่วยใช้ (แกลลอน → มล. = 4500); สร้างแบบ lazy ใน `product-usage-unit.model.js`
- ใช้เฉพาะหน้าแปรรูป: client ส่ง `ingredients[].input_unit_id` server แปลง/ปัด 2 ตำแหน่งก่อนตัดสต๊อก; สต๊อก สั่งของ เบิก ยังเป็นหน่วยฐาน
- ตั้งค่า/ลบที่ `PUT /api/product-unit-settings/:productId` ด้วย `usage_unit_id`, `usage_per_base` (ไม่ส่ง key = ไม่แตะค่าเดิม, ค่าว่างหรือเท่าหน่วยฐาน = ลบ)

- UNIT-13: แท็บ "ตั้งค่าแปลงหน่วย" ในหน้าแปรรูป ใช้ `GET/PUT /api/inventory/production/usage-units` จำกัดเฉพาะวัตถุดิบในสูตรแปรรูปของแผนก (ผู้ใช้ฝ่ายผลิตแก้ได้เฉพาะแผนกตัวเอง)

## ค้าง / นอกขอบเขต
- Production มี deployment `e4a28baa` (14 ต.ค. 2026) ที่ไม่มีบันทึก ต้องเทียบฐานก่อน deploy งานนี้
- รวมหน่วยซ้ำ เช่น กก./กิโลกรัม ยังไม่ทำ — รออนุมัติข้อ 3
- Snapshot ตัวคูณหน่วยซื้อใน PO (เปลี่ยนตัวคูณภายหลังกระทบ PO เก่า)
- หน่วยนับสต๊อกแยกตามแผนก (ตอนนี้ตั้งค่าใช้ template แรกของสินค้า)
- (UNIT-06 แก้แล้ว) ไม่เขียน `unit_conversions` จากการตั้งหน่วยซื้ออีก

## จุดเชื่อมระบบอื่น
inventory (ledger/balance), stock-check, production (สูตร), ordering/store-po (หน่วยซื้อ)
