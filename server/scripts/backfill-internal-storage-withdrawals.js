import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

const readArgValue = (prefix) => {
  const found = args.find((arg) => arg.startsWith(`${prefix}=`));
  if (!found) return '';
  return found.slice(prefix.length + 1).trim();
};

const normalizeDateArg = (value, label) => {
  const v = String(value || '').trim();
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`Invalid ${label}: ${v} (expected YYYY-MM-DD)`);
  }
  return v;
};

const startDate = normalizeDateArg(readArgValue('--start'), 'start date');
const endDate = normalizeDateArg(readArgValue('--end'), 'end date');
if (startDate && endDate && startDate > endDate) {
  throw new Error(`Invalid range: start (${startDate}) must be <= end (${endDate})`);
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const approxZero = (value) => Math.abs(toNumber(value, 0)) < 0.000001;

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'market_order_db',
  port: Number(process.env.DB_PORT || 3306)
});

const buildDateFilter = () => {
  const clauses = [];
  const params = [];
  if (startDate) {
    clauses.push('DATE(oi.received_at) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    clauses.push('DATE(oi.received_at) <= ?');
    params.push(endDate);
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '',
    params
  };
};

const ensureTables = async () => {
  const [rows] = await connection.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (
         'inventory_transactions',
         'inventory_balance',
         'product_group_internal_scopes'
       )`
  );

  const names = new Set(rows.map((row) => String(Object.values(row)[0] || '').toLowerCase()));
  const missing = ['inventory_transactions', 'inventory_balance', 'product_group_internal_scopes']
    .filter((name) => !names.has(name));

  if (missing.length > 0) {
    throw new Error(`Missing required tables: ${missing.join(', ')}`);
  }
};

const resolveSourceDepartment = async ({ productGroupId, targetDepartmentId }) => {
  const [scopeRows] = await connection.query(
    `SELECT pgis.department_id, d.name AS department_name, d.branch_id
     FROM product_group_internal_scopes pgis
     JOIN departments d ON d.id = pgis.department_id
     WHERE pgis.product_group_id = ?
       AND d.is_active = true
     ORDER BY pgis.id ASC`,
    [productGroupId]
  );

  if (scopeRows.length === 0) {
    return { sourceDepartmentId: null, sourceDepartmentName: null, reason: 'no_scope' };
  }

  if (scopeRows.length === 1) {
    return {
      sourceDepartmentId: Number(scopeRows[0].department_id),
      sourceDepartmentName: scopeRows[0].department_name || null,
      reason: 'single_scope'
    };
  }

  const [targetRows] = await connection.query(
    'SELECT branch_id FROM departments WHERE id = ? LIMIT 1',
    [targetDepartmentId]
  );
  if (targetRows.length === 0) {
    return { sourceDepartmentId: null, sourceDepartmentName: null, reason: 'target_not_found' };
  }
  const targetBranchId = Number(targetRows[0].branch_id);

  const sameBranch = scopeRows.filter((row) => Number(row.branch_id) === targetBranchId);
  if (sameBranch.length === 1) {
    return {
      sourceDepartmentId: Number(sameBranch[0].department_id),
      sourceDepartmentName: sameBranch[0].department_name || null,
      reason: 'same_branch_single_scope'
    };
  }

  return { sourceDepartmentId: null, sourceDepartmentName: null, reason: 'ambiguous_scope' };
};

const getTargetNetByOrderItem = async (orderItemId, targetDepartmentId) => {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM inventory_transactions
     WHERE reference_type = 'order_receiving'
       AND reference_id = ?
       AND department_id = ?
       AND transaction_type IN ('receive', 'adjustment', 'transfer_in', 'transfer_out')`,
    [String(orderItemId), targetDepartmentId]
  );
  return toNumber(rows?.[0]?.total, 0);
};

