import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

export function createNativeGoogleAuth({ plugin, isNative, clientId }) {
  let initialized;
  return {
    async signIn() {
      if (!clientId?.trim()) throw new Error('ยังไม่ได้ตั้งค่า Google Client ID สำหรับแอป');
      if (!isNative()) throw new Error('กรุณาใช้ปุ่ม Google ของเว็บไซต์ หรือเปิดแอป Android');
      if (!initialized) initialized = plugin.initialize({ google: { webClientId: clientId.trim(), mode: 'online' } })
        .catch(() => { initialized = undefined; throw new Error('เริ่ม Google Login ไม่สำเร็จ'); });
      await initialized;
      try {
        const login = await plugin.login({ provider: 'google', options: {
          scopes: ['email', 'profile'], filterByAuthorizedAccounts: false, autoSelectEnabled: false,
        } });
        const token = login.result?.idToken;
        if (typeof token !== 'string' || !token) throw new Error('Missing ID token');
        return token;
      } catch { throw new Error('เข้าสู่ระบบ Google ไม่สำเร็จหรือยกเลิก กรุณาลองใหม่'); }
      finally {
        // The plugin can cache credentials in native preferences. Clear them;
        // the receiving JWT remains only in this app's in-memory API instance.
        await plugin.logout({ provider: 'google' }).catch(() => {});
      }
    },
    async signOut() { if (initialized) await plugin.logout({ provider: 'google' }).catch(() => {}); },
  };
}
const auth = createNativeGoogleAuth({ plugin: SocialLogin, isNative: () => Capacitor.isNativePlatform(),
  clientId: import.meta.env?.VITE_GOOGLE_WEB_CLIENT_ID });
export const signInGoogle = () => auth.signIn();
export const signOutGoogle = () => auth.signOut();
