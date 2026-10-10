import { buildCashflowFees } from './cashflowFees.js';
import { loadHrmsExpenses } from './hrms.js';
import { loadMissingPosRevenue } from './revenue.js';
import express from 'express';
import { amountInput, monthRange, normalize, pnlError, validatePeriodMonth } from './domain.js';
import { buildReport, loadReportData } from './report.js';
import { createSync } from './sync.js';

export const createPnlRouter = ({ getPool, config, authenticate, requirePermission, logAudit, fetchImpl, fetchSalesRange, requireHumanDecision, decisionReasonRequired = false }) => {
  const router = express.Router();
  router.use(authenticate, (req, res, next) => requirePermission('report:pnl')(req, res, (error) =>
    next(error?.statusCode === 403 ? pnlError('PNL_FORBIDDEN', 403) : error)));
  router.use((req, res, next) => {
    if (!decisionReasonRequired || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const route = req.originalUrl.split('?')[0].replace(/^\/api/, '')
      .replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f-]{24,}(?=\/|$)/gi, '/:id');
    return requireHumanDecision(`cashflow.${req.method.toLowerCase()}.${route.replace(/^\//, '').replaceAll('/', '.')}`)(req, res, next);
  });
  const handler = (fn) => async (req, res, next) => {
    try { res.json({ success: true, data: await fn(req) }); }
    catch (error) { next(error); }
  };
  const query = async (sql, params = []) => (await getPool().query(sql, params))[0];
  const withConnection = async (fn) => {
    const connection = await getPool().getConnection();
    try { return await fn(connection); } finally { connection.release(); }
  };
  const branch = async (id) => {
    if (id == null || id === '') return null;
    if (!/^\d+$/.test(String(id)) || !(await query('SELECT id FROM branches WHERE id=?', [id])).length) throw pnlError('INVALID_BRANCH');
    return Number(id);
  };
  const category = async (code, nullable = false) => {
    if (code == null && nullable) return null;
    if (typeof code !== 'string' || !(await query('SELECT code FROM pnl_categories WHERE code=?', [code])).length) throw pnlError('INVALID_CATEGORY');
    return code;
  };
  const text = (value, max, required = false) => {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw pnlError('INVALID_TEXT');
    // Free text used in this financial summary must not preserve full account numbers.
    return value.trim().replace(/(?:\d[ -]?){9,}/g, '[ปกปิดเลข]');
  };
  const id = (value) => { if (!/^[1-9]\d*$/.test(String(value))) throw pnlError('INVALID_ID'); return value; };
  const audit = (connection, req, entityType, entityId, action, beforePayload, afterPayload) => logAudit({
    connection, actor: req.user, entityType, entityId: entityId == null ? null : Number(entityId), action, beforePayload, afterPayload
  });
  const mutate = async (req, fn) => withConnection(async (connection) => {
    await connection.beginTransaction();
    try { const result = await fn(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
  });
  const report = async (req) => {
    const month = req.query.month; monthRange(month);
    const branchId = await branch(req.query.branch_id);
    const data = await withConnection((connection) => loadReportData(connection, month));
    const { posRevenue, posRevenueStatus } = await loadMissingPosRevenue({ ...data, month, branchId, fetchSalesRange });
    const { hrmsExpenses, hrmsStatus } = await loadHrmsExpenses({ month, branches: data.branches, config, fetchImpl });
    const { cashflowExpenses, cashflowFeeStatus } = buildCashflowFees(data.fees);
    const result = buildReport({ ...data, posRevenue, hrmsExpenses, cashflowExpenses, month, branchId });
    result.cashflow_fee_status = cashflowFeeStatus;
    result.hrms_status = hrmsStatus;
    result.pos_revenue_status = posRevenueStatus;
    const roundMap = new Map(data.rounds.map((row) => [String(row.id), row]));
    const publicItem = ({ raw_json, ...item }) => {
      const round = roundMap.get(String(item.round_id));
      return { ...item, source_url: config.baseUrl ? `${config.baseUrl.replace(/\/$/, '')}/admin?${new URLSearchParams({ view: 'day', date: item.business_date, group: round.source_id })}` : null };
    };
    result.items = result.items.map(publicItem);
    for (const key of ['moved_in', 'moved_out']) result[key].items = result[key].items.map(publicItem);
    return { ...result, latest_sync: data.sync[0] || null, configured: Boolean(config.baseUrl && config.token) };
  };
  router.get('/report', handler(report));
  router.get('/items', handler(async (req) => {
    const result = await report(req); const code = req.query.category;
    if (code && !['UNCATEGORIZED', 'EXCLUDED'].includes(code)) await category(code);
    return result.items.filter((row) => code === 'EXCLUDED' ? row.excluded : !row.excluded && (!code || (row.category_code || 'UNCATEGORIZED') === code));
  }));
  const syncMonth = createSync({ getPool, config, fetchImpl });
  router.post('/sync', handler((req) => syncMonth({ month: req.body.month, userId: req.user.id,
    audit: (result) => logAudit({ actor: req.user, entityType: 'pnl_sync_runs', entityId: Number(result.id),
      action: 'pnl.sync', beforePayload: null, afterPayload: result }) })));
  router.get('/categories', handler(() => query('SELECT * FROM pnl_categories ORDER BY sort_order, code')));
  router.put('/items/:stableKey/override', handler(async (req) => {
    const key = req.params.stableKey;
    if (!key || key.length > 120) throw pnlError('INVALID_STABLE_KEY');
    const body = req.body;
    if (body.excluded !== undefined && body.excluded !== null && typeof body.excluded !== 'boolean') throw pnlError('INVALID_EXCLUDED');
    if (body.create_rule != null && !['supplier', 'purpose'].includes(body.create_rule)) throw pnlError('INVALID_RULE_FIELD');
    if (body.category_code !== undefined) await category(body.category_code, true);
    if (body.note !== undefined) text(body.note, 500);
    return mutate(req, async (connection) => {
      const [[item]] = await connection.query('SELECT * FROM pnl_expense_items WHERE stable_key=? FOR UPDATE', [key]);
      if (!item) throw pnlError('ITEM_NOT_FOUND', 404);
      const [[old]] = await connection.query('SELECT * FROM pnl_item_overrides WHERE stable_key=? FOR UPDATE', [key]);
      const after = { stable_key: key, period_month: body.period_month === undefined ? old?.period_month ?? null : validatePeriodMonth(body.period_month, item.business_date), category_code: body.category_code === undefined ? old?.category_code ?? null : body.category_code,
        excluded: body.excluded === undefined ? old?.excluded ?? null : body.excluded,
        note: body.note === undefined ? old?.note ?? null : text(body.note, 500) };
      await connection.query(`INSERT INTO pnl_item_overrides (stable_key, category_code, excluded, note, period_month, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE period_month=VALUES(period_month), category_code=VALUES(category_code), excluded=VALUES(excluded),
        note=VALUES(note), updated_by=VALUES(updated_by), updated_at=NOW()`, [key, after.category_code, after.excluded, after.note, after.period_month, req.user.id]);
      if (body.create_rule) {
        if (!after.category_code) throw pnlError('INVALID_CATEGORY');
        const pattern = normalize(body.create_rule === 'supplier' ? item.supplier_name : item.description);
        if (!pattern || pattern.length > 200) throw pnlError('INVALID_PATTERN');
        const [[oldRule]] = await connection.query('SELECT * FROM pnl_category_rules WHERE match_field=? AND pattern=? FOR UPDATE', [body.create_rule, pattern]);
        await connection.query(`INSERT INTO pnl_category_rules (match_field, pattern, category_code, priority, created_by, created_at)
          VALUES (?, ?, ?, 100, ?, NOW()) ON DUPLICATE KEY UPDATE category_code=VALUES(category_code)`, [body.create_rule, pattern, after.category_code, req.user.id]);
        const [[savedRule]] = await connection.query('SELECT * FROM pnl_category_rules WHERE match_field=? AND pattern=?', [body.create_rule, pattern]);
        await audit(connection, req, 'pnl_category_rules', savedRule.id, 'pnl.rule.from_override', oldRule, { ...savedRule, stable_key: key });
      }
      await audit(connection, req, 'pnl_item_overrides', item.id, 'pnl.override', old, after);
      return after;
    });
  }));
  router.get('/rules', handler(() => query('SELECT * FROM pnl_category_rules ORDER BY priority, id')));
  router.post('/rules', handler(async (req) => {
    const body = req.body;
    if (!['supplier', 'purpose'].includes(body.match_field)) throw pnlError('INVALID_RULE_FIELD');
    const pattern = normalize(text(body.pattern, 200, true));
    if (!pattern) throw pnlError('INVALID_PATTERN');
    const code = await category(body.category_code);
    const priority = body.priority ?? 100;
    if (!Number.isSafeInteger(priority) || Math.abs(priority) > 2147483647) throw pnlError('INVALID_PRIORITY');
    return mutate(req, async (connection) => {
      const [existing] = await connection.query('SELECT id FROM pnl_category_rules WHERE match_field=? AND pattern=? FOR UPDATE', [body.match_field, pattern]);
      if (existing.length) throw pnlError('RULE_EXISTS', 409);
      const [created] = await connection.query(`INSERT INTO pnl_category_rules (match_field, pattern, category_code, priority, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())`, [body.match_field, pattern, code, priority, req.user.id]);
      const after = { id: created.insertId, match_field: body.match_field, pattern, category_code: code, priority };
      await audit(connection, req, 'pnl_category_rules', after.id, 'pnl.rule.create', null, after); return after;
    });
  }));
  router.delete('/rules/:id', handler((req) => mutate(req, async (connection) => {
    const key = id(req.params.id);
    const [[old]] = await connection.query('SELECT * FROM pnl_category_rules WHERE id=? FOR UPDATE', [key]);
    if (!old) throw pnlError('RULE_NOT_FOUND', 404);
    await connection.query('DELETE FROM pnl_category_rules WHERE id=?', [key]);
    await audit(connection, req, 'pnl_category_rules', key, 'pnl.rule.delete', old, null); return { id: key };
  })));
  router.get('/manual-expenses', handler(async (req) => {
    const { from } = monthRange(req.query.month); const branchId = await branch(req.query.branch_id);
    const rows = await query('SELECT * FROM pnl_manual_expenses WHERE month_start=? AND deleted_at IS NULL ORDER BY id', [from]);
    return branchId == null ? rows : rows.filter((row) => String(row.branch_id) === String(branchId));
  }));
  const saveManual = async (req) => {
    const body = req.body; const { from } = monthRange(body.month);
    const branchId = await branch(body.branch_id); const code = await category(body.category_code);
    const description = text(body.description, 300, true); const amount = amountInput(body.amount); const note = text(body.note, 500);
    return mutate(req, async (connection) => {
      let key = req.params.id ? id(req.params.id) : null; let old;
      if (key) {
        [[old]] = await connection.query('SELECT * FROM pnl_manual_expenses WHERE id=? AND deleted_at IS NULL FOR UPDATE', [key]);
        if (!old) throw pnlError('MANUAL_NOT_FOUND', 404);
        await connection.query(`UPDATE pnl_manual_expenses SET month_start=?, branch_id=?, category_code=?, description=?, amount=?, note=?,
          updated_by=?, updated_at=NOW() WHERE id=?`, [from, branchId, code, description, amount, note, req.user.id, key]);
      } else {
        const [created] = await connection.query(`INSERT INTO pnl_manual_expenses (month_start, branch_id, category_code, description, amount, note, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`, [from, branchId, code, description, amount, note, req.user.id]); key = created.insertId;
      }
      const after = { id: key, month_start: from, branch_id: branchId, category_code: code, description, amount, note };
      await audit(connection, req, 'pnl_manual_expenses', key, old ? 'pnl.manual.update' : 'pnl.manual.create', old, after); return after;
    });
  };
  router.post('/manual-expenses', handler(saveManual));
  router.put('/manual-expenses/:id', handler(saveManual));
  router.delete('/manual-expenses/:id', handler((req) => mutate(req, async (connection) => {
    const key = id(req.params.id);
    const [[old]] = await connection.query('SELECT * FROM pnl_manual_expenses WHERE id=? AND deleted_at IS NULL FOR UPDATE', [key]);
    if (!old) throw pnlError('MANUAL_NOT_FOUND', 404);
    await connection.query('UPDATE pnl_manual_expenses SET deleted_at=NOW(), updated_by=?, updated_at=NOW() WHERE id=?', [req.user.id, key]);
    await audit(connection, req, 'pnl_manual_expenses', key, 'pnl.manual.delete', old, { ...old, deleted: true }); return { id: key };
  })));
  router.use((error, req, res, next) => {
    const expected = error.isPnlError === true && Number.isInteger(error.statusCode);
    // Never log SQL, parameters, upstream bodies, tokens or exception messages.
    if (!expected) console.error('P&L request failed: unexpected internal error');
    const code = expected ? error.code : 'PNL_REQUEST_FAILED';
    res.status(expected ? error.statusCode : 500).json({ success: false,
      code, message: 'ไม่สามารถดำเนินการได้', details: { code } });
  });
  return router;
};
