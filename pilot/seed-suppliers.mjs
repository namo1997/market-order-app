// SYNTHETIC "suppliers-2026-10" profile: the seven suppliers the owner photographed on 2026-10-20.
// Names, product names, units, prices, ordering modes and the owner-confirmed bill aliases follow
// supplier-setup/SUPPLIERS.md. Bank accounts, tax ids and phone numbers are never part of this data.
// Units/prices that the registry does not state are marked `assumed` and listed in the pilot README.

export const SUPPLIER_UNITS = [
  { id: 1, name: 'กิโลกรัม', abbreviation: 'กก.' }, { id: 2, name: 'ถุง', abbreviation: 'ถุง' },
  { id: 3, name: 'แผง', abbreviation: 'แผง' }, { id: 4, name: 'แถว', abbreviation: 'แถว' },
  { id: 5, name: 'กล่อง', abbreviation: 'กล่อง' }, { id: 6, name: 'ห่อ', abbreviation: 'ห่อ' }
];

// The owner confirmed on 2026-10-20 that "บ้านแจ้" and "สันกำแพง" (ต้นเปา) are one and the same branch.
const SAME_BRANCH = 'บ้านแจ้ = สันกำแพง (ต้นเปา) เป็นสาขาเดียวกัน';

// aliases: [bill text, index of the product inside the same supplier, optional printed item code] (owner-confirmed only).
export const SUPPLIERS_2026_10 = [
  { id: 1, name: 'เจ๊แววไก่สด ตลาดเมืองใหม่', code: 'SYN-AP-014', mode: 'system',
    branches: 'ตามใบสั่งในระบบ', bill: 'ใบส่งของชั่วคราวเขียนมือ 1–2 รายการ/ใบ วางบิลรอบ 16–30 จ่ายวันที่ 5',
    products: [{ name: 'ขา B', unit: 1, price: '60.00' }, { name: 'ปีกบน', unit: 1, price: '76.00' },
      { name: 'ปีกกลาง', unit: 1, price: '135.00' }, { name: 'อกไก่', unit: 1, price: '80.00' }],
    aliases: [['ทB', 0], ['ทร', 0], ['ป.บน', 1], ['ป.กลาง', 2], ['ปีกกลาง (ญ.)', 2], ['ต.ไก่', 3]],
    orders: [{ user: 1, items: [[0, '10.00'], [1, '10.00'], [2, '10.00'], [3, '10.00']] }] },
  { id: 2, name: 'ร้านน้ำแข็ง vic', code: 'SYN-SM-ICE-VIC', mode: 'walk_in_phone',
    branches: 'คันคลอง (หน้าร้าน), ครัวกลาง/ฝ่ายผลิต', bill: 'บิลเงินสดเขียนมือ ไม่มีชื่อร้านบนบิล 35 บาท/ถุง',
    products: [{ name: 'น้ำแข็งหลอดใหญ่', unit: 2, price: '35.00' }, { name: 'น้ำแข็งบด (ใช้ครัว)', unit: 2, price: '35.00' },
      { name: 'น้ำแข็งสำหรับกาแฟ', unit: 2, price: '35.00' }, { name: 'น้ำแข็งบด (ใช้ผลิต)', unit: 2, price: '35.00' }],
    aliases: [['หลอดใหญ่', 0], ['โม่ครัว', 1], ['กาแฟ', 2], ['โม่โรงงาน', 3]], orders: [] },
  { id: 3, name: 'ร้านต้นพยอมพานิช', code: 'SYN-AP-019', mode: 'mixed',
    branches: 'บจก. โซลาว (สาขายังไม่ระบุ)', bill: 'บิลเงินสดพิมพ์หัวร้าน มีเลขที่ บางส่วนเขียนมือ · โทรสั่งแยกจะไม่มีใบสั่ง',
    products: [{ name: 'ไข่ไก่เบอร์ 1', unit: 3, price: '138.00' }, { name: 'โฟม 502', unit: 4, price: '145.00' },
      // The registry states only "400 per bill" for the bags: unit and price are assumed.
      { name: 'ถุงหิ้ว 6×14', unit: 6, price: '400.00', assumed: true }, { name: 'ถุงหิ้ว 8×16', unit: 6, price: '400.00', assumed: true }],
    // Third element = the supplier's own printed item code (SYNTHETIC example): the code wins over misread text.
    aliases: [['ไข่เบอร์ 1', 0, 'SYN-5002'], ['ไข่ไก่ NO1', 0], ['6 × 14', 2], ['8 × 16', 3]],
    orders: [{ user: 1, items: [[0, '10.00'], [1, '5.00']] }] },
  { id: 4, name: 'บริษัท สุพรค้าหมูเจริญ จำกัด', code: 'SYN-SM-SUPHON', mode: 'mixed',
    branches: 'ครัวกลาง/ฝ่ายผลิต', bill: 'ใบเสร็จรับเงินพิมพ์จากระบบ มีเลขที่และรหัสสินค้า',
    // The registry gives a 117–125 range for minced pork; 120 is a synthetic mid value.
    products: [{ name: 'หมูบดเกรด B', unit: 1, price: '120.00', assumed: true }, { name: 'ตับหมู', unit: 1, price: '100.00' }, { name: 'สันคอ', unit: 1, price: '150.00' }],
    aliases: [['บดB', 0]], orders: [{ user: 1, items: [[0, '20.00'], [1, '5.00']] }],
    // The same shop uses a different AP code per branch (registry: สันกำแพง uses AP-049). Synthetic identifiers only.
    branchCodes: [['SYN-AP-049', 'สันกำแพง (ต้นเปา) = บ้านแจ้']] },
  { id: 5, name: 'ร้านแพปลาภูเก็ต', code: 'SYN-SM-PHUKET', mode: 'mixed',
    branches: `สันกำแพง · คันคลอง · บ้านแจ้ (${SAME_BRANCH})`, bill: 'สลิปเครื่อง POS ชื่อสินค้าพิมพ์ชัด หน่วย kg',
    products: [{ name: 'กะพงไซด์ (ปลากระพงขาว)', unit: 1, price: '145.00' }, { name: 'เนื้อปูอก (เล็ก)', unit: 1, price: '800.00' },
      { name: 'เนื้อปูก้อน (กลาง)', unit: 1, price: '1750.00' }, { name: 'ปูม้า #2 (6–8 ตัว/โล)', unit: 1, price: '325.00' }, { name: 'หมึกอาร์เจนฯ', unit: 1, price: '200.00' }],
    aliases: [], orders: [{ user: 2, items: [[0, '5.00'], [3, '3.00']] }] },
  { id: 6, name: 'บริษัท เบทาโกรเกษตรอุตสาหกรรม จำกัด', code: 'SYN-SM-BETAGRO', mode: 'system',
    branches: 'ครัวกลาง/ฝ่ายผลิต', bill: 'ใบส่งของพิมพ์ เลขที่ 10 หลัก หน่วย KG',
    products: [{ name: 'สันคอหมูสเต็ก 5KG', unit: 1, price: '150.00' }, { name: 'สันคอหมู B-2 1KG', unit: 1, price: '150.00' },
      { name: 'ปีกกลาง MW 1กก', unit: 1, price: '130.00' }, { name: 'FR CK ไก่บ้านอีสานล้วง ตัดคอ ตัดขา', unit: 1, price: '94.00' }],
    aliases: [], orders: [{ user: 1, items: [[0, '10.00'], [2, '5.00']] }] },
  { id: 7, name: 'บริษัท เอเซียเกษตรรุ่งวิไล จำกัด', code: 'SYN-AP-003', mode: 'mixed',
    branches: `หลายสาขา (บิลเขียน "สำนักงานใหญ่") · ${SAME_BRANCH}`, bill: 'ใบแจ้งหนี้พิมพ์ INV… หลายรายการ/ใบ บางใบเป็นสำเนาคาร์บอนจาง',
    // Prices the registry does not give stay NULL; units other than กล่อง are assumed kilograms.
    products: [{ name: 'ถั่วคั่ว ตราช้าง', unit: 1, price: '86.00' }, { name: 'แป้งทอดกรอบ ครัววังทิพย์', unit: 5, price: '400.00' },
      { name: 'อายิโนะโมะโต๊ะ พลัส', unit: 1, price: null, assumed: true }, { name: 'ถุงพลาสติกร้อน 5x8', unit: 1, price: '77.00' },
      { name: 'ถุงพลาสติกร้อน 6x10', unit: 1, price: '78.00' }, { name: 'ถุงพลาสติกร้อน 7x11', unit: 1, price: '79.00' },
      { name: 'แป้งสาลี ว่าว', unit: 1, price: null, assumed: true }, { name: 'คนอร์ ผงมะนาว', unit: 1, price: null, assumed: true },
      { name: 'น้ำพริกเผา ฉั่วฮะเส็ง', unit: 1, price: null, assumed: true }],
    aliases: [], orders: [],
    branchCodes: [['SYN-AP-003', 'รหัสหลักของร้าน'], ['SYN-AP-053', 'บ้านแจ้ = สันกำแพง (ต้นเปา)']] }
];

