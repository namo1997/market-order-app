import { roundMoney, sumMoney } from './money.js';

const reportedMoney = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const amount = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
};

// Mung-Mee's Transaction amount is gross. The operator accepts its reported
// Net Transaction amount as actual receipts; never substitute gross for net.
export const krungsriSettlementAmounts = (payload) => {
  let raw = payload;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const grossAmount = reportedMoney(raw['Transaction amount']);
  const feeAmount = reportedMoney(raw['Service Fee']);
  const netAmount = reportedMoney(raw['Net Transaction amount']);
  if ([grossAmount, feeAmount, netAmount].includes(null)
    || roundMoney(grossAmount - feeAmount) !== netAmount) return null;
  return { grossAmount, feeAmount, netAmount };
};

export const summarizeKrungsriSettlements = (rows) => {
  const amounts = rows.map((row) => krungsriSettlementAmounts(row.raw_payload ?? row.rawPayload));
  if (!amounts.length || amounts.some((amount) => amount === null)) return null;
  return {
    grossAmount: sumMoney(amounts.map((amount) => amount.grossAmount)),
    feeAmount: sumMoney(amounts.map((amount) => amount.feeAmount)),
    netAmount: sumMoney(amounts.map((amount) => amount.netAmount))
  };
};
