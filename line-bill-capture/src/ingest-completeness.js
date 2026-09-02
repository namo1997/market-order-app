const DAY_MS = 24 * 60 * 60 * 1000;

const parseDate = (value) => new Date(`${value}T00:00:00Z`);
const formatDate = (date) => date.toISOString().slice(0, 10);
const daysBetween = (start, end) => Math.round((parseDate(end) - parseDate(start)) / DAY_MS);
const missingDates = (start, end) => {
  const rows = [];
  for (let cursor = parseDate(start).getTime() + DAY_MS; cursor < parseDate(end).getTime(); cursor += DAY_MS) {
    rows.push(formatDate(new Date(cursor)));
  }
  return rows;
};

export const detectIngestGaps = (dailyRows = [], { minimumGapDays = 2 } = {}) => {
  const sourceDates = new Map();
  const sourcesByDate = new Map();
  for (const row of dailyRows) {
    const sourceId = String(row?.source_id || '').trim();
    const date = String(row?.business_date || '').trim();
    if (!sourceId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(row?.message_count || 0) <= 0) continue;
    if (!sourceDates.has(sourceId)) sourceDates.set(sourceId, new Set());
    sourceDates.get(sourceId).add(date);
    if (!sourcesByDate.has(date)) sourcesByDate.set(date, new Set());
    sourcesByDate.get(date).add(sourceId);
  }

  const anomalies = [];
  for (const [sourceId, dateSet] of sourceDates) {
    const dates = [...dateSet].sort();
    if (dates.length < 2) continue;
    for (let index = 1; index < dates.length; index += 1) {
      const missing = missingDates(dates[index - 1], dates[index]);
      if (missing.length < minimumGapDays) continue;
      const siblingActiveDates = missing.filter((date) =>
        [...(sourcesByDate.get(date) || [])].some((otherSource) => otherSource !== sourceId));
      if (siblingActiveDates.length < Math.ceil(missing.length / 2)) continue;
      anomalies.push({
        type: 'internal_webhook_gap',
        severity: missing.length >= 3 ? 'high' : 'warning',
        source_id: sourceId,
        start_date: missing[0],
        end_date: missing.at(-1),
        missing_days: missing.length,
        sibling_active_days: siblingActiveDates.length,
        evidence: {
          previous_activity_date: dates[index - 1],
          next_activity_date: dates[index],
          sibling_active_dates: siblingActiveDates
        },
        shadow_recommendation: 'ตรวจ LINE export และนำเข้าข้อความกับรูปของช่วงนี้ ระบบต้องไม่เดาหรือสร้างข้อมูลที่หายเอง'
      });
    }
  }

  return anomalies.sort((a, b) => b.missing_days - a.missing_days || a.start_date.localeCompare(b.start_date));
};

export const summarizeCompleteness = (dailyRows = [], options = {}) => {
  const anomalies = detectIngestGaps(dailyRows, options);
  return {
    status: anomalies.some((row) => row.severity === 'high') ? 'risk' : anomalies.length ? 'warning' : 'ok',
    monitored_sources: new Set(dailyRows.map((row) => String(row?.source_id || '')).filter(Boolean)).size,
    anomalies
  };
};
