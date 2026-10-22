import {
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_PRICE_CHANGE_THRESHOLD,
  DEFAULT_SUM_MISMATCH_TOLERANCE,
  clampConfidence,
  computeBaseUnitPrice,
  formatMoney,
  formatQuantity,
  fromMilliQtyInt,
  fromSatangInt,
  normalizeItemCode,
  normalizeMatchText,
  toFiniteNumberOrNull,
  toMilliQtyInt,
  toSatangInt
} from './receiving-ocr.service.js';

export const computeTextSimilarity = (a, b) => {
  const normA = normalizeMatchText(a);
  const normB = normalizeMatchText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const compactA = normA.replace(/\s+/g, '');
  const compactB = normB.replace(/\s+/g, '');
  if (compactA === compactB) return 0.97;

  const minLen = Math.min(compactA.length, compactB.length);
  const maxLen = Math.max(compactA.length, compactB.length);
  const lengthRatio = maxLen > 0 ? minLen / maxLen : 0;

  if (minLen >= 5 && lengthRatio >= 0.65 && (compactA.includes(compactB) || compactB.includes(compactA))) {
    return Math.round(Math.min(0.94, 0.25 + lengthRatio * 0.72) * 10000) / 10000;
  }

  if (compactA.length >= 2 && compactB.length >= 2) {
    const bigramsA = new Map();
    for (let i = 0; i < compactA.length - 1; i += 1) {
      const bg = compactA.slice(i, i + 2);
      bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < compactB.length - 1; i += 1) {
      const bg = compactB.slice(i, i + 2);
      const count = bigramsA.get(bg) || 0;
      if (count > 0) {
        overlap += 1;
        bigramsA.set(bg, count - 1);
      }
    }
    const dice = (2 * overlap) / (compactA.length - 1 + (compactB.length - 1));
    const penalty = minLen < 5 ? lengthRatio : Math.max(0.85, lengthRatio);
    return Math.round(dice * penalty * 10000) / 10000;
  }

  return 0;
};

const resolveUnitByText = (unitText, units = []) => {
  const normUnit = normalizeMatchText(unitText);
  if (!normUnit) return null;
  for (const unit of units) {
    if (
      normalizeMatchText(unit.name) === normUnit ||
      normalizeMatchText(unit.abbreviation) === normUnit
    ) {
      return unit;
    }
  }
  return null;
};

