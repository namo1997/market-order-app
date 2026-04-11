import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import QRCodeGenerator from 'qrcode-generator';
import { Layout } from '../../components/layout/Layout';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { productsAPI } from '../../api/products';
import { inventoryAPI } from '../../api/inventory';
import { useAuth } from '../../contexts/AuthContext';

const isBaseIngredientRequired = (product) => {
  return Boolean(
    (Array.isArray(product?.required_ingredients) && product.required_ingredients.length > 0) ||
    (Array.isArray(product?.required_ingredient_product_ids) && product.required_ingredient_product_ids.length > 0) ||
    product?.requires_base_ingredient ||
    product?.requires_base_input ||
    product?.requires_ingredient_input ||
    product?.require_base_ingredient
  );
};

const todayString = new Date().toISOString().split('T')[0];

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

const formatThaiDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short'
  });
};

const formatQuantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const extractYmd = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const buildLotNo = (referenceId, producedAt) => {
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

const buildTracePayload = (label, lotNo) => {
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

const getStickerCopies = (quantityValue) => {
  const qty = Number(quantityValue);
  if (!Number.isFinite(qty) || qty <= 0) return 1;
  // ถ้าเป็นจำนวนเต็ม ให้พิมพ์ตามจำนวนชุด เช่น 10 => 10 ดวง
  if (Math.abs(qty - Math.round(qty)) < 0.000001) return Math.max(1, Math.round(qty));
  // ถ้าไม่เต็มจำนวน ให้พิมพ์อย่างน้อย 1 ดวง
  return 1;
};

const expandStickerLabels = (labels = []) => {
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

const buildTransformStickerHtml = (labels = [], options = {}) => {
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
  </style>
</head>
<body>
  ${pages || '<section class="sticker"><div class="header">ไม่มีข้อมูลพิมพ์</div></section>'}
</body>
</html>`;
};

const printTransformStickers = (labels, options = {}) => {
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
  setTimeout(() => {
    popup.print();
    popup.close();
  }, 250);
};

const extractTransformNote = (rawNote) => {
  const text = String(rawNote || '').trim();
  if (!text) return '';
  const match = text.match(/^แปรรูปสินค้า:\s*(?:รับเข้าแผนกทันที|ตัดวัตถุดิบ)(?:\s*\((.*)\))?$/);
  if (!match) return text;
  return String(match[1] || '').trim();
};

export const ProductionTransform = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [outputProducts, setOutputProducts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [outputSearch, setOutputSearch] = useState('');
  const [outputQuantities, setOutputQuantities] = useState({});
  const [ingredientUsageByOutput, setIngredientUsageByOutput] = useState({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState(null);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('create');
  const [transformDate, setTransformDate] = useState(todayString);
  const [historyDate, setHistoryDate] = useState(todayString);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [ingredientModal, setIngredientModal] = useState({
    isOpen: false,
    product: null,
    outputQuantity: '',
    ingredientQtyMap: {}
  });

  const departmentId = user?.department_id ? Number(user.department_id) : null;

  const loadData = async () => {
    if (!departmentId) return;
    try {
      setLoading(true);
      const [outputProductsRes, balanceRes, configRes] = await Promise.all([
        productsAPI.getProducts({ transformOutput: true }),
        inventoryAPI.getBalances({ departmentId }),
        inventoryAPI.getProductionTransformConfigs({ departmentId })
      ]);
      const outputProductData = outputProductsRes?.data ?? outputProductsRes ?? [];
      const balanceData = Array.isArray(balanceRes) ? balanceRes : [];
      const configMap = new Map(
        (configRes?.output_products || []).map((row) => [Number(row.product_id), row])
      );
      const mergedProducts = (Array.isArray(outputProductData) ? outputProductData : []).map((product) => {
        const config = configMap.get(Number(product.id));
        return {
          ...product,
          requires_base_ingredient: Boolean(config?.requires_base_ingredient),
          required_ingredient_product_ids: Array.isArray(config?.required_ingredient_product_ids)
            ? config.required_ingredient_product_ids
            : [],
          required_ingredients: Array.isArray(config?.required_ingredients)
            ? config.required_ingredients
            : []
        };
      });
      setOutputProducts(mergedProducts);
      setBalances(balanceData);
    } catch (error) {
      console.error('Error loading transform data:', error);
      alert('โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (targetDate = historyDate) => {
    if (!departmentId) return;
    try {
      setHistoryLoading(true);
      const data = await inventoryAPI.getProductionTransformHistory({
        departmentId,
        date: targetDate,
        limit: 100
      });
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading production history:', error);
      alert('โหลดประวัติการแปรรูปไม่สำเร็จ');
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSelectTab = (tabKey) => {
    setActiveTab(tabKey);
    if (tabKey === 'history') {
      setIsListModalOpen(false);
    }
  };

  const openEditHistory = (row) => {
    setEditingRow(row);
    setEditQuantity(Number(row?.quantity || 0) > 0 ? String(Number(row.quantity)) : '');
    setEditNotes(extractTransformNote(row?.notes));
  };

  const closeEditHistory = () => {
    setEditingRow(null);
    setEditQuantity('');
    setEditNotes('');
    setEditSaving(false);
  };

  const handleSaveHistoryEdit = async () => {
    if (!editingRow?.id) return;
    const quantity = Number(editQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      alert('จำนวนต้องมากกว่า 0');
      return;
    }

    try {
      setEditSaving(true);
      await inventoryAPI.updateProductionTransform(editingRow.id, {
        output_quantity: quantity,
        notes: editNotes
      });
      await Promise.all([loadHistory(historyDate), loadData()]);
      closeEditHistory();
    } catch (error) {
      console.error('Error updating production transform:', error);
      alert(error?.response?.data?.message || 'แก้ไขประวัติการแปรรูปไม่สำเร็จ');
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [departmentId]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory(historyDate);
    }
  }, [activeTab, historyDate]);

  const stockMap = useMemo(() => {
    const map = new Map();
    for (const row of balances) {
      map.set(Number(row.product_id), Number(row.quantity || 0));
    }
    return map;
  }, [balances]);

  const filteredOutputProducts = useMemo(() => {
    const keyword = String(outputSearch || '').trim().toLowerCase();
    if (!keyword) return outputProducts;
    return outputProducts.filter((product) =>
      String(product?.name || '').toLowerCase().includes(keyword) ||
      String(product?.code || '').toLowerCase().includes(keyword)
    );
  }, [outputProducts, outputSearch]);

  const selectedOutputItems = useMemo(() => {
    return outputProducts
      .map((product) => ({
        product_id: Number(product.id),
        product_name: product.name,
        product_unit: product.unit_abbr || product.unit_name || '',
        quantity: Number(outputQuantities[product.id] || 0),
        requires_base_ingredient: isBaseIngredientRequired(product),
        ingredients: (ingredientUsageByOutput[product.id]?.ingredients || []).map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity || 0)
        }))
      }))
      .filter((item) => Number.isFinite(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
  }, [outputProducts, outputQuantities, ingredientUsageByOutput]);

  const getOutputQty = (productId) => Number(outputQuantities[productId] || 0);

  const setOutputQty = (productId, value) => {
    const quantity = Number(value);
    setOutputQuantities((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(quantity) || quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = quantity;
      }
      return next;
    });
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setIngredientUsageByOutput((prev) => {
        if (!prev[productId]) return prev;
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  };

  const adjustOutputQty = (productId, delta) => {
    const current = getOutputQty(productId);
    const next = Math.max(0, current + delta);
    setOutputQty(productId, next);
  };

  const openIngredientModal = (productId) => {
    const product = outputProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    const requiredIngredients = Array.isArray(product.required_ingredients)
      ? product.required_ingredients
      : [];
    if (requiredIngredients.length === 0) {
      alert(`สินค้า "${product.name}" ถูกบังคับวัตถุดิบหลัก แต่ยังไม่ได้ตั้งค่าวัตถุดิบหลัก`);
      return;
    }

    const savedUsage = ingredientUsageByOutput[productId]?.ingredients || [];
    const savedMap = new Map(savedUsage.map((row) => [Number(row.product_id), Number(row.quantity || 0)]));
    const ingredientQtyMap = {};
    requiredIngredients.forEach((ingredient) => {
      const ingredientId = Number(ingredient.product_id);
      const saved = savedMap.get(ingredientId);
      ingredientQtyMap[ingredientId] = Number.isFinite(saved) && saved > 0 ? String(saved) : '';
    });

    setIngredientModal({
      isOpen: true,
      product,
      outputQuantity: getOutputQty(productId) > 0 ? String(getOutputQty(productId)) : '',
      ingredientQtyMap
    });
  };

  const handleIngredientModalSave = () => {
    const product = ingredientModal.product;
    if (!product) return;

    const outputQty = Number(ingredientModal.outputQuantity);
    if (!Number.isFinite(outputQty) || outputQty <= 0) {
      alert('กรุณากรอกจำนวนสินค้าที่แปรรูปออกมาให้มากกว่า 0');
      return;
    }

    const requiredIngredients = Array.isArray(product.required_ingredients)
      ? product.required_ingredients
      : [];
    const ingredientPayload = [];
    for (const ingredient of requiredIngredients) {
      const ingredientId = Number(ingredient.product_id);
      const qty = Number(ingredientModal.ingredientQtyMap?.[ingredientId]);
      if (!Number.isFinite(qty) || qty <= 0) {
        alert(`กรุณากรอกจำนวนวัตถุดิบหลัก "${ingredient.product_name}"`);
        return;
      }
      ingredientPayload.push({
        product_id: ingredientId,
        product_name: ingredient.product_name,
        quantity: qty,
        unit_name: ingredient.unit_name || '',
        unit_abbr: ingredient.unit_abbr || ''
      });
    }

    setOutputQty(product.id, outputQty);
    setIngredientUsageByOutput((prev) => ({
      ...prev,
      [product.id]: {
        ingredients: ingredientPayload
      }
    }));
    setIngredientModal({
      isOpen: false,
      product: null,
      outputQuantity: '',
      ingredientQtyMap: {}
    });
  };

  const handleCardClick = (productId) => {
    const product = outputProducts.find((item) => Number(item.id) === Number(productId));
    if (!product) return;
    if (isBaseIngredientRequired(product)) {
      openIngredientModal(productId);
      return;
    }
    adjustOutputQty(productId, 1);
  };

  const handleSubmit = async () => {
    if (!departmentId) {
      alert('ไม่พบแผนกผู้ใช้งาน');
      return;
    }

    if (!transformDate) {
      alert('กรุณาเลือกวันที่แปรรูป');
      return;
    }

    if (selectedOutputItems.length === 0) {
      alert('กรุณากรอกจำนวนในการ์ดสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    const missingBaseIngredientItem = selectedOutputItems.find(
      (item) => item.requires_base_ingredient && (!Array.isArray(item.ingredients) || item.ingredients.length === 0)
    );
    if (missingBaseIngredientItem) {
      alert(`สินค้า "${missingBaseIngredientItem.product_name}" ยังไม่ได้กรอกจำนวนวัตถุดิบหลัก`);
      return;
    }

    setSaving(true);
    try {
      const results = [];
      for (const item of selectedOutputItems) {
        const response = await inventoryAPI.createProductionTransform({
          transform_date: transformDate,
          department_id: departmentId,
          output_product_id: item.product_id,
          output_quantity: item.quantity,
          ingredients: item.ingredients || [],
          notes: notes ? String(notes).trim() : ''
        });
        results.push(response?.data || null);
      }

      const insufficientLines = results.flatMap((result) => {
        const rows = Array.isArray(result?.insufficient_ingredients)
          ? result.insufficient_ingredients
          : [];
        return rows.map((row) => {
          const productName = String(row?.product_name || '-');
          const shortageQty = Number(row?.shortage_quantity || 0);
          return `- ${productName} ขาด ${shortageQty}`;
        });
      });

      const selectedUnitByProductId = new Map(
        selectedOutputItems.map((item) => [Number(item.product_id), item.product_unit || ''])
      );

      setSummary({
        transform_date: transformDate,
        printed_at: new Date().toISOString(),
        total_items: results.length,
        total_quantity: selectedOutputItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        items: results
          .map((result) => ({
            reference_id: result?.reference_id || '-',
            product_id: result?.output?.product_id || null,
            product_code: result?.output?.product_code || '',
            product_name: result?.output?.product_name || '-',
            product_unit: selectedUnitByProductId.get(Number(result?.output?.product_id)) || '',
            quantity: Number(result?.output?.quantity || 0)
          }))
      });

      setOutputQuantities({});
      setIngredientUsageByOutput({});
      setNotes('');
      setIsListModalOpen(false);
      await loadData();

      if (insufficientLines.length > 0) {
        alert(
          `บันทึกสำเร็จ แต่มีวัตถุดิบไม่พอ ระบบตัดติดลบให้แล้ว:\n${insufficientLines.join('\n')}`
        );
      }
    } catch (error) {
      console.error('Error creating production transform:', error);
      alert(error?.response?.data?.message || 'บันทึกการแปรรูปไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← กลับหน้าเลือกฟังก์ชั่น
          </button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h1 className="text-xl font-bold text-gray-900">แปรรูปสินค้า</h1>
          <p className="text-sm text-gray-600">
            เพิ่มสินค้าปลายทางเข้าระบบ
          </p>
          <p className="text-xs text-gray-500 mt-1">
            กรอกจำนวนบนการ์ดสินค้าได้เลย
          </p>
          <p className="text-xs text-emerald-700 mt-1">
            หลังบันทึกจะรับสินค้าเข้าแผนกนี้ทันที
          </p>
          <p className="text-xs text-gray-500 mt-1">
            แผนก: {user?.department || '-'} • สาขา: {user?.branch || '-'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSelectTab('create')}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeTab === 'create'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-gray-700 hover:bg-slate-100'
              }`}
            >
              สร้างการแปรรูป
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('history')}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-50 text-gray-700 hover:bg-slate-100'
              }`}
            >
              ประวัติการแปรรูป
            </button>
          </div>
        </div>

        {activeTab === 'create' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">วันที่แปรรูป</label>
            <input
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={transformDate}
              onChange={(event) => setTransformDate(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700">
                สินค้าปลายทาง (ได้จากการแปรรูป)
              </label>
              {selectedOutputItems.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => {
                    setOutputQuantities({});
                    setIngredientUsageByOutput({});
                  }}
                  disabled={saving}
                >
                  ล้างจำนวนทั้งหมด
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="ค้นหาสินค้าปลายทาง"
                value={outputSearch}
                onChange={(event) => setOutputSearch(event.target.value)}
                disabled={loading || saving}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setOutputSearch((prev) => String(prev || '').trim())}
                disabled={loading || saving}
              >
                ค้นหา
              </button>
            </div>

            {filteredOutputProducts.length === 0 ? (
              <div className="text-xs text-gray-500 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                ไม่พบสินค้าปลายทางที่ค้นหา
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {filteredOutputProducts.slice(0, 120).map((product) => {
                  const qty = getOutputQty(product.id);
                  const isSelected = qty > 0;
                  const requiresBaseIngredient = isBaseIngredientRequired(product);
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleCardClick(product.id)}
                      className={`text-left rounded-lg border px-3 py-2 transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 cursor-pointer'
                          : 'border-gray-200 bg-white hover:border-blue-300 cursor-pointer'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1 truncate">
                        {product.code || '-'}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        คงเหลือ {stockMap.get(Number(product.id)) ?? 0}
                      </p>
                      {requiresBaseIngredient && (
                        <p className="text-[10px] mt-1 text-amber-700 font-medium">
                          วัตถุดิบหลัก: {Array.isArray(product.required_ingredients) && product.required_ingredients.length > 0
                            ? product.required_ingredients.map((item) => item.product_name).join(', ')
                            : 'ยังไม่ได้ตั้งค่า'}
                        </p>
                      )}
                      {!requiresBaseIngredient ? (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            value={qty || ''}
                            onChange={(event) => setOutputQty(product.id, event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            disabled={saving}
                            placeholder="จำนวน"
                          />
                          <span className="text-[11px] text-gray-500 shrink-0">
                            {product.unit_abbr || product.unit_name || ''}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            openIngredientModal(product.id);
                          }}
                          disabled={saving}
                        >
                          {qty > 0
                            ? `แก้ไขวัตถุดิบและจำนวน (${qty} ${product.unit_abbr || product.unit_name || ''})`
                            : 'กรอกวัตถุดิบหลักและจำนวนแปรรูป'}
                        </button>
                      )}
                      {requiresBaseIngredient && (
                        <p className="mt-1 text-[10px] text-amber-700">
                          กดการ์ดเพื่อใส่จำนวนวัตถุดิบหลักและจำนวนสินค้าที่แปรรูป
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {outputProducts.length === 0 && (
            <div className="text-xs text-amber-700 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              แผนกนี้ยังไม่มีพื้นที่จัดเก็บสินค้าที่ผูกไว้สำหรับสินค้าปลายทาง
            </div>
          )}
          <div className="text-xs text-gray-600 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            สินค้าที่ตั้งค่า "บังคับวัตถุดิบหลัก" จะตัดวัตถุดิบออกจากคลังอัตโนมัติเมื่อบันทึกการแปรรูป
          </div>

          <Input
            label="หมายเหตุ"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="เช่น แปรรูปสำหรับรอบเช้า"
            disabled={saving}
          />
          </div>
        )}

        {activeTab === 'create' && summary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-semibold">บันทึกเรียบร้อย</div>
            <div>วันที่แปรรูป {summary.transform_date || '-'}</div>
          <div>รวม {summary.total_items} รายการ • จำนวนรวม {summary.total_quantity}</div>
          <div>
            {Array.isArray(summary.items) && summary.items.length > 0
              ? summary.items.slice(0, 3).map((item) => `${item.product_name} +${item.quantity}`).join(' | ')
              : '-'}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              onClick={() =>
                printTransformStickers(
                  (summary.items || []).map((item) => ({
                    productName: item.product_name,
                    productUnit: item.product_unit || '',
                    productCode: item.product_code || item.product_id || '',
                    productId: item.product_id || '',
                    producedAt: summary.transform_date || summary.printed_at,
                    referenceId: item.reference_id,
                    branchName: user?.branch || '-',
                    departmentName: user?.department || '-',
                    quantityText: `+${Number(item.quantity || 0)}`,
                    quantityValue: Number(item.quantity || 0)
                  })),
                  { layout: '3x2' }
                )
              }
            >
              พิมพ์สติกเกอร์ 3x2 นิ้ว
            </button>
          </div>
        </div>
      )}

        {activeTab === 'history' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">วันที่</label>
                <input
                  type="date"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={historyDate}
                  onChange={(event) => setHistoryDate(event.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => loadHistory(historyDate)}
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                disabled={historyLoading}
              >
                {historyLoading ? 'กำลังโหลด...' : 'รีเฟรช'}
              </button>
            </div>

            {historyLoading ? (
              <div className="text-sm text-gray-500">กำลังโหลดประวัติ...</div>
            ) : historyRows.length === 0 ? (
              <div className="text-sm text-gray-500">ยังไม่มีประวัติการแปรรูปในวันที่เลือก</div>
            ) : (
              <div className="space-y-2">
                {historyRows.map((row) => (
                  <div key={`${row.id}_${row.reference_id}`} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{row.product_name}</p>
                        <p className="text-xs text-gray-500">{row.product_code || '-'}</p>
                        {row.notes && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{row.notes}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-emerald-700">
                          +{Number(row.quantity || 0)} {row.unit_abbr || row.unit_name || ''}
                        </p>
                        <p className="text-xs text-gray-500">{formatDateTime(row.effective_at || row.created_at)}</p>
                        <button
                          type="button"
                          onClick={() => openEditHistory(row)}
                          className="mt-1 text-xs text-blue-600 hover:text-blue-700"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            printTransformStickers([{
                              productName: row.product_name,
                              productUnit: row.unit_abbr || row.unit_name || '',
                              productCode: row.product_code || row.product_id || '',
                              productId: row.product_id || '',
                              producedAt: row.effective_at || row.created_at,
                              referenceId: row.reference_id,
                              branchName: row.branch_name,
                              departmentName: row.department_name,
                              quantityText: `+${Number(row.quantity || 0)} ${row.unit_abbr || row.unit_name || ''}`.trim(),
                              quantityValue: Number(row.quantity || 0)
                            }], { layout: '3x2' })
                          }
                          className="ml-2 mt-1 text-xs text-emerald-700 hover:text-emerald-800"
                        >
                          พิมพ์ 3x2 นิ้ว
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-2">
                      <span>{row.branch_name} / {row.department_name}</span>
                      <span>อ้างอิง: {row.reference_id || '-'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'create' && selectedOutputItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:right-8 md:w-[360px]">
          <button
            type="button"
            onClick={() => setIsListModalOpen(true)}
            className="w-full rounded-2xl bg-green-600 text-white shadow-lg px-4 py-3 flex items-center justify-between"
          >
            <div className="text-left">
              <p className="font-semibold">รายการสินค้า ({selectedOutputItems.length})</p>
              <p className="text-xs text-green-100">วันที่แปรรูป {transformDate || '-'} • กดเพื่อบันทึก</p>
            </div>
            <span className="text-sm font-semibold">เปิด</span>
          </button>
        </div>
      )}

      <Modal
        isOpen={activeTab === 'create' && isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        title={`รายการสินค้า (${selectedOutputItems.length}) • วันที่ ${transformDate || '-'}`}
        size="large"
      >
        {selectedOutputItems.length === 0 ? (
          <div className="text-center text-gray-500 py-6">ยังไม่มีรายการ</div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
              {selectedOutputItems.map((item) => {
                const product = outputProducts.find((row) => Number(row.id) === Number(item.product_id));
                const ingredientSummaryRows = ingredientUsageByOutput[item.product_id]?.ingredients || [];
                const outputUnit = product?.unit_abbr || product?.unit_name || '-';
                return (
                  <div key={item.product_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {item.product_name}
                          <span className="ml-1 text-xs font-medium text-gray-500">({outputUnit})</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.requires_base_ingredient && (
                          <p className="font-semibold text-gray-900 whitespace-nowrap">
                            ผลิต {formatQuantity(item.quantity)} {outputUnit}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => setOutputQty(item.product_id, 0)}
                          className="text-rose-600 text-sm font-semibold hover:underline"
                          disabled={saving}
                        >
                          ลบ
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      {!item.requires_base_ingredient ? (
                        <>
                          <button
                            type="button"
                            onClick={() => adjustOutputQty(item.product_id, -1)}
                            className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200"
                            disabled={saving}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                            value={getOutputQty(item.product_id) || ''}
                            onChange={(event) => setOutputQty(item.product_id, event.target.value)}
                            disabled={saving}
                          />
                          <button
                            type="button"
                            onClick={() => adjustOutputQty(item.product_id, 1)}
                            className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold hover:bg-blue-100"
                            disabled={saving}
                          >
                            +
                          </button>
                          <span className="text-xs text-gray-500 shrink-0">
                            {product?.unit_abbr || product?.unit_name || ''}
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openIngredientModal(item.product_id)}
                          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-800 hover:bg-amber-100"
                          disabled={saving}
                        >
                          แก้ไขวัตถุดิบหลักและจำนวน
                        </button>
                      )}
                    </div>

                    {item.requires_base_ingredient && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                        {ingredientSummaryRows.length > 0 ? (
                          <div className="space-y-1">
                            {ingredientSummaryRows.map((ingredient, index) => (
                              <div
                                key={`${item.product_id}-${ingredient.product_id}`}
                                className="flex items-center justify-between gap-2 text-[13px] text-amber-900"
                              >
                                <span className="truncate">
                                  {index === 0 ? 'วัตถุดิบ: ' : ''}
                                  {ingredient.product_name || ingredient.product_id}
                                </span>
                                <span className="font-semibold whitespace-nowrap">
                                  {formatQuantity(ingredient.quantity)} {ingredient.unit_abbr || ingredient.unit_name || '-'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-rose-700">ยังไม่ได้กรอกวัตถุดิบหลัก</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsListModalOpen(false)}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                disabled={saving}
              >
                เลือกสินค้าต่อ
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loading || selectedOutputItems.length === 0}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {saving ? 'กำลังบันทึก...' : `บันทึกการแปรรูป (${selectedOutputItems.length})`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(editingRow)}
        onClose={closeEditHistory}
        title="แก้ไขประวัติการแปรรูป"
        size="medium"
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-gray-900">{editingRow?.product_name || '-'}</div>
            <div className="text-xs text-gray-600">{editingRow?.product_code || '-'}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนที่ผลิต</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={editQuantity}
              onChange={(event) => setEditQuantity(event.target.value)}
              disabled={editSaving}
            />
          </div>
          <Input
            label="หมายเหตุ"
            value={editNotes}
            onChange={(event) => setEditNotes(event.target.value)}
            placeholder="ระบุหมายเหตุ (ถ้ามี)"
            disabled={editSaving}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeEditHistory}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              disabled={editSaving}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSaveHistoryEdit}
              className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              disabled={editSaving}
            >
              {editSaving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(ingredientModal.isOpen && ingredientModal.product)}
        onClose={() =>
          setIngredientModal({ isOpen: false, product: null, outputQuantity: '', ingredientQtyMap: {} })}
        title={ingredientModal.product ? `ตั้งค่าการแปรรูป: ${ingredientModal.product.name}` : 'ตั้งค่าการแปรรูป'}
        size="medium"
      >
        {ingredientModal.product && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนสินค้าที่แปรรูปออกมา</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={ingredientModal.outputQuantity}
                onChange={(event) =>
                  setIngredientModal((prev) => ({ ...prev, outputQuantity: event.target.value }))}
              />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">วัตถุดิบหลักที่ต้องใช้</p>
              {(ingredientModal.product.required_ingredients || []).map((ingredient) => {
                const ingredientId = Number(ingredient.product_id);
                return (
                  <div key={ingredientId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                    <div className="text-sm text-gray-800">
                      {ingredient.product_name}
                      <span className="text-xs text-gray-500 ml-1">
                        {ingredient.unit_abbr || ingredient.unit_name || ''}
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={ingredientModal.ingredientQtyMap?.[ingredientId] || ''}
                      onChange={(event) =>
                        setIngredientModal((prev) => ({
                          ...prev,
                          ingredientQtyMap: {
                            ...(prev.ingredientQtyMap || {}),
                            [ingredientId]: event.target.value
                          }
                        }))}
                      placeholder="จำนวนที่ใช้"
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() =>
                  setIngredientModal({
                    isOpen: false,
                    product: null,
                    outputQuantity: '',
                    ingredientQtyMap: {}
                  })}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleIngredientModalSave}
              >
                บันทึกข้อมูลสินค้า
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};
