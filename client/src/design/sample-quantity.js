/** Preview-only validation. Components remain presentational; no API rules are inferred. */
export function validateSampleQuantity(value) {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) {
    return { status: 'error', label: 'ตรวจจำนวน', error: 'กรอกจำนวนมากกว่า 0 ไม่เกิน 99,999.99 ทศนิยมไม่เกิน 2 ตำแหน่ง' };
  }
  const [whole, fraction = ''] = value.split('.');
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (hundredths === 0) return { status: 'error', label: 'ตรวจจำนวน', error: 'จำนวนต้องมากกว่าศูนย์' };
  const difference = Math.abs(hundredths - 1200);
  const decimal = String(difference % 100).padStart(2, '0').replace(/0+$/, '');
  const formatted = `${Math.trunc(difference / 100)}${decimal ? `.${decimal}` : ''}`;
  return { status: difference ? 'review' : 'ok', label: difference ? `${hundredths < 1200 ? 'ขาด' : 'เกิน'} ${formatted} กก.` : 'ตรงกัน', error: undefined };
}
