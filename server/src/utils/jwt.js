import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const configuredSecret = process.env.JWT_SECRET;
const knownDefaults = new Set([
  'default-secret-key', 'market-order-secret',
  'market-order-secret-key-2026-change-this-in-production',
  'your-secret-key-change-this-in-production'
]);
if (process.env.NODE_ENV === 'production' &&
    (!configuredSecret || configuredSecret.trim().length < 32 || knownDefaults.has(configuredSecret.trim()))) {
  throw new Error('Production requires a unique JWT_SECRET of at least 32 characters');
}
const JWT_SECRET = configuredSecret || 'default-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// สร้าง JWT token
export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

// ตรวจสอบ JWT token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// Decode token โดยไม่ verify (สำหรับ debugging)
export const decodeToken = (token) => {
  return jwt.decode(token);
};
