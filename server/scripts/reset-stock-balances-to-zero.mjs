// เริ่มใช้สต็อกจริง: ตั้งยอดคงเหลือทุกคู่ (สินค้า, แผนก) เป็น 0 ณ เวลาเดียวกัน (เจ้าของเลือก 13 พ.ย. 2569)
// ไม่ลบประวัติเก่า: เพิ่มแถว transaction_type 'initial' (reference_type 'stock_reset') ยอดหลัง = 0 แล้ว reflow
// แถว initial เป็นยอดสัมบูรณ์ (A5) → รายการหลังเวลานี้เริ่มจาก 0 และซิงค์ขายย้อนเวลาที่แทรกก่อนเวลานี้ไม่กระทบ
// ต้อง deploy โค้ดที่ถือ initial เป็นยอดสัมบูรณ์ (commit 4e885293) ก่อนรัน ไม่งั้น reflow ครั้งหน้าจะคืนยอดเก่า
//
// ค่าเริ่มต้นเป็น dry-run (อ่านอย่างเดียว) ต้องใส่ --apply จึงจะเขียน; รันซ้ำด้วย --at เดิมจะข้ามคู่ที่ทำแล้ว
//   node scripts/reset-stock-balances-to-zero.mjs [--apply] [--at "YYYY-MM-DD HH:mm:ss" (UTC)] [--report <path.json>]
import fs from 'node:fs';
import dotenv from 'dotenv';
import pool from '../src/config/database.js';
import { lockBalanceRow, recalculateLedgerForPairs } from '../src/models/inventory.model.js';
import { buildResetLabel, planResetPairs, resolveResetAt } from '../src/utils/stock-reset.js';
import { isAbsoluteLedgerRow } from '../src/utils/stock-ledger.js';

dotenv.config();

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const apply = args.includes('--apply');
const reportPath = argValue('--report');
const BATCH_SIZE = 50;
const EPS = 0.0001;

const main = async () => {
  if (!isAbsoluteLedgerRow({ transaction_type: 'initial', balance_after: 0 })) {
    throw new Error('โค้ดนี้ยังไม่ถือแถว initial เป็นยอดสัมบูรณ์ — รีเซ็ตแล้วยอดจะไม่คงที่');
  }
  const atUtc = resolveResetAt(argValue('--at'));
  const label = buildResetLabel(atUtc);

  const [ledgerPairs] = await pool.query('SELECT DISTINCT product_id, department_id FROM inventory_transactions');
  const [balanceRows] = await pool.query('SELECT product_id, department_id, quantity FROM inventory_balance');
  const [donePairs] = await pool.query(
    `SELECT DISTINCT product_id, department_id FROM inventory_transactions
     WHERE reference_type = 'stock_reset' AND reference_id = ?`,
    [label]
  );
  const [[after]] = await pool.query('SELECT COUNT(*) AS n FROM inventory_transactions WHERE created_at > ?', [atUtc]);
  const pairs = planResetPairs({ ledgerPairs, balanceRows, donePairs });

  const balanceByKey = new Map(balanceRows.map((row) => [`${row.department_id}:${row.product_id}`, Number(row.quantity) || 0]));
  const before = pairs.map((pair) => balanceByKey.get(`${pair.departmentId}:${pair.productId}`) || 0);
  const summary = {
    mode: apply ? 'APPLY' : 'dry-run',
    at_utc: atUtc,
    label,
    pairs: pairs.length,
    already_done: donePairs.length,
    nonzero_before: before.filter((q) => Math.abs(q) > EPS).length,
    positive_total_before: Math.round(before.filter((q) => q > 0).reduce((s, q) => s + q, 0) * 100) / 100,
    negative_total_before: Math.round(before.filter((q) => q < 0).reduce((s, q) => s + q, 0) * 100) / 100,
    rows_after_reset_time: Number(after.n)
  };
  console.log('[reset-zero]', JSON.stringify(summary));

  if (apply) {
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const pair of batch) {
          const current = await lockBalanceRow(connection, pair.productId, pair.departmentId);
          await connection.query(
            `INSERT INTO inventory_transactions
             (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
              reference_type, reference_id, notes, created_by, created_at)
             VALUES (?, ?, 'initial', ?, ?, 0, 'stock_reset', ?, ?, NULL, ?)`,
            [pair.productId, pair.departmentId, -current, current, label, `เริ่มใช้สต็อก: ตั้งยอดเป็น 0 (ยอดเดิม ${current})`, atUtc]
          );
        }
        // reflow: แถวรีเซ็ตเป็นยอดสัมบูรณ์ 0 ณ atUtc, รายการหลังเวลานั้น (ถ้ามี) นับต่อจาก 0
        await recalculateLedgerForPairs(connection, batch);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      process.stdout.write(`\r[reset-zero] ${Math.min(i + BATCH_SIZE, pairs.length)}/${pairs.length}`);
    }
    process.stdout.write('\n');

    // ตรวจ: คู่ที่ไม่มีรายการหลังเวลารีเซ็ต ต้องเป็น 0 ทุกคู่
    const [[check]] = await pool.query(
      `SELECT COUNT(*) AS n
       FROM inventory_balance ib
       WHERE ABS(ib.quantity) > ?
         AND NOT EXISTS (
           SELECT 1 FROM inventory_transactions it
           WHERE it.product_id = ib.product_id AND it.department_id = ib.department_id AND it.created_at > ?
         )`,
      [EPS, atUtc]
    );
    summary.nonzero_without_later_rows = Number(check.n);
    console.log('[reset-zero] done', JSON.stringify({ nonzero_without_later_rows: summary.nonzero_without_later_rows }));
    if (summary.nonzero_without_later_rows !== 0) process.exitCode = 1;
  }

  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error('[reset-zero] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end?.());