const getExistingSourceNetByOrderItem = async (orderItemId, sourceDepartmentId) => {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM inventory_transactions
     WHERE reference_type = 'order_receiving'
       AND reference_id = ?
       AND department_id = ?
       AND transaction_type IN ('transfer_in', 'transfer_out')`,
    [String(orderItemId), sourceDepartmentId]
  );
  return toNumber(rows?.[0]?.total, 0);
};

const lockBalance = async (productId, departmentId) => {
  const [rows] = await connection.query(
    `SELECT quantity
     FROM inventory_balance
     WHERE product_id = ? AND department_id = ?
     FOR UPDATE`,
    [productId, departmentId]
  );
  return rows.length > 0 ? toNumber(rows[0].quantity, 0) : 0;
};

const insertBackfillTransaction = async ({
  productId,
  departmentId,
  transactionType,
  quantity,
  balanceBefore,
  balanceAfter,
  orderItemId,
  note
}) => {
  const [txResult] = await connection.query(
    `INSERT INTO inventory_transactions
      (product_id, department_id, transaction_type, quantity, balance_before, balance_after,
       reference_type, reference_id, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'order_receiving', ?, ?, NULL)`,
    [
      productId,
      departmentId,
      transactionType,
      quantity,
      balanceBefore,
      balanceAfter,
      String(orderItemId),
      note
    ]
  );

  await connection.query(
    `INSERT INTO inventory_balance (product_id, department_id, quantity, last_transaction_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       quantity = VALUES(quantity),
       last_transaction_id = VALUES(last_transaction_id),
       last_updated = CURRENT_TIMESTAMP`,
    [productId, departmentId, balanceAfter, txResult.insertId]
  );
};

const run = async () => {
  const dateFilter = buildDateFilter();
  await ensureTables();

  const [candidateRows] = await connection.query(
    `SELECT
       oi.id AS order_item_id,
       oi.received_at,
       o.order_number,
       d.id AS target_department_id,
       d.name AS target_department_name,
       p.id AS product_id,
       p.code AS product_code,
       p.name AS product_name,
       pg.id AS product_group_id,
       pg.name AS product_group_name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN users u ON u.id = o.user_id
     JOIN departments d ON d.id = u.department_id
     JOIN products p ON p.id = oi.product_id
     JOIN product_groups pg ON pg.id = p.product_group_id
     WHERE oi.received_at IS NOT NULL
       AND pg.is_internal = true
       ${dateFilter.sql}
     ORDER BY oi.received_at ASC, oi.id ASC`,
    dateFilter.params
  );

  const summary = {
    mode: isDryRun ? 'dry-run' : 'execute',
    scope: {
      start_date: startDate || null,
      end_date: endDate || null
    },
    candidates: candidateRows.length,
    patched: 0,
    skipped_zero_target_net: 0,
    skipped_no_source_scope: 0,
    skipped_same_department: 0,
    skipped_already_synced: 0,
    skipped_ambiguous_scope: 0,
    errors: 0
  };

  const samples = [];

  if (!isDryRun) {
    await connection.beginTransaction();
  }

  try {
    for (const row of candidateRows) {
      try {
        const orderItemId = Number(row.order_item_id);
        const productId = Number(row.product_id);
        const targetDepartmentId = Number(row.target_department_id);
        const productGroupId = Number(row.product_group_id);

        const source = await resolveSourceDepartment({
          productGroupId,
          targetDepartmentId
        });

        if (!source.sourceDepartmentId) {
          if (source.reason === 'ambiguous_scope') {
            summary.skipped_ambiguous_scope += 1;
          } else {
            summary.skipped_no_source_scope += 1;
          }
          continue;
        }

        if (Number(source.sourceDepartmentId) === targetDepartmentId) {
          summary.skipped_same_department += 1;
          continue;
        }

        const targetNet = await getTargetNetByOrderItem(orderItemId, targetDepartmentId);
        if (approxZero(targetNet)) {
          summary.skipped_zero_target_net += 1;
          continue;
        }

        const desiredSourceNet = -targetNet;
        const existingSourceNet = await getExistingSourceNetByOrderItem(
          orderItemId,
          Number(source.sourceDepartmentId)
        );

        const delta = desiredSourceNet - existingSourceNet;
        if (approxZero(delta)) {
          summary.skipped_already_synced += 1;
          continue;
        }

        const transactionType = delta < 0 ? 'transfer_out' : 'transfer_in';
        const sourceBefore = isDryRun
          ? 0
          : await lockBalance(productId, Number(source.sourceDepartmentId));
        const sourceAfter = sourceBefore + delta;
        const note = delta < 0
          ? `Backfill ตัดจ่ายจากพื้นที่จัดเก็บไปยัง ${row.target_department_name || ''} จากใบสั่งซื้อ ${row.order_number || ''}`.trim()
          : `Backfill รับคืนเข้าพื้นที่จัดเก็บจาก ${row.target_department_name || ''} จากใบสั่งซื้อ ${row.order_number || ''}`.trim();

        if (!isDryRun) {
          await insertBackfillTransaction({
            productId,
            departmentId: Number(source.sourceDepartmentId),
            transactionType,
            quantity: delta,
            balanceBefore: sourceBefore,
            balanceAfter: sourceAfter,
            orderItemId,
            note
          });
        }

        summary.patched += 1;
        if (samples.length < 30) {
          samples.push({
            order_item_id: orderItemId,
            product_code: row.product_code,
            product_name: row.product_name,
            product_group_name: row.product_group_name,
            target_department_id: targetDepartmentId,
            target_department_name: row.target_department_name,
            source_department_id: Number(source.sourceDepartmentId),
            source_department_name: source.sourceDepartmentName,
            target_net_quantity: targetNet,
            source_existing_net_quantity: existingSourceNet,
            source_delta_applied: delta,
            transaction_type: transactionType
          });
        }
      } catch (itemError) {
        summary.errors += 1;
        if (samples.length < 30) {
          samples.push({
            order_item_id: Number(row.order_item_id),
            product_code: row.product_code,
            product_name: row.product_name,
            error: itemError.message
          });
        }
      }
    }

    if (!isDryRun) {
      if (summary.errors > 0) {
        await connection.rollback();
        throw new Error(`Backfill aborted due to ${summary.errors} item errors`);
      }
      await connection.commit();
    }
  } catch (error) {
    if (!isDryRun) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback failure
      }
    }
    throw error;
  }

  console.log(JSON.stringify({ summary, samples }, null, 2));
};

try {
  await run();
} catch (error) {
  console.error(`Backfill failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}

