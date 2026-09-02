import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  authenticate,
  getGoogleLoginPublicConfig,
  loginCashierWithoutPassword,
  loginUser,
  loginUserWithGoogle,
  requirePermission
} from './auth.js';
import { config } from './config.js';
import { fetchExpectedSales, fetchExpectedSalesRange, fetchOpenCartOrders } from './clickhouse.js';
import { fetchAccountingExportRows, getPool, logAudit, migrateDatabase } from './db.js';
import { createAccountingExportHandlers } from './accountingExportReceivables.js';
import { createReadableEvidenceDocument, findPdfEvidenceFocusPage, processAttachmentAsDocument } from './domain/attachments.js';
import {
  calculateEvidenceVariances,
  calculateStoredLineEvidence,
  calculateLineVariance,
  calculateCreditCardGroupVarianceByLine,
  buildCashierVarianceCheck,
  canTransitionReceipt,
  computeExpectedTotals,
  hasDeclaredMoneyWithoutPos,
  resolveManualCheckAmounts,
  resolveCheckedStatus,
  receiptStatusLabel,
  thailandBusinessDate,
  validateVarianceReasons
} from './domain/receipts.js';
import { roundMoney, sumMoney } from './domain/money.js';
import { buildReceiptClosingSummary, receiptConfirmationFields } from './domain/receiptClosing.js';
import { createPostCloseAdjustment, loadPostCloseAdjustments } from './postCloseAdjustments.js';
import { refreshKrungsriCombinedEvidence, repairKrungsriCombinedEvidence } from './krungsriEvidence.js';
import { repairLegacyKplusReferences } from './kplusEvidence.js';
import {
  branchSupportsPaymentChannel,
  isCashPaymentDescription
} from './domain/paymentChannels.js';
import {
  assignKasikornGrabStatementRows,
  findGrabSettlement,
  parseGrabDailyReport,
  parseGrabTransactionReport
} from './domain/grab.js';
import {
  buildDateRange,
  cashierMiscForSheets,
  cashPlusChangeForSheets,
  closedAmountOrCashierForSheets,
  decideBackfillAction,
  grabAmountsForSheets,
  googleSheetsStatusLabel,
  morningChangeForSheets,
  parseMonthRange
} from './domain/googleSheets.js';
import { parseScbMonthlyCardPdf, parseStatementFile } from './domain/statements.js';
import { classifyRowsForChannel, isSettlementChannel } from './domain/reconciliation.js';
import {
  deriveKtcSettlementAfterCashierEdit,
  deriveKtcSettlementComparison,
  parseBankReportFile,
  parseBankReportZip
} from './domain/bankInbox.js';
import { kplusShopSettlementKey, parseKplusShopEmail } from './domain/kplusShop.js';
import { runMorningBrief } from './agents/morningBrief.js';
import { listMorningBriefs, loadMorningBrief, saveMorningBrief } from './agents/morningBriefStore.js';
import { briefTargetDate, startMorningBriefSchedule } from './agents/schedule.js';
import {
  answerDecisionFollowup,
  cancelDecision,
  createDecisionContext,
  getAgentHealth,
  getAgentRun,
  listDecisions,
  requireHumanDecision
} from './agents/decisionAudit.js';

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

const resolveUploadFilePath = (storedPath) => {
  const resolved = path.resolve(storedPath);
  const root = path.resolve(uploadRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('Invalid attachment path.');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
};

const documentFileNameFor = (originalName, mimeType = 'application/pdf') => {
  const parsed = path.parse(String(originalName || 'attachment'));
  const extension = /^text\/html/i.test(String(mimeType || '')) ? '.html' : '.pdf';
  return `${parsed.name || 'attachment'}${extension}`;
};

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
    credentials: true,
    exposedHeaders: ['Content-Disposition']
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

const defaultReportRange = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${lastDay}`
  };
};

const requireSheetsExportToken = (req) => {
  if (!config.sheetsExportToken) {
    const error = new Error('Google Sheets export is not enabled.');
    error.statusCode = 503;
    throw error;
  }
  const authorization = String(req.headers.authorization || '');
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : String(req.headers['x-cashflow-sheets-token'] || req.query.token || '');
  const expected = Buffer.from(config.sheetsExportToken);
  const received = Buffer.from(suppliedToken);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const error = new Error('Invalid export token.');
    error.statusCode = 401;
    throw error;
  }
};

const requireAccountingExportToken = (req) => {
  if (!config.accountingExportToken) {
    const error = new Error('Accounting export token is required.');
    error.code = 'ACCOUNTING_EXPORT_UNAUTHORIZED';
    error.statusCode = 401;
    throw error;
  }
  const authorization = String(req.headers.authorization || '');
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : String(req.headers['x-accounting-sync-token'] || '');
  const expected = Buffer.from(config.accountingExportToken);
  const received = Buffer.from(suppliedToken);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const error = new Error('Invalid accounting export token.');
    error.code = 'ACCOUNTING_EXPORT_UNAUTHORIZED';
    error.statusCode = 401;
    throw error;
  }
};

const requireGmailInboxToken = (req, _res, next) => {
  if (!config.gmailInboxToken) {
    const error = new Error('Gmail inbox import is not enabled.');
    error.statusCode = 503;
    return next(error);
  }
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = Buffer.from(config.gmailInboxToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    const error = new Error('Invalid Gmail inbox import token.');
    error.statusCode = 401;
    return next(error);
  }
  return next();
};

const safeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const formulaSafeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${formulaSafeText.replaceAll('"', '""')}"`;
};

const sendCsv = (res, fileName, columns, rows) => {
  const csvRows = [
    columns.map((column) => safeCsvValue(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => safeCsvValue(row[column.key])).join(','))
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`\uFEFF${csvRows.join('\n')}\n`);
};

const expectedAmountForVerification = (line) => {
  const cashierAmount = roundMoney(line.cashier_amount || 0);
  if (line.channel_code === 'CASH') {
    return roundMoney(cashierAmount + Number(line.misc_total || 0) + Number(line.morning_change_amount || 0));
  }
  if (isSettlementChannel(line) && line.receiving_account_id && line.expected_net_amount !== null && line.expected_net_amount !== undefined) {
    return roundMoney(line.expected_net_amount);
  }
  return roundMoney(cashierAmount - Number(line.fee_amount || 0));
};

const isTruthy = (value) => value === true || value === 1 || value === '1' || value === 'true';

const buildOpenTableCheck = async (receipt) => {
  try {
    const result = await fetchOpenCartOrders({
      receiptDate: String(receipt.receipt_date).slice(0, 10),
      clickhouseBranchId: receipt.clickhouse_branch_id
    });
    return {
      available: true,
      status: result.openTableCount > 0 ? 'open_tables' : 'clear',
      message: result.openTableCount > 0
        ? `ยังมีโต๊ะค้าง ${result.openTableCount} โต๊ะ`
        : 'ไม่พบโต๊ะค้างจาก POS',
      branch_filter_supported: Boolean(result.branchFilterSupported),
      open_table_count: Number(result.openTableCount || 0),
      open_table_amount: roundMoney(result.openTableAmount),
      open_tables: result.openTables || []
    };
  } catch (error) {
    return {
      available: false,
      status: 'unavailable',
      message: 'ระบบตรวจโต๊ะค้างจาก POS ไม่สำเร็จ กรุณาตรวจใน POS ก่อนส่งยอด',
      branch_filter_supported: false,
      open_table_count: 0,
      open_table_amount: 0,
      open_tables: [],
      error: error.message
    };
  }
};

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

const getReceivingAccounts = async (connection = getPool()) => {
  const [rows] = await connection.query(
    `SELECT ra.*, b.name AS branch_name, b.code AS branch_code,
            COALESCE(JSON_ARRAYAGG(rac.payment_channel_id), JSON_ARRAY()) AS channel_ids_json
     FROM receiving_accounts ra
     LEFT JOIN branches b ON b.id = ra.branch_id
     LEFT JOIN receiving_account_channels rac ON rac.receiving_account_id = ra.id
     WHERE ra.is_active = TRUE
     GROUP BY ra.id
     ORDER BY b.name ASC, ra.bank_name ASC, ra.label ASC`
  );
  const [routeRows] = await connection.query(
    `SELECT receiving_account_id, payment_channel_id, branch_id
     FROM receiving_account_channel_branches`
  );
  const routeKeys = new Map();
  for (const route of routeRows) {
    const keys = routeKeys.get(Number(route.receiving_account_id)) || [];
    keys.push(`${Number(route.branch_id)}:${Number(route.payment_channel_id)}`);
    routeKeys.set(Number(route.receiving_account_id), keys);
  }
  return rows.map((row) => ({
    ...row,
    channel_ids: (typeof row.channel_ids_json === 'string' ? JSON.parse(row.channel_ids_json) : row.channel_ids_json || [])
      .filter(Boolean)
      .map(Number),
    additional_route_keys: routeKeys.get(Number(row.id)) || []
  }));
};

const getReceiptLineContext = async (connection, receiptLineId) => {
  const [rows] = await connection.query(
    `SELECT drl.*, dr.receipt_date, dr.branch_id, dr.status AS receipt_status, dr.morning_change_amount,
            pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind, pc.provider,
            rlr.id AS reconciliation_id, rlr.receiving_account_id, rlr.expected_gross_amount,
            rlr.fee_amount, rlr.expected_net_amount, rlr.matched_amount, rlr.settlement_date,
            COALESCE(misc.misc_total, 0) AS misc_total,
            rlr.settlement_status, rlr.settlement_source, rlr.cashier_reference_variance_amount,
            rlr.settlement_variance_amount, rlr.settlement_batch_key,
            rlr.settlement_batch_start_date, rlr.settlement_batch_end_date,
            rlr.settlement_batch_gross_amount, rlr.settlement_batch_fee_amount,
            rlr.settlement_batch_net_amount, rlr.settlement_batch_variance_amount,
            rlr.settlement_batch_allocated_fee_amount, rlr.settlement_batch_allocated_net_amount,
            rlr.exception_category, rlr.exception_note, rlr.evidence_attachment_id,
            rlr.manual_checked_without_reference, rlr.manual_checked_at, rlr.manual_checked_by
     FROM daily_receipt_lines drl
     JOIN daily_receipts dr ON dr.id = drl.receipt_id
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     LEFT JOIN (
       SELECT receipt_id, SUM(amount) AS misc_total
       FROM receipt_misc_items
       GROUP BY receipt_id
     ) misc ON misc.receipt_id = drl.receipt_id
     WHERE drl.id = ?`,
    [receiptLineId]
  );
  const line = rows[0];
  if (!line) {
    const error = new Error('Receipt line not found.');
    error.statusCode = 404;
    throw error;
  }
  return line;
};

const assertAccountSupportsChannel = async (connection, accountId, paymentChannelId, branchId = null) => {
  const [rows] = await connection.query(
    `SELECT ra.id
     FROM receiving_accounts ra
     JOIN receiving_account_channels rac ON rac.receiving_account_id = ra.id
     LEFT JOIN receiving_account_channel_branches racb
       ON racb.receiving_account_id = ra.id
      AND racb.payment_channel_id = rac.payment_channel_id
      AND racb.branch_id = ?
     WHERE ra.id = ? AND rac.payment_channel_id = ? AND ra.is_active = TRUE
       AND (ra.branch_id IS NULL OR ra.branch_id = ? OR racb.branch_id IS NOT NULL)`,
    [branchId, accountId, paymentChannelId, branchId]
  );
  if (!rows[0]) {
    const error = new Error('บัญชีรับเงินนี้ไม่ได้ตั้งค่าให้ใช้กับช่องทางหรือสาขาที่เลือก');
    error.statusCode = 400;
    throw error;
  }
};

const recalculateStatementAmount = async (connection, receiptLineId) => {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM statement_transactions
     WHERE receipt_line_id = ?
       AND match_status IN ('classified', 'matched_auto', 'matched_manual')`,
    [receiptLineId]
  );
  const amount = roundMoney(rows[0]?.amount || 0);
  await connection.query('UPDATE daily_receipt_lines SET statement_amount = ? WHERE id = ?', [amount, receiptLineId]);
  await connection.query('UPDATE receipt_line_reconciliations SET matched_amount = ? WHERE receipt_line_id = ?', [amount, receiptLineId]);
  return amount;
};

const refreshLineSettlementAfterClassification = async (connection, receiptLineId) => {
  if (!receiptLineId) return;
  const matchedAmount = await recalculateStatementAmount(connection, receiptLineId);
  const [rows] = await connection.query(
    `SELECT drl.cashier_amount, drl.receipt_id, pc.code AS channel_code
     FROM daily_receipt_lines drl
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     WHERE drl.id = ?`,
    [receiptLineId]
  );
  if (!rows[0]) return;
  const cashierAmount = roundMoney(rows[0].cashier_amount || 0);
  let referenceAmount = matchedAmount;
  if (rows[0].channel_code === 'QR_KPLUS') {
    const [primaryRows] = await connection.query(
      `SELECT COALESCE(SUM(st.amount), 0) AS amount
       FROM statement_transactions st
       JOIN bank_merchant_mappings bmm
         ON bmm.provider = 'KPLUSSHOP' AND bmm.merchant_id = st.reference_no AND bmm.is_primary = TRUE
       WHERE st.receipt_line_id = ?
         AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')`,
      [receiptLineId]
    );
    referenceAmount = roundMoney(primaryRows[0]?.amount || 0);
  }
  await connection.query(
    `UPDATE receipt_line_reconciliations
     SET expected_gross_amount = ?, fee_amount = 0, expected_net_amount = ?, matched_amount = ?,
         settlement_source = 'BANK_STATEMENT',
         settlement_status = ?, manual_checked_without_reference = FALSE,
         manual_checked_at = NULL, manual_checked_by = NULL
     WHERE receipt_line_id = ?`,
    [referenceAmount, referenceAmount, matchedAmount,
      cashierAmount === referenceAmount && matchedAmount === referenceAmount ? 'MATCHED_AUTO' : 'EXCEPTION', receiptLineId]
  );
};

const refreshKasikornMonthlyQrComparison = async (connection, receiptLineId) => {
  const matchedAmount = await recalculateStatementAmount(connection, receiptLineId);
  const [rows] = await connection.query(
    `SELECT drl.receipt_id, drl.cashier_amount, drl.variance_amount,
            rlr.expected_gross_amount, rlr.expected_net_amount, rlr.matched_amount,
            rlr.settlement_source, rlr.settlement_status,
            rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount,
            EXISTS(
              SELECT 1 FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id AND bi.provider = 'KPLUSSHOP'
              WHERE bit.receipt_line_id = drl.id AND bit.auto_match_status = 'LINKED'
            ) AS has_kplus_settlement
     FROM daily_receipt_lines drl
     JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     WHERE drl.id = ? FOR UPDATE`,
    [receiptLineId]
  );
  const line = rows[0];
  if (!line) return null;

  const cashierAmount = roundMoney(line.cashier_amount || 0);
  const hasKplusSettlement = Boolean(line.has_kplus_settlement);
  const referenceAmount = hasKplusSettlement ? matchedAmount : cashierAmount;
  const settlementSource = hasKplusSettlement ? 'BANK_SETTLEMENT' : 'BANK_STATEMENT';
  const comparison = calculateEvidenceVariances({
    channelCode: 'QR_KPLUS',
    cashierAmount,
    statementAmount: matchedAmount,
    expectedGrossAmount: referenceAmount,
    feeAmount: 0,
    expectedNetAmount: referenceAmount,
    settlementSource
  });
  const settlementStatus = comparison.hasEvidenceVariance ? 'EXCEPTION' : 'MATCHED_AUTO';
  const beforePayload = {
    expected_gross_amount: roundMoney(line.expected_gross_amount || 0),
    expected_net_amount: roundMoney(line.expected_net_amount || 0),
    matched_amount: roundMoney(line.matched_amount || 0),
    settlement_source: String(line.settlement_source || 'NONE'),
    settlement_status: String(line.settlement_status || ''),
    cashier_reference_variance_amount: roundMoney(line.cashier_reference_variance_amount || 0),
    settlement_variance_amount: roundMoney(line.settlement_variance_amount || 0)
  };
  const afterPayload = {
    expected_gross_amount: referenceAmount,
    expected_net_amount: referenceAmount,
    matched_amount: matchedAmount,
    settlement_source: settlementSource,
    settlement_status: settlementStatus,
    cashier_reference_variance_amount: comparison.cashierReferenceVariance,
    settlement_variance_amount: comparison.settlementVariance
  };
  const changed = Object.keys(afterPayload).some((key) => String(beforePayload[key]) !== String(afterPayload[key]));

  await connection.query(
    `UPDATE receipt_line_reconciliations
     SET expected_gross_amount = ?, fee_amount = 0, expected_net_amount = ?, matched_amount = ?,
         settlement_source = ?, settlement_status = ?,
         cashier_reference_variance_amount = ?, settlement_variance_amount = ?,
         manual_checked_without_reference = FALSE, manual_checked_at = NULL, manual_checked_by = NULL
     WHERE receipt_line_id = ?`,
    [referenceAmount, referenceAmount, matchedAmount, settlementSource, settlementStatus,
      comparison.cashierReferenceVariance, comparison.settlementVariance, receiptLineId]
  );
  await connection.query(
    'UPDATE daily_receipt_lines SET statement_amount = ?, variance_amount = ? WHERE id = ?',
    [matchedAmount, comparison.settlementVariance, receiptLineId]
  );

  return { changed, receiptId: line.receipt_id, beforePayload, afterPayload };
};

const repairKasikornMonthlyQrComparisons = async () => {
  const connection = await getPool().getConnection();
  const result = { updated: 0, checked: 0 };
  try {
    const [rows] = await connection.query(
      `SELECT DISTINCT bit.receipt_line_id
       FROM bank_inbox_transactions bit
       JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
       WHERE bi.provider = 'KASIKORN_MONTHLY_STATEMENT'
         AND bit.receipt_line_id IS NOT NULL
         AND bit.auto_match_status = 'LINKED'
       ORDER BY bit.receipt_line_id`
    );
    await connection.beginTransaction();
    for (const row of rows) {
      const repair = await refreshKasikornMonthlyQrComparison(connection, row.receipt_line_id);
      if (!repair) continue;
      result.checked += 1;
      if (!repair.changed) continue;
      await logAudit({
        connection,
        entityType: 'daily_receipt',
        entityId: repair.receiptId,
        action: 'repair_kbank_monthly_qr_comparison',
        beforePayload: { receipt_line_id: row.receipt_line_id, ...repair.beforePayload },
        afterPayload: { receipt_line_id: row.receipt_line_id, ...repair.afterPayload },
        note: 'รักษายอด K SHOP เป็นฐานก่อนหัก และใช้ statement รายเดือนเป็นเงินเข้าจริง'
      });
      result.updated += 1;
    }
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const repairSecondaryKplusIncome = async () => {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT st.id, st.unique_hash, st.receipt_id, st.receipt_line_id, st.reference_no, st.amount,
              dr.status AS receipt_status
       FROM statement_transactions st
       JOIN daily_receipts dr ON dr.id = st.receipt_id
       JOIN bank_merchant_mappings bmm
         ON bmm.provider = 'KPLUSSHOP' AND bmm.merchant_id = st.reference_no
       WHERE bmm.is_primary = FALSE
         AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')
         AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(st.raw_payload, '$.review_classification')), '') <> 'confirm_income'
         AND dr.status <> 'CLOSED'`
    );
    if (rows.length === 0) return;
    await connection.beginTransaction();
    const affected = new Map();
    for (const row of rows) {
      await connection.query(
        `UPDATE statement_transactions
         SET receipt_line_id = NULL, match_status = 'unmatched',
             raw_payload = JSON_SET(COALESCE(raw_payload, JSON_OBJECT()), '$.review_classification', 'pending_secondary_merchant')
         WHERE id = ?`,
        [row.id]
      );
      await connection.query(
        `UPDATE bank_inbox_transactions
         SET receipt_line_id = NULL, auto_match_status = 'PENDING'
         WHERE unique_hash = ?`,
        [row.unique_hash]
      );
      affected.set(row.receipt_line_id, row.receipt_id);
    }
    for (const [lineId, receiptId] of affected) {
      await refreshLineSettlementAfterClassification(connection, lineId);
      await logAudit({
        connection,
        entityType: 'daily_receipt',
        entityId: receiptId,
        action: 'separate_secondary_kplus_income',
        afterPayload: {
          receipt_line_id: lineId,
          transactions: rows.filter((row) => row.receipt_line_id === lineId)
            .map((row) => ({ id: row.id, merchant_id: row.reference_no, amount: roundMoney(row.amount) }))
        }
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const repairDuplicateKplusShopSettlements = async () => {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT bit.id AS transaction_id, bit.inbox_import_id, bit.receipt_line_id,
              bit.unique_hash, bit.reference_no, bit.transaction_date, bit.amount
       FROM bank_inbox_transactions bit
       JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
       WHERE bi.provider = 'KPLUSSHOP' AND bit.auto_match_status <> 'DUPLICATE'
       ORDER BY bit.reference_no, bit.transaction_date, bit.id`
    );
    const firstBySettlement = new Map();
    for (const row of rows) {
      const key = kplusShopSettlementKey({
        merchantId: row.reference_no,
        sourceDate: row.transaction_date
      });
      const first = firstBySettlement.get(key);
      if (!first) {
        firstBySettlement.set(key, row);
        continue;
      }
      if (roundMoney(first.amount) !== roundMoney(row.amount)) continue;

      await connection.beginTransaction();
      const [statementRows] = await connection.query(
        `SELECT id, import_id, receipt_id, receipt_line_id
         FROM statement_transactions WHERE unique_hash = ?`,
        [row.unique_hash]
      );
      const affectedLineIds = [...new Set(
        [row.receipt_line_id, ...statementRows.map((item) => item.receipt_line_id)].filter(Boolean)
      )];
      const affectedReceiptIds = [...new Set(statementRows.map((item) => item.receipt_id).filter(Boolean))];
      const statementImportIds = [...new Set(statementRows.map((item) => item.import_id).filter(Boolean))];

      await connection.query('DELETE FROM statement_transactions WHERE unique_hash = ?', [row.unique_hash]);
      for (const importId of statementImportIds) {
        await connection.query(
          `DELETE FROM statement_imports
           WHERE id = ? AND NOT EXISTS (
             SELECT 1 FROM statement_transactions WHERE import_id = ?
           )`,
          [importId, importId]
        );
      }
      await connection.query(
        `UPDATE bank_inbox_transactions
         SET receipt_line_id = NULL, auto_match_status = 'DUPLICATE'
         WHERE id = ?`,
        [row.transaction_id]
      );
      await connection.query(
        "UPDATE bank_inbox_imports SET status = 'DUPLICATE' WHERE id = ?",
        [row.inbox_import_id]
      );

      for (const receiptLineId of affectedLineIds) {
        const matchedAmount = await recalculateStatementAmount(connection, receiptLineId);
        const [lineRows] = await connection.query(
          'SELECT receipt_id, cashier_amount FROM daily_receipt_lines WHERE id = ?',
          [receiptLineId]
        );
        const line = lineRows[0];
        if (!line) continue;
        const cashierAmount = roundMoney(line.cashier_amount || 0);
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET expected_gross_amount = ?, fee_amount = 0, expected_net_amount = ?, matched_amount = ?,
               settlement_source = 'BANK_SETTLEMENT',
               settlement_status = ?
           WHERE receipt_line_id = ?`,
          [matchedAmount, matchedAmount, matchedAmount,
            cashierAmount > 0 && cashierAmount === matchedAmount ? 'MATCHED_AUTO' : 'EXCEPTION', receiptLineId]
        );
        affectedReceiptIds.push(line.receipt_id);
      }
      for (const receiptId of new Set(affectedReceiptIds)) {
        await logAudit({
          connection,
          entityType: 'daily_receipt',
          entityId: receiptId,
          action: 'repair_duplicate_kplus_shop_settlement',
          beforePayload: {
            duplicate_inbox_import_id: row.inbox_import_id,
            merchant_id: row.reference_no,
            source_date: row.transaction_date,
            amount: roundMoney(row.amount)
          },
          afterPayload: {
            kept_inbox_import_id: first.inbox_import_id,
            duplicate_status: 'DUPLICATE'
          },
          note: 'ตัดยอด K SHOP ซ้ำ: ร้านและวันที่เดียวกันนับเพียงหนึ่งครั้ง'
        });
      }
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Unable to repair duplicate K SHOP settlements', error);
  } finally {
    connection.release();
  }
};

// Inbox imports are linked only when the bank merchant, date, branch and channel
// identify one receipt line. Anything ambiguous remains pending for an auditor.
const attachImportedEvidence = async (connection, { receiptId, sourceLabel, files = [] }) => {
  let attachedCount = 0;
  const attachmentIds = [];
  for (const file of files) {
    if (!file?.fileData?.length) continue;
    const originalName = `${sourceLabel} - ${file.fileName}`;
    const readableDocument = createReadableEvidenceDocument(file);
    const [existingRows] = await connection.query(
      `SELECT id, document_path, document_data
       FROM attachments WHERE receipt_id = ? AND original_name = ? LIMIT 1`,
      [receiptId, originalName]
    );
    if (existingRows[0]) {
      attachmentIds.push(existingRows[0].id);
      if (readableDocument) {
        const documentPath = path.join(
          uploadRoot,
          '.evidence',
          `${crypto.createHash('sha256').update(`${receiptId}:${originalName}:document`).digest('hex')}.html`
        );
        await connection.query(
          `UPDATE attachments
           SET document_path = ?, document_mime_type = ?, document_size_bytes = ?, document_data = ?, document_status = 'ready'
           WHERE id = ?`,
          [documentPath, readableDocument.mimeType, readableDocument.fileData.length, readableDocument.fileData, existingRows[0].id]
        );
      }
      continue;
    }

    const extension = path.extname(file.fileName || '').toLowerCase();
    const mimeType = file.mimeType || (extension === '.pdf' ? 'application/pdf' : 'application/octet-stream');
    const virtualPath = path.join(
      uploadRoot,
      '.evidence',
      `${crypto.createHash('sha256').update(`${receiptId}:${originalName}`).digest('hex')}${extension || '.bin'}`
    );
    const documentPath = mimeType === 'application/pdf'
      ? virtualPath
      : readableDocument
        ? path.join(
          uploadRoot,
          '.evidence',
          `${crypto.createHash('sha256').update(`${receiptId}:${originalName}:document`).digest('hex')}.html`
        )
        : null;
    const documentMimeType = mimeType === 'application/pdf' ? mimeType : readableDocument?.mimeType || null;
    const documentData = mimeType === 'application/pdf' ? file.fileData : readableDocument?.fileData || null;
    const [result] = await connection.query(
      `INSERT INTO attachments
        (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
         size_bytes, document_size_bytes, file_data, document_data, document_status)
       VALUES (?, 'statement', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
      [
        receiptId,
        originalName,
        virtualPath,
        documentPath,
        mimeType,
        documentMimeType,
        file.fileData.length,
        documentData?.length || null,
        file.fileData,
        documentData
      ]
    );
    attachmentIds.push(result.insertId);
    attachedCount += 1;
  }
  return { attachedCount, attachmentIds };
};

const kplusEmailEvidenceFile = ({ sourceDate, subject, senderEmail, body }) => {
  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const fileName = `KSHOP-${sourceDate || 'email'}.html`;
  const content = `<!doctype html><html lang="th"><meta charset="utf-8"><title>K SHOP settlement</title><body style="font-family:Arial,sans-serif;padding:24px;white-space:pre-wrap"><h2>K SHOP daily settlement</h2><p><b>วันที่ขาย:</b> ${escapeHtml(sourceDate)}</p><p><b>ผู้ส่ง:</b> ${escapeHtml(senderEmail)}</p><p><b>หัวข้อ:</b> ${escapeHtml(subject)}</p><hr><div>${escapeHtml(body)}</div></body></html>`;
  return { fileName, mimeType: 'text/html; charset=utf-8', fileData: Buffer.from(content, 'utf8') };
};

