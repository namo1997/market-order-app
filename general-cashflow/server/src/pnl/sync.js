import { cents, money, monthRange, parseBranchMap, pnlError, snapshotItems } from './domain.js';

export const createSync = ({ getPool, config, fetchImpl = fetch }) => async ({ month, userId, audit = async () => {} }) => {
  const range = monthRange(month);
  if (!config.baseUrl || !config.token) throw pnlError('PNL_NOT_CONFIGURED', 503);
  const connection = await getPool().getConnection();
  let locked = false; let runId;
  const stats = { rounds_seen: 0, rounds_refetched: 0, duplicate_keys: 0, moved_keys: 0 };
  const read = async (path) => {
    try {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(20000), redirect: 'error'
      });
      if (!response.ok) throw pnlError('LBC_EXPORT_HTTP_ERROR', 502);
      const payload = await response.json();
      if (payload.success !== true) throw pnlError('LBC_EXPORT_INVALID', 502);
      return payload;
    } catch (error) { throw pnlError(error.code?.startsWith('LBC_') ? error.code : 'LBC_EXPORT_REQUEST_FAILED', 502); }
  };
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('pnl_sync', 0) AS acquired");
    if (Number(lock.acquired) !== 1) throw pnlError('PNL_SYNC_RUNNING', 409);
    locked = true;
    const [created] = await connection.query(`INSERT INTO pnl_sync_runs
      (month_start, started_by, started_at, status) VALUES (?, ?, NOW(), 'RUNNING')`, [range.from, userId]);
    runId = created.insertId;
    const [branches] = await connection.query('SELECT id, code FROM branches');
    const mapping = parseBranchMap(config.branchMap);
    const branchFor = (source) => branches.find((row) => row.code === mapping[source])?.id ?? null;
    let offset = 0; const offsets = new Set();
    do {
      if (offsets.has(offset)) throw pnlError('LBC_EXPORT_INVALID', 502);
      offsets.add(offset);
      const page = await read(`/accounting-export/rounds?${new URLSearchParams({ from: range.from, to: range.to, limit: '500', offset: String(offset) })}`);
      if (!Array.isArray(page.data) || !page.pagination) throw pnlError('LBC_EXPORT_INVALID', 502);
      for (const round of page.data) {
        if (!round.id || !round.source_id || round.business_date < range.from || round.business_date > range.to
          || !['open', 'closed'].includes(round.status)) throw pnlError('LBC_EXPORT_INVALID', 502);
        stats.rounds_seen++;
        const [[cached]] = await connection.query('SELECT * FROM pnl_expense_rounds WHERE source_id = ? AND business_date = ?', [round.source_id, round.business_date]);
        const branchId = branchFor(round.source_id);
        if (round.status === 'closed' && cached?.status === 'closed' && cached.fingerprint === round.fingerprint
          && (cached.profile_max_updated_at || null) === (round.profile_max_updated_at || null)
          && (cached.branch_id ?? null) === branchId) continue;
        let snapshot; let prepared = { items: [], duplicateKeys: 0 };
        if (round.status === 'closed') {
          snapshot = (await read(`/accounting-export/rounds/${encodeURIComponent(round.id)}/snapshot`)).data;
          if (snapshot?.id !== round.id || snapshot?.status !== 'closed' || snapshot?.source_id !== round.source_id
            || snapshot?.business_date !== round.business_date) throw pnlError('LBC_EXPORT_INVALID', 502);
          prepared = snapshotItems(snapshot);
        }
        await connection.beginTransaction();
        let movedKeys = 0;
        try {
          await connection.query(`INSERT INTO pnl_expense_rounds (source_id, business_date, branch_id, status, revision,
            fingerprint, snapshot_fingerprint, profile_max_updated_at, item_count, amount_total,
            reimbursement_count, incoming_transfer_count, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE branch_id=VALUES(branch_id), status=VALUES(status), revision=VALUES(revision),
            fingerprint=VALUES(fingerprint), snapshot_fingerprint=VALUES(snapshot_fingerprint),
            profile_max_updated_at=VALUES(profile_max_updated_at), item_count=VALUES(item_count), amount_total=VALUES(amount_total),
            reimbursement_count=VALUES(reimbursement_count), incoming_transfer_count=VALUES(incoming_transfer_count), fetched_at=NOW()`,
          [round.source_id, round.business_date, branchId, round.status, round.revision || null, round.fingerprint || null,
            snapshot?.fingerprint || null, round.profile_max_updated_at || null, prepared.items.length,
            money(prepared.items.reduce((sum, item) => sum + cents(item.amount), 0)).toFixed(2),
            snapshot?.reimbursements?.length || 0, snapshot?.incoming_transfers?.length || 0]);
          const [[saved]] = await connection.query('SELECT id FROM pnl_expense_rounds WHERE source_id = ? AND business_date = ?', [round.source_id, round.business_date]);
          await connection.query('DELETE FROM pnl_expense_items WHERE round_id = ?', [saved.id]);
          const affected = new Set();
          for (const item of prepared.items) {
            const [old] = await connection.query('SELECT round_id FROM pnl_expense_items WHERE stable_key = ? AND round_id <> ?', [item.stable_key, saved.id]);
            old.forEach((row) => affected.add(row.round_id)); movedKeys += old.length;
            await connection.query('DELETE FROM pnl_expense_items WHERE stable_key = ?', [item.stable_key]);
            await connection.query(`INSERT INTO pnl_expense_items (stable_key, round_id, kind, branch_id, business_date,
              supplier_name, description, amount, payment_method, transaction_type, profile_status, bill_id, raw_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.stable_key, saved.id, item.kind, branchId, round.business_date, item.supplier_name, item.description,
              item.amount, item.payment_method, item.transaction_type, item.profile_status, item.bill_id, JSON.stringify(item)]);
          }
          for (const id of affected) await connection.query(`UPDATE pnl_expense_rounds SET
            item_count=(SELECT COUNT(*) FROM pnl_expense_items WHERE round_id=?),
            amount_total=(SELECT COALESCE(SUM(amount),0) FROM pnl_expense_items WHERE round_id=?) WHERE id=?`, [id, id, id]);
          await connection.commit();
        } catch (error) { await connection.rollback(); throw error; }
        stats.duplicate_keys += prepared.duplicateKeys; stats.moved_keys += movedKeys;
        if (snapshot) stats.rounds_refetched++;
      }
      offset = page.pagination.next_offset;
      if (offset != null && (!Number.isSafeInteger(offset) || offset < 0)) throw pnlError('LBC_EXPORT_INVALID', 502);
    } while (offset != null);
    await connection.query(`UPDATE pnl_sync_runs SET status='SUCCEEDED', finished_at=NOW(),
      rounds_seen=?, rounds_refetched=?, duplicate_keys=?, moved_keys=? WHERE id=?`, [...Object.values(stats), runId]);
    await audit({ id: runId, status: 'SUCCEEDED', ...stats });
    return { id: runId, status: 'SUCCEEDED', ...stats };
  } catch (error) {
    const code = ['PNL_SYNC_RUNNING', 'LBC_EXPORT_V2_REQUIRED', 'LBC_EXPORT_INVALID', 'LBC_EXPORT_HTTP_ERROR', 'LBC_EXPORT_REQUEST_FAILED'].includes(error.code) ? error.code : 'PNL_SYNC_FAILED';
    if (runId) {
      await connection.query(`UPDATE pnl_sync_runs SET status='FAILED', finished_at=NOW(), error_code=?,
        rounds_seen=?, rounds_refetched=?, duplicate_keys=?, moved_keys=? WHERE id=?`, [code, ...Object.values(stats), runId]);
      await audit({ id: runId, status: 'FAILED', error_code: code, ...stats });
    }
    throw pnlError(code, error.statusCode || 500);
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK('pnl_sync')"); }
    finally { connection.release(); }
  }
};
