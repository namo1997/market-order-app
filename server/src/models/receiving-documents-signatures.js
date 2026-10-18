import pool from '../config/database.js';
import { ensureReceivingDocumentsTables } from './receiving-documents-schema.js';
import { assertDocumentAccess, assertBlindCountComplete, resolveActorScope } from './receiving-documents-helpers.js';
import { createReceivingError, validatePositiveIntOrNull } from '../services/receiving-ocr.service.js';

export const getDocumentSignatureBinary = async ({ user, documentId, role } = {}) => {
  await ensureReceivingDocumentsTables();
  const docId = validatePositiveIntOrNull(documentId, 'id');
  if (!docId) throw createReceivingError('NOT_FOUND', 'ไม่พบเอกสารรับสินค้า');
  if (!['receiver', 'courier'].includes(role)) {
    throw createReceivingError('VALIDATION_FAILED', 'role สำหรับลายเซ็นต้องเป็น receiver หรือ courier เท่านั้น');
  }

  const scope = await resolveActorScope(pool, user);
  const [docs] = await pool.query(
    'SELECT id, status, branch_id, department_id, receiving_scope, counted_complete_at FROM receiving_documents WHERE id = ? LIMIT 1',
    [docId]
  );
  // Accounting cross-branch exception applies to this binary GET only, never writes.
  assertDocumentAccess((['accounting', 'accountant'].includes(user?.role) ? { ...scope, isAdmin: true } : scope), docs?.[0]);
  assertBlindCountComplete(docs[0]);

  // Fixed SQL only; authorize before retrieving signature bytes, as with bill images.
  const [rows] = await pool.query(
    'SELECT receiver_signature, courier_signature FROM receiving_documents WHERE id = ? LIMIT 1',
    [docId]
  );
  const signature = role === 'receiver' ? rows?.[0]?.receiver_signature : rows?.[0]?.courier_signature;
  if (!signature?.length) throw createReceivingError('NOT_FOUND', 'ไม่พบลายเซ็นที่ต้องการ');
  return { buffer: Buffer.isBuffer(signature) ? signature : Buffer.from(signature) };
};
