// Pure evidence rules shared by vision post-processing and database repairs.
export const parseMarketReconciliation = (value) => {
  const text = String(value || '').replace(/\u00a0/g, ' ').trim();
  const date = text.match(/ตลาด\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4})/i)?.[1]?.replace(/\s+/g, '');
  const money = value => value == null ? null : Number(value.replaceAll(',', ''));
  const billTotal = money(text.match(/จ่าย\s*([0-9][0-9,]*(?:\.\d+)?)/)?.[1]);
  const typedTransferTotal = money(text.match(/โอนเพิ่ม\s*([0-9][0-9,]*(?:\.\d+)?)/)?.[1]);
  const balanceMatch = text.match(/(?:เงินในบัญชี)?ขาดเกิน\s*([+-]?)\s*([0-9][0-9,]*(?:\.\d+)?)/);
  const balance = balanceMatch ? (balanceMatch[1] === '-' ? -1 : 1) * money(balanceMatch[2]) : null;
  const combined = /รวมของ|รวม.*(?:เมื่อวาน|วันก่อน|หลายวัน|สองวัน|2\s*วัน)|ยอดรวม.*วัน/i.test(text);
  const daily = balance != null ? Math.round((billTotal - balance) * 100) / 100 : combined ? null : typedTransferTotal;
  if (!date || !(billTotal > 0)) return null;
  return { text, date, billTotal, transferTotal: daily > 0 ? daily : null, typedTransferTotal, balance, combined };
};

export const crossesUnrelatedImage = ({ analysis = {}, item = {}, message = {}, timeline = [] }) => {
  const center = Number(item.event_timestamp_ms || 0), end = Number(message.event_timestamp_ms || 0);
  const sender = String(item.sender_canonical_user_id || item.sender_user_id || '');
  const reference = String(analysis.doc_ref || item.doc_ref || '').trim();
  const images = timeline.filter(entry => entry.message_type === 'image'
    && String(entry.sender_user_id || '') === sender
    && Number(entry.event_timestamp_ms) > Math.min(center, end)
    && Number(entry.event_timestamp_ms) < Math.max(center, end)
    && Number(entry.capture_item_id || 0) !== Number(item.id || 0));
  if (!images.length) return false;
  const sameSender = sender && images.every(entry => String(entry.sender_user_id || '') === sender);
  const sameDocument = reference && images.every(entry => String(entry.capture_doc_ref || '').trim() === reference);
  const explicitBatch = /(?:ชุดนี้|บิลเดียวกัน|เอกสารเดียวกัน|รวม\s*\d+\s*(?:รูป|หน้า))/i.test(String(message.text || ''));
  const conflictingReference = images.some(entry => entry.capture_doc_ref && reference && entry.capture_doc_ref !== reference);
  return !(sameSender && (sameDocument || (explicitBatch && !conflictingReference)));
};

// A combined announcement can contain several dated daily sections. Each section
// must provide its own spend/balance; never divide the top-up by time or proximity.
export const parseMarketReconciliations = (value) => {
  const text = String(value || '');
  const headings = [...text.matchAll(/ตลาด\s*\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/gi)];
  if (headings.length < 2) return [parseMarketReconciliation(text)].filter(Boolean);
  const combinedTopUp = [...text.matchAll(/โอนเพิ่ม\s*([0-9][0-9,]*(?:\.\d+)?)/g)].at(-1)?.[1];
  const rows = headings.map((heading, index) => parseMarketReconciliation(text.slice(heading.index, headings[index + 1]?.index ?? text.length))).filter(Boolean);
  const total = rows.every(row => row.balance != null) ? Math.round(rows.reduce((sum, row) => sum + (row.transferTotal || 0), 0) * 100) / 100 : null;
  return rows.map(row => ({ ...row, combined: true,
    // Without its own balance this section cannot inherit any combined top-up.
    transferTotal: row.balance != null ? row.transferTotal : null,
    typedTransferTotal: combinedTopUp ? Number(combinedTopUp.replaceAll(',', '')) : row.typedTransferTotal,
    combinedDailyTotal: total,
    combinedAllocationSupported: total != null && combinedTopUp != null && Math.abs(total - Number(combinedTopUp.replaceAll(',', ''))) < 0.01
  }));
};
