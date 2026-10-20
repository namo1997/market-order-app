// OCR text is untrusted data. Keep the allowlisted receipt facts only; never
// retain contact, tax or banking numbers even if a provider ignores the prompt.
export function receiptText(value, limit = 255, { reference = false } = {}) {
  if (reference && typeof value === 'number' && Number.isFinite(value) && value >= 0) value = String(value);
  if (typeof value !== 'string') return null;
  // An alphanumeric invoice reference is not a contact/account number.
  if (reference && /^[a-z][a-z0-9_/-]*$/i.test(value.trim())) return value.trim().slice(0, limit);
  const text = value.split(/\r?\n/).map(line => line
    .replace(/(?:เลข(?:ที่)?บัญชี|บัญชีธนาคาร|bank\s*account|account\s*(?:no\.?|number)|เลข(?:ประจำตัว)?ผู้เสียภาษี|เลขภาษี|tax\s*(?:id|no\.?)|โทร(?:ศัพท์)?|มือถือ|tel\.?|phone)\s*[:：]?[^\n]*/giu, '')
    .replace(/(?<![\p{L}\d])\+?\d(?:[\d\s().-]*\d)?(?![\p{L}\d])/gu, digits =>
      digits.replace(/\D/g, '').length >= 7 ? '' : digits))
    .join(' ').trim().slice(0, limit);
  return text || null;
}

// Integer hundredths of quantity times millionths of price -> rounded satang.
export function ocrLineAmountSatang(quantity, price) {
  const q = BigInt(Math.round(quantity * 100));
  const p = BigInt(price.toFixed(6).replace('.', ''));
  return (q * p + 500000n) / 1000000n;
}

const branchKey = value => String(value || '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
  .replace(/บ้านแจ้|สันกำแพง|ต้นเปา|สาขาที่0*2(?!\d)/gu, 'สันกำแพง');

// Compare the bill's recipient with the document's server-owned branch. IDs
// are never inferred from the supplier's printed branch number.
export function billBranchMismatch(shipTo, addressee, branchId, branches) {
  const target = branches.find(branch => Number(branch.id) === Number(branchId));
  if (!target) return null;
  const text = branchKey([shipTo, addressee].filter(Boolean).join(' '));
  if (!text) return false;
  const name = branchKey(target.name).replace(/^สาขา/u, '');
  const mentioned = branches.filter(branch => {
    const key = branchKey(branch.name).replace(/^สาขา/u, '');
    return key && text.includes(key);
  });
  if (mentioned.some(branch => branchKey(branch.name) !== branchKey(target.name))) return true;
  if (name && text.includes(name)) return false;
  if (text.includes('สันกำแพง')) return true;
  // A generic company addressee is insufficient evidence of another branch.
  return /สาขา|บ้านแจ้|ต้นเปา/u.test(text);
}
