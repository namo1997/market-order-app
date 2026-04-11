import dotenv from 'dotenv';
import pool from '../src/config/database.js';

dotenv.config();

const parseArgs = () => ({
  apply: process.argv.includes('--apply')
});

const pad2 = (value) => String(value).padStart(2, '0');

const toUtcDateTimeText = (epochMs) => {
  const date = new Date(Number(epochMs));
  if (!Number.isFinite(date.getTime())) return null;
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  );
};

const buildBackupName = () => {
  const now = new Date();
  return (
    'bkp_pt_created_at_' +
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
};

const toNum = (value) => Number.parseFloat(value || 0) || 0;
const EPS = 0.0001;
const changed = (a, b) => Math.abs(toNum(a) - toNum(b)) > EPS;

const recalcPair = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, quantity, balance_before, balance_after
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, departmentId]
  );

  if (rows.length === 0) return { updated: 0, lastTxId: null, finalQty: 0 };

  let running = toNum(rows[0].balance_before);
  let updated = 0;
  for (const row of rows) {
    const expectedBefore = running;
    const expectedAfter = expectedBefore + toNum(row.quantity);
    if (changed(row.balance_before, expectedBefore) || changed(row.balance_after, expectedAfter)) {
      await connection.query(
        `UPDATE inventory_transactions
         SET balance_before = ?, balance_after = ?
         WHERE id = ?`,
        [expectedBefore, expectedAfter, Number(row.id)]
      );
      updated += 1;
    }
    running = expectedAfter;
  }

  return {
    updated,
    lastTxId: Number(rows[rows.length - 1].id),
    finalQty: running
  };
};

const main = async () => {
  const { apply } = parseArgs();

  const [rows] = await pool.query(
    `SELECT
       id,
       reference_id,
       product_id,
       department_id,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_text
     FROM inventory_transactions
     WHERE reference_type = 'production_transform'
       AND reference_id LIKE 'PRD-%'
       AND CHAR_LENGTH(reference_id) = 17
       AND CAST(SUBSTRING(reference_id, 5) AS UNSIGNED) BETWEEN 1000000000000 AND 9999999999999
     ORDER BY id ASC`
  );

  const targets = [];
  for (const row of rows) {
    const ms = String(row.reference_id || '').slice(4);
    const expected = toUtcDateTimeText(ms);
    if (!expected) continue;
    if (String(row.created_at_text) !== expected) {
      targets.push({
        id: Number(row.id),
        productId: Number(row.product_id),
        departmentId: Number(row.department_id),
        referenceId: String(row.reference_id),
        oldCreatedAt: String(row.created_at_text),
        expectedCreatedAt: expected
      });
    }
  }

  console.log(`[production-transform] scanned rows: ${rows.length}`);
  console.log(`[production-transform] rows need update: ${targets.length}`);
  if (targets.length > 0) {
    console.table(
      targets.slice(0, 10).map((item) => ({
        id: item.id,
        reference_id: item.referenceId,
        old_created_at: item.oldCreatedAt,
        expected_created_at: item.expectedCreatedAt
      }))
    );
  }

  if (!apply) {
    console.log('[dry-run] no update executed. run with --apply to update.');
    return;
  }

  if (targets.length === 0) {
    console.log('[apply] no update needed.');
    return;
  }

  const pairMap = new Map();
  for (const item of targets) {
    pairMap.set(`${item.productId}:${item.departmentId}`, {
      productId: item.productId,
      departmentId: item.departmentId
    });
  }
  const affectedPairs = Array.from(pairMap.values());

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const backupTable = buildBackupName();
    await connection.query(
      `CREATE TABLE ${backupTable} AS
       SELECT *
       FROM inventory_transactions
       WHERE reference_type = 'production_transform'
         AND reference_id LIKE 'PRD-%'
         AND CHAR_LENGTH(reference_id) = 17
         AND CAST(SUBSTRING(reference_id, 5) AS UNSIGNED) BETWEEN 1000000000000 AND 9999999999999`
    );

    for (const target of targets) {
      await connection.query(
        `UPDATE inventory_transactions
         SET created_at = ?
         WHERE id = ?`,
        [target.expectedCreatedAt, target.id]
      );
    }

    let reflowUpdatedRows = 0;
    for (const pair of affectedPairs) {
      const result = await recalcPair(connection, pair.productId, pair.departmentId);
      reflowUpdatedRows += result.updated;
      await connection.query(
        `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           quantity = VALUES(quantity),
           last_transaction_id = VALUES(last_transaction_id),
           last_updated = CURRENT_TIMESTAMP`,
        [pair.productId, pair.departmentId, result.finalQty, result.lastTxId]
      );
    }

    await connection.commit();

    console.log(`[apply] backup table: ${backupTable}`);
    console.log(`[apply] updated created_at rows: ${targets.length}`);
    console.log(`[apply] affected pairs reflowed: ${affectedPairs.length}`);
    console.log(`[apply] reflow-updated transaction rows: ${reflowUpdatedRows}`);

    const [verifyRows] = await pool.query(
      `SELECT
         id,
         reference_id,
         DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_text
       FROM inventory_transactions
       WHERE id IN (${targets.map(() => '?').join(',')})`,
      targets.map((item) => item.id)
    );

    let remaining = 0;
    for (const row of verifyRows) {
      const expected = toUtcDateTimeText(String(row.reference_id).slice(4));
      if (!expected || String(row.created_at_text) !== expected) {
        remaining += 1;
      }
    }
    console.log(`[verify] remaining mismatches in updated set: ${remaining}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

main()
  .catch((error) => {
    console.error('[production-transform] failed:', error?.message || error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // ignore close error
    }
  });
