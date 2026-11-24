// ตัดสต็อกขายตามสูตร (POS → สต็อก): ตรรกะล้วนที่ทดสอบได้โดยไม่ต้องต่อ DB
// - เลือกแผนกที่ตัด (A6)
// - กุญแจกันตัดซ้ำที่ไม่ขึ้นกับแผนก (A6)
// - ชื่อ lock กันซิงค์ซ้อน (A3)

// ล็อกระดับ MySQL (GET_LOCK) ใส่ชื่อฐานข้อมูลด้วย เผื่อหลายฐานอยู่บนเซิร์ฟเวอร์เดียวกัน
export const RECIPE_SALE_SYNC_LOCK_SQL = "CONCAT('recipe_sale_sync:', DATABASE())";
export const RECIPE_SALE_SYNC_LOCK_WAIT_SECONDS = 120;

/**
 * แผนกที่ถูกตัดยอดขาย = แผนกแรกที่ "ผูก" สินค้านี้ในสาขา (รายการนับสต็อกที่ apply ก่อนสุด = id น้อยสุด)
 * เดิมใช้ id แผนกน้อยสุด: พอแผนกอื่นที่ id น้อยกว่าเริ่มนับสินค้าเดียวกัน การตัดย้ายไปแผนกนั้นทันที
 * candidates: [{ department_id, first_check_id }]
 */
export const pickSaleDepartment = (candidates = []) => {
  const valid = (candidates || [])
    .map((row) => ({
      departmentId: Number(row?.department_id),
      firstCheckId: Number(row?.first_check_id)
    }))
    .filter((row) => Number.isFinite(row.departmentId));
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const aId = Number.isFinite(a.firstCheckId) ? a.firstCheckId : Infinity;
    const bId = Number.isFinite(b.firstCheckId) ? b.firstCheckId : Infinity;
    return aId - bId || a.departmentId - b.departmentId;
  });
  return valid[0].departmentId;
};

const compactDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 14);
const compactDocNo = (value) =>
  String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'na';

// รูปแบบ reference_id เดิม (คงไว้เพื่อให้ตรงกับข้อมูลที่ตัดไปแล้ว)
export const buildRecipeSaleReferenceIds = (row) => ({
  reference_id: `recipe-sale-bill:${row.sale_date}:${compactDigits(row.sale_datetime_local || row.sale_datetime_utc)}:branch${row.branch_id}:dept${row.department_id}:product${row.product_id}:doc${compactDocNo(row.sale_doc_no)}`,
  legacy_reference_id: `recipe-sale:${row.sale_date}:branch${row.branch_id}:dept${row.department_id}:product${row.product_id}`
});

// ตัดส่วน :deptN ออก → บิลเดียวกันถูกนับว่า "ตัดแล้ว" แม้แผนกที่ตัดจะเปลี่ยนไป (กันตัดซ้ำจากอีกแผนก)
export const recipeSaleKeyWithoutDepartment = (referenceId) =>
  String(referenceId ?? '').replace(/:dept\d+(?=:|$)/, '');

// LIKE prefix ของ reference_id ทุกรายการในวันขายนั้น (ทั้งแบบรายบิลและแบบรายวันรุ่นเก่า)
export const recipeSaleReferencePrefixes = (saleDate) => [
  `recipe-sale-bill:${saleDate}:%`,
  `recipe-sale:${saleDate}:%`
];