const autoLinkKrungsriInboxImport = async (connection, { importId, originalName, storedPath, mimeType, transactions, evidenceFiles = [] }) => {
  const linked = [];
  const pending = [];
  const grouped = new Map();
  for (const transaction of transactions) {
    const [mappings] = await connection.query(
      `SELECT bmm.branch_id, bmm.payment_channel_id
       FROM bank_merchant_mappings bmm
       WHERE bmm.provider = 'KRUNGSRIBIZ_MUNGMEE' AND bmm.merchant_id = ? AND bmm.is_active = TRUE`,
      [transaction.merchantId]
    );
    if (!mappings[0] || !transaction.transactionDate) {
      pending.push(transaction);
      continue;
    }
    const mapping = mappings[0];
    const [lines] = await connection.query(
      `SELECT drl.id AS receipt_line_id, drl.receipt_id
       FROM daily_receipt_lines drl
       JOIN daily_receipts dr ON dr.id = drl.receipt_id
       WHERE dr.branch_id = ? AND dr.receipt_date = ? AND drl.payment_channel_id = ? AND dr.status <> 'CLOSED'`,
      [mapping.branch_id, transaction.transactionDate, mapping.payment_channel_id]
    );
    if (lines.length !== 1) {
      pending.push(transaction);
      continue;
    }
    const line = lines[0];
    const key = `${line.receipt_id}:${line.receipt_line_id}`;
    const group = grouped.get(key) || { ...line, paymentChannelId: mapping.payment_channel_id, rows: [] };
    group.rows.push(transaction);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const total = roundMoney(group.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const [importResult] = await connection.query(
      `INSERT INTO statement_imports
        (receipt_id, payment_channel_id, original_name, stored_path, mime_type, row_count, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [group.receipt_id, group.paymentChannelId, `${originalName} (auto)`, storedPath, mimeType, group.rows.length, total]
    );
    for (const row of group.rows) {
      await connection.query(
        `INSERT IGNORE INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date, description,
           reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classified')`,
        [
          importResult.insertId, group.receipt_id, group.receipt_line_id, group.paymentChannelId,
          row.transactionDate, row.description || null, row.referenceNo || null, row.amount,
          `inbox-${importId}-${row.uniqueHash}`, JSON.stringify(row.rawPayload || {})
        ]
      );
      await connection.query(
        `UPDATE bank_inbox_transactions
         SET receipt_line_id = ?, auto_match_status = 'LINKED'
         WHERE inbox_import_id = ? AND unique_hash = ?`,
        [group.receipt_line_id, importId, row.uniqueHash]
      );
      linked.push(row);
    }
    const matchedAmount = await recalculateStatementAmount(connection, group.receipt_line_id);
    const [lineRows] = await connection.query(
      'SELECT cashier_amount, expected_amount FROM daily_receipt_lines WHERE id = ?',
      [group.receipt_line_id]
    );
    const expected = roundMoney(lineRows[0]?.cashier_amount || 0);
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET matched_amount = ?, settlement_status = ?
       WHERE receipt_line_id = ?`,
      [matchedAmount, expected > 0 && matchedAmount === expected ? 'MATCHED_AUTO' : 'EXCEPTION', group.receipt_line_id]
    );
    await attachImportedEvidence(connection, {
      receiptId: group.receipt_id,
      sourceLabel: 'QR กรุงศรี',
      files: evidenceFiles.filter((file) => group.rows.some((row) => row.sourceFileName === file.fileName))
    });
    await refreshKrungsriCombinedEvidence(connection, { receiptLineId: group.receipt_line_id, uploadRoot });
  }
  for (const row of pending) {
    await connection.query(
      `UPDATE bank_inbox_transactions SET auto_match_status = 'PENDING'
       WHERE inbox_import_id = ? AND unique_hash = ?`,
      [importId, row.uniqueHash]
    );
  }
  return { linkedCount: linked.length, pendingCount: pending.length };
};

const autoLinkPendingKrungsriInboxImports = async () => {
  const connection = await getPool().getConnection();
  try {
    const [imports] = await connection.query(
      `SELECT id, original_name, stored_path, mime_type
       FROM bank_inbox_imports
       WHERE provider = 'KRUNGSRIBIZ_MUNGMEE'
       ORDER BY id ASC`
    );
    for (const inboxImport of imports) {
      const [rows] = await connection.query(
        `SELECT source_file_name, transaction_date, description, reference_no, amount, unique_hash, raw_payload
         FROM bank_inbox_transactions
         WHERE inbox_import_id = ? AND auto_match_status <> 'LINKED'`,
        [inboxImport.id]
      );
      if (rows.length === 0) continue;
      const transactions = rows.map((row) => {
        const rawPayload = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : (row.raw_payload || {});
        return {
          ...row,
          rawPayload,
          uniqueHash: row.unique_hash,
          merchantId: String(rawPayload['Merchant ID'] || rawPayload.merchant_id || rawPayload.merchantId || '').trim(),
          transactionDate: row.transaction_date
        };
      });
      await connection.beginTransaction();
      const result = await autoLinkKrungsriInboxImport(connection, {
        importId: inboxImport.id,
        originalName: inboxImport.original_name,
        storedPath: inboxImport.stored_path,
        mimeType: inboxImport.mime_type,
        transactions,
        evidenceFiles: []
      });
      const status = result.pendingCount === 0
        ? 'AUTO_LINKED'
        : result.linkedCount > 0
          ? 'PARTIAL_REVIEW'
          : 'PENDING_REVIEW';
      await connection.query('UPDATE bank_inbox_imports SET status = ? WHERE id = ?', [status, inboxImport.id]);
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Unable to auto-link pending Krungsri inbox reports', error);
  } finally {
    connection.release();
  }
};

// Older Mung-Mee imports used an undefined transaction hash while linking a
// report. Only the first payment of the day was retained. Rebuild precisely
// those affected auto-imports from their original bank transaction rows.
const repairLegacyKrungsriInboxImports = async () => {
  const connection = await getPool().getConnection();
  try {
    const [imports] = await connection.query(
      `SELECT DISTINCT bi.id, bi.original_name
       FROM bank_inbox_imports bi
       JOIN statement_imports si ON si.original_name = CONCAT(bi.original_name, ' (auto)')
       JOIN statement_transactions st ON st.import_id = si.id
       WHERE bi.provider = 'KRUNGSRIBIZ_MUNGMEE'
         AND st.unique_hash = CONCAT('inbox-', bi.id, '-undefined')`
    );
    for (const inboxImport of imports) {
      await connection.beginTransaction();
      const autoImportName = `${inboxImport.original_name} (auto)`;
      await connection.query(
        `DELETE st FROM statement_transactions st
         JOIN statement_imports si ON si.id = st.import_id
         WHERE si.original_name = ?`,
        [autoImportName]
      );
      await connection.query('DELETE FROM statement_imports WHERE original_name = ?', [autoImportName]);
      await connection.query(
        `UPDATE bank_inbox_transactions
         SET receipt_line_id = NULL, auto_match_status = 'PENDING'
         WHERE inbox_import_id = ?`,
        [inboxImport.id]
      );
      await connection.query('UPDATE bank_inbox_imports SET status = ? WHERE id = ?', ['PENDING_REVIEW', inboxImport.id]);
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Unable to repair legacy Krungsri inbox reports', error);
  } finally {
    connection.release();
  }
};

const grabReportFinancialPayload = (report) => ({
  store_id: report.storeId,
  gross_amount: report.grossAmount,
  vat_amount: report.vatAmount,
  merchant_service_amount: report.merchantServiceAmount,
  merchant_promotion_amount: report.merchantPromotionAmount,
  cashier_amount: report.cashierAmount,
  commission_and_tax_amount: report.commissionAndTaxAmount,
  additional_commission_amount: report.additionalCommissionAmount,
  marketing_fee_amount: report.marketingFeeAmount,
  merchant_delivery_discount_amount: report.merchantDeliveryDiscountAmount,
  income_adjustment_amount: report.incomeAdjustmentAmount,
  outstanding_amount: report.outstandingAmount,
  fee_amount: report.feeAmount,
  net_amount: report.netAmount
});

const refreshGrabCashierExpectedAmounts = async () => {
  const connection = await getPool().getConnection();
  try {
    const [imports] = await connection.query(
      `SELECT bi.id, bi.original_name, bi.file_data, bit.id AS inbox_transaction_id, bit.receipt_line_id
       FROM bank_inbox_imports bi
       JOIN bank_inbox_transactions bit ON bit.inbox_import_id = bi.id
       JOIN daily_receipt_lines drl ON drl.id = bit.receipt_line_id
       JOIN daily_receipts dr ON dr.id = drl.receipt_id
       JOIN (
         SELECT bit2.receipt_line_id, MAX(bi2.id) AS latest_import_id
         FROM bank_inbox_imports bi2
         JOIN bank_inbox_transactions bit2 ON bit2.inbox_import_id = bi2.id
         WHERE bi2.provider = 'GRAB_DAILY' AND bit2.receipt_line_id IS NOT NULL AND bi2.file_data IS NOT NULL
         GROUP BY bit2.receipt_line_id
       ) latest ON latest.receipt_line_id = bit.receipt_line_id AND latest.latest_import_id = bi.id
       WHERE bi.provider = 'GRAB_DAILY' AND bi.file_data IS NOT NULL
       ORDER BY bi.id ASC`
    );
    for (const inboxImport of imports) {
      try {
        const report = await parseGrabDailyReport(inboxImport.file_data, inboxImport.original_name);
        const reportPayload = grabReportFinancialPayload(report);
        const referenceHash = crypto.createHash('sha256').update(`grab-cashier-reference-confirm:${inboxImport.inbox_transaction_id}`).digest('hex');
        const statementPayload = JSON.stringify({
          ...reportPayload,
          source: 'grab_daily_report',
          inbox_import_id: inboxImport.id,
          cashier_reference_amount: report.cashierAmount
        });
        await connection.beginTransaction();
        await connection.query(
          `UPDATE bank_inbox_transactions
           SET amount = ?, raw_payload = ?
           WHERE id = ?`,
          [report.netAmount, JSON.stringify(reportPayload), inboxImport.inbox_transaction_id]
        );
        await connection.query(
          `UPDATE statement_transactions
           SET match_status = 'unmatched'
           WHERE receipt_line_id = ?
             AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.source')) = 'grab_daily_report'`,
          [inboxImport.receipt_line_id]
        );
        await connection.query(
          `UPDATE statement_transactions
           SET amount = ?, raw_payload = ?, match_status = 'matched_auto'
           WHERE unique_hash = ?`,
          [report.netAmount, statementPayload, referenceHash]
        );
        await connection.query(
          `UPDATE statement_imports si
           JOIN statement_transactions st ON st.import_id = si.id
           SET si.total_amount = ?
           WHERE st.unique_hash = ?`,
          [report.netAmount, referenceHash]
        );
        await connection.query(
          `UPDATE daily_receipt_lines SET expected_amount = ? WHERE id = ?`,
          [report.cashierAmount, inboxImport.receipt_line_id]
        );
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?
               , settlement_source = 'GRAB_REPORT'
           WHERE receipt_line_id = ?`,
          [report.cashierAmount, report.feeAmount, report.netAmount, inboxImport.receipt_line_id]
        );
        const [lineRows] = await connection.query(
          `SELECT receipt_id, cashier_amount, statement_amount
           FROM daily_receipt_lines
           WHERE id = ?`,
          [inboxImport.receipt_line_id]
        );
        const line = lineRows[0];
        const cashierAmount = roundMoney(line?.cashier_amount || 0);
        const reportAmount = roundMoney(report.cashierAmount || 0);
        const currentStatementAmount = roundMoney(line?.statement_amount || 0);
        const canUseReportNet = cashierAmount > 0 && cashierAmount === reportAmount &&
          [0, reportAmount, roundMoney(report.netAmount)].includes(currentStatementAmount);
        if (canUseReportNet) {
          await connection.query(
            'UPDATE daily_receipt_lines SET statement_amount = ?, variance_amount = 0, variance_reason = NULL WHERE id = ?',
            [report.netAmount, inboxImport.receipt_line_id]
          );
          await connection.query(
            `UPDATE receipt_line_reconciliations
             SET matched_amount = ?, settlement_status = 'MATCHED_AUTO'
             WHERE receipt_line_id = ?`,
            [report.netAmount, inboxImport.receipt_line_id]
          );
          if (currentStatementAmount !== roundMoney(report.netAmount)) {
            await logAudit({
              connection,
              entityType: 'daily_receipt',
              entityId: line.receipt_id,
              action: 'repair_grab_net_amount',
              afterPayload: {
                receipt_line_id: inboxImport.receipt_line_id,
                previous_statement_amount: currentStatementAmount,
                statement_amount: report.netAmount,
                fee_amount: report.feeAmount,
                source_import_id: inboxImport.id
              },
              note: 'ปรับยอดเงินจริง GRAB จากยอดก่อนหักเป็นรายรับสุทธิตาม PDF'
            });
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        console.error(`Unable to refresh Grab settlement import ${inboxImport.id}`, error.message);
      }
    }
  } finally {
    connection.release();
  }
};

const scbChannelCodeFor = (description) => /CREDIT CARD DIVISION|\bEDC\b/i.test(String(description || ''))
  ? 'CREDIT_CARD_SCB'
  : 'PROMPTPAY';

const autoLinkScbTransaction = async (connection, { inboxImportId, originalName, storedPath, mimeType, row, channelId, accountId, evidenceFiles = [] }) => {
  const isCard = scbChannelCodeFor(row.description) === 'CREDIT_CARD_SCB';
  const [candidates] = await connection.query(
    `SELECT dr.id AS receipt_id, drl.id AS receipt_line_id, drl.cashier_amount, drl.expected_amount
     FROM daily_receipts dr
     JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     WHERE dr.branch_id = (SELECT branch_id FROM receiving_accounts WHERE id = ?)
       AND drl.payment_channel_id = ? AND dr.status <> 'CLOSED'
       AND dr.receipt_date ${isCard ? '= DATE_SUB(?, INTERVAL 1 DAY)' : '= ?'}
       AND ${isCard
         ? 'ROUND(COALESCE(drl.cashier_amount, 0), 2) > 0 AND ? > 0 AND ? <= ROUND(COALESCE(drl.cashier_amount, 0), 2)'
         : 'ROUND(COALESCE(drl.cashier_amount, 0), 2) = ?'}`,
    isCard
      ? [accountId, channelId, row.transactionDate, row.amount, row.amount]
      : [accountId, channelId, row.transactionDate, row.amount]
  );
  if (candidates.length !== 1) return null;
  const line = candidates[0];
  const [statementImport] = await connection.query(
    `INSERT INTO statement_imports (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [line.receipt_id, channelId, accountId, `${originalName} (auto)`, storedPath, mimeType, row.amount]
  );
  const uniqueHash = `scb-inbox-${inboxImportId}-${row.uniqueHash}`;
  await connection.query(
    `INSERT IGNORE INTO statement_transactions
      (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date, description,
       reference_no, amount, unique_hash, raw_payload, match_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched_auto')`,
    [statementImport.insertId, line.receipt_id, line.receipt_line_id, accountId, channelId, row.transactionDate,
      row.description || null, row.referenceNo || null, row.amount, uniqueHash, JSON.stringify(row.rawPayload || {})]
  );
  const matchedAmount = await recalculateStatementAmount(connection, line.receipt_line_id);
  const gross = roundMoney(line.cashier_amount || 0);
  await connection.query(
    `UPDATE receipt_line_reconciliations
     SET receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
         settlement_source = 'BANK_SETTLEMENT',
         matched_amount = ?, settlement_date = ?, settlement_status = 'MATCHED_AUTO'
     WHERE receipt_line_id = ?`,
    [accountId, gross, isCard ? roundMoney(Math.max(gross - Number(row.amount), 0)) : 0, row.amount,
      matchedAmount, row.transactionDate, line.receipt_line_id]
  );
  const evidence = await attachImportedEvidence(connection, {
    receiptId: line.receipt_id,
    sourceLabel: isCard ? 'บัตรเครดิต SCB' : 'เข้าธนาคารไทยพาณิชย์',
    files: evidenceFiles.filter((file) => file.fileName === row.sourceFileName)
  });
  if (evidence.attachmentIds[0]) {
    await connection.query(
      'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
      [evidence.attachmentIds[0], line.receipt_line_id]
    );
  }
  return line;
};

// SCB EDC settles card sales into the bank on the following day. Revisit pending
// imports at startup so older ZIP reports benefit from the same settlement rule.
const autoLinkPendingScbInboxImports = async () => {
  const connection = await getPool().getConnection();
  try {
    const [accountRows] = await connection.query("SELECT id FROM receiving_accounts WHERE account_number = '4070578401' AND is_active = TRUE");
    const [channelRows] = await connection.query("SELECT id, code FROM payment_channels WHERE code IN ('CREDIT_CARD_SCB', 'PROMPTPAY')");
    const channelIds = new Map(channelRows.map((channel) => [channel.code, channel.id]));
    const [imports] = await connection.query(
      `SELECT id, original_name, stored_path, mime_type, file_data
       FROM bank_inbox_imports
       WHERE provider = 'SCB_BUSINESS_ANYWHERE'
       ORDER BY id ASC`
    );
    for (const inboxImport of imports) {
      const parsed = inboxImport.file_data
        ? await parseBankReportZip({
          buffer: inboxImport.file_data,
          originalName: inboxImport.original_name,
          password: config.scbBusinessAnywhereZipPassword
        })
        : { files: [] };
      const [rows] = await connection.query(
      `SELECT source_file_name, transaction_date, description, reference_no, amount, unique_hash, raw_payload
         FROM bank_inbox_transactions
         WHERE inbox_import_id = ? AND auto_match_status <> 'LINKED'`,
        [inboxImport.id]
      );
      if (rows.length === 0) continue;
      await connection.beginTransaction();
      let linkedCount = 0;
      for (const row of rows) {
        const channelCode = scbChannelCodeFor(row.description);
        const linked = accountRows[0] && channelIds.get(channelCode) && row.transaction_date
          ? await autoLinkScbTransaction(connection, {
            inboxImportId: inboxImport.id,
            originalName: inboxImport.original_name,
            storedPath: inboxImport.stored_path,
            mimeType: inboxImport.mime_type,
            row: {
              sourceFileName: row.source_file_name,
              transactionDate: row.transaction_date,
              description: row.description,
              referenceNo: row.reference_no,
              amount: row.amount,
              uniqueHash: row.unique_hash,
              rawPayload: typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : (row.raw_payload || {})
            },
            channelId: channelIds.get(channelCode),
            accountId: accountRows[0].id,
            evidenceFiles: parsed.files
          })
          : null;
        if (linked) {
          await connection.query(
            `UPDATE bank_inbox_transactions
             SET receipt_line_id = ?, auto_match_status = 'LINKED'
             WHERE inbox_import_id = ? AND unique_hash = ?`,
            [linked.receipt_line_id, inboxImport.id, row.unique_hash]
          );
          linkedCount += 1;
        }
      }
      const [remainingRows] = await connection.query(
        `SELECT COUNT(*) AS count FROM bank_inbox_transactions
         WHERE inbox_import_id = ? AND auto_match_status <> 'LINKED'`,
        [inboxImport.id]
      );
      const status = Number(remainingRows[0]?.count || 0) === 0
        ? 'AUTO_LINKED'
        : linkedCount > 0 ? 'PARTIAL_REVIEW' : 'PENDING_REVIEW';
      await connection.query('UPDATE bank_inbox_imports SET status = ? WHERE id = ?', [status, inboxImport.id]);
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Unable to auto-link pending SCB inbox reports', error);
  } finally {
    connection.release();
  }
};

// Earlier bank imports already matched the amounts but did not copy their
// source evidence into the receipt. Rebuild those attachments without changing
// any reconciliation amount or status.
const repairLegacyInboxEvidence = async () => {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT DISTINCT bi.id, bi.provider, bi.original_name, bi.file_data, bi.source_date,
              bi.sender_email, bi.subject, drl.receipt_id, bit.receipt_line_id
       FROM bank_inbox_imports bi
       JOIN bank_inbox_transactions bit ON bit.inbox_import_id = bi.id
       JOIN daily_receipt_lines drl ON drl.id = bit.receipt_line_id
       WHERE bi.provider IN ('KRUNGSRIBIZ_MUNGMEE', 'SCB_BUSINESS_ANYWHERE', 'KPLUSSHOP')
         AND bit.receipt_line_id IS NOT NULL
       ORDER BY bi.id ASC`
    );
    const byImport = new Map();
    for (const row of rows) {
      const item = byImport.get(row.id) || { ...row, receiptIds: new Set(), lineIdsByReceipt: new Map() };
      item.receiptIds.add(row.receipt_id);
      const lineIds = item.lineIdsByReceipt.get(row.receipt_id) || new Set();
      lineIds.add(row.receipt_line_id);
      item.lineIdsByReceipt.set(row.receipt_id, lineIds);
      byImport.set(row.id, item);
    }

    for (const inboxImport of byImport.values()) {
      let sourceLabel;
      let files;
      if (inboxImport.provider === 'KPLUSSHOP') {
        sourceLabel = 'QR กสิกร';
        files = [kplusEmailEvidenceFile({
          sourceDate: inboxImport.source_date,
          subject: inboxImport.subject,
          senderEmail: inboxImport.sender_email,
          body: Buffer.from(inboxImport.file_data || '').toString('utf8')
        })];
      } else {
        const parsed = await parseBankReportZip({
          buffer: inboxImport.file_data,
          originalName: inboxImport.original_name,
          password: inboxImport.provider === 'SCB_BUSINESS_ANYWHERE' ? config.scbBusinessAnywhereZipPassword : ''
        });
        sourceLabel = inboxImport.provider === 'SCB_BUSINESS_ANYWHERE' ? 'บัตรเครดิต SCB' : 'QR กรุงศรี';
        files = parsed.files;
      }

      await connection.beginTransaction();
      for (const receiptId of inboxImport.receiptIds) {
        const evidence = await attachImportedEvidence(connection, { receiptId, sourceLabel, files });
        if (inboxImport.provider !== 'KRUNGSRIBIZ_MUNGMEE' && evidence.attachmentIds[0]) {
          for (const receiptLineId of inboxImport.lineIdsByReceipt.get(receiptId) || []) {
            await connection.query(
              'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
              [evidence.attachmentIds[0], receiptLineId]
            );
          }
        }
      }
      await connection.commit();
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('Unable to attach legacy bank inbox evidence', error);
  } finally {
    connection.release();
  }
};

const isAttachmentStorageAvailable = (storedPath, hasDatabaseCopy) => {
  if (hasDatabaseCopy) return true;
  if (!storedPath) return false;
  try {
    return fs.existsSync(resolveUploadFilePath(storedPath));
  } catch {
    return false;
  }
};

const serializeReceipt = async (receiptId, connection = getPool()) => {
  const [receipts] = await connection.query(
    `SELECT dr.*, b.code AS branch_code, b.name AS branch_name, b.clickhouse_branch_id,
            su.full_name AS submitted_by_name,
            cu.full_name AS checked_by_name,
            ru.full_name AS closed_by_name,
            tu.full_name AS table_check_acknowledged_by_name,
            nu.full_name AS review_note_updated_by_name
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN users su ON su.id = dr.submitted_by
     LEFT JOIN users cu ON cu.id = dr.checked_by
     LEFT JOIN users ru ON ru.id = dr.closed_by
     LEFT JOIN users tu ON tu.id = dr.table_check_acknowledged_by
     LEFT JOIN users nu ON nu.id = dr.review_note_updated_by
     WHERE dr.id = ?`,
    [receiptId]
  );
  const receipt = receipts[0];
  if (!receipt) return null;

  const [lines] = await connection.query(
    `SELECT drl.*, pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind, pc.provider,
            rlr.id AS reconciliation_id, rlr.receiving_account_id, ra.label AS receiving_account_label,
            ra.bank_name AS receiving_account_bank, rlr.expected_gross_amount, rlr.fee_amount,
            rlr.expected_net_amount, rlr.matched_amount, rlr.settlement_date, rlr.settlement_status,
            rlr.settlement_source, rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount,
            rlr.settlement_batch_key, rlr.settlement_batch_start_date, rlr.settlement_batch_end_date,
            rlr.settlement_batch_gross_amount, rlr.settlement_batch_fee_amount,
            rlr.settlement_batch_net_amount, rlr.settlement_batch_variance_amount,
            rlr.settlement_batch_allocated_fee_amount, rlr.settlement_batch_allocated_net_amount,
            rlr.exception_category, rlr.exception_note, rlr.evidence_attachment_id,
            rlr.manual_checked_without_reference, rlr.manual_checked_at, rlr.manual_checked_by,
            (
              SELECT bit.amount
              FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
              WHERE bit.receipt_line_id = drl.id AND bi.provider = 'GRAB_DAILY'
              ORDER BY bi.id DESC, bit.id DESC
              LIMIT 1
            ) AS grab_report_amount
            ,(
              SELECT bit.raw_payload
              FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
              WHERE bit.receipt_line_id = drl.id AND bi.provider = 'GRAB_DAILY'
              ORDER BY bi.id DESC, bit.id DESC
              LIMIT 1
            ) AS grab_report_payload
            ,COALESCE((
              SELECT CAST(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bit.raw_payload, '$.cashier_amount')), 'null'), '') AS DECIMAL(14,2))
              FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
              WHERE bit.receipt_line_id = drl.id AND bi.provider = 'GRAB_DAILY'
              ORDER BY bi.id DESC, bit.id DESC
              LIMIT 1
            ), rlr.expected_gross_amount) AS grab_cashier_reference_amount
     FROM daily_receipt_lines drl
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     LEFT JOIN receiving_accounts ra ON ra.id = rlr.receiving_account_id
     WHERE drl.receipt_id = ?
     ORDER BY pc.sort_order ASC, pc.id ASC`,
    [receiptId]
  );
  const [imports] = await connection.query(
    `SELECT si.*, pc.code AS channel_code, pc.label AS channel_label,
            ra.label AS receiving_account_label, u.full_name AS imported_by_name
     FROM statement_imports si
     LEFT JOIN payment_channels pc ON pc.id = si.payment_channel_id
     LEFT JOIN receiving_accounts ra ON ra.id = si.receiving_account_id
     LEFT JOIN users u ON u.id = si.imported_by
     WHERE si.receipt_id = ?
     ORDER BY si.created_at DESC`,
    [receiptId]
  );
  const [attachments] = await connection.query(
    `SELECT
       a.id, a.receipt_id, a.statement_import_id, a.attachment_type, a.original_name,
       a.stored_path, a.document_path, a.mime_type, a.document_mime_type,
       a.size_bytes, a.document_size_bytes, a.document_status, a.document_error,
       OCTET_LENGTH(a.file_data) AS file_data_bytes,
       OCTET_LENGTH(a.document_data) AS document_data_bytes,
       a.uploaded_by, a.created_at, u.full_name AS uploaded_by_name, u.role AS uploaded_by_role
     FROM attachments a
     LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.receipt_id = ?
     ORDER BY a.created_at DESC`,
    [receiptId]
  );
  const safeAttachments = attachments.map((attachment) => {
    const fileAvailable = isAttachmentStorageAvailable(attachment.stored_path, Number(attachment.file_data_bytes || 0) > 0);
    const convertedDocumentAvailable = Number(attachment.document_data_bytes || 0) > 0 || (
      attachment.document_path
        ? isAttachmentStorageAvailable(attachment.document_path, false)
        : false
    );
    return {
      ...attachment,
      file_available: fileAvailable,
      document_available: convertedDocumentAvailable || fileAvailable
    };
  });
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
  const [statementTransactions] = await connection.query(
    `SELECT st.id, st.import_id, st.receipt_line_id, st.receiving_account_id, st.payment_channel_id,
            st.transaction_date, st.description, st.reference_no, st.amount, st.match_status,
            st.raw_payload, pc.label AS channel_label, ra.label AS receiving_account_label,
            bmm.is_primary AS merchant_is_primary
     FROM statement_transactions st
     LEFT JOIN payment_channels pc ON pc.id = st.payment_channel_id
     LEFT JOIN receiving_accounts ra ON ra.id = st.receiving_account_id
     LEFT JOIN bank_merchant_mappings bmm
       ON bmm.provider = 'KPLUSSHOP' AND bmm.merchant_id = st.reference_no
     WHERE st.receipt_id = ?
     ORDER BY st.transaction_date DESC, st.id DESC
     LIMIT 300`,
    [receiptId]
  );
  const postCloseAdjustments = await loadPostCloseAdjustments(connection, receiptId);
  const receivingAccounts = await getReceivingAccounts(connection);
  const serializedLines = lines.filter((line) => branchSupportsPaymentChannel(receipt.branch_code, line.channel_code)).map((line) => {
    let grabReportPayload = line.grab_report_payload || null;
    if (typeof grabReportPayload === 'string') {
      try {
        grabReportPayload = JSON.parse(grabReportPayload);
      } catch {
        grabReportPayload = null;
      }
    }
    const evidence = calculateStoredLineEvidence(line);
    return {
      ...line,
      branch_id: receipt.branch_id,
      receipt_status: receipt.status,
      post_close_adjustment_amount: roundMoney(postCloseAdjustments.filter((note) => Number(note.receipt_line_id) === Number(line.id)).reduce((sum, note) => sum + Number(note.amount), 0)),
      grab_report_payload: grabReportPayload,
      settlement_source: evidence.settlementSource,
      evidence_reference_gross_amount: evidence.referenceGross,
      evidence_reference_net_amount: evidence.referenceNet,
      cashier_reference_variance_amount: evidence.cashierReferenceVariance,
      settlement_variance_amount: evidence.settlementVariance,
      has_evidence_variance: evidence.hasEvidenceVariance
    };
  });

  const historicalEvidenceWarning = receipt.status === 'CLOSED' && serializedLines.some((line) => (
    line.settlement_source !== 'NONE' && line.has_evidence_variance
  ));

  return {
    ...receipt,
    ...receiptConfirmationFields({ ...receipt, lines: serializedLines, misc_items: miscItems, post_close_adjustments: postCloseAdjustments }),
    post_close_adjustments: postCloseAdjustments,
    status_label: receiptStatusLabel(receipt.status),
    historical_evidence_warning: historicalEvidenceWarning,
    lines: serializedLines,
    statement_imports: imports,
    statement_transactions: statementTransactions,
    receiving_accounts: receivingAccounts,
    attachments: safeAttachments,
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
    `SELECT drl.*, pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind, pc.sort_order, dr.morning_change_amount,
            rlr.id AS reconciliation_id, rlr.receiving_account_id, rlr.expected_gross_amount,
            rlr.expected_net_amount, rlr.fee_amount, rlr.settlement_source,
            rlr.exception_category, rlr.exception_note,
            COALESCE(misc.misc_total, 0) AS misc_total
     FROM daily_receipt_lines drl
     JOIN daily_receipts dr ON dr.id = drl.receipt_id
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     LEFT JOIN (
       SELECT receipt_id, SUM(amount) AS misc_total
       FROM receipt_misc_items
       GROUP BY receipt_id
     ) misc ON misc.receipt_id = drl.receipt_id
     WHERE drl.receipt_id = ?
     ORDER BY pc.sort_order ASC, pc.id ASC`,
    [receiptId]
  );
  const inputByLine = new Map();
  const inputByChannel = new Map();
  for (const line of inputLines) {
    if (line.id) inputByLine.set(Number(line.id), line);
    if (line.payment_channel_id) inputByChannel.set(Number(line.payment_channel_id), line);
  }

  const preparedRows = rows.map((row) => {
    const input = inputByLine.get(Number(row.id)) || inputByChannel.get(Number(row.payment_channel_id)) || {};
    const verifiedInput = input.verified_amount ?? input.statement_amount;
    const statementAmount =
      verifiedInput === undefined || verifiedInput === null || verifiedInput === ''
        ? row.statement_amount
        : roundMoney(verifiedInput);
    const expectedAmount = expectedAmountForVerification(row);
    const reason =
      input.variance_reason !== undefined
        ? String(input.variance_reason || '').trim() || null
        : row.variance_reason;
    const exceptionCategory = input.exception_category !== undefined
      ? String(input.exception_category || '').trim() || null
      : row.exception_category;
    const adjustmentInput = input.reconciliation_adjustment_amount;
    const parsedAdjustment = adjustmentInput === undefined || adjustmentInput === null || adjustmentInput === ''
      ? Number(row.reconciliation_adjustment_amount || 0)
      : Number(String(adjustmentInput).replaceAll(',', '').trim());
    if (!Number.isFinite(parsedAdjustment)) {
      const error = new Error(`ยอดเข้า/ออกปรับปรุงของ ${row.channel_label} ไม่ถูกต้อง`);
      error.statusCode = 400;
      throw error;
    }
    const reconciliationAdjustmentAmount = roundMoney(parsedAdjustment);

    return {
      ...row,
      expectedAmount,
      statementAmount,
      cashierAmount: input.cashier_amount ?? row.cashier_amount,
      reason,
      exceptionCategory: reconciliationAdjustmentAmount !== 0 && !exceptionCategory ? 'OTHER' : exceptionCategory,
      reconciliationAdjustmentAmount
    };
  });

  const updated = [];
  for (const row of preparedRows) {
    const evidence = calculateEvidenceVariances({
      channelCode: row.channel_code,
      cashierAmount: row.cashierAmount,
      statementAmount: row.statementAmount,
      expectedGrossAmount: row.expected_gross_amount,
      feeAmount: row.fee_amount,
      expectedNetAmount: row.expected_net_amount,
      settlementSource: row.settlement_source
    });
    const varianceAmount = evidence.settlementVariance;

    await connection.query(
      `UPDATE daily_receipt_lines
       SET statement_amount = ?, reconciliation_adjustment_amount = ?, variance_amount = ?, variance_reason = ?
       WHERE id = ?`,
      [row.statementAmount, row.reconciliationAdjustmentAmount, varianceAmount, row.reason, row.id]
    );
    if (row.reconciliation_id) {
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET exception_category = ?, exception_note = ?,
             cashier_reference_variance_amount = ?, settlement_variance_amount = ?
         WHERE id = ?`,
        [row.exceptionCategory, row.reason, evidence.cashierReferenceVariance, evidence.settlementVariance, row.reconciliation_id]
      );
    }
    updated.push({
      ...row,
      statement_amount: row.statementAmount,
      reconciliation_adjustment_amount: row.reconciliationAdjustmentAmount,
      variance_amount: varianceAmount,
      cashier_reference_variance_amount: evidence.cashierReferenceVariance,
      settlement_variance_amount: evidence.settlementVariance,
      settlement_source: evidence.settlementSource,
      has_evidence_variance: evidence.hasEvidenceVariance,
      variance_reason: row.reason
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

app.get('/api/auth/google/config', (_req, res) => {
  res.json({ success: true, data: getGoogleLoginPublicConfig() });
});

app.post('/api/auth/google', asyncHandler(async (req, res) => {
  const result = await loginUserWithGoogle({ credential: req.body?.credential });
  if (!result) {
    return res.status(401).json({ success: false, message: 'บัญชี Google นี้ไม่ได้รับอนุญาต' });
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

app.post('/api/decision-contexts', authenticate, asyncHandler(async (req, res) => {
  const actionKey = String(req.body?.action_key || '').trim();
  if (!actionKey) return res.status(400).json({ success: false, message: 'action_key is required' });
  const result = await createDecisionContext({
    user: req.user,
    actionKey,
    entityType: req.body?.entity_type,
    entityId: req.body?.entity_id,
    pageUrl: req.body?.page_url,
    contextSnapshot: req.body?.context_snapshot
  });
  return res.status(201).json({ success: true, data: result });
}));

app.get('/api/decisions', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listDecisions({
    limit: req.query.limit,
    actionKey: String(req.query.action_key || ''),
    comparison: String(req.query.comparison || '')
  }) });
}));

app.post('/api/decisions/:id/follow-up', authenticate, asyncHandler(async (req, res) => {
  const answer = String(req.body?.answer || '').trim();
  if (!answer) return res.status(400).json({ success: false, message: 'answer is required' });
  res.json({ success: true, data: await answerDecisionFollowup({ decisionId: req.params.id, answer, userId: req.user?.id }) });
}));

app.post('/api/decisions/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelDecision({ decisionId: req.params.id, userId: req.user?.id }) });
}));

