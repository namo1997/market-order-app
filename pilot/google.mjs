// Non-secret configuration only. Never read an env file or log these values.
export function googleConfig(env = {}) {
  const clientIds = String(env.GOOGLE_OAUTH_CLIENT_IDS || '').trim();
  const raw = String(env.PILOT_GOOGLE_EMAILS || '').trim();
  if (!clientIds || !raw) return { enabled: false, clientIds: '', accounts: [] };
  try {
    if (clientIds.length > 8192 || raw.length > 32768 ||
        clientIds.split(',').some(id => !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id.trim()))) throw new Error();
    const accounts = JSON.parse(raw);
    if (!Array.isArray(accounts) || !accounts.length || accounts.length > 100) throw new Error();
    const seen = new Set();
    for (const account of accounts) {
      if (!account || typeof account.email !== 'string' || ![1, 2].includes(account.user_id)) throw new Error();
      account.email = account.email.trim().toLowerCase();
      if (account.email.length > 254 || !/^[\x21-\x7e]+$/.test(account.email) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || seen.has(account.email)) throw new Error();
      seen.add(account.email);
    }
    return { enabled: true, clientIds, accounts: accounts.map(({ email, user_id }) => ({ email, user_id })) };
  } catch { throw new Error('Invalid pilot Google configuration (emails must map to SYNTHETIC user_id 1 or 2)'); }
}

export async function seedGoogle(pool, source, config) {
  if (!config.enabled) return;
  await source.googleAccounts.createGoogleAccountsStore(pool).ensure();
  // Fixture users have no is_active column: seed only these two freshly created
  // SYNTHETIC identities, using the existing store's schema and lookup at login.
  for (const { email, user_id } of config.accounts) {
    await pool.query('INSERT INTO user_google_accounts (email,user_id,created_by) VALUES (?,?,?)', [email, user_id, user_id]);
  }
}

export const googleJwksFetch = (url, options) => {
  if (url !== 'https://www.googleapis.com/oauth2/v3/certs') throw new Error('PILOT_OUTBOUND_DISABLED');
  return fetch(url, { ...options, redirect: 'error' });
};
