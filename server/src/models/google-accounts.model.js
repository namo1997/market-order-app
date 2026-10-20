import { GoogleAuthError, normalizeGoogleEmail } from '../services/google-id-token.js';

// Injected DB keeps imports and tests free of implicit database connections.
export function createGoogleAccountsStore(db) {
  let ready;
  const ensure = () => {
    if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS user_google_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
      user_id INT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_google_accounts_user (user_id),
      INDEX idx_google_accounts_creator (created_by),
      CONSTRAINT fk_google_accounts_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_google_accounts_creator FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB`).catch(e => { ready = undefined; throw e; });
    return ready;
  };
  const positiveId = value => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) {
      throw new GoogleAuthError(422, 'INVALID_USER_ID');
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new GoogleAuthError(422, 'INVALID_USER_ID');
    return id;
  };
  return {
    ensure,
    async find(email) {
      await ensure();
      const [rows] = await db.query('SELECT user_id, active FROM user_google_accounts WHERE email = ?', [normalizeGoogleEmail(email)]);
      return rows[0] || null;
    },
    async list() {
      await ensure();
      const [rows] = await db.query(`SELECT g.id, g.email, g.user_id, g.active, g.created_by, g.created_at, g.updated_at,
        u.name, u.department_id, d.branch_id FROM user_google_accounts g
        JOIN users u ON u.id = g.user_id JOIN departments d ON d.id = u.department_id ORDER BY g.id`);
      return rows;
    },
    async add({ email, user_id, department_id, created_by }) {
      const normalized = normalizeGoogleEmail(email);
      const userId = positiveId(user_id), creator = positiveId(created_by);
      const departmentId = department_id === undefined ? null : positiveId(department_id);
      await ensure();
      const [users] = await db.query('SELECT id, department_id FROM users WHERE id = ? AND is_active = TRUE', [userId]);
      if (!users[0]) throw new GoogleAuthError(404, 'USER_NOT_FOUND');
      if (departmentId !== null && Number(users[0].department_id) !== departmentId) {
        throw new GoogleAuthError(422, 'USER_DEPARTMENT_MISMATCH');
      }
      try {
        await db.query('INSERT INTO user_google_accounts (email, user_id, created_by) VALUES (?, ?, ?)', [normalized, userId, creator]);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') throw new GoogleAuthError(409, 'GOOGLE_ACCOUNT_EXISTS');
        throw e;
      }
      return { email: normalized, user_id: userId, active: true };
    },
    async disable(email) {
      await ensure();
      const normalized = normalizeGoogleEmail(email);
      if (!await this.find(normalized)) throw new GoogleAuthError(404, 'GOOGLE_ACCOUNT_NOT_FOUND');
      await db.query('UPDATE user_google_accounts SET active = FALSE WHERE email = ?', [normalized]);
      return { email: normalized, active: false };
    },
  };
}
