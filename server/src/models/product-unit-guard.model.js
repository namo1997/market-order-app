import {
  summarizeUnitReferences,
  buildBaseUnitChangeMessage,
  isBaseUnitChanging,
  isForceUnitChange
} from '../utils/unit-rules.js';

// ตารางที่สร้างแบบ lazy อาจยังไม่มี — ถือว่าไม่มีข้อมูลอ้างอิง
const safeCount = async (db, sql, params) => {
  try {
    const [[row]] = await db.query(sql, params);
    return Number(row?.c) || 0;
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE' || error?.errno === 1146) return 0;
    throw error;
  }
};

// db = pool หรือ connection
export const countProductUnitReferences = async (db, productId) => {
  const id = Number(productId);
  return {
    inventory_transactions: await safeCount(db, 'SELECT COUNT(*) AS c FROM inventory_transactions WHERE product_id = ?', [id]),
    inventory_balance: await safeCount(db, 'SELECT COUNT(*) AS c FROM inventory_balance WHERE product_id = ? AND quantity <> 0', [id]),
    menu_recipe_items: await safeCount(db, 'SELECT COUNT(*) AS c FROM menu_recipe_items WHERE product_id = ?', [id]),
    stock_checks: await safeCount(db, 'SELECT COUNT(*) AS c FROM stock_checks WHERE product_id = ?', [id]),
    purchase_unit_links: await safeCount(
      db,
      'SELECT COUNT(*) AS c FROM product_supplier_master_links WHERE product_id = ? AND purchase_unit_id IS NOT NULL',
      [id]
    ),
    open_po_items: await safeCount(
      db,
      `SELECT COUNT(*) AS c
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.po_id
       WHERE poi.product_id = ? AND po.status IN ('draft','confirmed','partial')`,
      [id]
    )
  };
};

// UNIT-05: ถ้าเปลี่ยนหน่วยฐานของสินค้าที่มีข้อมูลอ้างอิง → throw 409 (เว้นแต่ force)
// คืน { warning } เมื่อ force และมีข้อมูลอ้างอิง, ไม่เช่นนั้นคืน { warning: null }
export const assertBaseUnitChangeAllowed = async (db, { productId, productName, currentUnitId, nextUnitId, force }) => {
  if (!isBaseUnitChanging(currentUnitId, nextUnitId)) return { warning: null };
  const counts = await countProductUnitReferences(db, productId);
  const refs = summarizeUnitReferences(counts);
  const message = buildBaseUnitChangeMessage(productName, refs);
  if (!message) return { warning: null };
  if (isForceUnitChange(force)) {
    return { warning: `เปลี่ยนหน่วยฐานโดยบังคับ: ${message.split(' หากต้องการ')[0]}`, references: counts };
  }
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'BASE_UNIT_CHANGE_BLOCKED';
  error.references = counts;
  throw error;
};
