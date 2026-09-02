export const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const buildReconciliationSummary = ({
  grossSalesExpected,
  morningChange,
  cashierLineTotal,
  miscAdjustmentTotal,
  lineAdjustmentTotal = 0,
  actualMoneyTotal,
  deductionTotal
}) => {
  const cashierTotal = roundCurrency(cashierLineTotal + miscAdjustmentTotal);
  const posWithChangeTotal = roundCurrency(grossSalesExpected + morningChange);
  const recoveredTotal = roundCurrency(actualMoneyTotal + deductionTotal + miscAdjustmentTotal + lineAdjustmentTotal);

  return {
    cashierTotal,
    posWithChangeTotal,
    recoveredTotal,
    cashierVsPosVariance: roundCurrency(cashierTotal - posWithChangeTotal),
    settlementVsCashierVariance: roundCurrency(recoveredTotal - cashierTotal),
    endToEndVariance: roundCurrency(recoveredTotal - posWithChangeTotal)
  };
};

export const buildLineSettlementAmounts = ({
  channelCode,
  cashierAmount,
  expectedGrossAmount,
  feeAmount,
  expectedNetAmount,
  statementAmount,
  matchedAmount,
  evidenceAttachmentId,
  settlementSource = 'NONE',
  settlementBatchKey,
  settlementBatchAllocatedFeeAmount,
  settlementBatchAllocatedNetAmount
}) => {
  const cashier = Number(cashierAmount || 0);
  if (channelCode === 'CASH') {
    return { gross: cashier, fee: 0, net: cashier };
  }
  if (settlementBatchKey) {
    return {
      gross: roundCurrency(cashier),
      fee: roundCurrency(settlementBatchAllocatedFeeAmount),
      net: roundCurrency(settlementBatchAllocatedNetAmount)
    };
  }

  const storedGross = Number(expectedGrossAmount || 0);
  const fee = Number(feeAmount || 0);
  const source = String(settlementSource || 'NONE').toUpperCase();
  const hasGrossEvidence = ['BANK_SETTLEMENT', 'GRAB_REPORT', 'LEGACY_EVIDENCE', 'MANUAL'].includes(source) && storedGross > 0;
  const hasNetEvidence = ['BANK_SETTLEMENT', 'BANK_STATEMENT', 'GRAB_REPORT', 'LEGACY_EVIDENCE', 'MANUAL'].includes(source);
  const hasSettlementData =
    fee !== 0 ||
    Number(statementAmount || 0) !== 0 ||
    Number(matchedAmount || 0) !== 0 ||
    Boolean(evidenceAttachmentId);
  const useEvidenceAmount = hasGrossEvidence || (channelCode === 'GRAB' && hasSettlementData && storedGross > 0);
  const gross = useEvidenceAmount ? storedGross : cashier;
  const storedNet = Number(expectedNetAmount || 0);
  const net = (hasNetEvidence || useEvidenceAmount) && (storedNet > 0 || gross === 0)
    ? storedNet
    : Math.max(gross - (hasSettlementData ? fee : 0), 0);

  return {
    gross: roundCurrency(gross),
    fee: roundCurrency(hasSettlementData ? fee : 0),
    net: roundCurrency(net)
  };
};

export const buildLineEvidenceReconciliation = (line = {}) => {
  const settlement = buildLineSettlementAmounts({
    channelCode: line.channel_code,
    cashierAmount: line.cashier_amount,
    expectedGrossAmount: line.expected_gross_amount,
    feeAmount: line.fee_amount,
    expectedNetAmount: line.expected_net_amount,
    statementAmount: line.statement_amount,
    matchedAmount: line.matched_amount,
    evidenceAttachmentId: line.evidence_attachment_id,
    settlementSource: line.settlement_source,
    settlementBatchKey: line.settlement_batch_key,
    settlementBatchAllocatedFeeAmount: line.settlement_batch_allocated_fee_amount,
    settlementBatchAllocatedNetAmount: line.settlement_batch_allocated_net_amount
  });
  const cashier = roundCurrency(line.cashier_amount);
  const bankActual = roundCurrency(line.statement_amount);
  const actual = line.settlement_batch_key ? settlement.net : bankActual;
  const cashierVariance = roundCurrency(cashier - settlement.gross);
  const settlementVariance = roundCurrency(actual - settlement.net);

  return {
    ...settlement,
    actual,
    bankActual,
    cashierVariance,
    settlementVariance,
    hasVariance: Math.abs(cashierVariance) >= 0.01 || Math.abs(settlementVariance) >= 0.01
  };
};
