export const thailandBusinessDate = (now = new Date()) => (
  new Date(now.getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10)
);

export const shouldAutoSyncCashierReceipt = ({ date, receipt, currentDate = thailandBusinessDate() }) => (
  Boolean(date)
  && date <= currentDate
  && (!receipt || receipt.status === 'DRAFT')
);

export const cashierPosWarningRequired = ({
  billCount = 0,
  grossSalesExpected = 0,
  declaredAmounts = []
}) => (
  Number(billCount || 0) <= 0
  && Math.abs(Number(grossSalesExpected || 0)) < 0.01
  && declaredAmounts.some((amount) => Math.abs(Number(amount || 0)) >= 0.01)
);
