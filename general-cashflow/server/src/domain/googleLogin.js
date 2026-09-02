export const allowedGoogleEmail = (payload, allowedEmails = []) => {
  if (payload?.email_verified !== true) return '';
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return '';
  return allowedEmails.includes(email) ? email : '';
};