export async function seedSuppliers202610(pool, source, date) {
  for (const unit of SUPPLIER_UNITS.filter(item => item.id !== 1)) {
    await pool.query('INSERT INTO units (id,name,abbreviation) VALUES (?,?,?)', [unit.id, unit.name, unit.abbreviation]);
  }
  const unitText = id => SUPPLIER_UNITS.find(unit => unit.id === id).abbreviation;
  let productId = 0, aliases = 0, orders = 0, orderItems = 0, products = 0, branchCodes = 0;
  for (const supplier of SUPPLIERS_2026_10) {
    // One order-side product group and one registry-side supplier master per supplier;
    // aliases and ordering notes exist under both keys so either view of the page can be demoed.
    await pool.query('INSERT INTO product_groups (id,name,code) VALUES (?,?,?)', [supplier.id, supplier.name, `SYN-PG-S${supplier.id}`]);
    await pool.query('INSERT INTO supplier_masters (id,name,code) VALUES (?,?,?)', [supplier.id, supplier.name, supplier.code]);
    const keys = [{ key: source.ocr.buildSupplierKey({ productGroupId: supplier.id }), group: supplier.id, master: null },
      { key: source.ocr.buildSupplierKey({ supplierMasterId: supplier.id }), group: null, master: supplier.id }];
    const ids = [];
    for (const product of supplier.products) {
      ids.push(++productId); products++;
      await pool.query('INSERT INTO products (id,name,code,product_group_id,unit_id,default_price) VALUES (?,?,?,?,?,?)',
        [productId, product.name, `SYN-S${supplier.id}-P${productId}`, supplier.id, product.unit, product.price]);
      await pool.query('INSERT INTO product_group_links (product_id,product_group_id,is_primary) VALUES (?,?,true)', [productId, supplier.id]);
      await pool.query('INSERT INTO product_supplier_master_links (product_id,supplier_master_id,is_primary) VALUES (?,?,true)', [productId, supplier.id]);
    }
    for (const [billText, index, itemCode = null] of supplier.aliases) {
      const product = supplier.products[index], unit = unitText(product.unit);
      for (const target of keys) {
        aliases++;
        await pool.query(`INSERT INTO supplier_product_aliases
          (supplier_key,supplier_master_id,product_group_id,supplier_name_text,bill_text,normalized_bill_text,
           unit_text,normalized_unit_text,product_id,unit_id,unit_multiplier,last_unit_price,confirm_count,updated_by_user_id,item_code)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [target.key, target.master, target.group, supplier.name, billText, source.ocr.normalizeMatchText(billText), unit,
          source.ocr.normalizeMatchText(unit), ids[index], product.unit, '1.0000', product.price, 2, 1, itemCode]);
      }
    }
    for (const target of keys) {
      await pool.query(`INSERT INTO receiving_supplier_profiles
        (supplier_key,ordering_mode,branches_note,bill_format_note,updated_by_user_id) VALUES (?,?,?,?,?)`,
      [target.key, supplier.mode, supplier.branches, supplier.bill, 1]);
    }
    // Per-branch AP codes are stored once, under the canonical supplier-master key.
    for (const [code, branchNote] of supplier.branchCodes || []) {
      await pool.query(`INSERT INTO receiving_supplier_branch_codes
        (supplier_key,supplier_code,branch_note,is_active,updated_by_user_id) VALUES (?,?,?,1,?)`, [keys[1].key, code, branchNote, 1]);
      branchCodes++;
    }
    for (const order of supplier.orders) {
      orders++;
      const total = order.items.reduce((sum, [index, quantity]) => sum + Math.round(Number(quantity) * 100) * Math.round(Number(supplier.products[index].price) * 100), 0);
      const [created] = await pool.query("INSERT INTO orders (order_number,user_id,order_date,status,total_amount) VALUES (?,?,?,'submitted',?)",
        [`SYNTHETIC-S${supplier.id}-${date}-${order.user}`, order.user, date, (total / 10000).toFixed(2)]);
      for (const [index, quantity] of order.items) {
        orderItems++;
        await pool.query('INSERT INTO order_items (order_id,product_id,quantity,requested_price) VALUES (?,?,?,?)',
          [created.insertId, ids[index], quantity, supplier.products[index].price]);
      }
    }
  }
  return { label: 'SYNTHETIC', profile: 'suppliers-2026-10', date, branches: 2, departments: 3, users: 3,
    supplierProductGroups: SUPPLIERS_2026_10.length, supplierMasters: SUPPLIERS_2026_10.length, products, aliases, branchCodes, orders, orderItems };
}
