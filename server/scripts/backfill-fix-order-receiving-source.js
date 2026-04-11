import dotenv from 'dotenv';
import pool from '../src/config/database.js';

dotenv.config();

const TZ_OFFSET = '+07:00';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (flag, fallback = null) => {
    const index = args.indexOf(flag);
    if (index < 0 || index === args.length - 1) return fallback;
    return args[index + 1];
  };
  return {
    fromDate: getValue('--from-date', '2026-03-07'),
    dryRun: args.includes('--dry-run')
  };
};

const toNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const makeBackupTableName = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join('');
  return `bkp_fix_order_receiving_source_${ts}`;
};

const CANDIDATE_SQL = `
  SELECT
    c.tx_id,
    c.product_id,
    c.product_name,
    c.actual_source_department_id,
    c.actual_source_department_name,
    c.target_department_id,
    c.target_department_name,
    c.target_branch_id,
    c.target_branch_name,
    c.order_item_id,
    c.order_number,
    c.created_at,
    c.effective_product_group_id,
    pg.name AS effective_product_group_name,
    COALESCE(pg.is_internal, false) AS is_internal_group,
    pgws.source_department_id AS expected_source_department_id,
    sd.name AS expected_source_department_name
  FROM (
    SELECT
      it.id AS tx_id,
      it.product_id,
      p.name AS product_name,
      it.department_id AS actual_source_department_id,
      srcd.name AS actual_source_department_name,
      CAST(it.reference_id AS UNSIGNED) AS order_item_id,
      o.order_number,
      it.created_at,
      td.id AS target_department_id,
      td.name AS target_department_name,
      tb.id AS target_branch_id,
      tb.name AS target_branch_name,
      COALESCE(
        (
          SELECT pg_explicit.id
          FROM product_group_links pgl_explicit
          JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
          JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
          WHERE pgl_explicit.product_id = p.id
            AND pg_explicit.is_active = true
            AND pgws.source_department_id = wbm.source_department_id
          ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
          LIMIT 1
        ),
        (
          SELECT pg_scope.id
          FROM product_group_links pgl_scope
          JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
          JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
          WHERE pgl_scope.product_id = p.id
            AND pg_scope.is_active = true
            AND pgs_scope.branch_id = tb.id
            AND pgs_scope.department_id = td.id
          ORDER BY pgl_scope.is_primary DESC, pg_scope.id
          LIMIT 1
        ),
        (
          SELECT pg_map.id
          FROM product_group_links pgl_map
          JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
          WHERE pgl_map.product_id = p.id
            AND pg_map.is_internal = true
            AND pg_map.linked_department_id = wbm.source_department_id
          ORDER BY pg_map.id
          LIMIT 1
        ),
        p.product_group_id
      ) AS effective_product_group_id
    FROM inventory_transactions it
    JOIN departments srcd ON srcd.id = it.department_id
    JOIN order_items oi ON oi.id = CAST(it.reference_id AS UNSIGNED)
    JOIN orders o ON o.id = oi.order_id
    JOIN users ou ON ou.id = o.user_id
    JOIN departments td ON td.id = ou.department_id
    JOIN branches tb ON tb.id = td.branch_id
    JOIN products p ON p.id = it.product_id
    LEFT JOIN withdraw_branch_source_mappings wbm
      ON wbm.target_branch_id = tb.id
    WHERE it.reference_type = 'order_receiving'
      AND it.transaction_type = 'transfer_out'
      AND it.reference_id REGEXP '^[0-9]+$'
      AND DATE(CONVERT_TZ(it.created_at, '+00:00', ?)) >= ?
  ) c
  LEFT JOIN product_groups pg ON pg.id = c.effective_product_group_id
  LEFT JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg.id
  LEFT JOIN departments sd ON sd.id = pgws.source_department_id
  ORDER BY c.created_at ASC, c.tx_id ASC
`;

