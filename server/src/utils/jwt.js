import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const DEV_FALLBACK_SECRET = 'default-secret-key';
const isProduction = () => process.env.NODE_ENV === 'production';

const resolveJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (secret) return secret;
  if (isProduction()) {
    console.error('FATAL: JWT_SECRET is not set. Refusing to start in production with a default secret.');
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  console.warn('[security] JWT_SECRET is not set; using an insecure development fallback secret.');
  return DEV_FALLBACK_SECRET;
};

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Token ของระบบ PR/PO (general purchase) ต้องใช้ secret แยกจาก token หลัก
// เพื่อไม่ให้นำ token PIN/หัวหน้า ไปใช้กับ API หลักได้
export const getMainJwtSecret = () => JWT_SECRET;
export const getGeneralPurchaseJwtSecret = () =>
  String(process.env.GENERAL_PURCHASE_JWT_SECRET || '').trim() || `${JWT_SECRET}:general_purchase`;

// สร้าง JWT token
export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

// ตรวจสอบ JWT token (เฉพาะ token ของระบบหลัก)
export const verifyToken = (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
  // token หลักไม่มีฟิลด์ scope; token ที่มี scope อื่น (เช่น general_purchase) ห้ามใช้กับ API หลัก
  if (!decoded || typeof decoded !== 'object' || (decoded.scope != null && decoded.scope !== 'main') || !decoded.id) {
    throw new Error('Invalid or expired token');
  }
  return decoded;
};

// Decode token โดยไม่ verify (สำหรับ debugging)
export const decodeToken = (token) => {
  return jwt.decode(token);
};