// Owner 2026-10-22 evidence ladder (bill 132813: model copied the taught name "ซี่โครงคออ่อน" onto a
// "0023 สะโพกซอย 115฿" row printed with code 0022). 1) a taught code wins (above). 2) A NAME match whose
// printed code is a different code: if exactly one taught alias has a code one character away AND a
// reference price within 15% of the row, that alias wins. 3) Otherwise the name match stands only when its
// own reference price agrees. 4) Otherwise no match: the name's product is offered for a person to confirm.
const PRICE_TOLERANCE = 0.15;
// Printed numeric codes are often read with look-alike letters (bill 132756: "C070" for 0070).
// Compare numeric-looking codes with O/C/D/Q as 0 and I/L as 1; real letter codes are left as they are.
// Codes reaching the matcher were already filtered when the bill was read (a long digit code survives
// only when the shop taught it), and alias codes were entered by accounting, so long digits are allowed here.
const looseItemCode = value => {
  const code = normalizeItemCode(value);
  if (code) return code;
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).normalize('NFC').replace(/\s+/g, '').toUpperCase() : '';
  return /^(?:[A-Z]{1,4}[-.]?)?\d{9,20}$/.test(raw) ? raw : null;
};
export const codeKey = value => {
  const code = looseItemCode(value);
  if (!code || !/\d/.test(code) || !/^[0-9OCDQIL]+$/i.test(code)) return code;
  return code.toUpperCase().replace(/[OCDQ]/g, '0').replace(/[IL]/g, '1');
};
const codeDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff;
};
// Price per BILL unit: learned/listed prices are per counting unit, so a pack shortcut ("(1*10)") scales them.
// A weighed shortcut learns its price per kg; the per-piece product price says nothing about it.
export const aliasReferencePrice = (alias, prices = new Map()) => {
  const weighed = Number(alias?.price_by_weight || 0) === 1;
  const pack = Number(alias?.unit_multiplier) > 0 && !weighed ? Number(alias.unit_multiplier) : 1;
  const learned = Number(alias?.last_unit_price);
  if (learned > 0) return learned * pack;
  if (weighed) return null;
  const listed = Number(prices.get(Number(alias?.product_id)));
  return listed > 0 ? listed * pack : null;
};
const priceAgrees = (price, ref) => price > 0 && ref > 0 && Math.abs(price - ref) / ref <= PRICE_TOLERANCE;
// Step 2 for a row no taught name/code explains: its code one character from exactly one taught code whose
// reference price agrees (bill 132813: "0022 สะโพกหมูอ่อน 115฿" -> 0023 สะโพกซอย ~115฿, not 0122 มันแข็ง 80฿).
export function nearCodeByPrice({ itemCode, unitPrice, aliases, supplierKey, prices }) {
  const wanted = codeKey(itemCode);
  if (!wanted || !(unitPrice > 0)) return null;
  const near = new Map();
  for (const alias of aliases) {
    if (alias.supplier_key !== supplierKey || Number(alias.is_active ?? 1) === 0 || Number(alias.confirm_count ?? 1) < 1) continue;
    const code = codeKey(alias.item_code);
    if (code && codeDistance(code, wanted) === 1 && priceAgrees(unitPrice, aliasReferencePrice(alias, prices))) near.set(Number(alias.product_id), alias);
  }
  return near.size === 1 ? [...near.values()][0] : null;
}
export function resolveCodeConflict({ nameAlias, itemCode, unitPrice, aliases, supplierKey, prices }) {
  const nameCode = codeKey(nameAlias?.item_code);
  itemCode = codeKey(itemCode);
  if (!itemCode || !nameCode || nameCode === itemCode) return { alias: nameAlias };
  // The exact taught name with its own code one character misread (Asiamart B0112025 read E0112025) stays.
  if (codeDistance(nameCode, itemCode) === 1) return { alias: nameAlias, rawScore: 0.95 };
  const active = aliases.filter(alias => alias.supplier_key === supplierKey && Number(alias.is_active ?? 1) !== 0
    && Number(alias.confirm_count ?? 1) >= 1);
  const near = new Map();
  for (const alias of active) {
    const code = codeKey(alias.item_code);
    if (code && codeDistance(code, itemCode) === 1 && priceAgrees(unitPrice, aliasReferencePrice(alias, prices))) near.set(Number(alias.product_id), alias);
  }
  if (near.size === 1) {
    const [alias] = near.values();
    return { alias, rawScore: 0.9, reason: `รหัส ${itemCode} ใกล้ ${looseItemCode(alias.item_code)} และราคาใกล้ ${alias.product_name || ''}` };
  }
  if (priceAgrees(unitPrice, aliasReferencePrice(nameAlias, prices))) return { alias: nameAlias, rawScore: 0.9 };
  return { alias: null, suggestion: nameAlias?.product_name || null,
    reason: `ชื่อตรงกับที่สอน แต่รหัส ${itemCode} ไม่ตรง (${nameCode}) — ต้องตรวจ` };
}

// Handwritten bills append a count to the name ("ช่อน 10ก", "ดุก 5+5"; owner 2026-10-22: the number is pieces).
// Only a bare one-letter ก/ต or an a+b sum is such a note; printed sizes ("ข้าว 15กก", "1x24") stay part of the name.
export const splitHandwrittenCount = text => {
  const match = /^(.*?[^\d\s+])\s*(\d{1,3}(?:\s*\+\s*\d{1,3})*)\s*([กต])?\.?\s*$/.exec(String(text || '').trim());
  if (!match || (!match[3] && !match[2].includes('+'))) return null;
  return { base: match[1].trim(), count: match[2].split('+').reduce((sum, part) => sum + Number(part.trim()), 0) };
};

const siblingBase = name => normalizeMatchText(String(name || '').replace(/\s*\([^()]*\)\s*$/, '')).replace(/\s+/g, '');

