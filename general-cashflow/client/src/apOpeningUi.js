// Keep unknown values unknown. Totals use decimal strings from the read-only API.
export function sumApAmounts(values) {
  if (!values.length || values.some(v => typeof v !== 'string' || !/^-?\d+\.\d{2}$/.test(v))) return null;
  const total = values.reduce((n, v) => n + BigInt(v.replace('.', '')), 0n);
  const abs = (total < 0n ? -total : total).toString().padStart(3, '0');
  return `${total < 0n ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`;
}

export function apOpeningState(report) {
  const controls = report?.controls;
  if (controls?.openingComplete) return { state: 'complete', missing: 0, label: 'ยอดยกมาครบ' };
  const missing = controls?.missingSuppliers?.length ?? report?.ledger?.length ?? 0;
  const imported = controls?.byBranch?.some(b => b.openingImportId != null || b.openingComplete);
  const confirmed = report?.ledger?.some(s => s.openingConfirmed);
  return { state: imported || confirmed ? 'partial' : 'none', missing,
    label: imported || confirmed ? `ยอดยกมายังขาด ${missing} รายการผู้ขายแยกสาขา` : 'ยังไม่มียอดยกมา' };
}

export function visibleApSuppliers(ledger, all) {
  return ledger.filter(r => all || [r.paid, r.opening, r.closing].some(v => v != null && Number(v) !== 0) || r.missingOpening);
}

export const AP_AGING_BUCKETS = [['current', 'ยังไม่ถึงกำหนด'], ['days1_30', '1–30 วัน'],
  ['days31_60', '31–60 วัน'], ['days61_90', '61–90 วัน'], ['days91plus', 'มากกว่า 90 วัน']];

export function apAgingTotals(report) {
  if (!report?.controls?.openingComplete) return null;
  return Object.fromEntries(AP_AGING_BUCKETS.map(([key]) => [key,
    sumApAmounts(report.ledger.map(r => r.aging?.[key]))]));
}
