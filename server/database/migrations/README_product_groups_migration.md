# Product Groups Migration Plan

## Goal
- Rename business concept from `suppliers` to `product_groups`.
- Move product linkage from `products.supplier_id` to `products.product_group_id`.
- Keep compatibility during transition so existing code does not break immediately.

## Naming Rule (Important)
- `product_groups` = กลุ่มสินค้า (ใช้จัดหมวดสินค้า/สิทธิ์แสดงผล)
- `supplier_masters` = ซัพพลายเออร์จริง (ผู้ขายจริง เช่น แมคโคร)
- `products.product_group_id` = ผูกสินค้าเข้ากลุ่มสินค้า
- `products.supplier_master_id` = ผูกสินค้าเข้าซัพพลายเออร์จริง (optional)
- `products.supplier_id` = ฟิลด์เก่าเพื่อ compatibility เท่านั้น

## What Migration Script Does
- Script: `server/scripts/migrate-product-groups.js`
- Creates backups:
  - `backup_suppliers_pre_product_groups`
  - `backup_products_pre_product_groups`
- Renames table `suppliers` -> `product_groups` (if needed).
- Creates compatibility view `suppliers` (if no base table named `suppliers` remains).
- Ensures `product_groups` has columns:
  - `is_internal`
  - `linked_branch_id`
  - `linked_department_id`
- Ensures `products` has both columns:
  - `product_group_id` (new canonical)
  - `supplier_id` (compatibility)
- Syncs both columns and adds FK/index for `product_group_id`.
- Creates triggers to keep `supplier_id` and `product_group_id` in sync.

## Apply Steps
1. Stop write-heavy actions (recommended short maintenance window).
2. Backup DB (recommended full backup):
   - `mysqldump -h <host> -u <user> -p <db> > pre_product_groups.sql`
3. Run migration:
   - `npm --prefix server run migrate:product-groups`
4. Restart backend:
   - `pm2 restart market-order-server`

## Verification
Run checks:
- `SHOW FULL TABLES LIKE 'product_groups';`
- `SHOW FULL TABLES LIKE 'suppliers';` (should be `VIEW` in migrated state)
- `SHOW COLUMNS FROM products LIKE 'product_group_id';`
- `SHOW COLUMNS FROM products LIKE 'supplier_id';`
- `SELECT COUNT(*) FROM product_groups;`
- `SELECT COUNT(*) FROM products WHERE product_group_id IS NOT NULL;`

API checks:
- `GET /api/product-groups`
- `GET /api/products/meta/product-groups`
- Existing legacy endpoints still should work:
  - `/api/suppliers`
  - `/api/products/meta/suppliers`

## Rollback Plan
- Script: `server/scripts/rollback-product-groups.js`
- Creates rollback backups:
  - `backup_product_groups_pre_rollback`
  - `backup_suppliers_pre_rollback`
  - `backup_products_pre_rollback`
- Drops sync triggers.
- Copies `product_group_id` back to `supplier_id`.
- Drops `products.product_group_id`.
- Drops compatibility view `suppliers` (if view).
- Renames table `product_groups` -> `suppliers`.

## Rollback Steps
1. Run rollback:
   - `npm --prefix server run rollback:product-groups`
2. Restart backend:
   - `pm2 restart market-order-server`
3. Recheck:
   - `SHOW FULL TABLES LIKE 'suppliers';` (should be `BASE TABLE`)
   - `SHOW COLUMNS FROM products LIKE 'supplier_id';`
   - `SHOW COLUMNS FROM products LIKE 'product_group_id';` (should not exist)

## Notes
- DDL in MySQL auto-commits; this is why explicit backup tables are created first.
- Compatibility is intentional for phased rollout. Final cleanup can remove `supplier_id` and old endpoints after all code paths are migrated.
