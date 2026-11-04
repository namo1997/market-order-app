import { roundMoney } from './money.js';

export const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

const invalid = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
};

export const validateDate = (value, field = 'date') => {
  const normalized = String(value || '').trim();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== normalized) {
    invalid(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return normalized;
};

// Validate explicit human-entered amounts; optional fields retain their route defaults.
export const validateMoneyInput = (value, field = 'amount') => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' ||
      !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim()) || !Number.isFinite(Number(value)) ||
      Math.abs(Number(value)) >= 1e12) {
    invalid(`${field} must be a finite amount below 1,000,000,000,000.`);
  }
  const amount = roundMoney(value);
  if (Math.abs(amount) >= 1e12) invalid(`${field} is outside the supported range.`);
  return amount;
};

export const bangkokReportRange = (date = new Date()) => {
  const [year, month] = bangkokDate(date).split('-');
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${lastDay}` };
};
