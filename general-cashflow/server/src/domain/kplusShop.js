import { roundMoney } from './money.js';

export const kplusShopSettlementKey = ({ merchantId, sourceDate }) =>
  `kplus-shop:${String(merchantId || '').trim().toUpperCase()}:${String(sourceDate || '').trim()}`;

export const parseKplusShopEmail = (body) => {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const merchantId = text.match(/รหัสร้านค้า\s*:\s*([A-Z0-9]+)/i)?.[1] || null;
  const amountText = text.match(/ยอดเงินจำนวน\s*\(บาท\)\s*:\s*([\d,]+\.\d{2})/i)?.[1] || null;
  const amount = roundMoney(Number(String(amountText || '').replaceAll(',', '')) || 0);
  if (!merchantId || amountText === null) {
    const error = new Error('อ่านอีเมล K SHOP ไม่พบรหัสร้านค้าหรือยอดเงิน');
    error.statusCode = 422;
    throw error;
  }
  return { merchantId, amount, text };
};