export const matchOcrLinesToCatalog = ({
  ocrLines = [],
  aliases = [],
  expectedItems = [],
  products = [],
  units = [],
  supplierKey = 'none',
  prices = new Map()
} = {}) => {
  const productById = new Map();
  for (const product of products) {
    productById.set(Number(product.id), product);
  }
  for (const item of expectedItems) {
    if (item.product_id && !productById.has(Number(item.product_id))) {
      productById.set(Number(item.product_id), {
        id: Number(item.product_id),
        name: item.product_name,
        unit_id: item.unit_id ?? null,
        unit_name: item.unit_name ?? null
      });
    }
  }

  const usedOrderItemIds = new Set();

  const findUnusedExpectedOrderItemForProduct = (productId) => {
    for (const item of expectedItems) {
      const orderItemId = Number(item.order_item_id);
      if (
        Number(item.product_id) === Number(productId) &&
        !usedOrderItemIds.has(orderItemId)
      ) {
        return item;
      }
    }
    return null;
  };

  return ocrLines.map((sourceLine, index) => {
    const line = sourceLine;
    const lineNo = Number.isFinite(Number(line.line_no)) && Number(line.line_no) > 0
      ? Math.trunc(Number(line.line_no))
      : index + 1;
    const billText = String(line.bill_text || '').trim().slice(0, 500);
    const normBill = normalizeMatchText(billText);
    const unitText = line.unit_text ? String(line.unit_text).trim().slice(0, 100) : null;
    const normUnit = normalizeMatchText(unitText);
    const quantityBilled = toFiniteNumberOrNull(line.quantity_billed);
    const unitPrice = toFiniteNumberOrNull(line.unit_price);
    const amount =
      toFiniteNumberOrNull(line.amount) ??
      (quantityBilled !== null && unitPrice !== null
        ? fromSatangInt(toSatangInt(quantityBilled * unitPrice))
        : null);

    const itemCode = looseItemCode(line.item_code);
    const itemCodeField = itemCode ? { item_code: itemCode } : {};
    const countNote = splitHandwrittenCount(billText);
    const normBase = countNote ? normalizeMatchText(countNote.base).replace(/\s+/g, '') : '';
    let bestAlias = null;
    let bestAliasScore = 0;

    // The supplier's printed code is far more reliable than OCR text: a confirmed, active alias for the
    // same supplier and code wins over text matching (and over whatever the model guessed from the text).
    if (itemCode && supplierKey !== 'none') {
      const byCode = aliases.find((alias) => alias.supplier_key === supplierKey &&
        Number(alias.is_active ?? 1) !== 0 && Number(alias.confirm_count ?? 1) >= 1 &&
        codeKey(alias.item_code) === codeKey(itemCode));
      if (byCode) {
        bestAlias = { alias: byCode, rawScore: 1 };
        bestAliasScore = Infinity;
      }
    }

    for (const alias of aliases) {
      const aliasNormBill = alias.normalized_bill_text || normalizeMatchText(alias.bill_text);
      const aliasNormUnit = alias.normalized_unit_text ?? normalizeMatchText(alias.unit_text);
      // Abbreviations are supplier-specific identities, never fuzzy guesses.
      const sameSupplier = supplierKey !== 'none' && alias.supplier_key === supplierKey;
      if (bestAliasScore === Infinity) break;
      const aliasKey = String(aliasNormBill || '').replace(/\s+/g, '');
      const exactName = normBill && normBill.replace(/\s+/g, '') === aliasKey;
      if (!sameSupplier || !normBill || (!exactName && !(normBase && normBase === aliasKey))) continue;
      if (Number(alias.is_active ?? 1) === 0) continue;
      // The name without its handwritten count is the same shortcut, ranked just below an exact name.
      const score = exactName ? 1 : 0.99;
      const sameUnit = !normUnit || !aliasNormUnit || normUnit === aliasNormUnit;
      const weightedScore =
        score + (sameSupplier ? 0.04 : 0) + (sameUnit ? 0.02 : -0.04);

      if (weightedScore > bestAliasScore) {
        bestAliasScore = weightedScore;
        bestAlias = { alias, rawScore: score };
      }
    }

    if (!bestAlias && supplierKey !== 'none') {
      const byNearCode = nearCodeByPrice({ itemCode, unitPrice, aliases, supplierKey, prices });
      if (byNearCode) bestAlias = { alias: byNearCode, rawScore: 0.85 };
    } else if (bestAlias && bestAliasScore !== Infinity) {
      const resolved = resolveCodeConflict({ nameAlias: bestAlias.alias, itemCode, unitPrice, aliases, supplierKey, prices });
      if (resolved.alias) bestAlias = { alias: resolved.alias, rawScore: Math.min(bestAlias.rawScore, resolved.rawScore ?? 1) };
      else {
        bestAlias = null;
        // Written on the read row itself so the stored OCR result (and the review screen) keeps the offer.
        if (!line.suggested_product_name && resolved.suggestion && sourceLine && typeof sourceLine === 'object') {
          sourceLine.suggested_product_name = resolved.suggestion; sourceLine.suggestion_reason = resolved.reason;
        }
      }
    }

    if (bestAlias) {
      const { alias, rawScore } = bestAlias;
      let productId = Number(alias.product_id);
      let expectedItem = findUnusedExpectedOrderItemForProduct(productId);
      if (!expectedItem) {
        // Branch variants share a name plus a place in brackets ("ไข่ไก่" / "ไข่ไก่ (ผลิตคันคลอง)", owner 2026-10-22):
        // when this delivery's order holds exactly one such sibling, the bill line is that ordered product.
        const base = siblingBase(alias.product_name || productById.get(productId)?.name);
        const siblings = base ? expectedItems.filter(item => !usedOrderItemIds.has(Number(item.order_item_id)) &&
          Number(item.product_id) !== productId && siblingBase(item.product_name) === base) : [];
        if (siblings.length === 1) { expectedItem = siblings[0]; productId = Number(expectedItem.product_id); }
      }
      const product = productById.get(productId) || null;
      if (expectedItem?.order_item_id) {
        usedOrderItemIds.add(Number(expectedItem.order_item_id));
      }

      const multiplierRaw = Number(alias.unit_multiplier || 1);
      const multiplier = Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
      const baseQtyBilled =
        quantityBilled ??
        (expectedItem ? toFiniteNumberOrNull(expectedItem.quantity_ordered) : 0) ??
        0;
      const qtyReceived = fromMilliQtyInt(toMilliQtyInt(baseQtyBilled * multiplier)) ?? 0;
      const baseUnitPrice = computeBaseUnitPrice({
        unitPrice,
        amount,
        quantityBilled: baseQtyBilled,
        quantityReceived: qtyReceived,
        unitMultiplier: multiplier
      });

      const matchedUnit = resolveUnitByText(unitText, units);
      const lineConf = clampConfidence(line.confidence);
      // Priced by weight (bill in kg, we order/receive pieces): the billed weight and price per kg
      // are kept as bill facts, never compared with the piece count; only the line amount is billed.
      const byWeight = Number(alias.price_by_weight || 0) === 1;
      const matchConfidence = Math.min(
        1,
        Math.round(((lineConf !== null ? Math.min(rawScore, lineConf) : rawScore * 0.98)) * 10000) /
          10000
      );

      return {
        line_no: lineNo,
        bill_text: billText,
        product_id: productId,
        product_name:
          product?.name ||
          expectedItem?.product_name ||
          alias.product_name ||
          null,
        order_item_id: expectedItem ? Number(expectedItem.order_item_id) : null,
        unit_text: (byWeight ? null : unitText) || expectedItem?.unit_name || product?.unit_name || alias.unit_text || null,
        unit_id: byWeight
          ? (expectedItem?.unit_id ? Number(expectedItem.unit_id) : product?.unit_id ? Number(product.unit_id) : null)
          : alias.unit_id && Number(alias.product_id) === productId
          ? Number(alias.unit_id)
          : matchedUnit?.id
            ? Number(matchedUnit.id)
            : expectedItem?.unit_id
              ? Number(expectedItem.unit_id)
              : product?.unit_id
                ? Number(product.unit_id)
                : null,
        unit_multiplier: byWeight ? 1 : multiplier,
        ...itemCodeField,
        // The handwritten count is the number of pieces the shop weighed (compared with our count).
        quantity_billed: byWeight ? (countNote ? countNote.count : null) : quantityBilled,
        quantity_received: byWeight
          ? (expectedItem ? toFiniteNumberOrNull(expectedItem.quantity_ordered) ?? 0 : 0)
          : qtyReceived,
        unit_price: byWeight ? null : unitPrice,
        base_unit_price: byWeight ? null : baseUnitPrice,
        amount: byWeight && amount === null && quantityBilled !== null && unitPrice !== null
          ? fromSatangInt(toSatangInt(quantityBilled * unitPrice)) : amount,
        ...(byWeight ? { price_by_weight: true, bill_weight: quantityBilled, bill_weight_unit: unitText || null,
          weight_unit_price: unitPrice, weight_ref_price: toFiniteNumberOrNull(alias.last_unit_price) } : {}),
        match: {
          source: 'alias',
          confidence: matchConfidence
        }
      };
    }

    let bestOrder = null;
    let bestOrderScore = 0;

    for (const item of expectedItems) {
      if (usedOrderItemIds.has(Number(item.order_item_id))) {
        continue;
      }
      const score = normBill && normBill === normalizeMatchText(item.product_name) ? 1 : 0;
      if (!score) continue;
      if (score > bestOrderScore) {
        bestOrderScore = score;
        bestOrder = { item, rawScore: score };
      }
    }

    if (bestOrder) {
      const { item, rawScore } = bestOrder;
      usedOrderItemIds.add(Number(item.order_item_id));
      const matchedUnit = resolveUnitByText(unitText, units);
      const lineConf = clampConfidence(line.confidence);
      const matchConfidence = Math.min(
        1,
        Math.round(
          ((lineConf !== null ? Math.min(rawScore, lineConf * 0.98) : rawScore * 0.95)) * 10000
        ) / 10000
      );
      const qtyRec =
        quantityBilled !== null
          ? quantityBilled
          : toFiniteNumberOrNull(item.quantity_ordered) ?? 0;

      return {
        line_no: lineNo,
        bill_text: billText,
        product_id: Number(item.product_id),
        product_name: item.product_name || null,
        order_item_id: Number(item.order_item_id),
        unit_text: unitText || item.unit_name || null,
        unit_id: matchedUnit?.id
          ? Number(matchedUnit.id)
          : item.unit_id
            ? Number(item.unit_id)
            : null,
        unit_multiplier: 1,
        ...itemCodeField,
        quantity_billed: quantityBilled,
        quantity_received: qtyRec,
        unit_price: unitPrice,
        base_unit_price: unitPrice,
        amount,
        match: {
          source: 'order',
          confidence: matchConfidence
        }
      };
    }

    // A catalog name read verbatim also outranks every AI suggestion.
    const exactProduct = [...productById.values()].find(product => normBill && normalizeMatchText(product.name) === normBill);
    const suggestion = normalizeMatchText(line.suggested_product_name);
    const suggestedProduct = !exactProduct && suggestion
      ? [...productById.values()].find(product => normalizeMatchText(product.name) === suggestion) : null;
    const candidate = exactProduct || suggestedProduct;
    const candidateOrder = candidate ? findUnusedExpectedOrderItemForProduct(candidate.id) : null;
    if (candidateOrder) usedOrderItemIds.add(Number(candidateOrder.order_item_id));
    const matchedUnit = resolveUnitByText(unitText, units);
    return {
      line_no: lineNo,
      bill_text: billText,
      product_id: candidate ? Number(candidate.id) : null,
      product_name: candidate?.name || null,
      order_item_id: candidateOrder ? Number(candidateOrder.order_item_id) : null,
      suggested_product_name: line.suggested_product_name || null,
      suggestion_reason: line.suggestion_reason || null,
      unit_text: unitText,
      unit_id: matchedUnit?.id ? Number(matchedUnit.id) : candidate?.unit_id || null,
      unit_multiplier: 1,
      ...itemCodeField,
      quantity_billed: quantityBilled,
      quantity_received: quantityBilled !== null ? quantityBilled : 0,
      unit_price: unitPrice,
      base_unit_price: unitPrice,
      amount,
      match: {
        source: exactProduct ? 'order' : suggestedProduct ? 'ai' : 'none',
        confidence: suggestedProduct ? Math.min(clampConfidence(line.confidence) ?? 0.4, 0.4) : clampConfidence(line.confidence)
      }
    };
  });
};

