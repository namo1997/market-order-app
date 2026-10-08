const MAX_ROWS = 300;
const nullableString = (maxLength) => ({ type: ['string', 'null'], maxLength });
const nullableNumber = { type: ['number', 'null'], minimum: 0 };

export const INVOICE_LINE_ITEMS_SCHEMA = {
  type: 'array',
  maxItems: MAX_ROWS,
  items: {
    type: 'object',
    properties: {
      line_no: { type: ['integer', 'null'], minimum: 1 },
      description: { type: 'string', minLength: 1, maxLength: 500 },
      product_code: nullableString(100),
      quantity: nullableNumber,
      unit: nullableString(80),
      unit_price: nullableNumber,
      amount: nullableNumber
    },
    required: ['line_no', 'description', 'product_code', 'quantity', 'unit', 'unit_price', 'amount'],
    additionalProperties: false
  }
};

// เก็บตามลำดับในภาพ รวมแถวสินค้าที่ซ้ำกัน; ห้ามแปลงช่องว่างเป็นเลขศูนย์
export const normalizeInvoiceLineItemsResult = (raw) => {
  if (raw == null) return { items: [], truncated: false, invalid_count: 0 };
  if (!Array.isArray(raw)) return { items: [], truncated: false, invalid_count: 1 };
  const items = [];
  let invalid_count = 0;
  const validText = (value, max) => value == null || (typeof value === 'string' && value.trim().length <= max);
  const validNumber = (value) => value == null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  for (const row of raw.slice(0, MAX_ROWS)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.description !== 'string' || !row.description.trim() || row.description.trim().length > 500
      || !(row.line_no == null || (Number.isSafeInteger(row.line_no) && row.line_no > 0))
      || !validText(row.product_code, 100) || !validText(row.unit, 80)
      || !['quantity', 'unit_price', 'amount'].every((key) => validNumber(row[key]))) {
      invalid_count += 1;
      continue;
    }
    items.push({
      line_no: row.line_no ?? null,
      description: row.description.trim(),
      product_code: row.product_code == null ? null : row.product_code.trim() || null,
      quantity: row.quantity ?? null,
      unit: row.unit == null ? null : row.unit.trim() || null,
      unit_price: row.unit_price ?? null,
      amount: row.amount ?? null
    });
  }
  return { items, truncated: raw.length > MAX_ROWS, invalid_count };
};

export const normalizeInvoiceLineItems = (raw) => normalizeInvoiceLineItemsResult(raw).items;
