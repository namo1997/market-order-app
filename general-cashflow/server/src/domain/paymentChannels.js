const UNSUPPORTED_CHANNELS_BY_BRANCH = {
  KK: new Set(['CREDIT_CARD_KBANK']),
  SK: new Set(['CREDIT_CARD_SCB', 'CREDIT_CARD_KTC', 'PROMPTPAY', 'QR_KRUNGSRI'])
};

export const branchSupportsPaymentChannel = (branchCode, channelCode) => {
  const unsupported = UNSUPPORTED_CHANNELS_BY_BRANCH[String(branchCode || '').toUpperCase()];
  return unsupported ? !unsupported.has(String(channelCode || '')) : true;
};

export const isCashPaymentDescription = (description) => {
  const normalized = String(description || '')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/\s+/g, '');
  return normalized === 'เงินสด' || normalized === 'cash';
};
