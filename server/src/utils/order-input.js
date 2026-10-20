const MAX_DECIMAL = 99999999.99;

export const orderInputError = (message) => Object.assign(new Error(message), { statusCode: 400 });

// Normalize before any write so MySQL rounding cannot change quantity after
// the order total has already been calculated.
export const normalizeOrderItems = (items, { allowEmpty = false } = {}) => {
  if (!Array.isArray(items) || (!allowEmpty && items.length === 0)) {
    throw orderInputError('กรุณาระบุรายการสินค้าอย่างน้อย 1 รายการ');
  }
  const number = (value) =>
    typeof value === 'number' || (typeof value === 'string' && value.trim())
      ? Number(value)
      : NaN;
  const normalized = items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw orderInputError('รายการสินค้าไม่ถูกต้อง');
    }
    const productId = number(item.product_id);
    const quantity = number(item.quantity);
    const price = item.requested_price == null ? 0 : number(item.requested_price);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw orderInputError('รหัสสินค้าไม่ถูกต้อง');
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_DECIMAL || Math.round(quantity * 100) <= 0) {
      throw orderInputError('จำนวนสินค้าต้องมากกว่า 0 และไม่เกิน 99,999,999.99');
    }
    if (!Number.isFinite(price) || price < 0 || price > MAX_DECIMAL) {
      throw orderInputError('ราคาสินค้าต้องเป็นตัวเลขตั้งแต่ 0 ถึง 99,999,999.99');
    }
    return {
      ...item,
      product_id: productId,
      quantity: Math.round(quantity * 100) / 100,
      requested_price: Math.round(price * 100) / 100
    };
  });
  const total = normalized.reduce((sum, item) => sum + item.quantity * item.requested_price, 0);
  if (!Number.isFinite(total) || total > MAX_DECIMAL) {
    throw orderInputError('ยอดรวมคำสั่งซื้อเกินจำนวนที่ระบบรองรับ');
  }
  return normalized;
};
