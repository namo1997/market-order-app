// คำนวณ ledger คลังใหม่ทุกคู่ (สินค้า, แผนก) ด้วยกติกาใหม่: รายการนับสต็อกเป็นยอดสัมบูรณ์ (INV-01/INV-10)
// ใช้ครั้งเดียวตอน deploy ชุดแก้ INV-01..07 เพื่อให้ยอดทุกคู่สอดคล้องกันทันที
// แทนที่จะค่อย ๆ เปลี่ยนเมื่อแต่ละคู่ถูกแตะ (ขายตามสูตร, แปรรูป, ปรับยอด ฯลฯ)
//
// ค่าเริ่มต้นเป็น dry-run (อ่านอย่างเดียว) ต้องใส่ --apply จึงจะเขียน
//   node scripts/reflow-stock-ledger-absolute.mjs [--apply] [--report <path.json>]
import fs from 'node:fs';
import dotenv from 'dotenv';
import pool from '../src/config/database.js';
import { recalculateLedgerForPairs } from '../src/models/inventory.model.js';
import { reflowLedgerRows } from '../src/utils/stock-ledger.js';

dotenv.config();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const reportIndex = args.indexOf('--report');
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
const EPS = 0.0001;
const BATCH_SIZE = 50;

const main = async () => {
  const [pairs] = await pool.query(
    `SELECT DISTINCT product_id, department_id
     FROM inventory_transactions
     ORDER BY department_id, product_id`
  );

  const changes = [];
  for (const pair of pairs) {
    const [rows] = await pool.query(
      `SELECT id, transaction_type, quantity, balance_before, balance_after, reference_type
       FROM inventory_transactions
       WHERE product_id = ? AND department_id = ?
       ORDER BY created_at ASC, id ASC`,
      [pair.product_id, pair.department_id]
    );
    const [[balanceRow]] = await pool.query(
      'SELECT quantity FROM inventory_balance WHERE product_id = ? AND department_id = ?',
      [pair.product_id, pair.department_id]
    );
    const current = Number(balanceRow?.quantity ?? 0);
    const reflowed = reflowLedgerRows(rows);
    const changedRows = reflowed.rows.filter((row, index) => {
      const original = rows[index];
      return (
        Math.abs(Number(original.quantity) - row.quantity) > EPS ||
        Math.abs(Number(original.balance_before) - row.balance_before) > EPS ||
        Math.abs(Number(original.balance_after) - row.balance_after) > EPS
      );
    }).length;
    if (changedRows > 0 || Math.abs(current - reflowed.balance) > EPS) {
      changes.push({
        product_id: pair.product_id,
        department_id: pair.department_id,
        balance_before_reflow: current,
        balance_after_reflow: reflowed.balance,
        diff: Math.round((reflowed.balance - current) * 1e4) / 1e4,
        changed_rows: changedRows
      });
    }
  }

  const balanceChanged = changes.filter((c) => Math.abs(c.diff) > EPS);
  console.log(
    `[reflow] pairs=${pairs.length} pairs_with_row_changes=${changes.length} balance_changed=${balanceChanged.length} mode=${apply ? 'APPLY' : 'dry-run'}`
  );

  if (apply) {
    for (let i = 0; i < changes.length; i += BATCH_SIZE) {
      const batch = changes.slice(i, i + BATCH_SIZE);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await recalculateLedgerForPairs(connection, batch);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    console.log(`[reflow] applied ${changes.length} pairs`);
  }

  if (reportPath) {
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ generated_at: new Date().toISOString(), apply, pairs: pairs.length, changes }, null, 1)
    );
    console.log(`[reflow] report: ${reportPath}`);
  }
};

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(`[reflow] failed: ${error?.message || error}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
