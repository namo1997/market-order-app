import { verifyToken } from '../utils/jwt.js';
import { isUserActive } from '../models/user.model.js';

// cache ผลตรวจสถานะผู้ใช้สั้นๆ เพื่อไม่ต้อง query ทุก request
const ACTIVE_CACHE_TTL_MS = 30 * 1000;
const activeUserCache = new Map();

const checkUserActive = async (userId) => {
  const key = String(userId);
  const cached = activeUserCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.active;
  const active = await isUserActive(userId);
  activeUserCache.set(key, { active, expiresAt: now + ACTIVE_CACHE_TTL_MS });
  if (activeUserCache.size > 5000) activeUserCache.clear();
  return active;
};

// Middleware สำหรับตรวจสอบ JWT token
export const authenticate = async (req, res, next) => {
  try {
    // ดึง token จาก header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // ตัด "Bearer " ออก

    // ตรวจสอบ token
    const decoded = verifyToken(token);

    // ผู้ใช้/แผนกที่ถูกปิดใช้งานแล้ว ห้ามใช้ token เดิมต่อ
    let active = true;
    try {
      active = await checkUserActive(decoded.id);
    } catch (lookupError) {
      // DB มีปัญหาชั่วคราว: ไม่บังคับ logout ทุกคน ให้ route ปลายทางจัดการ error เอง
      console.error('authenticate: user status lookup failed', lookupError?.message);
    }
    if (!active) {
      return res.status(401).json({
        success: false,
        message: 'บัญชีหรือแผนกนี้ถูกปิดใช้งานแล้ว กรุณาเข้าสู่ระบบใหม่'
      });
    }

    // เก็บข้อมูล user ใน request object
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Middleware สำหรับตรวจสอบ role admin
export const requireAdmin = (req, res, next) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
  next();
};

export const requireAdminOrProduction = (req, res, next) => {
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  const canViewSupplierOrders = Boolean(
    req.user.can_view_product_group_orders ?? req.user.can_view_supplier_orders
  );
  if (!isAdmin && !canViewSupplierOrders) {
    return res.status(403).json({
      success: false,
      message: 'Access denied.'
    });
  }
  next();
};
