import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getPool } from './db.js';
import { assertPermission } from './domain/permissions.js';

export const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

export const loginUser = async ({ username, password }) => {
  const [rows] = await getPool().query(
    `SELECT id, username, password_hash, full_name, role, is_active
     FROM users WHERE username = ?`,
    [username]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  if (user.role === 'cashier') return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  const { password_hash, ...safeUser } = user;
  return { user: safeUser, token: signToken(safeUser) };
};

export const loginCashierWithoutPassword = async ({ username = '' } = {}) => {
  const params = [];
  let usernameFilter = '';
  const normalizedUsername = String(username || '').trim();
  if (normalizedUsername) {
    usernameFilter = 'AND username = ?';
    params.push(normalizedUsername);
  }

  const [rows] = await getPool().query(
    `SELECT id, username, full_name, role, is_active
     FROM users
     WHERE role = 'cashier'
       AND is_active = TRUE
       ${usernameFilter}
     ORDER BY id ASC
     LIMIT 1`,
    params
  );
  const user = rows[0];
  if (!user) return null;
  return { user, token: signToken(user) };
};

export const authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    req.user = jwt.verify(token, config.jwt.secret);
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export const requirePermission = (permission) => (req, res, next) => {
  try {
    assertPermission(req.user, permission);
    return next();
  } catch (error) {
    return next(error);
  }
};
