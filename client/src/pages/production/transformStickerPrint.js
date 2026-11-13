// พิมพ์สติกเกอร์แปรรูป (72×50 มม.; ออกแบบให้สแกนง่ายที่ 203 dpi) — แยกจาก ProductionTransform.jsx เพื่อทดสอบได้
import JsBarcode from 'jsbarcode';
import QRCodeGenerator from 'qrcode-generator';
import { bangkokDate } from '../../utils/salesReportDates.js';

export const formatThaiDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short'
  });
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

// วันผลิตต้องเป็นวันไทยเสมอ: เวลาจาก server เป็น UTC (เช่น 2026-11-12T23:30:00Z = 13 พ.ย. 06:30 น.)
// ถ้าตัดเอา 10 ตัวแรกของ ISO ตรง ๆ ของที่ทำก่อน 07:00 น. จะได้ล็อต/บาร์โค้ดเป็นวันก่อนหน้า
export const extractYmd = (value) => {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!text && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return bangkokDate(date);
};

// ===== รหัสสแกน =====
// เครื่องพิมพ์ฉลาก 203 dpi = 8 จุดต่อ มม. ขนาดแท่ง/ช่อง QR ต้องเป็นจำนวนจุดเต็ม ไม่งั้นแท่งหนาบางไม่เท่ากันและสแกนยาก
export const PRINTER_DOTS_PER_MM = 8;
const BARCODE_QUIET_MODULES = 10;

const normalizeScanText = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/[^A-Za-z0-9]/g, '')
  .toUpperCase();

// รหัสเดียวกันทั้งบาร์โค้ดและ QR, ไม่ซ้ำกันทุกดวง:
// id รายการรับเข้าจากการแปรรูป 8 หลัก + ลำดับดวง 4 หลัก (ต้องตรงกับ server/src/utils/transform-sticker-code.js)
// ตัวเลขล้วนจำนวนคู่ → CODE128 ชุด C (2 หลักต่อ 1 ตัว) บาร์โค้ดสั้น แท่งกว้างได้; QR เล็กสุด 21×21
export const encodeTransformStickerCode = (transactionId, sequence = 1) => {
  const id = Number(transactionId);
  const seq = Number(sequence);
  if (!Number.isInteger(id) || id <= 0 || id > 99_999_999) return null;
  if (!Number.isInteger(seq) || seq <= 0 || seq > 9_999) return null;
  return `${String(id).padStart(8, '0')}${String(seq).padStart(4, '0')}`;
};

export const buildScanId = (label = {}) => {
  const code = encodeTransformStickerCode(label?.transactionId, label?.sequence || 1);
  if (code) return code;
  // ไม่มี id รายการ (ไม่ควรเกิด): รหัสสินค้า + วันผลิต ใช้อ่านด้วยตาได้ แต่ค้นในหน้าเบิกไม่ได้
  const productCode = normalizeScanText(label?.productCode || label?.productId || '').slice(0, 8) || 'NA';
  const ymd = (extractYmd(label?.producedAt || label?.createdAt) || '').replace(/-/g, '').slice(2);
  return `${productCode}${ymd}`;
};

export const formatScanId = (scanId) => (/^\d+$/.test(scanId)
  ? String(scanId).replace(/(\d{4})(?=\d)/g, '$1 ')
  : String(scanId));

const dotsToMm = (dots) => Number((dots / PRINTER_DOTS_PER_MM).toFixed(3));

// วาด SVG เองจากรูปแบบแท่งของ JsBarcode (ไม่ต้องมี document) ความกว้างเป็น มม. ตามจำนวนจุดเต็ม
export const buildBarcodeSvg = (value, { maxWidthMm, heightMm, maxModuleDots = 4 } = {}) => {
  const target = {};
  JsBarcode(target, String(value), { format: 'CODE128' });
  const bits = target.encodings.map((encoding) => encoding.data).join('');
  const totalModules = bits.length + BARCODE_QUIET_MODULES * 2;
  const fitDots = Math.floor((maxWidthMm * PRINTER_DOTS_PER_MM) / totalModules);
  const moduleDots = Math.max(1, Math.min(maxModuleDots, fitDots));
  let rects = '';
  let index = 0;
  while (index < bits.length) {
    if (bits[index] === '1') {
      let end = index;
      while (end < bits.length && bits[end] === '1') end += 1;
      rects += `<rect x="${index + BARCODE_QUIET_MODULES}" y="0" width="${end - index}" height="1"/>`;
      index = end;
    } else {
      index += 1;
    }
  }
  const widthMm = dotsToMm(totalModules * moduleDots);
  return {
    moduleDots,
    widthMm,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} 1" preserveAspectRatio="none" style="width:${widthMm}mm;height:${heightMm}mm" shape-rendering="crispEdges"><rect x="0" y="0" width="${totalModules}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>`
  };
};

export const buildQrSvg = (value, { maxSizeMm } = {}) => {
  const text = String(value);
  const qr = QRCodeGenerator(0, 'M');
  qr.addData(text, /^\d+$/.test(text) ? 'Numeric' : 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const moduleDots = Math.max(1, Math.floor((maxSizeMm * PRINTER_DOTS_PER_MM) / count));
  let rects = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) rects += `<rect x="${col}" y="${row}" width="1" height="1"/>`;
    }
  }
  const sizeMm = dotsToMm(count * moduleDots);
  return {
    moduleCount: count,
    moduleDots,
    sizeMm,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" style="width:${sizeMm}mm;height:${sizeMm}mm" shape-rendering="crispEdges"><rect x="0" y="0" width="${count}" height="${count}" fill="#fff"/><g fill="#000">${rects}</g></svg>`
  };
};

