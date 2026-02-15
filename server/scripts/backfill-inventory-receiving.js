import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const startDateArg = process.argv[2] || '';
const endDateArg = process.argv[3] || '';

const normalizeDateArg = (value) => {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`Invalid date format: ${v}. Expected YYYY-MM-DD`);
  }
  return v;
};

const startDate = normalizeDateArg(startDateArg);
const endDate = normalizeDateArg(endDateArg);
if (startDate && endDate && startDate > endDate) {
  throw new Error(`Invalid range: start_date (${startDate}) must be <= end_date (${endDate})`);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: Number(process.env.DB_PORT || 3306)
});

const querySingleNumber = async (sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  const row = rows?.[0] || {};
  const key = Object.keys(row)[0];
  return Number(row[key] || 0);
};

const ensureInventoryTables = async () => {
  const [rows] = await connection.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('inventory_balance', 'inventory_transactions')`
  );
  const tableNames = new Set(
    rows.map((row) => String(Object.values(row)[0] || '').toLowerCase())
  );
  if (!tableNames.has('inventory_balance') || !tableNames.has('inventory_transactions')) {
    throw new Error(
      'Missing inventory tables. Run migration: server/database/migrations/001_create_inventory_tables.sql'
    );
  }
};

const buildDateFilter = (fieldName) => {
  const clauses = [];
  const params = [];
  if (startDate) {
    clauses.push(`DATE(${fieldName}) >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    clauses.push(`DATE(${fieldName}) <= ?`);
    params.push(endDate);
  }
  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params
  };
};

const run = async () => {
  try {
    await ensureInventoryTables();

    const dateFilter = buildDateFilter('oi.received_at');

    const totalReceived = await querySingleNumber(
      `SELECT COUNT(*)
       FROM order_items oi
       WHERE oi.received_at IS NOT NULL
       ${dateFilter.sql}`,
      dateFilter.params
    );

    const alreadyBackfilled = await querySingleNumber(
      `SELECT COUNT(*)
       FROM inventory_transactions it
       WHERE it.reference_type = 'order_receiving'
       ${startDate ? 'AND DATE(it.created_at) >= ?' : ''}
       ${endDate ? 'AND DATE(it.created_at) <= ?' : ''}`,
      [
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ]
    );

    await connection.beginTransaction();

    const [candidateRows] = await connection.query(
      `SELECT
         oi.id AS order_item_id,
         oi.product_id,
         oi.received_quantity,
         oi.received_at,
         oi.receive_notes,
         oi.received_by_user_id,
         o.order_number,
         d.id AS department_id,
         COALESCE(p.is_countable, true) AS is_countable
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN departments d ON u.department_id = d.id
       LEFT JOIN products p ON oi.product_id = p.id
       LEFT JOIN inventory_transactions it
         ON it.reference_type = 'order_receiving'
        AND it.reference_id = CAST(oi.id AS CHAR)
       WHERE oi.received_at IS NOT NULL
         AND oi.received_quantity IS NOT NULL
         ${dateFilter.sql}
         AND it.id IS NULL
       ORDER BY oi.received_at ASC, oi.id ASC`,
      dateFilter.params
    );

    let insertedCount = 0;
    let skippedZeroQty = 0;
    let skippedNonCountable = 0;

    for (const row of candidateRows) {
      const quantity = Number(row.received_quantity || 0);
      if (!Number.isFinite(quantity) || quantity === 0) {
        skippedZeroQty += 1;
        continue;
      }

      if (Number(row.is_countable) !== 1) {
        skippedNonCountable += 1;
        continue;
      }

      const [balanceRows] = await connection.query(
        `SELECT quantity
         FROM inventory_balance
         WHERE product_id = ? AND department_id = ?
         FOR UPDATE`,
        [row.product_id, row.department_id]
      );
      const balanceBefore =
        balanceRows.length > 0 ? Number(balanceRows[0].quantity || 0) : 0;
      const balanceAfter = balanceBefore + quantity;
      const note = String(row.receive_notes || '').trim()
        || `Backfill รับสินค้าเข้าคลังจากใบสั่งซื้อ ${row.order_number || ''}`.trim();

      const [txResult] = await connection.query(
        `INSERT INTO inventory_transactions
          (product_id, department_id, transaction_type, quantity,
           balance_before, balance_after, reference_type, reference_id, notes, created_by, created_at)
         VALUES (?, ?, 'receive', ?, ?, ?, 'order_receiving', ?, ?, ?, ?)`,
        [
          row.product_id,
          row.department_id,
          quantity,
          balanceBefore,
          balanceAfter,
          String(row.order_item_id),
          note,
          row.received_by_user_id || null,
          row.received_at
        ]
      );

      await connection.query(
        `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           quantity = VALUES(quantity),
           last_transaction_id = VALUES(last_transaction_id),
           last_updated = CURRENT_TIMESTAMP`,
        [row.product_id, row.department_id, balanceAfter, txResult.insertId]
      );

      insertedCount += 1;
    }

    await connection.commit();

    const totalInventoryTx = await querySingleNumber(
      'SELECT COUNT(*) FROM inventory_transactions'
    );

    console.log('Backfill completed');
    console.log(
      JSON.stringify(
        {
          scope: {
            start_date: startDate || null,
            end_date: endDate || null
          },
          total_received_in_scope: totalReceived,
          candidates_without_ledger: candidateRows.length,
          inserted_transactions: insertedCount,
          skipped_zero_quantity: skippedZeroQty,
          skipped_non_countable: skippedNonCountable,
          ledger_rows_before_scope_check: alreadyBackfilled,
          ledger_rows_total_after: totalInventoryTx
        },
        null,
        2
      )
    );
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback error
    }
    console.error('Backfill failed:', error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
};

await run();