export const mergeOcrLinesPreservingUserEdits = ({
  existingLines = [],
  newMatchedLines = []
} = {}) => {
  const userEditedByLineNo = new Map();
  const userEditedOrderItemIds = new Set();

  for (const existing of existingLines) {
    const isEdited =
      Boolean(existing.is_user_edited) ||
      existing.match_source === 'manual' ||
      existing.match?.source === 'manual';
    if (isEdited) {
      userEditedByLineNo.set(Number(existing.line_no), existing);
      if (existing.order_item_id) {
        userEditedOrderItemIds.add(Number(existing.order_item_id));
      }
    }
  }

  const merged = [];
  const handledLineNos = new Set();
  const coveredOrderItemIds = new Set(userEditedOrderItemIds);

  for (const ocrLine of newMatchedLines) {
    const lineNo = Number(ocrLine.line_no);
    if (userEditedByLineNo.has(lineNo)) {
      const preserved = userEditedByLineNo.get(lineNo);
      merged.push({ ...preserved, is_user_edited: true });
      handledLineNos.add(lineNo);
      if (preserved.order_item_id) {
        coveredOrderItemIds.add(Number(preserved.order_item_id));
      }
      continue;
    }

    if (ocrLine.order_item_id && coveredOrderItemIds.has(Number(ocrLine.order_item_id))) {
      merged.push({ ...ocrLine, order_item_id: null, is_user_edited: false });
      handledLineNos.add(lineNo);
      continue;
    }

    if (ocrLine.order_item_id) {
      coveredOrderItemIds.add(Number(ocrLine.order_item_id));
    }

    merged.push({ ...ocrLine, is_user_edited: false });
    handledLineNos.add(lineNo);
  }

  for (const [lineNo, preserved] of userEditedByLineNo.entries()) {
    if (!handledLineNos.has(lineNo)) {
      merged.push({ ...preserved, is_user_edited: true });
      handledLineNos.add(lineNo);
    }
  }

  let nextLineNo =
    merged.reduce((maxNo, item) => Math.max(maxNo, Number(item.line_no) || 0), 0) + 1;

  for (const existing of existingLines) {
    if (Boolean(existing.is_user_edited)) continue;
    const orderItemId = existing.order_item_id ? Number(existing.order_item_id) : null;
    if (!orderItemId || coveredOrderItemIds.has(orderItemId)) continue;

    coveredOrderItemIds.add(orderItemId);
    merged.push({
      ...existing,
      id: undefined,
      line_no: nextLineNo++,
      bill_text: '',
      quantity_billed: null,
      quantity_received: 0,
      unit_price: null,
      base_unit_price: null,
      amount: null,
      match_confidence: 0.4,
      is_user_edited: false
    });
  }

  return merged.sort((a, b) => Number(a.line_no || 0) - Number(b.line_no || 0));
};

