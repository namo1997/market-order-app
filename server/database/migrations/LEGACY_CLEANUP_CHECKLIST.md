# Legacy Cleanup Checklist (Product Group vs Supplier)

เอกสารนี้ใช้สำหรับตัด legacy แบบปลอดภัย โดยไม่ทำระบบพัง

## เป้าหมาย
- ใช้คำว่า `product group` เป็นหลักในระบบ
- แยก `supplier_masters` (ซัพพลายเออร์จริง) ออกจาก `product_groups` (กลุ่มสินค้า)
- ตัด compatibility เก่าทีละเฟส พร้อม rollback ทุกเฟส

## หลักการความปลอดภัย
- ตัดทีละชั้น: `code` ก่อน `database`
- ทุกเฟสต้องมี backup ก่อน
- ผ่าน checklist ก่อน deploy Railway
- ถ้าตรวจพบ fail ให้หยุดทันทีและ rollback เฉพาะเฟส

---

## เฟส 0: Pre-flight (ต้องผ่านก่อนเริ่ม)
1. ดึงโค้ดล่าสุดในเครื่อง
2. รัน readiness check:
   - `npm --prefix server run check:legacy-cleanup`
3. เก็บ backup ฐานข้อมูล:
   - `mysqldump -h <host> -u <user> -p <db> > pre_legacy_cleanup.sql`
4. ยืนยันว่า branch production ยังไม่ deploy ระหว่าง migration

---

## เฟส 1: Code Cleanup (ไม่แตะ schema)
สิ่งที่ทำ:
- เปลี่ยนชื่อ function/variable ฝั่งโค้ดให้เป็น `productGroup*`
- ยังคง alias เดิม `supplier*` ไว้เพื่อไม่ให้ endpoint เก่าพัง

ผ่านเฟสเมื่อ:
- `node --check` ฝั่ง server ผ่าน
- `npm --prefix client run build` ผ่าน
- หน้าใช้งานหลักเข้าได้ปกติ:
  - `/order`
  - `/order/receive`
  - `/admin/settings/product-groups`
  - `/admin/settings/suppliers`

rollback เฟส 1:
- revert เฉพาะ commit ของเฟส 1
- deploy กลับเวอร์ชันก่อนหน้า

---

## เฟส 2: API Contract Cleanup (ยังไม่ลบ DB legacy)
สิ่งที่ทำ:
- ให้ frontend เรียก endpoint canonical เท่านั้น (`/product-groups`)
- endpoint legacy (`/suppliers`) ยังคงเปิดไว้ชั่วคราวเป็น compatibility

ผ่านเฟสเมื่อ:
- ไม่มีหน้าหลักไหนเรียก endpoint legacy โดยตรง
- ตรวจจาก log ว่าไม่มี 4xx/5xx เพิ่มขึ้นหลัง deploy

rollback เฟส 2:
- เปิดใช้ fallback เดิมใน client API
- redeploy ทันที

---

## เฟส 3: Database Legacy Cleanup (ทำใน maintenance window)
คำเตือน: เฟสนี้มีความเสี่ยงสูงสุด

### เฟส 3A (แนะนำให้ทำก่อน: non-breaking)
สิ่งที่ทำ:
- เพิ่ม `product_group_id` ในตาราง scope ทั้ง 2 ตาราง
  - `product_group_scopes`
  - `product_group_internal_scopes`
- sync ค่า `supplier_id` <-> `product_group_id`
- เพิ่ม trigger sync เพื่อคง compatibility

คำสั่ง:
- `npm --prefix server run migrate:scope-product-groups`

rollback:
- `npm --prefix server run rollback:scope-product-groups`

ผ่านเฟสเมื่อ:
- ไม่มี mismatch ระหว่าง `supplier_id` กับ `product_group_id` ใน scope tables
- หน้าล็อกอิน/สิทธิ์กลุ่มภายในยังทำงานปกติ

---

### เฟส 3B (destructive)
สิ่งที่จะตัด:
- `products.supplier_id` (legacy)
- `product_group_scopes.supplier_id` (legacy)
- `product_group_internal_scopes.supplier_id` (legacy)
- sync triggers (`trg_products_sync_group_before_insert`, `trg_products_sync_group_before_update`)
- view `suppliers` (compatibility view) เมื่อมั่นใจว่าไม่มีโค้ดพึ่งพา

ทำก่อนตัด:
1. backup:
   - `mysqldump -h <host> -u <user> -p <db> > pre_phase3_drop_legacy.sql`
2. ยืนยัน readiness ผ่านอีกครั้ง
3. freeze deploy อื่นๆ ชั่วคราว

ตัวอย่าง SQL ตัด legacy (รันเมื่อพร้อมจริงเท่านั้น):
```sql
-- 1) ensure sync ก่อนตัด
UPDATE products
SET product_group_id = COALESCE(product_group_id, supplier_id);

-- 2) drop triggers
DROP TRIGGER IF EXISTS trg_products_sync_group_before_insert;
DROP TRIGGER IF EXISTS trg_products_sync_group_before_update;

-- 3) drop FK/index ของ supplier_id (ชื่อจริงอาจต่างกัน ให้เช็คก่อน)
-- ALTER TABLE products DROP FOREIGN KEY products_ibfk_2;
-- ALTER TABLE products DROP INDEX idx_supplier;

-- 4) drop legacy column
-- ALTER TABLE products DROP COLUMN supplier_id;

-- 5) drop compatibility view
-- DROP VIEW IF EXISTS suppliers;
```

คำสั่ง script ที่ใช้จริง:
- ตัด legacy:
  - `npm --prefix server run migrate:drop-supplier-legacy`
- ตรวจหลังตัด:
  - `npm --prefix server run check:post-drop-supplier-legacy`
- rollback:
  - `npm --prefix server run rollback:drop-supplier-legacy`

ผ่านเฟสเมื่อ:
- API และทุกหน้าหลักทำงานได้โดยไม่อิง `supplier_id`
- ไม่มี query fail เรื่อง `products.supplier_id` หรือ `suppliers` view

rollback เฟส 3:
1. restore จาก `pre_phase3_drop_legacy.sql` หรือ
2. ใช้สคริปต์ rollback เดิม:
   - `npm --prefix server run rollback:product-groups`
3. redeploy backend เวอร์ชันก่อนหน้า

---

## ก่อน Deploy Railway (Final Gate)
ต้องผ่านครบ:
1. `npm --prefix server run check:legacy-cleanup`
2. `npm --prefix client run build`
3. ทดสอบ flow จริง 6 จุด:
   - สั่งสินค้า
   - รับสินค้า
   - เดินซื้อของ
   - รายงานรวมซัพ/กลุ่ม
   - จัดการกลุ่มสินค้า
   - จัดการซัพพลายเออร์จริง
4. ดู Railway logs 15-30 นาทีหลัง deploy:
   - ไม่มี error ใหม่ที่มีคำว่า `supplier_id`, `suppliers view`, `unknown column`

ถ้าพบ error ให้ rollback ทันทีตามเฟสล่าสุด