app.get('/api/agents/health', authenticate, requirePermission('receipt:read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getAgentHealth() });
}));

app.get('/api/agents/runs/:runId', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  const run = await getAgentRun(req.params.runId);
  if (!run) return res.status(404).json({ success: false, message: 'Agent run not found' });
  res.json({ success: true, data: run });
}));

const decisionActionKey = (req) => {
  const pathName = String(req.path || '')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f-]{24,}(?=\/|$)/gi, '/:id');
  const method = String(req.method || '').toLowerCase();
  const explicit = {
    'post:/branches': 'settings.branch.create',
    'post:/receiving-accounts': 'settings.receiving_account.create',
    'put:/receiving-accounts/:id': 'settings.receiving_account.update',
    'put:/payment-channels/:id': 'settings.payment_channel.update',
    'post:/daily-receipts/from-clickhouse': 'receipt.create_from_pos',
    'post:/daily-receipts/backfill-clickhouse': 'receipt.backfill_from_pos',
    'put:/daily-receipts/:id/submit': 'receipt.submit',
    'put:/daily-receipts/:id/cashier-amounts': 'receipt.cashier_amounts.update',
    'put:/daily-receipts/:id/statement-amounts': 'receipt.statement_amounts.update',
    'put:/daily-receipts/:id/review-note': 'receipt.review_note.update',
    'post:/daily-receipts/:id/misc-items': 'receipt.misc_item.create',
    'delete:/daily-receipts/:id/misc-items/:id': 'receipt.misc_item.delete',
    'post:/daily-receipts/:id/attachments': 'receipt.attachment.upload',
    'put:/reconciliations/:id/settlement': 'reconciliation.settlement.update',
    'post:/reconciliations/:id/confirm-grab-report': 'reconciliation.grab.confirm',
    'put:/reconciliations/:id/manual-check': 'reconciliation.manual_check',
    'put:/reconciliations/:id/adjustment': 'reconciliation.adjustment.update',
    'post:/reconciliations/:id/evidence': 'reconciliation.evidence.upload',
    'post:/reconciliations/statement-confirm': 'reconciliation.statement.confirm',
    'put:/daily-receipts/:id/check': 'receipt.check',
    'put:/daily-receipts/:id/request-correction': 'receipt.request_correction',
    'put:/daily-receipts/:id/close': 'receipt.close',
    'post:/daily-receipts/:id/post-close-adjustments': 'receipt.post_close_adjustment',
    'post:/reports/morning-brief/refresh': 'report.morning_brief.refresh'
  };
  return explicit[`${method}:${pathName}`] || `cashflow.${method}.${pathName.replace(/^\//, '').replaceAll('/', '.')}`;
};

app.use('/api', (req, res, next) => {
  if (!config.decisionReasonRequired) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/inbox-imports/') || req.path === '/reconciliations/statement-preview') return next();
  return authenticate(req, res, () => requireHumanDecision(decisionActionKey(req))(req, res, next));
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

app.get('/api/receiving-accounts', authenticate, requirePermission('receipt:read'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getReceivingAccounts() });
}));

