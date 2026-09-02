import { isNonZeroMoney, roundMoney, toNumber } from './money.js';

export const CHANNEL_CODES = {
  CASH: 'CASH',
  QR_KPLUS: 'QR_KPLUS',
  GRAB: 'GRAB',
  CREDIT_CARD_SCB: 'CREDIT_CARD_SCB',
  CREDIT_CARD_KTC: 'CREDIT_CARD_KTC',
  PROMPTPAY: 'PROMPTPAY',
  OTHER_UNKNOWN: 'OTHER_UNKNOWN'
};

export const CASHIER_VARIANCE_CONFIRM_THRESHOLD = 100;

export const RECEIPT_STATUS_LABELS = {
  DRAFT: 'ยังไม่ส่ง',
  SUBMITTED: 'รอตรวจ',
  CHECKED_OK: 'ตรวจแล้วครบ',
  CHECKED_VARIANCE: 'ตรวจแล้วมีส่วนต่าง',
  NEEDS_CORRECTION: 'ส่งกลับแก้ไข',
  CLOSED: 'ปิดเอกสารแล้ว'
};

export const receiptStatusLabel = (status) => RECEIPT_STATUS_LABELS[status] || status;

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

const EVIDENCE_GROSS_SOURCES = new Set(['BANK_SETTLEMENT', 'GRAB_REPORT', 'LEGACY_EVIDENCE', 'MANUAL']);
const EVIDENCE_NET_SOURCES = new Set(['BANK_SETTLEMENT', 'BANK_STATEMENT', 'GRAB_REPORT', 'LEGACY_EVIDENCE', 'MANUAL']);

export const calculateEvidenceVariances = ({
  channelCode,
  cashierAmount,
  statementAmount,
  expectedGrossAmount,
  feeAmount,
  expectedNetAmount,
  settlementSource
}) => {
  const cashier = roundMoney(cashierAmount);
  const actual = statementAmount === undefined || statementAmount === null || statementAmount === ''
    ? channelCode === CHANNEL_CODES.CASH ? cashier : 0
    : roundMoney(statementAmount);
  const source = String(settlementSource || 'NONE').toUpperCase();
  const storedGross = roundMoney(expectedGrossAmount);
  const fee = roundMoney(feeAmount);
  const storedNet = roundMoney(expectedNetAmount);
  const hasGrossReference = EVIDENCE_GROSS_SOURCES.has(source) && storedGross > 0;
  const hasNetReference = EVIDENCE_NET_SOURCES.has(source) && (storedNet > 0 || hasGrossReference);
  const referenceGross = hasGrossReference ? storedGross : cashier;
  const referenceNet = hasNetReference ? storedNet : roundMoney(Math.max(referenceGross - fee, 0));
  const cashierReferenceVariance = hasGrossReference ? roundMoney(cashier - referenceGross) : 0;
  const settlementVariance = roundMoney(actual - referenceNet);

  return {
    settlementSource: source,
    hasGrossReference,
    hasNetReference,
    referenceGross,
    referenceNet,
    feeAmount: fee,
    actualAmount: actual,
    cashierReferenceVariance,
    settlementVariance,
    hasEvidenceVariance: isNonZeroMoney(cashierReferenceVariance) || isNonZeroMoney(settlementVariance)
  };
};

export const calculateStoredLineEvidence = (line) => {
  const evidence = calculateEvidenceVariances({
    channelCode: line.channel_code, cashierAmount: line.cashier_amount,
    statementAmount: line.statement_amount, expectedGrossAmount: line.expected_gross_amount,
    feeAmount: line.fee_amount, expectedNetAmount: line.expected_net_amount,
    settlementSource: line.settlement_source
  });
  if (!line.settlement_batch_key) return evidence;
  return {
    ...evidence,
    referenceGross: roundMoney(line.cashier_amount),
    referenceNet: roundMoney(line.settlement_batch_allocated_net_amount),
    feeAmount: roundMoney(line.settlement_batch_allocated_fee_amount),
    actualAmount: roundMoney(line.settlement_batch_allocated_net_amount),
    cashierReferenceVariance: 0,
    settlementVariance: roundMoney(line.settlement_batch_variance_amount),
    hasEvidenceVariance: isNonZeroMoney(line.settlement_batch_variance_amount)
  };
};

export const lineHasVariance = (line) => [
  line.variance_amount ?? line.varianceAmount,
  line.cashier_reference_variance_amount ?? line.cashierReferenceVarianceAmount,
  line.settlement_variance_amount ?? line.settlementVarianceAmount,
  line.reconciliation_adjustment_amount ?? line.reconciliationAdjustmentAmount
].some(isNonZeroMoney);

export const statementAmountForManualCheck = ({ channelCode, cashierAmount, verificationAmount }) =>
  channelCode === CHANNEL_CODES.CASH
    ? roundMoney(cashierAmount)
    : roundMoney(verificationAmount);

export const resolveManualCheckAmounts = ({
  channelCode,
  currentCashierAmount,
  requestedCashierAmount,
  requestedStatementAmount,
  verificationAmount
}) => {
  const hasRequestedCashier = requestedCashierAmount !== undefined && requestedCashierAmount !== null && requestedCashierAmount !== '';
  const hasRequestedStatement = requestedStatementAmount !== undefined && requestedStatementAmount !== null && requestedStatementAmount !== '';
  const cashierAmount = roundMoney(hasRequestedCashier ? requestedCashierAmount : currentCashierAmount);
  const statementAmount = hasRequestedStatement
    ? roundMoney(requestedStatementAmount)
    : statementAmountForManualCheck({ channelCode, cashierAmount, verificationAmount });
  const comparisonAmount = channelCode === CHANNEL_CODES.CASH ? cashierAmount : roundMoney(verificationAmount);

  return {
    cashierAmount,
    statementAmount,
    varianceAmount: roundMoney(statementAmount - comparisonAmount)
  };
};

