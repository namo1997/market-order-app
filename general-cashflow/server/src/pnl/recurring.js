import { monthRange, pnlError, cents } from './domain.js';

export const shiftMonth = (month, delta) => {
  monthRange(month);
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
};
export const validateRecurringStart = (month, now = new Date()) => {
  const { from } = monthRange(month);
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).slice(0, 7);
  if (month < shiftMonth(current, -12) || month > shiftMonth(current, 12)) throw pnlError('RECURRING_START_OUT_OF_RANGE');
  return from;
};
export const recurringActive = (row, month) => row.start_month <= `${month}-01` && (!row.end_month || row.end_month >= `${month}-01`);
export const recurringWarnings = (rows, lineItems) => rows.filter((row) => !row.skipped).flatMap((row) =>
  lineItems.filter((item) => !item.excluded && item.category_code === row.category_code
    && String(item.branch_id ?? '') === String(row.branch_id ?? '')
    && Math.abs(cents(item.amount) - cents(row.amount)) * 100 <= cents(row.amount) * 5)
    .map((item) => ({ recurring_id: Number(row.id), stable_key: item.stable_key, amount: item.amount })));
export const recurringSelect = `SELECT e.*, s.reason AS skip_reason, s.month_start AS skipped_month
  FROM pnl_recurring_expenses e LEFT JOIN pnl_recurring_skips s ON s.recurring_id=e.id AND s.month_start=?
  WHERE e.start_month<=? AND (e.end_month IS NULL OR e.end_month>=?) ORDER BY e.id`;

