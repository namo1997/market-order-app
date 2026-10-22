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

// A taught bill-number shape: '#' is one digit, every other character is literal (letters any case).
// At least one '#' and two literal characters, so a shape can never mean "any long number".
export function validBillRefPattern(value) {
  const pattern = typeof value === 'string' ? value.trim() : '';
  if (pattern.length < 4 || pattern.length > 40 || !/^[A-Za-z0-9#/-]+$/.test(pattern)) return null;
  if (!pattern.includes('#') || pattern.replace(/#/g, '').length < 2) return null;
  return pattern;
}
export function billRefMatchingPattern(value, pattern) {
  const shape = validBillRefPattern(pattern);
  if (!shape || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const ref = String(value).replace(/\s+/g, '').trim();
  const regex = new RegExp(`^${shape.replace(/[/-]/g, m => `\\${m}`).replace(/#/g, '\\d')}$`, 'i');
  if (regex.test(ref)) return ref;
  // One stray letter read in front of a numeric shape (แพปลาภูเก็ต "C06050605" for 06050605).
  if (/^[A-Z]/i.test(ref) && /^[0-9#]/.test(shape) && regex.test(ref.slice(1))) return ref.slice(1);
  // Same length, every # position a digit, and at most one taught literal character misread -> taught literal.
  if (ref.length !== shape.length) return null;
  let misread = 0;
  for (let i = 0; i < shape.length; i++) {
    if (shape[i] === '#') { if (!/\d/.test(ref[i])) return null; }
    else if (shape[i].toUpperCase() !== ref[i].toUpperCase()) misread++;
  }
  return misread === 1 ? [...shape].map((c, i) => c === '#' ? ref[i] : c).join('') : null;
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
  // Owner 2026-10-22: staff choose the receiving branch; warn only when the bill clearly names ANOTHER
  // branch. A bare company name, "สาขาสำนักงานใหญ่ (00000)" or an address is no evidence either way.
  // The most specific name wins ("สาขาผลิตคันคลอง" mentions ผลิตคันคลอง, not คันคลอง).
  const keyOf = branch => branchKey(branch.name).replace(/^สาขา/u, '');
  const mentioned = branches.filter(branch => keyOf(branch) && text.includes(keyOf(branch)));
  const named = mentioned.filter(branch => !mentioned.some(other => other !== branch &&
    keyOf(other).length > keyOf(branch).length && keyOf(other).includes(keyOf(branch))));
  if (!named.length) return false;
  return !named.some(branch => Number(branch.id) === Number(target.id));
}

// A fast read worth a second look by the larger model: unsure, totals that do not add up, or rows without a name.
export const weakBillRead = result => {
  if (!result) return false;
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH', 'TOTAL_MISSING_LINE_SUM', 'SUM_MISMATCH', 'NOT_A_BILL', 'DOC_KIND_UNCERTAIN'].some(code => warnings.includes(code))) return true;
  if (Number(result.unreadable_line_count) > 0) return true;
  if (lines.some(line => !String(line.bill_text || '').replace(/[.…?\s〃"'-]/g, ''))) return true;
  const confidence = Number(result.confidence);
  return Number.isFinite(confidence) && confidence < 0.6;
};
