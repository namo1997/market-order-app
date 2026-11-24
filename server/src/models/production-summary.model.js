// สรุปการผลิตรายวัน (เจ้าของขอ 24 พ.ย. 2569): ต่อสินค้า สั่ง / ผลิต / ขาด / จัดแล้ว + วัตถุดิบที่ใช้
// - สั่ง: ใบสั่งของสาขาวันนั้น ชุดเดียวกับหน้าจัดของ/ใบส่งสินค้า (ซ่อนสาขาส่วนกลาง)
// - ผลิต: รายการรับเข้าจากการแปรรูป (production_transform, receive) ในวันนั้นตามเวลาไทย
// - จัดแล้ว: สติกเกอร์/กดเพิ่มในหน้าจัดของวันนั้น
// - วัตถุดิบ: แถวตัดวัตถุดิบของการแปรรูปชุดเดียวกัน
// ขอบเขตสินค้า = กลุ่มสินค้าของผู้ใช้ (เหมือนหน้าจัดของ) ผลิต/วัตถุดิบนับเฉพาะสินค้าปลายทางในกลุ่มนั้น
import { buildBangkokDateRangeSql } from '../utils/stock-ledger.js';
import { ensureProductionPackingTables, loadPackingOrderLines } from './production-packing.model.js';

const round = (value) => Math.round(Number(value || 0) * 1000) / 1000;
const defaultDb = async () => (await import('../config/database.js')).default;

/**
 * รวมข้อมูลเป็นบรรทัดต่อสินค้า (pure)
 * branches: ผลจาก loadPackingOrderLines, produced: [{ product_id, product_name, unit, produced, lots }],
 * packed: [{ product_id, packed }], ingredients: [{ product_id, product_name, unit, used }]
 */
export const buildProductionSummary = ({ date, branches = [], produced = [], packed = [], ingredients = [] }) => {
  const lines = new Map();
  const lineFor = (productId, name, unit) => {
    const id = Number(productId);
    if (!lines.has(id)) {
      lines.set(id, { product_id: id, product_name: name || `สินค้า #${id}`, unit: unit || '', ordered: 0, produced: 0, lots: 0, packed: 0 });
    }
    const line = lines.get(id);
    if (!line.unit && unit) line.unit = unit;
    return line;
  };
  for (const branch of branches) {
    for (const row of branch.lines || []) {
      const line = lineFor(row.product_id, row.product_name, row.unit);
      line.ordered = round(line.ordered + Number(row.ordered || 0));
    }
  }
  for (const row of produced) {
    const line = lineFor(row.product_id, row.product_name, row.unit);
    line.produced = round(line.produced + Number(row.produced || 0));
    line.lots += Number(row.lots || 0);
  }
  for (const row of packed) {
    // จัดได้เฉพาะสินค้าในใบสั่ง → ถ้าไม่มีบรรทัด (ใบสั่งถูกแก้ทีหลัง) ยังแสดงให้เห็น
    const line = lineFor(row.product_id, row.product_name, row.unit);
    line.packed = round(line.packed + Number(row.packed || 0));
  }
  const result = [...lines.values()]
    .map((line) => ({ ...line, short: round(Math.max(line.ordered - line.produced, 0)) }))
    .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'th'));
  return {
    date,
    lines: result,
    short_count: result.filter((line) => line.short > 0).length,
    ingredients: ingredients
      .map((row) => ({
        product_id: Number(row.product_id),
        product_name: row.product_name,
        unit: row.unit || '',
        used: round(row.used)
      }))
      .filter((row) => row.used > 0)
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name), 'th'))
  };
};

export const getProductionSummary = async ({ date, groupIds, db, getOrderItems }) => {
  const groups = (Array.isArray(groupIds) ? groupIds : []).map(Number).filter(Number.isFinite);
  // ไม่มีกลุ่ม = ไม่มีสิทธิ์เห็นอะไร (เหมือนหน้าจัดของ)
  if (groups.length === 0) return buildProductionSummary({ date });
  db = db || await defaultDb();
  await ensureProductionPackingTables(db);
  const range = buildBangkokDateRangeSql('o.created_at', date, date);
  const groupSql = groups.map(() => '?').join(', ');
  // รายการรับเข้าจากการแปรรูปของสินค้าในกลุ่ม ในวันนั้น
  const outputsWhere = `o.reference_type = 'production_transform'
          AND o.transaction_type = 'receive'
          AND o.quantity > 0
          AND ${range.sql}
          AND op.product_group_id IN (${groupSql})`;
  const outputsParams = [...range.params, ...groups];

  const [branches, [producedRows], [packedRows], [ingredientRows]] = await Promise.all([
    loadPackingOrderLines({ date, groupIds: groups, ...(getOrderItems ? { getOrderItems } : {}) }),
    db.query(
      `SELECT o.product_id, op.name AS product_name, COALESCE(u.abbreviation, u.name, '') AS unit,
              SUM(o.quantity) AS produced, COUNT(*) AS lots
         FROM inventory_transactions o
         JOIN products op ON op.id = o.product_id
         LEFT JOIN units u ON u.id = op.unit_id
        WHERE ${outputsWhere}
        GROUP BY o.product_id, op.name, u.abbreviation, u.name`,
      outputsParams
    ),
    db.query(
      `SELECT s.product_id, p.name AS product_name, COALESCE(u.abbreviation, u.name, '') AS unit,
              SUM(s.quantity) AS packed
         FROM production_packing_scans s
         LEFT JOIN products p ON p.id = s.product_id
         LEFT JOIN units u ON u.id = p.unit_id
        WHERE s.pack_date = ?
        GROUP BY s.product_id, p.name, u.abbreviation, u.name`,
      [date]
    ),
    db.query(
      `SELECT i.product_id, ip.name AS product_name, COALESCE(u.abbreviation, u.name, '') AS unit,
              -SUM(i.quantity) AS used
         FROM inventory_transactions i
         JOIN products ip ON ip.id = i.product_id
         LEFT JOIN units u ON u.id = ip.unit_id
        WHERE i.reference_type = 'production_transform'
          AND i.quantity < 0
          AND i.reference_id IN (
            SELECT o.reference_id
              FROM inventory_transactions o
              JOIN products op ON op.id = o.product_id
             WHERE ${outputsWhere}
          )
        GROUP BY i.product_id, ip.name, u.abbreviation, u.name`,
      outputsParams
    )
  ]);

  // จัดแล้ว: นับเฉพาะสินค้าที่อยู่ในขอบเขตนี้ (มีในใบสั่งหรือผลิตในกลุ่มนี้) ไม่ปนของกลุ่มอื่น
  const known = new Set([
    ...branches.flatMap((branch) => (branch.lines || []).map((line) => Number(line.product_id))),
    ...(producedRows || []).map((row) => Number(row.product_id))
  ]);
  return buildProductionSummary({
    date,
    branches,
    produced: producedRows || [],
    packed: (packedRows || []).filter((row) => known.has(Number(row.product_id))),
    ingredients: ingredientRows || []
  });
};