export const getStickerCopies = (quantityValue) => {
  const qty = Number(quantityValue);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  // ถ้าเป็นจำนวนเต็ม ให้พิมพ์ตามจำนวนชุด เช่น 10 => 10 ดวง
  if (Math.abs(qty - Math.round(qty)) < 0.000001) return Math.max(1, Math.round(qty));
  // ถ้าไม่เต็มจำนวน ให้พิมพ์อย่างน้อย 1 ดวง
  return 1;
};

export const expandStickerLabels = (labels = []) => {
  const expanded = [];
  for (const label of (Array.isArray(labels) ? labels : [])) {
    const copies = Math.min(getStickerCopies(label?.quantityValue), 200);
    for (let i = 1; i <= copies; i += 1) {
      expanded.push({
        ...label,
        sequence: i,
        sequenceText: copies > 1 ? `${i}/${copies}` : ''
      });
    }
  }
  return expanded;
};

// หน้ากระดาษต่อขนาดสติกเกอร์; เนื้อหาเป็น มม. คงที่ เพื่อให้แท่งบาร์โค้ด/QR ตรงจุดเครื่องพิมพ์
// 72x50 = สติกเกอร์จริงของครัวกลาง (พ.ย. 2569) ออกจากเครื่องด้านกว้าง
// ขอบข้าง 4 มม.: พิมพ์จริงกับ LABEL 9X00 ภาพเลื่อนข้างหนึ่ง ~2 มม.
const STICKER_LAYOUTS = {
  '72x50': { pageWidthMm: 72, pageHeightMm: 50, padYMm: 2, padXMm: 4 },
  '3x2': { pageWidthMm: 76.2, pageHeightMm: 50.8, padYMm: 2.4, padXMm: 4 }
};

// ขนาดที่ปุ่มพิมพ์ในหน้าแปรรูปใช้
export const TRANSFORM_STICKER_LAYOUT = '72x50';
export const TRANSFORM_STICKER_LAYOUTS = Object.keys(STICKER_LAYOUTS);

const BARCODE_HEIGHT_MM = 11;
const QR_MAX_MM = 18.5;

