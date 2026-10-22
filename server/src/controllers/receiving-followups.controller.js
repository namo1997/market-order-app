import pool from '../config/database.js';
import { getExpectedItems } from '../models/receiving-documents.model.js';
import { resolveActorScope } from '../models/receiving-documents-helpers.js';
import { ensureQueueTables } from '../models/receiving-queue-schema.js';
import { assertFollowupManager, listFollowups, saveFollowup, updateFollowup } from '../models/receiving-followups-store.js';
import { createReceivingError } from '../services/receiving-ocr.service.js';
import { handleReceivingError } from './receiving-documents.controller.js';

export const endpoint = action => async (req, res, next) => {
  try {
    const result = await action(req);
    return res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (error) { return handleReceivingError(error, res, next, req); }
};
export const create = endpoint(async req => {
  const body = req.body || {};
  const note = body.note ?? '';
  if (typeof note !== 'string' || note.length > 300 || !/^((?:pg|sm):[1-9]\d*|none)$/.test(body.supplier_key || '')) {
    throw createReceivingError('VALIDATION_FAILED', 'ร้านหรือหมายเหตุไม่ถูกต้อง');
  }
  const scope = await resolveActorScope(pool, req.user);
  const branchId = Number(body.branch_id || scope.branchId);
  const departmentId = Number(body.department_id || scope.departmentId);
  if (!scope.isAdmin && (branchId !== scope.branchId || departmentId !== scope.departmentId)) {
    throw createReceivingError('FORBIDDEN', 'ไม่สามารถตามของต่างสาขาหรือแผนก');
  }
  if (!Number.isSafeInteger(branchId) || branchId <= 0 || !Number.isSafeInteger(departmentId) || departmentId <= 0) {
    throw createReceivingError('VALIDATION_FAILED', 'กรุณาระบุสาขาและแผนก');
  }
  const groups = await getExpectedItems({ user: req.user, branchId, departmentId, autoFollowup: false, includeInternalQuantities: true });
  const group = groups.find(item => item.supplier_key === body.supplier_key && item.branch_id === branchId && item.department_id === departmentId);
  if (!group) throw createReceivingError('NOT_FOUND', 'ไม่พบรายการค้างของร้านนี้');
  const result = await saveFollowup(pool, { group, actor: scope, note: note.trim() });
  const followup = result.followup ? { ...result.followup, pending_items: result.followup.pending_items.map(item => ({ order_item_id: item.order_item_id, product_name: item.product_name, unit_name: item.unit_name })) } : null;
  return { ...result, followup, message: result.created ? 'แจ้งบัญชีแล้ว' : 'แจ้งไปแล้ว' };
});
export const list = endpoint(async req => {
  assertFollowupManager(req.user);
  await ensureQueueTables(pool);
  return listFollowups(pool, { user: req.user, status: req.query?.status || 'open' });
});
export const update = endpoint(async req => {
  assertFollowupManager(req.user);
  await ensureQueueTables(pool);
  return updateFollowup(pool, { user: req.user, id: req.params.id, status: req.body?.status });
});
export const leads = endpoint(async req => {
  assertFollowupManager(req.user);
  await ensureQueueTables(pool);
  const [items] = await pool.query('SELECT supplier_key, lead_days FROM receiving_supplier_leads');
  return { items };
});
export const setLead = endpoint(async req => {
  if (!['admin', 'super_admin'].includes(req.user?.role)) throw createReceivingError('FORBIDDEN', 'เฉพาะผู้ดูแล');
  const key = req.params.supplierKey;
  const days = req.body?.lead_days;
  if (!/^(?:pg|sm):[1-9]\d*$/.test(key) || !Number.isInteger(days) || days < 0 || days > 90) {
    throw createReceivingError('VALIDATION_FAILED', 'ระยะเวลาส่งต้องเป็นจำนวนวัน 0–90');
  }
  const [rows] = await pool.query(key.startsWith('sm:') ? 'SELECT id FROM supplier_masters WHERE id = ? LIMIT 1' : 'SELECT id FROM product_groups WHERE id = ? LIMIT 1', [Number(key.slice(3))]);
  if (!rows.length) throw createReceivingError('NOT_FOUND', 'ไม่พบร้าน');
  await ensureQueueTables(pool);
  await pool.query(`INSERT INTO receiving_supplier_leads (supplier_key, lead_days, updated_by_user_id)
    VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE lead_days = VALUES(lead_days), updated_by_user_id = VALUES(updated_by_user_id)`,
  [key, days, req.user.id]);
  return { supplier_key: key, lead_days: days };
});
