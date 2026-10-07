import { readExpensePairContext } from './expense-pair-profile.js';
import { expensePreparationReadiness } from './expense-profile.js';
// สถานะ "ข้อมูลสำหรับค่าใช้จ่าย" ของแต่ละรูป สำหรับคิวงานและหน้าสรุปฝ่ายบัญชี
// อ่านอย่างเดียว: ไม่สร้าง profile ไม่แตะยอด คู่เอกสาร หรือเงื่อนไขปิดรอบ
// 'none' = ยังไม่กรอก (ไม่มีแถวใน capture_expense_profiles), 'draft' = ร่าง, 'reviewed' = ตรวจข้อมูลแล้ว
// reviewed หมายถึงตรวจข้อมูลเอกสารเท่านั้น ไม่ใช่การอนุมัติจ่ายหรือลงบัญชี
export const EXPENSE_STATUS_VALUES = Object.freeze(['none', 'draft', 'reviewed']);
export const EXPENSE_STATUS_BILL_CATEGORIES = Object.freeze(['bill', 'payment_voucher']);
export const EXPENSE_STATUS_SLIP_CATEGORIES = Object.freeze(['transfer', 'transfer_notice']);
export const EXPENSE_STATUS_MAX_IDS = 1000;
export const EXPENSE_STATUS_MAX_DAYS = 400;
export const EXPENSE_STATUS_MAX_LIST = 3000;

