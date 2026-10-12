import { createHash } from 'node:crypto';
import { cents, money, pnlError } from './domain.js';

const amount = (value) => value != null && value !== '' && Number.isFinite(Number(value))
  && Number.isSafeInteger(cents(value)) ? cents(value) : null;
const componentKeys = ['commission_and_tax_amount', 'additional_commission_amount', 'marketing_fee_amount', 'merchant_delivery_discount_amount'];

export const grabFeeSource = (row) => {
  let payload = row.grab_report_payload;
  try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { return null; }
  if (!payload || row.channel_code !== 'GRAB' || row.status !== 'CLOSED' || row.settlement_batch_key) return null;
  const components = componentKeys.map((key) => amount(payload[key]));
  const adjustment = amount(payload.income_adjustment_amount);
  const gross = amount(payload.cashier_amount), net = amount(payload.net_amount);
  if (components.some((value) => value == null || value < 0) || adjustment == null || gross == null || net == null
    || gross !== amount(row.cashier_amount) || gross !== amount(row.expected_gross_amount)
    || net !== amount(row.expected_net_amount) || gross - net !== amount(row.fee_amount)) return null;
  const fee = components.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(fee) || gross - fee + adjustment !== net) return null;
  let identity = row.grab_report_identity;
  try { if (typeof identity === 'string') identity = JSON.parse(identity); } catch { return null; }
  if (identity != null && (!/^[1-9]\d*$/.test(String(identity.transaction_id))
    || !/^[1-9]\d*$/.test(String(identity.import_id)) || !/^[a-f0-9]{64}$/i.test(identity.checksum || ''))) return null;
  const fingerprint = createHash('sha256').update(JSON.stringify([
    'grab-fee-basis-v1', String(row.id), String(row.branch_id), row.branch_code, row.receipt_date,
    gross, net, amount(row.fee_amount), ...components, adjustment,
    identity ? [String(identity.transaction_id), String(identity.import_id), identity.checksum.toLowerCase()] : null
  ])).digest('hex');
  return { fee, adjustment, fingerprint, provenance: Boolean(identity) };
};

// Shared SELECT for both the report and the narrowly scoped preference mutation.
export const cashflowFeeSelect = `SELECT l.id, dr.branch_id, b.code AS branch_code, dr.receipt_date, dr.status, pc.code AS channel_code,
  l.cashier_amount, l.statement_amount, r.expected_gross_amount, r.expected_net_amount, r.matched_amount,
  r.settlement_source, r.settlement_status, r.fee_amount, r.settlement_batch_key, r.settlement_batch_allocated_fee_amount,
  (SELECT bit.raw_payload FROM bank_inbox_transactions bit JOIN bank_inbox_imports bi ON bi.id=bit.inbox_import_id
   WHERE bit.receipt_line_id=l.id AND bi.provider='GRAB_DAILY' ORDER BY bi.id DESC, bit.id DESC LIMIT 1) AS grab_report_payload,
  (SELECT JSON_OBJECT('transaction_id', bit.id, 'import_id', bi.id, 'checksum', bi.archive_checksum)
   FROM bank_inbox_transactions bit JOIN bank_inbox_imports bi ON bi.id=bit.inbox_import_id
   WHERE bit.receipt_line_id=l.id AND bi.provider='GRAB_DAILY' ORDER BY bi.id DESC, bit.id DESC LIMIT 1) AS grab_report_identity,
  (SELECT COUNT(*) FROM statement_transactions st WHERE st.receipt_line_id=l.id
   AND st.match_status IN ('matched_auto','matched_manual')) AS bank_match_count,
  (SELECT SUM(st.amount) FROM statement_transactions st WHERE st.receipt_line_id=l.id
   AND st.match_status IN ('matched_auto','matched_manual')) AS bank_match_amount
  FROM daily_receipt_lines l JOIN daily_receipts dr ON dr.id=l.receipt_id
  JOIN branches b ON b.id=dr.branch_id JOIN payment_channels pc ON pc.id=l.payment_channel_id
  LEFT JOIN receipt_line_reconciliations r ON r.receipt_line_id=l.id`;

