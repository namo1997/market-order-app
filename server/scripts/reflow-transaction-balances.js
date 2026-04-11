import dotenv from 'dotenv';
import pool from '../src/config/database.js';

dotenv.config();

const EPS = 0.0001;

const toNum = (v) => Number.parseFloat(v || 0) || 0;
const changed = (a, b) => Math.abs(toNum(a) - toNum(b)) > EPS;

const getMismatchedPairs = async () => {
  const [rows] = await pool.query(`
    SELECT DISTINCT cur.product_id, cur.department_id
    FROM inventory_transactions cur
    JOIN inventory_transactions prev ON prev.id = (
      SELECT p.id
      FROM inventory_transactions p
      WHERE p.product_id = cur.product_id
        AND p.department_id = cur.department_id
        AND (p.created_at < cur.created_at OR (p.created_at = cur.created_at AND p.id < cur.id))
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    )
    WHERE ABS(cur.balance_before - prev.balance_after) > 0.0001
       OR ABS((cur.balance_before + cur.quantity) - cur.balance_after) > 0.0001
    ORDER BY cur.department_id, cur.product_id
  `);

  return rows;
};

const reflowPair = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, quantity, balance_before, balance_after
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, departmentId]
  );

  if (rows.length === 0) return { updates: 0, rows: 0 };

  // ยึดค่าเริ่มต้นเดิมของแถวแรก เพื่อไม่กระทบ opening balance ที่มีอยู่จริงในระบบ
  let running = toNum(rows[0].balance_before);
  let updates = 0;

  for (const row of rows) {
    const qty = toNum(row.quantity);
    const expectedBefore = running;
    const expectedAfter = expectedBefore + qty;

    if (changed(row.balance_before, expectedBefore) || changed(row.balance_after, expectedAfter)) {
      await connection.query(
        `UPDATE inventory_transactions
         SET balance_before = ?, balance_after = ?
         WHERE id = ?`,
        [expectedBefore, expectedAfter, row.id]
      );
      updates += 1;
    }

    running = expectedAfter;
  }

  return { updates, rows: rows.length };
};

const verifyCounts = async () => {
  const [[{ chain_mismatch_count }]] = await pool.query(`
    SELECT COUNT(*) AS chain_mismatch_count
    FROM inventory_transactions cur
    JOIN inventory_transactions prev ON prev.id = (
      SELECT p.id
      FROM inventory_transactions p
      WHERE p.product_id = cur.product_id
        AND p.department_id = cur.department_id
        AND (p.created_at < cur.created_at OR (p.created_at = cur.created_at AND p.id < cur.id))
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    )
    WHERE ABS(cur.balance_before - prev.balance_after) > 0.0001
  `);

  const [[{ formula_mismatch_count }]] = await pool.query(`
    SELECT COUNT(*) AS formula_mismatch_count
    FROM inventory_transactions
    WHERE ABS((balance_before + quantity) - balance_after) > 0.0001
  `);

  return { chain_mismatch_count, formula_mismatch_count };
};

const main = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const pairs = await getMismatchedPairs();

  console.log(`Found mismatched pairs: ${pairs.length}`);
  if (pairs.length === 0) {
    const counts = await verifyCounts();
    console.log('Verify:', counts);
    return;
  }

  if (dryRun) {
    console.table(pairs.slice(0, 30));
    const counts = await verifyCounts();
    console.log('Verify:', counts);
    return;
  }

  let totalUpdatedRows = 0;
  let totalScannedRows = 0;

  const connection = await pool.getConnection();
  try {
    for (const pair of pairs) {
      await connection.beginTransaction();
      try {
        const result = await reflowPair(connection, pair.product_id, pair.department_id);
        await connection.commit();
        totalUpdatedRows += result.updates;
        totalScannedRows += result.rows;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    connection.release();
  }

  const counts = await verifyCounts();
  console.log('Done.');
  console.log(`Pairs fixed: ${pairs.length}`);
  console.log(`Rows scanned: ${totalScannedRows}`);
  console.log(`Rows updated: ${totalUpdatedRows}`);
  console.log('Verify:', counts);
};

main()
  .catch((error) => {
    console.error('Failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // ignore
    }
  });