const saveReceivingAccount = async ({ connection, accountId = null, payload }) => {
  const label = String(payload.label || '').trim();
  if (!label) {
    const error = new Error('กรุณาระบุชื่อบัญชีรับเงิน');
    error.statusCode = 400;
    throw error;
  }
  const channelIds = [...new Set((Array.isArray(payload.payment_channel_ids) ? payload.payment_channel_ids : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (channelIds.length === 0) {
    const error = new Error('กรุณาเลือกอย่างน้อยหนึ่งช่องทางที่รับเงินเข้าบัญชีนี้');
    error.statusCode = 400;
    throw error;
  }
  const branchId = payload.branch_id ? Number(payload.branch_id) : null;
  if (branchId) {
    const [branchRows] = await connection.query('SELECT id FROM branches WHERE id = ? AND is_active = TRUE', [branchId]);
    if (!branchRows[0]) {
      const error = new Error('สาขาที่เลือกไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }
  }
  let id = accountId;
  if (id) {
    await connection.query(
      `UPDATE receiving_accounts
       SET branch_id = ?, label = ?, bank_name = ?, account_number = ?,
           account_name = ?, account_alias = ?, account_type = ?, is_active = ?
       WHERE id = ?`,
      [
        branchId,
        label,
        String(payload.bank_name || '').trim() || null,
        String(payload.account_number || '').trim() || null,
        String(payload.account_name || '').trim() || null,
        String(payload.account_alias || '').trim() || null,
        String(payload.account_type || '').trim() || null,
        payload.is_active === false ? 0 : 1,
        id
      ]
    );
    await connection.query('DELETE FROM receiving_account_channels WHERE receiving_account_id = ?', [id]);
  } else {
    const [result] = await connection.query(
      `INSERT INTO receiving_accounts
         (branch_id, label, bank_name, account_number, account_name, account_alias, account_type, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        label,
        String(payload.bank_name || '').trim() || null,
        String(payload.account_number || '').trim() || null,
        String(payload.account_name || '').trim() || null,
        String(payload.account_alias || '').trim() || null,
        String(payload.account_type || '').trim() || null,
        payload.is_active === false ? 0 : 1
      ]
    );
    id = result.insertId;
  }
  for (const channelId of channelIds) {
    await connection.query(
      'INSERT INTO receiving_account_channels (receiving_account_id, payment_channel_id) VALUES (?, ?)',
      [id, channelId]
    );
  }
  return id;
};

app.post('/api/receiving-accounts', authenticate, requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const id = await saveReceivingAccount({ connection, payload: req.body });
    await connection.commit();
    res.status(201).json({ success: true, data: { id, accounts: await getReceivingAccounts(connection) } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/receiving-accounts/:id', authenticate, requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const id = Number(req.params.id);
    await saveReceivingAccount({ connection, accountId: id, payload: req.body });
    await connection.commit();
    res.json({ success: true, data: { id, accounts: await getReceivingAccounts(connection) } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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

const syncExpectedReceiptFromClickHouse = async ({
  receiptDate,
  branch,
  actor,
  backfill = false,
  dryRun = false
}) => {
  const connection = await getPool().getConnection();
  try {
    if (!branch?.clickhouse_branch_id) {
      const error = new Error('Branch is missing ClickHouse branch id.');
      error.statusCode = 400;
      throw error;
    }

    const [initialRows] = await connection.query(
      'SELECT * FROM daily_receipts WHERE receipt_date = ? AND branch_id = ?',
      [receiptDate, branch.id]
    );
    const initial = initialRows[0];
    const initialAction = backfill
      ? decideBackfillAction(initial?.status)
      : initial?.status === 'CLOSED' ? 'skip_closed' : initial ? 'update' : 'create';
    if (initialAction === 'skip_closed' && !backfill) {
      const error = new Error('Closed receipt cannot be refreshed.');
      error.statusCode = 409;
      throw error;
    }
    if (initialAction.startsWith('skip_')) {
      return {
        action: initialAction,
        receiptId: initial.id,
        receiptDate,
        branchCode: branch.code,
        status: initial.status,
        grossSalesExpected: roundMoney(initial.gross_sales_expected)
      };
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
      // Cash is sourced from doc.paycashamount. Some ClickHouse branches also
      // repeat it in docpayment, which must not be counted a second time.
      if (isCashPaymentDescription(row.description)) continue;
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

    if (dryRun) {
      return {
        action: initialAction,
        receiptId: initial?.id || null,
        receiptDate,
        branchCode: branch.code,
        status: initial?.status || 'DRAFT',
        grossSalesExpected: totals.grossSalesExpected,
        billCount: expected.billCount
      };
    }

    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      'SELECT * FROM daily_receipts WHERE receipt_date = ? AND branch_id = ? FOR UPDATE',
      [receiptDate, branch.id]
    );
    const existing = existingRows[0];
    const action = backfill
      ? decideBackfillAction(existing?.status)
      : existing?.status === 'CLOSED' ? 'skip_closed' : existing ? 'update' : 'create';
    if (action === 'skip_closed' && !backfill) {
      const error = new Error('Closed receipt cannot be refreshed.');
      error.statusCode = 409;
      throw error;
    }
    if (action.startsWith('skip_')) {
      await connection.rollback();
      return {
        action,
        receiptId: existing.id,
        receiptDate,
        branchCode: branch.code,
        status: existing.status,
        grossSalesExpected: roundMoney(existing.gross_sales_expected)
      };
    }

    let receiptId = existing?.id;
    if (!receiptId) {
      const [result] = await connection.query(
        `INSERT INTO daily_receipts
          (receipt_date, branch_id, gross_sales_expected, cash_expected, non_cash_expected, bill_count, clickhouse_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          receiptDate,
          branch.id,
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

    for (const channel of mappingIndex.channels.filter((item) => branchSupportsPaymentChannel(branch.code, item.code))) {
      const expectedAmount = roundMoney(channelAmounts.get(channel.id) || 0);
      const descriptions = sourceDescriptions.get(channel.id) || [];
      await connection.query(
        `INSERT INTO daily_receipt_lines (receipt_id, payment_channel_id, expected_amount, source_description)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE expected_amount = VALUES(expected_amount), source_description = VALUES(source_description)`,
        [receiptId, channel.id, expectedAmount, descriptions.join(', ') || null]
      );
    }
    await connection.query(
      `INSERT IGNORE INTO receipt_line_reconciliations
        (receipt_line_id)
       SELECT id
       FROM daily_receipt_lines
       WHERE receipt_id = ?`,
      [receiptId]
    );

    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: existing ? 'refresh_from_clickhouse' : 'create_from_clickhouse',
      actor,
      afterPayload: {
        receiptDate,
        branchId: branch.id,
        branchCode: branch.code,
        source: backfill ? 'clickhouse_backfill' : 'clickhouse_single',
        expected,
        totals
      }
    });
    await connection.commit();
    return {
      action,
      receiptId,
      receiptDate,
      branchCode: branch.code,
      status: existing?.status || 'DRAFT',
      grossSalesExpected: totals.grossSalesExpected,
      billCount: expected.billCount
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

app.post('/api/daily-receipts/from-clickhouse', authenticate, requirePermission('receipt:create'), asyncHandler(async (req, res) => {
  const receiptDate = validateDate(req.body.date || req.body.receipt_date, 'date');
  if (receiptDate > thailandBusinessDate()) {
    return res.status(409).json({
      success: false,
      message: 'ยังไม่สามารถดึงยอด POS ของวันในอนาคตได้ กรุณาเลือกวันปัจจุบันหรือย้อนหลัง'
    });
  }
  const branchId = Number(req.body.branch_id);
  if (!Number.isFinite(branchId) || branchId <= 0) {
    return res.status(400).json({ success: false, message: 'branch_id is required' });
  }

  const [branches] = await getPool().query(
    'SELECT * FROM branches WHERE id = ? AND is_active = TRUE',
    [branchId]
  );
  const branch = branches[0];
  if (!branch) {
    return res.status(404).json({ success: false, message: 'Branch not found' });
  }
  const result = await syncExpectedReceiptFromClickHouse({
    receiptDate,
    branch,
    actor: req.user
  });
  res.status(result.action === 'create' ? 201 : 200).json({
    success: true,
    data: await serializeReceipt(result.receiptId)
  });
}));

app.post('/api/daily-receipts/backfill-clickhouse', authenticate, requirePermission('settings:manage'), asyncHandler(async (req, res) => {
  const from = validateDate(req.body.from, 'from');
  const to = validateDate(req.body.to, 'to');
  const dates = buildDateRange(from, to, 366);
  const requestedCodes = [...new Set(
    (Array.isArray(req.body.branch_codes) ? req.body.branch_codes : ['KK', 'SK'])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)
  )];
  if (requestedCodes.length === 0 || requestedCodes.length > 20) {
    return res.status(400).json({ success: false, message: 'branch_codes must contain 1-20 branch codes' });
  }

  const placeholders = requestedCodes.map(() => '?').join(', ');
  const [branches] = await getPool().query(
    `SELECT * FROM branches WHERE code IN (${placeholders}) AND is_active = TRUE ORDER BY code ASC`,
    requestedCodes
  );
  const foundCodes = new Set(branches.map((branch) => branch.code));
  const missingCodes = requestedCodes.filter((code) => !foundCodes.has(code));
  if (missingCodes.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Unknown or inactive branch codes: ${missingCodes.join(', ')}`
    });
  }

  const dryRun = isTruthy(req.body.dry_run);
  const rows = [];
  for (const receiptDate of dates) {
    for (const branch of branches) {
      rows.push(await syncExpectedReceiptFromClickHouse({
        receiptDate,
        branch,
        actor: req.user,
        backfill: true,
        dryRun
      }));
    }
  }

  const counts = rows.reduce((summary, row) => {
    summary[row.action] = (summary[row.action] || 0) + 1;
    return summary;
  }, { create: 0, update: 0, skip_closed: 0, skip_status: 0 });
  const branchTotals = Object.fromEntries(branches.map((branch) => [
    branch.code,
    roundMoney(rows
      .filter((row) => row.branchCode === branch.code)
      .reduce((sum, row) => sum + Number(row.grossSalesExpected || 0), 0))
  ]));
  res.json({
    success: true,
    data: {
      summary: {
        dry_run: dryRun,
        from,
        to,
        requested_documents: dates.length * branches.length,
        ...counts,
        branch_totals: branchTotals
      },
      rows
    }
  });
}));

app.get('/api/daily-receipts', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  const clauses = [];
  const params = [];
  if (req.query.date) {
    clauses.push('dr.receipt_date = ?');
    params.push(validateDate(req.query.date));
  } else if (req.query.from || req.query.to) {
    const from = validateDate(req.query.from || req.query.to, 'from');
    const to = validateDate(req.query.to || req.query.from, 'to');
    clauses.push('dr.receipt_date BETWEEN ? AND ?');
    params.push(from, to);
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
            COALESCE(misc.misc_total, 0) AS misc_total,
            COALESCE(SUM(drl.cashier_amount), 0) + COALESCE(misc.misc_total, 0) AS cashier_total,
            COALESCE(SUM(drl.statement_amount), 0) + COALESCE(misc.misc_total, 0) AS statement_total,
            COALESCE(SUM(drl.variance_amount), 0) AS variance_total,
            (dr.status = 'CLOSED' AND MAX(
              COALESCE(rlr.settlement_source, 'NONE') <> 'NONE' AND (
                ABS(COALESCE(rlr.cashier_reference_variance_amount, 0)) >= 0.01 OR
                ABS(COALESCE(rlr.settlement_variance_amount, 0)) >= 0.01
              )
            ) = 1) AS historical_evidence_warning,
            (COALESCE(SUM(drl.cashier_amount), 0) + COALESCE(misc.misc_total, 0)
              - dr.gross_sales_expected - dr.morning_change_amount) AS cashier_variance_total
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     LEFT JOIN (
       SELECT receipt_id, SUM(amount) AS misc_total
       FROM receipt_misc_items
       GROUP BY receipt_id
     ) misc ON misc.receipt_id = dr.id
     ${where}
     GROUP BY dr.id
     ORDER BY dr.receipt_date DESC, b.name ASC
     LIMIT 300`,
    params
  );
  const closedIds = rows.filter((row) => row.status === 'CLOSED').map((row) => row.id);
  const linesByReceipt = new Map();
  const adjustmentsByReceipt = new Map();
  if (closedIds.length) {
    const [notes] = await getPool().query('SELECT * FROM receipt_post_close_adjustments WHERE receipt_id IN (?) ORDER BY revision', [closedIds]);
    for (const note of notes) {
      const entries = adjustmentsByReceipt.get(note.receipt_id) || [];
      entries.push(note);
      adjustmentsByReceipt.set(note.receipt_id, entries);
    }
    const [closedLines] = await getPool().query(
      `SELECT drl.*, pc.code AS channel_code, rlr.fee_amount, rlr.settlement_batch_key,
              rlr.settlement_batch_allocated_net_amount, rlr.settlement_batch_allocated_fee_amount
       FROM daily_receipt_lines drl
       JOIN payment_channels pc ON pc.id = drl.payment_channel_id
       LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
       WHERE drl.receipt_id IN (?)`,
      [closedIds]
    );
    for (const line of closedLines) {
      const receiptLines = linesByReceipt.get(line.receipt_id) || [];
      receiptLines.push(line);
      linesByReceipt.set(line.receipt_id, receiptLines);
    }
  }
  res.json({
    success: true,
    data: rows.map((row) => ({
      ...row,
      ...receiptConfirmationFields({ ...row, lines: linesByReceipt.get(row.id) || [], post_close_adjustments: adjustmentsByReceipt.get(row.id) || [] }),
      status_label: receiptStatusLabel(row.status)
    }))
  });
}));

app.get('/api/daily-receipts/:id', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await requireReceipt(Number(req.params.id)) });
}));

app.put('/api/daily-receipts/:id/review-note', authenticate, requirePermission('receipt:note'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const note = String(req.body?.note || '').trim();
  if (note.length > 1000) {
    return res.status(400).json({ success: false, message: 'บันทึกกันลืมต้องไม่เกิน 1,000 ตัวอักษร' });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT id, review_note FROM daily_receipts WHERE id = ? FOR UPDATE',
      [receiptId]
    );
    if (!rows[0]) {
      const error = new Error('Receipt not found.');
      error.statusCode = 404;
      throw error;
    }
    const previousNote = String(rows[0].review_note || '');
    await connection.query(
      `UPDATE daily_receipts
       SET review_note = ?, review_note_updated_at = NOW(), review_note_updated_by = ?
       WHERE id = ?`,
      [note || null, req.user.id, receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'update_review_note',
      actor: req.user,
      beforePayload: { note: previousNote },
      afterPayload: { note }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(receiptId) });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/daily-receipts/:id/open-tables', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  const receipt = await requireReceipt(Number(req.params.id));
  res.json({ success: true, data: await buildOpenTableCheck(receipt) });
}));

app.put('/api/daily-receipts/:id/submit', authenticate, requirePermission('receipt:submit'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const receiptBeforeSync = await requireReceipt(receiptId);
  if (!canTransitionReceipt(receiptBeforeSync.status, 'SUBMITTED')) {
    const error = new Error(`Receipt in ${receiptBeforeSync.status} cannot be submitted.`);
    error.statusCode = 409;
    throw error;
  }
  if (String(receiptBeforeSync.receipt_date) > thailandBusinessDate()) {
    const error = new Error('ยังไม่สามารถส่งยอดของวันในอนาคตได้');
    error.statusCode = 409;
    throw error;
  }
  let posRefreshWarning = null;
  try {
    await syncExpectedReceiptFromClickHouse({
      receiptDate: String(receiptBeforeSync.receipt_date),
      branch: {
        id: receiptBeforeSync.branch_id,
        code: receiptBeforeSync.branch_code,
        clickhouse_branch_id: receiptBeforeSync.clickhouse_branch_id
      },
      actor: req.user
    });
  } catch (error) {
    if (![502, 503].includes(Number(error.statusCode))) throw error;
    posRefreshWarning = {
      code: 'POS_REFRESH_FAILED',
      message: 'บันทึกยอดแล้ว แต่ครั้งนี้ดึง POS ล่าสุดไม่สำเร็จ ฝ่ายตรวจจะตรวจซ้ำอีกครั้ง'
    };
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!canTransitionReceipt(receipt.status, 'SUBMITTED')) {
      const error = new Error(`Receipt in ${receipt.status} cannot be submitted.`);
      error.statusCode = 409;
      throw error;
    }
    if (!isTruthy(req.body.table_check_acknowledged)) {
      const error = new Error('กรุณายืนยันว่าได้ตรวจโต๊ะค้างใน POS ก่อนส่งยอด');
      error.statusCode = 400;
      throw error;
    }
    const tableCheck = await buildOpenTableCheck(receipt);
    const tableCheckNote = String(req.body.table_check_note || '').trim();
    if (tableCheck.available && tableCheck.open_table_count > 0 && !tableCheckNote) {
      const error = new Error('ยังมีโต๊ะค้างใน POS ถ้าจำเป็นต้องส่งยอด กรุณาระบุหมายเหตุให้หัวหน้าตรวจต่อ');
      error.statusCode = 409;
      error.details = tableCheck;
      throw error;
    }
    const inputs = Array.isArray(req.body.lines) ? req.body.lines : [];
    const hasMorningChangeAmount = Object.prototype.hasOwnProperty.call(req.body, 'morning_change_amount');
    const morningChangeAmount = hasMorningChangeAmount
      ? roundMoney(req.body.morning_change_amount)
      : roundMoney(receipt.morning_change_amount);
    const cashierVarianceCheck = buildCashierVarianceCheck({
      lines: receipt.lines,
      inputLines: inputs,
      miscItems: receipt.misc_items,
      morningChangeAmount,
      grossSalesExpected: receipt.gross_sales_expected
    });
    const posDataWarning = hasDeclaredMoneyWithoutPos({
      billCount: receipt.bill_count,
      grossSalesExpected: receipt.gross_sales_expected,
      declaredAmounts: [
        ...inputs.map((line) => line.cashier_amount),
        ...receipt.misc_items.map((item) => item.amount)
      ]
    });
    if (cashierVarianceCheck.requires_confirmation && !isTruthy(req.body.cashier_variance_acknowledged)) {
      const error = new Error('ยอดขาดหรือเกินเกิน 100 บาท กรุณายืนยันก่อนส่งยอด');
      error.statusCode = 409;
      error.details = cashierVarianceCheck;
      throw error;
    }
    const cashierVarianceAcknowledged = cashierVarianceCheck.requires_confirmation;
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
       SET morning_change_amount = ?,
           status = 'SUBMITTED',
           submitted_by = ?,
           submitted_at = NOW(),
           table_check_acknowledged_at = NOW(),
           table_check_acknowledged_by = ?,
           table_check_status = ?,
           table_check_note = ?,
           open_table_count = ?,
           open_table_amount = ?,
           cashier_variance_acknowledged_at = ${cashierVarianceAcknowledged ? 'NOW()' : 'NULL'},
           cashier_variance_acknowledged_by = ?,
           cashier_variance_acknowledged_amount = ?,
           correction_note = NULL
       WHERE id = ?`,
      [
        morningChangeAmount,
        req.user.id,
        req.user.id,
        tableCheck.status,
        tableCheckNote || null,
        tableCheck.open_table_count,
        tableCheck.open_table_amount,
        cashierVarianceAcknowledged ? req.user.id : null,
        cashierVarianceAcknowledged ? cashierVarianceCheck.variance_amount : 0,
        receiptId
      ]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'submit',
      actor: req.user,
      afterPayload: {
        lines: inputs,
        morningChangeAmount,
        tableCheck,
        tableCheckNote,
        cashierVarianceCheck,
        posRefreshWarning,
        posDataWarning: posDataWarning ? {
          code: 'POS_DATA_NOT_READY',
          bill_count: Number(receipt.bill_count || 0),
          gross_sales_expected: roundMoney(receipt.gross_sales_expected),
          cashier_entered_total: cashierVarianceCheck.entered_total,
          acknowledged: isTruthy(req.body.pos_data_warning_acknowledged)
        } : null
      }
    });
    await connection.commit();
    const serialized = await serializeReceipt(receiptId);
    const submissionWarning = posDataWarning ? {
      code: 'POS_DATA_NOT_READY',
      message: 'บันทึกยอดแล้ว แต่ POS ยังเป็น 0 บิล / 0.00 ฝ่ายตรวจจะตรวจซ้ำอีกครั้ง'
    } : posRefreshWarning;
    res.json({
      success: true,
      data: submissionWarning ? { ...serialized, submission_warning: submissionWarning } : serialized
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/daily-receipts/:id/cashier-amounts', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION'].includes(receipt.status)) {
      const error = new Error(`Receipt in ${receipt.status} cannot update cashier amounts.`);
      error.statusCode = 409;
      throw error;
    }

    const inputs = Array.isArray(req.body.lines) ? req.body.lines : [];
    const beforePayload = {
      lines: receipt.lines.map((line) => ({
        id: line.id,
        payment_channel_id: line.payment_channel_id,
        channel_code: line.channel_code,
        cashier_amount: line.cashier_amount
      }))
    };
    const updates = [];
    for (const input of inputs) {
      const lineId = Number(input.id);
      if (!lineId) continue;
      const currentLine = receipt.lines.find((line) => Number(line.id) === lineId);
      if (!currentLine) continue;
      const amount = roundMoney(input.cashier_amount);
      await connection.query(
        `UPDATE daily_receipt_lines
         SET cashier_amount = ?
         WHERE id = ? AND receipt_id = ?`,
        [amount, lineId, receiptId]
      );
      const ktcSettlement = deriveKtcSettlementAfterCashierEdit({
        channelCode: currentLine.channel_code,
        cashierAmount: amount,
        statementAmount: currentLine.statement_amount,
        settlementSource: currentLine.settlement_source,
        settlementBatchKey: currentLine.settlement_batch_key
      });
      if (ktcSettlement && currentLine.reconciliation_id) {
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
               settlement_source = ?, settlement_status = ?,
               cashier_reference_variance_amount = 0, settlement_variance_amount = ?,
               exception_category = CASE WHEN ? THEN NULL ELSE exception_category END,
               exception_note = CASE WHEN ? THEN NULL ELSE exception_note END
           WHERE id = ?`,
          [
            ktcSettlement.grossAmount,
            ktcSettlement.feeAmount,
            ktcSettlement.expectedNetAmount,
            ktcSettlement.settlementSource,
            ktcSettlement.settlementStatus,
            ktcSettlement.settlementVarianceAmount,
            ktcSettlement.canInferFee,
            ktcSettlement.canInferFee,
            currentLine.reconciliation_id
          ]
        );
        await connection.query(
          'UPDATE daily_receipt_lines SET variance_amount = ? WHERE id = ?',
          [ktcSettlement.settlementVarianceAmount, lineId]
        );
      }
      updates.push({
        id: lineId,
        cashier_amount: amount,
        ktc_settlement_recalculation: ktcSettlement ? {
          expected_gross_amount: ktcSettlement.grossAmount,
          fee_amount: ktcSettlement.feeAmount,
          expected_net_amount: ktcSettlement.expectedNetAmount,
          settlement_status: ktcSettlement.settlementStatus,
          settlement_variance_amount: ktcSettlement.settlementVarianceAmount
        } : null
      });
    }

    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'auditor_update_cashier_amounts',
      actor: req.user,
      beforePayload,
      afterPayload: { lines: updates }
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

app.put('/api/daily-receipts/:id/statement-amounts', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const receipt = await requireReceipt(receiptId, connection);
    if (!['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION'].includes(receipt.status)) {
      const error = new Error(`Receipt in ${receipt.status} cannot update statement amounts.`);
      error.statusCode = 409;
      throw error;
    }

    const inputs = Array.isArray(req.body.lines) ? req.body.lines : [];
    const beforePayload = {
      lines: receipt.lines.map((line) => ({ id: line.id, statement_amount: line.statement_amount }))
    };
    const updated = await updateReceiptLineVerifiedAmounts({ connection, receiptId, inputLines: inputs });
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'auditor_update_statement_amounts',
      actor: req.user,
      beforePayload,
      afterPayload: { lines: updated.map((line) => ({ id: line.id, statement_amount: line.statement_amount })) }
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
    const document = await processAttachmentAsDocument(file);
    const [fileData, documentData] = await Promise.all([
      fs.promises.readFile(file.path),
      document.documentPath ? fs.promises.readFile(document.documentPath).catch(() => null) : null
    ]);
    await getPool().query(
      `INSERT INTO attachments
        (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
         size_bytes, document_size_bytes, file_data, document_data, document_status, document_error, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptId,
        type,
        file.originalname,
        file.path,
        document.documentPath,
        file.mimetype,
        document.documentMimeType,
        file.size,
        document.documentSizeBytes,
        fileData,
        documentData,
        document.documentStatus,
        document.documentError,
        req.user.id
      ]
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

app.get('/api/attachments/:id/file', authenticate, requirePermission('receipt:read'), asyncHandler(async (req, res) => {
  const attachmentId = Number(req.params.id);
  const [rows] = await getPool().query(
    `SELECT a.*
     FROM attachments a
     JOIN daily_receipts dr ON dr.id = a.receipt_id
     WHERE a.id = ?`,
    [attachmentId]
  );
  const attachment = rows[0];
  if (!attachment) {
    return res.status(404).json({ success: false, message: 'Attachment not found' });
  }

  const variant = req.query.variant === 'original' ? 'original' : 'document';
  const focusDate = String(req.query.focus_date || '').slice(0, 10);
  const focusAmount = Number(req.query.focus_amount);
  const hasFocusRequest = /^\d{4}-\d{2}-\d{2}$/.test(focusDate) && Number.isFinite(focusAmount);
  const candidates = [];
  if (variant === 'document' && (attachment.document_path || attachment.document_data)) {
    candidates.push({
      path: attachment.document_path,
      data: attachment.document_data,
      mimeType: attachment.document_mime_type || 'application/pdf',
      fileName: documentFileNameFor(attachment.original_name, attachment.document_mime_type)
    });
  }
  candidates.push({
    path: attachment.stored_path,
    data: attachment.file_data,
    mimeType: attachment.mime_type || 'application/octet-stream',
    fileName: attachment.original_name
  });

  for (const candidate of candidates) {
    if (candidate.data) {
      if (hasFocusRequest && String(candidate.mimeType).toLowerCase().startsWith('application/pdf')) {
        try {
          const focusPage = await findPdfEvidenceFocusPage({
            fileData: candidate.data,
            date: focusDate,
            amount: focusAmount,
            password: config.krungthaiBusinessZipPassword
          });
          if (focusPage) res.setHeader('X-Evidence-Focus-Page', String(focusPage));
        } catch {
          // The original evidence must remain readable even when its text layer cannot be searched.
        }
      }
      res.setHeader('Content-Type', candidate.mimeType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(candidate.fileName)}`);
      return res.send(Buffer.from(candidate.data));
    }

    if (candidate.path) {
      try {
        const resolvedPath = resolveUploadFilePath(candidate.path);
        if (fs.existsSync(resolvedPath)) {
          if (hasFocusRequest && String(candidate.mimeType).toLowerCase().startsWith('application/pdf')) {
            try {
              const focusPage = await findPdfEvidenceFocusPage({
                fileData: await fs.promises.readFile(resolvedPath),
                date: focusDate,
                amount: focusAmount,
                password: config.krungthaiBusinessZipPassword
              });
              if (focusPage) res.setHeader('X-Evidence-Focus-Page', String(focusPage));
            } catch {
              // The original evidence must remain readable even when its text layer cannot be searched.
            }
          }
          res.setHeader('Content-Type', candidate.mimeType);
          res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(candidate.fileName)}`);
          return res.sendFile(resolvedPath);
        }
      } catch {
        // Legacy paths may point to another host; keep trying database-backed candidates.
      }
    }
  }

  return res.status(404).json({
    success: false,
    message: 'Attachment file not found. Please upload this file again.'
  });
}));

app.put('/api/reconciliations/:lineId/settlement', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const line = await getReceiptLineContext(connection, Number(req.params.lineId));
    if (!isSettlementChannel(line)) {
      const error = new Error('ช่องทางนี้ไม่ต้องบันทึก settlement');
      error.statusCode = 400;
      throw error;
    }
    const accountId = Number(req.body.receiving_account_id);
    await assertAccountSupportsChannel(connection, accountId, line.payment_channel_id, line.branch_id);
    const grossAmount = roundMoney(req.body.gross_amount);
    const feeAmount = roundMoney(req.body.fee_amount);
    const netAmount = roundMoney(req.body.net_amount);
    if (grossAmount < 0 || feeAmount < 0 || netAmount < 0 || netAmount > grossAmount) {
      const error = new Error('ยอด settlement ไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
           settlement_source = 'MANUAL',
           settlement_status = 'READY_FOR_STATEMENT', exception_category = NULL, exception_note = NULL
       WHERE receipt_line_id = ?`,
      [accountId, grossAmount, feeAmount, netAmount, line.id]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: 'save_settlement',
      actor: req.user,
      afterPayload: { receipt_line_id: line.id, grossAmount, feeAmount, netAmount, accountId }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(line.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

// Grab's cashier reference is the POS amount after merchant promotions. The
// matched incoming amount is the report's net income after all deductions.
app.post('/api/reconciliations/:lineId/confirm-grab-report', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const line = await getReceiptLineContext(connection, Number(req.params.lineId));
    if (line.receipt_status === 'CLOSED') {
      const error = new Error('เอกสารที่ปิดแล้วไม่สามารถยืนยันรายงาน Grab ได้');
      error.statusCode = 409;
      throw error;
    }
    if (line.channel_code !== 'GRAB') {
      const error = new Error('รายการนี้ไม่ใช่ช่องทาง Grab');
      error.statusCode = 400;
      throw error;
    }

    const [reportRows] = await connection.query(
      `SELECT bit.id AS transaction_id, bit.amount, bit.transaction_date, bit.description, bit.reference_no,
              bit.raw_payload, bi.id AS inbox_import_id, bi.original_name, bi.stored_path, bi.mime_type
       FROM bank_inbox_transactions bit
       JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
       WHERE bit.receipt_line_id = ? AND bi.provider = 'GRAB_DAILY'
       ORDER BY bi.id DESC, bit.id DESC
       LIMIT 1`,
      [line.id]
    );
    const report = reportRows[0];
    if (!report) {
      const error = new Error('ยังไม่พบรายงาน Grab ที่ผูกกับวันและสาขานี้');
      error.statusCode = 404;
      throw error;
    }

    const rawPayload = typeof report.raw_payload === 'string'
      ? JSON.parse(report.raw_payload || '{}')
      : report.raw_payload || {};
    const cashierReferenceAmount = roundMoney(
      rawPayload.cashier_amount ?? line.cashier_amount ?? 0
    );
    if (cashierReferenceAmount <= 0) {
      const error = new Error('รายงาน Grab นี้ไม่พบยอดอ้างอิงแคชเชียร์');
      error.statusCode = 422;
      throw error;
    }
    const feeAmount = roundMoney(rawPayload.fee_amount ?? line.fee_amount);
    const netAmount = roundMoney(rawPayload.net_amount ?? report.amount ?? line.expected_net_amount);
    const requestedAdjustment = req.body.reconciliation_adjustment_amount;
    const parsedAdjustment = requestedAdjustment === undefined || requestedAdjustment === null || requestedAdjustment === ''
      ? Number(line.reconciliation_adjustment_amount || 0)
      : Number(String(requestedAdjustment).replaceAll(',', '').trim());
    if (!Number.isFinite(parsedAdjustment)) {
      const error = new Error('ยอดเข้า/ออกปรับปรุงไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }
    const reconciliationAdjustmentAmount = roundMoney(parsedAdjustment);
    const adjustmentReason = req.body.variance_reason !== undefined
      ? String(req.body.variance_reason || '').trim()
      : String(line.variance_reason || '').trim();
    if (reconciliationAdjustmentAmount !== 0 && !adjustmentReason) {
      const error = new Error('กรุณาระบุเหตุผลของยอดเข้า/ออกปรับปรุง');
      error.statusCode = 400;
      throw error;
    }
    await connection.query(
      `UPDATE daily_receipt_lines
       SET expected_amount = ?, cashier_amount = ?
       WHERE id = ?`,
      [cashierReferenceAmount, cashierReferenceAmount, line.id]
    );
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
           settlement_source = 'GRAB_REPORT',
           settlement_date = DATE_ADD(?, INTERVAL 1 DAY),
           settlement_status = CASE WHEN matched_amount > 0 THEN settlement_status ELSE 'READY_FOR_STATEMENT' END
       WHERE receipt_line_id = ?`,
      [cashierReferenceAmount, feeAmount, netAmount, report.transaction_date || line.receipt_date, line.id]
    );
    const uniqueHash = crypto.createHash('sha256').update(`grab-cashier-reference-confirm:${report.transaction_id}`).digest('hex');
    const statementPayload = JSON.stringify({
      ...rawPayload,
      source: 'grab_daily_report',
      inbox_import_id: report.inbox_import_id,
      cashier_reference_amount: cashierReferenceAmount,
      net_amount: netAmount
    });
    await connection.query(
      `UPDATE statement_transactions
       SET match_status = 'unmatched'
       WHERE receipt_line_id = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.source')) = 'grab_daily_report'`,
      [line.id]
    );
    const [existingTransactions] = await connection.query(
      'SELECT id, import_id FROM statement_transactions WHERE unique_hash = ? LIMIT 1',
      [uniqueHash]
    );
    if (existingTransactions[0]) {
      await connection.query(
        `UPDATE statement_transactions
         SET amount = ?, raw_payload = ?, match_status = 'matched_manual'
         WHERE id = ?`,
        [netAmount, statementPayload, existingTransactions[0].id]
      );
      await connection.query(
        'UPDATE statement_imports SET total_amount = ? WHERE id = ?',
        [netAmount, existingTransactions[0].import_id]
      );
    } else {
      const [statementImport] = await connection.query(
        `INSERT INTO statement_imports
          (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          line.receipt_id, line.payment_channel_id, line.receiving_account_id || null,
          `${report.original_name} (Grab net income confirmed)`, report.stored_path, report.mime_type,
          netAmount, req.user.id
        ]
      );
      await connection.query(
        `INSERT INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 1 DAY), ?, ?, ?, ?, ?, 'matched_manual')`,
        [
          statementImport.insertId, line.receipt_id, line.id, line.receiving_account_id || null,
          line.payment_channel_id, report.transaction_date || line.receipt_date,
          'Grab net income confirmed from daily report', report.reference_no || null, netAmount,
          uniqueHash, statementPayload
        ]
      );
    }
    const matchedAmount = netAmount;
    const varianceAmount = 0;
    await connection.query(
      `UPDATE daily_receipt_lines
       SET statement_amount = ?, reconciliation_adjustment_amount = ?, variance_amount = 0, variance_reason = ?
       WHERE id = ?`,
      [matchedAmount, reconciliationAdjustmentAmount, adjustmentReason || null, line.id]
    );
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET matched_amount = ?, settlement_status = ?, manual_checked_without_reference = FALSE,
           manual_checked_at = NULL, manual_checked_by = NULL
       WHERE receipt_line_id = ?`,
      [matchedAmount, varianceAmount === 0 ? 'MATCHED_MANUAL' : 'EXCEPTION', line.id]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: 'apply_grab_cashier_reference',
      actor: req.user,
      afterPayload: { receipt_line_id: line.id, inbox_import_id: report.inbox_import_id, cashier_reference_amount: cashierReferenceAmount, fee_amount: feeAmount, net_amount: netAmount, matched_amount: matchedAmount, variance_amount: varianceAmount, reconciliation_adjustment_amount: reconciliationAdjustmentAmount, variance_reason: adjustmentReason || null }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(line.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/reconciliations/:lineId/manual-check', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const line = await getReceiptLineContext(connection, Number(req.params.lineId));
    if (line.receipt_status === 'CLOSED') {
      const error = new Error('เอกสารที่ปิดแล้วไม่สามารถแก้ไขการตรวจได้');
      error.statusCode = 409;
      throw error;
    }

    const checked = Boolean(req.body.checked);
    const requestedCashierAmount = req.body.cashier_amount;
    const requestedAdjustment = req.body.reconciliation_adjustment_amount;
    const parsedAdjustment = requestedAdjustment === undefined || requestedAdjustment === null || requestedAdjustment === ''
      ? Number(line.reconciliation_adjustment_amount || 0)
      : Number(String(requestedAdjustment).replaceAll(',', '').trim());
    if (!Number.isFinite(parsedAdjustment)) {
      const error = new Error('ยอดเข้า/ออกปรับปรุงไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }
    const reconciliationAdjustmentAmount = roundMoney(parsedAdjustment);
    const adjustmentReason = req.body.variance_reason !== undefined
      ? String(req.body.variance_reason || '').trim()
      : String(line.variance_reason || '').trim();
    if (checked && reconciliationAdjustmentAmount !== 0 && !adjustmentReason) {
      const error = new Error('กรุณาระบุเหตุผลของยอดเข้า/ออกปรับปรุง');
      error.statusCode = 400;
      throw error;
    }
    const requestedStatementAmount = req.body.statement_amount !== undefined
      ? req.body.statement_amount
      : line.channel_code === 'CASH'
        ? undefined
        : line.statement_amount;
    const cashierAmount = requestedCashierAmount !== undefined && requestedCashierAmount !== null && requestedCashierAmount !== ''
      ? roundMoney(requestedCashierAmount)
      : roundMoney(line.cashier_amount || 0);
    const verificationAmount = expectedAmountForVerification({ ...line, cashier_amount: cashierAmount });
    if (checked) {
      const manualAmounts = resolveManualCheckAmounts({
        channelCode: line.channel_code,
        currentCashierAmount: line.cashier_amount || 0,
        requestedCashierAmount,
        requestedStatementAmount,
        verificationAmount
      });
      const evidence = calculateEvidenceVariances({
        channelCode: line.channel_code,
        cashierAmount: manualAmounts.cashierAmount,
        statementAmount: manualAmounts.statementAmount,
        expectedGrossAmount: line.expected_gross_amount,
        feeAmount: line.fee_amount,
        expectedNetAmount: line.expected_net_amount,
        settlementSource: line.settlement_source
      });
      await connection.query(
        `UPDATE daily_receipt_lines
         SET cashier_amount = ?, statement_amount = ?, reconciliation_adjustment_amount = ?, variance_amount = ?, variance_reason = ?
         WHERE id = ?`,
        [manualAmounts.cashierAmount, manualAmounts.statementAmount, reconciliationAdjustmentAmount, evidence.settlementVariance, adjustmentReason || null, line.id]
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET matched_amount = ?, settlement_status = 'MATCHED_MANUAL',
             manual_checked_without_reference = TRUE,
             manual_checked_at = NOW(),
             manual_checked_by = ?,
             cashier_reference_variance_amount = ?,
             settlement_variance_amount = ?,
             exception_category = ?,
             exception_note = ?
         WHERE receipt_line_id = ?`,
        [manualAmounts.statementAmount, req.user.id, evidence.cashierReferenceVariance, evidence.settlementVariance,
          reconciliationAdjustmentAmount !== 0 ? 'OTHER' : null, adjustmentReason || null, line.id]
      );
    } else {
      const [statementRows] = await connection.query(
        `SELECT COUNT(*) AS cnt
         FROM statement_transactions
         WHERE receipt_line_id = ?
           AND match_status IN ('classified', 'matched_auto', 'matched_manual')`,
        [line.id]
      );
      const hasMatchedStatement = Number(statementRows[0]?.cnt || 0) > 0;
      if (!hasMatchedStatement) {
        await connection.query(
          `UPDATE daily_receipt_lines
           SET statement_amount = 0, variance_amount = 0,
               variance_reason = CASE WHEN reconciliation_adjustment_amount <> 0 THEN variance_reason ELSE NULL END
           WHERE id = ?`,
          [line.id]
        );
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET matched_amount = 0, settlement_status = 'READY_FOR_STATEMENT'
           WHERE receipt_line_id = ?`,
          [line.id]
        );
      }
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET manual_checked_without_reference = FALSE,
             manual_checked_at = NULL,
             manual_checked_by = NULL
         WHERE receipt_line_id = ?`,
        [line.id]
      );
    }

    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: checked ? 'manual_check_without_reference' : 'manual_uncheck_without_reference',
      actor: req.user,
      afterPayload: {
        receipt_line_id: line.id,
        verificationAmount,
        cashierAmount: checked ? cashierAmount : null,
        statementAmount: checked
          ? resolveManualCheckAmounts({
              channelCode: line.channel_code,
              currentCashierAmount: line.cashier_amount || 0,
              requestedCashierAmount,
              requestedStatementAmount,
              verificationAmount
            }).statementAmount
          : null,
        reconciliationAdjustmentAmount: checked ? reconciliationAdjustmentAmount : Number(line.reconciliation_adjustment_amount || 0),
        varianceReason: checked ? adjustmentReason || null : null
      }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(line.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/reconciliations/:lineId/adjustment', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const line = await getReceiptLineContext(connection, Number(req.params.lineId));
    if (line.receipt_status === 'CLOSED') {
      const error = new Error('เอกสารที่ปิดแล้วไม่สามารถแก้ไขยอดเข้า/ออกปรับปรุงได้');
      error.statusCode = 409;
      throw error;
    }

    const parsedAmount = Number(String(req.body.reconciliation_adjustment_amount ?? '').replaceAll(',', '').trim() || 0);
    if (!Number.isFinite(parsedAmount)) {
      const error = new Error('ยอดเข้า/ออกปรับปรุงไม่ถูกต้อง');
      error.statusCode = 400;
      throw error;
    }
    const adjustmentAmount = roundMoney(parsedAmount);
    const varianceReason = String(req.body.variance_reason || '').trim();
    const evidenceHasVariance = [
      line.cashier_reference_variance_amount,
      line.settlement_variance_amount,
      line.variance_amount
    ].some((value) => Math.abs(Number(value || 0)) >= 0.01);
    if ((adjustmentAmount !== 0 || evidenceHasVariance) && !varianceReason) {
      const error = new Error('กรุณาระบุเหตุผลก่อนบันทึกยอดเข้า/ออกปรับปรุง');
      error.statusCode = 400;
      throw error;
    }
    const requestedCategory = String(req.body.exception_category || '').trim();
    const exceptionCategory = requestedCategory || (adjustmentAmount !== 0 || evidenceHasVariance ? 'OTHER' : null);

    await connection.query(
      `UPDATE daily_receipt_lines
       SET reconciliation_adjustment_amount = ?, variance_reason = ?
       WHERE id = ?`,
      [adjustmentAmount, varianceReason || null, line.id]
    );
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET exception_category = ?, exception_note = ?
       WHERE receipt_line_id = ?`,
      [exceptionCategory, varianceReason || null, line.id]
    );

    if (['CHECKED_OK', 'CHECKED_VARIANCE'].includes(line.receipt_status)) {
      const [receiptLines] = await connection.query(
        `SELECT drl.*, rlr.cashier_reference_variance_amount, rlr.settlement_variance_amount
         FROM daily_receipt_lines drl
         LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
         WHERE drl.receipt_id = ?`,
        [line.receipt_id]
      );
      const nextStatus = resolveCheckedStatus(receiptLines);
      await connection.query(
        `UPDATE daily_receipts
         SET status = ?, checked_by = ?, checked_at = NOW()
         WHERE id = ?`,
        [nextStatus, req.user.id, line.receipt_id]
      );
    }

    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: 'update_reconciliation_adjustment',
      actor: req.user,
      afterPayload: {
        receipt_line_id: line.id,
        channel_code: line.channel_code,
        reconciliation_adjustment_amount: adjustmentAmount,
        variance_reason: varianceReason || null,
        exception_category: exceptionCategory
      }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(line.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.put('/api/statement-transactions/:id/classify', authenticate, requirePermission('receipt:check'), asyncHandler(async (req, res) => {
  const allowed = new Set(['pending_review', 'confirm_income', 'same_day_sale', 'customer_deposit', 'other_date_branch', 'unrelated']);
  const classification = String(req.body.classification || '').trim();
  const note = String(req.body.note || '').trim();
  if (!allowed.has(classification)) {
    return res.status(400).json({ success: false, message: 'ประเภทเงินเข้าไม่ถูกต้อง' });
  }
  if (classification === 'other_date_branch' && !note) {
    return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่หรือสาขาที่เกี่ยวข้อง' });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT st.*, dr.status AS receipt_status
       FROM statement_transactions st
       JOIN daily_receipts dr ON dr.id = st.receipt_id
       WHERE st.id = ? FOR UPDATE`,
      [Number(req.params.id)]
    );
    const transaction = rows[0];
    if (!transaction) {
      const error = new Error('ไม่พบรายการเงินเข้านี้');
      error.statusCode = 404;
      throw error;
    }
    if (transaction.receipt_status === 'CLOSED') {
      const error = new Error('เอกสารที่ปิดแล้วไม่สามารถจัดประเภทรายการเงินเข้าได้');
      error.statusCode = 409;
      throw error;
    }

    const previousLineId = transaction.receipt_line_id;
    let nextLineId = null;
    let matchStatus = classification;
    if (classification === 'same_day_sale' || classification === 'confirm_income') {
      const [lineRows] = await connection.query(
        `SELECT id FROM daily_receipt_lines
         WHERE receipt_id = ? AND payment_channel_id = ? LIMIT 1`,
        [transaction.receipt_id, transaction.payment_channel_id]
      );
      if (!lineRows[0]) {
        const error = new Error('ไม่พบช่องทางรับเงินสำหรับเอกสารวันนี้');
        error.statusCode = 422;
        throw error;
      }
      nextLineId = lineRows[0].id;
      matchStatus = 'matched_manual';
    } else if (classification === 'pending_review' || classification === 'other_date_branch') {
      matchStatus = 'unmatched';
    }

    let rawPayload = transaction.raw_payload || {};
    if (typeof rawPayload === 'string') {
      try { rawPayload = JSON.parse(rawPayload); } catch { rawPayload = {}; }
    }
    rawPayload = {
      ...rawPayload,
      review_classification: classification,
      review_note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: req.user.id
    };
    const requestedAmount = req.body.amount;
    const nextAmount = requestedAmount === undefined || requestedAmount === null || requestedAmount === ''
      ? roundMoney(transaction.amount)
      : roundMoney(requestedAmount);
    if (nextAmount < 0) {
      const error = new Error('ยอดเงินจริงต้องไม่ติดลบ');
      error.statusCode = 400;
      throw error;
    }
    await connection.query(
      `UPDATE statement_transactions
       SET receipt_line_id = ?, amount = ?, match_status = ?, raw_payload = ?
       WHERE id = ?`,
      [nextLineId, nextAmount, matchStatus, JSON.stringify(rawPayload), transaction.id]
    );
    await connection.query(
      `UPDATE bank_inbox_transactions
       SET receipt_line_id = ?, auto_match_status = ?
       WHERE unique_hash = ?`,
      [nextLineId, ['same_day_sale', 'confirm_income'].includes(classification) ? 'LINKED' : classification === 'pending_review' ? 'PENDING' : 'REVIEWED', transaction.unique_hash]
    );
    for (const lineId of new Set([previousLineId, nextLineId].filter(Boolean))) {
      await refreshLineSettlementAfterClassification(connection, lineId);
    }
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: transaction.receipt_id,
      action: 'classify_pending_bank_income',
      actor: req.user,
      beforePayload: {
        statement_transaction_id: transaction.id,
        receipt_line_id: previousLineId,
        match_status: transaction.match_status
      },
      afterPayload: {
        statement_transaction_id: transaction.id,
        classification,
        note: note || null,
        receipt_line_id: nextLineId,
        amount: nextAmount
      }
    });
    await connection.commit();
    res.json({ success: true, data: await serializeReceipt(transaction.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/reconciliations/:lineId/evidence', authenticate, requirePermission('attachment:create'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์หลักฐาน' });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const line = await getReceiptLineContext(connection, Number(req.params.lineId));
    if (!isSettlementChannel(line)) {
      const error = new Error('ช่องทางนี้ไม่ต้องใช้หลักฐาน settlement');
      error.statusCode = 400;
      throw error;
    }
    const isGrabCsv = line.channel_code === 'GRAB' && String(req.file.originalname || '').toLowerCase().endsWith('.csv');
    let grabSettlement = null;
    if (isGrabCsv) {
      const [storeRows] = await connection.query(
        'SELECT grab_store_id, grab_store_name FROM branch_grab_stores WHERE branch_id = ?',
        [line.branch_id]
      );
      if (!storeRows[0]) {
        const error = new Error('ยังไม่ได้ตั้งค่าร้าน Grab สำหรับสาขานี้');
        error.statusCode = 400;
        throw error;
      }
      const groups = parseGrabTransactionReport(fs.readFileSync(req.file.path));
      grabSettlement = findGrabSettlement({
        groups,
        storeId: storeRows[0].grab_store_id,
        receiptDate: line.receipt_date
      });
      if (!grabSettlement) {
        const error = new Error(`ไม่พบยอด Grab ของ ${storeRows[0].grab_store_name} สำหรับวันที่ขาย ${line.receipt_date}`);
        error.statusCode = 400;
        throw error;
      }
    }
    const document = isGrabCsv
      ? { documentPath: null, documentMimeType: null, documentSizeBytes: null, documentStatus: 'not_applicable', documentError: null }
      : await processAttachmentAsDocument(req.file);
    const [fileData, documentData] = await Promise.all([
      fs.promises.readFile(req.file.path),
      document.documentPath ? fs.promises.readFile(document.documentPath).catch(() => null) : null
    ]);
    const [result] = await connection.query(
      `INSERT INTO attachments
        (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
         size_bytes, document_size_bytes, file_data, document_data, document_status, document_error, uploaded_by)
       VALUES (?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        line.receipt_id, req.file.originalname, req.file.path, document.documentPath, req.file.mimetype,
        document.documentMimeType, req.file.size, document.documentSizeBytes, fileData, documentData,
        document.documentStatus, document.documentError, req.user.id
      ]
    );
    if (grabSettlement) {
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET evidence_attachment_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
             settlement_source = 'GRAB_REPORT',
             settlement_date = ?, settlement_status = 'READY_FOR_STATEMENT'
         WHERE receipt_line_id = ?`,
        [result.insertId, grabSettlement.grossAmount, grabSettlement.feeAmount, grabSettlement.netAmount,
          grabSettlement.transferDate, line.id]
      );
    } else {
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET evidence_attachment_id = ?, settlement_status = 'PENDING_EVIDENCE'
         WHERE receipt_line_id = ?`,
        [result.insertId, line.id]
      );
    }
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: grabSettlement ? 'import_grab_settlement_report' : 'upload_settlement_evidence',
      actor: req.user,
      afterPayload: grabSettlement ? { receipt_line_id: line.id, ...grabSettlement } : { receipt_line_id: line.id }
    });
    await connection.commit();
    res.status(201).json({ success: true, data: await serializeReceipt(line.receipt_id) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

const buildStatementPreview = async ({ connection, receiptLineId, receivingAccountId, file }) => {
  const line = await getReceiptLineContext(connection, receiptLineId);
  if (line.receipt_status === 'CLOSED') {
    const error = new Error('เอกสารที่ปิดแล้วไม่สามารถอัปโหลด statement ได้');
    error.statusCode = 409;
    throw error;
  }
  await assertAccountSupportsChannel(connection, receivingAccountId, line.payment_channel_id, line.branch_id);
  const mappingIndex = await getMappingIndex(connection);
  const channel = mappingIndex.channels.find((item) => item.id === line.payment_channel_id);
  const [accountRows] = await connection.query(
    'SELECT account_number FROM receiving_accounts WHERE id = ?',
    [receivingAccountId]
  );
  const parsed = await parseStatementFile({
    buffer: fs.readFileSync(file.path),
    originalName: file.originalname,
    mimeType: file.mimetype
  });
  const rows = parsed.rows;
  const expectedNetAmount = expectedAmountForVerification(line);
  const preview = classifyRowsForChannel({
    rows,
    channel,
    receiptDate: line.receipt_date,
    expectedNetAmount,
    classifyScbOtherIncoming: channel.code === 'PROMPTPAY' && accountRows[0]?.account_number === '4070578401'
  });
  const selectedTotal = roundMoney(preview.rows
    .filter((row) => preview.defaultHashes.includes(row.uniqueHash))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0));
  return {
    line,
    expected_net_amount: expectedNetAmount,
    parsed_rows: preview.rows,
    preview: {
      direct_channel: preview.directChannel,
      source_profile: parsed.profile,
      auto_matched: preview.autoMatched,
      default_hashes: preview.defaultHashes,
      selected_total: selectedTotal,
      rows: preview.rows.map(({ rawPayload, ...row }) => row)
    }
  };
};

app.post('/api/inbox-imports/krungsri', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ ZIP จาก Krungsri' });
  const messageId = String(req.body.message_id || '').trim();
  if (!messageId || messageId.length > 160) {
    return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  }
  const sourceDate = req.body.source_date ? validateDate(req.body.source_date, 'source_date') : null;
  if (!String(req.file.originalname || '').toLowerCase().endsWith('.zip')) {
    return res.status(400).json({ success: false, message: 'รองรับเฉพาะไฟล์ ZIP จาก Krungsri' });
  }

  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount
     FROM bank_inbox_imports
     WHERE provider = 'KRUNGSRIBIZ_MUNGMEE'
       AND (source_message_id = ? OR archive_checksum = ?)
     LIMIT 1`,
    [messageId, checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const parsed = await parseBankReportZip({ buffer: fileData, originalName: req.file.originalname });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount)
       VALUES ('KRUNGSRIBIZ_MUNGMEE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        sourceDate,
        String(req.body.sender_email || '').trim() || null,
        String(req.body.subject || '').trim() || null,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        checksum,
        fileData,
        parsed.fileCount,
        parsed.transactionCount,
        parsed.totalAmount
      ]
    );
    const importId = result.insertId;
    for (const row of parsed.transactions) {
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, source_file_name, transaction_date, description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId,
          row.sourceFileName,
          row.transactionDate,
          row.description || null,
          row.referenceNo || null,
          row.amount,
          row.uniqueHash,
          JSON.stringify(row.rawPayload || {})
        ]
      );
    }
    const autoLink = await autoLinkKrungsriInboxImport(connection, {
      importId,
      originalName: req.file.originalname,
      storedPath: req.file.path,
      mimeType: req.file.mimetype,
      transactions: parsed.transactions,
      evidenceFiles: parsed.files
    });
    const importStatus = autoLink.pendingCount === 0
      ? 'AUTO_LINKED'
      : autoLink.linkedCount > 0
        ? 'PARTIAL_REVIEW'
        : 'PENDING_REVIEW';
    await connection.query('UPDATE bank_inbox_imports SET status = ? WHERE id = ?', [importStatus, importId]);
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: importId,
      action: 'import_krungsri_gmail_zip',
      afterPayload: {
        messageId,
        sourceDate,
        fileName: req.file.originalname,
        checksum,
        fileCount: parsed.fileCount,
        transactionCount: parsed.transactionCount,
        totalAmount: parsed.totalAmount,
        autoLink,
        profiles: parsed.profiles
      }
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      data: {
        id: importId,
        status: importStatus,
        file_count: parsed.fileCount,
        transaction_count: parsed.transactionCount,
        total_amount: parsed.totalAmount,
        auto_linked_count: autoLink.linkedCount,
        pending_count: autoLink.pendingCount,
        profiles: parsed.profiles
      }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

// Krungthai's report is evidence for KTC at Kanklong only and follows the
// transaction date inside the report rather than the following email date.
const attachKrungthaiKtcEvidence = async (connection, { sourceDate, storedPath, originalName, archiveData, parsed }) => {
  const receiptDates = [...new Set(parsed.transactions
    .map((row) => row.receiptDate || row.transactionDate)
    .filter((date) => DATE_PATTERN.test(String(date || ''))))];
  if (receiptDates.length === 0 && sourceDate) receiptDates.push(sourceDate);
  if (receiptDates.length === 0) return { attachedCount: 0, receiptDates: [] };

  const placeholders = receiptDates.map(() => '?').join(', ');
  const [lineRows] = await connection.query(
    `SELECT dr.id AS receipt_id, drl.id AS receipt_line_id
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id AND b.code = 'KK'
     JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'CREDIT_CARD_KTC'
     WHERE dr.receipt_date IN (${placeholders})`,
    receiptDates
  );
  const pdfFiles = (parsed.files || []).filter((file) => file.mimeType === 'application/pdf');
  const files = pdfFiles.length > 0
    ? pdfFiles
    : [{ fileName: originalName, mimeType: 'application/zip', fileData: archiveData }];
  let attachedCount = 0;

  // Older imports used the email date and placed the evidence one day late.
  // Daily Krungthai archives contain one statement date, so move that generated
  // attachment to the receipt identified by the transaction inside the PDF.
  if (lineRows.length === 1) {
    for (const file of files) {
      const attachmentName = `Krungthai KTC - ${file.fileName}`;
      const [targetRows] = await connection.query(
        'SELECT id FROM attachments WHERE receipt_id = ? AND original_name = ? LIMIT 1',
        [lineRows[0].receipt_id, attachmentName]
      );
      if (!targetRows[0]) {
        await connection.query(
          `UPDATE attachments SET receipt_id = ?
           WHERE original_name = ? AND receipt_id <> ?`,
          [lineRows[0].receipt_id, attachmentName, lineRows[0].receipt_id]
        );
      }
    }
  }

  for (const line of lineRows) {
    for (const file of files) {
      const attachmentName = `Krungthai KTC - ${file.fileName}`;
      const [existingRows] = await connection.query(
        'SELECT id FROM attachments WHERE receipt_id = ? AND original_name = ? LIMIT 1',
        [line.receipt_id, attachmentName]
      );
      const isPdf = file.mimeType === 'application/pdf';
      // `attachments.stored_path` is NOT NULL in existing installations. Keep a
      // safe virtual path so the endpoint falls through to the unlocked BLOB,
      // rather than serving the original encrypted ZIP/PDF from disk.
      const unlockedPath = isPdf
        ? path.join(uploadRoot, '.unlocked', `${crypto.createHash('sha256').update(attachmentName).digest('hex')}.pdf`)
        : storedPath;
      if (existingRows[0]) {
        // Older imports retained the password-protected PDF path. Replace only
        // its binary evidence with the unlocked copy produced by bankInbox.
        if (isPdf) {
          await connection.query(
            `UPDATE attachments
             SET stored_path = ?, document_path = ?,
                 mime_type = 'application/pdf', document_mime_type = 'application/pdf',
                 size_bytes = ?, document_size_bytes = ?,
                 file_data = ?, document_data = ?, document_status = 'ready', document_error = NULL
             WHERE id = ?`,
            [unlockedPath, unlockedPath, file.fileData.length, file.fileData.length, file.fileData, file.fileData, existingRows[0].id]
          );
        }
        await connection.query(
          'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
          [existingRows[0].id, line.receipt_line_id]
        );
        continue;
      }

      const [result] = await connection.query(
        `INSERT INTO attachments
          (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
           size_bytes, document_size_bytes, file_data, document_data, document_status)
         VALUES (?, 'statement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.receipt_id,
          attachmentName,
          unlockedPath,
          isPdf ? unlockedPath : null,
          file.mimeType,
          isPdf ? file.mimeType : null,
          file.fileData.length,
          isPdf ? file.fileData.length : null,
          file.fileData,
          isPdf ? file.fileData : null,
          isPdf ? 'ready' : 'not_requested'
        ]
      );
      await connection.query(
        'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
        [result.insertId, line.receipt_line_id]
      );
      attachedCount += 1;
    }
  }
  return { attachedCount, receiptDates };
};

const autoLinkKrungthaiKtcImport = async (connection, { inboxImport, parsed }) => {
  const [accountRows] = await connection.query(
    "SELECT id FROM receiving_accounts WHERE account_number = '4970282439' AND is_active = TRUE LIMIT 1"
  );
  const [channelRows] = await connection.query(
    "SELECT id FROM payment_channels WHERE code = 'CREDIT_CARD_KTC' LIMIT 1"
  );
  const accountId = accountRows[0]?.id;
  const channelId = channelRows[0]?.id;
  if (!accountId || !channelId) return { linkedCount: 0, pendingCount: parsed.transactions.length };

  for (const row of parsed.transactions) {
    await connection.query(
      `INSERT INTO bank_inbox_transactions
        (inbox_import_id, auto_match_status, source_file_name, transaction_date, description,
         reference_no, amount, unique_hash, raw_payload)
       VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE source_file_name = VALUES(source_file_name), transaction_date = VALUES(transaction_date),
         description = VALUES(description), reference_no = VALUES(reference_no), amount = VALUES(amount),
         raw_payload = VALUES(raw_payload)`,
      [
        inboxImport.id, row.sourceFileName, row.transactionDate, row.description || null,
        row.referenceNo || null, row.amount, row.uniqueHash, JSON.stringify(row.rawPayload || {})
      ]
    );
  }

  const grouped = new Map();
  for (const row of parsed.transactions) {
    if (!row.transactionDate) continue;
    const [candidateLines] = await connection.query(
      `SELECT dr.receipt_date, drl.cashier_amount
       FROM daily_receipts dr
       JOIN branches b ON b.id = dr.branch_id AND b.code = 'KK'
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
       WHERE dr.receipt_date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ?
         AND drl.payment_channel_id = ? AND dr.status <> 'CLOSED'`,
      [row.transactionDate, row.transactionDate, channelId]
    );
    const plausibleCandidates = candidateLines
      .map((candidate) => ({
        ...candidate,
        comparison: deriveKtcSettlementComparison({
          cashierAmount: candidate.cashier_amount,
          bankAmount: row.amount
        })
      }))
      .filter((candidate) => candidate.comparison.canInferFee)
      .sort((left, right) => {
        const leftRate = left.comparison.feeAmount / Number(left.comparison.grossAmount || 1);
        const rightRate = right.comparison.feeAmount / Number(right.comparison.grossAmount || 1);
        return Math.abs(leftRate - 0.025) - Math.abs(rightRate - 0.025);
      });
    row.receiptDate = plausibleCandidates[0]?.receipt_date || row.transactionDate;
    const group = grouped.get(row.receiptDate) || [];
    group.push(row);
    grouped.set(row.receiptDate, group);
  }

  let linkedCount = 0;
  for (const [receiptDate, rows] of grouped) {
    const [lines] = await connection.query(
      `SELECT dr.id AS receipt_id, dr.status AS receipt_status,
              drl.id AS receipt_line_id, drl.cashier_amount, drl.expected_amount
       FROM daily_receipts dr
       JOIN branches b ON b.id = dr.branch_id AND b.code = 'KK'
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
       WHERE dr.receipt_date = ? AND drl.payment_channel_id = ?`,
      [receiptDate, channelId]
    );
    if (lines.length !== 1) continue;

    const line = lines[0];
    const grossAmount = roundMoney(line.cashier_amount || 0);
    const netAmount = roundMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const settlementDate = rows.map((row) => row.transactionDate).sort().at(-1) || receiptDate;
    if (netAmount <= 0) continue;
    const settlement = deriveKtcSettlementComparison({ cashierAmount: grossAmount, bankAmount: netAmount });

    const newRows = [];
    for (const row of rows) {
      const [existingTransactionRows] = await connection.query(
        `SELECT st.id, st.receipt_id, st.receipt_line_id, dr.status AS receipt_status
         FROM statement_transactions st
         JOIN daily_receipts dr ON dr.id = st.receipt_id
         WHERE st.receiving_account_id = ? AND st.payment_channel_id = ?
           AND st.transaction_date = ? AND st.amount = ?
           AND (
             st.reference_no <=> ? OR (
               JSON_UNQUOTE(JSON_EXTRACT(st.raw_payload, '$.Time')) <=> ?
               AND JSON_UNQUOTE(JSON_EXTRACT(st.raw_payload, '$.Description')) <=> ?
             )
           )
           AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')
         ORDER BY st.id ASC LIMIT 1`,
        [accountId, channelId, row.transactionDate, row.amount, row.referenceNo || null,
          row.rawPayload?.Time || null, row.rawPayload?.Description || null]
      );
      const existingTransaction = existingTransactionRows[0];
      if (existingTransaction) {
        if (Number(existingTransaction.receipt_line_id) !== Number(line.receipt_line_id)
          && existingTransaction.receipt_status !== 'CLOSED'
          && line.receipt_status !== 'CLOSED') {
          await connection.query(
            'UPDATE statement_transactions SET receipt_id = ?, receipt_line_id = ? WHERE id = ?',
            [line.receipt_id, line.receipt_line_id, existingTransaction.id]
          );
        }
        await connection.query(
          `UPDATE bank_inbox_transactions
           SET receipt_line_id = ?, auto_match_status = 'DUPLICATE'
           WHERE inbox_import_id = ? AND unique_hash = ?`,
          [line.receipt_line_id, inboxImport.id, row.uniqueHash]
        );
        linkedCount += 1;
      } else {
        newRows.push(row);
      }
    }

    // Closed receipts keep their historical financial snapshot. Exact rows are
    // still marked as duplicates, while genuinely new rows remain pending review.
    if (line.receipt_status === 'CLOSED') continue;

    const importName = `${inboxImport.original_name} (KTC auto)`;
    if (newRows.length > 0) {
      const newRowsTotal = roundMoney(newRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
      const [result] = await connection.query(
        `INSERT INTO statement_imports
          (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [line.receipt_id, channelId, accountId, importName, inboxImport.stored_path,
          inboxImport.mime_type, newRows.length, newRowsTotal]
      );
      for (const row of newRows) {
        const statementHash = crypto.createHash('sha256').update(`krungthai-ktc:${row.uniqueHash}`).digest('hex');
        await connection.query(
          `INSERT INTO statement_transactions
            (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
             description, reference_no, amount, unique_hash, raw_payload, match_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched_auto')`,
          [result.insertId, line.receipt_id, line.receipt_line_id, accountId, channelId,
            row.transactionDate, row.description || null, row.referenceNo || null, row.amount,
            statementHash, JSON.stringify(row.rawPayload || {})]
        );
        await connection.query(
          `UPDATE bank_inbox_transactions
           SET receipt_line_id = ?, auto_match_status = 'LINKED'
           WHERE inbox_import_id = ? AND unique_hash = ?`,
          [line.receipt_line_id, inboxImport.id, row.uniqueHash]
        );
        linkedCount += 1;
      }
    }

    const matchedAmount = await recalculateStatementAmount(connection, line.receipt_line_id);
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
           settlement_source = ?, matched_amount = ?, settlement_date = ?, settlement_status = ?,
           cashier_reference_variance_amount = 0, settlement_variance_amount = ?,
           exception_category = NULL, exception_note = NULL
       WHERE receipt_line_id = ?`,
      [accountId, settlement.grossAmount, settlement.feeAmount, settlement.expectedNetAmount,
        settlement.settlementSource, matchedAmount, settlementDate, settlement.settlementStatus,
        settlement.settlementVarianceAmount, line.receipt_line_id]
    );
    await connection.query(
      `UPDATE daily_receipt_lines
       SET statement_amount = ?, variance_amount = ?
       WHERE id = ?`,
      [matchedAmount, settlement.settlementVarianceAmount, line.receipt_line_id]
    );
  }

  const pendingCount = Math.max(parsed.transactions.length - linkedCount, 0);
  await connection.query(
    `UPDATE bank_inbox_imports
     SET file_count = ?, transaction_count = ?, total_amount = ?, status = ?
     WHERE id = ?`,
    [parsed.fileCount, parsed.transactionCount, parsed.totalAmount, pendingCount === 0 && linkedCount > 0 ? 'AUTO_LINKED' : 'PENDING_REVIEW', inboxImport.id]
  );
  return { linkedCount, pendingCount };
};

const repairLegacyKrungthaiKtcAttachments = async () => {
  const [imports] = await getPool().query(
    `SELECT id, source_date, original_name, stored_path, mime_type, file_data
     FROM bank_inbox_imports
     WHERE provider = 'KRUNGTHAI_BUSINESS' AND file_data IS NOT NULL
     ORDER BY id ASC`
  );
  for (const inboxImport of imports) {
    const connection = await getPool().getConnection();
    try {
      const parsed = await parseBankReportFile({
        buffer: inboxImport.file_data,
        originalName: inboxImport.original_name,
        password: config.krungthaiBusinessZipPassword
      });
      await connection.beginTransaction();
      const reconciliation = await autoLinkKrungthaiKtcImport(connection, { inboxImport, parsed });
      const evidence = await attachKrungthaiKtcEvidence(connection, {
        sourceDate: inboxImport.source_date ? String(inboxImport.source_date).slice(0, 10) : null,
        storedPath: inboxImport.stored_path,
        originalName: inboxImport.original_name,
        archiveData: inboxImport.file_data,
        parsed
      });
      if (evidence.attachedCount > 0 || reconciliation.linkedCount > 0) {
        await logAudit({
          connection,
          entityType: 'bank_inbox_import',
          entityId: inboxImport.id,
          action: 'attach_krungthai_ktc_evidence',
          afterPayload: { ...evidence, reconciliation }
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error('Unable to attach Krungthai KTC evidence', { importId: inboxImport.id, error });
    } finally {
      connection.release();
    }
  }
};

const repairDuplicateKrungthaiKtcTransactions = async () => {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT st.id, st.import_id, st.receipt_id, st.receipt_line_id, st.transaction_date,
              st.amount, st.description, st.raw_payload, dr.receipt_date, dr.status AS receipt_status,
              drl.cashier_amount
       FROM statement_transactions st
       JOIN daily_receipts dr ON dr.id = st.receipt_id
       JOIN daily_receipt_lines drl ON drl.id = st.receipt_line_id
       JOIN payment_channels pc ON pc.id = st.payment_channel_id AND pc.code = 'CREDIT_CARD_KTC'
       JOIN receiving_accounts ra ON ra.id = st.receiving_account_id AND ra.account_number = '4970282439'
       WHERE st.match_status IN ('classified', 'matched_auto', 'matched_manual')
       ORDER BY st.id ASC`
    );
    const groups = new Map();
    for (const row of rows) {
      let rawPayload = row.raw_payload || {};
      if (typeof rawPayload === 'string') {
        try { rawPayload = JSON.parse(rawPayload); } catch { rawPayload = {}; }
      }
      const time = String(rawPayload.Time || '').trim();
      const description = String(rawPayload.Description || row.description || '').replace(/\s+/g, ' ').trim();
      const fingerprint = `${row.transaction_date}|${roundMoney(row.amount).toFixed(2)}|${time}|${description}`;
      const group = groups.get(fingerprint) || [];
      group.push({ ...row, rawPayload });
      groups.set(fingerprint, group);
    }

    const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
    if (duplicateGroups.length === 0) return { removedCount: 0 };

    await connection.beginTransaction();
    const affectedLineIds = new Set();
    const affectedReceiptIds = new Set();
    const importIds = new Set();
    let removedCount = 0;
    for (const group of duplicateGroups) {
      const sorted = [...group].sort((left, right) => {
        const leftPlausible = deriveKtcSettlementComparison({ cashierAmount: left.cashier_amount, bankAmount: left.amount }).canInferFee;
        const rightPlausible = deriveKtcSettlementComparison({ cashierAmount: right.cashier_amount, bankAmount: right.amount }).canInferFee;
        if (leftPlausible !== rightPlausible) return leftPlausible ? -1 : 1;
        return Number(left.id) - Number(right.id);
      });
      const keeper = sorted[0];
      affectedLineIds.add(Number(keeper.receipt_line_id));
      affectedReceiptIds.add(Number(keeper.receipt_id));
      for (const duplicate of sorted.slice(1)) {
        if (duplicate.receipt_status === 'CLOSED') continue;
        affectedLineIds.add(Number(duplicate.receipt_line_id));
        affectedReceiptIds.add(Number(duplicate.receipt_id));
        importIds.add(Number(duplicate.import_id));
        await connection.query('DELETE FROM statement_transactions WHERE id = ?', [duplicate.id]);
        removedCount += 1;
      }
    }

    for (const receiptLineId of affectedLineIds) {
      const [lineRows] = await connection.query(
        `SELECT drl.receipt_id, drl.cashier_amount, dr.status AS receipt_status
         FROM daily_receipt_lines drl
         JOIN daily_receipts dr ON dr.id = drl.receipt_id
         WHERE drl.id = ?`,
        [receiptLineId]
      );
      const line = lineRows[0];
      if (!line || line.receipt_status === 'CLOSED') continue;
      const matchedAmount = await recalculateStatementAmount(connection, receiptLineId);
      const comparison = deriveKtcSettlementComparison({
        cashierAmount: line.cashier_amount,
        bankAmount: matchedAmount
      });
      const [dateRows] = await connection.query(
        'SELECT MAX(transaction_date) AS settlement_date FROM statement_transactions WHERE receipt_line_id = ?',
        [receiptLineId]
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?, settlement_source = ?,
             matched_amount = ?, settlement_date = ?, settlement_status = ?,
             cashier_reference_variance_amount = 0, settlement_variance_amount = ?
         WHERE receipt_line_id = ?`,
        [comparison.grossAmount, comparison.feeAmount, comparison.expectedNetAmount,
          comparison.settlementSource, matchedAmount, dateRows[0]?.settlement_date || null,
          comparison.settlementStatus, comparison.settlementVarianceAmount, receiptLineId]
      );
      await connection.query(
        'UPDATE daily_receipt_lines SET statement_amount = ?, variance_amount = ? WHERE id = ?',
        [matchedAmount, comparison.settlementVarianceAmount, receiptLineId]
      );
    }
    for (const importId of importIds) {
      await connection.query(
        `DELETE FROM statement_imports
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM statement_transactions WHERE import_id = ?)`,
        [importId, importId]
      );
    }
    for (const receiptId of affectedReceiptIds) {
      await logAudit({
        connection,
        entityType: 'daily_receipt',
        entityId: receiptId,
        action: 'repair_duplicate_krungthai_ktc_transaction',
        afterPayload: { removed_count: removedCount }
      });
    }
    await connection.commit();
    return { removedCount };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const repairGroupedKrungthaiKtcSettlements = async () => {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT dr.receipt_date, dr.status AS receipt_status, dr.id AS receipt_id,
              drl.id AS receipt_line_id, drl.cashier_amount,
              rlr.matched_amount, rlr.settlement_batch_key
       FROM daily_receipts dr
       JOIN branches b ON b.id = dr.branch_id AND b.code = 'KK'
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
       JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'CREDIT_CARD_KTC'
       JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
       WHERE dr.status <> 'CLOSED' AND drl.cashier_amount > 0 AND rlr.matched_amount > 0
       ORDER BY dr.receipt_date ASC`
    );
    const usedLineIds = new Set();
    const groups = [];
    for (let index = 0; index < rows.length - 1; index += 1) {
      const first = rows[index];
      const second = rows[index + 1];
      if (usedLineIds.has(first.receipt_line_id) || usedLineIds.has(second.receipt_line_id)) continue;
      const dayGap = (new Date(`${second.receipt_date}T00:00:00Z`) - new Date(`${first.receipt_date}T00:00:00Z`)) / 86400000;
      if (dayGap !== 1) continue;
      const firstComparison = deriveKtcSettlementComparison({ cashierAmount: first.cashier_amount, bankAmount: first.matched_amount });
      const secondComparison = deriveKtcSettlementComparison({ cashierAmount: second.cashier_amount, bankAmount: second.matched_amount });
      if (firstComparison.canInferFee || secondComparison.canInferFee) continue;

      const grossAmount = roundMoney(Number(first.cashier_amount) + Number(second.cashier_amount));
      const netAmount = roundMoney(Number(first.matched_amount) + Number(second.matched_amount));
      const combined = deriveKtcSettlementComparison({ cashierAmount: grossAmount, bankAmount: netAmount });
      const feeRate = grossAmount > 0 ? combined.feeAmount / grossAmount : 0;
      if (!combined.canInferFee || feeRate < 0.015 || feeRate > 0.04) continue;

      groups.push({ first, second, grossAmount, netAmount, feeAmount: combined.feeAmount });
      usedLineIds.add(first.receipt_line_id);
      usedLineIds.add(second.receipt_line_id);
    }
    if (groups.length === 0) return { groupedCount: 0 };

    await connection.beginTransaction();
    for (const group of groups) {
      const batchKey = `KTC-KK-${group.first.receipt_date}-${group.second.receipt_date}`;
      const firstFee = roundMoney(group.feeAmount * Number(group.first.cashier_amount) / group.grossAmount);
      const secondFee = roundMoney(group.feeAmount - firstFee);
      const allocations = [
        { row: group.first, feeAmount: firstFee },
        { row: group.second, feeAmount: secondFee }
      ];
      const note = `กระทบยอด KTC รวม ${group.first.receipt_date} ถึง ${group.second.receipt_date}: ยอดขาย ${group.grossAmount.toFixed(2)} ค่าธรรมเนียม ${group.feeAmount.toFixed(2)} เงินเข้า ${group.netAmount.toFixed(2)}`;
      for (const allocation of allocations) {
        const allocatedNetAmount = roundMoney(Number(allocation.row.cashier_amount) - allocation.feeAmount);
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET settlement_source = 'BANK_SETTLEMENT', settlement_status = 'MATCHED_MANUAL',
               cashier_reference_variance_amount = 0, settlement_variance_amount = 0,
               settlement_batch_key = ?, settlement_batch_start_date = ?, settlement_batch_end_date = ?,
               settlement_batch_gross_amount = ?, settlement_batch_fee_amount = ?,
               settlement_batch_net_amount = ?, settlement_batch_variance_amount = 0,
               settlement_batch_allocated_fee_amount = ?, settlement_batch_allocated_net_amount = ?,
               exception_category = 'OTHER', exception_note = ?
           WHERE receipt_line_id = ?`,
          [batchKey, group.first.receipt_date, group.second.receipt_date, group.grossAmount,
            group.feeAmount, group.netAmount, allocation.feeAmount, allocatedNetAmount,
            note, allocation.row.receipt_line_id]
        );
        await connection.query(
          'UPDATE daily_receipt_lines SET variance_amount = 0, variance_reason = ? WHERE id = ?',
          [note, allocation.row.receipt_line_id]
        );
        await logAudit({
          connection,
          entityType: 'daily_receipt',
          entityId: allocation.row.receipt_id,
          action: 'group_krungthai_ktc_settlement',
          afterPayload: {
            batch_key: batchKey,
            batch_gross_amount: group.grossAmount,
            batch_fee_amount: group.feeAmount,
            batch_net_amount: group.netAmount,
            bank_amount_for_date: roundMoney(allocation.row.matched_amount),
            allocated_fee_amount: allocation.feeAmount,
            allocated_net_amount: allocatedNetAmount
          },
          note
        });
      }
    }
    await connection.commit();
    return { groupedCount: groups.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

app.post('/api/inbox-imports/krungthai-business', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !/\.(zip|pdf)$/i.test(req.file.originalname || '')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ ZIP หรือ PDF จาก Krungthai Business' });
  }
  const messageId = String(req.body.message_id || '').trim();
  if (!messageId || messageId.length > 160) {
    return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  }

  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount
     FROM bank_inbox_imports
     WHERE provider = 'KRUNGTHAI_BUSINESS'
       AND (source_message_id = ? OR archive_checksum = ?)
     LIMIT 1`,
    [messageId, checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const sourceDate = req.body.source_date ? validateDate(req.body.source_date, 'source_date') : null;
  const parsed = await parseBankReportFile({
    buffer: fileData,
    originalName: req.file.originalname,
    password: config.krungthaiBusinessZipPassword
  });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('KRUNGTHAI_BUSINESS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')`,
      [
        messageId,
        sourceDate,
        String(req.body.sender_email || '').trim() || null,
        String(req.body.subject || '').trim() || null,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        checksum,
        fileData,
        parsed.fileCount,
        parsed.transactionCount,
        parsed.totalAmount
      ]
    );
    for (const row of parsed.transactions) {
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, auto_match_status, source_file_name, transaction_date, description,
           reference_no, amount, unique_hash, raw_payload)
         VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          row.sourceFileName,
          row.transactionDate,
          row.description || null,
          row.referenceNo || null,
          row.amount,
          row.uniqueHash,
          JSON.stringify(row.rawPayload || {})
        ]
      );
    }
    const reconciliation = await autoLinkKrungthaiKtcImport(connection, {
      inboxImport: {
        id: result.insertId,
        original_name: req.file.originalname,
        stored_path: req.file.path,
        mime_type: req.file.mimetype
      },
      parsed
    });
    const evidence = await attachKrungthaiKtcEvidence(connection, {
      sourceDate,
      storedPath: req.file.path,
      originalName: req.file.originalname,
      archiveData: fileData,
      parsed
    });
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: result.insertId,
      action: 'import_krungthai_business_gmail_zip',
      afterPayload: {
        messageId,
        fileName: req.file.originalname,
        checksum,
        fileCount: parsed.fileCount,
        transactionCount: parsed.transactionCount,
        totalAmount: parsed.totalAmount,
        profiles: parsed.profiles,
        evidence,
        reconciliation
      }
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        status: reconciliation.pendingCount === 0 && reconciliation.linkedCount > 0 ? 'AUTO_LINKED' : 'PENDING_REVIEW',
        file_count: parsed.fileCount,
        transaction_count: parsed.transactionCount,
        total_amount: parsed.totalAmount,
        profiles: parsed.profiles,
        evidence_attached_count: evidence.attachedCount,
        linked_transaction_count: reconciliation.linkedCount
      }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/inbox-imports/grab', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !String(req.file.originalname || '').toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบรายงาน Grab รูปแบบ PDF' });
  }
  const messageId = String(req.body.message_id || '').trim();
  if (!messageId || messageId.length > 160) {
    return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  }
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'GRAB_DAILY' AND (source_message_id = ? OR archive_checksum = ?) LIMIT 1`,
    [messageId, checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const report = await parseGrabDailyReport(fileData, req.file.originalname);
  const reportPayload = grabReportFinancialPayload(report);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [lineRows] = report.storeId
      ? await connection.query(
        `SELECT dr.id AS receipt_id, drl.id AS receipt_line_id, dr.branch_id,
                drl.cashier_amount, drl.statement_amount
         FROM branch_grab_stores bgs
         JOIN daily_receipts dr ON dr.branch_id = bgs.branch_id AND dr.receipt_date = ? AND dr.status <> 'CLOSED'
         JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
         JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'GRAB'
         WHERE bgs.grab_store_id = ?`,
        [report.salesDate, report.storeId]
      )
      : [[]];
    const line = lineRows[0];
    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount)
       VALUES ('GRAB_DAILY', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [
        messageId, report.salesDate, String(req.body.sender_email || '').trim() || null,
        String(req.body.subject || '').trim() || null, req.file.originalname, req.file.path, req.file.mimetype,
        checksum, fileData, report.netAmount
      ]
    );
    const inboxImportId = importResult.insertId;
    let attachmentId = null;
    if (line) {
      const [attachmentResult] = await connection.query(
        `INSERT INTO attachments
          (receipt_id, attachment_type, original_name, stored_path, document_path, mime_type, document_mime_type,
           size_bytes, document_size_bytes, file_data, document_data, document_status)
         VALUES (?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
        [
          line.receipt_id, req.file.originalname, req.file.path, req.file.path, req.file.mimetype,
          req.file.mimetype, req.file.size, req.file.size, fileData, fileData
        ]
      );
      attachmentId = attachmentResult.insertId;
      const [accountRows] = await connection.query(
        `SELECT ra.id FROM receiving_accounts ra
         JOIN receiving_account_channels rac ON rac.receiving_account_id = ra.id
         JOIN payment_channels pc ON pc.id = rac.payment_channel_id AND pc.code = 'GRAB'
         WHERE ra.account_number = '0308663108' LIMIT 1`
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET evidence_attachment_id = ?, receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?,
             settlement_source = 'GRAB_REPORT',
             expected_net_amount = ?, settlement_date = DATE_ADD(?, INTERVAL 1 DAY), settlement_status = 'READY_FOR_STATEMENT'
         WHERE receipt_line_id = ?`,
        [attachmentId, accountRows[0]?.id || null, report.cashierAmount, report.feeAmount, report.netAmount, report.salesDate, line.receipt_line_id]
      );
      await connection.query('UPDATE daily_receipt_lines SET expected_amount = ? WHERE id = ?', [report.cashierAmount, line.receipt_line_id]);
      const cashierAmount = roundMoney(line.cashier_amount || 0);
      const reportAmount = roundMoney(report.cashierAmount || 0);
      if (cashierAmount > 0 && cashierAmount === reportAmount && roundMoney(line.statement_amount || 0) === 0) {
        await connection.query(
          'UPDATE daily_receipt_lines SET statement_amount = ?, variance_amount = 0, variance_reason = NULL WHERE id = ?',
          [report.netAmount, line.receipt_line_id]
        );
        await connection.query(
          `UPDATE receipt_line_reconciliations
           SET matched_amount = ?, settlement_status = 'MATCHED_AUTO'
           WHERE receipt_line_id = ?`,
          [report.netAmount, line.receipt_line_id]
        );
      }
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date, description,
           amount, unique_hash, raw_payload)
         VALUES (?, ?, 'LINKED', ?, ?, ?, ?, ?, ?)`,
        [
          inboxImportId, line.receipt_line_id, req.file.originalname, report.salesDate, 'Grab daily settlement report',
          report.netAmount, crypto.createHash('sha256').update(`${checksum}:${line.receipt_line_id}`).digest('hex'),
          JSON.stringify(reportPayload)
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, auto_match_status, source_file_name, transaction_date, description, amount, unique_hash, raw_payload)
         VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
        [
          inboxImportId, req.file.originalname, report.salesDate, 'Grab daily settlement report', report.netAmount,
          crypto.createHash('sha256').update(checksum).digest('hex'),
          JSON.stringify(reportPayload)
        ]
      );
    }
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_grab_gmail_pdf',
      afterPayload: { ...report, receipt_line_id: line?.receipt_line_id || null, attachment_id: attachmentId }
    });
    await connection.query(
      'UPDATE bank_inbox_imports SET status = ? WHERE id = ?',
      [line ? 'AUTO_LINKED' : 'PENDING_REVIEW', inboxImportId]
    );
    await connection.commit();
    res.status(201).json({
      success: true,
      data: { id: inboxImportId, linked: Boolean(line), receipt_line_id: line?.receipt_line_id || null, ...report }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

const KASIKORN_MONTHLY_BRANCHES = Object.freeze({
  KK: { accountNumber: '0308663108' },
  SK: { accountNumber: '1763147866' }
});

const compactBankAccount = (value) => String(value || '').replace(/\D/g, '');
const isKasikornMonthlyEvidence = (file) =>
  ['.pdf', '.csv'].includes(path.extname(String(file?.originalname || '').toLowerCase()));
const kasikornStatementAccountNumbers = (parsed, rows) => new Set([
  parsed?.metadata?.accountNumber,
  ...(rows || []).map((row) => row.referenceNo)
].map(compactBankAccount).filter((value) => value.length >= 10));
const merchantIdFromKasikornRow = (row) => String(row?.description || '').match(/\b(KB\d+)\b/)?.[1] || '';

const previousIsoDate = (value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

app.post('/api/inbox-imports/kbank-monthly', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !isKasikornMonthlyEvidence(req.file)) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบ statement กสิกรรูปแบบ PDF หรือ CSV' });
  }
  const branchCode = String(req.body.branch_code || '').trim().toUpperCase();
  const branchConfig = KASIKORN_MONTHLY_BRANCHES[branchCode];
  if (!branchConfig) {
    return res.status(400).json({ success: false, message: 'branch_code ต้องเป็น KK หรือ SK' });
  }
  const monthRange = parseMonthRange(req.body.month);
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const parsed = await parseStatementFile({
    buffer: fileData,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/pdf'
  });
  const qrRows = parsed.rows
    .filter((row) => row.description.includes('EDC/K SHOP/MYQR'))
    .map((row) => ({ ...row, merchantId: merchantIdFromKasikornRow(row) }));
  const alipayWeChatRows = parsed.rows
    .filter((row) => /ALIPAY_WECHAT|Alipay|WeChat/i.test(row.description))
    .map((row) => ({ ...row, saleDate: previousIsoDate(row.transactionDate) }));
  if (qrRows.length === 0 || qrRows.some((row) => !row.merchantId)) {
    return res.status(422).json({ success: false, message: 'ไม่พบรายการ Thai QR Payment ที่มีรหัสร้านค้าในไฟล์' });
  }
  const accountNumbers = kasikornStatementAccountNumbers(parsed, qrRows);
  if (accountNumbers.size !== 1 || !accountNumbers.has(branchConfig.accountNumber)) {
    return res.status(422).json({
      success: false,
      message: `เลขบัญชีในไฟล์ไม่ตรงกับสาขา ${branchCode}`
    });
  }
  if (qrRows.some((row) => !row.transactionDate?.startsWith(`${monthRange.month}-`))) {
    return res.status(422).json({ success: false, message: 'วันที่รายการ QR ในไฟล์ไม่ตรงกับเดือนที่ระบุ' });
  }
  if (alipayWeChatRows.some((row) => !row.transactionDate?.startsWith(`${monthRange.month}-`))) {
    return res.status(422).json({ success: false, message: 'วันที่รายการ Alipay/WeChat ในไฟล์ไม่ตรงกับเดือนที่ระบุ' });
  }

  const rowsByDate = new Map(monthRange.days.map((date) => [date, []]));
  for (const row of qrRows) rowsByDate.get(row.transactionDate)?.push(row);
  const dailyTotals = monthRange.days.map((date) => ({
    business_date: date,
    amount: roundMoney((rowsByDate.get(date) || []).reduce((sum, row) => sum + row.amount, 0))
  }));
  const statementTotal = roundMoney(dailyTotals.reduce((sum, row) => sum + row.amount, 0));
  const alipayWeChatTotal = roundMoney(alipayWeChatRows.reduce((sum, row) => sum + row.amount, 0));
  const preview = {
    branch_code: branchCode,
    account_number: branchConfig.accountNumber,
    month: monthRange.month,
    transaction_count: qrRows.length,
    total_amount: statementTotal,
    merchants: [...new Set(qrRows.map((row) => row.merchantId))],
    daily_totals: dailyTotals,
    alipay_wechat_transaction_count: alipayWeChatRows.length,
    alipay_wechat_total_amount: alipayWeChatTotal,
    alipay_wechat_settlements: alipayWeChatRows.map((row) => ({
      sale_date_suggested: row.saleDate,
      settlement_date: row.transactionDate,
      amount: row.amount,
      status: 'PENDING_GROSS_MATCH'
    }))
  };
  if (String(req.body.dry_run || '').toLowerCase() === 'true') {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, dry_run: true, data: preview });
  }

  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'KASIKORN_MONTHLY_STATEMENT' AND archive_checksum = ? LIMIT 1`,
    [checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [resourceRows] = await connection.query(
      `SELECT b.id AS branch_id, pc.id AS payment_channel_id, ra.id AS receiving_account_id
       FROM branches b
       JOIN payment_channels pc ON pc.code = 'QR_KPLUS'
       JOIN receiving_accounts ra ON ra.branch_id = b.id AND ra.account_number = ? AND ra.is_active = TRUE
       WHERE b.code = ?`,
      [branchConfig.accountNumber, branchCode]
    );
    const resources = resourceRows[0];
    if (!resources) {
      const error = new Error(`ไม่พบบัญชีรับเงิน QR ของสาขา ${branchCode}`);
      error.statusCode = 422;
      throw error;
    }
    const [merchantMappingRows] = await connection.query(
      `SELECT merchant_id, is_primary
       FROM bank_merchant_mappings
       WHERE provider = 'KPLUSSHOP' AND branch_id = ? AND payment_channel_id = ? AND is_active = TRUE`,
      [resources.branch_id, resources.payment_channel_id]
    );
    const primaryMerchantIds = new Set(
      merchantMappingRows.filter((row) => Boolean(row.is_primary)).map((row) => row.merchant_id)
    );
    const [lineRows] = await connection.query(
      `SELECT dr.id AS receipt_id, dr.receipt_date, dr.status, drl.id AS receipt_line_id, drl.cashier_amount
       FROM daily_receipts dr
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id AND drl.payment_channel_id = ?
       WHERE dr.branch_id = ? AND dr.receipt_date BETWEEN ? AND ?`,
      [resources.payment_channel_id, resources.branch_id, monthRange.from, monthRange.to]
    );
    const linesByDate = new Map(lineRows.map((row) => [String(row.receipt_date).slice(0, 10), row]));
    const missingDates = monthRange.days.filter((date) => !linesByDate.has(date));
    if (missingDates.length > 0) {
      const error = new Error(`ขาดเอกสาร QR ${branchCode}: ${missingDates.join(', ')}`);
      error.statusCode = 422;
      throw error;
    }

    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('KASIKORN_MONTHLY_STATEMENT', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        checksum, monthRange.from, `KBank monthly QR ${branchCode} ${monthRange.month}`,
        req.file.originalname, req.file.path, req.file.mimetype || 'application/pdf', checksum, fileData,
        qrRows.length + alipayWeChatRows.length, roundMoney(statementTotal + alipayWeChatTotal),
        alipayWeChatRows.length > 0 ? 'PARTIAL_REVIEW' : 'AUTO_LINKED'
      ]
    );
    const inboxImportId = importResult.insertId;
    let insertedStatementRows = 0;
    let reusedStatementRows = 0;

    for (const date of monthRange.days) {
      const line = linesByDate.get(date);
      const dateRows = rowsByDate.get(date) || [];
      const importRows = [];
      for (const row of dateRows) {
        const isPrimaryMerchant = primaryMerchantIds.has(row.merchantId);
        const stableHash = crypto.createHash('sha256')
          .update(`kbank-monthly:${checksum}:${date}:${row.merchantId}:${row.rawPayload?.['เวลา'] || ''}:${row.amount}`)
          .digest('hex');
        await connection.query(
          `INSERT INTO bank_inbox_transactions
            (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
             description, reference_no, amount, unique_hash, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [inboxImportId, isPrimaryMerchant ? line.receipt_line_id : null,
            isPrimaryMerchant ? 'LINKED' : 'PENDING', req.file.originalname, date,
            row.description, row.merchantId, row.amount, stableHash, JSON.stringify(row.rawPayload || {})]
        );
        const [matchedRows] = await connection.query(
          `SELECT id FROM statement_transactions
           WHERE receipt_id = ? AND transaction_date = ? AND reference_no = ? AND amount = ? LIMIT 1`,
          [line.receipt_id, date, row.merchantId, row.amount]
        );
        if (matchedRows[0]) {
          reusedStatementRows += 1;
        } else {
          importRows.push({ ...row, stableHash, isPrimaryMerchant });
        }
      }

      if (dateRows.length === 0) {
        const [matchedRows] = await connection.query(
          `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM statement_transactions
           WHERE receipt_line_id = ? AND match_status IN ('classified', 'matched_auto', 'matched_manual')`,
          [line.receipt_line_id]
        );
        if (roundMoney(matchedRows[0]?.amount || 0) !== 0) {
          const error = new Error(`statement ระบุยอด 0 แต่ระบบมียอดอยู่แล้วในวันที่ ${date}`);
          error.statusCode = 409;
          throw error;
        }
        if (Number(matchedRows[0]?.count || 0) === 0) {
          const stableHash = crypto.createHash('sha256')
            .update(`kbank-monthly:${checksum}:${date}:CLOSED_ZERO`)
            .digest('hex');
          importRows.push({ merchantId: 'KASIKORN_CLOSED_ZERO', amount: 0, description: 'KBank monthly statement: no Thai QR Payment', rawPayload: { business_date: date, closed_zero: true }, stableHash, isPrimaryMerchant: true });
          await connection.query(
            `INSERT INTO bank_inbox_transactions
              (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
               description, reference_no, amount, unique_hash, raw_payload)
             VALUES (?, ?, 'LINKED', ?, ?, 'KBank monthly statement: no Thai QR Payment',
                     'KASIKORN_CLOSED_ZERO', 0, ?, ?)`,
            [inboxImportId, line.receipt_line_id, req.file.originalname, date, stableHash,
              JSON.stringify({ business_date: date, closed_zero: true })]
          );
        } else {
          reusedStatementRows += 1;
        }
      }

      if (importRows.length > 0) {
        const importTotal = roundMoney(importRows.reduce((sum, row) => sum + row.amount, 0));
        const [statementImport] = await connection.query(
          `INSERT INTO statement_imports
            (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [line.receipt_id, resources.payment_channel_id, resources.receiving_account_id,
            `${req.file.originalname} (monthly QR closed)`, req.file.path, req.file.mimetype || 'application/pdf',
            importRows.length, importTotal]
        );
        for (const row of importRows) {
          await connection.query(
            `INSERT INTO statement_transactions
              (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
               description, reference_no, amount, unique_hash, raw_payload, match_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [statementImport.insertId, line.receipt_id, row.isPrimaryMerchant ? line.receipt_line_id : null, resources.receiving_account_id,
              resources.payment_channel_id, date, row.description, row.merchantId, row.amount,
              row.stableHash, JSON.stringify({ ...(row.rawPayload || {}), review_classification: row.isPrimaryMerchant ? 'primary_merchant' : 'pending_secondary_merchant' }),
              row.isPrimaryMerchant ? 'matched_auto' : 'unmatched']
          );
          insertedStatementRows += 1;
        }
      }

      await connection.query(
        'INSERT IGNORE INTO receipt_line_reconciliations (receipt_line_id) VALUES (?)',
        [line.receipt_line_id]
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET receiving_account_id = ?, settlement_date = ?
         WHERE receipt_line_id = ?`,
        [resources.receiving_account_id, date, line.receipt_line_id]
      );
      await refreshKasikornMonthlyQrComparison(connection, line.receipt_line_id);
      const evidence = await attachImportedEvidence(connection, {
        receiptId: line.receipt_id,
        sourceLabel: 'QR กสิกร',
        files: [{
          fileName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/octet-stream',
          fileData
        }]
      });
      if (evidence.attachmentIds[0]) {
        await connection.query(
          'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
          [evidence.attachmentIds[0], line.receipt_line_id]
        );
      }
    }

    for (const merchantId of preview.merchants) {
      await connection.query(
        `INSERT INTO bank_merchant_mappings (provider, merchant_id, branch_id, payment_channel_id, is_primary)
         VALUES ('KPLUSSHOP', ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id), payment_channel_id = VALUES(payment_channel_id), is_active = TRUE`,
        [merchantId, resources.branch_id, resources.payment_channel_id]
      );
    }

    // Alipay/WeChat settles separately from Thai QR and may arrive on the next
    // bank day. Preserve it as bank evidence for review instead of silently
    // dropping it or adding it to QR. Linking remains pending until the gross
    // POS sale is identified, because the statement contains only the net
    // deposit after fees.
    for (const settlement of alipayWeChatRows) {
      const stableHash = crypto.createHash('sha256')
        .update(`kbank-monthly:${checksum}:alipay-wechat:${settlement.uniqueHash}`)
        .digest('hex');
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, auto_match_status, source_file_name, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, 'PENDING', ?, ?, ?, 'ALIPAY_WECHAT', ?, ?, ?)`,
        [inboxImportId, req.file.originalname, settlement.transactionDate, settlement.description,
          settlement.amount, stableHash, JSON.stringify({
            ...(settlement.rawPayload || {}),
            suggested_sale_date: settlement.saleDate,
            settlement_date: settlement.transactionDate,
            settlement_channel: 'ALIPAY_WECHAT',
            note: 'รอจับคู่ยอดขายก่อนหักค่าธรรมเนียม; ห้ามรวมเป็น QR กสิกร'
          })]
      );
    }
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_kasikorn_monthly_statement',
      afterPayload: { ...preview, inserted_statement_rows: insertedStatementRows, reused_statement_rows: reusedStatementRows }
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      data: {
        id: inboxImportId,
        status: alipayWeChatRows.length > 0 ? 'PARTIAL_REVIEW' : 'AUTO_LINKED',
        ...preview,
        inserted_statement_rows: insertedStatementRows,
        reused_statement_rows: reusedStatementRows
      }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

// KBank merchant card settlements are credited to the San Kamphaeng account on
// the same bank date and are described as full payment / instalment / reward
// point sales. Keep them separate from Thai QR rows even though both live in
// the same monthly statement.
app.post('/api/inbox-imports/kbank-monthly-card', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !isKasikornMonthlyEvidence(req.file)) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบ statement กสิกรรูปแบบ PDF หรือ CSV' });
  }
  const branchCode = String(req.body.branch_code || 'SK').trim().toUpperCase();
  if (branchCode !== 'SK') {
    return res.status(400).json({ success: false, message: 'บัตรเครดิตกสิกรรายเดือนรองรับ branch_code=SK' });
  }
  const branchConfig = KASIKORN_MONTHLY_BRANCHES.SK;
  const monthRange = parseMonthRange(req.body.month);
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const parsed = await parseStatementFile({
    buffer: fileData,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/pdf'
  });
  const cardRows = parsed.rows.filter((row) =>
    /รับเงินจากการขาย\s+เต็มจำนวน\s*\/\s*ผ่อนชำระ\s*\/\s*คะแนนสะสม/i.test(String(row.description || ''))
  );
  if (cardRows.length === 0) {
    return res.status(422).json({ success: false, message: 'ไม่พบรายการบัตรเครดิตกสิกรในไฟล์' });
  }
  const accountNumbers = kasikornStatementAccountNumbers(parsed, cardRows);
  if (accountNumbers.size !== 1 || !accountNumbers.has(branchConfig.accountNumber)) {
    return res.status(422).json({ success: false, message: 'เลขบัญชีในไฟล์ไม่ใช่บัญชีกสิกรสันกำแพง 176-3-14786-6' });
  }
  if (cardRows.some((row) => !row.transactionDate?.startsWith(`${monthRange.month}-`))) {
    return res.status(422).json({ success: false, message: 'วันที่รายการบัตรเครดิตกสิกรไม่ตรงกับเดือนที่ระบุ' });
  }

  const rowsByDate = new Map(monthRange.days.map((date) => [date, []]));
  cardRows.forEach((row) => rowsByDate.get(row.transactionDate)?.push(row));
  const dailyTotals = monthRange.days.map((date) => ({
    business_date: date,
    amount: roundMoney((rowsByDate.get(date) || []).reduce((sum, row) => sum + row.amount, 0))
  }));
  const statementTotal = roundMoney(dailyTotals.reduce((sum, row) => sum + row.amount, 0));
  const preview = {
    branch_code: branchCode,
    account_number: branchConfig.accountNumber,
    month: monthRange.month,
    transaction_count: cardRows.length,
    total_amount: statementTotal,
    closed_zero_count: dailyTotals.filter((row) => row.amount === 0).length,
    daily_totals: dailyTotals
  };
  if (String(req.body.dry_run || '').toLowerCase() === 'true') {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, dry_run: true, data: preview });
  }

  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'KASIKORN_MONTHLY_CARD_STATEMENT' AND archive_checksum = ? LIMIT 1`,
    [checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [resourceRows] = await connection.query(
      `SELECT b.id AS branch_id, pc.id AS payment_channel_id, ra.id AS receiving_account_id
       FROM branches b
       JOIN payment_channels pc ON pc.code = 'CREDIT_CARD_KBANK'
       JOIN receiving_accounts ra ON ra.branch_id = b.id AND ra.account_number = ? AND ra.is_active = TRUE
       WHERE b.code = 'SK'`,
      [branchConfig.accountNumber]
    );
    const resources = resourceRows[0];
    if (!resources) {
      const error = new Error('ไม่พบบัญชีรับเงินบัตรเครดิตกสิกรของสาขาสันกำแพง');
      error.statusCode = 422;
      throw error;
    }
    const [lineRows] = await connection.query(
      `SELECT dr.id AS receipt_id, dr.receipt_date, drl.id AS receipt_line_id, drl.cashier_amount
       FROM daily_receipts dr
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id AND drl.payment_channel_id = ?
       WHERE dr.branch_id = ? AND dr.receipt_date BETWEEN ? AND ?`,
      [resources.payment_channel_id, resources.branch_id, monthRange.from, monthRange.to]
    );
    const linesByDate = new Map(lineRows.map((row) => [String(row.receipt_date).slice(0, 10), row]));
    const missingDates = monthRange.days.filter((date) => !linesByDate.has(date));
    if (missingDates.length > 0) {
      const error = new Error(`ขาดเอกสารบัตรเครดิตกสิกร: ${missingDates.join(', ')}`);
      error.statusCode = 422;
      throw error;
    }

    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('KASIKORN_MONTHLY_CARD_STATEMENT', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'AUTO_LINKED')`,
      [checksum, monthRange.from, `KBank monthly card SK ${monthRange.month}`, req.file.originalname,
        req.file.path, req.file.mimetype || 'application/pdf', checksum, fileData,
        cardRows.length, statementTotal]
    );
    const inboxImportId = importResult.insertId;
    let insertedStatementRows = 0;
    let reusedStatementRows = 0;

    for (const date of monthRange.days) {
      const line = linesByDate.get(date);
      const dateRows = rowsByDate.get(date) || [];
      const statementRows = dateRows.length > 0
        ? dateRows.map((row, index) => ({
          ...row,
          referenceNo: `KBANK-CARD-${date}-${index + 1}`,
          stableHash: crypto.createHash('sha256')
            .update(`kbank-monthly-card:${checksum}:${date}:${index + 1}:${row.amount}`)
            .digest('hex')
        }))
        : [{
          amount: 0,
          description: 'KBank monthly statement: no card settlement',
          referenceNo: 'KASIKORN_CARD_CLOSED_ZERO',
          rawPayload: { business_date: date, closed_zero: true },
          stableHash: crypto.createHash('sha256')
            .update(`kbank-monthly-card:${checksum}:${date}:CLOSED_ZERO`)
            .digest('hex')
        }];

      const rowsToInsert = [];
      for (const row of statementRows) {
        await connection.query(
          `INSERT INTO bank_inbox_transactions
            (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
             description, reference_no, amount, unique_hash, raw_payload)
           VALUES (?, ?, 'LINKED', ?, ?, ?, ?, ?, ?, ?)`,
          [inboxImportId, line.receipt_line_id, req.file.originalname, date, row.description,
            row.referenceNo, row.amount, row.stableHash, JSON.stringify(row.rawPayload || {})]
        );
        const [matchedRows] = await connection.query(
          `SELECT id FROM statement_transactions
           WHERE receipt_line_id = ? AND transaction_date = ? AND amount = ?
             AND match_status IN ('classified', 'matched_auto', 'matched_manual') LIMIT 1`,
          [line.receipt_line_id, date, row.amount]
        );
        if (matchedRows[0]) reusedStatementRows += 1;
        else rowsToInsert.push(row);
      }

      if (rowsToInsert.length > 0) {
        const importTotal = roundMoney(rowsToInsert.reduce((sum, row) => sum + row.amount, 0));
        const [statementImport] = await connection.query(
          `INSERT INTO statement_imports
            (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [line.receipt_id, resources.payment_channel_id, resources.receiving_account_id,
            `${req.file.originalname} (monthly KBank card)`, req.file.path,
            req.file.mimetype || 'application/pdf', rowsToInsert.length, importTotal]
        );
        for (const row of rowsToInsert) {
          await connection.query(
            `INSERT INTO statement_transactions
              (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
               description, reference_no, amount, unique_hash, raw_payload, match_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched_auto')`,
            [statementImport.insertId, line.receipt_id, line.receipt_line_id, resources.receiving_account_id,
              resources.payment_channel_id, date, row.description, row.referenceNo, row.amount,
              row.stableHash, JSON.stringify(row.rawPayload || {})]
          );
          insertedStatementRows += 1;
        }
      }

      const matchedAmount = await recalculateStatementAmount(connection, line.receipt_line_id);
      const gross = roundMoney(line.cashier_amount || 0);
      await connection.query(
        'INSERT IGNORE INTO receipt_line_reconciliations (receipt_line_id) VALUES (?)',
        [line.receipt_line_id]
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
             matched_amount = ?, settlement_source = 'BANK_STATEMENT', settlement_date = ?, settlement_status = ?,
             exception_category = ?, exception_note = ?
         WHERE receipt_line_id = ?`,
        [resources.receiving_account_id, gross, roundMoney(Math.max(gross - matchedAmount, 0)), matchedAmount,
          matchedAmount, date, gross >= matchedAmount ? 'MATCHED_AUTO' : 'EXCEPTION',
          gross >= matchedAmount ? null : 'OTHER',
          gross >= matchedAmount ? null : 'มียอดเงินจริงจาก statement แต่ยังไม่มียอดรูดที่แคชเชียร์ส่ง',
          line.receipt_line_id]
      );
      const evidence = await attachImportedEvidence(connection, {
        receiptId: line.receipt_id,
        sourceLabel: 'บัตรเครดิตกสิกร',
        files: [{
          fileName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/octet-stream',
          fileData
        }]
      });
      if (evidence.attachmentIds[0]) {
        await connection.query(
          'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
          [evidence.attachmentIds[0], line.receipt_line_id]
        );
      }
    }

    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_kasikorn_monthly_card_statement',
      afterPayload: { ...preview, inserted_statement_rows: insertedStatementRows, reused_statement_rows: reusedStatementRows }
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      data: {
        id: inboxImportId,
        status: 'AUTO_LINKED',
        ...preview,
        inserted_statement_rows: insertedStatementRows,
        reused_statement_rows: reusedStatementRows
      }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

// Grab settles both stores into the shared Kanklong KBank account on the bank
// day after sale. Keep this import separate from monthly QR so one statement can
// close both channels without mixing their transaction evidence.
app.post('/api/inbox-imports/kbank-monthly-grab', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !String(req.file.originalname || '').toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบ statement กสิกรรูปแบบ PDF' });
  }
  const monthRange = parseMonthRange(req.body.month);
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const parsed = await parseStatementFile({
    buffer: fileData,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype || 'application/pdf'
  });
  const grabRows = parsed.rows.filter((row) =>
    /X3812|บจก\.\s*แกร็บแท็กซี่|\|\s*GRAB\b/i.test(String(row.description || '')));
  if (grabRows.length === 0) {
    return res.status(422).json({ success: false, message: 'ไม่พบรายการเงินเข้า Grab จาก X3812 ใน PDF' });
  }
  const accountNumbers = new Set(grabRows.map((row) => compactBankAccount(row.referenceNo)));
  if (accountNumbers.size !== 1 || !accountNumbers.has('0308663108')) {
    return res.status(422).json({
      success: false,
      message: 'รายการ Grab ใน PDF ไม่ได้มาจากบัญชี 030-8-66310-8'
    });
  }
  if (grabRows.some((row) => !row.transactionDate?.startsWith(`${monthRange.month}-`))) {
    return res.status(422).json({ success: false, message: 'วันที่รายการ Grab ใน PDF ไม่ตรงกับเดือนที่ระบุ' });
  }

  const [evidenceRows] = await getPool().query(
    `SELECT DATE_FORMAT(dr.receipt_date, '%Y-%m-%d') AS business_date,
            dr.id AS receipt_id, drl.id AS receipt_line_id, b.code AS branch_code,
            dr.gross_sales_expected, drl.cashier_amount, drl.expected_amount,
            rlr.expected_gross_amount, rlr.fee_amount, rlr.expected_net_amount,
            (
              SELECT bit.raw_payload
              FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
              WHERE bit.receipt_line_id = drl.id AND bi.provider = 'GRAB_DAILY'
              ORDER BY bi.id DESC, bit.id DESC
              LIMIT 1
            ) AS grab_report_payload
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id AND b.code IN ('KK', 'SK')
     JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     JOIN payment_channels pc ON pc.id = drl.payment_channel_id AND pc.code = 'GRAB'
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     WHERE dr.receipt_date BETWEEN ? AND ?
     ORDER BY dr.receipt_date, b.code`,
    [monthRange.from, monthRange.to]
  );
  const evidenceByDate = new Map();
  for (const row of evidenceRows) {
    const payload = typeof row.grab_report_payload === 'string'
      ? JSON.parse(row.grab_report_payload || '{}')
      : row.grab_report_payload || {};
    const reportNetAmount = Number(payload.net_amount);
    const evidence = {
      branchCode: row.branch_code,
      receiptId: row.receipt_id,
      receiptLineId: row.receipt_line_id,
      reportNetAmount: Number.isFinite(reportNetAmount) ? roundMoney(reportNetAmount) : null,
      expectedNetAmount: roundMoney(row.expected_net_amount || 0),
      expectedGrossAmount: roundMoney(row.expected_gross_amount || 0),
      feeAmount: roundMoney(row.fee_amount || 0),
      hasSalesActivity: roundMoney(row.cashier_amount || 0) > 0 ||
        roundMoney(payload.cashier_amount || 0) > 0 || roundMoney(row.gross_sales_expected || 0) > 0
    };
    const items = evidenceByDate.get(row.business_date) || [];
    items.push(evidence);
    evidenceByDate.set(row.business_date, items);
  }
  const matched = assignKasikornGrabStatementRows({
    rows: grabRows,
    evidenceByDate,
    month: monthRange.month
  });
  const unresolvedInMonth = matched.pending.filter((item) =>
    String(item.saleDate || '').startsWith(`${monthRange.month}-`));
  const preview = {
    account_number: '0308663108',
    month: monthRange.month,
    transaction_count: grabRows.length,
    total_amount: roundMoney(grabRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    linked_count: matched.assignments.length,
    positive_linked_count: matched.assignments.filter((item) => item.row).length,
    closed_zero_count: matched.assignments.filter((item) => !item.row).length,
    pending_prior_month_count: matched.pending.filter((item) => item.reason === 'SALE_DATE_OUTSIDE_MONTH').length,
    unresolved_in_month_count: unresolvedInMonth.length,
    verified_settlement_order: matched.verifiedSequence,
    settlement_order_support_days: matched.sequenceSupport,
    daily_settlements: matched.assignments.map((item) => ({
      sale_date: item.saleDate,
      settlement_date: item.settlementDate,
      branch_code: item.branchCode,
      amount: item.row ? roundMoney(item.row.amount) : 0,
      match_reason: item.reason
    }))
  };
  if (String(req.body.dry_run || '').toLowerCase() === 'true') {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, dry_run: true, data: preview });
  }
  if (unresolvedInMonth.length > 0) {
    const error = new Error(`ยังจับคู่สาขา Grab ไม่ได้ ${unresolvedInMonth.length} รายการ กรุณาตรวจสอบก่อนนำเข้า`);
    error.statusCode = 422;
    throw error;
  }

  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'KASIKORN_MONTHLY_GRAB_STATEMENT' AND archive_checksum = ? LIMIT 1`,
    [checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [resourceRows] = await connection.query(
      `SELECT ra.id AS receiving_account_id, pc.id AS payment_channel_id
       FROM receiving_accounts ra
       JOIN receiving_account_channels rac ON rac.receiving_account_id = ra.id
       JOIN payment_channels pc ON pc.id = rac.payment_channel_id AND pc.code = 'GRAB'
       WHERE ra.account_number = '0308663108' AND ra.is_active = TRUE
       LIMIT 1`
    );
    const resources = resourceRows[0];
    if (!resources) {
      const error = new Error('ไม่พบบัญชี 030-8-66310-8 ที่เปิดใช้กับ Grab');
      error.statusCode = 422;
      throw error;
    }
    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('KASIKORN_MONTHLY_GRAB_STATEMENT', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'AUTO_LINKED')`,
      [
        checksum, monthRange.from, `KBank monthly Grab ${monthRange.month}`,
        req.file.originalname, req.file.path, req.file.mimetype || 'application/pdf', checksum, fileData,
        grabRows.length, preview.total_amount
      ]
    );
    const inboxImportId = importResult.insertId;
    const assignmentByHash = new Map(
      matched.assignments.filter((item) => item.row).map((item) => [item.row.uniqueHash, item])
    );

    for (const row of grabRows) {
      const assignment = assignmentByHash.get(row.uniqueHash);
      const stableHash = crypto.createHash('sha256')
        .update(`kbank-monthly-grab-inbox:${checksum}:${row.uniqueHash}`)
        .digest('hex');
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, 'X3812', ?, ?, ?)`,
        [
          inboxImportId, assignment?.evidence?.receiptLineId || null, assignment ? 'LINKED' : 'PENDING',
          req.file.originalname, row.transactionDate, row.description, row.amount, stableHash,
          JSON.stringify({
            ...(row.rawPayload || {}),
            source: 'kbank_monthly_grab_statement',
            statement_account: '0308663108',
            sale_date: assignment?.saleDate || previousIsoDate(row.transactionDate),
            settlement_date: row.transactionDate,
            branch_code: assignment?.branchCode || null,
            match_reason: assignment?.reason || 'SALE_DATE_OUTSIDE_MONTH'
          })
        ]
      );
    }

    for (const assignment of matched.assignments) {
      const line = assignment.evidence;
      if (!line?.receiptLineId) {
        const error = new Error(`ไม่พบเอกสาร Grab ${assignment.branchCode} วันที่ ${assignment.saleDate}`);
        error.statusCode = 422;
        throw error;
      }
      const actualAmount = roundMoney(assignment.row?.amount || 0);
      const bankPayload = {
        ...(assignment.row?.rawPayload || {}),
        source: 'kbank_monthly_grab_statement',
        statement_account: '0308663108',
        sale_date: assignment.saleDate,
        settlement_date: assignment.settlementDate,
        branch_code: assignment.branchCode,
        match_reason: assignment.reason,
        verified_settlement_order: matched.verifiedSequence,
        settlement_order_support_days: matched.sequenceSupport
      };
      if (!assignment.row) {
        const inboxHash = crypto.createHash('sha256')
          .update(`kbank-monthly-grab-zero-inbox:${checksum}:${assignment.saleDate}:${assignment.branchCode}`)
          .digest('hex');
        await connection.query(
          `INSERT INTO bank_inbox_transactions
            (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
             description, reference_no, amount, unique_hash, raw_payload)
           VALUES (?, ?, 'LINKED', ?, ?, 'KBank full statement: no Grab deposit and zero sales',
                   'GRAB_CLOSED_ZERO', 0, ?, ?)`,
          [inboxImportId, line.receiptLineId, req.file.originalname, assignment.settlementDate,
            inboxHash, JSON.stringify(bankPayload)]
        );
      }
      await connection.query(
        `UPDATE statement_transactions
         SET match_status = 'unmatched'
         WHERE receipt_line_id = ?
           AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.source')) = 'grab_daily_report'`,
        [line.receiptLineId]
      );
      const [statementImport] = await connection.query(
        `INSERT INTO statement_imports
          (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type,
           row_count, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [line.receiptId, resources.payment_channel_id, resources.receiving_account_id,
          `${req.file.originalname} (Grab ${assignment.branchCode} ${assignment.saleDate})`,
          req.file.path, req.file.mimetype || 'application/pdf', actualAmount]
      );
      const statementHash = crypto.createHash('sha256')
        .update(`kbank-monthly-grab-statement:${checksum}:${assignment.saleDate}:${assignment.branchCode}:${actualAmount}`)
        .digest('hex');
      await connection.query(
        `INSERT INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id,
           transaction_date, description, reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched_auto')`,
        [statementImport.insertId, line.receiptId, line.receiptLineId, resources.receiving_account_id,
          resources.payment_channel_id, assignment.settlementDate,
          assignment.row?.description || 'KBank full statement: no Grab deposit and zero sales',
          assignment.row ? 'X3812' : 'GRAB_CLOSED_ZERO', actualAmount, statementHash,
          JSON.stringify(bankPayload)]
      );
      const matchedAmount = await recalculateStatementAmount(connection, line.receiptLineId);
      const priorExpectedNet = roundMoney(line.expectedNetAmount || 0);
      const expectedNet = priorExpectedNet > 0 ? priorExpectedNet : matchedAmount;
      const settlementVariance = roundMoney(matchedAmount - expectedNet);
      const settlementStatus = settlementVariance === 0 ? 'MATCHED_AUTO' : 'EXCEPTION';
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET receiving_account_id = ?, expected_net_amount = ?, matched_amount = ?,
             settlement_source = 'BANK_STATEMENT', settlement_date = ?, settlement_status = ?,
             settlement_variance_amount = ?, exception_category = ?, exception_note = ?
         WHERE receipt_line_id = ?`,
        [resources.receiving_account_id, expectedNet, matchedAmount, assignment.settlementDate,
          settlementStatus, settlementVariance,
          settlementStatus === 'EXCEPTION' ? 'OTHER' : null,
          settlementStatus === 'EXCEPTION'
            ? `ยอดเข้า statement ${matchedAmount.toFixed(2)} ต่างจากยอดสุทธิรายงาน Grab ${expectedNet.toFixed(2)}`
            : null,
          line.receiptLineId]
      );
    }
    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_kasikorn_monthly_grab_statement',
      afterPayload: preview
    });
    await connection.commit();
    res.status(201).json({ success: true, data: { id: inboxImportId, status: 'AUTO_LINKED', ...preview } });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/inbox-imports/scb-monthly', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !String(req.file.originalname || '').toLowerCase().endsWith('.pdf')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบ statement SCB รูปแบบ PDF' });
  }
  const monthRange = parseMonthRange(req.body.month);
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const parsed = await parseScbMonthlyCardPdf({ buffer: fileData });
  if (parsed.accountNumber !== '4070578401') {
    return res.status(422).json({ success: false, message: 'เลขบัญชีใน PDF ไม่ใช่บัญชี SCB 407-057840-1' });
  }
  if (parsed.from !== monthRange.from || parsed.to !== monthRange.to) {
    return res.status(422).json({ success: false, message: 'ช่วงวันที่ใน PDF ไม่ตรงกับเดือนที่ระบุ' });
  }
  if (parsed.rows.length === 0) {
    return res.status(422).json({ success: false, message: 'ไม่พบรายการ CREDIT CARD DIVISION (EDC) ใน PDF' });
  }

  const settlements = parsed.rows
    .map((row) => ({ ...row, saleDate: previousIsoDate(row.transactionDate) }))
    .filter((row) => row.saleDate >= monthRange.from && row.saleDate <= monthRange.to);
  const preview = {
    branch_code: 'KK',
    account_number: parsed.accountNumber,
    month: monthRange.month,
    transaction_count: settlements.length,
    total_amount: roundMoney(settlements.reduce((sum, row) => sum + row.amount, 0)),
    settlements: settlements.map((row) => ({
      sale_date: row.saleDate,
      settlement_date: row.transactionDate,
      amount: row.amount
    }))
  };
  if (String(req.body.dry_run || '').toLowerCase() === 'true') {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, dry_run: true, data: preview });
  }

  const [existingRows] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'SCB_MONTHLY_STATEMENT' AND archive_checksum = ? LIMIT 1`,
    [checksum]
  );
  if (existingRows[0]) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [resourceRows] = await connection.query(
      `SELECT b.id AS branch_id, pc.id AS payment_channel_id, ra.id AS receiving_account_id
       FROM branches b
       JOIN payment_channels pc ON pc.code = 'CREDIT_CARD_SCB'
       JOIN receiving_accounts ra ON ra.branch_id = b.id AND ra.account_number = '4070578401' AND ra.is_active = TRUE
       WHERE b.code = 'KK'`
    );
    const resources = resourceRows[0];
    if (!resources) {
      const error = new Error('ไม่พบบัญชีรับเงินบัตรเครดิต SCB ของสาขาคันคลอง');
      error.statusCode = 422;
      throw error;
    }
    const [lineRows] = await connection.query(
      `SELECT dr.id AS receipt_id, dr.receipt_date, drl.id AS receipt_line_id, drl.cashier_amount,
              COALESCE(rlr.settlement_source, 'NONE') AS settlement_source,
              COALESCE(rlr.matched_amount, 0) AS matched_amount
       FROM daily_receipts dr
       JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id AND drl.payment_channel_id = ?
       LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
       WHERE dr.branch_id = ? AND dr.receipt_date BETWEEN ? AND ?`,
      [resources.payment_channel_id, resources.branch_id, monthRange.from, monthRange.to]
    );
    const linesByDate = new Map(lineRows.map((row) => [String(row.receipt_date).slice(0, 10), row]));
    const missingDates = [...new Set(settlements.map((row) => row.saleDate))].filter((date) => !linesByDate.has(date));
    if (missingDates.length > 0) {
      const error = new Error(`ขาดเอกสารบัตรเครดิต SCB: ${missingDates.join(', ')}`);
      error.statusCode = 422;
      throw error;
    }

    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('SCB_MONTHLY_STATEMENT', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'AUTO_LINKED')`,
      [checksum, monthRange.from, `SCB monthly card KK ${monthRange.month}`, req.file.originalname,
        req.file.path, req.file.mimetype || 'application/pdf', checksum, fileData,
        settlements.length, preview.total_amount]
    );
    const inboxImportId = importResult.insertId;
    let insertedStatementRows = 0;
    let reusedStatementRows = 0;

    for (const settlement of settlements) {
      const line = linesByDate.get(settlement.saleDate);
      const hasBankEvidence = ['BANK_SETTLEMENT', 'BANK_STATEMENT', 'LEGACY_EVIDENCE'].includes(line.settlement_source)
        && roundMoney(line.matched_amount) > 0;
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, 'LINKED', ?, ?, ?, ?, ?, ?, ?)`,
        [inboxImportId, line.receipt_line_id, req.file.originalname, settlement.transactionDate,
          settlement.description, settlement.referenceNo, settlement.amount, settlement.uniqueHash,
          JSON.stringify({ ...settlement.rawPayload, sale_date: settlement.saleDate })]
      );

      if (hasBankEvidence) {
        reusedStatementRows += 1;
        continue;
      }
      const [statementImport] = await connection.query(
        `INSERT INTO statement_imports
          (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [line.receipt_id, resources.payment_channel_id, resources.receiving_account_id,
          `${req.file.originalname} (monthly SCB card)`, req.file.path, req.file.mimetype || 'application/pdf', settlement.amount]
      );
      await connection.query(
        `INSERT INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched_auto')`,
        [statementImport.insertId, line.receipt_id, line.receipt_line_id, resources.receiving_account_id,
          resources.payment_channel_id, settlement.transactionDate, settlement.description, settlement.referenceNo,
          settlement.amount, crypto.createHash('sha256')
            .update(`scb-monthly:${inboxImportId}:${settlement.uniqueHash}`)
            .digest('hex'),
          JSON.stringify({ ...settlement.rawPayload, sale_date: settlement.saleDate })]
      );
      const matchedAmount = await recalculateStatementAmount(connection, line.receipt_line_id);
      const gross = roundMoney(line.cashier_amount || 0);
      await connection.query(
        `INSERT IGNORE INTO receipt_line_reconciliations (receipt_line_id) VALUES (?)`,
        [line.receipt_line_id]
      );
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET receiving_account_id = ?, expected_gross_amount = ?, fee_amount = ?, expected_net_amount = ?,
             matched_amount = ?, settlement_source = 'BANK_STATEMENT', settlement_date = ?, settlement_status = ?
         WHERE receipt_line_id = ?`,
        [resources.receiving_account_id, gross, roundMoney(Math.max(gross - matchedAmount, 0)), matchedAmount,
          matchedAmount, settlement.transactionDate, gross >= matchedAmount ? 'MATCHED_AUTO' : 'EXCEPTION',
          line.receipt_line_id]
      );
      const evidence = await attachImportedEvidence(connection, {
        receiptId: line.receipt_id,
        sourceLabel: 'บัตรเครดิต SCB',
        files: [{ fileName: req.file.originalname, mimeType: 'application/pdf', fileData }]
      });
      if (evidence.attachmentIds[0]) {
        await connection.query(
          'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
          [evidence.attachmentIds[0], line.receipt_line_id]
        );
      }
      insertedStatementRows += 1;
    }

    await logAudit({
      connection,
      entityType: 'bank_inbox_import',
      entityId: inboxImportId,
      action: 'import_scb_monthly_statement',
      afterPayload: { ...preview, inserted_statement_rows: insertedStatementRows, reused_statement_rows: reusedStatementRows }
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      data: {
        id: inboxImportId,
        status: 'AUTO_LINKED',
        ...preview,
        inserted_statement_rows: insertedStatementRows,
        reused_statement_rows: reusedStatementRows
      }
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/inbox-imports/kplus-shop', requireGmailInboxToken, asyncHandler(async (req, res) => {
  const messageId = String(req.body.message_id || '').trim();
  const sourceDate = validateDate(req.body.source_date, 'source_date');
  if (!messageId || messageId.length > 160) {
    return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  }
  const suppliedMerchantId = String(req.body.merchant_id || '').trim();
  const suppliedAmount = String(req.body.amount || '').trim();
  const report = suppliedMerchantId && suppliedAmount
    ? { merchantId: suppliedMerchantId, amount: roundMoney(Number(suppliedAmount.replaceAll(',', ''))), text: String(req.body.body || '') }
    : parseKplusShopEmail(req.body.body);
  if (!/^KB\d+$/.test(report.merchantId) || !Number.isFinite(report.amount) || report.amount < 0) {
    return res.status(422).json({ success: false, message: 'ข้อมูลรหัสร้านค้าหรือยอดเงิน K SHOP ไม่ถูกต้อง' });
  }
  const settlementKey = kplusShopSettlementKey({ merchantId: report.merchantId, sourceDate });
  const checksum = crypto.createHash('sha256').update(settlementKey).digest('hex');
  const [existingRows] = await getPool().query(
    `SELECT bi.id, bi.status, bi.transaction_count, bi.total_amount
     FROM bank_inbox_imports bi
     LEFT JOIN bank_inbox_transactions bit ON bit.inbox_import_id = bi.id
     WHERE bi.provider = 'KPLUSSHOP'
       AND (bi.source_message_id = ? OR bi.archive_checksum = ?
         OR (bit.reference_no = ? AND bit.transaction_date = ? AND bit.auto_match_status <> 'DUPLICATE'))
     ORDER BY bi.id ASC LIMIT 1`,
    [messageId, checksum, report.merchantId, sourceDate]
  );
  if (existingRows[0]) {
    if (roundMoney(existingRows[0].total_amount) !== report.amount) {
      return res.status(409).json({
        success: false,
        message: `มีรายงาน K SHOP ร้าน ${report.merchantId} วันที่ ${sourceDate} อยู่แล้ว แต่ยอดไม่ตรง กรุณาตรวจสอบก่อนนำเข้า`
      });
    }
    return res.json({ success: true, duplicate: true, data: existingRows[0] });
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [mappingRows] = await connection.query(
      `SELECT branch_id, payment_channel_id, is_primary FROM bank_merchant_mappings
       WHERE provider = 'KPLUSSHOP' AND merchant_id = ? AND is_active = TRUE`,
      [report.merchantId]
    );
    const mapping = mappingRows[0];
    const [lineRows] = mapping
      ? await connection.query(
        `SELECT dr.id AS receipt_id, drl.id AS receipt_line_id
         FROM daily_receipts dr JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
         WHERE dr.branch_id = ? AND dr.receipt_date = ? AND drl.payment_channel_id = ? AND dr.status <> 'CLOSED'`,
        [mapping.branch_id, sourceDate, mapping.payment_channel_id]
      )
      : [[]];
    const candidateLine = lineRows[0];
    const line = mapping?.is_primary ? candidateLine : null;
    const [importResult] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount, status)
       VALUES ('KPLUSSHOP', ?, ?, ?, ?, 'KSHOP daily email', ?, 'message/rfc822', ?, ?, 1, 1, ?, ?)`,
      [
        messageId, sourceDate, String(req.body.sender_email || '').trim() || null,
        String(req.body.subject || '').trim() || null, `gmail://${messageId}`, checksum,
        Buffer.from(report.text, 'utf8'), report.amount, line ? 'AUTO_LINKED' : 'PENDING_REVIEW'
      ]
    );
    const inboxImportId = importResult.insertId;
    if (line) {
      const [statementImport] = await connection.query(
        `INSERT INTO statement_imports
          (receipt_id, payment_channel_id, original_name, stored_path, mime_type, row_count, total_amount)
         VALUES (?, ?, 'KSHOP daily email (auto)', ?, 'message/rfc822', 1, ?)`,
        [line.receipt_id, mapping.payment_channel_id, `gmail://${messageId}`, report.amount]
      );
      const uniqueHash = checksum;
      await connection.query(
        `INSERT INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date, description,
           reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, 'K SHOP daily settlement', ?, ?, ?, ?, 'matched_auto')`,
        [
          statementImport.insertId, line.receipt_id, line.receipt_line_id, mapping.payment_channel_id,
          sourceDate, report.merchantId, report.amount, uniqueHash, JSON.stringify({ merchant_id: report.merchantId, body: report.text })
        ]
      );
      await recalculateStatementAmount(connection, line.receipt_line_id);
      await connection.query(
        `UPDATE receipt_line_reconciliations
         SET expected_gross_amount = ?, fee_amount = 0, expected_net_amount = ?, matched_amount = ?,
             settlement_source = 'BANK_SETTLEMENT',
             settlement_date = DATE_ADD(?, INTERVAL 1 DAY), settlement_status = 'MATCHED_AUTO'
         WHERE receipt_line_id = ?`,
        [report.amount, report.amount, report.amount, sourceDate, line.receipt_line_id]
      );
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date, description,
           reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, 'LINKED', 'KSHOP daily email', ?, 'K SHOP daily settlement', ?, ?, ?, ?)`,
        [
          inboxImportId, line.receipt_line_id, sourceDate, report.merchantId, report.amount, uniqueHash,
          JSON.stringify({ merchant_id: report.merchantId, body: report.text })
        ]
      );
      const evidence = await attachImportedEvidence(connection, {
        receiptId: line.receipt_id,
        sourceLabel: 'QR กสิกร',
        files: [kplusEmailEvidenceFile({
          sourceDate,
          subject: req.body.subject,
          senderEmail: req.body.sender_email,
          body: report.text
        })]
      });
      if (evidence.attachmentIds[0]) {
        await connection.query(
          'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
          [evidence.attachmentIds[0], line.receipt_line_id]
        );
      }
    } else {
      let pendingStatementId = null;
      if (candidateLine && mapping && !mapping.is_primary) {
        const [statementImport] = await connection.query(
          `INSERT INTO statement_imports
            (receipt_id, payment_channel_id, original_name, stored_path, mime_type, row_count, total_amount)
           VALUES (?, ?, 'KSHOP daily email (pending secondary merchant)', ?, 'message/rfc822', 1, ?)`,
          [candidateLine.receipt_id, mapping.payment_channel_id, `gmail://${messageId}`, report.amount]
        );
        const [statementResult] = await connection.query(
          `INSERT INTO statement_transactions
            (import_id, receipt_id, receipt_line_id, payment_channel_id, transaction_date, description,
             reference_no, amount, unique_hash, raw_payload, match_status)
           VALUES (?, ?, NULL, ?, ?, 'K SHOP secondary merchant settlement', ?, ?, ?, ?, 'unmatched')`,
          [
            statementImport.insertId, candidateLine.receipt_id, mapping.payment_channel_id, sourceDate,
            report.merchantId, report.amount, checksum,
            JSON.stringify({ merchant_id: report.merchantId, body: report.text, review_classification: 'pending_secondary_merchant' })
          ]
        );
        pendingStatementId = statementResult.insertId;
        await attachImportedEvidence(connection, {
          receiptId: candidateLine.receipt_id,
          sourceLabel: 'QR กสิกร - เงินเข้าอื่นรอตรวจ',
          files: [kplusEmailEvidenceFile({
            sourceDate,
            subject: req.body.subject,
            senderEmail: req.body.sender_email,
            body: report.text
          })]
        });
      }
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, auto_match_status, source_file_name, transaction_date, description, reference_no, amount, unique_hash, raw_payload)
         VALUES (?, 'PENDING', 'KSHOP daily email', ?, 'K SHOP daily settlement', ?, ?, ?, ?)`,
        [
          inboxImportId, sourceDate, report.merchantId, report.amount,
          checksum,
          JSON.stringify({ merchant_id: report.merchantId, body: report.text, pending_statement_id: pendingStatementId })
        ]
      );
    }
    await logAudit({ connection, entityType: 'bank_inbox_import', entityId: inboxImportId, action: 'import_kplus_shop_gmail', afterPayload: { ...report, source_date: sourceDate, receipt_line_id: line?.receipt_line_id || null } });
    await connection.commit();
    res.status(201).json({ success: true, data: { id: inboxImportId, linked: Boolean(line), pending_review: Boolean(candidateLine && !line), receipt_line_id: line?.receipt_line_id || null, ...report } });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.post('/api/inbox-imports/scb-business-anywhere', requireGmailInboxToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file || !/\.zip$/i.test(req.file.originalname || '')) {
    return res.status(400).json({ success: false, message: 'กรุณาแนบไฟล์ ZIP จาก SCB Business Anywhere' });
  }
  const messageId = String(req.body.message_id || '').trim();
  if (!messageId) return res.status(400).json({ success: false, message: 'message_id จาก Gmail ไม่ถูกต้อง' });
  const fileData = await fs.promises.readFile(req.file.path);
  const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
  const [existing] = await getPool().query(
    `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
     WHERE provider = 'SCB_BUSINESS_ANYWHERE' AND (source_message_id = ? OR archive_checksum = ?) LIMIT 1`,
    [messageId, checksum]
  );
  if (existing[0]) {
    if (Number(existing[0].transaction_count || 0) === 0) {
      // Earlier versions could store an encrypted PDF ZIP with zero parsed rows.
      // It is safe to replace that incomplete import when Gmail retries the same file.
      await getPool().query('DELETE FROM bank_inbox_imports WHERE id = ?', [existing[0].id]);
    } else {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.json({ success: true, duplicate: true, data: existing[0] });
    }
  }
  const parsed = await parseBankReportZip({
    buffer: fileData,
    originalName: req.file.originalname,
    password: config.scbBusinessAnywhereZipPassword
  });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [accountRows] = await connection.query("SELECT id FROM receiving_accounts WHERE account_number = '4070578401' AND is_active = TRUE");
    const [channelRows] = await connection.query("SELECT id, code FROM payment_channels WHERE code IN ('CREDIT_CARD_SCB', 'PROMPTPAY')");
    const channelIds = new Map(channelRows.map((channel) => [channel.code, channel.id]));
    const [result] = await connection.query(
      `INSERT INTO bank_inbox_imports
        (provider, source_message_id, source_date, sender_email, subject, original_name, stored_path, mime_type,
         archive_checksum, file_data, file_count, transaction_count, total_amount)
       VALUES ('SCB_BUSINESS_ANYWHERE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, req.body.source_date ? validateDate(req.body.source_date, 'source_date') : null,
        String(req.body.sender_email || '').trim() || null, String(req.body.subject || '').trim() || null,
        req.file.originalname, req.file.path, req.file.mimetype, checksum, fileData,
        parsed.fileCount, parsed.transactionCount, parsed.totalAmount]
    );
    let linkedCount = 0;
    for (const row of parsed.transactions) {
      const channelCode = scbChannelCodeFor(row.description);
      const channelId = channelIds.get(channelCode);
      const linked = accountRows[0] && channelId
        ? await autoLinkScbTransaction(connection, { inboxImportId: result.insertId, originalName: req.file.originalname, storedPath: req.file.path, mimeType: req.file.mimetype, row, channelId, accountId: accountRows[0].id, evidenceFiles: parsed.files })
        : null;
      await connection.query(
        `INSERT INTO bank_inbox_transactions
          (inbox_import_id, receipt_line_id, auto_match_status, source_file_name, transaction_date, description,
           reference_no, amount, unique_hash, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, linked?.receipt_line_id || null, linked ? 'LINKED' : 'PENDING', row.sourceFileName,
          row.transactionDate, `${channelCode}: ${row.description || ''}`, row.referenceNo || null, row.amount,
          row.uniqueHash, JSON.stringify(row.rawPayload || {})]
      );
      if (linked) linkedCount += 1;
    }
    const status = linkedCount === parsed.transactionCount ? 'AUTO_LINKED' : linkedCount > 0 ? 'PARTIAL_REVIEW' : 'PENDING_REVIEW';
    await connection.query('UPDATE bank_inbox_imports SET status = ? WHERE id = ?', [status, result.insertId]);
    await logAudit({ connection, entityType: 'bank_inbox_import', entityId: result.insertId, action: 'import_scb_business_anywhere_gmail_zip', afterPayload: { fileName: req.file.originalname, linkedCount, transactionCount: parsed.transactionCount } });
    await connection.commit();
    res.status(201).json({ success: true, data: { id: result.insertId, status, linked_count: linkedCount, transaction_count: parsed.transactionCount } });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/inbox-imports', authenticate, requirePermission('inbox:read'), asyncHandler(async (_req, res) => {
  const [rows] = await getPool().query(
    `SELECT id, provider, source_date, sender_email, subject, original_name, status,
            file_count, transaction_count, total_amount, error_message, created_at,
            CASE WHEN file_data IS NOT NULL OR stored_path IS NOT NULL THEN TRUE ELSE FALSE END AS file_available
     FROM bank_inbox_imports
     ORDER BY created_at DESC
     LIMIT 100`
  );
  res.json({ success: true, data: rows });
}));

app.get('/api/inbox-imports/:id/file', authenticate, requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  const importId = Number(req.params.id);
  const [rows] = await getPool().query(
    `SELECT original_name, stored_path, mime_type, file_data
     FROM bank_inbox_imports WHERE id = ?`,
    [importId]
  );
  const inboxImport = rows[0];
  if (!inboxImport) return res.status(404).json({ success: false, message: 'ไม่พบไฟล์นำเข้านี้' });

  if (inboxImport.stored_path) {
    const resolvedPath = resolveUploadFilePath(inboxImport.stored_path);
    if (fs.existsSync(resolvedPath)) {
      res.setHeader('Content-Type', inboxImport.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(inboxImport.original_name)}`);
      return res.sendFile(resolvedPath);
    }
  }
  if (inboxImport.file_data) {
    res.setHeader('Content-Type', inboxImport.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(inboxImport.original_name)}`);
    return res.send(inboxImport.file_data);
  }
  return res.status(404).json({ success: false, message: 'ไม่พบไฟล์ต้นฉบับในระบบ' });
}));

app.get('/api/inbox-imports/:id/transactions', authenticate, requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  const importId = Number(req.params.id);
  const [rows] = await getPool().query(
    `SELECT id, source_file_name, transaction_date, description, reference_no, amount, created_at
     FROM bank_inbox_transactions
     WHERE inbox_import_id = ?
     ORDER BY transaction_date ASC, id ASC`,
    [importId]
  );
  res.json({ success: true, data: rows });
}));

app.post('/api/reconciliations/statement-preview', authenticate, requirePermission('statement:import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ statement' });
  const connection = await getPool().getConnection();
  try {
    const result = await buildStatementPreview({
      connection,
      receiptLineId: Number(req.body.receipt_line_id),
      receivingAccountId: Number(req.body.receiving_account_id),
      file: req.file
    });
    res.json({ success: true, data: result.preview });
  } finally {
    connection.release();
  }
}));

app.post('/api/reconciliations/statement-confirm', authenticate, requirePermission('statement:import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ statement' });
  const receiptLineId = Number(req.body.receipt_line_id);
  const receivingAccountId = Number(req.body.receiving_account_id);
  let selectedHashes;
  let customerDepositHashes;
  try {
    selectedHashes = new Set(JSON.parse(req.body.selected_hashes || '[]').map(String));
    customerDepositHashes = new Set(JSON.parse(req.body.customer_deposit_hashes || '[]').map(String));
  } catch {
    return res.status(400).json({ success: false, message: 'รูปแบบรายการที่เลือกไม่ถูกต้อง' });
  }
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const prepared = await buildStatementPreview({ connection, receiptLineId, receivingAccountId, file: req.file });
    const { line, expected_net_amount: expectedNetAmount, preview, parsed_rows: parsedRows } = prepared;
    const allHashes = new Set(parsedRows.map((row) => row.uniqueHash));
    if ([...selectedHashes].some((hash) => !allHashes.has(hash))) {
      const error = new Error('มีรายการที่เลือกไม่อยู่ในไฟล์ statement');
      error.statusCode = 400;
      throw error;
    }
    if ([...customerDepositHashes].some((hash) => !allHashes.has(hash))) {
      const error = new Error('มีรายการมัดจำลูกค้าที่ไม่อยู่ในไฟล์ statement');
      error.statusCode = 400;
      throw error;
    }
    const classifiedHashes = new Set(parsedRows.filter((row) => row.classification === 'classified').map((row) => row.uniqueHash));
    const candidateHashes = new Set(parsedRows.filter((row) => row.candidate).map((row) => row.uniqueHash));
    if (preview.direct_channel) {
      selectedHashes = classifiedHashes;
    } else if ([...selectedHashes].some((hash) => !candidateHashes.has(hash))) {
      const error = new Error('เลือกได้เฉพาะรายการเงินเข้าที่ระบบเสนอ');
      error.statusCode = 400;
      throw error;
    }
    for (const hash of customerDepositHashes) selectedHashes.delete(hash);

    const selectedRows = parsedRows.filter((row) => selectedHashes.has(row.uniqueHash));
    const customerDepositRows = parsedRows.filter((row) => customerDepositHashes.has(row.uniqueHash));
    const selectedTotal = roundMoney(selectedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const customerDepositTotal = roundMoney(customerDepositRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const scbCardGrossAmount = roundMoney(line.cashier_amount || 0);
    const canDeriveScbFee = line.channel_code === 'CREDIT_CARD_SCB'
      && selectedRows.length === 1
      && selectedTotal > 0
      && selectedTotal <= scbCardGrossAmount;
    const effectiveExpectedNetAmount = canDeriveScbFee ? selectedTotal : expectedNetAmount;
    const exactMatch = selectedRows.length > 0 && selectedTotal === effectiveExpectedNetAmount;
    const [importResult] = await connection.query(
      `INSERT INTO statement_imports
        (receipt_id, payment_channel_id, receiving_account_id, original_name, stored_path, mime_type, row_count, total_amount, imported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [line.receipt_id, line.payment_channel_id, receivingAccountId, req.file.originalname, req.file.path, req.file.mimetype, parsedRows.length, selectedTotal, req.user.id]
    );
    const importId = importResult.insertId;
    let duplicateCount = 0;
    for (const row of parsedRows) {
      const selected = selectedHashes.has(row.uniqueHash);
      const customerDeposit = customerDepositHashes.has(row.uniqueHash);
      const matchStatus = selected
        ? exactMatch
          ? 'matched_auto'
          : preview.direct_channel
            ? 'classified'
            : 'matched_manual'
        : customerDeposit
          ? 'customer_deposit'
        : row.candidate
          ? 'unmatched'
          : 'unrelated';
      const [result] = await connection.query(
        `INSERT IGNORE INTO statement_transactions
          (import_id, receipt_id, receipt_line_id, receiving_account_id, payment_channel_id, transaction_date,
           description, reference_no, amount, unique_hash, raw_payload, match_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          importId, line.receipt_id, selected ? line.id : null, receivingAccountId,
          selected ? line.payment_channel_id : null, row.transactionDate, row.description, row.referenceNo,
          row.amount, `${line.receipt_id}-${row.uniqueHash}`, JSON.stringify(row.rawPayload || {}), matchStatus
        ]
      );
      if (result.affectedRows === 0) duplicateCount += 1;
      if (result.affectedRows === 0) {
        await connection.query(
          `UPDATE statement_transactions
           SET import_id = ?, receipt_line_id = ?, receiving_account_id = ?, payment_channel_id = ?,
               transaction_date = ?, description = ?, reference_no = ?, amount = ?, raw_payload = ?, match_status = ?
           WHERE unique_hash = ?`,
          [
            importId, selected ? line.id : null, receivingAccountId, selected ? line.payment_channel_id : null,
            row.transactionDate, row.description, row.referenceNo, row.amount, JSON.stringify(row.rawPayload || {}),
            matchStatus, `${line.receipt_id}-${row.uniqueHash}`
          ]
        );
      }
    }
    const matchedAmount = await recalculateStatementAmount(connection, line.id);
    await connection.query(
      `UPDATE statement_imports SET duplicate_count = ? WHERE id = ?`,
      [duplicateCount, importId]
    );
    await connection.query(
      `UPDATE receipt_line_reconciliations
       SET receiving_account_id = ?, matched_amount = ?, settlement_date = ?, settlement_status = ?,
           settlement_source = CASE WHEN ? THEN 'BANK_SETTLEMENT' ELSE 'BANK_STATEMENT' END,
           expected_gross_amount = CASE WHEN ? THEN ? ELSE expected_gross_amount END,
           fee_amount = CASE WHEN ? THEN ? ELSE fee_amount END,
           expected_net_amount = CASE WHEN ? THEN ? ELSE expected_net_amount END
       WHERE receipt_line_id = ?`,
      [
        receivingAccountId, matchedAmount, selectedRows[0]?.transactionDate || null,
        selectedRows.length === 0
          ? 'READY_FOR_STATEMENT'
          : exactMatch
            ? 'MATCHED_AUTO'
            : preview.direct_channel
            ? 'EXCEPTION'
            : 'MATCHED_MANUAL',
        canDeriveScbFee,
        canDeriveScbFee, scbCardGrossAmount,
        canDeriveScbFee, roundMoney(scbCardGrossAmount - selectedTotal),
        canDeriveScbFee, selectedTotal,
        line.id
      ]
    );
    const fileData = await fs.promises.readFile(req.file.path);
    await connection.query(
      `INSERT INTO attachments
        (receipt_id, statement_import_id, attachment_type, original_name, stored_path, mime_type, size_bytes, file_data, uploaded_by)
       VALUES (?, ?, 'statement', ?, ?, ?, ?, ?, ?)`,
      [line.receipt_id, importId, req.file.originalname, req.file.path, req.file.mimetype, req.file.size, fileData, req.user.id]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: line.receipt_id,
      action: 'confirm_statement_match',
      actor: req.user,
      afterPayload: { receipt_line_id: line.id, importId, receivingAccountId, matchedAmount, exactMatch, customerDepositTotal,
        scbCardFeeAmount: canDeriveScbFee ? roundMoney(scbCardGrossAmount - selectedTotal) : null }
    });
    await connection.commit();
    res.status(201).json({ success: true, data: await serializeReceipt(line.receipt_id) });
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

app.post('/api/daily-receipts/:id/post-close-adjustments', authenticate, requirePermission('receipt:adjust-closed'), asyncHandler(async (req, res) => {
  const receiptId = Number(req.params.id);
  const result = await createPostCloseAdjustment(getPool(), { receiptId, input: req.body, actor: req.user });
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: await serializeReceipt(receiptId) });
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
    const closingSummary = buildReceiptClosingSummary(receipt);
    await connection.query(
      `UPDATE daily_receipts
       SET status = 'CLOSED', closed_by = ?, closed_at = NOW(), closed_reconciliation_snapshot = ?
       WHERE id = ?`,
      [req.user.id, JSON.stringify(closingSummary), receiptId]
    );
    await logAudit({
      connection,
      entityType: 'daily_receipt',
      entityId: receiptId,
      action: 'close',
      actor: req.user,
      afterPayload: { closing_summary: closingSummary },
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

// สรุปงานค้างตอนเช้า — อ่านอย่างเดียวสำหรับข้อมูลเอกสาร เขียนเฉพาะตาราง morning_briefs
// ใช้สิทธิ์ inbox:read เพราะกลุ่มผู้อ่านคือ auditor/recorder/admin ไม่ใช่แคชเชียร์
//
// ปกติคืนของที่ cron สร้างไว้ตอนเช้า (เร็วทันที) ต้องส่ง refresh=1 ถึงจะสร้างใหม่
// เพราะการสร้างหนึ่งครั้งใช้เวลาราว 10 วินาทีและเสียค่า token
app.get('/api/reports/morning-brief', authenticate, requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  const date = validateDate(req.query.date || briefTargetDate(), 'date');
  const cached = await loadMorningBrief({ date });
  if (cached) return res.json({ success: true, data: cached });

  const result = await runMorningBrief({ date });
  await saveMorningBrief({ result, generatedBy: 'on-demand' });
  res.json({ success: true, data: { ...result, cached: false } });
}));

app.post('/api/reports/morning-brief/refresh', authenticate, requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  const date = validateDate(req.body?.date || briefTargetDate(), 'date');
  const result = await runMorningBrief({ date });
  await saveMorningBrief({ result, generatedBy: `manual:${req.user.username}` });
  res.json({ success: true, data: { ...result, cached: false } });
}));

app.get('/api/reports/morning-brief/history', authenticate, requirePermission('inbox:read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listMorningBriefs({ limit: Number(req.query.limit) || 30 }) });
}));

app.get('/api/reports/reconciliation', authenticate, requirePermission('report:read'), asyncHandler(async (req, res) => {
  const from = validateDate(req.query.from || new Date().toISOString().slice(0, 10), 'from');
  const to = validateDate(req.query.to || from, 'to');
  const params = [from, to];
  const branchClause = req.query.branch_id ? 'AND dr.branch_id = ?' : '';
  if (req.query.branch_id) params.push(Number(req.query.branch_id));
  const [rows] = await getPool().query(
    `SELECT dr.receipt_date, dr.status, b.name AS branch_name,
            dr.gross_sales_expected, dr.cash_expected, dr.morning_change_amount, dr.non_cash_expected,
            COALESCE(misc.misc_total, 0) AS misc_total,
            COALESCE(SUM(drl.cashier_amount), 0) + COALESCE(misc.misc_total, 0) AS cashier_total,
            COALESCE(SUM(drl.statement_amount), 0) + COALESCE(misc.misc_total, 0) AS verified_total,
            COALESCE(SUM(drl.variance_amount), 0) AS variance_total
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     LEFT JOIN (
       SELECT receipt_id, SUM(amount) AS misc_total
       FROM receipt_misc_items
       GROUP BY receipt_id
     ) misc ON misc.receipt_id = dr.id
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
        morning_change_total: sumMoney(rows.map((row) => row.morning_change_amount)),
        misc_total: sumMoney(rows.map((row) => row.misc_total)),
        cashier_total: sumMoney(rows.map((row) => row.cashier_total)),
        verified_total: sumMoney(rows.map((row) => row.verified_total)),
        variance_total: sumMoney(rows.map((row) => row.variance_total))
      }
    }
  });
}));

app.get('/api/google-sheets/monthly-daily.csv', asyncHandler(async (req, res) => {
  requireSheetsExportToken(req);
  const range = parseMonthRange(req.query.month);
  const [branches] = await getPool().query(
    `SELECT id, code, clickhouse_branch_id
     FROM branches
     WHERE is_active = TRUE AND code IN ('KK', 'SK')
     ORDER BY code ASC`
  );
  const [receiptRows] = await getPool().query(
    `SELECT DATE_FORMAT(dr.receipt_date, '%Y-%m-%d') AS business_date,
            b.code AS branch_code, dr.gross_sales_expected, dr.status, dr.updated_at,
            dr.morning_change_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'CASH' THEN drl.cashier_amount ELSE 0 END), 0) AS cash_cashier_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'CREDIT_CARD_SCB' THEN drl.cashier_amount ELSE 0 END), 0) AS scb_credit_cashier_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KPLUS' THEN drl.cashier_amount ELSE 0 END), 0) AS qr_kplus_cashier_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KPLUS' THEN drl.statement_amount ELSE 0 END), 0) AS qr_kplus_closed_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KPLUS' AND EXISTS (
              SELECT 1 FROM statement_transactions st
              WHERE st.receipt_line_id = drl.id
                AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')
            ) THEN 1 ELSE 0 END), 0) AS qr_kplus_closed_count,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KRUNGSRI' THEN drl.cashier_amount ELSE 0 END), 0) AS qr_krungsri_cashier_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KRUNGSRI' THEN drl.statement_amount ELSE 0 END), 0) AS qr_krungsri_closed_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'QR_KRUNGSRI' AND EXISTS (
              SELECT 1 FROM statement_transactions st
              WHERE st.receipt_line_id = drl.id
                AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')
            ) THEN 1 ELSE 0 END), 0) AS qr_krungsri_closed_count,
            COALESCE(SUM(CASE WHEN pc.code = 'GRAB' THEN drl.cashier_amount ELSE 0 END), 0) AS grab_cashier_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'GRAB'
              AND rlr.settlement_source IN ('BANK_STATEMENT', 'BANK_SETTLEMENT')
              THEN drl.statement_amount ELSE 0 END), 0) AS grab_bank_statement_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'GRAB'
              AND rlr.settlement_source IN ('BANK_STATEMENT', 'BANK_SETTLEMENT')
              THEN 1 ELSE 0 END), 0) AS grab_bank_statement_count,
            (
              SELECT bit.raw_payload
              FROM bank_inbox_transactions bit
              JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
              JOIN daily_receipt_lines grab_line ON grab_line.id = bit.receipt_line_id
              JOIN payment_channels grab_channel
                ON grab_channel.id = grab_line.payment_channel_id AND grab_channel.code = 'GRAB'
              WHERE grab_line.receipt_id = dr.id AND bi.provider = 'GRAB_DAILY'
              ORDER BY bi.id DESC, bit.id DESC
              LIMIT 1
            ) AS grab_report_payload
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     LEFT JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     WHERE dr.receipt_date BETWEEN ? AND ?
       AND b.code IN ('KK', 'SK')
     GROUP BY dr.id, b.code`,
    [range.from, range.to]
  );
  const receiptByDateBranch = new Map(
    receiptRows.map((row) => [`${row.business_date}:${row.branch_code}`, row])
  );
  const [miscRows] = await getPool().query(
    `SELECT DATE_FORMAT(dr.receipt_date, '%Y-%m-%d') AS business_date,
            b.code AS branch_code, rmi.label, rmi.amount
     FROM receipt_misc_items rmi
     JOIN daily_receipts dr ON dr.id = rmi.receipt_id
     JOIN branches b ON b.id = dr.branch_id
     WHERE dr.receipt_date BETWEEN ? AND ?
       AND b.code IN ('KK', 'SK')
     ORDER BY dr.receipt_date ASC, b.code ASC, rmi.id ASC`,
    [range.from, range.to]
  );
  const miscByDateBranch = new Map();
  miscRows.forEach((row) => {
    const key = `${row.business_date}:${row.branch_code}`;
    const items = miscByDateBranch.get(key) || [];
    items.push({ label: row.label, amount: row.amount });
    miscByDateBranch.set(key, items);
  });
  const expectedRows = await fetchExpectedSalesRange({
    from: range.from,
    to: range.to,
    branches
  });
  const expectedByDateBranch = new Map(
    expectedRows.map((row) => [`${row.businessDate}:${row.branchCode}`, row])
  );
  const rows = [];
  for (const businessDate of range.days) {
    for (const branch of branches) {
      const receipt = receiptByDateBranch.get(`${businessDate}:${branch.code}`);
      const expected = expectedByDateBranch.get(`${businessDate}:${branch.code}`);
      const grab = grabAmountsForSheets({
        reportPayload: receipt?.grab_report_payload,
        cashierAmount: receipt?.grab_cashier_amount,
        status: receipt?.status,
        hasBankStatement: Number(receipt?.grab_bank_statement_count || 0) > 0,
        bankStatementAmount: receipt?.grab_bank_statement_amount
      });
      const cashierMisc = cashierMiscForSheets({
        items: miscByDateBranch.get(`${businessDate}:${branch.code}`) || [],
        status: receipt?.status
      });
      rows.push({
        business_date: businessDate,
        day: Number(businessDate.slice(-2)),
        branch_code: branch.code,
        // Export the current read-only POS expectation even when an already-submitted
        // receipt is intentionally immutable. A missing POS row is a real zero day.
        gross_sales_expected: roundMoney(expected?.grossSalesExpected || 0),
        cash_plus_change: cashPlusChangeForSheets({
          status: receipt?.status,
          cashCashierAmount: receipt?.cash_cashier_amount,
          morningChangeAmount: receipt?.morning_change_amount
        }),
        morning_change: morningChangeForSheets({
          status: receipt?.status,
          morningChangeAmount: receipt?.morning_change_amount
        }),
        // รูดเครดิต SCB เป็นยอดก่อนหักค่าธรรมเนียม จึงใช้ยอดที่
        // แคชเชียร์ส่งไว้ก่อน จนกว่าจะมีรายงานปิดยอดจากผู้ให้บริการบัตร
        // ส่วน Statement ธนาคารยังคงเป็นหลักของยอดสุทธิในอีกคอลัมน์หนึ่ง
        scb_credit_amount: closedAmountOrCashierForSheets({
          hasClosedAmount: false,
          cashierAmount: receipt?.scb_credit_cashier_amount,
          status: receipt?.status
        }),
        qr_kplus_amount: closedAmountOrCashierForSheets({
          hasClosedAmount: Number(receipt?.qr_kplus_closed_count || 0) > 0,
          closedAmount: receipt?.qr_kplus_closed_amount,
          cashierAmount: receipt?.qr_kplus_cashier_amount,
          status: receipt?.status
        }),
        qr_krungsri_amount: closedAmountOrCashierForSheets({
          hasClosedAmount: Number(receipt?.qr_krungsri_closed_count || 0) > 0,
          closedAmount: receipt?.qr_krungsri_closed_amount,
          cashierAmount: receipt?.qr_krungsri_cashier_amount,
          status: receipt?.status
        }),
        grab_sales_amount: grab.salesAmount,
        grab_fee_20_amount: grab.fee20Amount,
        grab_ads_promotion_amount: grab.adsPromotionAmount,
        grab_bank_amount: grab.bankAmount,
        grab_source: grab.source,
        cashier_misc_total: cashierMisc.amount,
        cashier_misc_note: cashierMisc.note,
        cashier_food_staff_amount: cashierMisc.categories.foodStaff.amount,
        cashier_food_staff_note: cashierMisc.categories.foodStaff.note,
        cashier_house_jum_amount: cashierMisc.categories.houseJum.amount,
        cashier_house_jum_note: cashierMisc.categories.houseJum.note,
        cashier_house_pen_amount: cashierMisc.categories.housePen.amount,
        cashier_house_pen_note: cashierMisc.categories.housePen.note,
        cashier_grandma_amount: cashierMisc.categories.grandma.amount,
        cashier_grandma_note: cashierMisc.categories.grandma.note,
        cashier_credit_jum_pen_amount: cashierMisc.categories.creditJumPen.amount,
        cashier_credit_jum_pen_note: cashierMisc.categories.creditJumPen.note,
        cashier_member_amount: cashierMisc.categories.member.amount,
        cashier_member_note: cashierMisc.categories.member.note,
        status: receipt?.status || '',
        status_label: googleSheetsStatusLabel(receipt?.status),
        updated_at: receipt?.updated_at || ''
      });
    }
  }

  sendCsv(
    res,
    `general-cashflow-monthly-daily-${range.month}.csv`,
    [
      { key: 'business_date', header: 'business_date' },
      { key: 'day', header: 'day' },
      { key: 'branch_code', header: 'branch_code' },
      { key: 'gross_sales_expected', header: 'gross_sales_expected' },
      { key: 'cash_plus_change', header: 'cash_plus_change' },
      { key: 'morning_change', header: 'morning_change' },
      { key: 'scb_credit_amount', header: 'scb_credit_amount' },
      { key: 'qr_kplus_amount', header: 'qr_kplus_amount' },
      { key: 'qr_krungsri_amount', header: 'qr_krungsri_amount' },
      { key: 'grab_sales_amount', header: 'grab_sales_amount' },
      { key: 'grab_fee_20_amount', header: 'grab_fee_20_amount' },
      { key: 'grab_ads_promotion_amount', header: 'grab_ads_promotion_amount' },
      { key: 'grab_bank_amount', header: 'grab_bank_amount' },
      { key: 'grab_source', header: 'grab_source' },
      { key: 'cashier_misc_total', header: 'cashier_misc_total' },
      { key: 'cashier_misc_note', header: 'cashier_misc_note' },
      { key: 'cashier_food_staff_amount', header: 'cashier_food_staff_amount' },
      { key: 'cashier_food_staff_note', header: 'cashier_food_staff_note' },
      { key: 'cashier_house_jum_amount', header: 'cashier_house_jum_amount' },
      { key: 'cashier_house_jum_note', header: 'cashier_house_jum_note' },
      { key: 'cashier_house_pen_amount', header: 'cashier_house_pen_amount' },
      { key: 'cashier_house_pen_note', header: 'cashier_house_pen_note' },
      { key: 'cashier_grandma_amount', header: 'cashier_grandma_amount' },
      { key: 'cashier_grandma_note', header: 'cashier_grandma_note' },
      { key: 'cashier_credit_jum_pen_amount', header: 'cashier_credit_jum_pen_amount' },
      { key: 'cashier_credit_jum_pen_note', header: 'cashier_credit_jum_pen_note' },
      { key: 'cashier_member_amount', header: 'cashier_member_amount' },
      { key: 'cashier_member_note', header: 'cashier_member_note' },
      { key: 'status', header: 'status' },
      { key: 'status_label', header: 'status_label' },
      { key: 'updated_at', header: 'updated_at' }
    ],
    rows
  );
}));

// Read-only machine contract for the standalone management-accounting service.
// All six handlers share the same strict validation, masking, ordering and
// pagination code.  The DB adapter is SELECT-only and can be replaced by
// local fixtures in unit/contract tests.
const accountingExportHandlers = createAccountingExportHandlers({
  loadRows: fetchAccountingExportRows,
  authenticate: async (req) => requireAccountingExportToken(req)
});
app.get('/accounting-export/daily-sales', accountingExportHandlers.pos_daily_sale);
app.get('/accounting-export/daily-receipts', accountingExportHandlers.receipt_day);
app.get('/accounting-export/daily-receipt-lines', accountingExportHandlers.receipt_expectation);
app.get('/accounting-export/settlements', accountingExportHandlers.cash_settlement);
app.get('/accounting-export/payment-channels', accountingExportHandlers.payment_channel);
app.get('/accounting-export/receiving-accounts', accountingExportHandlers.receiving_account);

app.get('/api/google-sheets/reconciliation.csv', asyncHandler(async (req, res) => {
  requireSheetsExportToken(req);
  const fallbackRange = defaultReportRange();
  const from = validateDate(req.query.from || fallbackRange.from, 'from');
  const to = validateDate(req.query.to || fallbackRange.to, 'to');
  const params = [from, to];
  const branchClause = req.query.branch_id ? 'AND dr.branch_id = ?' : '';
  if (req.query.branch_id) params.push(Number(req.query.branch_id));
  const checkedStatusSql = "dr.status IN ('CHECKED_OK', 'CHECKED_VARIANCE', 'CLOSED')";

  const [rows] = await getPool().query(
    `SELECT dr.id AS receipt_id, dr.receipt_date, dr.status, b.id AS branch_id, b.code AS branch_code,
            b.name AS branch_name, dr.morning_change_amount,
            COALESCE(SUM(CASE WHEN pc.code = 'CASH' THEN drl.cashier_amount ELSE 0 END), 0) AS cashier_cash_amount,
            COALESCE(SUM(CASE WHEN pc.code <> 'CASH' THEN drl.cashier_amount ELSE 0 END), 0) AS cashier_non_cash_amount,
            COALESCE(SUM(drl.cashier_amount), 0) AS cashier_channel_total,
            COALESCE(misc.misc_total, 0) AS misc_total,
            COALESCE(SUM(drl.cashier_amount), 0) + COALESCE(misc.misc_total, 0) AS cashier_counted_total,
            CASE WHEN ${checkedStatusSql} THEN 'TRUE' ELSE 'FALSE' END AS is_checked,
            dr.checked_at, dr.submitted_at
     FROM daily_receipts dr
     JOIN branches b ON b.id = dr.branch_id
     LEFT JOIN daily_receipt_lines drl ON drl.receipt_id = dr.id
     LEFT JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     LEFT JOIN (
       SELECT receipt_id, SUM(amount) AS misc_total
       FROM receipt_misc_items
       GROUP BY receipt_id
     ) misc ON misc.receipt_id = dr.id
     WHERE dr.receipt_date BETWEEN ? AND ?
       ${branchClause}
     GROUP BY dr.id
     ORDER BY dr.receipt_date DESC, b.name ASC`,
    params
  );

  sendCsv(
    res,
    `general-cashflow-cashier-summary-${from}-to-${to}.csv`,
    [
      { key: 'receipt_id', header: 'receipt_id' },
      { key: 'receipt_date', header: 'receipt_date' },
      { key: 'branch_id', header: 'branch_id' },
      { key: 'branch_code', header: 'branch_code' },
      { key: 'branch_name', header: 'branch_name' },
      { key: 'status', header: 'status' },
      { key: 'status_label', header: 'status_label' },
      { key: 'morning_change_amount', header: 'morning_change_amount' },
      { key: 'cashier_cash_amount', header: 'cashier_cash_amount' },
      { key: 'cashier_non_cash_amount', header: 'cashier_non_cash_amount' },
      { key: 'cashier_channel_total', header: 'cashier_channel_total' },
      { key: 'misc_total', header: 'misc_total' },
      { key: 'cashier_counted_total', header: 'cashier_counted_total' },
      { key: 'is_checked', header: 'is_checked' },
      { key: 'checked_at', header: 'checked_at' },
      { key: 'submitted_at', header: 'submitted_at' }
    ],
    rows.map((row) => ({ ...row, status_label: receiptStatusLabel(row.status) }))
  );
}));

app.get('/api/google-sheets/receipt-lines.csv', asyncHandler(async (req, res) => {
  requireSheetsExportToken(req);
  const fallbackRange = defaultReportRange();
  const from = validateDate(req.query.from || fallbackRange.from, 'from');
  const to = validateDate(req.query.to || fallbackRange.to, 'to');
  const params = [from, to];
  const branchClause = req.query.branch_id ? 'AND dr.branch_id = ?' : '';
  if (req.query.branch_id) params.push(Number(req.query.branch_id));
  const checkedStatusSql = "dr.status IN ('CHECKED_OK', 'CHECKED_VARIANCE', 'CLOSED')";

  const [rows] = await getPool().query(
    `SELECT *
     FROM (
       SELECT dr.id AS receipt_id, dr.receipt_date, dr.status, b.id AS branch_id, b.code AS branch_code,
              b.name AS branch_name, pc.sort_order, pc.id AS channel_sort_id,
              pc.code AS channel_code, pc.label AS channel_label, pc.kind AS channel_kind,
              pc.provider, drl.cashier_amount, NULL AS misc_item_label, NULL AS misc_item_id,
              CASE WHEN ${checkedStatusSql} OR drl.statement_amount <> 0 OR COALESCE(rlr.manual_checked_without_reference, FALSE) THEN 'TRUE' ELSE 'FALSE' END AS line_is_checked,
              CASE WHEN ${checkedStatusSql} THEN 'TRUE' ELSE 'FALSE' END AS receipt_is_checked,
              rlr.manual_checked_without_reference,
              rlr.manual_checked_at,
              dr.checked_at, dr.submitted_at
       FROM daily_receipt_lines drl
       JOIN daily_receipts dr ON dr.id = drl.receipt_id
       JOIN branches b ON b.id = dr.branch_id
       JOIN payment_channels pc ON pc.id = drl.payment_channel_id
       LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
       WHERE dr.receipt_date BETWEEN ? AND ?
         AND (
           pc.kind <> 'credit_card'
           OR (b.code = 'KK' AND pc.code IN ('CREDIT_CARD_SCB', 'CREDIT_CARD_KTC'))
           OR (b.code = 'SK' AND pc.code = 'CREDIT_CARD_KBANK')
           OR b.code NOT IN ('KK', 'SK')
         )
         ${branchClause}

       UNION ALL

       SELECT dr.id AS receipt_id, dr.receipt_date, dr.status, b.id AS branch_id, b.code AS branch_code,
              b.name AS branch_name, 10000 AS sort_order, rmi.id AS channel_sort_id,
              'MISC_ITEM' AS channel_code, rmi.label AS channel_label, 'misc' AS channel_kind,
              'cashier' AS provider, rmi.amount AS cashier_amount, rmi.label AS misc_item_label,
              rmi.id AS misc_item_id,
              CASE WHEN ${checkedStatusSql} THEN 'TRUE' ELSE 'FALSE' END AS line_is_checked,
              CASE WHEN ${checkedStatusSql} THEN 'TRUE' ELSE 'FALSE' END AS receipt_is_checked,
              NULL AS manual_checked_without_reference,
              NULL AS manual_checked_at,
              dr.checked_at, dr.submitted_at
       FROM receipt_misc_items rmi
       JOIN daily_receipts dr ON dr.id = rmi.receipt_id
       JOIN branches b ON b.id = dr.branch_id
       WHERE dr.receipt_date BETWEEN ? AND ?
         ${branchClause}
     ) cashier_rows
     ORDER BY receipt_date DESC, branch_name ASC, sort_order ASC, channel_sort_id ASC`,
    [...params, ...params]
  );

  sendCsv(
    res,
    `general-cashflow-cashier-lines-${from}-to-${to}.csv`,
    [
      { key: 'receipt_id', header: 'receipt_id' },
      { key: 'receipt_date', header: 'receipt_date' },
      { key: 'branch_id', header: 'branch_id' },
      { key: 'branch_code', header: 'branch_code' },
      { key: 'branch_name', header: 'branch_name' },
      { key: 'status', header: 'status' },
      { key: 'status_label', header: 'status_label' },
      { key: 'channel_code', header: 'channel_code' },
      { key: 'channel_label', header: 'channel_label' },
      { key: 'channel_kind', header: 'channel_kind' },
      { key: 'provider', header: 'provider' },
      { key: 'cashier_amount', header: 'cashier_amount' },
      { key: 'misc_item_id', header: 'misc_item_id' },
      { key: 'misc_item_label', header: 'misc_item_label' },
      { key: 'line_is_checked', header: 'line_is_checked' },
      { key: 'receipt_is_checked', header: 'receipt_is_checked' },
      { key: 'manual_checked_without_reference', header: 'manual_checked_without_reference' },
      { key: 'manual_checked_at', header: 'manual_checked_at' },
      { key: 'checked_at', header: 'checked_at' },
      { key: 'submitted_at', header: 'submitted_at' }
    ],
    rows.map((row) => ({ ...row, status_label: receiptStatusLabel(row.status) }))
  );
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
await repairDuplicateKplusShopSettlements();
console.log('[kbank-monthly-qr]', await repairKasikornMonthlyQrComparisons());
await repairSecondaryKplusIncome();
await repairLegacyKrungsriInboxImports();
await autoLinkPendingKrungsriInboxImports();
await autoLinkPendingScbInboxImports();
await refreshGrabCashierExpectedAmounts();
await repairLegacyKrungthaiKtcAttachments();
await repairDuplicateKrungthaiKtcTransactions();
await repairGroupedKrungthaiKtcSettlements();
await repairLegacyInboxEvidence();
console.log('[kplus-reference]', await repairLegacyKplusReferences(getPool()));
console.log('[krungsri-evidence]', await repairKrungsriCombinedEvidence(getPool(), uploadRoot));

// ตั้งเวลาสร้างสรุปตอนเช้า ปิดอยู่โดยปริยายจนกว่าจะตั้ง CASHFLOW_BRIEF_SCHEDULE_HHMM
startMorningBriefSchedule();

app.listen(config.port, config.host, () => {
  console.log(`general-cashflow API running on http://${config.host}:${config.port}`);
});
