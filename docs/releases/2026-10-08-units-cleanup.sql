-- รวมหน่วยซ้ำและตั้งตัวย่อเป็นภาษาไทย (2026-10-08)
START TRANSACTION;
-- ปลดชื่อหน่วยที่จะเลิกใช้ เพื่อไม่ชน UNIQUE(name) ของหน่วยหลัก
UPDATE units SET name='กิโลกรัม (เลิกใช้ id1)', is_active=0 WHERE id=1;
UPDATE units SET name='กป. (เลิกใช้ id12)', is_active=0 WHERE id=12;
UPDATE units SET name='แกลอน (เลิกใช้ id24)', is_active=0 WHERE id=24;
UPDATE units SET name='ปิ๊บ (เลิกใช้ id26)', is_active=0 WHERE id=26;
UPDATE units SET name='ตัวนับ (เลิกใช้ id18)', is_active=0 WHERE id=18;
-- หน่วยหลัก: ชื่อเต็ม + ตัวย่อไทย
UPDATE units SET name='กิโลกรัม', abbreviation='กก.' WHERE id=11;
UPDATE units SET name='กระป๋อง', abbreviation='กป.' WHERE id=37;
UPDATE units SET name='แกลลอน', abbreviation='ก.ล.' WHERE id=22;
UPDATE units SET name='ปี๊บ', abbreviation='ปี๊บ' WHERE id=33;
UPDATE units SET name='ตัว', abbreviation='ตัว' WHERE id=10;
-- ตัวย่ออังกฤษ/ผิดรูป -> ไทย
UPDATE units SET abbreviation='ถุง' WHERE id=9;
UPDATE units SET abbreviation='แพ็ค' WHERE id=4;
UPDATE units SET abbreviation='ชิ้น' WHERE id=5;
UPDATE units SET abbreviation='ลัง' WHERE id=3;
UPDATE units SET abbreviation='ก.' WHERE id=2;
UPDATE units SET abbreviation='เล่ม' WHERE id=39;
UPDATE units SET name='ฟอง', abbreviation='ฟอง' WHERE id=31;
-- ย้ายการอ้างอิงจากหน่วยเลิกใช้ -> หน่วยหลัก
CREATE TEMPORARY TABLE unit_map (old_id INT PRIMARY KEY, new_id INT NOT NULL);
INSERT INTO unit_map VALUES (1,11),(12,37),(24,22),(26,33),(18,10);
UPDATE products t JOIN unit_map m ON t.unit_id=m.old_id SET t.unit_id=m.new_id;
UPDATE menu_recipe_items t JOIN unit_map m ON t.unit_id=m.old_id SET t.unit_id=m.new_id;
UPDATE product_supplier_master_links t JOIN unit_map m ON t.purchase_unit_id=m.old_id SET t.purchase_unit_id=m.new_id;
UPDATE production_transform_config_required_ingredients t JOIN unit_map m ON t.input_unit_id=m.old_id SET t.input_unit_id=m.new_id;
UPDATE stock_checks t JOIN unit_map m ON t.input_unit_id=m.old_id SET t.input_unit_id=m.new_id;
UPDATE stock_templates t JOIN unit_map m ON t.check_input_unit_id=m.old_id SET t.check_input_unit_id=m.new_id;
UPDATE unit_conversions t JOIN unit_map m ON t.from_unit_id=m.old_id SET t.from_unit_id=m.new_id;
UPDATE unit_conversions t JOIN unit_map m ON t.to_unit_id=m.old_id SET t.to_unit_id=m.new_id;
-- โค้กซีโร่: สูตรขายใช้หน่วยขวด แต่สินค้าเป็นกระป๋อง -> ใช้หน่วยของสินค้า
UPDATE menu_recipe_items r JOIN products p ON p.id=r.product_id
  SET r.unit_id=p.unit_id
  WHERE p.name='Coca-Cola #โค้กซีโร่' AND r.unit_id=7 AND p.unit_id=37;
-- ตรวจ
SELECT 'refs_to_retired' chk,
  (SELECT COUNT(*) FROM products WHERE unit_id IN (1,12,24,26,18)) +
  (SELECT COUNT(*) FROM menu_recipe_items WHERE unit_id IN (1,12,24,26,18)) +
  (SELECT COUNT(*) FROM product_supplier_master_links WHERE purchase_unit_id IN (1,12,24,26,18)) +
  (SELECT COUNT(*) FROM production_transform_config_required_ingredients WHERE input_unit_id IN (1,12,24,26,18)) +
  (SELECT COUNT(*) FROM stock_checks WHERE input_unit_id IN (1,12,24,26,18)) +
  (SELECT COUNT(*) FROM stock_templates WHERE check_input_unit_id IN (1,12,24,26,18)) AS n;
SELECT 'recipe_unit_mismatch' chk, COUNT(*) n FROM menu_recipe_items r JOIN products p ON p.id=r.product_id WHERE r.unit_id<>p.unit_id;
SELECT 'english_abbr' chk, COUNT(*) n FROM units WHERE is_active=1 AND abbreviation REGEXP '[A-Za-z()]';
COMMIT;
