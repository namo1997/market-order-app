const cleanText = (value, maxLength = 300) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
};

const BANK_ALIASES = [
  [/กสิกร(?:ไทย)?|kasikorn|kbank|k biz/i, 'ธนาคารกสิกรไทย'],
  [/ไทยพาณิชย์|siam commercial|\bscb\b/i, 'ธนาคารไทยพาณิชย์'],
  [/กรุงไทย|krungthai|\bktb\b/i, 'ธนาคารกรุงไทย'],
  [/กรุงเทพ|bangkok bank|\bbbl\b/i, 'ธนาคารกรุงเทพ'],
  [/กรุงศรี|bank of ayudhya|\bbay\b/i, 'ธนาคารกรุงศรีอยุธยา'],
  [/ทหารไทยธนชาต|\bttb\b/i, 'ธนาคารทหารไทยธนชาต'],
  [/ออมสิน|government savings/i, 'ธนาคารออมสิน'],
  [/เกียรตินาคินภัทร|kiatnakin|\bkkp\b/i, 'ธนาคารเกียรตินาคินภัทร'],
  [/ซีไอเอ็มบี|cimb/i, 'ธนาคารซีไอเอ็มบี ไทย'],
  [/ยูโอบี|\buob\b/i, 'ธนาคารยูโอบี']
];

export const normalizeBankName = (value) => {
  const text = cleanText(value, 120);
  if (!text) return null;
  return BANK_ALIASES.find(([pattern]) => pattern.test(text))?.[1] || text;
};

// Never expose a full account number read from a slip through the accounting API.
export const maskAccountNumber = (value) => {
  const text = cleanText(value, 120);
  if (!text) return null;
  const compact = text.replace(/\s+/g, '');
  if (/[xX*•]/.test(compact)) {
    return compact.replace(/[xX*•]/g, 'X').replace(/[^X\d-]/g, '').slice(0, 40) || null;
  }
  const digits = compact.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `••••${digits.slice(-4)}`;
};

const sourceSegment = (text) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.match(/(?:จาก|from)\s+(.+?)(?=\s+(?:ไปยัง|ถึง|to)\s+)/i)?.[1]?.trim() || '';
};

const accountFromText = (text) => {
  const match = String(text || '').match(/(?:[xX*•]{2,}|\d{2,})[-\s]?(?:[xX*•\d]+[-\s]?){1,5}[xX*•\d]+/);
  return maskAccountNumber(match?.[0]);
};

export const extractPayerDetails = (analysis = {}, fallbackText = '') => {
  const rawText = cleanText(analysis?.raw_text || fallbackText, 20000) || '';
  const source = sourceSegment(rawText);
  const explicitName = cleanText(analysis?.payer_account_name);
  const explicitBank = normalizeBankName(analysis?.payer_bank);
  const explicitAccount = maskAccountNumber(analysis?.payer_account_masked || analysis?.payer_account);
  const inferredBank = normalizeBankName(BANK_ALIASES.find(([pattern]) => pattern.test(source))?.[1]);
  const inferredAccount = accountFromText(source);

  let inferredName = source;
  for (const [pattern] of BANK_ALIASES) inferredName = inferredName.replace(pattern, ' ');
  inferredName = inferredName
    .replace(/(?:ธนาคาร|บัญชี(?:เลขที่)?|เลขที่บัญชี)\s*/gi, ' ')
    .replace(/(?:[xX*•]{2,}|\d{2,})[-\s]?(?:[xX*•\d]+[-\s]?){1,5}[xX*•\d]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    payer_account_name: explicitName || cleanText(inferredName),
    payer_bank: explicitBank || inferredBank,
    payer_account_masked: explicitAccount || inferredAccount
  };
};
