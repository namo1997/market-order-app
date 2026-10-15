import { GoogleAuthError } from '../services/google-id-token.js';

export function createGoogleAuthHandlers({ verify, store, getUserById, buildUserPayload, generateToken }) {
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (error) {
      // No provider/SQL messages or request objects in client responses or logs.
      const known = error instanceof GoogleAuthError;
      res.status(known ? error.status : 503).json({ success: false,
        code: known ? error.code : 'GOOGLE_AUTH_UNAVAILABLE', message: 'ไม่สามารถเข้าสู่ระบบหรือจัดการบัญชี Google ได้' });
    }
  };
  return {
    login: handle(async (req, res) => {
      const { email } = await verify(req.body?.id_token);
      const account = await store.find(email);
      if (!account || !Number(account.active)) throw new GoogleAuthError(403, 'GOOGLE_ACCOUNT_NOT_ALLOWED');
      const user = await getUserById(account.user_id);
      if (!user) throw new GoogleAuthError(403, 'GOOGLE_ACCOUNT_NOT_ALLOWED');
      const payload = await buildUserPayload(user);
      // Same claims as the existing login; scope comes only from the mapped user.
      const { id, username, name, role, department_id, branch_id, can_view_supplier_orders,
        can_view_product_group_orders, allowed_supplier_ids, allowed_product_group_ids,
        allowed_transform_product_group_ids, is_production_department, can_use_stock_check } = payload;
      const token = generateToken({ id, username, name, role, department_id, branch_id,
        can_view_supplier_orders, can_view_product_group_orders, allowed_supplier_ids,
        allowed_product_group_ids, allowed_transform_product_group_ids, is_production_department, can_use_stock_check });
      res.json({ success: true, message: 'Login successful', data: { token, user: payload } });
    }),
    list: handle(async (_req, res) => res.json({ success: true, data: await store.list() })),
    add: handle(async (req, res) => res.status(201).json({ success: true, data: await store.add({
      email: req.body?.email, user_id: req.body?.user_id, department_id: req.body?.department_id, created_by: req.user.id,
    }) })),
    disable: handle(async (req, res) => res.json({ success: true, data: await store.disable(req.body?.email) })),
  };
}

export function googleLoginRateLimit({ now = Date.now, max = 10, windowMs = 60000, maxKeys = 10000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now(), key = req.ip || req.socket?.remoteAddress || 'unknown';
    for (const [ip, value] of buckets) if (value.until <= time) buckets.delete(ip);
    const bucket = buckets.get(key) || { count: 0, until: time + windowMs };
    if (bucket.count >= max || (!buckets.has(key) && buckets.size >= maxKeys)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ success: false, code: 'GOOGLE_LOGIN_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' });
    }
    bucket.count++; buckets.set(key, bucket); next();
  };
}