const ALL_CATEGORIES = [...EXPENSE_STATUS_BILL_CATEGORIES, ...EXPENSE_STATUS_SLIP_CATEGORIES];
const marks = (list) => list.map(() => '?').join(',');
const dateSql = (alias) => `CASE WHEN ${alias}.event_timestamp_ms > 0 THEN date((${alias}.event_timestamp_ms / 1000) + 25200, 'unixepoch') ELSE substr(${alias}.created_at,1,10) END`;
const query = (database, sql, params = []) => {
  const statement = database.prepare(sql, params);
  try { const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
  finally { statement.free(); }
};
const kindOf = (category) => (EXPENSE_STATUS_SLIP_CATEGORIES.includes(category) ? 'slip' : 'bill');
const statusOf = (value) => (value === 'reviewed' || value === 'draft' ? value : 'none');
const emptyCounts = () => ({ none: 0, draft: 0, reviewed: 0, total: 0 });
const emptyKinds = () => ({ bill: emptyCounts(), slip: emptyCounts() });
const add = (counts, status) => { counts[status] += 1; counts.total += 1; };
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// นับเฉพาะบิล/สลิปที่ยังใช้งาน: ตัด "อื่น ๆ", หน้าประกอบ, รอ AI อ่าน, ยกเลิกส่ง (unsent) และรูปซ้ำ (duplicate)
const countedWhere = `ci.category IN (${marks(ALL_CATEGORIES)}) AND ci.status NOT IN ('unsent','duplicate')`;

// สำหรับป้ายสถานะ: คืนสถานะของ id ที่ขอ เฉพาะรูปที่นับได้ ไม่สร้างแถวใหม่
export const readExpenseStatusBatch = (database, ids, matchIds = []) => {
  const unique = [...new Set((ids || []).map(Number))];
  if (!unique.length || unique.length > EXPENSE_STATUS_MAX_IDS || unique.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { error: 'ids_invalid' };
  const rows = query(database,
    `SELECT ci.id, p.status AS profile_status, p.revision AS revision FROM capture_items ci
     LEFT JOIN capture_expense_profiles p ON p.item_id = ci.id
     WHERE ci.id IN (${marks(unique)}) AND ${countedWhere}`, [...unique, ...ALL_CATEGORIES]);
  const items = {};
  for (const row of rows) items[row.id] = { status: statusOf(row.profile_status), revision: Number(row.revision || 0) };
  const uniqueMatches = [...new Set(matchIds.map(Number))];
  if (uniqueMatches.length > EXPENSE_STATUS_MAX_IDS || uniqueMatches.some(id => !Number.isSafeInteger(id) || id <= 0)) return {error:'match_ids_invalid'};
  const by_match = {};
  for (const matchId of uniqueMatches) {
    const scope = readExpensePairContext(database, {matchId});
    if (!scope.error) by_match[matchId] = {...scope, eligible:true, review_status:scope.shared_status === 'needs_pair_review' ? 'needs_review' : scope.shared_status};
  }
  return { items, by_match };
};

// Group complete confirmed evidence before applying the requested scope. No money totals.
const readPreparationTransactions = (database, { start, end, sourceId }) => {
  const rows = query(database, `SELECT ci.id,ci.category,ci.source_id,ci.event_timestamp_ms,
    ${dateSql('ci')} AS business_date,p.status AS profile_status,p.fields_json
    FROM capture_items ci LEFT JOIN capture_expense_profiles p ON p.item_id=ci.id
    WHERE ${countedWhere}`, ALL_CATEGORIES);
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  // Union by rank and path compression keep large overlapping evidence sets linear-ish.
  const parents = new Map([...byId.keys()].map(id => [id,id])), ranks = new Map();
  const find = id => {
    let root=id;
    while (parents.get(root)!==root) root=parents.get(root);
    while (parents.get(id)!==id) { const next=parents.get(id); parents.set(id,root); id=next; }
    return root;
  };
  const unite = (a,b) => {
    a=find(a); b=find(b); if (a===b) return;
    const ar=ranks.get(a)||0, br=ranks.get(b)||0;
    if (ar<br) parents.set(a,b);
    else { parents.set(b,a); if (ar===br) ranks.set(a,ar+1); }
  };
  const groupAnchor = new Map(), edges=[];
  for (const edge of query(database, "SELECT id,bill_item_id,slip_item_id,match_group_key FROM capture_matches WHERE status='confirmed' ORDER BY id")) {
    const bill=Number(edge.bill_item_id), slip=Number(edge.slip_item_id);
    if (!byId.has(bill) || !byId.has(slip)) continue;
    unite(bill,slip);
    if (edge.match_group_key) {
      if (groupAnchor.has(edge.match_group_key)) unite(bill,groupAnchor.get(edge.match_group_key));
      else groupAnchor.set(edge.match_group_key,bill);
    }
    edges.push({bill,matchId:Number(edge.id),key:edge.match_group_key ? `group:${edge.match_group_key}` : `match:${edge.id}`});
  }
  const components=new Map();
  for (const id of byId.keys()) {
    const root=find(id);
    if (!components.has(root)) components.set(root,{ids:new Set(),key:null});
    components.get(root).ids.add(id);
  }
  for (const edge of edges) {
    const component=components.get(find(edge.bill));
    // Stable first key, independent of query order or union tree shape.
    if (!component.key || edge.key < component.key) component.key=edge.key;
  }
  const groups=new Map([...components.values()].map(component=>[component.key || `item:${component.ids.values().next().value}`,component.ids]));
  const ordered = list => list.sort((a,b) => Number(a.event_timestamp_ms || 0)-Number(b.event_timestamp_ms || 0) || Number(a.id)-Number(b.id));
  const value = (fields,key) => typeof fields?.[key]?.value === 'string' ? fields[key].value.trim() : '';
  const transactions = [];
  for (const [key, ids] of groups) {
    const members = ordered([...ids].map(id => byId.get(id)));
    const bills = members.filter(row => kindOf(row.category)==='bill'), slips = members.filter(row => kindOf(row.category)==='slip');
    const canonical = bills[0] || slips[0], anchor = slips[0] || canonical;
    const date = anchor.business_date, source = canonical.source_id;
    if (date < start || date > end || sourceId && source !== sourceId) continue;
    const memberFacts = members.map(row => {
      let fields = {}; try { fields = JSON.parse(row.fields_json || '{}') || {}; } catch {}
      return { row, fields, preparation: expensePreparationReadiness(fields, statusOf(row.profile_status)) };
    });
    const pairEdge = bills.length === 1 && slips.length === 1 ? edges.find(edge => ids.has(edge.bill)) : null;
    const scope = pairEdge ? readExpensePairContext(database,{matchId:pairEdge.matchId}) : null;
    const shared = scope && !scope.error && scope.membership_valid;
    const relevant = memberFacts.filter(member => bills.length ? kindOf(member.row.category)==='bill' : true);
    const reasons = [...new Set(relevant.flatMap(member => member.preparation.reasons))];
    const missing_fields = [...new Set(relevant.flatMap(member => member.preparation.missing_fields))];
    const conflict_fields = (shared ? [] : ['transaction_type','expense_category','expense_period','branch']).filter(field =>
      new Set(memberFacts.map(member => value(member.fields,field)).filter(Boolean)).size > 1);
    if (conflict_fields.length) reasons.push('preparation_conflict');
    if (scope && !scope.error && !shared) reasons.push('pair_review_required');
    const allNotApplicable = relevant.every(member => member.preparation.status==='not_applicable');
    const status = conflict_fields.length || reasons.some(reason => reason !== 'transaction_not_expense') || missing_fields.length
      ? 'not_ready' : allNotApplicable ? 'not_applicable' : 'ready';
    transactions.push({ review_status:scope && !scope.error ? scope.shared_status : null, pair_scope:scope && !scope.error ? scope : null, key, date, source_id: source, canonical_item_id: Number(canonical.id),
      bill_ids: bills.map(row => Number(row.id)), slip_ids: slips.map(row => Number(row.id)),
      evidence_item_ids: bills.length ? slips.map(row => Number(row.id)) : [],
      member_preparation: memberFacts.map(member => ({ id:Number(member.row.id), profile_status:statusOf(member.row.profile_status), ...member.preparation })),
      preparation: { status, fields_complete: !conflict_fields.length && relevant.every(member => member.preparation.fields_complete), missing_fields, reasons:[...new Set(reasons)], conflict_fields } });
  }
  transactions.sort((a,b) => b.date.localeCompare(a.date) || a.source_id.localeCompare(b.source_id) || a.canonical_item_id-b.canonical_item_id);
  const counts = { ready:0, not_ready:0, not_applicable:0, total:transactions.length };
  for (const transaction of transactions) counts[transaction.preparation.status]++;
  return { transactions:transactions.slice(0,EXPENSE_STATUS_MAX_LIST), transaction_counts:counts,
    transactions_truncated:transactions.length > EXPENSE_STATUS_MAX_LIST };
};

export const readExpenseStatusSummary = (database, { start, end, sourceId = '' } = {}) => {
  if (!validDate(start || '') || !validDate(end || '') || start > end) return { error: 'range_invalid' };
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 >= EXPENSE_STATUS_MAX_DAYS) return { error: 'range_too_long' };
  const where = [countedWhere, `(${dateSql('ci')}) >= ?`, `(${dateSql('ci')}) <= ?`];
  const params = [...ALL_CATEGORIES, start, end];
  if (sourceId) { where.push('ci.source_id = ?'); params.push(String(sourceId)); }
  const rows = query(database,
    `SELECT ci.id, ci.category, ci.source_id, ci.vendor_name, ci.supplier_name, ci.bill_total_value, ci.slip_amount_value,
       ${dateSql('ci')} AS business_date, p.status AS profile_status
     FROM capture_items ci LEFT JOIN capture_expense_profiles p ON p.item_id = ci.id
     WHERE ${where.join(' AND ')} ORDER BY business_date DESC, ci.source_id, ci.id`, params);
  const totals = emptyKinds();
  const byDay = new Map();
  const items = [];
  for (const row of rows) {
    const kind = kindOf(row.category), status = statusOf(row.profile_status);
    add(totals[kind], status);
    const key = `${row.business_date}|${row.source_id}`;
    if (!byDay.has(key)) byDay.set(key, { date: row.business_date, source_id: row.source_id, ...emptyKinds() });
    add(byDay.get(key)[kind], status);
    if (items.length < EXPENSE_STATUS_MAX_LIST) {
      items.push({ id: Number(row.id), date: row.business_date, source_id: row.source_id, kind, status,
        amount: kind === 'slip' ? row.slip_amount_value ?? null : row.bill_total_value ?? null,
        title: row.supplier_name || row.vendor_name || null });
    }
  }
  return { scope: { start, end, source_id: sourceId || null }, totals, days: [...byDay.values()], items, items_truncated: rows.length > items.length,
    ...readPreparationTransactions(database, { start, end, sourceId }) };
};
