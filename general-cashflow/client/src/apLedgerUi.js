export const AP_THEME_KEY = 'solao.ap-ledger.theme';

export function readApThemePreference(host = globalThis) {
  try {
    const value = host.localStorage?.getItem(AP_THEME_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch { return null; }
}

export function systemApTheme(host = globalThis) {
  try { return host.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function saveApTheme(theme, host = globalThis) {
  try {
    if (theme === 'light' || theme === 'dark') host.localStorage?.setItem(AP_THEME_KEY, theme);
    else host.localStorage?.removeItem(AP_THEME_KEY);
  } catch { /* The selection still works when storage is blocked. */ }
}

const thaiDate = options => new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', { timeZone: 'Asia/Bangkok', ...options });
export const AP_MONTHS = Array.from({ length: 12 }, (_, i) => thaiDate({ month: 'long' }).format(new Date(Date.UTC(2026, i, 1))));

export function formatApMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) return 'ไม่ระบุเดือน';
  const [year, month] = value.split('-').map(Number);
  return `${AP_MONTHS[month - 1]} ${year + 543}`;
}

export function formatApDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'ไม่ระบุวันที่';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? 'ไม่ระบุวันที่' : thaiDate({ day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

// Translate report terminology without changing its amounts, source records or caveats.
export function formatApNote(value) {
  const terms = { 'P&L': 'กำไรขาดทุน', LBC: 'บิลไลน์', SSO: 'ประกันสังคม', HRMS: 'ระบบพนักงาน', POS: 'ระบบขายหน้าร้าน', AP: 'บัญชีซื้อ', snapshot: 'ชุดข้อมูล', statement: 'รายการธนาคาร' };
  return String(value ?? '').replace(/P&L|\b(?:LBC|SSO|HRMS|POS|AP|snapshot|statement)\b/g, term => terms[term]).replace(/ซัพ/g, 'ผู้ขาย').replace(/ · /g, ' ');
}

export function formatApCapturedAt(value) {
  // Cashflow DATETIME strings without an offset are UTC, like the other report views.
  const text = String(value || '').replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุเวลา' : thaiDate({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

// Read the server's decimal amount exactly: never round an abnormal difference to zero.
export function apBalanceStatus(balance) {
  const value = balance?.difference;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value))) {
    return { state: 'pending', label: 'ยังตรวจดุลไม่ได้' };
  }
  const [whole, fraction = ''] = String(value).replace('-', '').split('.');
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (String(value).startsWith('-') ? -1n : 1n);
  if (cents === 0n) return { state: 'balanced', label: 'เดบิตเท่ากับเครดิต' };
  const absolute = cents < 0n ? -cents : cents;
  const amount = `${cents < 0n ? '-' : ''}${(absolute / 100n).toLocaleString('th-TH')}.${String(absolute % 100n).padStart(2, '0')}`;
  return { state: 'error', label: `ดุลผิดปกติ ต่าง ${amount} บาท` };
}

// Never fall back to displaying a database table name or an internal source key.
export function formatApReference(value) {
  const text = String(value ?? '');
  const bill = /^lbc:bill:(\d+)$/.exec(text);
  if (bill) return `บิลไลน์ #${bill[1]}`;
  const statement = /^cashflow:statement:(\d+)$/.exec(text);
  if (statement) return `รายการธนาคาร #${statement[1]}`;
  if (/^pnl_credit_suppliers:\d+$/.test(text)) return 'ทะเบียนผู้ขายเครดิต';
  return 'เอกสารต้นทาง';
}

export function matchesApSearch(search, ...displayedValues) {
  const query = String(search ?? '').trim().toLowerCase();
  return !query || displayedValues.some(value => String(value ?? '').toLowerCase().includes(query));
}

export function apLoadErrorState(error) {
  // The shared API client keeps the server's public code in Error.message.
  return (error?.code || error?.message) === 'AP_NOT_IMPORTED' ? 'empty' : 'error';
}
