// Resolved once by Vite, from build variables only. Never a runtime login fallback.
export function resolveAuthMode({ mode = 'auto', clientId = '' } = {}) {
  if (!['auto', 'google', 'pilot'].includes(mode)) throw new Error('Invalid receiving auth build mode');
  const configured = !!clientId.trim();
  if (mode === 'google' && !configured) throw new Error('Google build requires VITE_GOOGLE_WEB_CLIENT_ID');
  return mode === 'auto' ? (configured ? 'google' : 'pilot') : mode;
}
