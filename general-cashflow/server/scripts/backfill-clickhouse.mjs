const readArg = (name, fallback = '') => {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
};

const from = readArg('--from');
const to = readArg('--to');
const branchCodes = readArg('--branches', 'KK,SK')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const dryRun = process.argv.includes('--dry-run');
const publicDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').replace(/^https?:\/\//, '');
const baseUrl = String(
  process.env.CASHFLOW_BASE_URL || (publicDomain ? `https://${publicDomain}` : 'http://127.0.0.1:8100')
).replace(/\/$/, '');

if (!from || !to) {
  throw new Error('Usage: npm run backfill:clickhouse -- --from YYYY-MM-DD --to YYYY-MM-DD [--branches KK,SK] [--dry-run]');
}
if (!process.env.CASHFLOW_ADMIN_USERNAME || !process.env.CASHFLOW_ADMIN_PASSWORD) {
  throw new Error('CASHFLOW_ADMIN_USERNAME and CASHFLOW_ADMIN_PASSWORD are required.');
}

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.CASHFLOW_ADMIN_USERNAME,
    password: process.env.CASHFLOW_ADMIN_PASSWORD
  })
});
const loginPayload = await loginResponse.json();
if (!loginResponse.ok || !loginPayload?.data?.token) {
  throw new Error(loginPayload?.message || `Login failed (${loginResponse.status})`);
}

const response = await fetch(`${baseUrl}/api/daily-receipts/backfill-clickhouse`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${loginPayload.data.token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    from,
    to,
    branch_codes: branchCodes,
    dry_run: dryRun
  })
});
const payload = await response.json();
if (!response.ok) {
  throw new Error(payload?.message || `Backfill failed (${response.status})`);
}

console.log(JSON.stringify(payload.data.summary, null, 2));
