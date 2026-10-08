// อ่านรายการสั่งซื้อเท่านั้น ไม่เรียก ensure/migration หรือกระบวนการรับของ
export const BILL_ORDER_REFERENCE_LIMIT = 1000;
export const BILL_ORDER_REFERENCE_SQL = `
SELECT oi.id AS order_item_id, o.id AS order_id, o.order_number,
       DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date,
       b.id AS branch_id, b.name AS branch_name,
       p.id AS product_id, p.code AS product_code, p.name AS product_name,
       p.supplier_item_id, p.barcode, oi.quantity AS ordered_quantity,
       un.id AS unit_id, un.name AS unit_name, un.abbreviation AS unit,
       pg.id AS product_group_id, pg.name AS product_group_name,
       sm.id AS supplier_id, sm.name AS supplier_name
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN users usr ON usr.id = o.user_id
JOIN departments d ON d.id = usr.department_id
JOIN branches b ON b.id = d.branch_id
JOIN products p ON p.id = oi.product_id
LEFT JOIN units un ON un.id = p.unit_id
LEFT JOIN product_groups pg ON pg.id = COALESCE(oi.source_product_group_id, p.product_group_id)
LEFT JOIN supplier_masters sm ON sm.id = p.supplier_master_id
WHERE o.order_date = ? AND b.id = ?
  AND o.status IN ('submitted', 'confirmed', 'completed')
ORDER BY oi.id ASC
LIMIT ?`;

const numeric = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const id = value => Number.isSafeInteger(numeric(value)) && numeric(value) > 0 ? numeric(value) : null;
const string = value => typeof value === 'string' && value.trim() ? value.trim() : null;

// Dependency injection keeps tests away from the application's connection/bootstrap side effects.
export const createBillOrderReferenceModel = database => ({
  async listLines({ date, branch_id }) {
    const [rows] = await database.query(BILL_ORDER_REFERENCE_SQL, [date, branch_id, BILL_ORDER_REFERENCE_LIMIT + 1]);
    const truncated = rows.length > BILL_ORDER_REFERENCE_LIMIT;
    const lines = rows.slice(0, BILL_ORDER_REFERENCE_LIMIT).map(row => ({
      order_source: 'orders', order_id: id(row.order_id), order_number: string(row.order_number),
      order_item_id: id(row.order_item_id), order_date: string(row.order_date),
      delivery_date: null, branch_id: id(row.branch_id), branch_name: string(row.branch_name),
      product_group_id: id(row.product_group_id), product_group_name: string(row.product_group_name),
      supplier_id: id(row.supplier_id), supplier_name: string(row.supplier_name),
      product_id: id(row.product_id), product_code: string(row.product_code), product_name: string(row.product_name),
      supplier_item_id: string(row.supplier_item_id), barcode: string(row.barcode),
      ordered_quantity: numeric(row.ordered_quantity), unit: string(row.unit) || string(row.unit_name),
      unit_id: id(row.unit_id), unit_name: string(row.unit_name)
    }));
    return { scope: { date, branch_id }, complete: !truncated, truncated, lines,
      date_basis: 'order_date', warnings: ['วันที่อ้างอิงคือ order_date ไม่มีข้อมูลวันที่ส่งจริง', 'จำนวนใช้หน่วยในระบบสั่งซื้อ ไม่แปลงแพ็คหรือเทียบราคาอัตโนมัติ', 'supplier_id เป็นซัพพลายเออร์ที่ผูกสินค้า ไม่ยืนยันผู้ขายจริงของรายการซื้อ', 'ไม่รวมรายการซื้อ PO หรือรายการค้างรับจากวันอื่น'] };
  }
});
