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

export const matchOcrLinesToCatalog = ({
  ocrLines = [],
  aliases = [],
  expectedItems = [],
  products = [],
  units = [],
  supplierKey = 'none'
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

  return ocrLines.map((line, index) => {
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

    let bestAlias = null;
    let bestAliasScore = 0;

    for (const alias of aliases) {
      const aliasNormBill = alias.normalized_bill_text || normalizeMatchText(alias.bill_text);
      const aliasNormUnit = alias.normalized_unit_text ?? normalizeMatchText(alias.unit_text);
      const score = computeTextSimilarity(normBill, aliasNormBill);
      if (score < 0.88) continue;

      const sameSupplier =
        supplierKey !== 'none' &&
        alias.supplier_key &&
        alias.supplier_key === supplierKey;
      const sameUnit = !normUnit || !aliasNormUnit || normUnit === aliasNormUnit;
      const weightedScore =
        score + (sameSupplier ? 0.04 : 0) + (sameUnit ? 0.02 : -0.04);

      if (weightedScore > bestAliasScore) {
        bestAliasScore = weightedScore;
        bestAlias = { alias, rawScore: score };
      }
    }

    if (bestAlias) {
      const { alias, rawScore } = bestAlias;
      const productId = Number(alias.product_id);
      const product = productById.get(productId) || null;
      const expectedItem = findUnusedExpectedOrderItemForProduct(productId);
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
        unit_text: unitText || expectedItem?.unit_name || product?.unit_name || alias.unit_text || null,
        unit_id: alias.unit_id
          ? Number(alias.unit_id)
          : matchedUnit?.id
            ? Number(matchedUnit.id)
            : expectedItem?.unit_id
              ? Number(expectedItem.unit_id)
              : product?.unit_id
                ? Number(product.unit_id)
                : null,
        unit_multiplier: multiplier,
        quantity_billed: quantityBilled,
        quantity_received: qtyReceived,
        unit_price: unitPrice,
        base_unit_price: baseUnitPrice,
        amount,
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
      const score = computeTextSimilarity(normBill, item.product_name);
      if (score < 0.72) continue;
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

    const matchedUnit = resolveUnitByText(unitText, units);
    return {
      line_no: lineNo,
      bill_text: billText,
      product_id: null,
      product_name: null,
      order_item_id: null,
      unit_text: unitText,
      unit_id: matchedUnit?.id ? Number(matchedUnit.id) : null,
      unit_multiplier: 1,
      quantity_billed: quantityBilled,
      quantity_received: quantityBilled !== null ? quantityBilled : 0,
      unit_price: unitPrice,
      base_unit_price: unitPrice,
      amount,
      match: {
        source: 'none',
        confidence: clampConfidence(line.confidence)
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
    if (lineConfidence !== null && lineConfidence < lowConfidenceThreshold) {
      pushWarning('LOW_CONFIDENCE', `บรรทัดที่ ${lineNo || '-'}: ความมั่นใจในการอ่าน/จับคู่ต่ำ`, lineNo);
    }

    const baseUnitPrice = computeBaseUnitPrice({
      unitPrice: toFiniteNumberOrNull(line.base_unit_price) ?? unitPrice,
      amount: effectiveAmount,
      quantityBilled: qtyBilled,
      quantityReceived: qtyReceived,
      unitMultiplier: line.base_unit_price != null ? 1 : unitMultiplier
    });

    if (productId && baseUnitPrice !== null && baseUnitPrice > 0) {
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
    if (subtotalSatang !== null && Math.abs(sumLineSatang - subtotalSatang) > toleranceSatang) {
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
