import { hasPendingQuantity } from './receiving-queue';
import { branchOrderIds } from './receiving-branch';
import { clearPending, ensurePending, pendingKey, readPending } from './receiving-utils';
import { reusableDraft } from './draft-reuse';

// localStorage in try/catch ครอบคลุม browser ที่ไม่ยอมให้เข้าถึง storage
export const pendingStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
export const pendingOrderIds = group => branchOrderIds((group?.items || []).filter(hasPendingQuantity));
export const selectedIdentity = supplier => supplier.supplier_master_id
  ? { supplier_master_id: supplier.supplier_master_id }
  : { product_group_id: supplier.product_group_id };
export const groupIdentity = group => {
  const supplier = group?.supplier_key?.split(':');
  return supplier?.[0] === 'pg' ? { product_group_id: Number(supplier[1]) }
    : supplier?.[0] === 'sm' ? { supplier_master_id: Number(supplier[1]) } : {};
};
export const createPayload = ({ kind = 'bill', date, user, name, ids, identity = {} }) => ({
  delivery_date: date, kind, resume_draft: true, scope: user.receiving_scope || 'department', supplier_name_text: String(name || '').trim(), order_item_ids: ids, ...identity,
  ...(['admin', 'super_admin'].includes(user.role) ? { branch_id: Number(user.branch_id), ...(user.receiving_scope !== 'branch' ? { department_id: Number(user.department_id) } : {}) } : {}),
});

const sameSet = (a = [], b = []) => a.length === b.length && a.every(id => b.includes(id));
// A stored request from a failed attempt may be retried silently only when it is
// exactly the request this tap would send; anything else needs the resume sheet.
const matchesPending = (pending, wanted) => pending.delivery_date === wanted.delivery_date && pending.kind === wanted.kind
  && (pending.scope || 'department') === wanted.scope && pending.supplier_name_text === wanted.supplier_name_text
  && Number(pending.supplier_master_id || 0) === Number(wanted.supplier_master_id || 0)
  && Number(pending.product_group_id || 0) === Number(wanted.product_group_id || 0)
  && sameSet(pending.order_item_ids, wanted.order_item_ids);

// Scan-first entry: choose a shop, then create the receipt with defaults (all
// pending items of that shop) without the setup sheet. Uses the same request,
// idempotency key (client_uuid) and draft reuse as the sheet.
// Returns { document, reused } or { needsSheet: true } when a different unsent
// request is stored (the sheet shows the resume choice for it).
export async function startReceiving({ api, storage = pendingStorage, group, kind = 'bill', date, user, documents = [] }) {
  const key = pendingKey(user);
  const wanted = createPayload({ kind, date, user, name: group.supplier_name, ids: pendingOrderIds(group), identity: groupIdentity(group) });
  const stored = readPending(key, storage);
  if (stored && !matchesPending(stored, wanted)) return { needsSheet: true };
  let document, reused = false;
  const existing = stored ? null : reusableDraft(documents, { group, date, user });
  if (existing) { document = await api.get(existing.id); reused = true; }
  else {
    const result = ensurePending(key, wanted, stored, storage);
    document = await api.create(result.payload);
    // ล้างเมื่อ server ตอบสำเร็จเท่านั้น; คำขอซ้ำระหว่างรอใช้รหัสเดิม
    clearPending(key, storage);
  }
  // No-bill request on a draft that is still a blind bill: switch it (before the count).
  if (kind === 'manual_receipt' && document.status === 'draft' && document.kind === 'bill' && !document.counted_complete_at) {
    document = await api.update(document.id, { kind: 'manual_receipt' });
  }
  return { document, reused };
}
