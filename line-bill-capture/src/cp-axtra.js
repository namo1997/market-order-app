const normalizedDigits = (value) => String(value || '').replace(/\D/g, '');

const evidenceText = (item) => [
  item?.vendor_name,
  item?.supplier_name,
  item?.ai_raw_text,
  item?.ai_summary
].filter(Boolean).join(' ');

export const isCpAxtraSlip = (item) => /CP\s*AXTRA|SMARTONE|0107567000414(?:04|06)?/i
  .test(evidenceText(item));

export const isCpAxtraBill = (item) => /makro|แม็คโคร|ซีพี\s*แอ็กซ์ตร้า|CP\s*AXTRA/i
  .test(evidenceText(item)) && ['bill', 'bill_page'].includes(String(item?.category || ''));

export const extractCpAxtraSlipReference = (item) => {
  const text = String(item?.ai_raw_text || item?.ai_summary || '');
  const explicit = text.match(/(?:เลขที่อ้างอิง|reference|ref\s*2)\s*[:：]?\s*(\d{10,15})/i);
  return normalizedDigits(explicit?.[1]) || normalizedDigits(item?.doc_ref);
};

export const extractCpAxtraBillReference = (item) => {
  const stored = normalizedDigits(item?.doc_ref);
  if (stored) return stored;
  const text = String(item?.ai_raw_text || item?.ai_summary || '');
  const explicit = text.match(
    /(?:เลขที่ใบกำกับภาษี|tax invoice no\.?|เลขที่ใบแจ้งหนี้|ref\s*2)\s*[:：]?\s*(\d{10,15})/i
  );
  return normalizedDigits(explicit?.[1]);
};

export const cpAxtraReferenceForItem = (item) => {
  if (isCpAxtraSlip(item) && ['transfer', 'transfer_notice'].includes(String(item?.category || ''))) {
    return extractCpAxtraSlipReference(item);
  }
  if (isCpAxtraBill(item)) return extractCpAxtraBillReference(item);
  return '';
};
