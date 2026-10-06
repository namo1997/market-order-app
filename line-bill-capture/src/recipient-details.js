import crypto from 'node:crypto';
import { maskAccountNumber, normalizeBankName } from './payer-details.js';

const cleanText = (value, maxLength = 300) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
};

const keyText = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s-]+/g, '');

const normalizeConfidence = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
};

// This is deliberately separate from maskAccountNumber. The masked value is
// for display; this proof is used only to derive a stable opaque identity.
// Never return it from this module or put it in an export.
export const accountProof = (value) => {
  const raw = cleanText(value, 120);
  if (!raw || /[xX*•＊]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 4 ? digits : null;
};

const identityToken = ({ bank, identifierType, proof }) => {
  if (!proof) return null;
  const identity = [keyText(identifierType || 'bank_account'), keyText(bank), proof].join('|');
  return `recipient-proof:${crypto.createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32)}`;
};

const KNOWN_BANKS = [
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

const destinationSegment = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/(?:ไปยัง|ถึง|to)\s+(.+?)(?=\s+(?:จำนวน(?:เงิน)?|ยอด|ค่าธรรมเนียม|fee|วันที่เงินเข้า|วันที่|เลขที่รายการ|รหัสอ้างอิง|transaction|reference)\s*:?|$)/iu);
  return cleanText(match?.[1], 1200);
};

const accountFromSegment = (segment) => {
  const text = String(segment || '');
  // A biller/customer/reference number is not a destination bank account.
  // It is common in a "จ่ายบิล" slip's TO block, so reject that block before
  // considering any plain digit sequence as an account proof.
  if (/(?:biller\s*id|customer\s*id|รหัส(?:ผู้รับ|ลูกค้า)|เลขที่อ้างอิง|เลขที่รายการ|reference|transaction)/iu.test(text)) {
    const masked = text.match(/(?:[xX*•＊](?:[-\s]?[xX*•＊\d]){3,})/u);
    return masked?.[0] || null;
  }
  const masked = text.match(/(?:[xX*•＊](?:[-\s]?[xX*•＊\d]){3,})/u);
  if (masked?.[0]) return masked[0];
  const labelled = text.match(/(?:เลขที่บัญชี|account|acct|พร้อมเพย์|prompt\s*pay)\s*[:#-]?\s*([0-9][0-9\s-]{3,})/iu);
  if (labelled?.[1]) return labelled[1].trim();
  const plain = text.match(/(?:^|\s)(\d[\d\s-]{7,}\d)(?:$|\s)/u);
  return plain?.[1]?.trim() || null;
};

const removeAccount = (value) => String(value || '')
  .replace(/(?:[xX*•＊](?:[-\s]?[xX*•＊\d]){3,}|\d{2,})[-\s]?(?:[xX*•＊\d]+[-\s]?){1,6}[xX*•＊\d]+/gu, ' ')
  .replace(/(?:เลขที่บัญชี|account)\s*[:#-]?/giu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const bankFromSegment = (segment) => {
  return KNOWN_BANKS.find(([pattern]) => pattern.test(String(segment || '')))?.[1] || null;
};

const nameFromSegment = (segment, bank) => {
  let value = removeAccount(segment);
  value = value.replace(/(?:biller\s*id|comp\s*code|customer\s*id|รหัส(?:ผู้รับ|ลูกค้า)|เลขที่อ้างอิง|เลขที่รายการ|reference|transaction)\s*[:#-]?\s*[\wก-๙_-]*/giu, ' ');
  value = value.replace(/prompt\s*pay/giu, ' ');
  if (bank) value = value.replace(new RegExp(bank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
  value = value.replace(/(?:ธนาคาร|bank)\s*[ก-๙A-Za-z .-]*/giu, ' ')
    .replace(/[|,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanText(value, 300);
};

const maskEvidence = (value) => {
  const text = cleanText(value, 500);
  if (!text) return null;
  return text.replace(/\b\d[\d\s-]{7,}\d\b/gu, (match) => maskAccountNumber(match) || '••••');
};

const explicit = (analysis, key) => cleanText(analysis?.[key], key.endsWith('bank') ? 120 : 300);

/**
 * Extract only the TO/payee side of a transfer. Generic bill fields such as
 * vendor_name, bank_name, and account_no are intentionally not accepted here.
 * Existing stored OCR is the fallback so a backfill does not need to reread an
 * image or make a network call.
 */
export const extractRecipientDetails = (analysis = {}, fallbackText = '') => {
  const rawText = cleanText(analysis?.raw_text || fallbackText, 20000) || '';
  const segment = destinationSegment(rawText);
  const rawAccount = analysis?.recipient_account || analysis?.recipient_account_masked || accountFromSegment(segment);
  const bank = normalizeBankName(explicit(analysis, 'recipient_bank') || bankFromSegment(segment));
  const proof = accountProof(rawAccount);
  const accountMasked = maskAccountNumber(rawAccount);
  const name = explicit(analysis, 'recipient_name') || nameFromSegment(segment, bank);
  const identifierType = explicit(analysis, 'recipient_identifier_type')
    || (/พร้อมเพย์|prompt\s*pay/iu.test(segment) ? 'promptpay' : bank || accountMasked ? 'bank_account' : null);
  const suppliedConfidence = normalizeConfidence(analysis?.recipient_confidence);
  const fields = [name, bank, accountMasked].filter(Boolean);
  if (!fields.length) {
    return {
      recipient_name: null,
      recipient_bank: null,
      recipient_account_masked: null,
      recipient_identifier_type: null,
      recipient_identity_token: null,
      recipient_confidence: 0,
      recipient_review_status: 'UNRESOLVED',
      recipient_evidence: [],
      recipient_provenance: []
    };
  }

  const evidence = [];
  if (segment) evidence.push(`ไปยัง ${maskEvidence(segment)}`);
  if (Array.isArray(analysis?.recipient_evidence)) {
    for (const entry of analysis.recipient_evidence) {
      const safe = maskEvidence(entry);
      if (safe && !evidence.includes(safe)) evidence.push(safe);
    }
  }
  const confidence = suppliedConfidence ?? (proof && bank ? 0.9 : fields.length >= 2 ? 0.7 : 0.4);
  const reviewStatus = proof && bank ? 'EXTRACTED' : 'REVIEW_REQUIRED';
  const provenance = [
    ...(name && explicit(analysis, 'recipient_name') ? [{ source: 'ai_structured', field: 'recipient_name', role: 'TO' }] : []),
    ...(bank && explicit(analysis, 'recipient_bank') ? [{ source: 'ai_structured', field: 'recipient_bank', role: 'TO' }] : []),
    ...(accountMasked && (analysis?.recipient_account || analysis?.recipient_account_masked)
      ? [{ source: 'ai_structured', field: 'recipient_account_masked', role: 'TO' }]
      : []),
    ...(segment ? [{ source: 'stored_ocr', field: 'to_segment', role: 'TO' }] : [])
  ];
  return {
    recipient_name: name,
    recipient_bank: bank,
    recipient_account_masked: accountMasked,
    recipient_identifier_type: identifierType,
    recipient_identity_token: identityToken({ bank, identifierType, proof }),
    recipient_confidence: confidence,
    recipient_review_status: reviewStatus,
    recipient_evidence: evidence.slice(0, 10),
    recipient_provenance: provenance
  };
};
