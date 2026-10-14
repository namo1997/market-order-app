import { verifyToken } from '../utils/jwt.js';

// Middleware สำหรับตรวจสอบ JWT token
export const authenticate = (req, res, next) => {
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