export const calculateCreditCardGroupVarianceByLine = (lines) => {
  const creditLines = lines.filter((line) => (line.channel_kind ?? line.channelKind) === 'credit_card');
  const expectedTotal = roundMoney(
    creditLines.reduce((sum, line) => sum + toNumber(line.expectedAmount ?? line.expected_amount), 0)
  );
  const verifiedTotal = roundMoney(
    creditLines.reduce((sum, line) => sum + toNumber(line.statementAmount ?? line.statement_amount), 0)
  );
  const targetLine = creditLines.find((line) => toNumber(line.expectedAmount ?? line.expected_amount) !== 0) || creditLines[0];
  const targetId = targetLine?.id;
  const groupVariance = roundMoney(verifiedTotal - expectedTotal);
  const varianceByLineId = new Map();

  for (const line of creditLines) {
    varianceByLineId.set(line.id, line.id === targetId ? groupVariance : 0);
  }

  return varianceByLineId;
};

export const resolveCheckedStatus = (lines) => {
  const hasVariance = lines.some(lineHasVariance);
  return hasVariance ? 'CHECKED_VARIANCE' : 'CHECKED_OK';
};

export const validateVarianceReasons = (lines) => {
  const missing = lines.filter((line) => {
    return lineHasVariance(line) && !String(line.variance_reason ?? line.varianceReason ?? '').trim();
  });

  if (missing.length > 0) {
    const error = new Error('กรุณาระบุเหตุผลส่วนต่างให้ครบทุกช่องทางที่มียอดต่างจากที่คาดไว้');
    error.statusCode = 400;
    error.details = missing.map((line) => ({
      line_id: line.id,
      payment_channel_id: line.payment_channel_id,
      channel_code: line.channel_code ?? line.channelCode,
      channel_label: line.channel_label ?? line.channelLabel,
      variance_amount: toNumber(line.variance_amount ?? line.varianceAmount),
      cashier_reference_variance_amount: toNumber(line.cashier_reference_variance_amount ?? line.cashierReferenceVarianceAmount),
      settlement_variance_amount: toNumber(line.settlement_variance_amount ?? line.settlementVarianceAmount),
      reconciliation_adjustment_amount: toNumber(line.reconciliation_adjustment_amount ?? line.reconciliationAdjustmentAmount)
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

export const buildCashierVarianceCheck = ({
  lines = [],
  inputLines = [],
  miscItems = [],
  morningChangeAmount = 0,
  grossSalesExpected,
  thresholdAmount = CASHIER_VARIANCE_CONFIRM_THRESHOLD
}) => {
  const inputByLineId = new Map();
  const inputByChannelId = new Map();
  for (const input of inputLines) {
    if (input.id) inputByLineId.set(Number(input.id), input);
    if (input.payment_channel_id) inputByChannelId.set(Number(input.payment_channel_id), input);
  }

  const cashierLineTotal = roundMoney(lines.reduce((sum, line) => {
    const input = inputByLineId.get(Number(line.id)) || inputByChannelId.get(Number(line.payment_channel_id));
    const amount = input && Object.prototype.hasOwnProperty.call(input, 'cashier_amount')
      ? input.cashier_amount
      : line.cashier_amount;
    return sum + toNumber(amount);
  }, 0));
  const expectedLineTotal = grossSalesExpected === undefined || grossSalesExpected === null
    ? roundMoney(lines.reduce((sum, line) => sum + toNumber(line.expected_amount ?? line.expectedAmount), 0))
    : roundMoney(grossSalesExpected);
  const miscTotal = roundMoney(miscItems.reduce((sum, item) => sum + toNumber(item.amount), 0));
  const expectedTotal = roundMoney(expectedLineTotal + toNumber(morningChangeAmount));
  const enteredTotal = roundMoney(cashierLineTotal + miscTotal);
  const varianceAmount = roundMoney(enteredTotal - expectedTotal);
  const absoluteVarianceAmount = roundMoney(Math.abs(varianceAmount));

  return {
    cashier_line_total: cashierLineTotal,
    misc_total: miscTotal,
    entered_total: enteredTotal,
    expected_total: expectedTotal,
    variance_amount: varianceAmount,
    absolute_variance_amount: absoluteVarianceAmount,
    threshold_amount: roundMoney(thresholdAmount),
    direction: varianceAmount < 0 ? 'short' : varianceAmount > 0 ? 'over' : 'balanced',
    requires_confirmation: absoluteVarianceAmount > roundMoney(thresholdAmount)
  };
};

export const thailandBusinessDate = (now = new Date()) => (
  new Date(now.getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10)
);

export const hasDeclaredMoneyWithoutPos = ({
  billCount = 0,
  grossSalesExpected = 0,
  declaredAmounts = []
}) => (
  Number(billCount || 0) <= 0
  && Math.abs(roundMoney(grossSalesExpected)) < 0.01
  && declaredAmounts.some((amount) => Math.abs(roundMoney(amount)) >= 0.01)
);
