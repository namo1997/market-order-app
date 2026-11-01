// Shared input validation helpers for master-data endpoints (branches, departments, units,
// users, product groups, supplier masters, products ...). They throw errors carrying
// `statusCode` so the global errorHandler returns the Thai message with the right status
// instead of a 500 ("Data too long", "Column cannot be null", ...).

export const httpError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.status = statusCode;
  return error;
};

// Required text: rejects missing / blank / whitespace-only values and values longer than maxLength.
export const requireText = (value, label, maxLength) => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) {
    throw httpError(`กรุณากรอก${label}`);
  }
  if (maxLength && text.length > maxLength) {
    throw httpError(`${label}ยาวเกินไป (ไม่เกิน ${maxLength} ตัวอักษร)`);
  }
  return text;
};

// Optional text: returns trimmed text or null; still enforces maxLength.
export const optionalText = (value, label, maxLength) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (maxLength && text.length > maxLength) {
    throw httpError(`${label}ยาวเกินไป (ไม่เกิน ${maxLength} ตัวอักษร)`);
  }
  return text;
};

// Basic phone check: digits plus common separators, 6-20 digits.
export const optionalPhone = (value, label = 'เบอร์โทร', maxLength = 20) => {
  const text = optionalText(value, label, maxLength);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!/^[0-9+\-\s().,/#]+$/.test(text) || digits.length < 6 || digits.length > 20) {
    throw httpError(`${label}ไม่ถูกต้อง (ใช้ตัวเลข 6-20 หลัก และ - ( ) + เท่านั้น)`);
  }
  return text;
};

export const requirePositiveId = (value, label) => {
  const id = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isInteger(id) || id <= 0) {
    throw httpError(`กรุณาเลือก${label}`);
  }
  return id;
};

// Converts a MySQL ER_DUP_ENTRY into a 409 that names the offending field.
// `fieldsByIndex` maps unique index names to Thai field labels.
export const toDuplicateError = (error, fieldsByIndex = {}, fallbackLabel = 'ข้อมูล') => {
  if (error?.code !== 'ER_DUP_ENTRY') return error;
  const message = String(error.sqlMessage || error.message || '');
  const match = message.match(/for key '([^']+)'/);
  const indexName = match ? match[1].split('.').pop() : '';
  const label = fieldsByIndex[indexName] || fallbackLabel;
  const valueMatch = message.match(/Duplicate entry '([^']*)'/);
  const value = valueMatch ? valueMatch[1] : '';
  const shownValue = value ? ` "${value}"` : '';
  return httpError(`${label}${shownValue} ซ้ำกับข้อมูลที่มีอยู่แล้ว`, 409);
};
