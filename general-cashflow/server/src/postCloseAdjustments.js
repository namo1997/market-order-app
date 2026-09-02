import { logAudit } from './db.js';
import { assertPermission } from './domain/permissions.js';
import { receiptConfirmationFields } from './domain/receiptClosing.js';
import { branchSupportsPaymentChannel } from './domain/paymentChannels.js';
import { roundMoney } from './domain/money.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

export const validatePostCloseAdjustment = (input) => {
  const raw = String(input.amount ?? '').trim();
  if (!/^[+-]?\d{1,12}(\.\d{1,2})?$/.test(raw)) fail('ระบุยอดเพิ่มหรือลดเป็นตัวเลขไม่เกิน 2 ตำแหน่ง');
  const amount = roundMoney(Number(raw));
  if (!amount || Math.abs(amount) > 999999999999.99) fail('ยอดปรับปรุงต้องไม่เป็นศูนย์และต้องไม่เกินวงเงินที่ระบบรองรับ');
  const reason = String(input.reason || '').trim();
  if (!reason || reason.length > 1000) fail('กรุณาระบุเหตุผลการปรับปรุงไม่เกิน 1,000 ตัวอักษร');
  const lineId = Number(input.receipt_line_id);
  const revision = Number(input.expected_revision);
  if (!Number.isSafeInteger(lineId) || lineId <= 0) fail('ช่องทางรับเงินไม่ถูกต้อง');
  if (input.expected_revision == null || !Number.isSafeInteger(revision) || revision < 0) fail('ไม่พบรุ่นข้อมูล กรุณาโหลดเอกสารใหม่');
  const requestId = String(input.request_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) fail('รหัสคำขอไม่ถูกต้อง');
  return { amount, reason, lineId, revision, requestId };
};

export const loadPostCloseAdjustments = async (connection, receiptId) => {
  const [rows] = await connection.query(
    `SELECT a.*, UNIX_TIMESTAMP(a.created_at) * 1000 AS created_at_epoch_ms, u.full_name AS actor_name
     FROM receipt_post_close_adjustments a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.receipt_id = ? ORDER BY a.revision`, [receiptId]
  );
  return rows;
};

export const createPostCloseAdjustment = async (pool, { receiptId, input, actor }) => {
  assertPermission(actor, 'receipt:adjust-closed');
  const value = validatePostCloseAdjustment(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize every adjustment for a receipt before checking its revision or retry key.
    const [[receipt]] = await connection.query(
      `SELECT dr.*, b.code AS branch_code FROM daily_receipts dr JOIN branches b ON b.id = dr.branch_id
       WHERE dr.id = ? FOR UPDATE`, [receiptId]
    );
    if (!receipt) fail('ไม่พบเอกสาร', 404);
    if (receipt.status !== 'CLOSED') fail('ใช้ใบปรับปรุงหลังปิดได้เฉพาะเอกสารที่ปิดแล้ว', 409);
    const notes = await loadPostCloseAdjustments(connection, receiptId);
    const duplicate = notes.find((note) => note.request_id === value.requestId);
    if (duplicate) {
      if (Number(duplicate.receipt_line_id) !== value.lineId || Number(duplicate.amount) !== value.amount || duplicate.reason !== value.reason || Number(duplicate.created_by) !== Number(actor.id)) {
        fail('รหัสคำขอเดิมมีข้อมูลต่างกัน กรุณาโหลดเอกสารใหม่', 409);
      }
      await connection.commit();
      return { id: duplicate.id, duplicate: true };
    }
    if (notes.length !== value.revision) fail('มีผู้ปรับปรุงเอกสารนี้แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนยืนยัน', 409);
    const [lines] = await connection.query(
      `SELECT drl.*, pc.code AS channel_code, pc.label AS channel_label, rlr.fee_amount,
              rlr.settlement_batch_key, rlr.settlement_batch_allocated_net_amount, rlr.settlement_batch_allocated_fee_amount
       FROM daily_receipt_lines drl JOIN payment_channels pc ON pc.id = drl.payment_channel_id
       LEFT JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id WHERE drl.receipt_id = ?`, [receiptId]
    );
    const line = lines.find((item) => item.id === value.lineId);
    if (!line || !branchSupportsPaymentChannel(receipt.branch_code, line.channel_code)) fail('ช่องทางนี้ไม่อยู่ในเอกสารหรือสาขาที่เลือก');
    const [miscItems] = await connection.query('SELECT amount FROM receipt_misc_items WHERE receipt_id = ?', [receiptId]);
    const original = receiptConfirmationFields({ ...receipt, lines, misc_items: miscItems });
    const previous = notes.at(-1);
    const beforeTotal = Number(previous?.reconciled_total_after ?? original.confirmed_reconciled_total);
    const beforeVariance = Number(previous?.variance_total_after ?? original.confirmed_variance_total);
    const afterTotal = roundMoney(beforeTotal + value.amount);
    const afterVariance = roundMoney(beforeVariance + value.amount);
    if ([afterTotal, afterVariance].some((n) => !Number.isFinite(n) || Math.abs(n) > 999999999999.99)) fail('ยอดรวมหลังปรับปรุงเกินวงเงินที่ระบบรองรับ');
    const [result] = await connection.query(
      `INSERT INTO receipt_post_close_adjustments
       (receipt_id, receipt_line_id, revision, request_id, channel_label, amount, reason, created_by,
        reconciled_total_before, reconciled_total_after, variance_total_before, variance_total_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, line.id, notes.length + 1, value.requestId, line.channel_label, value.amount, value.reason,
        actor.id, beforeTotal, afterTotal, beforeVariance, afterVariance]
    );
    await logAudit({ connection, entityType: 'daily_receipt', entityId: receiptId,
      action: 'post_close_adjustment', actor, note: value.reason,
      beforePayload: { revision: notes.length, reconciled_total: beforeTotal, variance_total: beforeVariance },
      afterPayload: { adjustment_id: result.insertId, receipt_line_id: line.id, amount: value.amount,
        revision: notes.length + 1, reconciled_total: afterTotal, variance_total: afterVariance } });
    await connection.commit();
    return { id: result.insertId, duplicate: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
};
