// Preferences is app-private on Android (backup is disabled in the manifest).
// JWT decoding only detects a known expiry; opaque pilot tokens are checked by /auth/me.
export const SESSION_KEY = 'receiving.session.v1';
const fields = ['id', 'name', 'role', 'branch', 'department', 'branch_id', 'department_id'];
export function sessionExpiry(token, decode = globalThis.atob) {
  if (typeof token !== 'string' || !token.trim()) return 0;
  // Pilot issues an opaque UUID with an 8-hour lifetime held only on the server.
  // null means unknown, not expired and not an unlimited server session.
  if (!token.includes('.')) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decode(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    if (!Object.hasOwn(payload, 'exp')) return null;
    const { exp } = payload;
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
        const expiry = sessionExpiry(session.token, decode);
        if (session.origin !== origin || typeof session.token !== 'string' || !session.user?.id ||
            (expiry !== null && expiry <= now())) throw Error('invalid-session');
        return session;
      } catch { await clear(); return null; }
    },
  };
}
