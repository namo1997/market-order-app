// Preferences is app-private on Android (backup is disabled in the manifest).
// JWT decoding only detects expiry; server authentication remains authoritative.
export const SESSION_KEY = 'receiving.session.v1';
const fields = ['id', 'name', 'role', 'branch', 'department', 'branch_id', 'department_id'];
export function sessionExpiry(token, decode = globalThis.atob) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(decode(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch { return 0; }
}
export function createSessionStore(preferences, { now = Date.now, decode = globalThis.atob } = {}) {
  // Serialize mutations so a delayed login write cannot resurrect a logged-out session.
  let pending = Promise.resolve();
  const mutate = action => { pending = pending.catch(() => {}).then(action); return pending; };
  const clear = () => mutate(() => preferences.remove({ key: SESSION_KEY }));
  return {
    clear,
    save(origin, token, user) {
      const minimal = Object.fromEntries(fields.filter(key => ['string', 'number'].includes(typeof user?.[key])).map(key => [key, user[key]]));
      return mutate(() => preferences.set({ key: SESSION_KEY, value: JSON.stringify({ origin, token, user: minimal }) }));
    },
    async restore(origin) {
      await pending.catch(() => {});
      const { value } = await preferences.get({ key: SESSION_KEY });
      if (!value) return null;
      try {
        const session = JSON.parse(value);
        if (session.origin !== origin || typeof session.token !== 'string' || !session.user?.id ||
            sessionExpiry(session.token, decode) <= now()) throw Error('invalid-session');
        return session;
      } catch { await clear(); return null; }
    },
  };
}
