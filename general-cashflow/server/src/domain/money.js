export const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundMoney = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;

export const sumMoney = (values) => roundMoney(values.reduce((sum, value) => sum + toNumber(value), 0));

export const isNonZeroMoney = (value) => Math.abs(roundMoney(value)) >= 0.01;