const reflowPair = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, quantity, balance_before
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, departmentId]
  );

  if (rows.length === 0) {
    await connection.query(
      `UPDATE inventory_balance
       SET quantity = 0, last_transaction_id = NULL, last_updated = CURRENT_TIMESTAMP
       WHERE product_id = ? AND department_id = ?`,
      [productId, departmentId]
    );
    return { rows: 0, updates: 0 };
  }

  let running = toNum(rows[0].balance_before, 0);
  let updates = 0;

  for (const row of rows) {
    const qty = toNum(row.quantity, 0);
    const expectedBefore = running;
    const expectedAfter = expectedBefore + qty;
    running = expectedAfter;

    await connection.query(
      `UPDATE inventory_transactions
       SET balance_before = ?, balance_after = ?
       WHERE id = ?`,
      [expectedBefore, expectedAfter, row.id]
    );
    updates += 1;
  }

  const lastRow = rows[rows.length - 1];
  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, departmentId, running, lastRow.id]
  );

  return { rows: rows.length, updates };
};

const main = async () => {
  const { fromDate, dryRun } = parseArgs();
  console.log(`Backfill from date (Asia/Bangkok): ${fromDate}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);

  const [allCandidates] = await pool.query(CANDIDATE_SQL, [TZ_OFFSET, fromDate]);
  console.log(`Candidates scanned: ${allCandidates.length}`);

  const wrongRows = allCandidates.filter((row) => {
    const expected = toNum(row.expected_source_department_id, NaN);
    const actual = toNum(row.actual_source_department_id, NaN);
    const target = toNum(row.target_department_id, NaN);
    const isInternal = toNum(row.is_internal_group, 0) === 1;

    if (!isInternal) return false;
    if (!Number.isFinite(expected) || expected <= 0) return false;
    if (!Number.isFinite(actual) || actual <= 0) return false;
    if (!Number.isFinite(target) || target <= 0) return false;
    if (expected === target) return false;
    return expected !== actual;
  });

  console.log(`Incorrect rows: ${wrongRows.length}`);

  if (wrongRows.length === 0) {
    return;
  }

  if (dryRun) {
    console.table(
      wrongRows.slice(0, 100).map((row) => ({
        tx_id: row.tx_id,
        order_number: row.order_number,
        product: row.product_name,
        actual_source: `${row.actual_source_department_name} (#${row.actual_source_department_id})`,
        expected_source: `${row.expected_source_department_name} (#${row.expected_source_department_id})`,
        target: `${row.target_branch_name}/${row.target_department_name}`,
        created_at: row.created_at
      }))
    );
    return;
  }

  const backupTable = makeBackupTableName();
  const txIds = wrongRows
    .map((row) => toNum(row.tx_id, NaN))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (txIds.length === 0) {
    console.log('No tx ids to update.');
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(`CREATE TABLE ${backupTable} LIKE inventory_transactions`);
    await connection.query(
      `INSERT INTO ${backupTable}
       SELECT * FROM inventory_transactions
       WHERE id IN (${txIds.map(() => '?').join(',')})`,
      txIds
    );

    for (const row of wrongRows) {
      await connection.query(
        `UPDATE inventory_transactions
         SET department_id = ?, notes = CONCAT(COALESCE(notes, ''), ' [backfill-fix-source]')
         WHERE id = ?`,
        [toNum(row.expected_source_department_id), toNum(row.tx_id)]
      );
    }

    const pairSet = new Set();
    for (const row of wrongRows) {
      const productId = toNum(row.product_id);
      const oldDept = toNum(row.actual_source_department_id);
      const newDept = toNum(row.expected_source_department_id);
      if (Number.isFinite(productId) && Number.isFinite(oldDept)) {
        pairSet.add(`${productId}:${oldDept}`);
      }
      if (Number.isFinite(productId) && Number.isFinite(newDept)) {
        pairSet.add(`${productId}:${newDept}`);
      }
    }

    let pairCount = 0;
    for (const key of pairSet) {
      const [productId, departmentId] = key.split(':').map((v) => Number(v));
      await reflowPair(connection, productId, departmentId);
      pairCount += 1;
    }

    await connection.commit();
    console.log(`Backup table: ${backupTable}`);
    console.log(`Updated rows: ${wrongRows.length}`);
    console.log(`Reflowed pairs: ${pairCount}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // ignore
    }
  });

