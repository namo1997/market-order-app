-- Sample Data for Market Order System
USE market_order_db;

-- 1. Branches (สาขา)
INSERT INTO branches (name, code) VALUES
('สาขากรุงเทพ', 'BKK'),
('สาขาเชียงใหม่', 'CNX'),
('สาขาภูเก็ต', 'HKT');

-- 2. Departments (แผนก)
INSERT INTO departments (branch_id, name, code) VALUES
-- สาขากรุงเทพ
(1, 'แผนกขาย', 'SALES'),
(1, 'แผนกครัว', 'KITCHEN'),
(1, 'แผนกบริการ', 'SERVICE'),
-- สาขาเชียงใหม่
(2, 'แผนกขาย', 'SALES'),
(2, 'แผนกครัว', 'KITCHEN'),
-- สาขาภูเก็ต
(3, 'แผนกขาย', 'SALES'),
(3, 'แผนกครัว', 'KITCHEN');

-- 3. Users (ผู้ใช้)
INSERT INTO users (username, password, name, department_id, role) VALUES
-- สาขากรุงเทพ
('admin_bkk', 'seed-password', 'ผู้ดูแลระบบ กรุงเทพ', 1, 'admin'),
('somchai_s', 'seed-password', 'สมชาย ใจดี', 1, 'user'),
('suda_k', 'seed-password', 'สุดา สุขใจ', 2, 'user'),
('manee_s', 'seed-password', 'มานี สวยงาม', 3, 'user'),
-- สาขาเชียงใหม่
('admin_cnx', 'seed-password', 'ผู้ดูแลระบบ เชียงใหม่', 4, 'admin'),
('peter_s', 'seed-password', 'ปีเตอร์ สมใจ', 4, 'user'),
('nok_k', 'seed-password', 'นก น่ารัก', 5, 'user'),
-- สาขาภูเก็ต
('admin_hkt', 'seed-password', 'ผู้ดูแลระบบ ภูเก็ต', 6, 'admin'),
('john_s', 'seed-password', 'จอห์น สบายดี', 6, 'user'),
('mai_k', 'seed-password', 'ใหม่ มีสุข', 7, 'user');

-- 4. Units (หน่วยสินค้า)
INSERT INTO units (name, abbreviation) VALUES
('กิโลกรัม', 'kg'),
('กรัม', 'g'),
('ลัง', 'box'),
('แพ็ค', 'pack'),
('ชิ้น', 'pcs'),
('หลอด', 'tube'),
('ขวด', 'bottle'),
('ห่อ', 'pack'),
('ถุง', 'bag'),
('ตัว', 'pcs');

-- 5. Suppliers (ซัพพลายเออร์)
INSERT INTO suppliers (name, code, contact_person, phone) VALUES
('ตลาดไทย จำกัด', 'TH001', 'คุณสมชาย', '02-123-4567'),
('ตลาดสดโภชนา', 'TS001', 'คุณสมหญิง', '02-234-5678'),
('บริษัท ผักสด จำกัด', 'VG001', 'คุณประยุทธ', '02-345-6789'),
('ร้านเนื้อสด เอ็กซ์เพรส', 'MT001', 'คุณสมศักดิ์', '02-456-7890'),
('ผลไม้สดทุกวัน', 'FR001', 'คุณสมปอง', '02-567-8901');

-- 6. Products (สินค้า)
INSERT INTO products (name, code, unit_id, supplier_id, default_price) VALUES
-- ผัก (จาก ผักสด)
('ผักบุ้งไทย', 'VG001', 1, 3, 25.00),
('คะน้า', 'VG002', 1, 3, 30.00),
('กะหล่ำปลี', 'VG003', 1, 3, 35.00),
('มะเขือเทศ', 'VG004', 1, 3, 40.00),
('แตงกวา', 'VG005', 1, 3, 25.00),

-- เนื้อสัตว์ (จาก ร้านเนื้อสด)
('หมูสามชั้น', 'MT001', 1, 4, 180.00),
('หมูสันใน', 'MT002', 1, 4, 220.00),
('ไก่สด (ตัว)', 'MT003', 10, 4, 150.00),
('เนื้อวัว', 'MT004', 1, 4, 280.00),
('ปลาดุก', 'MT005', 1, 4, 120.00),

-- ผลไม้ (จาก ผลไม้สดทุกวัน)
('ส้มโอ', 'FR001', 1, 5, 45.00),
('มะม่วง', 'FR002', 1, 5, 60.00),
('แตงโม', 'FR003', 1, 5, 20.00),
('องุ่น', 'FR004', 1, 5, 80.00),
('แอปเปิ้ล', 'FR005', 1, 5, 70.00),

-- สินค้าทั่วไป (จาก ตลาดไทย)
('น้ำมันพืช', 'GE001', 7, 1, 55.00),
('น้ำตาล', 'GE002', 1, 1, 45.00),
('เกลือ', 'GE003', 1, 1, 15.00),
('ซอสปรุงรส', 'GE004', 7, 1, 35.00),
('ข้าวสาร', 'GE005', 1, 1, 38.00);

-- 7. Order Status Settings (เปิดรับออเดอร์วันนี้)
INSERT INTO order_status_settings (order_date, is_open) VALUES
(CURDATE(), true);

-- 8. Orders (คำสั่งซื้อตัวอย่าง)
INSERT INTO orders (order_number, user_id, order_date, status, total_amount, submitted_at) VALUES
('ORD-20260111-001', 2, CURDATE(), 'submitted', 320.00, NOW()),
('ORD-20260111-002', 3, CURDATE(), 'submitted', 550.00, NOW()),
('ORD-20260111-003', 6, CURDATE(), 'draft', 0, NULL);

-- 9. Order Items (รายการสินค้าในคำสั่งซื้อ)
-- คำสั่งซื้อที่ 1 (สมชาย)
INSERT INTO order_items (order_id, product_id, quantity, requested_price) VALUES
(1, 1, 2.00, 25.00),  -- ผักบุ้ง 2 kg
(1, 6, 1.50, 180.00), -- หมูสามชั้น 1.5 kg
(1, 16, 1.00, 55.00); -- น้ำมันพืช 1 ขวด

-- คำสั่งซื้อที่ 2 (สุดา)
INSERT INTO order_items (order_id, product_id, quantity, requested_price) VALUES
(2, 7, 2.00, 220.00), -- หมูสันใน 2 kg
(2, 2, 1.50, 30.00),  -- คะน้า 1.5 kg
(2, 11, 2.00, 45.00); -- ส้มโอ 2 kg

-- คำสั่งซื้อที่ 3 (draft - ปีเตอร์)
INSERT INTO order_items (order_id, product_id, quantity, requested_price) VALUES
(3, 8, 1.00, 150.00), -- ไก่สด 1 ตัว
(3, 5, 1.00, 25.00);  -- แตงกวา 1 kg
