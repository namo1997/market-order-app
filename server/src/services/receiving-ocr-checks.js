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

// Owner 2026-10-22: receipts started from an ordering group ("ซัพอื่นๆ (ครัวสันกำแพง)") still use the
// shortcuts of the shop printed on the bill header ("แพปลาภูเก็ต", "ร้านต้นพยอมพานิช"). Company words,
// brackets and spaces are ignored; a registered name may list alternatives with "|" or in brackets.
const COMPANY_WORDS = /บริษัท|บจก\.?|หจก\.?|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|จำกัด|มหาชน|มหาชัน|ร้าน|สำนักงานใหญ่|สาขา\S*|co\.?,?|ltd\.?|limited|company|corporation/giu;
const shopKey = text => String(text || '').normalize('NFC').toLowerCase().replace(COMPANY_WORDS, '')
  .replace(/[็-๎]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const shopNames = name => {
  const raw = String(name || '');
  const parts = [raw, ...raw.split('|'), ...[...raw.matchAll(/\(([^()]+)\)/g)].map(m => m[1]), raw.replace(/\([^()]*\)/g, '')];
  return [...new Set(parts.map(shopKey).filter(key => [...key].length >= 4))];
};
const near = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= 2;
};
// How strongly a shop name key matches the printed key: 3 same, 2 one–two letters off (or the start of a longer
// registered name), 1 one inside the other, 0 none.
const nameScore = (key, printed) => {
  const p = [...printed];
  return key === printed ? 3 : [...key].length >= 6 && (near([...key], p) || (p.length >= 8 && [...key].length > p.length && near([...key].slice(0, p.length), p))) ? 2
    : ([...key].length >= 5 && printed.includes(key)) || ([...printed].length >= 5 && key.includes(printed)) ? 1 : 0;
};
export function shopFromBillHeader(printedName, masters = []) {
  const printed = shopKey(printedName);
  if ([...printed].length < 4) return null;
  // Strongest evidence wins: the same name, then a name 1–2 letters off, then one name inside the other.
  // A registered name may carry a trailing description ("เอเซียเกษตรรุ่งวิไล ขายส่งสินค้า…"): its start counts too.
  const score = key => nameScore(key, printed);
  const scored = masters.map(master => ({ master, best: Math.max(0, ...shopNames(master.name).map(score)) })).filter(row => row.best > 0);
  const top = Math.max(0, ...scored.map(row => row.best));
  const hits = scored.filter(row => row.best === top);
  return hits.length === 1 ? hits[0].master : null;
}

// Owner 2026-10-24 "ทำเตือนบิลผิดร้าน": the shop printed on the bill header is not the receipt's shop.
// Only clear evidence warns (a wrong warning teaches staff to ignore it):
//  - a registered shop's receipt warns when the printed name matches none of its names and was never printed on
//    its earlier confirmed receipts (a shop that prints its legal name stops warning after one confirmed receipt);
//  - an ordering group or a new shop warns only when the printed name is another registered shop.
// Returns { bill_shop, registered } or null.
export function billShopMismatch({ printedName, receiptNames = [], receiptMasterId = null, receiptGroupId = null, groupIsShop = false, masters = [], knownBillNames = [] } = {}) {
  const printed = shopKey(printedName);
  if ([...printed].length < 4) return null;
  const names = receiptNames.flatMap(shopNames);
  if (!names.length || names.some(key => nameScore(key, printed) > 0)) return null;
  if (knownBillNames.some(name => shopKey(name) === printed)) return null;
  const header = shopFromBillHeader(printedName, masters);
  if (header && receiptMasterId && Number(header.id) === Number(receiptMasterId)) return null;
  // An ordering group that is not a shop ("ซัพอื่นๆ") receives bills from many shops: no evidence either way.
  if (!receiptMasterId && receiptGroupId && !groupIsShop) return null;
  // A new shop typed by staff may be a nickname: only another registered shop on the header is evidence.
  if (!receiptMasterId && !receiptGroupId && !header) return null;
  return { bill_shop: String(header?.name || printedName).trim().slice(0, 255), registered: Boolean(header) };
}

// Owner 2026-10-26 (พิสมัย #312): the model returned the one handwritten row twice while the bill total matched a single
// copy. Identical rows (text, quantity, price, amount) are collapsed only when the unique rows add up to the total and
// all rows do not; two genuinely equal rows on a bill whose total covers both stay.
export const dropDuplicateRows = (lines = [], total = null) => {
  if (!Array.isArray(lines) || lines.length < 2 || !(Number(total) > 0)) return lines;
  const key = line => JSON.stringify([String(line?.bill_text || '').trim(), line?.quantity_billed ?? null, line?.unit_price ?? null, line?.amount ?? null]);
  const seen = new Set(); const unique = [];
  for (const line of lines) { const k = key(line); if (seen.has(k) && line?.amount != null) continue; seen.add(k); unique.push(line); }
  if (unique.length === lines.length) return lines;
  const sum = rows => rows.reduce((acc, line) => acc + (Number(line?.amount) || 0), 0);
  if (Math.abs(sum(unique) - Number(total)) > 1 || Math.abs(sum(lines) - Number(total)) <= 1) return lines;
  return unique.map((line, index) => ({ ...line, line_no: index + 1 }));
};
