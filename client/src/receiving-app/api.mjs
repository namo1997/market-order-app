export function normalizeBase(value) {
  const text = value.trim();
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw new Error('ที่อยู่ API ไม่ถูกต้อง'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('กรุณาใช้ URL แบบ http หรือ https ที่ไม่มีข้อมูลเข้าสู่ระบบ');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('ใส่เฉพาะที่อยู่เซิร์ฟเวอร์ ไม่ต้องใส่ /api');
  return url.origin;
}

export function bangkokDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export class ApiError extends Error {
  constructor(status, code) {
    const messages = { 401: 'กรุณาเข้าสู่ระบบใหม่', 403: 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้',
      404: 'ไม่พบข้อมูลหรือเซิร์ฟเวอร์ยังไม่มี API รับสินค้า', 422: 'ข้อมูลคำขอไม่ถูกต้อง',
      409: 'สถานะข้อมูลเปลี่ยนไป กรุณาโหลดใหม่', 503: 'ระบบรับสินค้ายังไม่พร้อมใช้งาน' };
    super(messages[status] || 'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
    this.status = status;
    this.code = typeof code === 'string' ? code : '';
    // Match the shared receiving UI's conflict/uncertain-write recovery contract.
    if (status) this.response = { status, data: { code: this.code } };
    else this.request = {};
  }
}

// Transport injection keeps the existing server auth contract testable without real credentials.
export function createReceivingApi(base, transport, onUnauthorized = () => {}) {
  const origin = normalizeBase(base);
  let bearer = '';
  async function request(path, { method = 'GET', data, params, timeout = 15000, responseType, envelope = false } = {}) {
    if (!origin) throw new Error('กรุณาตั้งค่าที่อยู่ API ก่อน');
    let response;
    try {
      response = await transport({ url: `${origin}/api${path}${params && Object.keys(params).length ? '?' + new URLSearchParams(Object.entries(params).filter(([, value]) => value != null)) : ''}`, method, data,
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        connectTimeout: 15000, readTimeout: timeout, disableRedirects: true, responseType,
      });
    } catch { throw new ApiError(0); }
    if (response.status === 401) { bearer = ''; onUnauthorized(); }
    const body = response.data;
    if (response.status < 200 || response.status >= 300 || (responseType !== 'blob' && body?.success !== true)) {
      throw new ApiError(response.status, body?.code);
    }
    return envelope ? { data: body } : body.data;
  }
  const client = {
    get: (path, options) => request(path, { ...options, envelope: true }),
    post: (path, data, options) => request(path, { ...options, method: 'POST', data, envelope: true }),
    put: (path, data, options) => request(path, { ...options, method: 'PUT', data, envelope: true }),
  };
  return {
    client,
    branches: () => request('/auth/branches'),
    departments: id => request(`/auth/departments/${encodeURIComponent(id)}`),
    async login(departmentId) {
      const result = await request('/auth/login', { method: 'POST', data: { departmentId } });
      if (typeof result?.token !== 'string' || !result.user) throw new ApiError(0);
      bearer = result.token;
      return result.user;
    },
    expected: () => request(`/receiving-documents/expected?date=${bangkokDate()}`),
    logout() { bearer = ''; },
  };
}
