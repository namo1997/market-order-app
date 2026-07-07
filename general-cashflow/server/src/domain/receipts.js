import { isNonZeroMoney, roundMoney, toNumber } from './money.js';

export const CHANNEL_CODES = {
  CASH: 'CASH',
  QR_KPLUS: 'QR_KPLUS',
  GRAB: 'GRAB',
  CREDIT_CARD: 'CREDIT_CARD',
  PROMPTPAY: 'PROMPTPAY',
  OTHER_UNKNOWN: 'OTHER_UNKNOWN'
};

export const canTransitionReceipt = (fromStatus, toStatus) => {
  const transitions = {
    DRAFT: new Set(['SUBMITTED']),
    SUBMITTED: new Set(['CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION']),
    NEEDS_CORRECTION: new Set(['SUBMITTED']),
    CHECKED_OK: new Set(['CLOSED', 'NEEDS_CORRECTION']),
    CHECKED_VARIANCE: new Set(['CLOSED', 'NEEDS_CORRECTION']),
    CLOSED: new Set()
  };
  return transitions[fromStatus]?.has(toStatus) || false;
};

export const calculateLineVariance = ({ channelCode, expectedAmount, cashierAmount, verifiedAmount }) => {
  const expected = roundMoney(expectedAmount);
  const cashier = roundMoney(cashierAmount);
  const verified = verifiedAmount === undefined || verifiedAmount === null || verifiedAmount === ''
    ? channelCode === CHANNEL_CODES.CASH
      ? cashier
      : 0
    : roundMoney(verifiedAmount);

  return {
    expectedAmount: expected,
    cashierAmount: cashier,
    verifiedAmount: verified,
    varianceAmount: roundMoney(verified - expected)
  };
};

export const resolveCheckedStatus = (lines) => {
  const hasVariance = lines.some((line) => isNonZeroMoney(line.variance_amount ?? line.varianceAmount));
  return hasVariance ? 'CHECKED_VARIANCE' : 'CHECKED_OK';
};

export const validateVarianceReasons = (lines) => {
  const missing = lines.filter((line) => {
    const variance = line.variance_amount ?? line.varianceAmount;
    return isNonZeroMoney(variance) && !String(line.variance_reason ?? line.varianceReason ?? '').trim();
  });

  if (missing.length > 0) {
    const error = new Error('Variance reason is required for every non-zero variance line.');
    error.statusCode = 400;
    error.details = missing.map((line) => ({
      line_id: line.id,
      payment_channel_id: line.payment_channel_id,
      variance_amount: toNumber(line.variance_amount ?? line.varianceAmount)
    }));
    throw error;
  }
};

export const computeExpectedTotals = ({ grossSales, cashSales, nonCashLines }) => {
  const nonCashExpected = roundMoney(
    nonCashLines.reduce((sum, line) => sum + toNumber(line.expected_amount ?? line.expectedAmount), 0)
  );
  return {
    grossSalesExpected: roundMoney(grossSales),
    cashExpected: roundMoney(cashSales),
    nonCashExpected
  };
};
