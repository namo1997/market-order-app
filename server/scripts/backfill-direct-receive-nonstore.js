import dotenv from 'dotenv';
import pool from '../src/config/database.js';

dotenv.config();

const EPS = 0.0001;

const toNum = (v) => Number.parseFloat(v || 0) || 0;

const isStoreGroup = (name, code) => {
  const groupName = String(name || '').trim();
  const groupCode = String(code || '').trim().toUpperCase();
  return /สโตร์|store/i.test(groupName) || groupCode.startsWith('STORE');
};

const parseArgDate = () => {
  const arg = process.argv.find((item) => item.startsWith('--date='));
  if (!arg) return null;
  const value = String(arg.split('=')[1] || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

const getBangkokToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

const toSqlDateTime = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const sameNum = (a, b) => Math.abs(toNum(a) - toNum(b)) <= EPS;

const recalcPair = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, quantity, balance_before
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [productId, departmentId]
  );

  if (rows.length === 0) return;

  let running = toNum(rows[0].balance_before);
  for (const row of rows) {
    const qty = toNum(row.quantity);
    const next = running + qty;
    await connection.query(
      `UPDATE inventory_transactions
       SET balance_before = ?, balance_after = ?
       WHERE id = ?`,
      [running, next, row.id]
    );
    running = next;
  }
};

const refreshBalance = async (connection, productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT id, balance_after
     FROM inventory_transactions
     WHERE product_id = ? AND department_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [productId, departmentId]
  );

  if (rows.length === 0) {
    await connection.query(
      `UPDATE inventory_balance
       SET quantity = 0, last_transaction_id = NULL, last_updated = CURRENT_TIMESTAMP
       WHERE product_id = ? AND department_id = ?`,
      [productId, departmentId]
    );
    return;
  }

  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, departmentId, toNum(rows[0].balance_after), Number(rows[0].id)]
  );
};

const buildBackupName = (prefix) => {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}_${stamp}`;
};

const main = async () => {
  const date = parseArgDate() || getBangkokToday();
  const startUtc = new Date(`${date}T00:00:00+07:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const startSql = toSqlDateTime(startUtc);
  const endSql = toSqlDateTime(endUtc);

  console.log(`[backfill] date (Asia/Bangkok): ${date}`);
  console.log(`[backfill] utc range: ${startSql} -> ${endSql}`);

  const [rows] = await pool.query(
    `SELECT
      it.id AS transfer_out_id,
      it.product_id,
      it.department_id AS source_department_id,
      it.reference_id,
      it.quantity AS transfer_out_qty,
      it.created_at,
      p.name AS product_name,
      COALESCE(pg.is_internal, false) AS is_internal_group,
      pg.name AS product_group_name,
      pg.code AS product_group_code
     FROM inventory_transactions it
     JOIN products p ON p.id = it.product_id
     LEFT JOIN product_groups pg ON pg.id = p.product_group_id
     WHERE it.reference_type = 'order_receiving'
       AND it.transaction_type = 'transfer_out'
       AND it.created_at >= ?
       AND it.created_at < ?
       AND COALESCE(pg.is_internal, false) = true
     ORDER BY it.created_at ASC, it.id ASC`,
    [startSql, endSql]
  );

  const candidates = rows.filter(
    (row) => !isStoreGroup(row.product_group_name, row.product_group_code)
  );
  console.log(`[backfill] candidates (non-store internal): ${candidates.length}`);

  const ops = [];
  for (const row of candidates) {
    const [pairRows] = await pool.query(
      `SELECT id, department_id, quantity
       FROM inventory_transactions
       WHERE reference_type = 'order_receiving'
         AND reference_id = ?
         AND product_id = ?
         AND transaction_type = 'transfer_in'
       ORDER BY created_at ASC, id ASC`,
      [String(row.reference_id), Number(row.product_id)]
    );

    const expectedQty = Math.abs(toNum(row.transfer_out_qty));
    const pair = pairRows.find((item) => sameNum(item.quantity, expectedQty));
    if (!pair) {
      console.log(
        `[skip] no transfer_in pair for transfer_out id=${row.transfer_out_id}, reference_id=${row.reference_id}`
      );
      continue;
    }

    const [orderRows] = await pool.query(
      `SELECT o.order_number
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.id = ?
       LIMIT 1`,
      [Number(row.reference_id)]
    );
    const orderNumber = orderRows?.[0]?.order_number || null;
    const receiveNote = orderNumber
      ? `รับสินค้าเข้าคลังจากใบสั่งซื้อ ${orderNumber}`
      : 'รับสินค้าเข้าคลัง';

    ops.push({
      transferOutId: Number(row.transfer_out_id),
      transferInId: Number(pair.id),
      productId: Number(row.product_id),
      sourceDepartmentId: Number(row.source_department_id),
      targetDepartmentId: Number(pair.department_id),
      receiveNote,
      productName: row.product_name,
      referenceId: String(row.reference_id)
    });
  }

  if (ops.length === 0) {
    console.log('[backfill] no operation needed');
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const txIds = Array.from(
      new Set(ops.flatMap((item) => [item.transferOutId, item.transferInId]))
    );
    const pairKeys = Array.from(
      new Set(ops.map((item) => `${item.productId}:${item.sourceDepartmentId}`))
    ).map((key) => {
      const [productId, departmentId] = key.split(':').map((v) => Number(v));
      return { productId, departmentId };
    });

    const backupTxTable = buildBackupName('bkp_backfill_nonstore_order_receiving_tx');
    await connection.query(
      `CREATE TABLE ${backupTxTable} AS
       SELECT *
       FROM inventory_transactions
       WHERE id IN (${txIds.map(() => '?').join(',')})`,
      txIds
    );

    const backupBalTable = buildBackupName('bkp_backfill_nonstore_order_receiving_bal');
    const balanceWhere = pairKeys
      .map(() => '(product_id = ? AND department_id = ?)')
      .join(' OR ');
    const balanceParams = pairKeys.flatMap((pair) => [pair.productId, pair.departmentId]);
    await connection.query(
      `CREATE TABLE ${backupBalTable} AS
       SELECT *
       FROM inventory_balance
       WHERE ${balanceWhere}`,
      balanceParams
    );

    for (const op of ops) {
      await connection.query(
        `UPDATE inventory_transactions
         SET transaction_type = 'receive',
             notes = ?
         WHERE id = ?`,
        [op.receiveNote, op.transferInId]
      );

      await connection.query('DELETE FROM inventory_transactions WHERE id = ?', [op.transferOutId]);
    }

    for (const pair of pairKeys) {
      await recalcPair(connection, pair.productId, pair.departmentId);
      await refreshBalance(connection, pair.productId, pair.departmentId);
    }

    await connection.commit();
    console.log('[backfill] done');
    console.log(`[backfill] updated pairs: ${pairKeys.length}`);
    console.log(`[backfill] operations: ${ops.length}`);
    console.log(`[backfill] backup tx table: ${backupTxTable}`);
    console.log(`[backfill] backup balance table: ${backupBalTable}`);
    console.table(
      ops.map((op) => ({
        reference_id: op.referenceId,
        product_id: op.productId,
        product_name: op.productName,
        transfer_out_id: op.transferOutId,
        transfer_in_id: op.transferInId
      }))
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

main()
  .catch((error) => {
    console.error('[backfill] failed:', error?.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
