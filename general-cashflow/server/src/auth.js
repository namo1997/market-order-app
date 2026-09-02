import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getPool } from './db.js';
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
  if (!user || !user.is_active || user.role === 'cashier') return null;

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
