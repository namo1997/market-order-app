import { readThemePreference, themeChangeEvent } from '../../design/theme-preference.js';

export const installHintKey = 'solao.receiving.install-hint.v1';
export const isReceivingPath = (pathname) => /^\/receiving\/?$/.test(pathname || '');
export const receivingThemeColor = (preference, systemDark) =>
  preference === 'dark' || (preference === 'auto' && systemDark) ? '#101522' : '#f7f5f0';

// Replace all matching tags while mounted, then put back the original nodes/attributes.
// Keeping this outside the lazy page also covers loading and auth checks on this route.
export function mountReceivingHead(doc, win) {
  const dark = win.matchMedia('(prefers-color-scheme: dark)');
  const specs = [
    ['link[rel="manifest"]', 'link', { rel: 'manifest', href: '/receiving.webmanifest' }],
    ['link[rel="apple-touch-icon"]', 'link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/receiving-icons/apple-touch-icon.png' }],
    ['link[rel="icon"]', 'link', { rel: 'icon', type: 'image/png', href: '/receiving-icons/icon-192.png' }],
    ['meta[name="apple-mobile-web-app-title"]', 'meta', { name: 'apple-mobile-web-app-title', content: 'รับสินค้า' }],
    ['meta[name="apple-mobile-web-app-capable"]', 'meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta[name="mobile-web-app-capable"]', 'meta', { name: 'mobile-web-app-capable', content: 'yes' }],
    ['meta[name="apple-mobile-web-app-status-bar-style"]', 'meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }],
    ['meta[name="theme-color"]', 'meta', { name: 'theme-color', content: '' }],
  ];
  const records = specs.map(([selector, tag, attributes]) => {
    const original = [...doc.head.querySelectorAll(selector)];
    original.forEach(node => node.remove());
    const node = doc.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    doc.head.appendChild(node);
    return { original, node };
  });
  const update = (event) => {
    let storage;
    try { storage = win.localStorage; } catch { /* Safari private/storage policy */ }
    const preference = event?.type === themeChangeEvent ? event.detail
      : event?.type === 'storage' ? readThemePreference(storage)
        : doc.documentElement.dataset.theme || readThemePreference(storage);
    const color = receivingThemeColor(preference, dark.matches);
    records[7].node.setAttribute('content', color);
    // Opaque black with white text in dark mode; default black text in light mode.
    records[6].node.setAttribute('content', color === '#101522' ? 'black' : 'default');
  };
  update();
  dark.addEventListener('change', update);
  win.addEventListener(themeChangeEvent, update);
  win.addEventListener('storage', update);
  return () => {
    dark.removeEventListener('change', update);
    win.removeEventListener(themeChangeEvent, update);
    win.removeEventListener('storage', update);
    records.forEach(({ original, node }) => { node.remove(); original.forEach(item => doc.head.appendChild(item)); });
  };
}

export function shouldShowInstallHint(win, nav, storage) {
  if (!isReceivingPath(win.location?.pathname) || win.Capacitor?.isNativePlatform?.()) return false;
  const ua = nav.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const safari = /Version\/.+Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|FBAN|FBAV|Instagram|Line\//i.test(ua);
  if (!ios || !safari || nav.standalone || win.matchMedia?.('(display-mode: standalone)').matches) return false;
  try { return storage?.getItem(installHintKey) !== 'dismissed'; } catch { return true; }
}

export function dismissInstallHint(storage) {
  try { storage?.setItem(installHintKey, 'dismissed'); } catch { /* ปิดได้ในหน้านี้แม้ Safari ไม่อนุญาต storage */ }
}
