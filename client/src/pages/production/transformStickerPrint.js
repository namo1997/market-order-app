// พิมพ์สติกเกอร์แปรรูป (3x2 นิ้ว / 80x80 มม.) — แยกจาก ProductionTransform.jsx เพื่อทดสอบได้
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

export const buildLotNo = (referenceId, producedAt) => {
  const ymd = (extractYmd(producedAt) || '').replace(/-/g, '') || '00000000';
  const cleanedRef = String(referenceId || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const refSuffix = cleanedRef ? cleanedRef.slice(-6) : String(Date.now()).slice(-6);
  return `LOT${ymd}-${refSuffix}`;
};

const normalizeScanText = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, '')
  .replace(/[^A-Za-z0-9_-]/g, '')
  .toUpperCase();

export const buildTracePayload = (label, lotNo) => {
  const producedYmd = extractYmd(label?.producedAt || label?.createdAt || new Date().toISOString()) || '0000-00-00';
  const producedCompact = producedYmd.replace(/-/g, '');
  const producedShort = producedCompact.slice(-6);
  const productCode = normalizeScanText(label?.productCode || label?.productId || 'UNKNOWN').slice(0, 8) || 'UNKNOWN';
  const referenceId = normalizeScanText(label?.referenceId || '').slice(-6);
  const lotSuffix = normalizeScanText(lotNo).slice(-6) || referenceId || '000000';
  const lotShort = `${producedShort}-${lotSuffix}`;

  // ลดความยาวบาร์โค้ดให้สแกนง่ายบนสติกเกอร์ 80x80
  // รูปแบบ: {PRODUCT_CODE}-{YYMMDD}-{LOT_SUFFIX}
  const barcodeValue = `${productCode}-${producedShort}-${lotSuffix}`;

  // QR เก็บข้อมูลครบ แต่ใช้รูปแบบสั้นเพื่อลดความหนาแน่น
  const qrPayload = `SOLAO|T|PC:${productCode}|D:${producedYmd}|LOT:${lotShort}|R:${referenceId || 'NA'}`;

  return {
    barcodeValue,
    qrValue: qrPayload
  };
};

const buildBarcodeSvg = (value) => {
  try {
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svgNode, String(value || '').trim() || 'SOLAO|UNKNOWN', {
      format: 'CODE128',
      displayValue: false,
      margin: 10,
      width: 2,
      height: 56,
      background: '#ffffff'
    });
    return svgNode.outerHTML;
  } catch (error) {
    console.error('Failed to build barcode svg', error);
    return '<svg viewBox="0 0 120 30" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="120" height="30" fill="#fff" stroke="#000"/></svg>';
  }
};

const buildQrSvg = (value) => {
  try {
    const qr = QRCodeGenerator(0, 'L');
    qr.addData(String(value || ''));
    qr.make();
    return qr.createSvgTag(2, 2);
  } catch (error) {
    console.error('Failed to build qr svg', error);
    return '<svg viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="42" height="42" fill="#fff" stroke="#000"/></svg>';
  }
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
        sequenceText: copies > 1 ? `${i}/${copies}` : ''
      });
    }
  }
  return expanded;
};

const STICKER_LAYOUTS = {
  '80x80': {
    pageWidth: '80mm',
    pageHeight: '80mm',
    padding: '3.5mm',
    gap: '1.6mm',
    productFont: '23px',
    productMinHeight: '24mm',
    productMaxHeight: '30mm',
    productLineClamp: 3,
    barcodeHeight: '12.5mm',
    dateLabelFont: '11px',
    dateValueFont: '21px',
    footerFont: '13px',
    footerMinHeight: '6mm',
    codeTextFont: '8px',
    dateQrSize: '16mm',
    lotFont: '9px',
    bottomRowGap: '2mm'
  },
  '3x2': {
    pageWidth: '3in',
    pageHeight: '2in',
    padding: '2.4mm',
    gap: '1.1mm',
    productFont: '15px',
    productMinHeight: '11mm',
    productMaxHeight: '14mm',
    productLineClamp: 2,
    barcodeHeight: '7.5mm',
    dateLabelFont: '9px',
    dateValueFont: '14px',
    footerFont: '10px',
    footerMinHeight: '4.5mm',
    codeTextFont: '6.5px',
    dateQrSize: '11.5mm',
    lotFont: '7.5px',
    bottomRowGap: '1.2mm'
  }
};

