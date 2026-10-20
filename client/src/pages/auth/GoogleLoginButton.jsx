import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { exchangeGoogleCredential, loadGoogleIdentity } from './google-login';

export function GoogleLoginButton() {
  const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  const target = useRef(null), pending = useRef(false);
  const { acceptGoogleSession } = useAuth();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    loadGoogleIdentity().then(gis => {
      if (!alive) return;
      gis.initialize({ client_id: clientId, auto_select: false, callback: async result => {
        if (!alive || pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try {
          const session = await exchangeGoogleCredential(result.credential);
          if (alive) acceptGoogleSession(session);
        } catch (e) { if (alive) setError(e.message); }
        finally { pending.current = false; if (alive) setBusy(false); }
      } });
      gis.renderButton(target.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', locale: 'th' });
    }).catch(() => { if (alive) setError('โหลด Google ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและโหลดหน้าใหม่'); });
    const container = target.current;
    return () => { alive = false; container?.replaceChildren(); };
  }, [clientId, acceptGoogleSession]);
  if (!clientId) return null;
  return <section className="p-4 border-b border-slate-100" aria-label="เข้าสู่ระบบด้วย Google">
    <p className="text-sm mb-2">เข้าสู่ระบบด้วย Google</p>
    <div ref={target} style={busy ? { pointerEvents: 'none', opacity: 0.6 } : undefined} />
    {busy && <p role="status">กำลังเข้าสู่ระบบ…</p>}
    {error && <p role="alert" className="text-sm text-red-700 mt-2">{error}</p>}
  </section>;
}
