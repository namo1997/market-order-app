import { roundMoney } from './money.js';

export const SETTLEMENT_KINDS = new Set(['grab', 'credit_card']);

export const isSettlementChannel = (channel) => SETTLEMENT_KINDS.has(channel?.channel_kind || channel?.kind);

export const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const isWithinSettlementWindow = (transactionDate, receiptDate, days = 3) =>
  Boolean(transactionDate && receiptDate && transactionDate >= receiptDate && transactionDate <= addDays(receiptDate, days));

export const classifyRowsForChannel = ({ rows, channel, receiptDate, expectedNetAmount, classifyScbOtherIncoming = false }) => {
  const keywords = (channel.mappings || []).map((value) => String(value).toLowerCase());
  const directChannel = !isSettlementChannel(channel);
  const channelKind = channel.channel_kind || channel.kind;
  const isScbCreditCard = channel.code === 'CREDIT_CARD_SCB';
  const classified = rows.filter((row) => {
    const description = String(row.description || '').toLowerCase();
    if (classifyScbOtherIncoming) return !description.includes('credit card division(edc)');
    return keywords.some((keyword) => description.includes(keyword));
  });
  const datedClassified = classified.filter((row) => row.transactionDate === receiptDate);
  const candidatePool = ['grab', 'credit_card'].includes(channelKind) ? classified : rows;
  const candidates = candidatePool
    .filter((row) => isWithinSettlementWindow(row.transactionDate, receiptDate))
    .sort((left, right) => Math.abs(left.amount - expectedNetAmount) - Math.abs(right.amount - expectedNetAmount))
    .slice(0, 3);
  const exactRows = candidates.filter((row) => roundMoney(row.amount) === roundMoney(expectedNetAmount));
  const defaultRows = directChannel
    ? datedClassified
    : exactRows.length > 0
      ? exactRows
      : isScbCreditCard && candidates.length === 1
        ? candidates
        : [];
  const defaultTotal = roundMoney(defaultRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const autoMatched = directChannel
    ? defaultRows.length > 0 && defaultTotal === roundMoney(expectedNetAmount)
    : exactRows.length === 1 || (isScbCreditCard && candidates.length === 1);

  return {
    directChannel,
    classifiedHashes: new Set(classified.map((row) => row.uniqueHash)),
    candidateHashes: new Set(candidates.map((row) => row.uniqueHash)),
    defaultHashes: defaultRows.map((row) => row.uniqueHash),
    autoMatched,
    rows: rows.map((row) => ({
      ...row,
      classification: classified.some((item) => item.uniqueHash === row.uniqueHash) ? 'classified' : 'unrelated',
      candidate: candidates.some((item) => item.uniqueHash === row.uniqueHash),
      selected: defaultRows.some((item) => item.uniqueHash === row.uniqueHash)
    }))
  };
};
