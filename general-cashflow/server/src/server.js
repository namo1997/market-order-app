import cors from 'cors';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, loginCashierWithoutPassword, loginUser, requirePermission } from './auth.js';
import { config } from './config.js';
import { fetchExpectedSales } from './clickhouse.js';
import { getPool, logAudit, migrateDatabase } from './db.js';
import {
  calculateLineVariance,
  canTransitionReceipt,
  computeExpectedTotals,
  resolveCheckedStatus,
  validateVarianceReasons
} from './domain/receipts.js';
import { roundMoney, sumMoney } from './domain/money.js';
import { parseStatementBuffer } from './domain/statements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '..', config.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-\u0E00-\u0E7F]+/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const app = express();
const corsOriginSet = new Set(config.corsOrigin);
const isPrivateLanOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
};
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOriginSet.has(origin) || isPrivateLanOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const validateDate = (value, field = 'date') => {
  const normalized = String(value || '').trim();
  if (!DATE_PATTERN.test(normalized)) {
    const error = new Error(`${field} must be YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const receiptStatusLabel = (status) => ({
  DRAFT: 'ยังไม่ส่ง',
  SUBMITTED: 'รอตรวจ',
  CHECKED_OK: 'ตรวจแล้วครบ',
  CHECKED_VARIANCE: 'ตรวจแล้วมีส่วนต่าง',
  NEEDS_CORRECTION: 'ส่งกลับแก้ไข',
  CLOSED: 'ปิดเอกสารแล้ว'
}[status] || status);

const getPaymentChannels = async (connection = getPool()) => {
  const [rows] = await connection.query(
    `SELECT pc.*,
            COALESCE(JSON_ARRAYAGG(NULLIF(pcm.clickhouse_description, '')), JSON_ARRAY()) AS mappings_json
     FROM payment_channels pc
     LEFT JOIN payment_channel_mappings pcm ON pcm.payment_channel_id = pc.id
     WHERE pc.is_active = TRUE
     GROUP BY pc.id
     ORDER BY pc.sort_order ASC, pc.id ASC`
  );
  return rows.map((row) => ({
    ...row,
    mappings: typeof row.mappings_json === 'string'
      ? JSON.parse(row.mappings_json).filter(Boolean)
      : (row.mappings_json || []).filter(Boolean)
  }));
};

const getMappingIndex = async (connection = getPool()) => {
  const channels = await getPaymentChannels(connection);
  const byDescription = new Map();
  const byCode = new Map();
  for (const channel of channels) {
    byCode.set(channel.code, channel);
    for (const mapping of channel.mappings) {
      byDescription.set(String(mapping).trim(), channel);
    }
  }
  return { channels, byDescription, byCode };
};

const serializeReceipt = async (receiptId, connection = getPool()) => {
  const [receipts] = await connection.query(
    `SELECT dr.*, b.code AS branch_code, b.name AS branch_name, b.clickhouse_branch_id,
            su.full_name AS submitted_by_name,
            cu.full_name AS checked_by_name,
            ru.full_name AS closed_by_name
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN users su ON su.id = dr.submitted_by
     LEFT JOIN users cu ON cu.id = dr.checked_by
     LEFT JOIN users ru ON ru.id = dr.closed_by
     WHERE dr.id = ?`,
    [receiptId]
  );
  const receipt = receipts[0];
  if (!receipt) return null;

  const [lines] = await connection.query(
    `SELECT drl.*, pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind, pc.provider
     FROM daily_receipt_lines drl
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     WHERE drl.receipt_id = ?
     ORDER BY pc.sort_order ASC, pc.id ASC`,
    [receiptId]
  );
  const [imports] = await connection.query(
    `SELECT si.*, pc.code AS channel_code, pc.label AS channel_label, u.full_name AS imported_by_name
     FROM statement_imports si
     LEFT JOIN payment_channels pc ON pc.id = si.payment_channel_id
     LEFT JOIN users u ON u.id = si.imported_by
     WHERE si.receipt_id = ?
     ORDER BY si.created_at DESC`,
    [receiptId]
  );
  const [attachments] = await connection.query(
    `SELECT a.*, u.full_name AS uploaded_by_name
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.receipt_id = ?
     ORDER BY a.created_at DESC`,
    [receiptId]
  );
  const [auditLogs] = await connection.query(
    `SELECT al.*, u.full_name AS actor_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.entity_type = 'daily_receipt' AND al.entity_id = ?
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT 50`,
    [receiptId]
  );
  const [miscItems] = await connection.query(
    `SELECT rmi.*, u.full_name AS created_by_name
     FROM receipt_misc_items rmi
     LEFT JOIN users u ON u.id = rmi.created_by
     WHERE rmi.receipt_id = ?
     ORDER BY rmi.created_at ASC, rmi.id ASC`,
    [receiptId]
  );

  return {
    ...receipt,
    status_label: receiptStatusLabel(receipt.status),
    lines,
    statement_imports: imports,
    attachments,
    audit_logs: auditLogs,
    misc_items: miscItems
  };
};

const requireReceipt = async (receiptId, connection = getPool()) => {
  const receipt = await serializeReceipt(receiptId, connection);
  if (!receipt) {
    const error = new Error('Receipt not found.');
    error.statusCode = 404;
    throw error;
  }
  return receipt;
};

const updateReceiptLineVerifiedAmounts = async ({ connection, receiptId, inputLines = [] }) => {
  const [rows] = await connection.query(
    `SELECT drl.*, pc.code AS channel_code
     FROM daily_receipt_lines drl
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     WHERE drl.receipt_id = ?`,
    [receiptId]
  );
  const inputByLine = new Map();
  const inputByChannel = new Map();
  for (const line of inputLines) {
    if (line.id) inputByLine.set(Number(line.id), line);
    if (line.payment_channel_id) inputByChannel.set(Number(line.payment_channel_id), line);
  }

  const updated = [];
  for (const row of rows) {
    const input = inputByLine.get(Number(row.id)) || inputByChannel.get(Number(row.payment_channel_id)) || {};
    const verifiedInput = input.verified_amount ?? input.statement_amount;
    const statementAmount =
      verifiedInput === undefined || verifiedInput === null || verifiedInput === ''
        ? row.statement_amount
        : roundMoney(verifiedInput);
    const next = calculateLineVariance({
      channelCode: row.channel_code,
      expectedAmount: row.expected_amount,
      cashierAmount: input.cashier_amount ?? row.cashier_amount,
      verifiedAmount: statementAmount
    });
    const reason =
      input.variance_reason !== undefined
        ? String(input.variance_reason || '').trim() || null
        : row.variance_reason;

    await connection.query(
      `UPDATE daily_receipt_lines
       SET statement_amount = ?, variance_amount = ?, variance_reason = ?
       WHERE id = ?`,
      [next.verifiedAmount, next.varianceAmount, reason, row.id]
    );
    updated.push({
      ...row,
      statement_amount: next.verifiedAmount,
      variance_amount: next.varianceAmount,
      variance_reason: reason
    });
  }
  return updated;
};

app.get('/health', (_req, res) => {
  res.json({ success: true, service: 'general-cashflow', ready: true, timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const result = await loginUser({
    username: String(req.body.username || '').trim(),
    password: String(req.body.password || '')
  });
  if (!result) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
  return res.json({ success: true, data: result });
}));

app.post('/api/auth/cashier', asyncHandler(async (req, res) => {
  const result = await loginCashierWithoutPassword({
    username: req.body?.username
  });
  if (!result) {
    return res.status(404).json({ success: false, message: 'No active cashier user found' });
  }
  return res.json({ success: true, data: result });
}));

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

app.get('/api/branches', authenticate, requirePermission('receipt:read'), asyncHandler(async (_req, res) => {
  const [rows] = await getPool().query('SELECT * FROM branches WHERE is_active = TRUE ORDER BY name ASC');
  res.json({ success: true, data: rows });
}));

app.post('/api/branches', authenticate, requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const { code, name, clickhouse_branch_id: clickhouseBranchId } = req.body;
  const [result] = await getPool().query(
    `INSERT INTO branches (code, name, clickhouse_branch_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), clickhouse_branch_id = VALUES(clickhouse_branch_id), is_active = TRUE`,
    [String(code || '').trim(), String(name || '').trim(), String(clickhouseBranchId || '').trim() || null]
  );
  res.status(201).json({ success: true, data: { id: result.insertId || null } });
}));

app.get('/api/payment-channels', authenticate, requirePermission('receipt:read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getPaymentChannels() });
}));

app.put('/api/payment-channels/:id', authenticate, requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const channelId = Number(req.params.id);
  const mappings = Array.isArray(req.body.mappings) ? req.body.mappings : [];
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `UPDATE payment_channels
       SET label = ?, provider = ?, account_number = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        String(req.body.label || '').trim(),
        String(req.body.provider || '').trim() || null,
        String(req.body.account_number || '').trim() || null,
        Number(req.body.sort_order || 100),
        req.body.is_active === false ? 0 : 1,
        channelId
      ]
    );
    await connection.query('DELETE FROM payment_channel_mappings WHERE payment_channel_id = ?', [channelId]);
    for (const mapping of mappings) {
      const text = String(mapping || '').trim();
      if (text) {
        await connection.query(
          `INSERT INTO payment_channel_mappings (payment_channel_id, clickhouse_description)
           VALUES (?, ?)`,
          [channelId, text]
        );
      }
    }
    await connection.commit();
    res.json({ success: true, data: await getPaymentChannels(connection) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/daily-receipts/from-clickhouse', authenticate, requirePermission('receipt:create'), asyncHandler(async (req, res) => {
  const receiptDate = validateDate(req.body.date || req.body.receipt_date, 'date');
  const branchId = Number(req.body.branch_id);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    return res.status(400).json({ success: false, message: 'branch_id is required' });
  }

  const connection = await getPool().getConnection();
  try {
    const [branches] = await connection.query('SELECT * FROM branches WHERE id = ? AND is_active = TRUE', [branchId]);
    const branch = branches[0];
    if (!branch?.clickhouse_branch_id) {
      const error = new Error('Branch is missing ClickHouse branch id.');
      error.statusCode = 400;
      throw error;
    }

    const expected = await fetchExpectedSales({
      receiptDate,
      clickhouseBranchId: branch.clickhouse_branch_id
    });
    const mappingIndex = await getMappingIndex(connection);
    const channelAmounts = new Map();
    const sourceDescriptions = new Map();
    const addChannelAmount = (channel, amount, description = '') => {
      const current = channelAmounts.get(channel.id) || 0;
      channelAmounts.set(channel.id, roundMoney(current + amount));
      if (description) {
        const values = sourceDescriptions.get(channel.id) || [];
        values.push(description);
        sourceDescriptions.set(channel.id, values);
      }
    };

    addChannelAmount(mappingIndex.byCode.get('CASH'), expected.cashSales, 'doc.paycashamount');
    for (const row of expected.paymentRows) {
      const mapped = mappingIndex.byDescription.get(String(row.description || '').trim()) || mappingIndex.byCode.get('OTHER_UNKNOWN');
      addChannelAmount(mapped, row.amount, row.description || 'UNKNOWN');
    }

    const nonCashLines = [];
    for (const [channelId, amount] of channelAmounts.entries()) {
      const channel = mappingIndex.channels.find((item) => item.id === channelId);
      if (channel?.code !== 'CASH') {
        nonCashLines.push({ expectedAmount: amount });
      }
    }
    const totals = computeExpectedTotals({
      grossSales: expected.grossSales,
      cashSales: expected.cashSales,
      nonCashLines
    });

    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      'SELECT * FROM daily_receipts WHERE receipt_date = ? AND branch_id = ? FOR UPDATE',
      [receiptDate, branchId]
    );
    const existing = existingRows[0];
    if (existing?.status === 'CLOSED') {
      const error = new Error('Closed receipt cannot be refreshed.');
      error.statusCode = 409;
      throw error;
    }

    let receiptId = existing?.id;
    if (!receiptId) {
      const [result] = await connection.query(
        `INSERT INTO daily_receipts
          (receipt_date, branch_id, gross_sales_expected, cash_expected, non_cash_expected, bill_count, clickhouse_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          receiptDate,
          branchId,
          totals.grossSalesExpected,
          totals.cashExpected,
          totals.nonCashExpected,
          expected.billCount
        ]
      );
      receiptId = result.insertId;
    } else {
      await connection.query(
        `UPDATE daily_receipts
         SET gross_sales_expected = ?, cash_expected = ?, non_cash_expected = ?, bill_count = ?, clickhouse_synced_at = NOW()
         WHERE id = ?`,
        [
          totals.grossSalesExpected,
          totals.cashExpected,
          totals.nonCashExpected,
          expected.billCount,
          receiptId
        ]
      );
    }

    for (const channel of mappingIndex.channels) {
      const expectedAmount = roundMoney(channelAmounts.get(channel.id) || 0);
      const descriptions = sourceDescriptions.get(channel.id) || [];
      await connection.query(
        `INSERT INTO daily_receipt_lines (receipt_id, payment_channel_id, expected_amount, source_description)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE expected_amount = VALUES(expected_amount), source_description = VALUES(source_description)`,
        [receiptId, channel.id, expectedAmount, descriptions.join(', ') || null]
      );
    }

    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: existing ? 'refresh_from_clickhouse' : 'create_from_clickhouse',
      actor: req.user,
      afterPayload: { receiptDate, branchId, expected, totals }
    });
    await connection.commit();
    res.status(existing ? 200 : 201).json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/daily-receipts', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.date) {
    clauses.push('dr.receipt_date = ?');
    params.push(validateDate(req.query.date));
  }
  if (req.query.branch_id) {
    clauses.push('dr.branch_id = ?');
    params.push(Number(req.query.branch_id));
  }
  if (req.query.status) {
    clauses.push('dr.status = ?');
    params.push(String(req.query.status));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT dr.*, b.name AS branch_name, b.code AS branch_code,
            COALESCE(SUM(drl.cashier_amount), 0) AS cashier_total,
            COALESCE(SUM(drl.statement_amount), 0) AS statement_total,
            COALESCE(SUM(drl.variance_amount), 0) AS variance_total
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     ${where}
     GROUP BY dr.id
     ORDER BY dr.receipt_date DESC, b.name ASC
     LIMIT 300`,
    params
  );
  res.json({
    success: true,
    data: rows.map((row) => ({ ...row, status_label: receiptStatusLabel(row.status) }))
  });
}));

