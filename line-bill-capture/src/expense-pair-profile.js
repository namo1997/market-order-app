// Shared expense facts belong to the selected bill; pair review is immutable evidence.
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const query = (db, sql, params = []) => { const s = db.prepare(sql, params); try { const rows = []; while (s.step()) rows.push(s.getAsObject()); return rows; } finally { s.free(); } };
const parse = v => { try { return JSON.parse(v) || {}; } catch { return {}; } };
const bills = new Set(['bill', 'bill_page', 'payment_voucher']);
const slips = new Set(['transfer', 'transfer_notice', 'incoming_transfer']);
export const resolveExpensePairContext = (db, { matchId, ownerId, itemIds, expectedRevisions } = {}) => {
  if (!Number.isSafeInteger(matchId) || matchId <= 0) return { error: 'pair_context_invalid' };
  const match = query(db, 'SELECT * FROM capture_matches WHERE id=?', [matchId])[0];
  if (!match || !['pending','manual_review','confirmed'].includes(match.status)) return { error: 'pair_membership_changed' };
  const ids = [Number(match.bill_item_id), Number(match.slip_item_id)];
  if (ownerId != null && Number(ownerId) !== ids[0]) return { error: 'pair_owner_invalid' };
  if (itemIds !== undefined && (!Array.isArray(itemIds) || itemIds.length !== 2 || !itemIds.every(Number.isSafeInteger)
    || new Set(itemIds).size !== 2 || !ids.every(id => itemIds.includes(id)))) return { error: 'pair_membership_changed' };
  const items = ids.map(id => query(db, 'SELECT * FROM capture_items WHERE id=?', [id])[0]);
  if (items.some(i => !i || ['unsent','duplicate'].includes(i.status)) || !bills.has(items[0].category) || !slips.has(items[1].category)) return { error: 'pair_items_unavailable' };
  const grouped = match.match_group_key ? query(db, `SELECT * FROM capture_matches WHERE match_group_key=? AND status IN ('pending','manual_review','confirmed')`, [match.match_group_key]) : [match];
  if (grouped.some(m => Number(m.bill_item_id) !== ids[0] || Number(m.slip_item_id) !== ids[1])) return { error: 'pair_scope_unsupported' };
  const others = query(db, `SELECT id FROM capture_matches WHERE status='confirmed' AND id<>? AND (bill_item_id IN (?,?) OR slip_item_id IN (?,?))`, [matchId,...ids,...ids]);
  if (others.length) return { error: 'pair_scope_unsupported' };
  const saved = ids.map(id => query(db, 'SELECT * FROM capture_expense_profiles WHERE item_id=?', [id])[0]);
  const revisions = Object.fromEntries(ids.map((id,i) => [id, Number(saved[i]?.revision || 0)]));
  if (expectedRevisions !== undefined && (!plain(expectedRevisions) || Object.keys(expectedRevisions).length !== 2
    || !ids.every(id => Number.isSafeInteger(expectedRevisions[id]) && expectedRevisions[id] === revisions[id]))) return { error: 'pair_revision_conflict', current_revisions: revisions };
  return { match_id: matchId, primary_item_id: ids[0], item_ids: ids, expected_revisions: revisions,
    match_group_key: match.match_group_key || null,
    members: items.map(item => ({ item_id: Number(item.id), source_type: item.source_type, source_id: item.source_id, category: item.category, status: item.status, file_sha256: item.file_sha256 || null })),
    legacy_slip_profile: saved[1] ? { item_id: ids[1], revision: revisions[ids[1]], status: saved[1].status,
      has_values: Object.values(parse(saved[1].fields_json)).some(f => f?.value != null && f.value !== '') } : null };
};
export const validateExpensePairInput = (db, ownerId, context) => {
  if (!plain(context) || Object.keys(context).some(k => !['match_id','item_ids','expected_revisions'].includes(k))
    || !Object.hasOwn(context,'item_ids') || !Object.hasOwn(context,'expected_revisions')) return { error: 'pair_context_invalid' };
  return resolveExpensePairContext(db, { matchId: context.match_id, ownerId, itemIds: context.item_ids, expectedRevisions: context.expected_revisions });
};
export const readExpensePairContext = (db, { matchId, ownerId, itemIds } = {}) => {
  const scope = resolveExpensePairContext(db, { matchId, ownerId, itemIds });
  if (scope.error) return scope;
  const owner = query(db, 'SELECT * FROM capture_expense_profiles WHERE item_id=?', [scope.primary_item_id])[0];
  const row = owner ? query(db, 'SELECT evidence_snapshot_json FROM capture_expense_profile_revisions WHERE item_id=? AND revision=?', [scope.primary_item_id, owner.revision])[0] : null;
  const bound = parse(row?.evidence_snapshot_json).pair_scope;
  const membership_valid = Boolean(bound && bound.match_id === scope.match_id && bound.primary_item_id === scope.primary_item_id
    && JSON.stringify(bound.item_ids) === JSON.stringify(scope.item_ids) && bound.match_group_key === scope.match_group_key
    && bound.expected_revisions?.[scope.item_ids[1]] === scope.expected_revisions[scope.item_ids[1]]);
  return { ...scope, canonical_item_id: scope.primary_item_id, revision: Number(owner?.revision || 0),
    status: membership_valid ? owner.status : 'draft', shared_status: membership_valid ? owner.status : owner ? 'needs_pair_review' : 'none',
    membership_valid, needs_review: !membership_valid || owner?.status !== 'reviewed' };
};
