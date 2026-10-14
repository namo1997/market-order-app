// ประโยคอธิบายทิศของตัวคูณหน่วย: "1 {หน่วยซื้อ} = {N} {หน่วยฐาน}"
export const multiplierSentence = (fromName, multiplier, toName) => {
  const n = Number(multiplier);
  if (!fromName || !toName || !Number.isFinite(n) || n <= 0) return '';
  return `1 ${fromName} = ${n.toLocaleString('th-TH', { maximumFractionDigits: 6 })} ${toName}`;
};

// เตือน (ไม่บล็อก) เมื่อ N < 1 เช่น 1 แพ็ค น้อยกว่า 1 ชิ้น อาจกรอกกลับทิศ
export const multiplierDirectionWarning = (fromName, multiplier, toName) => {
  const n = Number(multiplier);
  if (!fromName || !toName || !Number.isFinite(n) || n <= 0 || n >= 1) return '';
  return `ตรวจทิศทาง: 1 ${fromName} น้อยกว่า 1 ${toName}?`;
};