export const computeDocumentWarnings = ({
  document = {},
  lines = [],
  expectedItemsById = new Map(),
  latestPricesByProductId = new Map(),
  isDuplicateBill = false,
  lowConfidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  priceChangeThreshold = DEFAULT_PRICE_CHANGE_THRESHOLD,
  sumMismatchTolerance = DEFAULT_SUM_MISMATCH_TOLERANCE
} = {}) => {
  const warnings = [];
  const pushWarning = (code, message, lineNo = null) => {
    const normalizedLineNo = lineNo === null || lineNo === undefined ? null : Number(lineNo);
    if (!warnings.some((w) => w.code === code && w.line_no === normalizedLineNo)) {
      warnings.push({ code, message, line_no: normalizedLineNo });
    }
  };

  let ocrMetadata = {};
  try { ocrMetadata = JSON.parse(document.ocr_result_json || '{}') || {}; } catch { /* Legacy metadata absent. */ }
  for (const code of ocrMetadata.warnings || []) {
    if (['BILL_TOTAL_MISMATCH', 'LINE_AMOUNT_MISMATCH'].includes(code)) pushWarning(code, 'ยอดในบิลไม่ลงตัว ตรวจส่วนลด/VAT');
    if (code === 'SHIP_TO_MISMATCH') pushWarning(code, 'บิลนี้ส่งสาขาอื่น?');
    if (code === 'DOC_DATE_INVALID') pushWarning(code, 'วันที่ในบิลอ่านไม่ได้/ผิดปกติ กรุณาตรวจ');
    if (code === 'TOTAL_MISSING_LINE_SUM') pushWarning(code, 'ไม่พบยอดรวมในภาพ ผลรวมบรรทัดเป็นเพียงข้อเสนอ กรุณาตรวจสอบบรรทัดที่อ่านไม่ออก');
    if (code === 'NOT_A_BILL') pushWarning(code, 'ภาพอาจไม่ใช่บิลสินค้า หรืออ่านรายการสินค้าไม่ได้');
    if (code === 'BILL_IS_STATEMENT') pushWarning(code, 'รูปนี้เป็นใบวางบิล/ใบสรุปรอบ ไม่ใช่ใบส่งของ ระบบไม่สร้างรายการสินค้าจากรูปนี้');
    if (code === 'DOC_KIND_UNCERTAIN') pushWarning(code, 'ประเภทเอกสารไม่แน่ชัด แต่พบรายการสินค้า กรุณาตรวจสอบภาพและรายการก่อนยืนยัน');
  }

  if (isDuplicateBill) {
    pushWarning('DUPLICATE_BILL', 'พบบิลซ้ำในระบบ (ซัพพลายเออร์ เลขที่บิล และยอดรวมตรงกัน)', null);
  }

  const docConfidence = toFiniteNumberOrNull(
    document.ocr_confidence ?? document.ocr?.confidence
  );
  if (docConfidence !== null && docConfidence < lowConfidenceThreshold) {
    pushWarning('LOW_CONFIDENCE', 'ความมั่นใจในการอ่านบิลต่ำ กรุณาตรวจสอบข้อมูลทุกบรรทัด', null);
  }

  let sumLineSatang = 0;
  let hasAnyLineAmount = false;

  for (const line of lines) {
    const lineNo = Number(line.line_no) || null;
    const productId = line.product_id ? Number(line.product_id) : null;
    const orderItemId = line.order_item_id ? Number(line.order_item_id) : null;
    const qtyBilled = toFiniteNumberOrNull(line.quantity_billed);
    const qtyReceived = toFiniteNumberOrNull(line.quantity_received) ?? 0;
    const unitPrice = toFiniteNumberOrNull(line.unit_price);
    const unitMultiplier = toFiniteNumberOrNull(line.unit_multiplier) ?? 1;
    const explicitAmount = toFiniteNumberOrNull(line.amount);
    const effectiveAmount =
      explicitAmount !== null
        ? explicitAmount
        : unitPrice !== null && (qtyBilled ?? qtyReceived) !== null
          ? fromSatangInt(toSatangInt((qtyBilled ?? qtyReceived) * unitPrice))
          : null;

    if (effectiveAmount !== null) {
      sumLineSatang += toSatangInt(effectiveAmount);
      hasAnyLineAmount = true;
    }

    if (!productId) {
      pushWarning('UNMATCHED_LINE', `บรรทัดที่ ${lineNo || '-'}: ยังไม่ได้จับคู่สินค้าในระบบ`, lineNo);
    }

    const lineConfidence = toFiniteNumberOrNull(
      line.match_confidence ?? line.match?.confidence ?? line.confidence
    );
    // Older branch drafts used a synthetic 0.4 for products absent from the bill.
    // Keep genuine row/document warnings, but do not call an absent row unreadable.
    const absentBranchBillRow = (document.receiving_scope ?? document.scope) === 'branch' && orderItemId &&
      !String(line.bill_text || '').trim() && qtyBilled === null && unitPrice === null && explicitAmount === null;
    if (!absentBranchBillRow && lineConfidence !== null && lineConfidence < lowConfidenceThreshold) {
      pushWarning('LOW_CONFIDENCE', `บรรทัดที่ ${lineNo || '-'}: ความมั่นใจในการอ่าน/จับคู่ต่ำ`, lineNo);
    }

    const baseUnitPrice = computeBaseUnitPrice({
      unitPrice: toFiniteNumberOrNull(line.base_unit_price) ?? unitPrice,
      amount: effectiveAmount,
      quantityBilled: qtyBilled,
      quantityReceived: qtyReceived,
      unitMultiplier: line.base_unit_price != null ? 1 : unitMultiplier
    });

    const byWeight = Boolean(Number(line.price_by_weight || 0));
    if (byWeight) {
      // The per-piece cost varies with fish size; only the shop's price per kg is comparable.
      const perKg = toFiniteNumberOrNull(line.weight_unit_price);
      const previousPerKg = toFiniteNumberOrNull(line.weight_ref_price);
      if (perKg !== null && previousPerKg !== null && previousPerKg > 0 && toSatangInt(perKg) !== toSatangInt(previousPerKg)) {
        pushWarning('PRICE_CHANGE',
          `บรรทัดที่ ${lineNo || '-'}: ราคาต่อ กก. ${formatMoney(perKg)} ต่างจากครั้งก่อน (${formatMoney(previousPerKg)})`,
          lineNo);
      }
    } else if (productId && baseUnitPrice !== null && baseUnitPrice > 0) {
      const refPrice = toFiniteNumberOrNull(latestPricesByProductId.get(productId));
      if (refPrice !== null && refPrice > 0) {
        const diffRatio = Math.abs(baseUnitPrice - refPrice) / refPrice;
        if (diffRatio > priceChangeThreshold) {
          pushWarning(
            'PRICE_CHANGE',
            `บรรทัดที่ ${lineNo || '-'}: ราคาต่อหน่วยฐาน (${formatMoney(baseUnitPrice)}) ต่างจากราคาล่าสุด (${formatMoney(refPrice)}) เกิน 15%`,
            lineNo
          );
        }
      }
    }

    if (orderItemId && expectedItemsById.has(orderItemId)) {
      const expected = expectedItemsById.get(orderItemId);
      const orderedMillis = toMilliQtyInt(expected.quantity_ordered ?? expected.quantity);
      const receivedMillis = toMilliQtyInt(qtyReceived) ?? 0;
      if (orderedMillis !== null && orderedMillis > 0) {
        if (receivedMillis < orderedMillis) {
          pushWarning(
            'QTY_SHORT',
            `บรรทัดที่ ${lineNo || '-'}: จำนวนรับจริง (${formatQuantity(qtyReceived)}) น้อยกว่าที่สั่ง (${formatQuantity(fromMilliQtyInt(orderedMillis))})`,
            lineNo
          );
        } else if (receivedMillis > orderedMillis) {
          pushWarning(
            'QTY_OVER',
            `บรรทัดที่ ${lineNo || '-'}: จำนวนรับจริง (${formatQuantity(qtyReceived)}) มากกว่าที่สั่ง (${formatQuantity(fromMilliQtyInt(orderedMillis))})`,
            lineNo
          );
        }
      }
    }
  }

  const subtotalSatang = toSatangInt(document.subtotal);
  const discountSatang = toSatangInt(document.discount) ?? 0;
  const vatSatang = toSatangInt(document.vat) ?? 0;
  const totalSatang = toSatangInt(document.total);
  const toleranceSatang = Math.round(sumMismatchTolerance * 100);

  if (subtotalSatang !== null && totalSatang !== null &&
      Math.abs(subtotalSatang - discountSatang + vatSatang - totalSatang) > 100) {
    pushWarning('TOTAL_EQUATION_MISMATCH', 'ยอดก่อนส่วนลด − ส่วนลด + VAT ไม่ตรงกับยอดสุทธิเกิน 1 บาท', null);
  }

  if (hasAnyLineAmount && (subtotalSatang !== null || totalSatang !== null)) {
    let mismatch = false;
    // VAT-inclusive line prices (ต.ดริ๊งค์: 100 โหล × 38 = 3,800 = ยอดชำระ, "ราคาไม่รวม VAT" 3,551.40 + VAT 248.60):
    // the lines add up to the total, and the printed pre-VAT figure plus VAT is that same total.
    const vatInclusiveLines = totalSatang !== null && vatSatang > 0 && subtotalSatang !== null &&
      Math.abs(sumLineSatang - discountSatang - totalSatang) <= toleranceSatang &&
      Math.abs(subtotalSatang + vatSatang - totalSatang) <= toleranceSatang;
    if (subtotalSatang !== null && !vatInclusiveLines && Math.abs(sumLineSatang - subtotalSatang) > toleranceSatang) {
      mismatch = true;
    }
    if (totalSatang !== null) {
      const expectedTotalSatang = sumLineSatang - discountSatang + vatSatang;
      if (
        Math.abs(expectedTotalSatang - totalSatang) > toleranceSatang &&
        Math.abs(sumLineSatang - totalSatang) > toleranceSatang
      ) {
        mismatch = true;
      }
    }
    if (mismatch) {
      pushWarning('SUM_MISMATCH', 'ผลรวมจำนวนเงินของบรรทัดรายการไม่ตรงกับยอดรวมของบิลเกิน 1 บาท', null);
    }
  }
  if (warnings.some((warning) =>
    ['SUM_MISMATCH', 'TOTAL_EQUATION_MISMATCH'].includes(warning.code))) {
    pushWarning('LOW_CONFIDENCE', 'ยอดเงินไม่สอดคล้องกัน กรุณาตรวจสอบข้อมูลทุกบรรทัด', null);
  }

  return {
    warnings,
    warningCodes: Array.from(new Set(warnings.map((w) => w.code)))
  };
};