app.get('/api/daily-receipts/:id', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requireReceipt(Number(req.params.id)) });
}));

app.put('/api/daily-receipts/:id/submit', authenticate, requirePermission('receipt:submit'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!canTransitionReceipt(receipt.status, 'SUBMITTED')) {
      const error = new Error(`Receipt in ${receipt.status} cannot be submitted.`);
      error.statusCode = 409;
      throw error;
    }
    const inputs = Array.isArray(req.body.lines) ? req.body.lines : [];
    for (const input of inputs) {
      await connection.query(
        `UPDATE daily_receipt_lines
         SET cashier_amount = ?
         WHERE receipt_id = ? AND payment_channel_id = ?`,
        [roundMoney(input.cashier_amount), receiptId, Number(input.payment_channel_id)]
      );
    }
    await connection.query(
      `UPDATE daily_receipts
       SET status = 'SUBMITTED', submitted_by = ?, submitted_at = NOW(), correction_note = NULL
       WHERE id = ?`,
      [req.user.id, receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'submit',
      actor: req.user,
      afterPayload: { lines: inputs }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/daily-receipts/:id/misc-items', authenticate, requirePermission('receipt:submit'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const label = String(req.body.label || '').trim();
  const amount = roundMoney(req.body.amount);
  if (!label) {
    return res.status(400).json({ success: false, message: 'label is required' });
  }
  const receipt = await requireReceipt(receiptId);
  if (!['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status)) {
    return res.status(409).json({ success: false, message: `Receipt in ${receipt.status} cannot add items.` });
  }
  await getPool().query(
    `INSERT INTO receipt_misc_items (receipt_id, label, amount, created_by)
     VALUES (?, ?, ?, ?)`,
    [receiptId, label, amount, req.user.id]
  );
  await logAudit({
    entityType: 'daily_receipt',
    entityId: receiptId,
    action: 'add_misc_item',
    actor: req.user,
    afterPayload: { label, amount }
  });
  res.status(201).json({ success: true, data: await serializeReceipt(receiptId) });
}));

app.delete('/api/daily-receipts/:id/misc-items/:itemId', authenticate, requirePermission('receipt:submit'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const receipt = await requireReceipt(receiptId);
  if (!['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status)) {
    return res.status(409).json({ success: false, message: `Receipt in ${receipt.status} cannot remove items.` });
  }
  await getPool().query('DELETE FROM receipt_misc_items WHERE id = ? AND receipt_id = ?', [itemId, receiptId]);
  await logAudit({
    entityType: 'daily_receipt',
    entityId: receiptId,
    action: 'remove_misc_item',
    actor: req.user,
    note: `itemId=${itemId}`
  });
  res.json({ success: true, data: await serializeReceipt(receiptId) });
}));

app.post('/api/daily-receipts/:id/attachments', authenticate, requirePermission('attachment:create'), upload.array('files', 8), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  await requireReceipt(receiptId);
  const type = ['cashier_summary', 'cash_slip', 'statement', 'other'].includes(req.body.attachment_type)
    ? req.body.attachment_type
    : 'other';
  for (const file of req.files || []) {
    await getPool().query(
      `INSERT INTO attachments (receipt_id, attachment_type, original_name, stored_path, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, type, file.originalname, file.path, file.mimetype, file.size, req.user.id]
    );
  }
  await logAudit({
    entityType: 'daily_receipt',
    entityId: receiptId,
    action: 'attach_files',
    actor: req.user,
    afterPayload: { count: req.files?.length || 0, attachment_type: type }
  });
  res.status(201).json({ success: true, data: await serializeReceipt(receiptId) });
}));

app.post('/api/statement-imports', authenticate, requirePermission('statement:import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'file is required' });
  }
  const receiptId = Number(req.body.receipt_id);
  const paymentChannelId = req.body.payment_channel_id ? Number(req.body.payment_channel_id) : null;
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (receipt.status === 'CLOSED') {
      const error = new Error('Closed receipt cannot import statement.');
      error.statusCode = 409;
      throw error;
    }
    const rows = await parseStatementBuffer({
      buffer: fs.readFileSync(req.file.path),
      originalName: req.file.originalname,
      mimeType: req.file.mimetype
    });
    const mappingIndex = await getMappingIndex(connection);
    const [importResult] = await connection.query(
      `INSERT INTO statement_imports
        (receipt_id, payment_channel_id, original_name, stored_path, mime_type, row_count, imported_by)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [receiptId, paymentChannelId, req.file.originalname, req.file.path, req.file.mimetype, req.user.id]
    );
    const importId = importResult.insertId;

    let insertedCount = 0;
    let duplicateCount = 0;
    let totalAmount = 0;
    for (const row of rows) {
      let channelId = paymentChannelId;
      if (!channelId) {
        const matched = [...mappingIndex.byDescription.entries()].find(([description]) =>
          row.description.includes(description)
        );
        channelId = matched?.[1]?.id || mappingIndex.byCode.get('OTHER_UNKNOWN')?.id || null;
      }
      const uniqueHash = `${receiptId}-${row.uniqueHash}`;
      const [result] = await connection.query(
        `INSERT IGNORE INTO statement_transactions
          (import_id, receipt_id, payment_channel_id, transaction_date, description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId,
          receiptId,
          channelId,
          row.transactionDate,
          row.description,
          row.referenceNo,
          row.amount,
          uniqueHash,
          JSON.stringify(row.rawPayload)
        ]
      );
      if (result.affectedRows === 0) {
        duplicateCount += 1;
      } else {
        insertedCount += 1;
        totalAmount = roundMoney(totalAmount + row.amount);
      }
    }

    await connection.query(
      `UPDATE statement_imports
       SET row_count = ?, duplicate_count = ?, total_amount = ?
       WHERE id = ?`,
      [insertedCount, duplicateCount, totalAmount, importId]
    );

    const [channelSums] = await connection.query(
      `SELECT payment_channel_id, COALESCE(SUM(amount), 0) AS amount
       FROM statement_transactions
       WHERE receipt_id = ?
       GROUP BY payment_channel_id`,
      [receiptId]
    );
    for (const row of channelSums) {
      if (row.payment_channel_id) {
        await connection.query(
          `UPDATE daily_receipt_lines
           SET statement_amount = ?
           WHERE receipt_id = ? AND payment_channel_id = ?`,
          [roundMoney(row.amount), receiptId, row.payment_channel_id]
        );
      }
    }

    await connection.query(
      `INSERT INTO attachments
        (receipt_id, statement_import_id, attachment_type, original_name, stored_path, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, 'statement', ?, ?, ?, ?, ?)`,
      [receiptId, importId, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, req.user.id]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'import_statement',
      actor: req.user,
      afterPayload: { importId, insertedCount, duplicateCount, totalAmount }
    });
    await connection.commit();
    res.status(201).json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/daily-receipts/:id/check', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)) {
      const error = new Error(`Receipt in ${receipt.status} cannot be checked.`);
      error.statusCode = 409;
      throw error;
    }
    const updatedLines = await updateReceiptLineVerifiedAmounts({
      connection,
      receiptId,
      inputLines: Array.isArray(req.body.lines) ? req.body.lines : []
    });
    validateVarianceReasons(updatedLines);
    const nextStatus = resolveCheckedStatus(updatedLines);
    await connection.query(
      `UPDATE daily_receipts
       SET status = ?, checked_by = ?, checked_at = NOW()
       WHERE id = ?`,
      [nextStatus, req.user.id, receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'check',
      actor: req.user,
      afterPayload: { nextStatus, lines: updatedLines }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/daily-receipts/:id/request-correction', authenticate, requirePermission('receipt:correction'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const note = String(req.body.note || '').trim();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!canTransitionReceipt(receipt.status, 'NEEDS_CORRECTION')) {
      const error = new Error(`Receipt in ${receipt.status} cannot be returned for correction.`);
      error.statusCode = 409;
      throw error;
    }
    await connection.query(
      `UPDATE daily_receipts SET status = 'NEEDS_CORRECTION', correction_note = ? WHERE id = ?`,
      [note || null, receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'request_correction',
      actor: req.user,
      note
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/daily-receipts/:id/close', authenticate, requirePermission('receipt:close'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!canTransitionReceipt(receipt.status, 'CLOSED')) {
      const error = new Error(`Receipt in ${receipt.status} cannot be closed.`);
      error.statusCode = 409;
      throw error;
    }
    validateVarianceReasons(receipt.lines);
    await connection.query(
      `UPDATE daily_receipts SET status = 'CLOSED', closed_by = ?, closed_at = NOW() WHERE id = ?`,
      [req.user.id, receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'close',
      actor: req.user,
      note: String(req.body.note || '').trim() || null
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/reports/reconciliation', authenticate, requirePermission('report:read'), asyncHandler(async (req, res) => {
  const from = validateDate(req.query.from || new Date().toISOString().slice(0, 10), 'from');
  const to = validateDate(req.query.to || from, 'to');
  const params = [from, to];
  const branchClause = req.query.branch_id ? 'AND dr.branch_id = ?' : '';
  if (req.query.branch_id) params.push(Number(req.query.branch_id));
  const [rows] = await getPool().query(
    `SELECT dr.receipt_date, dr.status, b.name AS branch_name,
            dr.gross_sales_expected, dr.cash_expected, dr.non_cash_expected,
            COALESCE(SUM(drl.cashier_amount), 0) AS cashier_total,
            COALESCE(SUM(drl.statement_amount), 0) AS verified_total,
            COALESCE(SUM(drl.variance_amount), 0) AS variance_total
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     WHERE dr.receipt_date BETWEEN ? AND ?
       ${branchClause}
     GROUP BY dr.id
     ORDER BY dr.receipt_date DESC, b.name ASC`,
    params
  );
  res.json({
    success: true,
    data: {
      rows,
      summary: {
        gross_sales_expected: sumMoney(rows.map((row) => row.gross_sales_expected)),
        cashier_total: sumMoney(rows.map((row) => row.cashier_total)),
        verified_total: sumMoney(rows.map((row) => row.verified_total)),
        variance_total: sumMoney(rows.map((row) => row.variance_total))
      }
    }
  });
}));

const serveClient = process.env.SERVE_CLIENT === 'true';

if (serveClient) {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  const clientAssets = path.join(clientDist, 'assets');

  // Serve hashed build assets with long cache
  app.use('/assets', express.static(clientAssets, {
    immutable: true,
    maxAge: '1y'
  }));

  // Serve other static files (do not auto-serve index.html)
  app.use(express.static(clientDist, {
    index: false,
    maxAge: '1h'
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    // For unknown file paths (e.g. stale chunk names), return 404 instead of index.html
    if (path.extname(req.path)) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    // Prevent stale shell after deployment
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({
    success: false,
    message: error.message || 'Internal server error',
    details: error.details || undefined
  });
});

await migrateDatabase();

app.listen(config.port, config.host, () => {
  console.log(`general-cashflow API running on http://${config.host}:${config.port}`);
});
