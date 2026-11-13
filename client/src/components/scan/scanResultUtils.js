// ผลสแกนหนึ่งครั้ง: { id, tone: 'ok'|'warn'|'error', title, detail }
const TONE = {
  ok: { icon: '✓', ring: 'bg-emerald-600', card: 'border-emerald-500 bg-emerald-50', title: 'text-emerald-900', flash: 'bg-emerald-400' },
  warn: { icon: '!', ring: 'bg-amber-500', card: 'border-amber-500 bg-amber-50', title: 'text-amber-900', flash: 'bg-amber-400' },
  error: { icon: '✕', ring: 'bg-red-600', card: 'border-red-500 bg-red-50', title: 'text-red-900', flash: 'bg-red-500' }
};

export const scanToneStyle = (tone) => TONE[tone] || TONE.error;


// รวมจำนวนที่สแกนแล้วตามสินค้า: [{ product_id, name, unit, quantity, stickers }]
export const groupScannedStickers = (events = []) => {
  const map = new Map();
  for (const event of events) {
    const key = Number(event.product_id);
    const current = map.get(key) || {
      product_id: key,
      name: event.name,
      unit: event.unit,
      quantity: 0,
      stickers: 0,
      lastAt: 0
    };
    current.quantity = Number((current.quantity + Number(event.quantity || 0)).toFixed(4));
    current.stickers += 1;
    current.lastAt = Math.max(current.lastAt, Number(event.at || 0));
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
};
