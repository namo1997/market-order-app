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
export const readExpenseStatusBatch = (database, ids) => {
  const unique = [...new Set((ids || []).map(Number))];
  if (!unique.length || unique.length > EXPENSE_STATUS_MAX_IDS || unique.some((id) => !Number.isSafeInteger(id) || id <= 0)) return { error: 'ids_invalid' };
  const rows = query(database,
    `SELECT ci.id, p.status AS profile_status, p.revision AS revision FROM capture_items ci
     LEFT JOIN capture_expense_profiles p ON p.item_id = ci.id
     WHERE ci.id IN (${marks(unique)}) AND ${countedWhere}`, [...unique, ...ALL_CATEGORIES]);
  const items = {};
  for (const row of rows) items[row.id] = { status: statusOf(row.profile_status), revision: Number(row.revision || 0) };
  return { items };
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
  return { scope: { start, end, source_id: sourceId || null }, totals, days: [...byDay.values()], items, items_truncated: rows.length > items.length };
};
