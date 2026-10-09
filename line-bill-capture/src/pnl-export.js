import { expenseSafeText } from './expense-profile-suggestions.js';
import crypto from 'node:crypto';

const rows = (database, sql, params) => {
  const statement = database.prepare(sql, params);
  try {
    const result = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
};
const parse = (value) => {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};
const memberIds = (transactions) => [...new Set(transactions.flatMap((transaction) => [
  ...(transaction.bill_members || []).map((bill) => Number(bill.bill_id)),
  ...(transaction.slip_members || []).map((slip) => Number(slip.slip_id))
]).filter((id) => Number.isSafeInteger(id) && id > 0))];

// Read only the allowlisted facts. Provenance, recipient/account fields stay private.
const exportProfile = (row) => {
  const fields = parse(row.fields_json);
  const value = (key) => expenseSafeText(fields[key]?.value ?? null);
  return {
    item_id: Number(row.item_id), status: row.status, revision: Number(row.revision),
    transaction_type: value('transaction_type'), branch: value('branch'),
    department: value('department'), purpose: value('purpose'), supplier_name: value('supplier_name')
  };
};

export const readPnlExportProfiles = (database, { transactions = [], rounds = [] }, businessDateSql) => {
  const snapshots = rounds.map((round) => parse(round.summary_json));
  const ids = memberIds([...transactions, ...snapshots.flatMap((snapshot) => snapshot.transactions || [])]);
  const profiles = new Map();
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = ids.slice(offset, offset + 400);
    for (const row of rows(database, `SELECT item_id, status, revision, fields_json, updated_at
      FROM capture_expense_profiles WHERE item_id IN (${batch.map(() => '?').join(',')})`, batch)) {
      profiles.set(Number(row.item_id), { profile: exportProfile(row), updated_at: row.updated_at });
    }
  }
  const roundUpdated = new Map();
  rounds.forEach((round, index) => {
    // Snapshot members can live in another group/day (grouped matches/transfer anchor).
    const timestamps = memberIds(snapshots[index].transactions || [])
      .map((id) => profiles.get(id)?.updated_at).filter(Boolean);
    const scoped = rows(database, `SELECT MAX(p.updated_at) AS updated_at
      FROM capture_expense_profiles p JOIN capture_items ci ON ci.id = p.item_id
      WHERE ci.source_id = ? AND (${businessDateSql}) = ?`, [round.source_id, round.business_date])[0];
    if (scoped?.updated_at) timestamps.push(scoped.updated_at);
    roundUpdated.set(`${round.source_id}:${round.business_date}`, timestamps.sort().at(-1) || null);
  });
  return { profiles, roundUpdated };
};

export const profileForItem = (billId, transaction, profiles) => {
  for (const id of [billId, ...(transaction.slip_members || []).map((slip) => slip.slip_id)]) {
    const saved = profiles.get(Number(id));
    if (saved) return saved.profile;
  }
  return null;
};

export const addPnlExportFields = ({ items, snapshot, profiles }) => {
  const enhancedItems = items.map((item) => ({
    ...item, stable_key: `lbc:bill:${item.bill_id}`,
    expense_profile: profileForItem(item.bill_id, item.raw_transaction, profiles)
  }));
  // Closed snapshots only contain confirmed bill/slip matches or cash payments
  // joined to a bill (db.js buildDayClosingSnapshotSync). No standalone payment.
  const paymentsWithoutBill = [];
  const profileRevisions = [...enhancedItems, ...paymentsWithoutBill]
    .map((item) => [item.stable_key, item.expense_profile?.item_id ?? null, item.expense_profile?.revision ?? null])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    snapshot, recipients_by_item: items.map((item) => item.recipients_by_slip || []),
    pnl_profile_revisions: profileRevisions
  })).digest('hex');
  return { items: enhancedItems, payments_without_bill: paymentsWithoutBill, pnl_fields_version: 1, fingerprint };
};
