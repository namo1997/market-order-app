import { useEffect, useState } from 'react';
import { IconButton } from '../../design';
import { browserThemeStorage } from '../../design/theme-preference';
import { dismissInstallHint, shouldShowInstallHint } from './receiving-web-app';

export function ReceivingInstallHint() {
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(() => shouldShowInstallHint(window, navigator, browserThemeStorage()));
  useEffect(() => {
    if (!shouldShowInstallHint(window, navigator, browserThemeStorage())) return;
    const mode = window.matchMedia?.('(display-mode: standalone)');
    const update = () => setVisible(shouldShowInstallHint(window, navigator, browserThemeStorage()));
    mode?.addEventListener('change', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('appinstalled', update);
    return () => {
      mode?.removeEventListener('change', update);
      window.removeEventListener('pageshow', update);
      window.removeEventListener('appinstalled', update);
    };
  }, []);
  if (!visible || dismissed) return null;
  return <aside className="rc-install-hint" aria-label="ติดตั้งแอปรับสินค้า">
    <p>แตะ แชร์ → เพิ่มไปยังหน้าจอโฮม</p>
    <IconButton icon="close" label="ปิดคำแนะนำติดตั้ง" onClick={() => {
      dismissInstallHint(browserThemeStorage()); setDismissed(true);
    }} />
  </aside>;
}
