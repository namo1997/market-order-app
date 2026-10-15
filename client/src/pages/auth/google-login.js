import apiClient from '../../api/client';

export async function exchangeGoogleCredential(idToken) {
  try {
    const { data } = await apiClient.post('/auth/google', { id_token: idToken });
    if (!data?.success || !data.data?.token || !data.data?.user) throw new Error('Invalid session');
    return data.data;
  } catch (error) {
    const messages = {
      GOOGLE_ACCOUNT_NOT_ALLOWED: 'อีเมลนี้ยังไม่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแล',
      GOOGLE_LOGIN_RATE_LIMITED: 'เข้าสู่ระบบถี่เกินไป กรุณารอสักครู่',
      GOOGLE_AUTH_NOT_CONFIGURED: 'ผู้ดูแลยังไม่ได้ตั้งค่า Google Login บนเซิร์ฟเวอร์',
    };
    throw new Error(messages[error.response?.data?.code] || 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่');
  }
}

let gisPromise;
export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!gisPromise) gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error('Google timeout')); }, 15000);
    script.onload = () => { clearTimeout(timer); window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google unavailable')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Google unavailable')); };
    document.head.appendChild(script);
  }).catch(error => { gisPromise = undefined; throw error; });
  return gisPromise;
}
