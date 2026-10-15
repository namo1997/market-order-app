export const themePreferenceKey = 'solao.receiving.theme.v1';
export function readThemePreference(storage) {
  try {
    const value = storage?.getItem(themePreferenceKey);
    return ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
  } catch { return 'auto'; }
}
export function saveThemePreference(storage, value) {
  try { storage?.setItem(themePreferenceKey, value); } catch { /* หน้านี้ยังเปลี่ยนธีมได้เมื่อปิด storage */ }
}

export function browserThemeStorage() {
  try { return window.localStorage; } catch { return undefined; }
}
