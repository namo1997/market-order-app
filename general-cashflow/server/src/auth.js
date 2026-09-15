import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getPool } from './db.js';
import {
  CASHIER_STAFF,
  cashierDefinition,
  cashierUsernames,
  isConfiguredCashier,
  isValidAccessPin
} from './domain/cashierAccess.js';
import { allowedGoogleEmail } from './domain/googleLogin.js';
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
  if (user.role === 'cashier' || user.role === 'admin') return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  const { password_hash, ...safeUser } = user;
  return { user: safeUser, token: signToken(safeUser) };
};

export const listCashiersForLogin = async () => {
  const usernames = cashierUsernames();
  const placeholders = usernames.map(() => '?').join(', ');
  const [rows] = await getPool().query(
    `SELECT id, username, full_name, role, is_active
     FROM users
     WHERE role = 'cashier'
       AND is_active = TRUE
       AND username IN (${placeholders})
     ORDER BY FIELD(username, ${placeholders})`,
    [...usernames, ...usernames]
  );
  return rows;
};

export const listCashierSettings = async () => {
  const usernames = cashierUsernames();
  const placeholders = usernames.map(() => '?').join(', ');
  const [rows] = await getPool().query(
    `SELECT username, full_name, role, is_active
     FROM users
     WHERE username IN (${placeholders})`,
    usernames
  );
  const byUsername = new Map(rows.map((row) => [row.username, row]));
  return CASHIER_STAFF.map((definition) => {
    const row = byUsername.get(definition.username);
    return {
      username: definition.username,
      full_name: String(row?.full_name || definition.fullName),
      role: row?.role || 'cashier',
      is_active: row ? Boolean(row.is_active) : false,
      exists: Boolean(row)
    };
  });
};

const cashierSettingsError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const updateCashierSettings = async ({ username, fullName, isActive }) => {
  const normalizedUsername = String(username || '').trim();
  const definition = cashierDefinition(normalizedUsername);
  if (!definition) throw cashierSettingsError('ไม่พบพนักงานแคชเชอร์ที่ระบุ', 404);

  const normalizedFullName = String(fullName ?? definition.fullName).trim();
  if (!normalizedFullName || normalizedFullName.length > 160) {
    throw cashierSettingsError('ชื่อพนักงานต้องมีความยาว 1-160 ตัวอักษร');
  }

  const connection = await getPool().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const [rows] = await connection.query(
      `SELECT id, is_active
       FROM users WHERE username = ? FOR UPDATE`,
      [normalizedUsername]
    );
    const existing = rows[0];
    const requestedActive = isActive === undefined || isActive === null
      ? null
      : ['true', '1', 1, true].includes(isActive);
    const active = requestedActive === null ? Boolean(existing?.is_active) : requestedActive;

    if (existing) {
      await connection.query(
        `UPDATE users
         SET full_name = ?, role = 'cashier', is_active = ?
         WHERE id = ?`,
        [normalizedFullName, active, existing.id]
      );
    } else {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      await connection.query(
        `INSERT INTO users (username, password_hash, full_name, role, is_active)
         VALUES (?, ?, ?, 'cashier', ?)`,
        [normalizedUsername, passwordHash, normalizedFullName, active]
      );
    }

    await connection.commit();
    return {
      username: normalizedUsername,
      full_name: normalizedFullName,
      role: 'cashier',
      is_active: active,
      exists: true
    };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const loginCashier = async ({ username }) => {
  const normalizedUsername = String(username || '').trim();
  if (!isConfiguredCashier(normalizedUsername)) return null;

  const [rows] = await getPool().query(
    `SELECT id, username, full_name, role, is_active
     FROM users
     WHERE username = ? AND role = 'cashier'`,
    [normalizedUsername]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return { user, token: signToken(user) };
};

const secureSecretMatch = (input, expected) => {
  const inputBuffer = Buffer.from(String(input || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return inputBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(inputBuffer, expectedBuffer);
};

export const loginAdminWithPin = async ({ pin }) => {
  if (!isValidAccessPin(config.seed.adminPin) || !secureSecretMatch(String(pin || '').trim(), config.seed.adminPin)) {
    return null;
  }
  const [rows] = await getPool().query(
    `SELECT id, username, full_name, role, is_active
     FROM users WHERE username = ? AND role = 'admin'`,
    [config.seed.adminUsername]
  );
  const user = rows[0];
  if (!user || !user.is_active) return null;
  return { user, token: signToken(user) };
};

const googleClient = config.googleLogin.clientId
  ? new OAuth2Client(config.googleLogin.clientId)
  : null;

export const getGoogleLoginPublicConfig = () => ({
  enabled: Boolean(
    googleClient &&
    config.googleLogin.allowedEmails.length > 0 &&
    config.googleLogin.appUsername
  ),
  client_id: googleClient ? config.googleLogin.clientId : ''
});

export const loginUserWithGoogle = async ({ credential }) => {
  if (!getGoogleLoginPublicConfig().enabled) {
    const error = new Error('Google login is not configured');
    error.statusCode = 503;
    throw error;
  }
  if (!String(credential || '').trim()) {
    const error = new Error('Google credential is required');
    error.statusCode = 400;
    throw error;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: config.googleLogin.clientId
    });
    payload = ticket.getPayload();
  } catch {
    return null;
  }

  if (!allowedGoogleEmail(payload, config.googleLogin.allowedEmails)) {
    return null;
  }

  const [rows] = await getPool().query(
    `SELECT id, username, full_name, role, is_active
     FROM users WHERE username = ?`,
    [config.googleLogin.appUsername]
  );
  const user = rows[0];
  if (!user || !user.is_active || user.role === 'cashier' || user.role === 'admin') return null;

  return { user, token: signToken(user) };
};

export const authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const queryTokenAllowed = req.path.startsWith('/api/attachments/') || req.path.startsWith('/attachments/');
    const queryToken = queryTokenAllowed ? String(req.query.access_token || '') : '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : queryToken;
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
