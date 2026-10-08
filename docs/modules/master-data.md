# ข้อมูลหลัก (`master-data`)

> status: core · review: not-started · อัปเดต: 2026-10-08

## หน้าที่
แอดมินตั้งค่าสินค้า ซัพพลายเออร์ หน่วย แผนก ผู้ใช้ ฯลฯ ที่ระบบอื่นอ้างอิง เอกสารนี้ตอนนี้บันทึกเฉพาะบั๊กเรื่องหน่วยและตัวคูณแปลงหน่วย (UNIT-01..05)

## Flow (หน่วย)
- หน่วยฐาน = `products.unit_id` (หน่วยที่เก็บสต๊อก)
- หน่วยซื้อ: `product_supplier_master_links.purchase_unit_id` + `purchase_to_base_multiplier` (1 หน่วยซื้อ = N หน่วยฐาน)
- หน่วยนับสต๊อก: `stock_templates.check_input_unit_id` + `check_to_base_multiplier` (1 หน่วยนับ = N หน่วยฐาน)
- `unit_conversions` เป็นตารางสากล (ทุกสินค้า) ใช้เฉพาะตัดสต๊อกจากสูตรเมนู (`convertQuantity` ใน `recipe.controller.js`, หาได้ทั้งสองทิศ)
- ตั้งค่ารวม: `PUT /api/product-unit-settings/:productId`, รายการ: `GET /api/product-unit-settings`

## กติกา (ห้ามผิด)
- การบันทึกตั้งค่าหน่วยของสินค้าหนึ่งตัวต้อง atomic (สินค้า + หน่วยซื้อ + หน่วยนับ ใน transaction เดียว)
- หน่วยของวัตถุดิบในสูตรต้องเป็นหน่วยฐานของสินค้า หรือมีตัวแปลงใน `unit_conversions`
- ห้ามเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง เว้นแต่ยืนยันด้วย `force_unit_change: true` (ระบบไม่แปลงจำนวนเดิมให้)
- ข้อสังเกต (พฤติกรรมเดิม ไม่ได้แก้): การบันทึกหน่วยซื้อ (`updateProductSupplierUnitConfig`) เขียนแถวหน่วยซื้อ→หน่วยฐานลง `unit_conversions` สากลด้วย (upsert ทับตัวคูณเดิม) จึงมีผลกับสูตรของสินค้าอื่นที่ใช้หน่วยคู่เดียวกัน

## บั๊กที่รู้แล้ว
| รหัส | ระดับ | ตำแหน่ง | อาการ | วิธีแก้ | สถานะ |
|---|---|---|---|---|---|
| UNIT-01 | สูง | `product-unit-settings.model.js` `saveProductUnitSettings` | `const [rows] = await listProductUnitSettings()` destructure array ผิด → throw → API 500 ทั้งที่เขียนข้อมูลแล้ว และไม่ atomic | ใช้ผลลัพธ์ตรง ๆ ผ่าน `findSettingsRow` (utils/unit-rules.js) และห่อทั้งชุดใน transaction เดียว (`updateProduct`/`updateProductSupplierUnitConfig`/`updateTemplate` รับ connection ภายนอก) | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-02 | สูง | `RecipeManagement.jsx` bulk add, `recipe.controller.js` | เลือกสินค้าใหม่แล้วหน่วยยังค้างของสินค้าก่อนหน้า สูตรหน่วยไม่ตรงหน่วยฐานทำให้ตัดสต๊อกไม่ได้ | client ตั้งหน่วยเป็นหน่วยฐานของสินค้าที่เลือกเสมอ + แสดงหน่วยฐาน/คำเตือน; server `addRecipeItem`/`updateRecipeItem` คืน 400 `RECIPE_UNIT_MISMATCH` ถ้าหน่วย ≠ หน่วยฐานและไม่มีตัวแปลง (ทั้งสองทิศ) | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-03 | กลาง | `ProductUnitSettings.jsx` | โหลดแค่ 500 จาก ~814 สินค้า แถวที่เหลือมองไม่เห็นโดยไม่มีข้อความ | limit สูงสุด 2000 (client ขอ 2000), API คืน `total` เพิ่ม (`data` เหมือนเดิม), UI แสดง "แสดง X จาก Y รายการ" | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-04 | กลาง | หน้าตั้งค่าหน่วยทั้งหมด | ไม่รู้ว่าตัวคูณทิศไหน (กรอกกลับทิศได้ง่าย) | แสดงประโยค "1 {หน่วย} = {N} {หน่วยฐาน}" สดข้างช่องกรอก, เปลี่ยนหัวคอลัมน์เป็นภาษาไทยบอกทิศ, เตือน (ไม่บล็อก) เมื่อ N < 1, หน้าแปลงหน่วยมีคำอธิบายว่าใช้กับทุกสินค้า/ตัดสต๊อกสูตรเท่านั้น | fixed in branch units/conversion-ux-fixes-2026-10-08 |
| UNIT-05 | สูง | `product.model.js` `updateProduct`, `saveProductUnitSettings` | เปลี่ยน `products.unit_id` ไม่แปลงสต๊อก/ledger/สูตร/ตัวคูณเดิม | ถ้ามี inventory_transactions, inventory_balance ≠ 0, menu_recipe_items, stock_checks, หน่วยซื้อ, หรือรายการ PO ที่ยังไม่ปิด → 409 พร้อมจำนวนอ้างอิง; ส่ง `force_unit_change: true` เพื่อบังคับ (ได้ `warning` กลับ); client เตือนใน inline และ confirm() ก่อนส่งซ้ำ | fixed in branch units/conversion-ux-fixes-2026-10-08 |

## ค้าง / นอกขอบเขต
- Snapshot ตัวคูณหน่วยซื้อใน PO (เปลี่ยนตัวคูณภายหลังกระทบ PO เก่า)
- หน่วยนับสต๊อกแยกตามแผนก (ตอนนี้ตั้งค่าใช้ template แรกของสินค้า)
- ผลข้างเคียงเขียน `unit_conversions` สากลจากการตั้งหน่วยซื้อ (ดูข้อสังเกตด้านบน)

## จุดเชื่อมระบบอื่น
inventory (ledger/balance), stock-check, production (สูตร), ordering/store-po (หน่วยซื้อ)
