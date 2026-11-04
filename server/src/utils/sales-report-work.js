const DAY_MS = 86_400_000;
export const MAX_REPORT_DAYS = 366;

export function parseSalesReportFilters(query, now = new Date()) {
  const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('วันที่ต้องเป็น YYYY-MM-DD');
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) invalid('วันที่ไม่ถูกต้อง');
    return ms;
  };
  const start = query.start || today;
  const end = query.end || start;
  const startMs = date(start), endMs = date(end);
  const days = (endMs - startMs) / DAY_MS + 1;
  if (days < 1 || days > MAX_REPORT_DAYS) invalid(`เลือกช่วงวันที่เรียงตามลำดับ ไม่เกิน ${MAX_REPORT_DAYS} วัน`);
  const branchId = query.branch_id ? Number(query.branch_id) : null;
  if (branchId !== null && (!Number.isSafeInteger(branchId) || branchId <= 0)) invalid('สาขาไม่ถูกต้อง');
  const rawLimit = Number(query.limit ?? 200);
  if (!Number.isSafeInteger(rawLimit) || rawLimit <= 0) invalid('จำนวนรายการไม่ถูกต้อง');
  if (query.search !== undefined && typeof query.search !== 'string') invalid('คำค้นไม่ถูกต้อง');
  const search = (query.search || '').trim();
  if (search.length > 200) invalid('คำค้นยาวเกิน 200 ตัวอักษร');
  return { start, end, startMs, endMs, branchId, search, limit: Math.min(rawLimit, 1000) };
}

// Only identical in-flight reads share work. Financial results are never cached
// after completion; the sole TTL cache is product-group availability metadata.
export function createSalesQueryRunner(query, { now = Date.now, metadataTtlMs = 60_000 } = {}) {
  const pending = new Map();
  let metadata;
  return async (sql, { groupMetadata = false } = {}) => {
    if (groupMetadata && metadata?.sql === sql && metadata.expiresAt > now()) return metadata.rows;
    if (pending.has(sql)) return pending.get(sql);
    const result = Promise.resolve().then(() => query(sql)).then((rows) => {
      if (groupMetadata) metadata = { sql, rows, expiresAt: now() + metadataTtlMs };
      return rows;
    });
    // Keep memory bounded even when many clients request different report filters.
    const tracked = pending.size < 64;
    if (tracked) pending.set(sql, result);
    try { return await result; }
    finally { if (tracked && pending.get(sql) === result) pending.delete(sql); }
  };
}
