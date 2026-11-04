import { validateDate } from './domain/validation.js';

const bad = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const integer = (value, fallback, max, name) => {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > max) bad(`${name} is outside the supported range.`);
  return Number(value);
};
const columns = `id, provider, source_date, sender_email, subject, original_name, status,
  file_count, transaction_count, total_amount, error_message, created_at,
  CASE WHEN file_data IS NOT NULL OR stored_path IS NOT NULL THEN TRUE ELSE FALSE END AS file_available`;

export const listInboxImports = async (connection, params = {}) => {
  // Keep the existing array contract for unattended/older clients.
  if (params.paginated !== '1') {
    const [rows] = await connection.query(`SELECT ${columns} FROM bank_inbox_imports ORDER BY created_at DESC, id DESC LIMIT 100`);
    return rows;
  }
  const page = integer(params.page, 1, 100_000, 'page');
  const pageSize = integer(params.page_size, 50, 100, 'page_size');
  const provider = String(params.provider || '').trim();
  if (provider && !/^[A-Z][A-Z0-9_]{0,49}$/.test(provider)) bad('Invalid provider.');
  const dates = [], dateParams = [];
  const from = params.from ? validateDate(params.from, 'from') : '';
  const to = params.to ? validateDate(params.to, 'to') : '';
  if (from && to && from > to) bad('from must not be after to.');
  if (from) { dates.push('source_date >= ?'); dateParams.push(from); }
  if (to) { dates.push('source_date <= ?'); dateParams.push(to); }
  const filters = [...dates], values = [...dateParams];
  if (provider) { filters.push('provider = ?'); values.push(provider); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const [[count]] = await connection.query(`SELECT COUNT(*) AS total FROM bank_inbox_imports ${where}`, values);
  const [providers] = await connection.query(`SELECT provider, COUNT(*) AS total FROM bank_inbox_imports ${dates.length ? `WHERE ${dates.join(' AND ')}` : ''} GROUP BY provider ORDER BY provider LIMIT 100`, dateParams);
  const [rows] = await connection.query(`SELECT ${columns} FROM bank_inbox_imports ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
  return { rows, total: Number(count.total), page, page_size: pageSize, providers: providers.map(row => ({ provider: row.provider, total: Number(row.total) })) };
};
