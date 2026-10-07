// ปรับยอดคลังจาก "การนับล่าสุด" ของแต่ละ (สินค้า, แผนก) ที่ยังไม่เคย apply — ใช้ครั้งเดียวตอนเริ่มใช้ระบบคลัง
// dry-run เป็นค่าเริ่มต้น; --apply จึงเขียน
//   node scripts/apply-latest-stock-checks.mjs [--apply] [--report <path.json>]
import fs from 'node:fs';
const { default: pool } = await import('../src/config/database.js');
const inv = await import('../src/models/inventory.model.js');
const apply = process.argv.includes('--apply');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
const [latest] = await pool.query(`
  SELECT sc.id, sc.product_id, sc.department_id, DATE_FORMAT(sc.check_date,'%Y-%m-%d') AS d, sc.stock_quantity
  FROM stock_checks sc
  JOIN departments dep ON dep.id = sc.department_id
  WHERE sc.check_date = (SELECT MAX(s2.check_date) FROM stock_checks s2 WHERE s2.product_id = sc.product_id AND s2.department_id = sc.department_id)
    AND NOT EXISTS (
      SELECT 1 FROM inventory_transactions it
      WHERE it.reference_type = 'stock_check' AND it.product_id = sc.product_id AND it.department_id = sc.department_id
        AND (it.reference_id = CONCAT(DATE_FORMAT(sc.check_date,'%Y-%m-%d'), ':', sc.id) OR it.reference_id LIKE CONCAT(DATE_FORMAT(sc.check_date,'%Y-%m-%d'), ':', sc.id, ':%')))
  ORDER BY sc.department_id, sc.check_date, sc.product_id`);
const groups = new Map();
for (const r of latest) { const k = `${r.d}|${r.department_id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.product_id); }
console.log(`[apply-latest] unapplied latest checks=${latest.length} groups(date,dept)=${groups.size} mode=${apply ? 'APPLY' : 'dry-run'}`);
const out = { generated_at: new Date().toISOString(), apply, items: latest.length, groups: [] };
for (const [k, productIds] of groups) {
  const [date, dept] = k.split('|');
  const g = { date, department_id: Number(dept), products: productIds.length };
  if (apply) {
    const r = await inv.applyStockAdjustment(date, Number(dept), null, { productIds, allowReapply: false });
    g.adjusted = r.total_adjustments; g.skipped = r.skipped_already_applied_count;
    g.skipped_reasons = [...new Set(r.skipped_already_applied.map(s => s.reason))];
  }
  out.groups.push(g);
}
if (apply) console.log(`[apply-latest] adjusted=${out.groups.reduce((s, g) => s + g.adjusted, 0)} skipped=${out.groups.reduce((s, g) => s + g.skipped, 0)}`);
console.table(out.groups.slice(0, 40));
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(out, null, 1));
await pool.end();