export const registerGrabFeeBasisRoutes = ({ router, handler, mutate, text, audit }) => {
  const validate = (req) => {
    if (!/^[1-9]\d*$/.test(req.params.receiptLineId) || !Number.isSafeInteger(Number(req.params.receiptLineId))) throw pnlError('INVALID_ID');
    if (!Number.isSafeInteger(req.body.expected_version) || req.body.expected_version < 0) throw pnlError('INVALID_FEE_BASIS_VERSION');
    return { id: Number(req.params.receiptLineId), reason: text(req.body.reason, 500, true) };
  };
  const locked = async (connection, id) => {
    const [[row]] = await connection.query(`${cashflowFeeSelect} WHERE l.id=? FOR UPDATE`, [id]);
    if (!row || row.channel_code !== 'GRAB') throw pnlError('GRAB_FEE_LINE_NOT_FOUND', 404);
    const [[old]] = await connection.query('SELECT * FROM pnl_grab_fee_basis WHERE receipt_line_id=? FOR UPDATE', [id]);
    return { row, old };
  };
  const currentVersion = (old, expected) => {
    if (Number(old?.version || 0) !== expected) throw pnlError('GRAB_FEE_BASIS_CONFLICT', 409);
  };
  router.put('/cashflow-fees/:receiptLineId/sheet-basis', handler(async (req) => {
    const { id, reason } = validate(req);
    if (!['before_adjustment', 'net'].includes(req.body.treatment)) throw pnlError('INVALID_GRAB_FEE_TREATMENT');
    const reference = text(req.body.reference, 300, true);
    if (!/^[a-f0-9]{64}$/.test(req.body.source_fingerprint || '')) throw pnlError('INVALID_GRAB_FEE_FINGERPRINT');
    return mutate(req, async (connection) => {
      const { row, old } = await locked(connection, id);
      currentVersion(old, req.body.expected_version);
      const source = grabFeeSource(row);
      if (!source?.provenance || source.fingerprint !== req.body.source_fingerprint) throw pnlError('GRAB_FEE_SOURCE_CHANGED', 409);
      const after = { receipt_line_id: id, treatment: req.body.treatment, source_fingerprint: source.fingerprint,
        reference, reason, version: Number(old?.version || 0) + 1, deleted_at: null };
      await connection.query(`INSERT INTO pnl_grab_fee_basis
        (receipt_line_id, treatment, source_fingerprint, reference, reason, version, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE treatment=VALUES(treatment),
        source_fingerprint=VALUES(source_fingerprint), reference=VALUES(reference), reason=VALUES(reason),
        version=VALUES(version), updated_by=VALUES(updated_by), updated_at=NOW(), deleted_at=NULL`,
      [id, after.treatment, after.source_fingerprint, reference, reason, after.version, req.user.id]);
      await audit(connection, req, 'pnl_grab_fee_basis', id, 'pnl.grab_fee_basis.save', old, after);
      return { ...after, amount: money(after.treatment === 'before_adjustment' ? source.fee : cents(row.fee_amount)) };
    });
  }));
  router.delete('/cashflow-fees/:receiptLineId/sheet-basis', handler(async (req) => {
    const { id, reason } = validate(req);
    return mutate(req, async (connection) => {
      const { old } = await locked(connection, id);
      currentVersion(old, req.body.expected_version);
      if (!old || old.deleted_at) throw pnlError('GRAB_FEE_BASIS_NOT_FOUND', 404);
      const after = { receipt_line_id: id, version: Number(old.version) + 1, deleted: true, reason };
      await connection.query('UPDATE pnl_grab_fee_basis SET deleted_at=NOW(), updated_at=NOW(), updated_by=?, version=? WHERE receipt_line_id=?',
        [req.user.id, after.version, id]);
      await audit(connection, req, 'pnl_grab_fee_basis', id, 'pnl.grab_fee_basis.delete', old, after);
      return after;
    });
  }));
};
