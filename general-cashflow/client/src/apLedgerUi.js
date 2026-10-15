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
  try { host.localStorage?.setItem(AP_THEME_KEY, theme); }
  catch { /* The toggle still works when storage is blocked. */ }
}

// Never fall back to displaying a database table name or an internal source key.
export function formatApReference(value) {
  const text = String(value ?? '');
  const bill = /^lbc:bill:(\d+)$/.exec(text);
  if (bill) return `บิล LBC #${bill[1]}`;
  const statement = /^cashflow:statement:(\d+)$/.exec(text);
  if (statement) return `รายการธนาคาร #${statement[1]}`;
  if (/^pnl_credit_suppliers:\d+$/.test(text)) return 'ทะเบียนซัพเครดิต';
  return 'เอกสารต้นทาง';
}
