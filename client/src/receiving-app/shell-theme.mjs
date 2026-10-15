import { browserThemeStorage, readThemePreference, saveThemePreference, themePreferenceKey } from '../design/theme-preference.js';

export function resolvedTheme(preference, systemDark) {
  return preference === 'dark' || (preference !== 'light' && systemDark) ? 'dark' : 'light';
}

// Root owns preference; native bars receive the resolved light/dark appearance.
// Observing legacy page attributes also keeps pre-merge Receiving compatible.
export function connectShellTheme({ window: win = window, document: doc = document, storage = browserThemeStorage(), onTheme = () => {} } = {}) {
  const root = doc.documentElement;
  const media = win.matchMedia('(prefers-color-scheme: dark)');
  root.classList.add('solao');
  function apply(preference = readThemePreference(storage)) {
    const value = ['auto', 'light', 'dark'].includes(preference) ? preference : 'auto';
    if (root.dataset.theme !== value) root.dataset.theme = value;
    const theme = resolvedTheme(value, media.matches);
    const background = theme === 'dark' ? '#101522' : '#f7f5f0';
    let meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = doc.createElement('meta'); meta.name = 'theme-color'; doc.head.append(meta); }
    meta.content = background;
    onTheme(theme, value);
    return value;
  }
  apply();
  const observer = new win.MutationObserver(records => {
    if (records.some(record => record.target === root)) apply(root.dataset.theme);
    else apply();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'], subtree: true });
  const systemChanged = () => apply(root.dataset.theme);
  const storageChanged = event => { if (event.key === themePreferenceKey || event.key === null) apply(); };
  media.addEventListener('change', systemChanged);
  win.addEventListener('storage', storageChanged);
  return {
    set(value) { saveThemePreference(storage, value); apply(value); },
    destroy() { observer.disconnect(); media.removeEventListener('change', systemChanged); win.removeEventListener('storage', storageChanged); },
  };
}
