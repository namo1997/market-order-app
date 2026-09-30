export const effectiveLineAdjustment = (line) => Math.round((
  Number(line.reconciliation_adjustment_amount || 0) + Number(line.post_close_adjustment_amount || 0)
) * 100) / 100;

export const postCloseAdjustmentPreview = ({ receipt, line, amount, direction, adjustmentType = 'POST_CLOSE_CORRECTION' }) => {
  const raw = String(amount ?? '').replaceAll(',', '');
  const otherIncome = adjustmentType === 'OTHER_INCOME';
  const valid = /^\d{1,12}(\.\d{0,2})?$/.test(raw) && Number(raw) > 0 && [1, -1].includes(direction) && (!otherIncome || direction === 1);
  const delta = valid ? Math.round(Number(raw) * 100) / 100 * direction : 0;
  const currentAdjustment = otherIncome ? Number(line.post_close_other_income_amount || 0) : effectiveLineAdjustment(line);
  const currentVariance = Number(receipt.confirmed_variance_total || 0);
  return {
    valid: valid && delta !== 0,
    delta,
    currentAdjustment,
    nextAdjustment: Math.round((currentAdjustment + delta) * 100) / 100,
    currentVariance,
    nextVariance: Math.round((currentVariance + (otherIncome ? 0 : delta)) * 100) / 100
  };
};
