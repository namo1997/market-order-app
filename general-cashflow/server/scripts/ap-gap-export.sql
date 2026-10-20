-- Owner-operated read-only export template. NOT executed by the AP importer.
-- Run only in the appropriate source system after owner review; tables may not exist yet.
-- Do not SELECT raw_json, recipient names/accounts, users or auth columns.
SET TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;
SELECT id, supplier_id, branch_id, business_date, item_key, quantity, unit_price, unit
FROM order_items WHERE business_date BETWEEN '2026-09-01' AND '2026-09-30';
SELECT id, supplier_id, branch_id, received_date, order_item_id, item_key, quantity, unit_price, unit
FROM receiving_documents WHERE received_date BETWEEN '2026-09-01' AND '2026-09-30';
-- Required separately: certified AP opening by supplier/branch at 2026-09-01;
-- full tax invoice evidence and gross/tax amounts; outgoing bank export with explicit debit,
-- stable payment/bill references and redacted account IDs. Never infer from matching amounts.
COMMIT;