export const buildTransformStickerHtml = (labels = [], options = {}) => {
  const layoutKey = STICKER_LAYOUTS[options?.layout] ? options.layout : TRANSFORM_STICKER_LAYOUT;
  const layout = STICKER_LAYOUTS[layoutKey];
  const pageWidth = `${layout.pageWidthMm}mm`;
  const pageHeight = `${layout.pageHeightMm}mm`;
  const contentWidthMm = layout.pageWidthMm - layout.padXMm * 2;
  const expandedLabels = expandStickerLabels(labels);
  const pages = expandedLabels
    .map((label, index) => {
      const producedDate = formatThaiDate(label?.producedAt || label?.createdAt || new Date().toISOString());
      const productUnit = String(label?.productUnit || '').trim();
      const productName = String(label?.productName || '-').trim();
      const productLine = productUnit ? `${productName} (${productUnit})` : productName;
      const scanId = buildScanId(label);
      const barcode = buildBarcodeSvg(scanId, { maxWidthMm: contentWidthMm, heightMm: BARCODE_HEIGHT_MM });
      const qr = buildQrSvg(scanId, { maxSizeMm: QR_MAX_MM });
      const qtyParts = [label?.quantityText, label?.sequenceText]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .map(escapeHtml);

      return `
      <section class="sticker${index < expandedLabels.length - 1 ? ' page-break' : ''}">
        <div class="product">${escapeHtml(productLine || '-')}</div>
        <div class="barcode">${barcode.svg}</div>
        <div class="scan-id" style="width:${barcode.widthMm}mm">${escapeHtml(formatScanId(scanId))}</div>
        <div class="bottom">
          <div class="info">
            <div class="date-label">วันที่ผลิต</div>
            <div class="date-value">${escapeHtml(producedDate)}</div>
            <div class="qty">${qtyParts.join(' · ') || '&nbsp;'}</div>
          </div>
          <div class="qr">${qr.svg}</div>
        </div>
      </section>
      `;
    })
    .join('');

  return `
<!doctype html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Transform Sticker</title>
  <style>
    @page {
      size: ${pageWidth} ${pageHeight};
      margin: 0;
    }
    @media print {
      html, body {
        width: ${pageWidth} !important;
        height: ${pageHeight} !important;
      }
      .sticker {
        width: ${pageWidth} !important;
        height: ${pageHeight} !important;
      }
    }
    html, body {
      width: ${pageWidth};
      margin: 0;
      padding: 0;
      font-family: Tahoma, "Noto Sans Thai", sans-serif;
      color: #000;
      background: #fff;
    }
    .sticker {
      box-sizing: border-box;
      width: ${pageWidth};
      height: ${pageHeight};
      padding: ${layout.padYMm}mm ${layout.padXMm}mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .page-break { page-break-after: always; break-after: page; }
    .product {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.15;
      max-height: 8.6mm;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .barcode {
      margin-top: 1mm;
      height: ${BARCODE_HEIGHT_MM}mm;
      line-height: 0;
    }
    .barcode svg, .qr svg { display: block; }
    .scan-id {
      text-align: center;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .bottom {
      margin-top: auto;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 3.5mm;
    }
    .info { min-width: 0; }
    .date-label { font-size: 9px; }
    .date-value { font-size: 18px; font-weight: 700; line-height: 1.1; }
    .qty { font-size: 12px; font-weight: 700; margin-top: 1mm; white-space: nowrap; }
    .qr { line-height: 0; }
    .print-toolbar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      gap: 8px;
      padding: 10px;
      background: #f1f5f9;
      border-top: 1px solid #cbd5e1;
    }
    .print-toolbar button {
      flex: 1;
      min-height: 44px;
      font: 600 16px Tahoma, "Noto Sans Thai", sans-serif;
      border: 1px solid #94a3b8;
      border-radius: 8px;
      background: #fff;
      color: #0f172a;
    }
    .print-toolbar button.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
    @media print { .print-toolbar { display: none !important; } }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <button type="button" class="primary" onclick="window.print()">พิมพ์</button>
    <button type="button" onclick="window.close()">ปิด</button>
  </div>
  ${pages || '<section class="sticker"><div class="product">ไม่มีข้อมูลพิมพ์</div></section>'}
</body>
</html>`;
};

export const shouldAutoClosePrintWindow = (win) => {
  const ua = String(win?.navigator?.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  // iPadOS รายงานตัวเองเป็น Mac แต่มีจอสัมผัส
  if (/Macintosh/i.test(ua) && Number(win?.navigator?.maxTouchPoints || 0) > 1) return false;
  try {
    if (win?.matchMedia?.('(pointer: coarse)')?.matches) return false;
  } catch {
    return false;
  }
  return true;
};

export const printTransformStickers = (labels, options = {}) => {
  const expanded = expandStickerLabels(labels);
  if (expanded.length === 0) {
    alert('ไม่มีข้อมูลพิมพ์');
    return;
  }
  const popup = window.open(
    '',
    '_blank',
    'width=920,height=920'
  );
  if (!popup) {
    alert('ไม่สามารถเปิดหน้าพิมพ์ได้');
    return;
  }
  popup.document.open();
  popup.document.write(buildTransformStickerHtml(labels, options));
  popup.document.close();
  popup.focus();
  // มือถือ/แท็บเล็ต: print() ไม่รอให้พิมพ์เสร็จ ถ้าปิดหน้าต่างทันทีงานพิมพ์จะหายหรือได้หน้าว่าง
  // จึงปิดเองเฉพาะคอมหลังหน้าต่างพิมพ์ปิด (afterprint) ส่วนมือถือให้ผู้ใช้กด "ปิด" เอง
  if (shouldAutoClosePrintWindow(window)) {
    popup.addEventListener('afterprint', () => {
      setTimeout(() => popup.close(), 300);
    });
  }
  setTimeout(() => {
    popup.print();
  }, 250);
};