export const buildTransformStickerHtml = (labels = [], options = {}) => {
  const layoutKey = options?.layout === '80x80' ? '80x80' : '3x2';
  const layout = STICKER_LAYOUTS[layoutKey];
  const pageWidth = layout.pageWidth;
  const pageHeight = layout.pageHeight;
  const pageOrientation = layoutKey === '3x2' ? 'landscape' : 'portrait';
  const contentScale = 0.98;
  const useLandscapeFallback = Boolean(options?.landscapeFallback);
  const expandedLabels = expandStickerLabels(labels);
  const pages = expandedLabels
    .map((label, index) => {
      const lotNo = buildLotNo(label?.referenceId, label?.producedAt);
      const producedDate = formatThaiDate(label?.producedAt || label?.createdAt || new Date().toISOString());
      const productUnit = String(label?.productUnit || '').trim();
      const productLine = productUnit
        ? `${String(label?.productName || '-').trim()} (${productUnit})`
        : String(label?.productName || '-').trim();
      const { barcodeValue, qrValue } = buildTracePayload(label, lotNo);
      const barcodeSvg = buildBarcodeSvg(barcodeValue);
      const qrSvg = buildQrSvg(qrValue);
      const quantityText = label?.quantityText
        ? `<span>${escapeHtml(label.quantityText)}</span>`
        : '';
      const sequenceText = label?.sequenceText
        ? `<span>${escapeHtml(label.sequenceText)}</span>`
        : '';
      const footerParts = [quantityText, sequenceText].filter(Boolean).join('<span class="sep">•</span>');

      return `
      <section class="sticker ${index < expandedLabels.length - 1 ? 'page-break' : ''}">
        <div class="sticker-inner">
          <div class="sticker-content">
            <div class="product">${escapeHtml(productLine || '-')}</div>
            <div class="barcode-mid">
              ${barcodeSvg}
              <div class="code-text">${escapeHtml(barcodeValue)}</div>
            </div>
            <div class="date-block">
              <div class="date-info">
                <div class="date-label">วันที่ผลิต</div>
                <div class="date-value">${escapeHtml(producedDate)}</div>
              </div>
              <div class="date-qr">
                ${qrSvg}
              </div>
            </div>
            <div class="footer">
              ${footerParts || '<span>&nbsp;</span>'}
            </div>
            <div class="bottom-row">
              <div class="lot">ล็อต ${escapeHtml(lotNo)}</div>
            </div>
          </div>
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
      size: ${pageWidth} ${pageHeight} !important;
      size: ${pageWidth} ${pageHeight} ${pageOrientation} !important;
      margin: 0 !important;
    }
    @media print {
      @page {
        size: ${pageWidth} ${pageHeight} !important;
        size: ${pageWidth} ${pageHeight} ${pageOrientation} !important;
        margin: 0 !important;
      }
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
      height: ${pageHeight};
      margin: 0;
      padding: 0;
      font-family: Tahoma, "Noto Sans Thai", sans-serif;
      color: #000;
    }
    .sticker {
      box-sizing: border-box;
      width: ${pageWidth};
      height: ${pageHeight};
      padding: ${layout.padding};
      position: relative;
      overflow: hidden;
    }
    .sticker-inner {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .sticker-content {
      display: flex;
      flex-direction: column;
      gap: ${layout.gap};
      width: 100%;
      height: 100%;
      transform: scale(${contentScale});
      transform-origin: top left;
    }
    .page-break { page-break-after: always; }
    .product {
      font-size: ${layout.productFont};
      font-weight: 700;
      line-height: 1.12;
      min-height: ${layout.productMinHeight};
      max-height: ${layout.productMaxHeight};
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: ${layout.productLineClamp};
      -webkit-box-orient: vertical;
    }
    .barcode-mid {
      display: flex;
      flex-direction: column;
      gap: 0.6mm;
    }
    .barcode-mid svg {
      width: 100%;
      height: ${layout.barcodeHeight};
      border: 1px solid #111;
      box-sizing: border-box;
    }
    .date-block {
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 2mm 0;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 1.4mm;
    }
    .date-info {
      min-width: 0;
    }
    .date-label {
      font-size: ${layout.dateLabelFont};
      color: #222;
      margin-bottom: 0.8mm;
    }
    .date-value {
      font-size: ${layout.dateValueFont};
      font-weight: 700;
      line-height: 1.05;
    }
    .footer {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 1mm;
      font-size: ${layout.footerFont};
      font-weight: 600;
      min-height: ${layout.footerMinHeight};
    }
    .sep { color: #666; }
    .code-text {
      font-size: ${layout.codeTextFont};
      line-height: 1;
      letter-spacing: 0.1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bottom-row {
      margin-top: auto;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: ${layout.bottomRowGap};
    }
    .date-qr {
      width: ${layout.dateQrSize};
      height: ${layout.dateQrSize};
      border: 1px solid #111;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.6mm;
      background: #fff;
    }
    .date-qr svg {
      width: 100%;
      height: 100%;
      display: block;
      shape-rendering: crispEdges;
    }
    .lot {
      font-size: ${layout.lotFont};
      color: #333;
      letter-spacing: 0.2px;
      line-height: 1.15;
    }
    ${useLandscapeFallback ? `
    @media print {
      .sticker-content {
        position: absolute;
        top: 0;
        left: ${pageWidth};
        width: ${pageHeight};
        height: ${pageWidth};
        transform-origin: top left;
        transform: rotate(90deg) scale(${contentScale});
      }
    }` : ''}
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
  ${pages || '<section class="sticker"><div class="header">ไม่มีข้อมูลพิมพ์</div></section>'}
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
