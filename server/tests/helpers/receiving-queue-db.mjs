// Purpose-built SQL double: rejects unknown statements and models lock/rollback.
// This verifies application decisions, not MySQL engine semantics.
export function queueDb() {
  const state = { rows: [], leads: [], queries: [], failInsert: false };
  let tail = Promise.resolve();
  let nextId = 1;
  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    state.queries.push({ sql: q, params });
    if (q.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }];
    if (q.startsWith('INSERT INTO receiving_followup_locks') || q.startsWith('SELECT scope_key')) return [[]];
    if (q.startsWith('SELECT supplier_key, lead_days')) return [structuredClone(state.leads)];
    if (q.startsWith('SELECT id FROM product_groups')) return [Number(params[0]) < 100 ? [{ id: params[0] }] : []];
    if (q.startsWith('INSERT INTO receiving_supplier_leads')) {
      state.leads = state.leads.filter(row => row.supplier_key !== params[0]);
      state.leads.push({ supplier_key: params[0], lead_days: params[1] }); return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT COUNT(*)')) return [[{ pending_count: state.rows.filter(row => row.status !== 'resolved').length }]];
    if (q.startsWith('SELECT *, DATE_FORMAT')) {
      let rows = state.rows;
      if (q.includes('WHERE branch_id = ?')) rows = rows.filter(row => row.branch_id === params[0] && row.department_id === params[1] && row.supplier_key === params[2] && row.created_at > params[3]);
      else if (q.includes('WHERE auto_key = ?')) rows = rows.filter(row => row.auto_key === params[0]);
      else if (q.includes('WHERE id = ?')) rows = rows.filter(row => row.id === Number(params[0]));
      else if (q.includes('WHERE status IN')) rows = rows.filter(row => params.includes(row.status));
      else throw new Error(`Unknown followup SELECT: ${q}`);
      rows = [...rows].sort((a,b) => b.id-a.id);
      if (q.includes('LIMIT 1') && !q.includes('LIMIT 200')) rows = rows.slice(0,1);
      if (q.includes('LIMIT 200')) rows = rows.slice(0,200);
      return [structuredClone(rows)];
    }
    if (q.startsWith('INSERT INTO receiving_followups')) {
      if (state.failInsert) throw new Error('SYNTHETIC failure');
      const [supplier_key,supplier_name,branch_id,department_id,pending_items_json,actor_user_id,actor_name,note,source,auto_key,created_at,updated_at] = params;
      const row = { id: nextId++, supplier_key,supplier_name,branch_id,department_id,pending_items_json,actor_user_id,actor_name,note,source,auto_key,created_at,updated_at,status:'open' };
      state.rows.push(row); return [{ insertId: row.id }];
    }
    if (q.startsWith('UPDATE receiving_followups SET auto_key')) { state.rows.find(row => row.id === params[1]).auto_key = params[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith('UPDATE receiving_followups SET status')) {
      Object.assign(state.rows.find(row => row.id === params[3]), { status: params[0], updated_at: params[1], updated_by_user_id: params[2] });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unmocked queue SQL: ${q}`);
  }
  const db = { query, async getConnection() {
    let releaseLock, snapshot;
    return {
      async beginTransaction() {},
      async query(sql, params) {
        if (/FOR UPDATE/.test(sql) && !releaseLock) {
          const prior = tail; tail = new Promise(resolve => { releaseLock = resolve; });
          const unlock = releaseLock; releaseLock = null;
          await prior; releaseLock = unlock; snapshot = structuredClone(state.rows);
        }
        return query(sql, params);
      },
      async commit() { releaseLock?.(); releaseLock = null; },
      async rollback() { if (snapshot) state.rows = snapshot; releaseLock?.(); releaseLock = null; },
      release() { releaseLock?.(); }
    };
  } };
  return { db, state };
}
