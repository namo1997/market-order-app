export const themePreferenceKey = 'solao.receiving.theme.v1';
export function readThemePreference(storage) {
  try {
    const value = storage?.getItem(themePreferenceKey);
    return ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
  } catch { return 'auto'; }
}
export function saveThemePreference(storage, value) {
  try { storage?.setItem(themePreferenceKey, value); } catch { /* หน้านี้ยังเปลี่ยนธีมได้เมื่อปิด storage */ }
  applyThemePreference(value);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(themeChangeEvent, { detail: value }));
}

export function browserThemeStorage() {
  try { return window.localStorage; } catch { return undefined; }
}

export function readRootThemePreference() {
  const value = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  return ['auto', 'light', 'dark'].includes(value) ? value : readThemePreference(browserThemeStorage());
}

// One owner for the shell, login, content and dialogs. Auto follows CSS media queries.
export const themeChangeEvent = 'solao:theme-change';
export function applyThemePreference(value) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
}