// Shares the existing router's permission, decision guard, transaction and audit helpers.
export const registerRecurringRoutes = ({ router, handler, query, mutate, branch, category, text, audit, amountInput }) => {
  const keyOf = (value) => {
    const key = Number(value);
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(key)) throw pnlError('INVALID_ID');
    return key;
  };
  const fields = async (body) => {
    if (body.category_code === 'STAFF') throw pnlError('STAFF_FROM_HRMS');
    return { branch_id: await branch(body.branch_id), category_code: await category(body.category_code),
      description: text(body.description, 300, true), amount: amountInput(body.amount), note: text(body.note, 500) };
  };
  const lock = async (connection, value) => {
    const key = keyOf(value);
    const [[row]] = await connection.query('SELECT * FROM pnl_recurring_expenses WHERE id=? FOR UPDATE', [key]);
    if (!row) throw pnlError('RECURRING_NOT_FOUND', 404);
    return row;
  };
  const insert = async (connection, req, row) => {
    const [created] = await connection.query(`INSERT INTO pnl_recurring_expenses
      (series_id, branch_id, category_code, description, amount, start_month, end_month, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [row.series_id, row.branch_id, row.category_code, row.description, row.amount, row.start_month, row.end_month, row.note, req.user.id]);
    return keyOf(created.insertId);
  };
  router.get('/recurring', handler(async (req) => {
    const { from } = monthRange(req.query.month);
    return (await query(recurringSelect, [from, from, from])).map((row) => ({ ...row, skipped: Boolean(row.skipped_month) }));
  }));
  router.get('/recurring/series/:seriesId', handler(async (req) => {
    const rows = await query('SELECT * FROM pnl_recurring_expenses WHERE series_id=? ORDER BY start_month, id', [keyOf(req.params.seriesId)]);
    if (!rows.length) throw pnlError('RECURRING_NOT_FOUND', 404);
    const skips = await query(`SELECT s.* FROM pnl_recurring_skips s JOIN pnl_recurring_expenses e ON e.id=s.recurring_id
      WHERE e.series_id=? ORDER BY s.month_start`, [keyOf(req.params.seriesId)]);
    return rows.map((row) => ({ ...row, skips: skips.filter((skip) => String(skip.recurring_id) === String(row.id)) }));
  }));
  router.post('/recurring', handler(async (req) => {
    const values = await fields(req.body);
    const start_month = validateRecurringStart(req.body.start_month);
    return mutate(req, async (connection) => {
      const row = { ...values, start_month, end_month: null, series_id: null };
      const id = await insert(connection, req, row);
      await connection.query('UPDATE pnl_recurring_expenses SET series_id=? WHERE id=?', [id, id]);
      const after = { ...row, id, series_id: id };
      await audit(connection, req, 'pnl_recurring_expenses', id, 'pnl.recurring.create', null, after);
      return after;
    });
  }));
  router.put('/recurring/:id', handler(async (req) => {
    const values = await fields(req.body);
    const { from: effective } = monthRange(req.body.effective_month);
    return mutate(req, async (connection) => {
      const old = await lock(connection, req.params.id);
      if (!recurringActive(old, req.body.effective_month)) throw pnlError('RECURRING_EFFECTIVE_OUT_OF_RANGE');
      const series = keyOf(old.series_id || old.id);
      if (effective === old.start_month) {
        await connection.query(`UPDATE pnl_recurring_expenses SET branch_id=?, category_code=?, description=?, amount=?, note=?,
          updated_by=?, updated_at=NOW() WHERE id=?`, [values.branch_id, values.category_code, values.description, values.amount, values.note, req.user.id, old.id]);
        const after = { ...old, ...values };
        await audit(connection, req, 'pnl_recurring_expenses', old.id, 'pnl.recurring.update', old, after);
        return after;
      }
      const closed = { ...old, end_month: `${shiftMonth(req.body.effective_month, -1)}-01` };
      await connection.query('UPDATE pnl_recurring_expenses SET end_month=?, updated_by=?, updated_at=NOW() WHERE id=?', [closed.end_month, req.user.id, old.id]);
      const row = { ...values, series_id: series, start_month: effective, end_month: old.end_month };
      const id = await insert(connection, req, row);
      // Preserve exemptions on the months now owned by the new version.
      const [skips] = await connection.query('SELECT * FROM pnl_recurring_skips WHERE recurring_id=? AND month_start>=? FOR UPDATE', [old.id, effective]);
      await connection.query('UPDATE pnl_recurring_skips SET recurring_id=? WHERE recurring_id=? AND month_start>=?', [id, old.id, effective]);
      const after = { ...row, id };
      await audit(connection, req, 'pnl_recurring_expenses', old.id, 'pnl.recurring.close_version', old, closed);
      await audit(connection, req, 'pnl_recurring_expenses', id, 'pnl.recurring.version', null, { ...after, previous_id: Number(old.id), transferred_skips: skips });
      return after;
    });
  }));
  router.post('/recurring/:id/stop', handler((req) => mutate(req, async (connection) => {
    const { from: last } = monthRange(req.body.last_month);
    const old = await lock(connection, req.params.id);
    // Never extend an ended version over a later version in the same series.
    if (!recurringActive(old, req.body.last_month)) throw pnlError('RECURRING_LAST_OUT_OF_RANGE');
    await connection.query('UPDATE pnl_recurring_expenses SET end_month=?, updated_by=?, updated_at=NOW() WHERE id=?', [last, req.user.id, old.id]);
    const after = { ...old, end_month: last };
    await audit(connection, req, 'pnl_recurring_expenses', old.id, 'pnl.recurring.stop', old, after);
    return after;
  })));
  for (const method of ['put', 'delete']) router[method]('/recurring/:id/skips/:month', handler((req) => mutate(req, async (connection) => {
    const { from } = monthRange(req.params.month);
    const row = await lock(connection, req.params.id);
    if (!recurringActive(row, req.params.month)) throw pnlError('RECURRING_EFFECTIVE_OUT_OF_RANGE');
    const [[old]] = await connection.query('SELECT * FROM pnl_recurring_skips WHERE recurring_id=? AND month_start=? FOR UPDATE', [row.id, from]);
    const after = method === 'put' ? { recurring_id: Number(row.id), month_start: from, reason: text(req.body.reason, 300, true) } : null;
    if (after) await connection.query(`INSERT INTO pnl_recurring_skips (recurring_id, month_start, reason, created_by, created_at)
      VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE reason=VALUES(reason), created_by=VALUES(created_by), created_at=NOW()`, [row.id, from, after.reason, req.user.id]);
    else await connection.query('DELETE FROM pnl_recurring_skips WHERE recurring_id=? AND month_start=?', [row.id, from]);
    await audit(connection, req, 'pnl_recurring_skips', row.id, `pnl.recurring.skip.${method}`, old, after);
    return { id: Number(row.id), month_start: from, skipped: Boolean(after) };
  })));
};
