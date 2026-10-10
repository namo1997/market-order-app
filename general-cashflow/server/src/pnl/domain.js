import { roundMoney } from '../domain/money.js';
export const pnlError = (code, statusCode = 422) => Object.assign(new Error(code), { code, statusCode, isPnlError: true });
export const monthRange = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) || Number(month.slice(0, 4)) < 1000) throw pnlError('INVALID_MONTH');
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${days}`, days };
};
export const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s/g, '')
  .replace(/บจก\.|หจก\.|บริษัท|จำกัด|\(มหาชน\)|ร้าน/g, '');
// Convert each operand before addition; never sum currency floats.
export const cents = (value) => Math.round(roundMoney(value) * 100);
export const money = (value) => value / 100;
export const amountInput = (value) => {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(value)) || cents(value) <= 0) throw pnlError('INVALID_AMOUNT');
  return money(cents(value)).toFixed(2);
};
export const classify = (item, rules = [], override = {}) => {
  const excluded = override.excluded != null ? Boolean(override.excluded)
    : ['internal_transfer', 'loan', 'refund_adjustment'].includes(item.transaction_type);
  const rule = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id).find((row) =>
    normalize(row.match_field === 'supplier' ? item.supplier_name : item.description).includes(row.pattern));
  return { ...item, excluded, category_code: override.category_code || rule?.category_code || null,
    unreviewed: item.profile_status !== 'reviewed' };
};
export const parseBranchMap = (value) => {
  try { const parsed = JSON.parse(value || '{}');
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object'
      && Object.values(parsed).every((entry) => typeof entry === 'string') ? parsed : {};
  } catch { return {}; }
};
const safeText = (value) => value == null ? null : String(value).replace(/(?:\d[ -]?){9,}/g, '[ปกปิดเลข]');
export const snapshotItems = (snapshot) => {
  if (!snapshot?.pnl_fields_version || !Array.isArray(snapshot.items)) throw pnlError('LBC_EXPORT_V2_REQUIRED', 502);
  const seen = new Set(); let duplicateKeys = 0;
  const items = [];
  for (const [kind, rows] of [['BILL', snapshot.items], ['PAYMENT_WITHOUT_BILL', snapshot.payments_without_bill || []]]) {
    if (!Array.isArray(rows)) throw pnlError('LBC_EXPORT_INVALID', 502);
    for (const row of rows) {
      if (!row.stable_key || typeof row.stable_key !== 'string' || row.stable_key.length > 120) throw pnlError('LBC_EXPORT_V2_REQUIRED', 502);
      if (seen.has(row.stable_key)) { duplicateKeys++; continue; }
      seen.add(row.stable_key);
      const profile = row.expense_profile || {};
      const amount = kind === 'BILL' ? row.amount_incl_vat : row.amount;
      if (amount == null || !Number.isFinite(Number(amount))) throw pnlError('LBC_EXPORT_INVALID', 502);
      // Persist only P&L facts, excluding recipient/account metadata in legacy exports.
      items.push({ stable_key: row.stable_key, kind, amount: money(cents(amount)).toFixed(2),
        supplier_name: safeText(profile.supplier_name || row.supplier_name || null),
        description: safeText(profile.purpose || row.description || null), payment_method: row.payment_method || null,
        transaction_type: profile.transaction_type || null, profile_status: profile.status || null, bill_id: row.bill_id || null });
    }
  }
  return { items, duplicateKeys };
};

const monthIndex = (month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
export const validatePeriodMonth = (value, businessDate) => {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw pnlError('INVALID_PERIOD_MONTH');
  const source = String(businessDate).slice(0, 7);
  const delta = monthIndex(source) - monthIndex(value);
  if (delta < 0 || delta > 3) throw pnlError('INVALID_PERIOD_MONTH');
  return delta === 0 ? null : `${value}-01`;
};
const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const shortMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
export const suggestPeriodMonth = (description, businessDate) => {
  const names = [...thaiMonths, ...shortMonths];
  const escaped = names.map((name) => name.replace(/\./g, '\\.'));
  const match = String(description ?? '').match(new RegExp(`(?:ประจำเดือน|เดือน)\\s*(${escaped.join('|')})(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{4}))?`));
  if (!match) return null;
  const number = names.indexOf(match[1]) % 12 + 1;
  const source = String(businessDate).slice(0, 7);
  let year = match[2] ? Number(match[2]) - 543 : Number(source.slice(0, 4));
  if (!match[2] && number > Number(source.slice(5, 7))) year--;
  const target = `${year}-${String(number).padStart(2, '0')}`;
  try { return validatePeriodMonth(target, businessDate) ? target : null; } catch { return null; }
};
