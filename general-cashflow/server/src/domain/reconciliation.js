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

// Card money is the sale less a bank fee. Only a shortfall within the normal fee
// range is a fee. A larger gap is money not (yet) received — a split transfer
// whose other part is still missing, or late settlement — so it must stay visible
// for review instead of being booked as a card fee and marked matched.
// Callers pass the sum of every deposit already linked to the line, so split
// transfers settle once all parts have arrived.
export const CARD_SETTLEMENT_MAX_FEE_RATE = 0.04;

export const evaluateCardSettlement = ({ cashierAmount, receivedAmount, maxFeeRate = CARD_SETTLEMENT_MAX_FEE_RATE }) => {
  const gross = roundMoney(cashierAmount || 0);
  const received = roundMoney(receivedAmount || 0);
  const shortfall = roundMoney(gross - received);
  const result = (status, feeAmount, expectedNetAmount, exceptionNote = null) => ({
    status,
    feeAmount,
    expectedNetAmount,
    exceptionCategory: exceptionNote ? 'OTHER' : null,
    exceptionNote,
    settled: status === 'MATCHED_AUTO'
  });
  if (received <= 0) {
    return gross > 0 ? result('READY_FOR_STATEMENT', 0, gross) : result('MATCHED_AUTO', 0, 0);
  }
  if (gross <= 0) return result('EXCEPTION', 0, 0, 'มียอดเงินจริงจาก statement แต่ยังไม่มียอดรูดที่แคชเชียร์ส่ง');
  if (shortfall < 0) return result('EXCEPTION', 0, gross, `เงินเข้ามากกว่ายอดรูดที่แคชเชียร์ส่ง ${Math.abs(shortfall).toFixed(2)} บาท`);
  if (shortfall / gross <= maxFeeRate) return result('MATCHED_AUTO', shortfall, received);
  return result('EXCEPTION', 0, gross,
    `ยอดเข้ายังไม่ครบ ขาด ${shortfall.toFixed(2)} บาท เกินค่าธรรมเนียมปกติ (อาจโอนแยกหรือเข้าช้า) จึงไม่นับเป็นค่าธรรมเนียม`);
};

// Direct channels (QR/PromptPay) settle on the sale day. Confirm the same rows
// the preview selected, never every classified row of a multi-day statement.
export const directChannelConfirmHashes = (rows = [], receiptDate) => {
  const saleDate = String(receiptDate || '').slice(0, 10);
  return new Set(rows
    .filter((row) => row.classification === 'classified' && row.transactionDate === saleDate)
    .map((row) => row.uniqueHash));
};

// statement_transactions.unique_hash is CHAR(64). The manual confirm route has
// always stored `${receiptId}-${sha256}`, which MySQL kept truncated to 64
// characters; use the same persisted key so repeat confirms find their rows.
export const statementTransactionHash = (receiptId, rowHash) => `${receiptId}-${rowHash}`.slice(0, 64);

// How a statement row already stored for this receipt may change on a repeat
// confirm: link/unlink only within this line, never move money from another line.
export const repeatStatementRowAction = ({ existingLineId, lineId, selected }) => {
  const existing = existingLineId === null || existingLineId === undefined ? null : Number(existingLineId);
  if (selected) return existing === null || existing === Number(lineId) ? 'link' : 'linked_elsewhere';
  return existing === Number(lineId) ? 'unlink' : 'keep';
};
