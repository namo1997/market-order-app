// Separate opt-in SYNTHETIC profile. No supplier contact, tax or account data.
export const MAERIM_PRODUCTS = [
  { name: 'SYNTHETIC สันป่าตองเก่า', unit: 'กระสอบ', code: 'SYN-2010', price: '410.00' },
  { name: 'SYNTHETIC ไข่เบอร์ 1', unit: 'แผง', code: 'SYN-5002', price: '139.00' },
  { name: 'SYNTHETIC มะลิใหม่กิ๊ก ศรีลานนา', unit: 'กระสอบ', code: 'SYN-11090', price: '1620.00' }
];
export async function seedMaerim(pool, source, date) {
  // The minimal pilot fixture intentionally has fixed product ids; this isolated profile also demos CREATE.
  await pool.query('ALTER TABLE products MODIFY id INT NOT NULL AUTO_INCREMENT');
  await pool.query(`CREATE TABLE IF NOT EXISTS stock_templates (
    id INT AUTO_INCREMENT PRIMARY KEY, department_id INT NOT NULL, product_id INT NOT NULL,
    category_id INT NULL, required_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_pilot_stock_template (department_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await source.productSetup.prepareSupplierProducts();
  await pool.query("INSERT INTO units (id,name,abbreviation) VALUES (2,'กระสอบ','กระสอบ'),(3,'แผง','แผง')");
  await pool.query("INSERT INTO product_groups (id,name,code) VALUES (1,'SYNTHETIC แม่ริมอินเตอร์ฟู้ดส์','SYN-PG-MAERIM')");
  await pool.query("INSERT INTO supplier_masters (id,name,code) VALUES (1,'SYNTHETIC แม่ริมอินเตอร์ฟู้ดส์','SYN-SM-MAERIM')");
  for (let index = 0; index < MAERIM_PRODUCTS.length; index++) {
    const p = MAERIM_PRODUCTS[index], id = index + 1, unitId = p.unit === 'แผง' ? 3 : 2;
    await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,1,?,?)', [id, p.name, `SYN-PRD-M${id}`, unitId, p.price]);
    await pool.query('INSERT INTO department_products (department_id,product_id,is_active) VALUES (1,?,true)', [id]);
    await pool.query('INSERT INTO stock_templates (department_id,product_id,required_quantity,min_quantity,daily_required,check_input_unit_id,check_to_base_multiplier) VALUES (1,?,0,0,false,?,1)', [id, unitId]);
    await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,1,true)', [id]);
    await pool.query('INSERT INTO product_supplier_master_links (product_id,supplier_master_id,is_primary) VALUES (?,1,true)', [id]);
    for (const key of ['sm:1', 'pg:1']) await pool.query(`INSERT INTO supplier_product_aliases
      (supplier_key, supplier_master_id, product_group_id, supplier_name_text, bill_text, normalized_bill_text,
       unit_text, normalized_unit_text, product_id, unit_id, unit_multiplier, confirm_count, item_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?)`, [key, key === 'sm:1' ? 1 : null, key === 'pg:1' ? 1 : null,
      'SYNTHETIC แม่ริมอินเตอร์ฟู้ดส์', p.name, source.ocr.normalizeMatchText(p.name), p.unit, source.ocr.normalizeMatchText(p.unit), id, unitId, p.code]);
  }
  const [order] = await pool.query("INSERT INTO orders (order_number,user_id,order_date,status) VALUES (?,?,?,'submitted')", [`SYNTHETIC-MAERIM-${date}`, 1, date]);
  for (let i = 0; i < MAERIM_PRODUCTS.length; i++) await pool.query('INSERT INTO order_items (order_id,product_id,quantity,requested_price) VALUES (?,?,?,?)', [order.insertId, i + 1, '2.00', MAERIM_PRODUCTS[i].price]);
  return { label: 'SYNTHETIC', profile: 'maerim', date, products: 3, aliases: 6, orders: 1, orderItems: 3,
    assumptions: ['หน่วยข้าวเป็นกระสอบ ใช้ทดสอบเท่านั้น', 'จำนวนสั่งตัวอย่าง 2 หน่วย ไม่ใช่ข้อมูลจริง'] };
}
