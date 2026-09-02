import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Bot,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Coins,
  CreditCard,
  Download,
  FileText,
  FileSpreadsheet,
  Landmark,
  Lock,
  LogOut,
  Minus,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sunrise,
  UtensilsCrossed,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AUTH_EXPIRED_EVENT, api, clearAuthSession, hasAuthToken, setAuthToken } from './api.js';
import { cashierPosWarningRequired, shouldAutoSyncCashierReceipt, thailandBusinessDate } from './cashierReceiptSync.js';
import { dashboardFiltersEqual, receiptMatchesDashboardFilters } from './dashboardReceipt.js';
import { addToPrintBudget, createPrintBudget, PRINT_LIMITS, selectReceiptEvidenceEntries } from './printEvidence.js';
import { buildLineEvidenceReconciliation, buildLineSettlementAmounts, buildReconciliationSummary, roundCurrency } from './reconciliationSummary.js';
import { groupCalendarReceipts, receiptCalendarMonthlyVariance, receiptCalendarRefreshKey, receiptDateState } from './receiptCalendar.js';
import { ClosedReceiptSummary, PostCloseAdjustmentEditor, PostCloseAdjustmentHistory, PostCloseAdjustmentPrintPages } from './PostCloseAdjustments.jsx';
import { effectiveLineAdjustment } from './postCloseAdjustmentAmounts.js';
import { EVIDENCE_PENDING_LABEL, isManualReviewAwaitingEvidence } from './evidenceReviewStatus.js';
import { focusEvidenceHtml } from './evidenceFocus.js';

const today = () => thailandBusinessDate();
const isDecisionCancelled = (error) => error?.code === 'decision_cancelled';

const isCashierLaunchRequested = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('cashier') === '1';
};

const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services';

const loadGoogleIdentityServices = () => {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

  return new Promise((resolve, reject) => {
    let script = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
    const handleLoad = () => resolve(window.google);
    const handleError = () => reject(new Error('โหลด Google Sign-In ไม่สำเร็จ'));

    if (!script) {
      script = document.createElement('script');
      script.id = GOOGLE_IDENTITY_SCRIPT_ID;
      script.src = 'https://accounts.google.com/gsi/client?hl=th';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
  });
};

const money = (value) =>
  Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const normalizeMoneyInput = (value) => {
  const stripped = String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!stripped) return '';

  const [rawInteger = '', ...rawDecimals] = stripped.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  if (rawDecimals.length === 0) return integer;

  return `${integer || '0'}.${rawDecimals.join('').slice(0, 2)}`;
};

const formatMoneyInput = (value) => {
  const raw = String(value ?? '');
  if (!raw) return '';
  if (/^0+(?:\.0{1,2})?$/.test(raw.replace(/,/g, '').trim())) return '';

  const [integer = '', decimals = ''] = raw.split('.');
  const groupedInteger = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return raw.includes('.') ? `${groupedInteger}.${decimals}` : groupedInteger;
};

const normalizeSignedMoneyInput = (value) => {
  const raw = String(value ?? '').trim();
  const negative = raw.startsWith('-');
  const normalized = normalizeMoneyInput(raw.replace(/^[+-]/, ''));
  if (!normalized) return negative ? '-' : '';
  return `${negative ? '-' : ''}${normalized}`;
};

const formatSignedMoneyInput = (value) => {
  const raw = String(value ?? '');
  if (raw === '-') return raw;
  const negative = raw.startsWith('-');
  const formatted = formatMoneyInput(raw.replace(/^-/, ''));
  return formatted ? `${negative ? '-' : ''}${formatted}` : '';
};

const roundMoneyInput = (value) => String(Math.round((Number(value) || 0) * 100) / 100);

const ALLOWED_NUMERIC_CONTROL_KEYS = new Set([
  'Backspace',
  'Delete',
  'Tab',
  'Enter',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End'
]);

const blockNonNumericKey = (event, { decimal = true } = {}) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (ALLOWED_NUMERIC_CONTROL_KEYS.has(event.key)) return;
  if (/^\d$/.test(event.key)) return;
  if (decimal && event.key === '.' && !event.currentTarget.value.includes('.')) return;

  event.preventDefault();
};

const handleNumericPaste = (event, { decimal = true, onValue }) => {
  event.preventDefault();
  const input = event.currentTarget;
  const pasted = event.clipboardData.getData('text');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const nextValue = `${input.value.slice(0, start)}${pasted}${input.value.slice(end)}`;
  const normalized = decimal ? normalizeMoneyInput(nextValue) : nextValue.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  onValue(normalized);
};

const clearZeroMoneyOnFocus = (event, onValue) => {
  const normalized = normalizeMoneyInput(event.currentTarget.value);
  if (normalized && Number(normalized) === 0) {
    onValue('');
    return;
  }
  event.currentTarget.select();
};

const focusNextMoneyInput = (currentInput) => {
  const scope = currentInput.closest('.cashier-app') || document;
  const inputs = Array.from(scope.querySelectorAll('input[data-money-input="true"]'))
    .filter((input) => !input.disabled && input.offsetParent !== null);
  const index = inputs.indexOf(currentInput);
  const nextInput = inputs[index + 1];
  if (!nextInput) return;

  nextInput.scrollIntoView({ block: 'center', inline: 'nearest' });
  nextInput.focus();
  nextInput.select();
};

const handleMoneyKeyDown = (event, { onValue }) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!normalizeMoneyInput(event.currentTarget.value)) {
      onValue('0');
    }
    requestAnimationFrame(() => focusNextMoneyInput(event.currentTarget));
    return;
  }

  blockNonNumericKey(event);
};

const handleSignedMoneyKeyDown = (event, { onValue }) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!Number.isFinite(Number(normalizeSignedMoneyInput(event.currentTarget.value)))) onValue('0');
    requestAnimationFrame(() => focusNextMoneyInput(event.currentTarget));
    return;
  }
  if (event.key === '-' && event.currentTarget.selectionStart === 0 && !event.currentTarget.value.startsWith('-')) return;
  blockNonNumericKey(event);
};

const handleSignedMoneyPaste = (event, onValue) => {
  event.preventDefault();
  onValue(normalizeSignedMoneyInput(event.clipboardData.getData('text')));
};

const moneyValuesEqual = (left, right) =>
  Math.round((Number(left || 0) + Number.EPSILON) * 100) ===
  Math.round((Number(right || 0) + Number.EPSILON) * 100);

const expectedIncomingAmount = (line) => {
  return buildLineSettlementAmounts({
    channelCode: line.channel_code,
    cashierAmount: line.cashier_amount,
    expectedGrossAmount: line.expected_gross_amount,
    feeAmount: line.fee_amount,
    expectedNetAmount: line.expected_net_amount,
    statementAmount: line.statement_amount,
    matchedAmount: line.matched_amount,
    evidenceAttachmentId: line.evidence_attachment_id,
    settlementSource: line.settlement_source
  }).net;
};

const signedDeduction = (value) => {
  const amount = Number(value || 0);
  if (amount > 0) return `-${money(amount)}`;
  if (amount < 0) return `+${money(Math.abs(amount))}`;
  return money(0);
};

const UNSAVED_CASHIER_MESSAGE = 'มีข้อมูลที่กรอกไว้แต่ยังไม่ได้กดส่งยอด ต้องการออกจากหน้านี้หรือไม่?';
const UNSAVED_REVIEW_NOTE_MESSAGE = 'บันทึกกันลืมยังไม่ได้กดบันทึก ต้องการออกจากหน้านี้และทิ้งข้อความหรือไม่?';
const DASHBOARD_FILTERS_KEY = 'general_cashflow_dashboard_filters';

const savedDashboardFilters = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DASHBOARD_FILTERS_KEY) || 'null');
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(saved?.date || '')) ? saved.date : '',
      branch_id: /^\d+$/.test(String(saved?.branch_id || '')) ? String(saved.branch_id) : '',
      status: ''
    };
  } catch {
    return { date: '', branch_id: '', status: '' };
  }
};

const statusClass = (status) => `status status-${String(status || '').toLowerCase().replaceAll('_', '-')}`;

const THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const padDatePart = (value) => String(value).padStart(2, '0');

const monthFromDate = (value) => {
  if (/^\d{4}-\d{2}/.test(String(value || ''))) return String(value).slice(0, 7);
  return today().slice(0, 7);
};

const monthBoundaryDates = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${padDatePart(lastDay)}`
  };
};

const shiftMonth = (monthKey, offset) => {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return `${shifted.getFullYear()}-${padDatePart(shifted.getMonth() + 1)}`;
};

const formatThaiMonth = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric'
  });
};

const formatThaiDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const formatThaiDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok'
  });
};

const receiptDocumentNumber = (receipt) =>
  `GCF-RC-${String(receipt?.receipt_date || '').replaceAll('-', '')}-${receipt?.branch_code || receipt?.branch_id || 'NA'}-${String(receipt?.id || 0).padStart(4, '0')}`;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('อ่านรูปเอกสารไม่สำเร็จ'));
  reader.readAsDataURL(blob);
});

const sanitizePrintableHtml = async (blob) => {
  const parsed = new DOMParser().parseFromString(await blob.text(), 'text/html');
  parsed.querySelectorAll('script, style, link, meta, object, embed, iframe, form').forEach((node) => node.remove());
  parsed.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc') node.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'src') && !value.startsWith('data:')) node.removeAttribute(attribute.name);
    });
  });
  return parsed.body.innerHTML || '<p>เอกสารนี้ไม่มีเนื้อหา</p>';
};

let pdfJsLoader;
const loadPdfJs = () => {
  if (!pdfJsLoader) {
    pdfJsLoader = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([pdfJs, workerModule]) => {
      pdfJs.GlobalWorkerOptions.workerSrc = workerModule.default;
      return pdfJs;
    });
  }
  return pdfJsLoader;
};

const canvasToObjectUrl = (canvas, objectUrls) => new Promise((resolve, reject) => {
  canvas.toBlob((output) => {
    if (!output) return reject(new Error('แปลงหน้าหลักฐานเป็นรูปไม่สำเร็จ'));
    const url = URL.createObjectURL(output);
    objectUrls.push(url);
    resolve(url);
  }, 'image/jpeg', 0.9);
});

const assertNotAborted = (signal) => {
  if (signal?.aborted) throw new DOMException('ยกเลิกการเตรียมเอกสาร', 'AbortError');
};

const renderPdfBlobForPrint = async (blob, { budget, objectUrls, signal, fileName }) => {
  const { getDocument } = await loadPdfJs();
  const loadingTask = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  addToPrintBudget(budget, { pages: pdf.numPages, fileName });
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      assertNotAborted(signal);
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.8, PRINT_LIMITS.maxRasterSide / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      addToPrintBudget(budget, { rasterPixels: canvas.width * canvas.height, fileName });
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      pages.push({
        kind: 'image',
        source: await canvasToObjectUrl(canvas, objectUrls),
        pageNumber,
        pageCount: pdf.numPages
      });
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    if (typeof pdf.cleanup === 'function') pdf.cleanup();
    if (typeof pdf.destroy === 'function') await pdf.destroy();
    else if (typeof loadingTask.destroy === 'function') await loadingTask.destroy();
  }
  return pages;
};

const useMobileViewport = () => {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
};

const MobilePdfDocument = ({ viewer }) => {
  const [pages, setPages] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!viewer?.blob) return undefined;
    let disposed = false;
    let loadingTask;
    let pdf;
    const objectUrls = [];

    const render = async () => {
      setPages([]);
      setProgress({ current: 0, total: 0 });
      setError('');
      try {
        const { getDocument } = await loadPdfJs();
        if (disposed) return;
        loadingTask = getDocument({ data: new Uint8Array(await viewer.blob.arrayBuffer()) });
        pdf = await loadingTask.promise;
        const pageCount = Math.min(pdf.numPages, PRINT_LIMITS.maxPagesPerFile);
        setProgress({ current: 0, total: pageCount });
        const rendered = [];
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (disposed) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const targetWidth = Math.min(900, Math.max(720, window.innerWidth * 2));
          const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport }).promise;
          const url = await canvasToObjectUrl(canvas, objectUrls);
          rendered.push({ pageNumber, url });
          setProgress({ current: pageNumber, total: pageCount });
          page.cleanup();
          canvas.width = 1;
          canvas.height = 1;
        }
        if (!disposed) setPages(rendered);
      } catch (err) {
        if (!disposed) setError(err.message || 'แสดง PDF บนมือถือไม่สำเร็จ');
      }
    };

    render();
    return () => {
      disposed = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      if (typeof pdf?.destroy === 'function') pdf.destroy();
      else if (typeof loadingTask?.destroy === 'function') loadingTask.destroy();
    };
  }, [viewer?.blob]);

  useEffect(() => {
    if (!pages.length || !viewer?.focusPage) return;
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-pdf-page="${viewer.focusPage}"]`)
        ?.scrollIntoView({ block: 'start' });
    });
  }, [pages, viewer?.focusPage]);

  if (error) {
    return (
      <div className="mobile-pdf-error" role="alert">
        <FileText size={28} />
        <strong>เปิด PDF แบบพอบายไม่สำเร็จ</strong>
        <span>{error}</span>
        <a href={viewer.url} target="_blank" rel="noreferrer">เปิดไฟล์ PDF ต้นฉบับ</a>
      </div>
    );
  }

  if (!pages.length) {
    return (
      <div className="mobile-pdf-loading" role="status">
        <RefreshCw className="spin" size={26} />
        <strong>กำลังจัด PDF ให้พอดีจอมือถือ</strong>
        {progress.total > 0 && <span>หน้า {progress.current} จาก {progress.total}</span>}
      </div>
    );
  }

  return (
    <div className="mobile-pdf-document" ref={containerRef}>
      {pages.map((page) => (
        <article className="mobile-pdf-page" data-pdf-page={page.pageNumber} key={page.pageNumber}>
          <span>หน้า {page.pageNumber} / {pages.length}</span>
          <img src={page.url} alt={`หน้า ${page.pageNumber} ของ ${viewer.name}`} />
        </article>
      ))}
    </div>
  );
};

const renderImageBlobForPrint = async (blob, { budget, objectUrls, signal, fileName }) => {
  assertNotAborted(signal);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, PRINT_LIMITS.maxRasterSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    addToPrintBudget(budget, { pages: 1, rasterPixels: canvas.width * canvas.height, fileName });
    canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [{ kind: 'image', source: await canvasToObjectUrl(canvas, objectUrls), pageNumber: 1, pageCount: 1 }];
  } finally {
    bitmap.close();
  }
};

const loadPrintableEvidenceEntry = async (entry, context) => {
  if (!entry.attachment) return { ...entry, pages: [] };
  try {
    assertNotAborted(context.signal);
    const variant = entry.attachment.document_available ? 'document' : 'original';
    const file = await api.attachmentFile(entry.attachment.id, variant, { signal: context.signal });
    const mimeType = String(file.blob.type || (variant === 'document' ? entry.attachment.document_mime_type : entry.attachment.mime_type) || '').toLowerCase();
    const fileName = file.fileName || entry.attachment.original_name;
    let pages;
    if (mimeType.includes('pdf') || String(fileName).toLowerCase().endsWith('.pdf')) {
      pages = await renderPdfBlobForPrint(file.blob, { ...context, fileName });
    } else if (mimeType.startsWith('image/')) {
      pages = await renderImageBlobForPrint(file.blob, { ...context, fileName });
    } else if (mimeType.includes('html')) {
      addToPrintBudget(context.budget, { pages: 1, fileName });
      pages = [{ kind: 'html', html: await sanitizePrintableHtml(file.blob), pageNumber: 1, pageCount: 1 }];
    } else if (mimeType.startsWith('text/') || /\.(csv|txt)$/i.test(String(fileName))) {
      addToPrintBudget(context.budget, { pages: 1, fileName });
      const text = await file.blob.text();
      pages = [{ kind: 'text', text, pageNumber: 1, pageCount: 1 }];
    } else {
      throw new Error(`ชนิดไฟล์ ${mimeType || 'ไม่ทราบชนิด'} ยังไม่รองรับการพิมพ์`);
    }
    return { ...entry, fileName, pages, status: 'ready' };
  } catch (error) {
    if (error.name === 'AbortError' || error.printFatal) throw error;
    return { ...entry, pages: [], status: 'error', error: error.message };
  }
};

const buildMonthCells = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const dayCount = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= dayCount; day += 1) {
    cells.push({
      day,
      date: `${monthKey}-${padDatePart(day)}`
    });
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

const compactVariance = (value) => `${value > 0 ? '+' : ''}${money(value)}`;

const CHANNEL_ICON_CONFIG = {
  CASH: { Icon: Banknote, className: 'cash', mark: '฿', label: 'เงินสด' },
  MORNING_CHANGE: { Icon: Coins, className: 'cash', mark: 'ทอน', label: 'เงินทอนตอนเช้า' },
  MISC_COUNTED: { Icon: Plus, className: 'unknown', mark: '+', label: 'รายการอื่นๆ ที่แคชเชียร์เพิ่ม' },
  CREDIT_CARD_SCB: { Icon: CreditCard, className: 'scb-card', mark: 'SCB', label: 'บัตรเครดิต SCB' },
  CREDIT_CARD_KBANK: { Icon: CreditCard, className: 'kbank-card', mark: 'KBANK', label: 'บัตรเครดิตกสิกร' },
  CREDIT_CARD_KTC: { Icon: CreditCard, className: 'ktc-card', mark: 'KTC', label: 'บัตรเครดิต KTC' },
  QR_KPLUS: { Icon: QrCode, className: 'kplus', mark: 'K+', label: 'QR กสิกร' },
  PROMPTPAY: { Icon: Landmark, className: 'scb-bank', mark: 'SCB', label: 'เข้าธนาคารไทยพาณิชย์' },
  GRAB: { Icon: UtensilsCrossed, className: 'grab', mark: 'GF', label: 'GRAB food' },
  QR_KRUNGSRI: { Icon: QrCode, className: 'krungsri', mark: 'BAY', label: 'QR กรุงศรี' },
  OTHER_UNKNOWN: { Icon: CircleHelp, className: 'unknown', mark: '?', label: 'จ่ายหน้าร้าน' }
};

const ChannelIcon = ({ code, label }) => {
  const config = CHANNEL_ICON_CONFIG[code] || CHANNEL_ICON_CONFIG.OTHER_UNKNOWN;
  const Icon = config.Icon;
  return (
    <span className={`channel-icon channel-icon-${config.className}`} aria-label={config.label || label} title={config.label || label}>
      <Icon size={18} strokeWidth={2.4} />
      <em>{config.mark}</em>
    </span>
  );
};

const ChannelLabel = ({ line }) => (
  <span className="channel-label">
    <ChannelIcon code={line.channel_code} label={line.channel_label} />
    <strong>{line.channel_label}</strong>
  </span>
);

const can = (user, action) => {
  const role = user?.role;
  if (role === 'admin') return true;
  return {
    create: role === 'cashier',
    submit: role === 'cashier',
    check: role === 'auditor',
    correction: role === 'auditor',
    note: role === 'auditor' || role === 'recorder',
    attachment: role === 'cashier' || role === 'auditor',
    close: role === 'recorder',
    settings: false,
    report: role === 'recorder',
    agents: role === 'auditor' || role === 'recorder',
    inbox: role === 'auditor' || role === 'recorder'
  }[action];
};

const Button = ({ children, icon: Icon, variant = 'primary', busy, ...props }) => (
  <button className={`btn btn-${variant}`} disabled={busy || props.disabled} {...props}>
    {busy ? <RefreshCw className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
    <span>{children}</span>
  </button>
);

const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);

const ReceiptDateCalendar = ({ branchId, date, onDateChange, refreshKey = 0, allowAllBranches = false }) => {
  const [monthKey, setMonthKey] = useState(monthFromDate(date));
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (date) setMonthKey(monthFromDate(date));
  }, [date]);

  useEffect(() => {
    if (!branchId && !allowAllBranches) {
      setReceipts([]);
      setError('');
      setLoading(false);
      return undefined;
    }

    const { from, to } = monthBoundaryDates(monthKey);
    let cancelled = false;
    setLoading(true);
    setError('');

    api
      .receipts({ ...(branchId ? { branch_id: branchId } : {}), from, to })
      .then((rows) => {
        if (!cancelled) setReceipts(rows);
      })
      .catch((err) => {
        if (err.authExpired) return;
        if (!cancelled) {
          setReceipts([]);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branchId, monthKey, refreshKey]);

  const receiptsByDate = useMemo(() => groupCalendarReceipts(receipts), [receipts]);

  const cells = useMemo(() => buildMonthCells(monthKey), [monthKey]);
  const monthlyVariance = useMemo(
    () => receiptCalendarMonthlyVariance(receipts),
    [receipts]
  );
  const monthlyDirection = monthlyVariance < 0 ? 'ขาด' : monthlyVariance > 0 ? 'เกิน' : 'ครบ';

  return (
    <div className="receipt-calendar">
      <div className="receipt-calendar-head">
        <button
          type="button"
          className="calendar-nav-btn"
          aria-label="เดือนก่อนหน้า"
          onClick={() => setMonthKey((current) => shiftMonth(current, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <div>
          <strong>{formatThaiMonth(monthKey)}</strong>
          <span>เลือกวันจากปฏิทินได้เลย</span>
        </div>
        <button
          type="button"
          className="calendar-nav-btn"
          aria-label="เดือนถัดไป"
          onClick={() => setMonthKey((current) => shiftMonth(current, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>

      {!branchId && !allowAllBranches ? (
        <div className="receipt-calendar-note">เลือกสาขาก่อน เพื่อดูว่าวันไหนนับเงินแล้ว</div>
      ) : (
        <>
          <div className={`receipt-calendar-selected-date ${date ? 'has-date' : ''}`} aria-live="polite" aria-atomic="true">
            <CalendarDays className="calendar-selection-icon" size={24} aria-hidden="true" />
            <span>{branchId ? 'วันที่กำลังดู' : 'ทุกสาขา · วันที่กำลังดู'}</span>
            <strong>{date ? formatThaiDate(date) : 'ยังไม่ได้เลือกวันที่'}</strong>
          </div>
          <div className={`receipt-calendar-month-variance ${monthlyVariance !== null && Math.abs(monthlyVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}`}>
            {monthlyVariance === null ? 'รอยอดยืนยันครบทุกวัน' : `เดือนนี้ ${monthlyDirection} ${compactVariance(monthlyVariance)}`}
          </div>
          <div className="receipt-calendar-legend">
            <span><i className="calendar-dot draft" />ยังไม่ส่ง</span>
            <span><i className="calendar-dot submitted" />รอตรวจ</span>
            <span><i className="calendar-dot checked-ok" />ตรวจครบ</span>
            <span><i className="calendar-dot closed" />ปิดแล้ว</span>
            <span><i className="calendar-dot checked-variance" />มีส่วนต่าง</span>
            <span><i className="calendar-dot correction" />ต้องแก้</span>
          </div>
          <div className="receipt-calendar-weekdays">
            {THAI_WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="receipt-calendar-grid">
            {cells.map((cell, index) => {
              if (!cell) return <span className="receipt-calendar-spacer" key={`spacer-${index}`} />;
              const receipt = receiptsByDate.get(cell.date);
              const dayState = receiptDateState(receipt);
              const calendarVariance = receipt?.calendar_variance_total ?? null;
              const showVariance = Boolean(receipt && receipt.status !== 'DRAFT');
              const varianceSourceLabel = receipt?.status === 'CLOSED' ? 'ผลต่างยืนยัน' : 'ผลต่างแคชเชียร์';
              return (
                <button
                  type="button"
                  key={cell.date}
                  className={`receipt-calendar-day ${date === cell.date ? 'selected' : ''} ${dayState.className} ${Boolean(receipt?.historical_evidence_warning) ? 'has-historical-warning' : ''}`}
                  aria-pressed={date === cell.date}
                  aria-current={date === cell.date ? 'date' : undefined}
                  title={receipt ? `${cell.date} ${receipt.status_label} • ${varianceSourceLabel} ${calendarVariance === null ? 'รอยอดยืนยัน' : compactVariance(calendarVariance)}${receipt.historical_evidence_warning ? ' • หลักฐานย้อนหลังไม่ตรง' : ''}` : cell.date}
                  onClick={() => onDateChange(cell.date)}
                >
                  <span>{cell.day}</span>
                  {dayState.label && <small>{dayState.label}</small>}
                  {showVariance && (
                    <small className={`calendar-variance ${calendarVariance !== null && Math.abs(calendarVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}`}>
                      {calendarVariance === null ? 'รอยอดยืนยัน' : compactVariance(calendarVariance)}
                    </small>
                  )}
                  {Boolean(receipt?.historical_evidence_warning) && <small className="calendar-evidence-warning">หลักฐานไม่ตรง</small>}
                </button>
              );
            })}
          </div>
          {loading && <div className="receipt-calendar-note">กำลังโหลดสถานะวันที่...</div>}
          {error && <div className="receipt-calendar-error">{error}</div>}
        </>
      )}
    </div>
  );
};

const AttachmentViewerModal = ({ viewer, onClose, title = 'เอกสารแนบ' }) => {
  const isMobile = useMobileViewport();
  useEffect(() => {
    if (!viewer) return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewer, onClose]);

  if (!viewer || typeof document === 'undefined') return null;
  const mimeType = String(viewer.mimeType || '').toLowerCase();
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType.includes('pdf') || String(viewer.name || '').toLowerCase().endsWith('.pdf');
  return createPortal(
    <div className="attachment-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="attachment-modal" role="dialog" aria-modal="true" aria-label={`ดูเอกสาร ${viewer.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{title}</span>
            <strong>{viewer.name}</strong>
            {viewer.focusSummary && <small className="attachment-focus-summary">{viewer.focusSummary}</small>}
          </div>
          <button type="button" className="icon-button attachment-modal-close" title="ปิดเอกสาร" aria-label="ปิดเอกสาร" onClick={onClose}><X size={22} /></button>
        </header>
        <div className={`attachment-modal-content ${isImage ? 'is-image' : isPdf ? 'is-pdf' : 'is-frame'}`}>
          {isImage ? (
            <img src={viewer.url} alt={viewer.name} />
          ) : isPdf && isMobile && viewer.blob ? (
            <MobilePdfDocument viewer={viewer} />
          ) : (
            <iframe title={viewer.name} src={viewer.url} />
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};

const AttachmentList = ({ attachments = [] }) => {
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);

  const closeViewer = () => {
    if (viewer?.objectUrl || viewer?.url) URL.revokeObjectURL(viewer.objectUrl || viewer.url);
    setViewer(null);
  };

  useEffect(() => () => {
    if (viewer?.objectUrl || viewer?.url) URL.revokeObjectURL(viewer.objectUrl || viewer.url);
  }, [viewer?.objectUrl, viewer?.url]);

  const openAttachment = async (attachment, variant) => {
    const key = `${attachment.id}:${variant}`;
    setBusyKey(key);
    setError('');
    try {
      if (!hasAuthToken()) {
        throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
      }
      const file = await api.attachmentFile(attachment.id, variant);
      const objectUrl = URL.createObjectURL(file.blob);
      setViewer({
        url: objectUrl,
        objectUrl,
        blob: file.blob,
        name: file.fileName || attachment.original_name,
        mimeType: file.blob.type || (variant === 'document' ? attachment.document_mime_type : attachment.mime_type)
      });
    } catch (err) {
      if (err.authExpired) return;
      setError(
        err.status === 404
          ? 'ไม่พบไฟล์แนบนี้ในระบบ กรุณาถ่ายรูปหรือแนบไฟล์นี้ใหม่'
          : err.message
      );
    } finally {
      setBusyKey('');
    }
  };

  if (!attachments.length) return null;

  return (
    <>
      <div className="attachment-list">
        {attachments.map((attachment) => {
        const hasDocument = Boolean(attachment.document_path);
        const fileMissing = !attachment.file_available && !attachment.document_available;
        const statusText = fileMissing
          ? 'ไฟล์เดิมหาย กรุณาแนบใหม่'
          : hasDocument
          ? 'เอกสารพร้อมอ่าน'
          : attachment.document_status === 'failed'
            ? 'แปลงเอกสารไม่สำเร็จ ใช้ไฟล์ต้นฉบับ'
            : 'ไฟล์ต้นฉบับ';
        return (
          <div className="attachment-row" key={attachment.id}>
            <div>
              <strong>{attachment.original_name}</strong>
              <small>{statusText}</small>
            </div>
            <div className="attachment-actions">
              <button
                type="button"
                className="attachment-mini-btn"
                disabled={busyKey === `${attachment.id}:document` || !attachment.document_available}
                onClick={() => openAttachment(attachment, 'document')}
              >
                {busyKey === `${attachment.id}:document` ? <RefreshCw className="spin" size={14} /> : <FileText size={14} />}
                <span>เอกสาร</span>
              </button>
              <button
                type="button"
                className="attachment-mini-btn"
                disabled={busyKey === `${attachment.id}:original` || !attachment.file_available}
                onClick={() => openAttachment(attachment, 'original')}
              >
                {busyKey === `${attachment.id}:original` ? <RefreshCw className="spin" size={14} /> : <Camera size={14} />}
                <span>ต้นฉบับ</span>
              </button>
            </div>
          </div>
          );
        })}
        {error && <div className="attachment-error">{error}</div>}
      </div>
      <AttachmentViewerModal viewer={viewer} onClose={closeViewer} />
    </>
  );
};

const ReceiptAttachmentSection = ({
  receiptId,
  type,
  title,
  hint,
  Icon = FileText,
  attachments = [],
  onUploaded,
  cameraOnly = false,
  canUpload = false
}) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const uploadFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.uploadAttachments(receiptId, files, type);
      await onUploaded?.(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`receipt-attachment-section ${cameraOnly ? 'is-camera' : ''}`}>
      <div className="receipt-attachment-head">
        <span className="receipt-attachment-icon"><Icon size={18} /></span>
        <div>
          <strong>{title}</strong>
          <small>{hint}</small>
        </div>
        <b>{attachments.length} ไฟล์</b>
      </div>
      {canUpload && (
        <>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            multiple={!cameraOnly}
            accept={cameraOnly ? 'image/*' : 'image/*,application/pdf,.csv,.xlsx,.xls'}
            capture={cameraOnly ? 'environment' : undefined}
            onChange={uploadFiles}
          />
          <Button
            icon={cameraOnly ? Camera : FileText}
            variant="secondary"
            busy={busy}
            onClick={() => inputRef.current?.click()}
          >
            {cameraOnly ? 'ถ่าย/แนบรูปสรุปรวม' : 'แนบเอกสาร'}
          </Button>
        </>
      )}
      <AttachmentList attachments={attachments} />
      {error && <div className="error-box">{error}</div>}
    </section>
  );
};

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cashierBusy, setCashierBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleConfig, setGoogleConfig] = useState(null);
  const googleButtonRef = useRef(null);
  const autoCashierStarted = useRef(false);
  const cashierLaunchRequested = isCashierLaunchRequested();

  const completeLogin = (result) => {
    setAuthToken(result.token);
    localStorage.setItem('cashflow_user', JSON.stringify(result.user));
    onLogin(result.user);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.login({ username, password });
      completeLogin(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enterCashier = async ({ fromLaunch = false } = {}) => {
    setCashierBusy(true);
    setError('');
    try {
      const result = await api.cashierLogin();
      completeLogin(result);
      if (fromLaunch && typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname || '/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCashierBusy(false);
    }
  };

  useEffect(() => {
    if (!cashierLaunchRequested || autoCashierStarted.current) return;
    autoCashierStarted.current = true;
    enterCashier({ fromLaunch: true });
  }, [cashierLaunchRequested]);

  useEffect(() => {
    let active = true;
    api.googleLoginConfig()
      .then((nextConfig) => {
        if (active) setGoogleConfig(nextConfig);
      })
      .catch(() => {
        if (active) setGoogleConfig({ enabled: false, client_id: '' });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!googleConfig?.enabled || !googleButtonRef.current) return undefined;
    let active = true;

    loadGoogleIdentityServices()
      .then((google) => {
        if (!active || !google?.accounts?.id || !googleButtonRef.current) return;
        google.accounts.id.initialize({
          client_id: googleConfig.client_id,
          ux_mode: 'popup',
          callback: async (response) => {
            if (!response?.credential) return;
            setGoogleBusy(true);
            setError('');
            try {
              completeLogin(await api.googleLogin(response.credential));
            } catch (err) {
              setError(err.message);
            } finally {
              setGoogleBusy(false);
            }
          }
        });
        googleButtonRef.current.replaceChildren();
        google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          locale: 'th',
          width: Math.min(360, Math.max(220, googleButtonRef.current.clientWidth || 320))
        });
      })
      .catch((err) => {
        if (active) setError(err.message);
      });

    return () => { active = false; };
  }, [googleConfig?.enabled, googleConfig?.client_id]);

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-row">
          <div className="brand-mark"><Banknote size={26} /></div>
          <div>
            <h1>General Cashflow</h1>
            <p>รับเงินหน้าร้านรายวัน</p>
          </div>
        </div>
        {googleConfig?.enabled && (
          <div className={`google-login ${googleBusy ? 'is-busy' : ''}`} aria-busy={googleBusy}>
            <div ref={googleButtonRef} className="google-login-button" />
            {googleBusy && <small>กำลังเข้าสู่ระบบ…</small>}
          </div>
        )}
        {googleConfig?.enabled && <div className="login-divider"><span>หรือ</span></div>}
        <Button icon={Banknote} busy={cashierBusy} type="button" onClick={() => enterCashier()}>
          เข้าใช้งานแคชเชียร์
        </Button>
        <div className="login-divider"><span>ฝ่ายตรวจ / ผู้บันทึก / Admin</span></div>
        <Field label="Username">
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {error && <div className="error-box">{error}</div>}
        <Button icon={Lock} busy={busy} type="submit">เข้าสู่ระบบ</Button>
      </form>
    </main>
  );
};

const NOTE_DENOMINATIONS = [1000, 500, 100, 50, 20];
const emptyDenominationCounts = () => Object.fromEntries(NOTE_DENOMINATIONS.map((denom) => [denom, 0]));

const CashDenominationPad = ({ initialValue, onTotalChange }) => {
  const [cashTotal, setCashTotal] = useState(() => normalizeMoneyInput(initialValue ?? ''));
  const [denominationCounts, setDenominationCounts] = useState(emptyDenominationCounts);
  const [coinAmount, setCoinAmount] = useState('');
  const coinInputRef = useRef(null);

  const setTotal = (value, { keepCounts = false } = {}) => {
    const normalized = normalizeMoneyInput(value);
    setCashTotal(normalized);
    if (!keepCounts) {
      setDenominationCounts(emptyDenominationCounts());
      setCoinAmount('');
    }
    onTotalChange(Number(normalized || 0));
  };

  const addAmount = (amount) => {
    const next = roundMoneyInput(Number(cashTotal || 0) + amount);
    setDenominationCounts((current) => ({
      ...current,
      [amount]: Number(current[amount] || 0) + 1
    }));
    setTotal(next, { keepCounts: true });
  };

  const subtractAmount = (amount) => {
    const count = Number(denominationCounts[amount] || 0);
    if (count <= 0) return;

    const next = roundMoneyInput(Math.max(0, Number(cashTotal || 0) - amount));
    setDenominationCounts((current) => ({
      ...current,
      [amount]: Math.max(0, Number(current[amount] || 0) - 1)
    }));
    setTotal(next, { keepCounts: true });
  };

  const updateCoinAmount = (value) => {
    const normalized = normalizeMoneyInput(value);
    const previousCoinAmount = Number(coinAmount || 0);
    const nextCoinAmount = Number(normalized || 0);
    const nextTotal = roundMoneyInput(Math.max(0, Number(cashTotal || 0) - previousCoinAmount + nextCoinAmount));

    setCoinAmount(normalized);
    setTotal(nextTotal, { keepCounts: true });
  };

  const focusCoinInput = () => {
    coinInputRef.current?.focus();
    coinInputRef.current?.select();
  };

  const clearAll = () => {
    setCashTotal('');
    setDenominationCounts(emptyDenominationCounts());
    setCoinAmount('');
    onTotalChange(0);
  };

  return (
    <div className="cash-pad">
      <div className="cash-coin-row">
        <span className="cash-pad-label">ยอดเงินสดรวม</span>
        <input
          className="cash-coin-input"
          inputMode="decimal"
          data-money-input="true"
          value={formatMoneyInput(cashTotal)}
          onFocus={(event) => clearZeroMoneyOnFocus(event, setTotal)}
          onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: setTotal })}
          onPaste={(event) => handleNumericPaste(event, { onValue: setTotal })}
          onChange={(event) => setTotal(event.target.value)}
        />
      </div>

      <span className="cash-pad-label">เพิ่มยอดเงินสด</span>
      <div className="cash-pad-grid">
        {NOTE_DENOMINATIONS.map((denom) => {
          const count = Number(denominationCounts[denom] || 0);
          return (
            <div className="cash-denom-control" key={denom}>
              <button
                type="button"
                className="cash-denom-btn"
                onClick={() => addAmount(denom)}
                aria-label={`เพิ่มแบงค์ ${denom.toLocaleString('th-TH')}`}
              >
                <span className="cash-denom-value">฿{denom.toLocaleString('th-TH')}</span>
                <span className="cash-denom-count">จำนวน {count}</span>
                <span className="cash-denom-subtotal">รวม {money(denom * count)}</span>
              </button>
              <button
                type="button"
                className="cash-denom-decrease"
                onClick={() => subtractAmount(denom)}
                disabled={count <= 0}
                aria-label={`ลดแบงค์ ${denom.toLocaleString('th-TH')}`}
              >
                <Minus size={15} />
                <span>ลบ</span>
              </button>
            </div>
          );
        })}
        <div className="cash-denom-control cash-coin-control">
          <button
            type="button"
            className="cash-denom-btn cash-coin-trigger"
            onClick={focusCoinInput}
            aria-label="กรอกยอดเหรียญ"
          >
            <Coins size={18} />
            <span className="cash-denom-value">เหรียญ</span>
            <span className="cash-denom-count">แตะเพื่อกรอกจำนวนเงิน</span>
            <span className="cash-denom-subtotal">รวม {money(coinAmount)}</span>
          </button>
          <input
            ref={coinInputRef}
            className="cash-coin-denom-input"
            inputMode="decimal"
            data-money-input="true"
            aria-label="ยอดเหรียญ"
            value={formatMoneyInput(coinAmount)}
            onFocus={(event) => clearZeroMoneyOnFocus(event, updateCoinAmount)}
            onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: updateCoinAmount })}
            onPaste={(event) => handleNumericPaste(event, { onValue: updateCoinAmount })}
            onChange={(event) => updateCoinAmount(event.target.value)}
          />
        </div>
      </div>

      <div className="cash-pad-footer">
        <span>รวมเงินสด</span>
        <strong>{money(cashTotal)}</strong>
        <button type="button" className="cash-pad-reset" onClick={clearAll}>ล้างค่า</button>
      </div>
    </div>
  );
};

const MISC_ITEM_PRESETS = ['เช็คอิน', 'แลกแต้ม', 'สมาชิก', 'รถตู้', 'เครดิต พี่เพ็ญ', 'เครดิต พี่จุ๋ม', 'เครดิต คุณโม'];
const CASHIER_EDITABLE_STATUSES = new Set(['DRAFT', 'NEEDS_CORRECTION']);
const CASHIER_VARIANCE_CONFIRM_THRESHOLD = 100;

const CashierWorkspace = ({ branches, onDirtyChange, onLogout }) => {
  const [date, setDate] = useState('');
  const [branchId, setBranchId] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [draftLines, setDraftLines] = useState([]);
  const [miscLabel, setMiscLabel] = useState('');
  const [miscAmount, setMiscAmount] = useState('');
  const [morningChangeAmount, setMorningChangeAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openTableCheck, setOpenTableCheck] = useState(null);
  const [openTableLoading, setOpenTableLoading] = useState(false);
  const [tableCheckConfirmed, setTableCheckConfirmed] = useState(false);
  const [tableCheckNote, setTableCheckNote] = useState('');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [headerCondensed, setHeaderCondensed] = useState(false);
  const receiptSyncRef = useRef({ id: null, status: null });
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!branchId || !date) {
      setReceipt(null);
      setDraftLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setMiscLabel('');
    setMiscAmount('');
    setMorningChangeAmount('');
    setOpenTableCheck(null);
    setOpenTableLoading(false);
    setTableCheckConfirmed(false);
    setTableCheckNote('');
    api
      .receipts({ date, branch_id: branchId })
      .then(async (rows) => {
        const summary = rows[0] || null;
        if (shouldAutoSyncCashierReceipt({ date, receipt: summary })) {
          return api.createFromClickHouse({ date, branch_id: branchId });
        }
        if (summary) return api.receipt(summary.id);
        if (date > today()) {
          setError('ยังไม่สามารถดึงยอด POS ของวันในอนาคตได้');
        }
        return null;
      })
      .then(setReceipt)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [branchId, date]);

  useEffect(() => {
    const previousReceipt = receiptSyncRef.current;
    const nextReceipt = { id: receipt?.id ?? null, status: receipt?.status ?? null };
    const shouldKeepDraftValues =
      receipt &&
      previousReceipt.id === receipt.id &&
      previousReceipt.status === receipt.status &&
      CASHIER_EDITABLE_STATUSES.has(receipt.status);
    const nextLines = (receipt?.lines || []).map((line) => ({ ...line }));

    setDraftLines((currentLines) => {
      if (!shouldKeepDraftValues) return nextLines;

      const currentById = new Map(currentLines.map((line) => [line.id, line]));
      return nextLines.map((line) => {
        const current = currentById.get(line.id);
        return current ? { ...line, cashier_amount: current.cashier_amount } : line;
      });
    });
    setMorningChangeAmount((currentAmount) =>
      shouldKeepDraftValues ? currentAmount : normalizeMoneyInput(receipt?.morning_change_amount ?? '')
    );
    receiptSyncRef.current = nextReceipt;
  }, [receipt]);

  const editable = Boolean(receipt) && CASHIER_EDITABLE_STATUSES.has(receipt.status);
  const openTableCount = Number(openTableCheck?.open_table_count || 0);
  const openTableAmount = Number(openTableCheck?.open_table_amount || 0);
  const openTableHasIssue = Boolean(openTableCheck && openTableCheck.available && openTableCount > 0);
  const openTableCheckUnavailable = Boolean(openTableCheck && !openTableCheck.available);
  const openTableNeedsNote = openTableHasIssue;
  const openTableNeedsConfirmation = openTableHasIssue || openTableCheckUnavailable;
  const showTableCheckBanner = Boolean(editable && (openTableLoading || !openTableCheck || openTableNeedsConfirmation));
  const cashierLineTotal = draftLines.reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const rawExpectedTotal = Number(receipt?.gross_sales_expected || 0);
  const miscTotal = (receipt?.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const enteredTotal = cashierLineTotal + miscTotal;
  const expectedTotal = rawExpectedTotal + Number(morningChangeAmount || 0);
  const varianceTotal = enteredTotal - expectedTotal;
  const balanced = Math.abs(varianceTotal) < 0.01;
  const varianceLabel = `${varianceTotal > 0 ? '+' : ''}${money(varianceTotal)}`;
  const cashierVarianceAbs = Math.abs(varianceTotal);
  const cashierVarianceRequiresConfirmation = cashierVarianceAbs > CASHIER_VARIANCE_CONFIRM_THRESHOLD;
  const cashierVarianceDirectionLabel = varianceTotal < 0 ? 'ขาด' : 'เกิน';
  const posDataWarningRequired = cashierPosWarningRequired({
    billCount: receipt?.bill_count,
    grossSalesExpected: receipt?.gross_sales_expected,
    declaredAmounts: [
      ...draftLines.map((line) => line.cashier_amount),
      ...(receipt?.misc_items || []).map((item) => item.amount)
    ]
  });
  const submitHint = !openTableCheck || openTableLoading
    ? 'กำลังตรวจโต๊ะค้างจาก POS'
    : openTableNeedsConfirmation && !tableCheckConfirmed
      ? 'ติ๊กยืนยันตรวจโต๊ะค้างก่อนส่ง'
      : openTableNeedsNote && !tableCheckNote.trim()
        ? 'ใส่หมายเหตุโต๊ะค้างก่อนส่ง'
        : '';
  const selectedBranch = branches.find((branch) => String(branch.id) === String(branchId));
  const selectedBranchLabel = selectedBranch?.name || 'เลือกสาขา';
  const selectedDateLabel = date ? formatThaiDate(date) : 'เลือกวันที่ในปฏิทิน';
  const futureDateSelected = Boolean(date && date > today());
  const hasUnsavedDraft = Boolean(
    editable &&
    receipt &&
    (
      !moneyValuesEqual(morningChangeAmount, receipt.morning_change_amount) ||
      Boolean(miscLabel.trim() || miscAmount) ||
      draftLines.some((line) => {
        const original = (receipt.lines || []).find((item) => item.id === line.id);
        return !moneyValuesEqual(line.cashier_amount, original?.cashier_amount);
      })
    )
  );

  useEffect(() => {
    onDirtyChange?.(hasUnsavedDraft);
    return () => onDirtyChange?.(false);
  }, [hasUnsavedDraft, onDirtyChange]);

  useEffect(() => {
    setOpenTableCheck(null);
    setOpenTableLoading(false);
    setTableCheckConfirmed(false);
    setTableCheckNote('');
    if (!receipt?.id || !editable) return undefined;

    let cancelled = false;
    setOpenTableLoading(true);
    api
      .openTables(receipt.id)
      .then((result) => {
        if (!cancelled) setOpenTableCheck(result);
      })
      .catch((err) => {
        if (err.authExpired) return;
        if (!cancelled) {
          setOpenTableCheck({
            available: false,
            message: 'ระบบตรวจโต๊ะค้างอัตโนมัติไม่ได้ กรุณาตรวจใน POS ก่อนส่งยอด',
            open_table_count: 0,
            open_table_amount: 0,
            open_tables: []
          });
        }
      })
      .finally(() => {
        if (!cancelled) setOpenTableLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editable, receipt?.id, receipt?.status]);

  useEffect(() => {
    if (!hasUnsavedDraft) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedDraft]);

  useEffect(() => {
    const updateHeaderSize = () => {
      const scrollTop = scrollRef.current?.scrollTop || window.scrollY || document.documentElement.scrollTop || 0;
      setHeaderCondensed(scrollTop > 28);
    };
    const scrollNode = scrollRef.current;

    updateHeaderSize();
    scrollNode?.addEventListener('scroll', updateHeaderSize, { passive: true });
    window.addEventListener('scroll', updateHeaderSize, { passive: true });

    return () => {
      scrollNode?.removeEventListener('scroll', updateHeaderSize);
      window.removeEventListener('scroll', updateHeaderSize);
    };
  }, []);

  const updateLine = (id, value) => {
    setDraftLines((lines) => lines.map((line) => (line.id === id ? { ...line, cashier_amount: value } : line)));
  };

  const confirmDiscardUnsaved = () => !hasUnsavedDraft || window.confirm(UNSAVED_CASHIER_MESSAGE);

  const changeBranch = (nextBranchId) => {
    if (nextBranchId === branchId) return;
    if (!confirmDiscardUnsaved()) return;
    setBranchId(nextBranchId);
  };

  const changeDate = (nextDate) => {
    if (nextDate === date) return;
    if (!confirmDiscardUnsaved()) return;
    setDate(nextDate);
  };

  const refreshCalendar = () => {
    setCalendarRefreshKey((key) => key + 1);
  };

  const createReceipt = async () => {
    if (!branchId || !date) {
      setError('กรุณาเลือกวันที่และสาขาก่อนดึงยอดขาย');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(await api.createFromClickHouse({ date, branch_id: branchId }));
      refreshCalendar();
      setMessage('ดึงยอดขายสำเร็จ');
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!branchId || !date) {
      setError('กรุณาเลือกวันที่และสาขาก่อนส่งยอด');
      return;
    }
    if (openTableLoading || !openTableCheck) {
      setError('รอสักครู่ ระบบกำลังตรวจโต๊ะค้างจาก POS ก่อนส่งยอด');
      return;
    }
    if (openTableNeedsConfirmation && !tableCheckConfirmed) {
      setError('กรุณาติ๊กยืนยันว่าได้ตรวจโต๊ะค้างใน POS แล้วก่อนส่งยอด');
      return;
    }
    if (openTableNeedsNote && !tableCheckNote.trim()) {
      setError('ยังมีโต๊ะค้าง กรุณาใส่หมายเหตุให้หัวหน้าตรวจต่อก่อนส่งยอด');
      return;
    }
    if (openTableHasIssue && !window.confirm(`ยังมีโต๊ะค้าง ${openTableCount} โต๊ะ ยอดรวม ${money(openTableAmount)} ต้องการส่งยอดพร้อมหมายเหตุใช่ไหม?`)) {
      return;
    }
    const posDataWarningAcknowledged = posDataWarningRequired
      ? window.confirm('POS ยังเป็น 0 บิล / 0.00 แต่มียอดเงินที่กรอก ระบบจะบันทึกยอดตามที่กรอกไว้ตามปกติ ต้องการส่งยอดต่อหรือไม่?')
      : false;
    if (posDataWarningRequired && !posDataWarningAcknowledged) {
      return;
    }
    const cashierVarianceAcknowledged = cashierVarianceRequiresConfirmation
      ? posDataWarningAcknowledged || window.confirm(
        `ยอด${cashierVarianceDirectionLabel} ${money(cashierVarianceAbs)} เกิน ${money(CASHIER_VARIANCE_CONFIRM_THRESHOLD)} ต้องการยืนยันส่งยอดหรือไม่?`
      )
      : false;
    if (cashierVarianceRequiresConfirmation && !cashierVarianceAcknowledged) {
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const submittedReceipt = await api.submitReceipt(receipt.id, {
          morning_change_amount: morningChangeAmount,
          table_check_acknowledged: true,
          table_check_note: tableCheckNote.trim(),
          pos_data_warning_acknowledged: posDataWarningAcknowledged,
          cashier_variance_acknowledged: cashierVarianceAcknowledged,
          lines: draftLines.map((line) => ({
            payment_channel_id: line.payment_channel_id,
            cashier_amount: line.cashier_amount
          }))
        });
      setReceipt(submittedReceipt);
      refreshCalendar();
      setMessage(submittedReceipt.submission_warning?.message || 'ส่งยอดสำเร็จ รอฝ่ายตรวจ');
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addMiscItem = async () => {
    if (!miscLabel.trim() || !miscAmount) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setReceipt(await api.addMiscItem(receipt.id, { label: miscLabel.trim(), amount: miscAmount }));
      setMiscLabel('');
      setMiscAmount('');
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeMiscItem = async (itemId) => {
    setBusy(true);
    setError('');
    try {
      setReceipt(await api.removeMiscItem(receipt.id, itemId));
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cashier-app">
      <div className={`cashier-context-bar ${headerCondensed ? 'is-condensed' : ''}`}>
        <div className="cashier-context-main">
          <span>รับเงินหน้าร้าน</span>
          <strong>{selectedBranchLabel}</strong>
          <small>{selectedDateLabel}</small>
        </div>
        <button type="button" className="cashier-context-logout" aria-label="ออกจากระบบ" onClick={onLogout}>
          <LogOut size={18} />
        </button>
      </div>

      <section className="cashier-shell cashier-scroll" ref={scrollRef}>
        <div className="cashier-selector">
          <Field label="สาขา *">
            <select required value={branchId} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">{branches.length === 0 ? 'ไม่มีสาขา' : 'เลือกสาขา'}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <ReceiptDateCalendar
          branchId={branchId}
          date={date}
          onDateChange={changeDate}
          refreshKey={calendarRefreshKey}
        />

      {loading && (
        <div className="cashier-loading">
          <RefreshCw className="spin" size={18} /> กำลังโหลด...
        </div>
      )}

      {!loading && (!branchId || !date) && (
        <div className="cashier-card cashier-empty">
          <Search size={30} />
          <p>เลือกสาขา แล้วแตะวันที่ในปฏิทินก่อนเริ่มกรอกยอด</p>
        </div>
      )}

      {!loading && branchId && date && !receipt && (
        <div className="cashier-card cashier-empty">
          <RefreshCw size={30} />
          <p>{futureDateSelected ? 'ยังไม่ถึงวันที่ขาย ระบบจะดึง POS ให้อัตโนมัติเมื่อถึงวันนั้น' : 'ยังไม่มีข้อมูลยอดขายวันนี้ของสาขานี้'}</p>
          <Button icon={RefreshCw} busy={busy} disabled={!branchId || !date || futureDateSelected} onClick={createReceipt}>
            {futureDateSelected ? 'รอถึงวันที่ขาย' : 'ดึงยอดขายจาก POS'}
          </Button>
        </div>
      )}

      {!loading && receipt && (
        <>
          <div className="cashier-status-row">
            <span className={statusClass(receipt.status)}>{receipt.status_label}</span>
            <span className="muted">{receipt.bill_count} บิล</span>
          </div>

          {receipt.status === 'NEEDS_CORRECTION' && receipt.correction_note && (
            <div className="correction-banner">
              <AlertTriangle size={18} />
              <div>
                <strong>ฝ่ายตรวจส่งกลับให้แก้ไข</strong>
                <p>{receipt.correction_note}</p>
              </div>
            </div>
          )}

          {showTableCheckBanner && (
            <div className={`table-check-banner ${openTableHasIssue ? 'danger' : openTableCheckUnavailable ? 'warning' : 'clear'}`}>
              {openTableCheck && !openTableHasIssue && !openTableCheckUnavailable ? (
                <CheckCircle2 size={20} />
              ) : (
                <AlertTriangle size={20} />
              )}
              <div className="table-check-content">
                <strong>
                  {openTableLoading || !openTableCheck
                    ? 'กำลังตรวจโต๊ะค้างจาก POS'
                    : openTableHasIssue
                      ? `ยังมีโต๊ะค้าง ${openTableCount} โต๊ะ`
                      : openTableCheckUnavailable
                        ? 'ต้องตรวจโต๊ะค้างใน POS เอง'
                        : 'ไม่พบโต๊ะค้างจาก POS'}
                </strong>
                <p>
                  {openTableLoading || !openTableCheck
                    ? 'รอสักครู่ก่อนส่งยอด'
                    : openTableHasIssue
                      ? `ยอดโต๊ะค้างรวม ${money(openTableAmount)} กรุณาปิดโต๊ะก่อนส่งยอด หรือใส่หมายเหตุถ้าจำเป็นต้องส่ง`
                      : openTableCheckUnavailable
                        ? 'ระบบตรวจอัตโนมัติไม่ได้ กรุณาเปิดหน้า POS และตรวจว่าไม่มีโต๊ะค้างก่อนส่งยอด'
                        : 'ให้ตรวจหน้า POS อีกครั้งก่อนส่งยอด เพื่อกันยอดขาดวันนี้และเกินวันถัดไป'}
                </p>
                {openTableHasIssue && (openTableCheck.open_tables || []).length > 0 && (
                  <div className="open-table-list">
                    {(openTableCheck.open_tables || []).slice(0, 5).map((table) => (
                      <div className="open-table-row" key={`${table.cartNumber}-${table.openedAt}`}>
                        <span>โต๊ะ/บิล {table.cartNumber || '-'}</span>
                        <strong>{money(table.amount)}</strong>
                      </div>
                    ))}
                  </div>
                )}
                {openTableNeedsNote && (
                  <textarea
                    className="table-check-note"
                    rows={3}
                    placeholder="หมายเหตุ เช่น แจ้งหัวหน้าแล้ว / ลูกค้ายังนั่งอยู่ / เหตุผลที่ต้องส่งยอดก่อนปิดโต๊ะ"
                    value={tableCheckNote}
                    onChange={(event) => setTableCheckNote(event.target.value)}
                  />
                )}
                {openTableNeedsConfirmation && !openTableLoading && (
                  <label className="table-check-confirm">
                    <input
                      type="checkbox"
                      checked={tableCheckConfirmed}
                      onChange={(event) => setTableCheckConfirmed(event.target.checked)}
                    />
                    <span>
                      {openTableHasIssue
                        ? 'รับทราบโต๊ะค้างและใส่หมายเหตุให้หัวหน้าตรวจต่อ'
                        : 'ตรวจหน้า POS แล้ว ไม่มีโต๊ะค้างก่อนส่งยอด'}
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="cashier-summary">
            <span>ยอดขายรวมที่ระบบคาดไว้</span>
            <strong>{money(receipt.gross_sales_expected)}</strong>
          </div>

          <div className="cashier-card misc-items">
            <span className="cash-pad-label">เงินทอนที่รับตอนเช้า</span>
            <p className="misc-items-hint">
              กรอกจำนวนเงินทอนที่รับมาเปิดลิ้นชักตอนเช้า ระบบจะนำไปรวมกับ POS คาดไว้เพื่อดูว่าส่งยอดขาดหรือเกินเท่าไร
            </p>
            {editable ? (
              <input
                className="cashier-amount-input"
                inputMode="decimal"
                data-money-input="true"
                value={formatMoneyInput(morningChangeAmount)}
                onFocus={(event) => clearZeroMoneyOnFocus(event, setMorningChangeAmount)}
                onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: setMorningChangeAmount })}
                onPaste={(event) => handleNumericPaste(event, { onValue: setMorningChangeAmount })}
                onChange={(event) => setMorningChangeAmount(normalizeMoneyInput(event.target.value))}
              />
            ) : (
              <div className="cashier-amount-readonly">{money(receipt.morning_change_amount)}</div>
            )}
          </div>

          <div className="cashier-lines">
            {draftLines.map((line) => (
              <div className="cashier-line-card" key={line.id}>
                <div className="cashier-line-head">
                  <ChannelLabel line={line} />
                  <span>กรอกยอดที่รับจริง</span>
                </div>
                {editable && line.channel_code === 'CASH' ? (
                  <CashDenominationPad
                    key={`cash-${receipt.id}-${line.id}`}
                    initialValue={line.cashier_amount}
                    onTotalChange={(total) => updateLine(line.id, total)}
                  />
                ) : editable ? (
                  <input
                    className="cashier-amount-input"
                    inputMode="decimal"
                    data-money-input="true"
                    value={formatMoneyInput(line.cashier_amount)}
                    onFocus={(event) => clearZeroMoneyOnFocus(event, (value) => updateLine(line.id, value))}
                    onKeyDown={(event) => handleMoneyKeyDown(event, {
                      onValue: (value) => updateLine(line.id, value)
                    })}
                    onPaste={(event) => handleNumericPaste(event, {
                      onValue: (value) => updateLine(line.id, value)
                    })}
                    onChange={(event) => updateLine(line.id, normalizeMoneyInput(event.target.value))}
                  />
                ) : (
                  <div className="cashier-amount-readonly">{money(line.cashier_amount)}</div>
                )}
              </div>
            ))}
          </div>

          <div className="cashier-card misc-items">
            <span className="cash-pad-label">รายการอื่นๆ (รวมในยอดที่นับได้)</span>
            <p className="misc-items-hint">
              เช่น รายการรับเงินเพิ่มเติมหรือรายการปรับยอด ระบบจะบวกเข้ารวมที่นับได้ แต่ไม่รวมในยอดคาดไว้
            </p>

            {(receipt.misc_items || []).length > 0 && (
              <div className="misc-items-list">
                {receipt.misc_items.map((item) => (
                  <div className="misc-item-row" key={item.id}>
                    <span>{item.label}</span>
                    <strong>+{money(item.amount)}</strong>
                    {editable && (
                      <button
                        type="button"
                        className="misc-item-remove"
                        aria-label={`ลบ ${item.label}`}
                        onClick={() => removeMiscItem(item.id)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editable && (
              <>
                <div className="misc-item-presets">
                  {MISC_ITEM_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      className={`misc-preset-btn ${miscLabel === preset ? 'active' : ''}`}
                      onClick={() => setMiscLabel(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="misc-item-form">
                  <input
                    placeholder="ชื่อรายการ"
                    value={miscLabel}
                    onChange={(event) => setMiscLabel(event.target.value)}
                  />
                  <input
                    inputMode="decimal"
                    placeholder="จำนวนเงิน"
                    data-money-input="true"
                    value={formatMoneyInput(miscAmount)}
                    onFocus={(event) => clearZeroMoneyOnFocus(event, setMiscAmount)}
                    onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: setMiscAmount })}
                    onPaste={(event) => handleNumericPaste(event, { onValue: setMiscAmount })}
                    onChange={(event) => setMiscAmount(normalizeMoneyInput(event.target.value))}
                  />
                  <Button
                    icon={Plus}
                    variant="secondary"
                    busy={busy}
                    disabled={!miscLabel.trim() || !miscAmount}
                    onClick={addMiscItem}
                  >
                    เพิ่ม
                  </Button>
                </div>
              </>
            )}

            {miscTotal > 0 && (
              <div className="misc-items-total">
                <span>บวกเข้าในรวมที่นับได้</span>
                <strong>+{money(miscTotal)}</strong>
              </div>
            )}
          </div>

          <section className="cashier-attachments-area">
            <div className="cashier-attachments-head">
              <div>
                <span>เอกสารประกอบ</span>
                <h3>แนบเอกสารจากหน้าร้าน</h3>
              </div>
              <small>ถ่ายรูปหรือเลือกไฟล์แยกตามประเภท</small>
            </div>
            <div className="cashier-attachments-grid">
              <ReceiptAttachmentSection
                receiptId={receipt.id}
                type="cash_slip"
                title="สรุปยอดเงิน"
                hint="สรุปยอดรับเงินหรือสลิปเงินสด"
                Icon={Banknote}
                attachments={(receipt.attachments || []).filter((attachment) => attachment.attachment_type === 'cash_slip')}
                onUploaded={setReceipt}
                canUpload={editable}
              />
              <ReceiptAttachmentSection
                receiptId={receipt.id}
                type="cashier_summary"
                title="รูปสรุปรวมหน้าร้าน"
                hint="ถ่ายรูปสรุปหน้าร้านรวมได้ในครั้งเดียว"
                Icon={Camera}
                attachments={(receipt.attachments || []).filter((attachment) => attachment.attachment_type === 'cashier_summary')}
                onUploaded={setReceipt}
                cameraOnly
                canUpload={editable}
              />
              <ReceiptAttachmentSection
                receiptId={receipt.id}
                type="statement"
                title="สรุปบัตรเครดิต"
                hint="สลิปหรือรายงานบัตรเครดิต"
                Icon={CreditCard}
                attachments={(receipt.attachments || []).filter((attachment) => attachment.attachment_type === 'statement')}
                onUploaded={setReceipt}
                canUpload={editable}
              />
              <ReceiptAttachmentSection
                receiptId={receipt.id}
                type="other"
                title="บิลจ่ายอื่นๆ"
                hint="บิลหรือเอกสารประกอบรายการอื่น"
                Icon={FileSpreadsheet}
                attachments={(receipt.attachments || []).filter((attachment) => attachment.attachment_type === 'other')}
                onUploaded={setReceipt}
                canUpload={editable}
              />
            </div>
          </section>

          {error && <div className="error-box">{error}</div>}
          {message && <div className="success-box">{message}</div>}
        </>
      )}
    </section>
    {receipt && (
      <div className={`cashier-actionbar ${editable ? '' : 'is-readonly'}`}>
        <div className="cashier-actionbar-total">
          <span>รวมที่นับได้ (POS + เงินทอน {money(expectedTotal)})</span>
          <strong className={balanced ? 'amount-ok' : 'amount-bad'}>{money(enteredTotal)}</strong>
          <small className={balanced ? 'amount-ok' : 'amount-bad'}>ผลต่าง {varianceLabel}</small>
        </div>
        {editable ? (
          <div className="cashier-submit-box">
            {submitHint && <small className="cashier-submit-hint">{submitHint}</small>}
            <Button icon={Save} busy={busy} onClick={submit}>ส่งยอด</Button>
          </div>
        ) : (
          <div className="cashier-submitted-summary">
            <CheckCircle2 size={17} />
            <span>ส่งยอดแล้ว<br />รอฝ่ายตรวจ</span>
          </div>
        )}
      </div>
    )}
    </div>
  );
};

const ReceiptReminderNote = ({ user, receipt, onChanged, onDirtyChange }) => {
  const [note, setNote] = useState(receipt?.review_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = can(user, 'note');
  const savedNote = String(receipt?.review_note || '');
  const changed = note.trim() !== savedNote;

  useEffect(() => {
    setNote(receipt?.review_note || '');
    setError('');
  }, [receipt?.id, receipt?.review_note]);

  useEffect(() => {
    onDirtyChange?.(changed);
    return () => onDirtyChange?.(false);
  }, [changed, onDirtyChange]);

  const save = async () => {
    if (!receipt?.id || !editable || !changed) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.updateReviewNote(receipt.id, note);
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`receipt-reminder-note ${savedNote ? 'has-note' : ''}`} aria-label="บันทึกกันลืม">
      <header>
        <div>
          <span>บันทึกกันลืม</span>
          <small>{receipt.branch_name} • {formatThaiDate(receipt.receipt_date)}</small>
        </div>
        {receipt.review_note_updated_at && (
          <small>แก้ล่าสุดโดย {receipt.review_note_updated_by_name || '-'} • {formatThaiDateTime(receipt.review_note_updated_at)}</small>
        )}
      </header>
      <div className="receipt-reminder-note-editor">
        <textarea
          value={note}
          maxLength={1000}
          rows={2}
          readOnly={!editable}
          placeholder="พิมพ์เรื่องที่ต้องติดตามของวันนี้..."
          onChange={(event) => setNote(event.target.value)}
        />
        {editable && <Button icon={Save} busy={busy} disabled={!changed} onClick={save}>บันทึก</Button>}
      </div>
      {error && <div className="receipt-reminder-note-error">{error}</div>}
    </section>
  );
};

const Dashboard = ({
  user,
  branches,
  receipts,
  selected,
  filters,
  onFiltersChange,
  onLoad,
  onSelect,
  onReviewNoteDirtyChange,
  busy
}) => {
  const overviewMiscTotal = (selected?.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const overviewCashTotal = (selected?.lines || [])
    .filter((line) => line.channel_code === 'CASH')
    .reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const overviewNonCashTotal = (selected?.lines || [])
    .filter((line) => line.channel_code !== 'CASH')
    .reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const overviewCashierTotal = overviewCashTotal + overviewNonCashTotal + overviewMiscTotal;
  const overviewExpectedTotal = Number(selected?.gross_sales_expected || 0) + Number(selected?.morning_change_amount || 0);
  const overviewVariance = overviewCashierTotal - overviewExpectedTotal;
  // Never expose actions from the previous receipt while a new date is loading.
  const selectedIsVisible = receiptMatchesDashboardFilters(selected, filters);

  return (
    <section className="workspace dashboard-workspace has-selected-receipt">
      {selectedIsVisible && (
        <ReceiptReminderNote
          user={user}
          receipt={selected}
          onChanged={onSelect}
          onDirtyChange={onReviewNoteDirtyChange}
        />
      )}
      <aside className="dashboard-control-rail">
        <section className="dashboard-selector-shell">
          <div className="dashboard-filter-panel">
        <div className="dashboard-filter-row">
          <span className="dashboard-filter-label">สาขา</span>
          <div className="filter-chip-group">
            {branches.map((branch) => (
              <button
                type="button"
                key={branch.id}
                className={`filter-chip ${String(filters.branch_id) === String(branch.id) ? 'active' : ''}`}
                onClick={() => onFiltersChange({ ...filters, branch_id: String(branch.id) })}
              >
                {branch.name}
              </button>
            ))}
          </div>
        </div>
        <div className="dashboard-calendar-layout">
          <ReceiptDateCalendar
            branchId={filters.branch_id}
            date={filters.date}
            onDateChange={(date) => onFiltersChange({ ...filters, date })}
            refreshKey={receiptCalendarRefreshKey(receipts)}
          />
          <div className="dashboard-calendar-actions">
            <button type="button" className="icon-button" title="รีเฟรชข้อมูล" aria-label="รีเฟรชข้อมูล" disabled={busy || !filters.branch_id || !filters.date} onClick={onLoad}>
              <RefreshCw className={busy ? 'spin' : ''} size={18} />
            </button>
          </div>
        </div>
        </div>
        </section>
        <section className="dashboard-side-summary">
          {selectedIsVisible && <section className="dashboard-receipt-overview">
            <header>
              <div><h2>{selected.branch_name}</h2><p>{selected.receipt_date} • {selected.bill_count} บิล</p></div>
              <span className={statusClass(selected.status)}>{selected.status_label}</span>
            </header>
            <div className="summary-grid">
              <div><span>รวมที่แคชเชียร์กรอก</span><strong>{money(overviewCashierTotal)}</strong><small>POS + เงินทอน {money(overviewExpectedTotal)}</small></div>
              <div><span>ผลต่างแคชเชียร์</span><strong className={Math.abs(overviewVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}>{overviewVariance > 0 ? '+' : ''}{money(overviewVariance)}</strong><small>เทียบ POS + เงินทอน</small></div>
              <div><span>เงินสดที่กรอก</span><strong>{money(overviewCashTotal)}</strong><small>อ้างอิงยอดที่แคชเชียร์กรอก</small></div>
              <div><span>รายการอื่นๆ นับได้</span><strong>+{money(overviewMiscTotal)}</strong><small>แคชเชียร์เพิ่มเอง</small></div>
              <div><span>เงินทอนตอนเช้า</span><strong>{money(selected.morning_change_amount)}</strong><small>รวมคำนวณผลต่างเงินสด</small></div>
              <div><span>ไม่ใช่เงินสดที่กรอก</span><strong>{money(overviewNonCashTotal)}</strong><small>รวมช่องทางที่แคชเชียร์กรอก</small></div>
            </div>
          </section>}
          {selectedIsVisible && (
            <ReceiptDocumentsPanel
              attachments={(selected.attachments || []).filter((attachment) => attachment.uploaded_by_role === 'cashier')}
              defaultOpen
              className="dashboard-documents-panel"
            />
          )}
        </section>
      </aside>

      <section className="dashboard-work-area">
        <ReceiptDetail user={user} receipt={selectedIsVisible ? selected : null} onChanged={onSelect} compactHeader={selectedIsVisible} />
      </section>
    </section>
  );
};

const ReconciliationCard = ({ user, line, accounts, onLineChange, onChanged }) => {
  const settlementRequired = ['grab', 'credit_card'].includes(line.channel_kind);
  const eligibleAccounts = accounts.filter((account) =>
    account.channel_ids.includes(Number(line.payment_channel_id)) &&
    (!account.branch_id || Number(account.branch_id) === Number(line.branch_id) ||
      (account.additional_route_keys || []).includes(`${Number(line.branch_id)}:${Number(line.payment_channel_id)}`))
  );
  const cashierBaseAmount = Number(line.cashier_amount || 0);
  const hasSavedSettlement = Boolean(line.receiving_account_id && line.expected_net_amount !== null && line.expected_net_amount !== undefined);
  const defaultGrossAmount = hasSavedSettlement ? Number(line.expected_gross_amount || cashierBaseAmount) : cashierBaseAmount;
  const defaultFeeAmount = Number(line.fee_amount || 0);
  const defaultNetAmount = hasSavedSettlement ? Number(line.expected_net_amount || 0) : Math.max(cashierBaseAmount - defaultFeeAmount, 0);
  const [accountId, setAccountId] = useState(String(line.receiving_account_id || eligibleAccounts[0]?.id || ''));
  const [settlement, setSettlement] = useState({
    gross_amount: String(defaultGrossAmount || ''),
    fee_amount: String(defaultFeeAmount || ''),
    net_amount: String(defaultNetAmount || '')
  });
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [statementFile, setStatementFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedHashes, setSelectedHashes] = useState(new Set());
  const [customerDepositHashes, setCustomerDepositHashes] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [optimisticallyChecked, setOptimisticallyChecked] = useState(false);

  useEffect(() => {
    setAccountId(String(line.receiving_account_id || eligibleAccounts[0]?.id || ''));
    setSettlement({
      gross_amount: String(defaultGrossAmount || ''),
      fee_amount: String(defaultFeeAmount || ''),
      net_amount: String(defaultNetAmount || '')
    });
    setEvidenceFile(null);
    setStatementFile(null);
    setPreview(null);
    setSelectedHashes(new Set());
    setCustomerDepositHashes(new Set());
    setError('');
    setOptimisticallyChecked(false);
  }, [line.id]);

  const expectedNet = defaultNetAmount;
  const actualAmount = Number(line.statement_amount || 0);
  const comparisonAmount = expectedNet;
  const displayedActualAmount = line.channel_code === 'GRAB' && optimisticallyChecked ? expectedNet : actualAmount;
  const variance = displayedActualAmount - comparisonAmount;
  const manualChecked = Boolean(line.manual_checked_without_reference);
  const grabCashierReferenceAmount = Number(line.grab_cashier_reference_amount || 0);
  const grabMatched = line.channel_code === 'GRAB' && actualAmount > 0 && Math.abs(variance) < 0.01;
  const channelChecked = manualChecked || grabMatched || optimisticallyChecked;
  const checkable = can(user, 'check') && ['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(line.receipt_status || 'SUBMITTED');
  const [expanded, setExpanded] = useState(!channelChecked);

  useEffect(() => {
    setExpanded(!channelChecked);
  }, [line.id, channelChecked]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveSettlement = () => run(() => api.saveSettlement(line.id, {
    receiving_account_id: accountId,
    gross_amount: settlement.gross_amount,
    fee_amount: settlement.fee_amount,
    net_amount: settlement.net_amount
  }));

  const uploadEvidence = () => run(async () => {
    const next = await api.uploadSettlementEvidence(line.id, evidenceFile);
    const updatedLine = (next.lines || []).find((item) => Number(item.id) === Number(line.id));
    if (updatedLine) {
      setSettlement({
        gross_amount: String(Number(updatedLine.expected_gross_amount || 0) || ''),
        fee_amount: String(Number(updatedLine.fee_amount || 0) || ''),
        net_amount: String(Number(updatedLine.expected_net_amount || 0) || '')
      });
    }
    return next;
  });
  const toggleManualCheck = () => {
    if (line.channel_code !== 'GRAB') {
      return run(() => api.manualCheckWithoutReference(line.id, !manualChecked));
    }
    setOptimisticallyChecked(true);
    return run(async () => {
      try {
        return await api.confirmGrabReport(line.id);
      } catch (err) {
        setOptimisticallyChecked(false);
        throw err;
      }
    });
  };
  const previewStatement = async () => {
    if (!accountId || !statementFile) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.previewStatement({ receiptLineId: line.id, receivingAccountId: accountId, file: statementFile });
      setPreview(next);
      setSelectedHashes(new Set(next.default_hashes || []));
      setCustomerDepositHashes(new Set());
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmStatement = () => run(() => api.confirmStatement({
    receiptLineId: line.id,
    receivingAccountId: accountId,
    selectedHashes: [...selectedHashes],
    customerDepositHashes: [...customerDepositHashes],
    file: statementFile
  }));

  const toggleHash = (hash) => {
    setSelectedHashes((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else {
        next.add(hash);
        setCustomerDepositHashes((deposits) => {
          const nextDeposits = new Set(deposits);
          nextDeposits.delete(hash);
          return nextDeposits;
        });
      }
      return next;
    });
  };

  const toggleCustomerDeposit = (hash) => {
    setCustomerDepositHashes((current) => {
      const next = new Set(current);
      if (next.has(hash)) next.delete(hash);
      else {
        next.add(hash);
        setSelectedHashes((selected) => {
          const nextSelected = new Set(selected);
          nextSelected.delete(hash);
          return nextSelected;
        });
      }
      return next;
    });
  };

  const selectedTotal = (preview?.rows || [])
    .filter((row) => selectedHashes.has(row.uniqueHash))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const customerDepositTotal = (preview?.rows || [])
    .filter((row) => customerDepositHashes.has(row.uniqueHash))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <article className={`reconciliation-card ${Math.abs(variance) < 0.01 || channelChecked ? 'is-balanced' : 'has-variance'} ${channelChecked ? 'is-manual-checked' : ''} ${expanded ? '' : 'is-collapsed'}`}>
      <header className="reconciliation-card-head">
        <ChannelLabel line={line} />
        <div className="reconciliation-card-actions">
          <span className={`settlement-stamp ${channelChecked ? 'checked-stamp' : `settlement-${String(line.settlement_status || 'READY_FOR_STATEMENT').toLowerCase()}`} `}>
            {channelChecked ? 'ตรวจแล้ว' : line.settlement_status === 'MATCHED_AUTO' ? 'ตรงอัตโนมัติ' : line.settlement_status === 'MATCHED_MANUAL' ? 'ยืนยันแล้ว' : line.settlement_status === 'EXCEPTION' ? 'มีส่วนต่าง' : 'รอตรวจ'}
          </span>
          {can(user, 'check') && line.channel_code !== 'CASH' && (
            <button
              type="button"
              className={`manual-check-btn ${channelChecked ? 'active' : ''}`}
              disabled={busy || !checkable || (line.channel_code === 'GRAB' && channelChecked)}
              onClick={toggleManualCheck}
            >
              <CheckCircle2 size={15} />
              <span>{channelChecked ? 'ติ๊กแล้ว' : 'ตรวจแล้ว'}</span>
            </button>
          )}
          <button type="button" className="reconciliation-collapse-btn" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? 'ย่อ' : 'แก้ไข'}
            {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>
        </div>
      </header>

      <div className="reconciliation-amounts">
        <div><span>ยอดแคชเชียร์กรอก</span><strong>{money(cashierBaseAmount)}</strong></div>
        {settlementRequired && <div><span>ค่าธรรมเนียม</span><strong>-{money(line.fee_amount)}</strong></div>}
        {line.channel_code !== 'GRAB' && <div><span>ยอดสุทธิที่ควรเข้า</span><strong>{money(expectedNet)}</strong></div>}
        {line.channel_code === 'GRAB' && grabCashierReferenceAmount > 0 && Math.abs(cashierBaseAmount - grabCashierReferenceAmount) >= 0.01 && (
          <div className="grab-report-amount"><span>ยอดอ้างอิงแคชเชียร์จาก Grab</span><strong>{money(grabCashierReferenceAmount)}</strong></div>
        )}
        <div><span>เงินเข้าที่จับคู่</span><strong>{money(displayedActualAmount)}</strong></div>
        <div className={Math.abs(variance) < 0.01 ? 'amount-ok' : 'amount-bad'}><span>ผลต่าง</span><strong>{variance > 0 ? '+' : ''}{money(variance)}</strong></div>
      </div>

      {can(user, 'check') && line.channel_code !== 'CASH' && (
        <div className="reconciliation-workflow">
          <label className="field">
            <span>บัญชีรับเงินจริง</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy}>
              <option value="">เลือกบัญชี</option>
              {eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          {eligibleAccounts.length === 0 && <p className="workflow-warning">ยังไม่มีบัญชีที่ผูกกับช่องทางนี้ ให้เพิ่มจากหน้าตั้งค่า</p>}

          {settlementRequired && (
            <div className="settlement-flow">
              <div className="settlement-inputs">
                <Field label="ยอดขายขั้นต้น (ยอดอ้างอิงหลัก)"><input inputMode="decimal" value={formatMoneyInput(settlement.gross_amount)} onChange={(event) => setSettlement({ ...settlement, gross_amount: normalizeMoneyInput(event.target.value) })} /></Field>
                <Field label="ค่าธรรมเนียม"><input inputMode="decimal" value={formatMoneyInput(settlement.fee_amount)} onChange={(event) => setSettlement({ ...settlement, fee_amount: normalizeMoneyInput(event.target.value) })} /></Field>
                <Field label="ยอดสุทธิที่ต้องโอน"><input inputMode="decimal" value={formatMoneyInput(settlement.net_amount)} onChange={(event) => setSettlement({ ...settlement, net_amount: normalizeMoneyInput(event.target.value) })} /></Field>
                <Button icon={Save} variant="secondary" busy={busy} disabled={!accountId} onClick={saveSettlement}>บันทึก settlement</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {can(user, 'check') && Math.abs(variance) >= 0.01 && (
        <div className="exception-row">
          <select value={line.exception_category || ''} onChange={(event) => onLineChange(line.id, { exception_category: event.target.value })}>
            <option value="">เลือกเหตุผลส่วนต่าง</option>
            <option value="PENDING_SETTLEMENT">รอ settlement</option>
            <option value="REFUND">คืนเงิน</option>
            <option value="UNRELATED">ยอดไม่เกี่ยวข้อง</option>
            <option value="OTHER">อื่นๆ</option>
          </select>
          <input value={line.variance_reason || ''} placeholder="อธิบายเหตุผลส่วนต่าง" onChange={(event) => onLineChange(line.id, { variance_reason: event.target.value })} />
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
    </article>
  );
};

const IncomingAmountCalculator = ({ user, lines, onLineChange, onSave, busy }) => {
  const incomingLines = lines.filter((line) => line.channel_code !== 'CASH');
  const expectedTotal = incomingLines.reduce(
    (sum, line) => sum + expectedIncomingAmount(line),
    0
  );
  const actualTotal = incomingLines.reduce((sum, line) => sum + Number(line.statement_amount || 0), 0);
  const variance = actualTotal - expectedTotal;
  const changed = incomingLines.some((line) => !moneyValuesEqual(line.statement_amount, line.original_statement_amount));

  return (
    <aside className="incoming-calculator">
      <div className="incoming-calculator-head">
        <div>
          <span>เครื่องคิดเลข</span>
          <h3>ยอดเงินเข้าจริง</h3>
        </div>
        <Landmark size={20} />
      </div>
      <div className="incoming-calculator-table" role="table" aria-label="ตารางยอดเงินเข้าจริง">
        <div className="incoming-calculator-row table-head" role="row">
          <span>ช่องทาง</span><span>ควรเข้า</span><span>เงินเข้า</span>
        </div>
        {incomingLines.map((line) => {
          const expected = expectedIncomingAmount(line);
          return (
            <div className="incoming-calculator-row" role="row" key={line.id}>
              <span title={line.channel_label}>{line.channel_label}</span>
              <strong>{money(expected)}</strong>
              <input
                aria-label={`เงินเข้าจริง ${line.channel_label}`}
                inputMode="decimal"
                data-money-input="true"
                disabled={!can(user, 'check') || busy}
                value={formatMoneyInput(line.statement_amount)}
                onFocus={(event) => clearZeroMoneyOnFocus(event, (value) => onLineChange(line.id, { statement_amount: value }))}
                onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: (value) => onLineChange(line.id, { statement_amount: value }) })}
                onPaste={(event) => handleNumericPaste(event, { onValue: (value) => onLineChange(line.id, { statement_amount: value }) })}
                onChange={(event) => onLineChange(line.id, { statement_amount: normalizeMoneyInput(event.target.value) })}
              />
            </div>
          );
        })}
      </div>
      <div className="incoming-calculator-total">
        <span>รวมยอดที่ควรเข้า</span><strong>{money(expectedTotal)}</strong>
        <span>รวมเงินเข้าที่กรอก</span><strong>{money(actualTotal)}</strong>
        <span className={Math.abs(variance) < 0.01 ? 'amount-ok' : 'amount-bad'}>ผลต่าง</span>
        <strong className={Math.abs(variance) < 0.01 ? 'amount-ok' : 'amount-bad'}>{variance > 0 ? '+' : ''}{money(variance)}</strong>
      </div>
      {can(user, 'check') && <Button icon={Save} variant="secondary" busy={busy} disabled={!changed} onClick={onSave}>บันทึกยอดเงินจริง</Button>}
    </aside>
  );
};

const EvidenceAttachmentButton = ({ attachment, focusDate, focusAmount, focusLabel }) => {
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(null);

  const closeViewer = () => {
    if (viewer?.objectUrl) URL.revokeObjectURL(viewer.objectUrl);
    setViewer(null);
  };

  useEffect(() => () => {
    if (viewer?.objectUrl) URL.revokeObjectURL(viewer.objectUrl);
  }, [viewer?.objectUrl]);

  const openEvidence = async () => {
    setBusy(true);
    try {
      const variant = attachment.document_available ? 'document' : 'original';
      const file = await api.attachmentFile(attachment.id, variant, { focusDate, focusAmount });
      const mimeType = file.blob.type || attachment.document_mime_type || attachment.mime_type;
      let displayBlob = file.blob;
      let htmlFocusFound = false;
      if (String(mimeType || '').toLowerCase().startsWith('text/html')) {
        const focused = await focusEvidenceHtml(file.blob, { date: focusDate, amount: focusAmount });
        displayBlob = focused.blob;
        htmlFocusFound = focused.found;
      }
      const objectUrl = URL.createObjectURL(displayBlob);
      const amountLabel = Number(focusAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const pdfFocus = String(mimeType || '').toLowerCase().startsWith('application/pdf') && file.focusPage;
      const url = pdfFocus
        ? `${objectUrl}#page=${file.focusPage}&zoom=page-width&search=${encodeURIComponent(amountLabel)}`
        : htmlFocusFound ? `${objectUrl}#evidence-focus-row` : objectUrl;
      setViewer({
        url,
        objectUrl,
        blob: file.blob,
        focusPage: file.focusPage,
        name: file.fileName || attachment.original_name,
        mimeType,
        focusSummary: (pdfFocus || htmlFocusFound)
          ? `ไปยังรายการ ${focusLabel || ''} วันที่ ${focusDate} ยอด ${amountLabel} บาท${pdfFocus ? ` • หน้า ${file.focusPage}` : ''}`
          : ''
      });
    } catch (error) {
      if (!error.authExpired) window.alert(error.message || 'เปิดหลักฐานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="matrix-evidence-btn"
        title={`เปิดหลักฐานที่ใช้จับคู่: ${attachment.original_name}`}
        aria-label={`เปิดหลักฐานที่ใช้จับคู่ ${attachment.original_name}`}
        disabled={busy}
        onClick={openEvidence}
      >
        {busy ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}
        <span>{busy ? 'กำลังเปิด' : 'หลักฐาน'}</span>
      </button>
      <AttachmentViewerModal viewer={viewer} onClose={closeViewer} title="หลักฐานที่ใช้จับคู่" />
    </>
  );
};

const ReconciliationMatrix = ({ user, lines, attachments = [], statementTransactions = [], miscItems = [], receiptDate, grossSalesExpected, miscTotal, morningChangeAmount, onLineChange, onChanged, onSaveCashierLine, onAdjustClosed, adjustingLineId, renderPostCloseEditor, busy }) => {
  const [checkingLineId, setCheckingLineId] = useState(null);
  const [savingAdjustmentLineId, setSavingAdjustmentLineId] = useState(null);
  const [savedAdjustmentLineId, setSavedAdjustmentLineId] = useState(null);
  const [classifyingTransactionId, setClassifyingTransactionId] = useState(null);
  const [expandedLineId, setExpandedLineId] = useState(null);
  const [error, setError] = useState('');
  const isClosed = lines.some((line) => line.receipt_status === 'CLOSED');
  const canCheck = can(user, 'check') && !isClosed;
  const canAdjustClosed = isClosed && ['auditor', 'recorder', 'admin'].includes(user?.role);
  const CalculationContainer = isClosed ? 'details' : 'div';
  const displayLines = [
    ...lines.filter((line) => line.channel_code !== 'CASH'),
    ...lines.filter((line) => line.channel_code === 'CASH')
  ];

  const morningChange = Number(morningChangeAmount || 0);
  const countedMisc = Number(miscTotal || 0);
  const miscExpanded = expandedLineId === 'MISC_COUNTED';
  const lineFeeBreakdown = (line) => buildLineSettlementAmounts({
    channelCode: line.channel_code,
    cashierAmount: line.cashier_amount,
    expectedGrossAmount: line.expected_gross_amount,
    feeAmount: line.fee_amount,
    expectedNetAmount: line.expected_net_amount,
    statementAmount: line.statement_amount,
    matchedAmount: line.matched_amount,
    evidenceAttachmentId: line.evidence_attachment_id,
    settlementSource: line.settlement_source,
    settlementBatchKey: line.settlement_batch_key,
    settlementBatchAllocatedFeeAmount: line.settlement_batch_allocated_fee_amount,
    settlementBatchAllocatedNetAmount: line.settlement_batch_allocated_net_amount
  });
  const lineExpectedAmount = (line) => lineFeeBreakdown(line).net;
  const lineActualAmount = (line) => buildLineEvidenceReconciliation(line).actual;
  const hasAnySettlementBatch = lines.some((line) => line.settlement_batch_key);
  const cashierLineTotal = lines.reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const grossBeforeFeeTotal = roundCurrency(lines.reduce((sum, line) => sum + lineFeeBreakdown(line).gross, 0));
  const feeColumnTotal = lines.reduce((sum, line) => sum + lineFeeBreakdown(line).fee, 0);
  const actualColumnTotal = roundCurrency(lines.reduce((sum, line) => sum + lineActualAmount(line), 0));
  const adjustmentColumnTotal = roundCurrency(lines.reduce((sum, line) => sum + effectiveLineAdjustment(line), 0));
  const {
    cashierTotal: cashierColumnTotal,
    posWithChangeTotal,
    recoveredTotal,
    cashierVsPosVariance,
    settlementVsCashierVariance,
    endToEndVariance
  } = buildReconciliationSummary({
    grossSalesExpected: Number(grossSalesExpected || 0),
    morningChange,
    cashierLineTotal,
    miscAdjustmentTotal: countedMisc,
    lineAdjustmentTotal: adjustmentColumnTotal,
    actualMoneyTotal: actualColumnTotal,
    deductionTotal: feeColumnTotal
  });
  const varianceResult = (value) => {
    if (Math.abs(value) < 0.01) return { label: 'ครบ 0.00', className: 'amount-ok' };
    return {
      label: value > 0 ? `เกิน ${money(value)}` : `ขาด ${money(Math.abs(value))}`,
      className: 'amount-bad'
    };
  };
  const cashierVsPosResult = varianceResult(cashierVsPosVariance);
  const settlementVsCashierResult = varianceResult(settlementVsCashierVariance);
  const endToEndResult = varianceResult(endToEndVariance);
  const diagnosis = Math.abs(cashierVsPosVariance) < 0.01 && Math.abs(settlementVsCashierVariance) < 0.01
    ? 'ยอด POS ยอดแคชเชียร์ และเงินเข้าจริงครบตรงกัน'
    : Math.abs(settlementVsCashierVariance) < 0.01
      ? `เงินเข้าครบตามที่แคชเชียร์ส่ง แต่ต่างจาก POS ${money(Math.abs(endToEndVariance))} บาท ตรวจการนับเงินและรายการปรับปรุง`
      : Math.abs(cashierVsPosVariance) < 0.01
        ? `แคชเชียร์ตรงกับ POS แต่เงินเข้าจริงต่าง ${money(Math.abs(settlementVsCashierVariance))} บาท ตรวจเงินสดและ statement`
        : 'พบส่วนต่างทั้งก่อนและหลังเงินเข้า ตรวจจากรายช่องทางที่ขึ้นสีแดงหรือสีเหลือง';

  const markChecked = async (line) => {
    if (!canCheck) return;
    setCheckingLineId(line.id);
    setError('');
    try {
      const cashierChanged = !moneyValuesEqual(line.cashier_amount, line.original_cashier_amount ?? line.cashier_amount);
      const statementChanged = !moneyValuesEqual(line.statement_amount, line.original_statement_amount ?? line.statement_amount);
      const adjustmentChanged = !moneyValuesEqual(
        line.reconciliation_adjustment_amount,
        line.original_reconciliation_adjustment_amount ?? line.reconciliation_adjustment_amount
      );
      const reviewPayload = {
        ...(cashierChanged ? { cashier_amount: line.cashier_amount } : {}),
        ...(statementChanged ? { statement_amount: line.statement_amount } : {}),
        ...(adjustmentChanged ? { reconciliation_adjustment_amount: line.reconciliation_adjustment_amount } : {}),
        variance_reason: line.variance_reason || ''
      };
      const next = line.channel_code === 'GRAB'
        ? await api.confirmGrabReport(line.id, reviewPayload)
        : await api.manualCheckWithoutReference(line.id, true, {
            ...reviewPayload
          });
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setCheckingLineId(null);
    }
  };

  const saveAdjustment = async (line) => {
    if (!canCheck) return;
    const adjustmentAmount = Number(line.reconciliation_adjustment_amount || 0);
    const reason = String(line.variance_reason || '').trim();
    if (Math.abs(adjustmentAmount) >= 0.01 && !reason) {
      setError(`กรุณาระบุเหตุผลยอดเข้า/ออกปรับปรุงของ ${line.channel_label}`);
      setExpandedLineId(line.id);
      return;
    }
    setSavingAdjustmentLineId(line.id);
    setSavedAdjustmentLineId(null);
    setError('');
    try {
      const next = await api.updateReconciliationAdjustment(line.id, {
        reconciliation_adjustment_amount: line.reconciliation_adjustment_amount || 0,
        variance_reason: reason,
        exception_category: line.exception_category || ''
      });
      setSavedAdjustmentLineId(line.id);
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setSavingAdjustmentLineId(null);
    }
  };

  const classifyPendingIncome = async (transaction, classification) => {
    let note = '';
    let amount;
    if (classification === 'confirm_income' && !window.confirm(`ยืนยันเงินเข้าจริง ${money(transaction.amount)} บาท`)) {
      return;
    }
    if (classification === 'edit_income') {
      const input = window.prompt('แก้ไขยอดเงินจริง', Number(transaction.amount || 0).toFixed(2));
      if (input === null) return;
      const parsed = Number(String(input).replaceAll(',', '').trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('ยอดเงินจริงไม่ถูกต้อง');
        return;
      }
      classification = 'confirm_income';
      amount = parsed;
    }
    if (classification === 'other_date_branch') {
      note = window.prompt('ระบุวันที่หรือสาขาที่เกี่ยวข้องกับเงินเข้ารายการนี้') || '';
      if (!note.trim()) return;
    }
    setClassifyingTransactionId(transaction.id);
    setError('');
    try {
      const next = await api.classifyStatementTransaction(transaction.id, { classification, note, amount });
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setClassifyingTransactionId(null);
    }
  };

  return (
    <section className={`reconciliation-matrix ${isClosed ? 'is-closed' : ''}`}>
      <header className="reconciliation-matrix-head">
        <div>
          <h3>กระทบยอดรายช่องทาง</h3>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="reconciliation-matrix-scroll">
        <div className="reconciliation-matrix-table" role="table" aria-label="ตารางกระทบยอดรายช่องทาง">
          <div className="reconciliation-matrix-row matrix-table-head" role="row">
            <span>ช่องทาง</span><span>แคชเชียร์กรอก</span><span>ก่อนรายการหัก</span><span>รายการหักสุทธิ</span><span>เงินเข้าจริง (สุทธิ)</span><span>สถานะ</span><span>{isClosed ? 'ปรับปรุงสะสม' : 'ยอดเข้า/ออกปรับปรุง'}</span>
          </div>
          {displayLines.map((line) => {
            const secondaryIncome = statementTransactions.filter((transaction) => (
              Number(transaction.payment_channel_id) === Number(line.payment_channel_id)
              && Number(transaction.merchant_is_primary) === 0
            ));
            const pendingIncome = secondaryIncome.filter((transaction) => transaction.match_status === 'unmatched');
            const includedSecondaryIncome = secondaryIncome.filter((transaction) => transaction.match_status === 'matched_manual');
            const pendingIncomeTotal = pendingIncome.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
            const includedSecondaryIncomeTotal = includedSecondaryIncome.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
            const evidenceResult = buildLineEvidenceReconciliation(line);
            const expected = evidenceResult.net;
            const feeBreakdown = evidenceResult;
            const actual = evidenceResult.actual;
            const bankActual = evidenceResult.bankActual;
            const hasSettlementBatch = Boolean(line.settlement_batch_key);
            const totalKplusIncome = Number(evidenceResult.net || 0)
              + secondaryIncome.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
            const cashierReferenceVariance = evidenceResult.cashierVariance;
            const settlementVariance = evidenceResult.settlementVariance;
            const hasEvidenceVariance = evidenceResult.hasVariance;
            const adjustmentAmount = effectiveLineAdjustment(line);
            const adjustedSettlementVariance = roundCurrency(settlementVariance + adjustmentAmount);
            const hasReviewVariance = hasEvidenceVariance || Math.abs(adjustmentAmount) >= 0.01;
            const hasLineData = [line.cashier_amount, feeBreakdown.gross, feeBreakdown.fee, actual, adjustmentAmount]
              .some((value) => Math.abs(Number(value || 0)) >= 0.01);
            const actualIsMissing = expected > 0 && Number(line.statement_amount || 0) <= 0;
            const comparisonTone = actualIsMissing ? 'is-missing' : Math.abs(settlementVariance) < 0.01 ? '' : 'is-mismatch';
            const grabCashierReferenceAmount = Number(line.grab_cashier_reference_amount || 0);
            const grabReport = line.grab_report_payload || {};
            const hasGrabReference = line.channel_code === 'GRAB' && grabCashierReferenceAmount > 0;
            const grabReferenceMatchesCashier = hasGrabReference && Math.abs(Number(line.cashier_amount || 0) - grabCashierReferenceAmount) < 0.01;
            const checked = Boolean(line.manual_checked_without_reference) || ['MATCHED_AUTO', 'MATCHED_MANUAL'].includes(line.settlement_status);
            const awaitingEvidence = isManualReviewAwaitingEvidence(line);
            const expanded = expandedLineId === line.id;
            const cashierLineChanged = !moneyValuesEqual(line.cashier_amount, line.original_cashier_amount ?? line.cashier_amount);
            const evidenceAttachmentId = Number(line.evidence_attachment_id || 0);
            const evidenceAttachment = evidenceAttachmentId > 0
              ? attachments.find((attachment) => Number(attachment.id) === evidenceAttachmentId) || {
                  id: evidenceAttachmentId,
                  original_name: `หลักฐาน ${line.channel_label}`,
                  document_available: true
                }
              : null;
            return (
              <div className={`matrix-line ${adjustingLineId === line.id ? 'is-adjusting' : ''}`} key={line.id}>
                <div className={`reconciliation-matrix-row ${!hasLineData ? 'is-empty' : awaitingEvidence ? 'awaiting-evidence' : !hasReviewVariance ? 'is-balanced' : 'has-variance'}`} role="row">
                  <div className="matrix-channel"><ChannelLabel line={line} /></div>
                  <div className="matrix-money-input matrix-cashier">
                    {isClosed ? <strong className="matrix-readonly-amount">{money(line.cashier_amount)}</strong> : <><button
                      type="button"
                      className={`matrix-inline-update-btn ${cashierLineChanged ? 'is-visible' : ''}`}
                      title="ปรับปรุงยอดแคชเชียร์"
                      disabled={!cashierLineChanged || busy}
                      onClick={() => onSaveCashierLine(line)}
                    >
                      <Save size={14} /> <span>ปรับปรุง</span>
                    </button>
                    <input
                      aria-label={`ยอดแคชเชียร์ ${line.channel_label}`}
                      inputMode="decimal"
                      data-money-input="true"
                      disabled={!canCheck || busy}
                      value={formatMoneyInput(line.cashier_amount)}
                      onFocus={(event) => clearZeroMoneyOnFocus(event, (value) => onLineChange(line.id, { cashier_amount: value }))}
                      onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: (value) => onLineChange(line.id, { cashier_amount: value }) })}
                      onPaste={(event) => handleNumericPaste(event, { onValue: (value) => onLineChange(line.id, { cashier_amount: value })})}
                      onChange={(event) => onLineChange(line.id, { cashier_amount: normalizeMoneyInput(event.target.value) })}
                    />
                    </>}
                  </div>
                  <div className="matrix-expected matrix-gross">
                    <strong>{Math.abs(feeBreakdown.gross) >= 0.01 ? money(feeBreakdown.gross) : ''}</strong>
                    {line.channel_code === 'GRAB' && (!isClosed || hasLineData) && (
                      <>
                        <small className={hasGrabReference ? (grabReferenceMatchesCashier ? 'amount-ok' : 'amount-bad') : 'grab-reference-pending'}>
                          {hasGrabReference
                            ? `รายงาน Grab ${money(grabCashierReferenceAmount)}${grabReferenceMatchesCashier ? ' ตรงกับแคชเชียร์' : ' ต่างจากแคชเชียร์'}`
                            : 'ยังไม่พบรายงาน Grab'}
                        </small>
                        {Number(grabReport.gross_amount || 0) > 0 && (
                          <small>ยอดรายการ {money(grabReport.gross_amount)} - โปรโมชันร้าน {money(grabReport.merchant_promotion_amount)}</small>
                        )}
                      </>
                    )}
                  </div>
                  <div className="matrix-expected matrix-fee"><strong>{Math.abs(feeBreakdown.fee) >= 0.01 ? signedDeduction(feeBreakdown.fee) : ''}</strong></div>
                  <div className={`matrix-money-input matrix-actual ${comparisonTone}`}>
                    {line.channel_code === 'QR_KPLUS' && secondaryIncome.length > 0 ? (
                      <span className="kplus-actual-split">
                        <strong className="kplus-actual-total">
                          <em>ยอดรวม</em><b>{money(totalKplusIncome)}</b>
                        </strong>
                        <small><em>ยอดหลัก</em><b>{money(feeBreakdown.net)}</b></small>
                        {secondaryIncome.map((transaction) => (
                          <small className={transaction.match_status === 'unmatched' ? 'is-pending' : 'is-confirmed'} key={transaction.id}>
                            <em>ยอดเพิ่ม</em><b>{money(transaction.amount)}</b>
                          </small>
                        ))}
                      </span>
                    ) : isClosed ? <strong className="matrix-readonly-amount">{money(actual)}</strong> : (
                      <input
                        aria-label={`เงินเข้าจริง ${line.channel_label}`}
                        inputMode="decimal"
                        data-money-input="true"
                        disabled={!canCheck || busy}
                        value={formatMoneyInput(line.statement_amount)}
                        onFocus={(event) => clearZeroMoneyOnFocus(event, (value) => onLineChange(line.id, { statement_amount: value }))}
                        onKeyDown={(event) => handleMoneyKeyDown(event, { onValue: (value) => onLineChange(line.id, { statement_amount: value }) })}
                        onPaste={(event) => handleNumericPaste(event, { onValue: (value) => onLineChange(line.id, { statement_amount: value })})}
                        onChange={(event) => onLineChange(line.id, { statement_amount: normalizeMoneyInput(event.target.value) })}
                      />
                    )}
                    {line.channel_code !== 'CASH' && !moneyValuesEqual(actual, feeBreakdown.net) && (
                      <small className="matrix-suggestion">ควรเข้าหลังหัก {money(feeBreakdown.net)}</small>
                    )}
                    {hasSettlementBatch && (
                      <small className="matrix-suggestion">
                        เงินเข้าวันนี้ {money(bankActual)} • จัดสรรรอบรวม {money(feeBreakdown.net)}
                      </small>
                    )}
                    {line.grab_report_suggested && <small className="matrix-suggestion">นำร่องจากรายงาน Grab</small>}
                    {line.channel_code === 'CASH' && morningChange > 0 && (
                      <small className="matrix-suggestion">เงินทอนแยกแสดงด้านล่าง</small>
                    )}
                  </div>
                  <div className="matrix-status">
                    {!hasLineData ? <span className="amount-muted">ไม่มีรายการ</span> : awaitingEvidence ? (
                      <div className="matrix-evidence-pending" role="status" title="ตรวจด้วยมือ ยังไม่มีหลักฐานผูกเพื่อยืนยันเงินเข้า">
                        <Clock3 size={16} aria-hidden="true" />
                        <span>{EVIDENCE_PENDING_LABEL}</span>
                      </div>
                    ) : (
                      <div className="matrix-variance-pair">
                        {hasSettlementBatch ? (
                          <span className="settlement-batch-badge">ตรงแบบรวม 2 วัน</span>
                        ) : (
                          <>
                            <span className={Math.abs(cashierReferenceVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}>
                              แคชเชียร์ {Math.abs(cashierReferenceVariance) < 0.01 ? 'ตรง' : `${cashierReferenceVariance > 0 ? '+' : ''}${money(cashierReferenceVariance)}`}
                            </span>
                            <span className={Math.abs(settlementVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}>
                              เงินเข้า {Math.abs(settlementVariance) < 0.01 ? 'ตรง' : `${settlementVariance > 0 ? '+' : ''}${money(settlementVariance)}`}
                            </span>
                          </>
                        )}
                        {pendingIncome.length > 0 && <span className="pending-income-badge">เงินเข้าเพิ่มรอยืนยัน {money(pendingIncomeTotal)}</span>}
                        {includedSecondaryIncome.length > 0 && <span className="included-secondary-income-badge">เงินเข้าเพิ่มยืนยันแล้ว {money(includedSecondaryIncomeTotal)}</span>}
                        {Math.abs(adjustmentAmount) >= 0.01 && (
                          <span className={Math.abs(adjustedSettlementVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}>
                            หลังปรับ {Math.abs(adjustedSettlementVariance) < 0.01 ? 'ตรง' : `${adjustedSettlementVariance > 0 ? '+' : ''}${money(adjustedSettlementVariance)}`}
                          </span>
                        )}
                      </div>
                    )}
                    {canCheck && !checked && (
                      <button type="button" className={`manual-check-btn ${checked ? 'active' : ''}`} disabled={busy || checkingLineId === line.id || (line.channel_code === 'GRAB' && checked)} onClick={() => markChecked(line)}>
                        <span>ตรวจแล้ว</span>
                      </button>
                    )}
                    {checked && !awaitingEvidence && (
                      <span className="manual-check-indicator" title="ตรวจแล้ว" aria-label="ตรวจแล้ว">
                        <Check size={18} strokeWidth={3} />
                      </span>
                    )}
                    {evidenceAttachment && <EvidenceAttachmentButton
                      attachment={evidenceAttachment}
                      focusDate={String(line.settlement_date || receiptDate || '').slice(0, 10)}
                      focusAmount={Math.abs(Number(bankActual || 0)) >= 0.01 ? bankActual : actual}
                      focusLabel={line.channel_label}
                    />}
                    <button type="button" className="matrix-edit-btn" title={isClosed ? 'รายละเอียดการคำนวณ' : undefined} aria-label={isClosed ? `รายละเอียด ${line.channel_label}` : undefined} aria-expanded={expanded} onClick={() => setExpandedLineId(expanded ? null : line.id)}>{isClosed ? <CircleHelp size={18} /> : expanded ? 'ย่อ' : 'แก้ไข'}</button>
                  </div>
                  <div className={`matrix-adjustment ${adjustmentAmount > 0 ? 'is-incoming' : adjustmentAmount < 0 ? 'is-outgoing' : ''}`}>
                    {isClosed ? <div className="post-close-row-action">
                      <strong>{adjustmentAmount === 0 ? money(0) : `${adjustmentAmount > 0 ? '+' : ''}${money(adjustmentAmount)}`}</strong>
                      {canAdjustClosed && <button type="button" className="post-close-open" aria-label={`ปรับยอด ${line.channel_label}`} aria-expanded={adjustingLineId === line.id} disabled={Boolean(adjustingLineId)} onClick={() => onAdjustClosed(line)}><ArrowRightLeft size={15} /> ปรับยอด</button>}
                    </div> : <><input
                      aria-label={`ยอดเข้าออกปรับปรุง ${line.channel_label}`}
                      inputMode="decimal"
                      data-money-input="true"
                      disabled={!canCheck || busy || line.receipt_status === 'CLOSED'}
                      value={formatSignedMoneyInput(isClosed ? adjustmentAmount : line.reconciliation_adjustment_amount)}
                      placeholder="+ เข้า / - ออก"
                      onFocus={(event) => clearZeroMoneyOnFocus(event, (value) => onLineChange(line.id, { reconciliation_adjustment_amount: value }))}
                      onKeyDown={(event) => handleSignedMoneyKeyDown(event, { onValue: (value) => onLineChange(line.id, { reconciliation_adjustment_amount: value }) })}
                      onPaste={(event) => handleSignedMoneyPaste(event, (value) => onLineChange(line.id, { reconciliation_adjustment_amount: value }))}
                      onChange={(event) => onLineChange(line.id, { reconciliation_adjustment_amount: normalizeSignedMoneyInput(event.target.value) })}
                    />
                    <small>{adjustmentAmount > 0 ? 'เงินเข้าเพิ่ม' : adjustmentAmount < 0 ? 'เงินออกเพิ่ม' : 'ไม่ปรับปรุง'}</small>
                    </>}
                  </div>
                </div>
                {adjustingLineId === line.id && renderPostCloseEditor(line)}
                {expanded && (
                  <div className="matrix-line-details">
                    <span>{hasLineData ? `ยอดที่ควรเข้าหลังรายการหัก: ${money(expected)}` : 'ยังไม่มีข้อมูลยอดสำหรับช่องทางนี้'}</span>
                    {hasSettlementBatch && (
                      <div className="settlement-batch-details">
                        <strong>รอบกระทบยอดรวม {formatThaiDate(line.settlement_batch_start_date)} - {formatThaiDate(line.settlement_batch_end_date)}</strong>
                        <span>ยอดขายรวม: {money(line.settlement_batch_gross_amount)}</span>
                        <span>ค่าธรรมเนียมรวม: -{money(line.settlement_batch_fee_amount)}</span>
                        <span>เงินเข้ารวม: {money(line.settlement_batch_net_amount)}</span>
                        <span>ผลต่างรวม: {money(line.settlement_batch_variance_amount)}</span>
                      </div>
                    )}
                    {line.channel_code === 'GRAB' && Number(grabReport.gross_amount || 0) > 0 && <span>ยอดรายการ Grab: {money(grabReport.gross_amount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.merchant_promotion_amount || 0) > 0 && <span>โปรโมชันร้านที่รวมในยอด POS แล้ว: -{money(grabReport.merchant_promotion_amount)}</span>}
                    {line.channel_code === 'GRAB' && hasGrabReference && <span>ยอด POS จากรายงาน Grab: {money(grabCashierReferenceAmount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.commission_and_tax_amount || 0) > 0 && <span>ค่าคอมมิชชันและภาษี: -{money(grabReport.commission_and_tax_amount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.additional_commission_amount || 0) > 0 && <span>ค่าคอมมิชชันเพิ่มเติม: -{money(grabReport.additional_commission_amount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.marketing_fee_amount || 0) > 0 && <span>ค่าธรรมเนียมการตลาด: -{money(grabReport.marketing_fee_amount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.merchant_delivery_discount_amount || 0) > 0 && <span>ส่วนลดค่าจัดส่งโดยร้าน: -{money(grabReport.merchant_delivery_discount_amount)}</span>}
                    {line.channel_code === 'GRAB' && Number(grabReport.income_adjustment_amount || 0) !== 0 && <span>การปรับรายได้: {Number(grabReport.income_adjustment_amount) > 0 ? '+' : '-'}{money(Math.abs(Number(grabReport.income_adjustment_amount)))}</span>}
                    {line.channel_code === 'GRAB' && <span>รายการหักสุทธิ Grab: {signedDeduction(line.fee_amount)}</span>}
                    {line.channel_code === 'GRAB' && <span>รายรับทั้งหมด/ควรเข้าบัญชี: {money(feeBreakdown.net)}</span>}
                    {canCheck && (hasReviewVariance || Math.abs(Number(line.original_reconciliation_adjustment_amount || 0)) >= 0.01) && (
                      <div className="matrix-adjustment-editor">
                        <select value={line.exception_category || ''} onChange={(event) => onLineChange(line.id, { exception_category: event.target.value })}>
                          <option value="">เลือกเหตุผลส่วนต่าง</option>
                          <option value="PENDING_SETTLEMENT">รอ settlement</option>
                          <option value="REFUND">คืนเงิน</option>
                          <option value="UNRELATED">ยอดไม่เกี่ยวข้อง</option>
                          <option value="OTHER">อื่นๆ</option>
                        </select>
                        <input value={line.variance_reason || ''} placeholder="อธิบายเหตุผลส่วนต่าง" onChange={(event) => onLineChange(line.id, { variance_reason: event.target.value })} />
                        <button
                          type="button"
                          className={`matrix-adjustment-save-btn ${savedAdjustmentLineId === line.id ? 'is-saved' : ''}`}
                          disabled={busy || savingAdjustmentLineId === line.id}
                          onClick={() => saveAdjustment(line)}
                        >
                          {savingAdjustmentLineId === line.id
                            ? <><RefreshCw className="spin" size={15} /> กำลังบันทึก</>
                            : savedAdjustmentLineId === line.id
                              ? <><Check size={16} /> บันทึกแล้ว</>
                              : <><Save size={15} /> บันทึกยอดปรับปรุง</>}
                        </button>
                      </div>
                    )}
                    {secondaryIncome.length > 0 && (
                      <div className="pending-income-review">
                        <header>
                          <strong>เงินเข้าจริง QR กสิกร แยกรายการ</strong>
                          <span>รอยืนยัน {money(pendingIncomeTotal)} บาท • ยืนยันแล้ว {money(includedSecondaryIncomeTotal)} บาท</span>
                        </header>
                        {secondaryIncome.map((transaction) => (
                          <div className="pending-income-item" key={transaction.id}>
                            <span>
                              <strong>{money(transaction.amount)}</strong>
                              <small>{transaction.transaction_date} • {transaction.reference_no || 'ไม่พบรหัสร้าน'}</small>
                            </span>
                            <div>
                              {transaction.match_status === 'unmatched' ? (
                                <>
                                  <button disabled={!canCheck || classifyingTransactionId === transaction.id} onClick={() => classifyPendingIncome(transaction, 'confirm_income')}>ยืนยันยอด</button>
                                  <button disabled={!canCheck || classifyingTransactionId === transaction.id} onClick={() => classifyPendingIncome(transaction, 'edit_income')}>แก้ไขยอด</button>
                                </>
                              ) : (
                                <>
                                  <strong className="included-secondary-income-label">ยืนยันแล้ว</strong>
                                  <button disabled={!canCheck || classifyingTransactionId === transaction.id} onClick={() => classifyPendingIncome(transaction, 'edit_income')}>แก้ไขยอด</button>
                                  <button disabled={!canCheck || classifyingTransactionId === transaction.id} onClick={() => classifyPendingIncome(transaction, 'pending_review')}>ยกเลิกการยืนยัน</button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="matrix-line matrix-counted-misc">
            <div className="reconciliation-matrix-row is-balanced" role="row">
              <div className="matrix-channel">
                <span className="channel-label">
                  <ChannelIcon code="MISC_COUNTED" label="รายการอื่นๆ ที่แคชเชียร์เพิ่ม" />
                  <strong>รายการอื่นๆ ที่แคชเชียร์เพิ่ม</strong>
                </span>
              </div>
              <div className="matrix-money-input matrix-static-amount"><strong>{money(countedMisc)}</strong></div>
              <div className="matrix-expected matrix-gross matrix-not-money"><strong>-</strong></div>
              <div className="matrix-expected matrix-fee matrix-not-money"><strong>-</strong></div>
              <div className="matrix-expected matrix-actual-static matrix-not-money"><strong>ไม่ใช่เงินเข้า</strong></div>
              <div className="matrix-status">
                <span className="amount-ok">รายการปรับปรุง</span>
                <button
                  type="button"
                  className="matrix-edit-btn matrix-misc-detail-btn"
                  aria-expanded={miscExpanded}
                  onClick={() => setExpandedLineId(miscExpanded ? null : 'MISC_COUNTED')}
                >
                  {miscExpanded ? 'ปิดรายละเอียด' : 'รายละเอียด'}
                </button>
              </div>
              <div className="matrix-adjustment matrix-not-money"><strong>-</strong></div>
            </div>
            {miscExpanded && (
              <div className="matrix-line-details matrix-misc-details">
                <div className="matrix-misc-list">
                  <header>
                    <strong>รายการที่แคชเชียร์เพิ่ม</strong>
                    <span>{miscItems.length} รายการ</span>
                  </header>
                  {miscItems.length > 0 ? miscItems.map((item) => (
                    <div className="matrix-misc-item" key={item.id}>
                      <span>{item.label}</span>
                      <strong>+{money(item.amount)}</strong>
                    </div>
                  )) : (
                    <div className="matrix-misc-empty">ไม่มีรายการที่แคชเชียร์เพิ่ม</div>
                  )}
                  <footer>
                    <span>ยอดรวม</span>
                    <strong>+{money(countedMisc)}</strong>
                  </footer>
                </div>
              </div>
            )}
          </div>
        </div>
        <footer className="reconciliation-matrix-summary" aria-label="ยอดรวมตามคอลัมน์">
          <strong>ยอดรวม</strong>
          <b data-label="แคชเชียร์กรอก">{money(cashierColumnTotal)}</b>
          <b data-label="ก่อนรายการหัก">{money(grossBeforeFeeTotal)}</b>
          <b data-label="รายการหักสุทธิ">{signedDeduction(feeColumnTotal)}</b>
          <b data-label={hasAnySettlementBatch ? 'เงินเข้าสุทธิที่จัดสรร' : 'เงินเข้าจริงสุทธิ'}>{money(actualColumnTotal)}</b>
          <span>รวมจากแต่ละแถว</span>
          <b data-label="ยอดเข้า/ออกปรับปรุง">{adjustmentColumnTotal > 0 ? '+' : ''}{money(adjustmentColumnTotal)}</b>
        </footer>
        <CalculationContainer className={isClosed ? 'closed-calculation-details' : 'receipt-calculation-content'}>
        {isClosed && <summary><CircleHelp size={18} /> วิธีคำนวณและสรุป 3 ขั้น <ChevronRight size={16} /></summary>}
        <div className="reconciliation-adjustments" aria-label="รายการปรับปรุงที่ใช้ในสูตร">
          <div>
            <Coins size={18} />
            <span><small>เงินทอนตอนเช้า</small><strong>{money(morningChange)}</strong></span>
            <em>รวมอยู่ในเงินสดที่นับแล้ว บวกเฉพาะกับ POS</em>
          </div>
          <div>
            <Plus size={18} />
            <span><small>รายการอื่นๆ ที่แคชเชียร์เพิ่ม</small><strong>{money(countedMisc)}</strong></span>
            <em>ไม่ใช่เงินเข้า รวมเป็นรายการปรับปรุงเพื่อกระทบยอด</em>
          </div>
          <div>
            <ArrowRightLeft size={18} />
            <span>
              <small>ยอดเข้า/ออกปรับปรุงรายช่องทาง</small>
              <strong>{adjustmentColumnTotal > 0 ? '+' : ''}{money(adjustmentColumnTotal)}</strong>
            </span>
            <em>ยอดเข้าใช้เครื่องหมาย + ยอดออกใช้เครื่องหมาย -</em>
          </div>
        </div>
        <section className="reconciliation-three-way" aria-label="สรุปกระทบยอดสามขั้น">
          <header>
            <div><span>สรุปขาด/เกิน</span><h3>ตรวจเส้นทางเงิน 3 ขั้น</h3></div>
            <strong className={endToEndResult.className}>{endToEndResult.label}</strong>
          </header>
          <div className="three-way-grid">
            <article className={Math.abs(cashierVsPosVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
              <div className="three-way-title"><b>1</b><span><small>POS → แคชเชียร์</small><strong>ตรวจยอดที่นับและส่ง</strong></span></div>
              <dl>
                <div><dt>ยอดขาย POS</dt><dd>{money(grossSalesExpected)}</dd></div>
                <div><dt>+ เงินทอนตอนเช้า</dt><dd>{money(morningChange)}</dd></div>
                <div className="three-way-subtotal"><dt>ยอดที่ควรนับได้</dt><dd>{money(posWithChangeTotal)}</dd></div>
                <div><dt>แคชเชียร์ส่ง</dt><dd>{money(cashierColumnTotal)}</dd></div>
              </dl>
              <footer><span>{money(cashierColumnTotal)} - {money(posWithChangeTotal)}</span><strong className={cashierVsPosResult.className}>{cashierVsPosResult.label}</strong></footer>
            </article>
            <article className={Math.abs(settlementVsCashierVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
              <div className="three-way-title"><b>2</b><span><small>แคชเชียร์ → เงินเข้าจริง</small><strong>ตรวจเงินสดและ statement</strong></span></div>
              <dl>
                <div><dt>เงินเข้าจริงสุทธิ</dt><dd>{money(actualColumnTotal)}</dd></div>
                <div><dt>+ รายการหักสุทธิ</dt><dd>{money(feeColumnTotal)}</dd></div>
                <div><dt>+ รายการอื่นๆ</dt><dd>{money(countedMisc)}</dd></div>
                <div><dt>+/- ยอดเข้า/ออกปรับปรุง</dt><dd>{adjustmentColumnTotal > 0 ? '+' : ''}{money(adjustmentColumnTotal)}</dd></div>
                <div className="three-way-subtotal"><dt>มูลค่าที่กระทบได้</dt><dd>{money(recoveredTotal)}</dd></div>
              </dl>
              <footer><span>{money(recoveredTotal)} - {money(cashierColumnTotal)}</span><strong className={settlementVsCashierResult.className}>{settlementVsCashierResult.label}</strong></footer>
            </article>
            <article className={Math.abs(endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
              <div className="three-way-title"><b>3</b><span><small>POS → เงินเข้าจริง</small><strong>ตรวจผลต่างสุดท้าย</strong></span></div>
              <dl>
                <div><dt>มูลค่าที่กระทบได้</dt><dd>{money(recoveredTotal)}</dd></div>
                <div><dt>ยอด POS + เงินทอน</dt><dd>{money(posWithChangeTotal)}</dd></div>
                <div className="three-way-subtotal"><dt>ผลต่างสุดท้าย</dt><dd className={endToEndResult.className}>{endToEndResult.label}</dd></div>
              </dl>
              <footer><span>{money(recoveredTotal)} - {money(posWithChangeTotal)}</span><strong className={endToEndResult.className}>{endToEndResult.label}</strong></footer>
            </article>
          </div>
          <div className={`reconciliation-diagnosis ${Math.abs(endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}`} role="status">
            {Math.abs(endToEndVariance) < 0.01 ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <div><strong>จุดที่ต้องตรวจ</strong><span>{diagnosis}</span></div>
          </div>
        </section>
        </CalculationContainer>
      </div>
    </section>
  );
};

const RECEIPT_ATTACHMENT_GROUPS = [
  { type: 'cash_slip', title: 'สรุปยอดเงิน', hint: 'สรุปยอดรับเงินหรือสลิปเงินสด', Icon: Banknote },
  { type: 'cashier_summary', title: 'รูปสรุปรวมหน้าร้าน', hint: 'รูปที่แคชเชียร์ถ่ายส่งจากหน้าร้าน', Icon: Camera },
  { type: 'statement', title: 'สรุปบัตรเครดิต', hint: 'สลิปหรือรายงานบัตรเครดิต', Icon: CreditCard },
  { type: 'other', title: 'บิลจ่ายอื่นๆ', hint: 'บิลหรือเอกสารประกอบรายการอื่น', Icon: FileText }
];

const ReceiptDocumentsPanel = ({ attachments = [], defaultOpen = false, className = '' }) => {
  const documentCount = attachments.length;
  return (
    <details className={`receipt-documents-panel ${className}`} open={defaultOpen}>
      <summary>
        <span><FileText size={18} /><strong>เอกสารจากหน้าร้าน</strong></span>
        <small>{documentCount ? `${documentCount} ไฟล์ เปิดดูได้ทันที` : 'ยังไม่มีไฟล์จากแคชเชียร์'}</small>
      </summary>
      {documentCount > 0 && (
        <div className="receipt-documents-grid">
          {RECEIPT_ATTACHMENT_GROUPS.map(({ type, title, hint, Icon }) => (
            <ReceiptAttachmentSection
              key={type}
              type={type}
              title={title}
              hint={hint}
              Icon={Icon}
              attachments={attachments.filter((attachment) => attachment.attachment_type === type)}
            />
          ))}
        </div>
      )}
    </details>
  );
};

const ReceiptPrintSheet = ({ receipt, lines, mode }) => {
  const detailed = mode === 'detail';
  const displayLines = [
    ...lines.filter((line) => line.channel_code !== 'CASH'),
    ...lines.filter((line) => line.channel_code === 'CASH')
  ];
  const miscTotal = (receipt.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const morningChange = Number(receipt.morning_change_amount || 0);
  const cashierLineTotal = lines.reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const actualMoneyTotal = roundCurrency(lines.reduce((sum, line) => sum + buildLineEvidenceReconciliation(line).actual, 0));
  const grossBeforeFeeTotal = roundCurrency(lines.reduce((sum, line) => sum + buildLineEvidenceReconciliation(line).gross, 0));
  const deductionTotal = roundCurrency(lines.reduce((sum, line) => sum + buildLineEvidenceReconciliation(line).fee, 0));
  const lineAdjustmentTotal = roundCurrency(lines.reduce((sum, line) => sum + effectiveLineAdjustment(line), 0));
  const summary = buildReconciliationSummary({
    grossSalesExpected: Number(receipt.gross_sales_expected || 0),
    morningChange,
    cashierLineTotal,
    miscAdjustmentTotal: miscTotal,
    lineAdjustmentTotal,
    actualMoneyTotal,
    deductionTotal
  });
  const varianceText = (value) => {
    const amount = roundCurrency(value);
    if (Math.abs(amount) < 0.01) return 'ครบ 0.00';
    return amount > 0 ? `เกิน ${money(amount)}` : `ขาด ${money(Math.abs(amount))}`;
  };
  const attachmentById = new Map((receipt.attachments || []).map((attachment) => [Number(attachment.id), attachment]));
  const documentNumber = receiptDocumentNumber(receipt);
  const printLineRows = displayLines.map((line) => {
    const reconciliation = buildLineEvidenceReconciliation(line);
    const settlement = reconciliation;
    const actual = reconciliation.actual;
    const evidence = attachmentById.get(Number(line.evidence_attachment_id));
    const adjustment = effectiveLineAdjustment(line);
    const hasData = [line.cashier_amount, settlement.gross, settlement.fee, actual, adjustment]
      .some((value) => Math.abs(Number(value || 0)) >= 0.01);
    const reviewLabel = !hasData
      ? 'ไม่มีรายการ'
      : isManualReviewAwaitingEvidence(line)
        ? EVIDENCE_PENDING_LABEL
        : reconciliation.hasVariance
          ? 'พบผลต่างหลักฐาน'
          : evidence
            ? 'ตรง • มีหลักฐาน'
            : line.manual_checked_without_reference
              ? 'ตรง • ตรวจมือ'
              : 'ตรง';
    return { line, settlement, actual, adjustment, reconciliation, evidence, hasData, reviewLabel };
  });

  return (
    <article className={`receipt-print-sheet receipt-print-${mode}`}>
      {Boolean(receipt.historical_evidence_warning) && <div className="receipt-print-warning">หลักฐานย้อนหลังไม่ตรง กรุณาตรวจผลต่างรายช่องทางและเหตุผลประกอบ</div>}
      <header className="receipt-print-header">
        <div>
          <div className="receipt-print-company-line">
            <strong>บริษัท โซลาว จำกัด</strong>
            <span>FINANCE CONTROL DOCUMENT</span>
          </div>
          <h1>{detailed ? 'รายละเอียดการกระทบยอดรับเงิน' : 'รายงานสรุปการรับเงินประจำวัน'}</h1>
          <div className="receipt-print-document-meta">
            <p><span>เลขที่เอกสาร</span><strong>{documentNumber}</strong></p>
            <p><span>สาขา</span><strong>{receipt.branch_name}</strong></p>
            <p><span>วันที่ขาย</span><strong>{formatThaiDate(receipt.receipt_date)}</strong></p>
            <p><span>จำนวนบิล</span><strong>{receipt.bill_count || 0} บิล</strong></p>
          </div>
        </div>
        <div className="receipt-print-status">
          <small>การรับรองเอกสาร</small>
          <strong>ปิดเอกสารแล้ว</strong>
          {!detailed && <b className={Math.abs(summary.endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>{varianceText(summary.endToEndVariance)}</b>}
          <small>ปิดเมื่อ {formatThaiDateTime(receipt.closed_at)}</small>
        </div>
      </header>

      {!detailed && <div className="receipt-print-section-heading"><h2>1. สรุปยอดควบคุม</h2><span>หน่วย: บาท</span></div>}
      {receipt.post_close_adjustment_count > 0 && <ClosedReceiptSummary receipt={receipt} print />}
      <section className={`receipt-print-metrics ${detailed ? '' : 'receipt-print-summary-metrics'}`}>
        {detailed ? <>
          <div><span>ยอดขาย POS</span><strong>{money(receipt.gross_sales_expected)}</strong></div>
          <div><span>เงินทอนตอนเช้า</span><strong>{money(morningChange)}</strong></div>
          <div><span>แคชเชียร์กรอก</span><strong>{money(summary.cashierTotal)}</strong></div>
          <div><span>เงินเข้าจริงสุทธิ</span><strong>{money(actualMoneyTotal)}</strong></div>
          <div><span>รายการหักสุทธิ</span><strong>{signedDeduction(deductionTotal)}</strong></div>
          <div><span>ยอดเข้า/ออกปรับปรุง</span><strong>{lineAdjustmentTotal > 0 ? '+' : ''}{money(lineAdjustmentTotal)}</strong></div>
          <div className={Math.abs(summary.endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>ผลต่างสุดท้าย</span><strong>{varianceText(summary.endToEndVariance)}</strong>
          </div>
        </> : <>
          <div>
            <span>ยอดตาม POS + เงินทอน</span>
            <strong>{money(summary.posWithChangeTotal)}</strong>
            <small>POS {money(receipt.gross_sales_expected)} + เงินทอน {money(morningChange)}</small>
          </div>
          <div className={Math.abs(summary.cashierVsPosVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>ยอดที่แคชเชียร์ส่ง</span>
            <strong>{money(summary.cashierTotal)}</strong>
            <small>เทียบ POS: {varianceText(summary.cashierVsPosVariance)}</small>
          </div>
          <div className={Math.abs(summary.settlementVsCashierVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>มูลค่าที่กระทบได้</span>
            <strong>{money(summary.recoveredTotal)}</strong>
            <small>เงินเข้า {money(actualMoneyTotal)} + ค่าหัก {money(deductionTotal)} + อื่นๆ {money(miscTotal)} +/- เข้าออก {lineAdjustmentTotal > 0 ? '+' : ''}{money(lineAdjustmentTotal)}</small>
          </div>
          <div className={Math.abs(summary.endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>ผลต่างสุดท้าย</span>
            <strong>{varianceText(summary.endToEndVariance)}</strong>
            <small>มูลค่าที่กระทบได้ - POS รวมเงินทอน</small>
          </div>
        </>}
      </section>

      {detailed && (
        <section className="receipt-print-detail-section">
          <h2>รายละเอียดรายช่องทาง</h2>
          <table className="receipt-print-table">
            <thead><tr><th>ช่องทาง</th><th>แคชเชียร์กรอก</th><th>ก่อนรายการหัก</th><th>รายการหักสุทธิ</th><th>เงินเข้าจริง (สุทธิ)</th><th>เข้า/ออกปรับปรุง</th><th>ผลต่างหลักฐาน 2 จุด</th><th>หลักฐาน</th></tr></thead>
            <tbody>
              {printLineRows.map(({ line, settlement, actual, adjustment, reconciliation, evidence }) => {
                return (
                  <tr key={line.id}>
                    <th>{line.channel_label}</th>
                    <td>{money(line.cashier_amount)}</td>
                    <td>{money(settlement.gross)}</td>
                    <td>{signedDeduction(settlement.fee)}</td>
                    <td>{money(actual)}</td>
                    <td>{adjustment > 0 ? '+' : ''}{money(adjustment)}</td>
                    <td className={!reconciliation.hasVariance ? 'is-balanced' : 'has-variance'}>
                      <span>แคชเชียร์: {varianceText(reconciliation.cashierVariance)}</span><br />
                      <span>เงินเข้า: {varianceText(reconciliation.settlementVariance)}</span>
                    </td>
                    <td className="receipt-print-evidence">{evidence?.original_name || (line.manual_checked_without_reference ? 'ตรวจโดยไม่มีเอกสาร' : '-')}</td>
                  </tr>
                );
              })}
              <tr>
                <th>รายการอื่นๆ ที่แคชเชียร์เพิ่ม</th>
                <td>{money(miscTotal)}</td><td>-</td><td>-</td><td>ไม่ใช่เงินเข้า</td><td>-</td><td>รายการปรับปรุง</td><td>-</td>
              </tr>
              <tr>
                <th>เงินทอนตอนเช้า</th>
                <td>-</td><td>{money(morningChange)}</td><td>-</td><td>รวมในเงินสด</td><td>-</td><td>รายการประกอบ</td><td>-</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {detailed && <div className="receipt-print-page-break" aria-hidden="true" />}
      <section className="receipt-print-reconciliation">
        <div className="receipt-print-section-heading">
          <h2>{detailed ? 'สรุปการตรวจ' : '2. ผลการกระทบยอด'} <span className="receipt-print-nowrap">3 ทาง</span></h2>
          {!detailed && <span>ตรวจ POS • แคชเชียร์ • เงินเข้าจริง</span>}
        </div>
        <div>
          <article className={Math.abs(summary.cashierVsPosVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>1. POS → แคชเชียร์</span>
            <strong>{varianceText(summary.cashierVsPosVariance)}</strong>
            <small>{money(summary.cashierTotal)} - ({money(receipt.gross_sales_expected)} + {money(morningChange)})</small>
          </article>
          <article className={Math.abs(summary.settlementVsCashierVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>2. แคชเชียร์ → เงินเข้าจริง</span>
            <strong>{varianceText(summary.settlementVsCashierVariance)}</strong>
            <small>({money(actualMoneyTotal)} + {money(deductionTotal)} + {money(miscTotal)} {lineAdjustmentTotal >= 0 ? '+' : '-'} {money(Math.abs(lineAdjustmentTotal))}) - {money(summary.cashierTotal)}</small>
          </article>
          <article className={Math.abs(summary.endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
            <span>3. POS → เงินเข้าจริง</span>
            <strong>{varianceText(summary.endToEndVariance)}</strong>
            <small>{money(summary.recoveredTotal)} - {money(summary.posWithChangeTotal)}</small>
          </article>
        </div>
      </section>

      {!detailed && (
        <section className="receipt-print-summary-channels">
          <header>
            <h2>3. รายละเอียดรายช่องทาง</h2>
            <p>แสดงยอดที่ส่ง ค่าหักที่บวกคืน เงินเข้าจริง และสถานะหลักฐาน</p>
          </header>
          <table>
            <thead><tr><th>ช่องทาง</th><th>แคชเชียร์</th><th>ก่อนหัก</th><th>ค่าหักบวกคืน</th><th>เงินเข้าจริง</th><th>เข้า/ออกปรับปรุง</th><th>ผลตรวจ</th></tr></thead>
            <tbody>
              {printLineRows.map(({ line, settlement, actual, adjustment, reconciliation, reviewLabel }) => (
                <tr key={`summary-${line.id}`}>
                  <th>{line.channel_label}</th>
                  <td>{money(line.cashier_amount)}</td>
                  <td>{money(settlement.gross)}</td>
                  <td>{money(settlement.fee)}</td>
                  <td>{money(actual)}</td>
                  <td>{adjustment > 0 ? '+' : ''}{money(adjustment)}</td>
                  <td className={!reconciliation.hasVariance ? 'is-balanced' : 'has-variance'}>{reviewLabel}</td>
                </tr>
              ))}
              <tr className="is-adjustment">
                <th>รายการอื่นๆ ที่แคชเชียร์เพิ่ม</th>
                <td>{money(miscTotal)}</td><td>-</td><td>-</td><td>-</td><td>-</td><td>รายการปรับปรุง</td>
              </tr>
            </tbody>
            <tfoot><tr><th>รวม</th><td>{money(summary.cashierTotal)}</td><td>{money(grossBeforeFeeTotal)}</td><td>{money(deductionTotal)}</td><td>{money(actualMoneyTotal)}</td><td>{lineAdjustmentTotal > 0 ? '+' : ''}{money(lineAdjustmentTotal)}</td><td>{varianceText(summary.settlementVsCashierVariance)}</td></tr></tfoot>
          </table>
          <div className="receipt-print-summary-context">
            <p><span>เงินทอนตอนเช้า</span><strong>{money(morningChange)}</strong></p>
            <p><span>รายการปรับปรุง</span><strong>{money(miscTotal)}</strong></p>
            <p><span>ยอดเข้า/ออกปรับปรุง</span><strong>{lineAdjustmentTotal > 0 ? '+' : ''}{money(lineAdjustmentTotal)}</strong></p>
            <p><span>หลักฐานประกอบ</span><strong>{(receipt.attachments || []).length} ไฟล์ • {(receipt.statement_imports || []).length} Statement</strong></p>
          </div>
        </section>
      )}

      {detailed && (
        <section className="receipt-print-supporting">
          <div>
            <h2>รายการอื่นๆ ที่แคชเชียร์เพิ่ม</h2>
            {(receipt.misc_items || []).length > 0
              ? (receipt.misc_items || []).map((item) => <p key={item.id}><span>{item.label}</span><strong>{money(item.amount)}</strong></p>)
              : <p><span>ไม่มีรายการ</span><strong>-</strong></p>}
          </div>
          <div>
            <h2>เอกสารและ Statement</h2>
            {(receipt.attachments || []).length > 0
              ? (receipt.attachments || []).map((item) => <p key={item.id}><span>{item.original_name}</span><strong>ไฟล์ #{item.id}</strong></p>)
              : <p><span>ไม่มีไฟล์แนบ</span><strong>-</strong></p>}
            {(receipt.statement_imports || []).map((item) => <p key={`statement-${item.id}`}><span>{item.original_name || item.channel_label || 'Statement'}</span><strong>{money(item.total_amount)}</strong></p>)}
          </div>
        </section>
      )}

      {!detailed && (
        <section className="receipt-print-audit-note">
          <h2>4. การรับรองและแหล่งข้อมูล</h2>
          <div>
            <p><strong>แหล่งข้อมูล</strong><span>ยอดขาย POS จาก ClickHouse, ยอดที่แคชเชียร์ส่ง และ Statement/หลักฐานที่แนบในระบบ</span></p>
            <p><strong>หลักการ</strong><span>มูลค่าที่กระทบได้ = เงินเข้าจริงสุทธิ + ค่าหักที่บวกคืน + รายการอื่นๆ +/- ยอดเข้าออกปรับปรุง</span></p>
          </div>
        </section>
      )}

      <footer className="receipt-print-footer">
        <div><span>ผู้จัดทำ / แคชเชียร์ส่งยอด</span><strong>{receipt.submitted_by_name || '-'}</strong><small>{formatThaiDateTime(receipt.submitted_at)}</small></div>
        <div><span>ผู้ตรวจสอบ</span><strong>{receipt.checked_by_name || '-'}</strong><small>{formatThaiDateTime(receipt.checked_at)}</small></div>
        <div><span>ผู้อนุมัติปิดเอกสาร</span><strong>{receipt.closed_by_name || '-'}</strong><small>{formatThaiDateTime(receipt.closed_at)}</small></div>
        <p><span>{documentNumber}</span><span>พิมพ์เมื่อ {formatThaiDateTime(new Date().toISOString())}{!detailed ? ` • หน้าสรุป / ใบปรับปรุงแนบ ${receipt.post_close_adjustment_count || 0} ใบ` : ''}</span></p>
      </footer>
      <PostCloseAdjustmentPrintPages receipt={receipt} />
    </article>
  );
};

const ReceiptEvidencePrintSheet = ({ receipt, documents }) => {
  const documentNumber = receiptDocumentNumber(receipt);
  const printableDocumentCount = documents.filter((item) => item.pages.length > 0).length;
  const lines = receipt.lines || [];
  const miscTotal = roundCurrency((receipt.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const morningChange = Number(receipt.morning_change_amount || 0);
  const cashierLineTotal = roundCurrency(lines.reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0));
  const actualMoneyTotal = roundCurrency(lines.reduce((sum, line) => sum + buildLineEvidenceReconciliation(line).actual, 0));
  const deductionTotal = roundCurrency(lines.reduce((sum, line) => sum + buildLineEvidenceReconciliation(line).fee, 0));
  const lineAdjustmentTotal = roundCurrency(lines.reduce((sum, line) => sum + effectiveLineAdjustment(line), 0));
  const summary = buildReconciliationSummary({
    grossSalesExpected: Number(receipt.gross_sales_expected || 0),
    morningChange,
    cashierLineTotal,
    miscAdjustmentTotal: miscTotal,
    lineAdjustmentTotal,
    actualMoneyTotal,
    deductionTotal
  });
  const resultText = (value) => {
    const amount = roundCurrency(value);
    if (Math.abs(amount) < 0.01) return 'ครบ 0.00';
    return amount > 0 ? `เกิน ${money(amount)}` : `ขาด ${money(Math.abs(amount))}`;
  };
  const evidenceCalculation = (item) => {
    if (!item.line) return null;
    const line = item.line;
    const reconciliation = buildLineEvidenceReconciliation(line);
    return { line, settlement: reconciliation, actual: reconciliation.actual, reconciliation, grab: line.grab_report_payload || {} };
  };
  const statusLabel = (item) => {
    if (item.status === 'not_applicable') return 'ไม่มีช่องทางในสาขานี้';
    if (item.status === 'no_activity') return 'ไม่มีรายการ';
    if (item.status === 'missing') return 'ไม่พบเอกสาร';
    if (item.status === 'error') return `เปิดไม่สำเร็จ: ${item.error}`;
    return item.pages[0]?.kind === 'html' || item.pages[0]?.kind === 'text'
      ? 'พร้อมพิมพ์'
      : `${item.pages.length} หน้า`;
  };

  return (
    <article className="receipt-print-sheet receipt-print-detail receipt-evidence-bundle">
      <section className="receipt-evidence-cover">
        {Boolean(receipt.historical_evidence_warning) && <div className="receipt-print-warning">หลักฐานย้อนหลังไม่ตรง กรุณาตรวจผลต่างรายช่องทางและเหตุผลประกอบ</div>}
        <header className="receipt-print-header">
          <div>
            <div className="receipt-print-company-line">
              <strong>บริษัท โซลาว จำกัด</strong>
              <span>SUPPORTING EVIDENCE DOCUMENTS</span>
            </div>
            <h1>ชุดเอกสารประกอบการกระทบยอด</h1>
            <div className="receipt-print-document-meta">
              <p><span>เลขที่เอกสาร</span><strong>{documentNumber}</strong></p>
              <p><span>สาขา</span><strong>{receipt.branch_name}</strong></p>
              <p><span>วันที่ขาย</span><strong>{formatThaiDate(receipt.receipt_date)}</strong></p>
              <p><span>จำนวนบิล</span><strong>{receipt.bill_count || 0} บิล</strong></p>
            </div>
          </div>
          <div className="receipt-print-status">
            <small>ประเภทเอกสาร</small>
            <strong>เอกสารชี้แจงรายละเอียด</strong>
            <small>{printableDocumentCount} ชุดหลักฐาน</small>
          </div>
        </header>

        <div className="receipt-evidence-cover-intro">
          <h2>สารบัญเอกสารอ้างอิงจริง</h2>
          <p>เอกสารหลังหน้าสารบัญนี้ดึงจากไฟล์ที่ใช้ผูกยอดเงินเข้าและไฟล์ที่แคชเชียร์แนบในระบบโดยตรง</p>
        </div>
        {receipt.post_close_adjustment_count > 0 && <ClosedReceiptSummary receipt={receipt} print />}

        <table className="receipt-evidence-index">
          <thead><tr><th>ลำดับ</th><th>ประเภท</th><th>รายการ</th><th>ชื่อไฟล์ในระบบ</th><th>สถานะ</th></tr></thead>
          <tbody>
            {documents.map((item, index) => (
              <tr key={item.key} className={item.status === 'ready' ? '' : 'is-missing'}>
                <td>{index + 1}</td>
                <td>{item.category}</td>
                <th>{item.label}</th>
                <td>{item.fileName || item.attachment?.original_name || '-'}</td>
                <td>{statusLabel(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="receipt-evidence-calculations">
          <header>
            <h2>ที่มาของยอดและวิธีคำนวณ</h2>
            <span>หน่วย: บาท</span>
          </header>
          <div className="receipt-evidence-formulas">
            <article>
              <span>ยอดที่ควรนับได้</span>
              <strong>{money(summary.posWithChangeTotal)}</strong>
              <small>{money(receipt.gross_sales_expected)} (ยอดขาย POS) + {money(morningChange)} (เงินทอน)</small>
            </article>
            <article>
              <span>ยอดที่แคชเชียร์ส่ง</span>
              <strong>{money(summary.cashierTotal)}</strong>
              <small>{money(cashierLineTotal)} (รวมรายช่องทาง) + {money(miscTotal)} (รายการปรับปรุง)</small>
            </article>
            <article>
              <span>เงินเข้าจริงสุทธิ</span>
              <strong>{money(actualMoneyTotal)}</strong>
              <small>ผลรวมเงินเข้าจริงของทุกช่องทางตาม Statement และหลักฐาน</small>
            </article>
            <article>
              <span>รายการหักที่บวกคืน</span>
              <strong>{money(deductionTotal)}</strong>
              <small>ค่าธรรมเนียมและรายการหักที่เกิดก่อนเงินสุทธิเข้าบัญชี</small>
            </article>
            <article>
              <span>มูลค่าที่กระทบได้</span>
              <strong>{money(summary.recoveredTotal)}</strong>
              <small>{money(actualMoneyTotal)} (เงินเข้าสุทธิ) + {money(deductionTotal)} (รายการหัก) + {money(miscTotal)} (อื่นๆ) +/- {lineAdjustmentTotal > 0 ? '+' : ''}{money(lineAdjustmentTotal)} (เข้า/ออกปรับปรุง)</small>
            </article>
            <article className={Math.abs(summary.endToEndVariance) < 0.01 ? 'is-balanced' : 'has-variance'}>
              <span>ผลต่างสุดท้าย</span>
              <strong>{resultText(summary.endToEndVariance)}</strong>
              <small>{money(summary.recoveredTotal)} (มูลค่าที่กระทบได้) - {money(summary.posWithChangeTotal)} (ยอดที่ควรนับได้)</small>
            </article>
          </div>
          <div className="receipt-evidence-checks">
            <p><span>POS → แคชเชียร์</span><strong>{resultText(summary.cashierVsPosVariance)}</strong></p>
            <p><span>แคชเชียร์ → เงินเข้าจริง</span><strong>{resultText(summary.settlementVsCashierVariance)}</strong></p>
            <p><span>POS → เงินเข้าจริง</span><strong>{resultText(summary.endToEndVariance)}</strong></p>
          </div>
        </section>

        <div className="receipt-evidence-cover-note">
          <strong>การตรวจสอบย้อนกลับ</strong>
          <span>ชื่อรายการและลำดับหน้าเชื่อมโยงกับหลักฐานที่บันทึกอยู่ในเอกสารรับเงินเลขที่ {documentNumber}</span>
        </div>
        <footer className="receipt-evidence-page-footer"><span>{documentNumber}</span><span>หน้าสารบัญ • พิมพ์เมื่อ {formatThaiDateTime(new Date().toISOString())}</span></footer>
      </section>

      {documents.flatMap((item) => item.pages.map((page) => {
        const calculation = evidenceCalculation(item);
        const { line, settlement, actual, reconciliation, grab } = calculation || {};
        const grabGross = Number(grab?.gross_amount || 0);
        const grabPromotion = Number(grab?.merchant_promotion_amount || 0);
        return (
          <section className={`receipt-evidence-page receipt-evidence-${page.kind} ${calculation ? 'has-calculation' : ''}`} key={`${item.key}-${page.pageNumber}`}>
            <header>
              <div><span>{item.category}</span><h2>{item.label}</h2><p>{item.fileName || item.attachment?.original_name}</p></div>
              <strong>{page.pageCount > 1 ? `หน้าต้นฉบับ ${page.pageNumber} / ${page.pageCount}` : 'เอกสารต้นฉบับ'}</strong>
            </header>
            {calculation && (
              <section className="receipt-evidence-line-calculation" aria-label={`วิธีคำนวณ ${item.label}`}>
                <div><span>แคชเชียร์กรอก</span><strong>{money(line.cashier_amount)}</strong></div>
                <div><span>ก่อนรายการหัก</span><strong>{money(settlement.gross)}</strong></div>
                <div><span>ค่าธรรมเนียม / รายการหัก</span><strong>{signedDeduction(settlement.fee)}</strong></div>
                <div><span>เงินที่ควรเข้า</span><strong>{money(settlement.net)}</strong></div>
                <div><span>เงินเข้าจริง</span><strong>{money(actual)}</strong></div>
                <div><span>ยอดเข้า/ออกปรับปรุง</span><strong>{effectiveLineAdjustment(line) > 0 ? '+' : ''}{money(effectiveLineAdjustment(line))}</strong></div>
                <div className={Math.abs(reconciliation.cashierVariance) < 0.01 ? 'is-balanced' : 'has-variance'}><span>ผลต่างแคชเชียร์</span><strong>{resultText(reconciliation.cashierVariance)}</strong></div>
                <div className={Math.abs(reconciliation.settlementVariance) < 0.01 ? 'is-balanced' : 'has-variance'}><span>ผลต่างเงินเข้า</span><strong>{resultText(reconciliation.settlementVariance)}</strong></div>
                <p>
                  {item.channelCode === 'GRAB' && grabGross > 0
                    ? <>{money(grabGross)} (ยอดรายการ) - {money(grabPromotion)} (โปรโมชันร้าน) = {money(settlement.gross)} (ยอดก่อนหัก); {money(settlement.gross)} - {money(settlement.fee)} (รายการหัก) = {money(settlement.net)} (ควรเข้า)</>
                    : <>{money(settlement.gross)} (ก่อนหัก) - {money(settlement.fee)} (ค่าธรรมเนียม/รายการหัก) = {money(settlement.net)} (ควรเข้า); เทียบเงินเข้าจริง {money(actual)}; ปรับเข้า/ออก {effectiveLineAdjustment(line) > 0 ? '+' : ''}{money(effectiveLineAdjustment(line))}</>}
                </p>
              </section>
            )}
            {page.kind === 'image' && <img src={page.source} alt={`${item.label} หน้า ${page.pageNumber}`} />}
            {page.kind === 'html' && <div className="receipt-evidence-html-content" dangerouslySetInnerHTML={{ __html: page.html }} />}
            {page.kind === 'text' && <pre className="receipt-evidence-text-content">{page.text}</pre>}
            <footer className="receipt-evidence-page-footer"><span>{documentNumber}</span><span>{item.label} • ลำดับเอกสาร {documents.indexOf(item) + 1}</span></footer>
          </section>
        );
      }))}
      <PostCloseAdjustmentPrintPages receipt={receipt} />
    </article>
  );
};

const ReceiptDetail = ({ user, receipt, onChanged, compactHeader = false }) => {
  const [postCloseLine, setPostCloseLine] = useState(null);
  const [postCloseNotice, setPostCloseNotice] = useState(null);
  const [draftLines, setDraftLines] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [missingReasonLineIds, setMissingReasonLineIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [printJob, setPrintJob] = useState(null);
  const [detailPrintLoading, setDetailPrintLoading] = useState(false);
  const [detailPrintProgress, setDetailPrintProgress] = useState('');
  const [imageSaving, setImageSaving] = useState(false);
  const detailPanelRef = useRef(null);
  const printAbortRef = useRef(null);
  const printTokenRef = useRef(0);
  const activeReceiptIdRef = useRef(receipt?.id || null);
  activeReceiptIdRef.current = receipt?.id || null;

  const releasePrintJob = (job) => {
    (job?.objectUrls || []).forEach((url) => URL.revokeObjectURL(url));
  };

  useEffect(() => {
    setDraftLines((receipt?.lines || []).map((line) => {
      const grabNetAmount = Number(line.grab_report_payload?.net_amount || line.expected_net_amount || line.grab_report_amount || 0);
      const hasGrabSuggestion =
        receipt.status !== 'CLOSED' &&
        line.channel_code === 'GRAB' &&
        grabNetAmount > 0 &&
        Number(line.statement_amount || 0) === 0;
      return {
        ...line,
        statement_amount: hasGrabSuggestion ? String(grabNetAmount) : line.statement_amount,
        grab_report_suggested: hasGrabSuggestion,
        original_cashier_amount: line.cashier_amount,
        original_statement_amount: line.statement_amount,
        original_reconciliation_adjustment_amount: line.reconciliation_adjustment_amount
      };
    }));
    setMessage('');
    setError('');
    setMissingReasonLineIds(new Set());
  }, [receipt]);

  useEffect(() => {
    printTokenRef.current += 1;
    setPostCloseLine(null);
    setPostCloseNotice(null);
    printAbortRef.current?.abort();
    printAbortRef.current = null;
    setDetailPrintLoading(false);
    setDetailPrintProgress('');
    setPrintJob((current) => {
      releasePrintJob(current);
      return null;
    });
    return () => {
      printAbortRef.current?.abort();
    };
  }, [receipt?.id]);

  useEffect(() => {
    if (!printJob) return undefined;
    const previousTitle = document.title;
    const printTitle = `${printJob.receiptSnapshot.branch_name}-${printJob.receiptSnapshot.receipt_date}-${printJob.mode === 'detail' ? 'รายละเอียด' : 'สรุป'}`;
    const resetPrintJob = () => {
      document.title = previousTitle;
      setPrintJob((current) => {
        releasePrintJob(current);
        return null;
      });
    };
    document.title = printTitle;
    window.addEventListener('afterprint', resetPrintJob, { once: true });
    const timer = window.setTimeout(async () => {
      await document.fonts?.ready;
      const printImages = Array.from(document.querySelectorAll('.receipt-print-sheet img'));
      await Promise.all(printImages.map((image) => image.complete ? Promise.resolve() : image.decode().catch(() => {})));
      window.print();
    }, 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', resetPrintJob);
      document.title = previousTitle;
    };
  }, [printJob]);

  if (!receipt) return <div className="detail-panel empty-state">เลือกเอกสารเพื่อทำงานต่อ</div>;

  const miscTotal = (receipt.misc_items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const cashierCashTotal = draftLines
    .filter((line) => line.channel_code === 'CASH')
    .reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const cashierNonCashTotal = draftLines
    .filter((line) => line.channel_code !== 'CASH')
    .reduce((sum, line) => sum + Number(line.cashier_amount || 0), 0);
  const cashierEnteredTotal = cashierCashTotal + cashierNonCashTotal + miscTotal;
  const cashierExpectedWithChange = Number(receipt.gross_sales_expected || 0) + Number(receipt.morning_change_amount || 0);
  const cashierSubmittedVariance = cashierEnteredTotal - cashierExpectedWithChange;
  const auditorCanEditCashierAmounts = can(user, 'check') && ['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE', 'NEEDS_CORRECTION'].includes(receipt.status);
  const cashierAmountsChanged = draftLines.some((line) => {
    const original = (receipt.lines || []).find((item) => item.id === line.id);
    return !moneyValuesEqual(line.cashier_amount, original?.cashier_amount);
  });
  const verificationAmountsChanged = draftLines.some((line) => {
    const original = (receipt.lines || []).find((item) => item.id === line.id);
    return !moneyValuesEqual(line.statement_amount, original?.statement_amount) ||
      !moneyValuesEqual(line.reconciliation_adjustment_amount, original?.reconciliation_adjustment_amount) ||
      String(line.variance_reason || '') !== String(original?.variance_reason || '') ||
      String(line.exception_category || '') !== String(original?.exception_category || '');
  });
  const reviewChanged = cashierAmountsChanged || verificationAmountsChanged;
  const updateLine = (id, patch) => {
    setDraftLines((lines) => lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
    if (patch.variance_reason !== undefined) {
      setMissingReasonLineIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const lineVariance = (line) => {
    const result = buildLineEvidenceReconciliation(line);
    return Math.abs(result.cashierVariance) >= 0.01 ||
      Math.abs(result.settlementVariance) >= 0.01 ||
      Math.abs(Number(line.reconciliation_adjustment_amount || 0)) >= 0.01;
  };
  const run = async (action) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await action();
      setMessage('บันทึกสำเร็จ');
      await onChanged(next);
    } catch (err) {
      if (!err.authExpired && !isDecisionCancelled(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = () => run(() => api.submitReceipt(receipt.id, {
    morning_change_amount: receipt.morning_change_amount,
    lines: draftLines.map((line) => ({ payment_channel_id: line.payment_channel_id, cashier_amount: line.cashier_amount }))
  }));
  const cashierAmountPayload = () => ({
    lines: draftLines.map((line) => ({ id: line.id, cashier_amount: line.cashier_amount }))
  });
  const saveCashierLine = (line) => run(() => api.updateCashierAmounts(receipt.id, {
    lines: [{ id: line.id, cashier_amount: line.cashier_amount }]
  }));
  const check = () => {
    const missing = draftLines.filter((line) => lineVariance(line) && !String(line.variance_reason || '').trim());
    if (missing.length) {
      setMissingReasonLineIds(new Set(missing.map((line) => line.id)));
      setError(`กรุณาระบุเหตุผลส่วนต่าง: ${missing.map((line) => line.channel_label).join(', ')}`);
      return;
    }
    run(async () => {
      if (cashierAmountsChanged) {
        await api.updateCashierAmounts(receipt.id, cashierAmountPayload());
      }
      return api.checkReceipt(receipt.id, {
        lines: draftLines.map((line) => ({
          id: line.id,
          payment_channel_id: line.payment_channel_id,
          statement_amount: line.statement_amount,
          reconciliation_adjustment_amount: line.reconciliation_adjustment_amount,
          variance_reason: line.variance_reason,
          exception_category: line.exception_category
        }))
      });
    });
  };
  const correction = () => {
    const note = window.prompt('เหตุผลที่ส่งกลับแก้ไข');
    if (note !== null) run(() => api.requestCorrection(receipt.id, { note }));
  };
  const close = () => {
    if (reviewChanged) {
      setError('มีการแก้ไขยอดที่ยังไม่บันทึก กรุณาบันทึกก่อนปิดเอกสาร');
      return;
    }
    run(() => api.closeReceipt(receipt.id, { note: 'Closed from UI' }));
  };
  const saveReceiptImage = async () => {
    const node = detailPanelRef.current;
    if (!node || imageSaving) return;
    setImageSaving(true);
    setError('');
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await document.fonts?.ready;
      const { toBlob } = await import('html-to-image');
      const width = Math.max(node.scrollWidth, 1200);
      const calculations = node.querySelector('.reconciliation-three-way');
      const contentEnd = calculations?.getBoundingClientRect().height > 0 ? calculations : node.querySelector('.reconciliation-matrix');
      const height = contentEnd
        ? Math.ceil(contentEnd.getBoundingClientRect().bottom - node.getBoundingClientRect().top + 24)
        : node.scrollHeight;
      const blob = await toBlob(node, {
        width,
        height,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true,
        style: { width: `${width}px`, height: `${height}px`, overflow: 'visible' },
        filter: (element) => element.tagName !== 'BUTTON' && ![
            'receipt-workflow-actions',
            'history-grid',
            'error-box',
            'success-box',
            'attachment-modal-backdrop'
          ].some((className) => element.classList?.contains(className))
      });
      if (!blob) throw new Error('สร้างไฟล์รูปภาพไม่สำเร็จ');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cashflow-${receipt.branch_code || receipt.branch_id}-${receipt.receipt_date}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('บันทึกไฟล์รูปภาพแล้ว');
    } catch (err) {
      setError(err.message || 'บันทึกไฟล์รูปภาพไม่สำเร็จ');
    } finally {
      setImageSaving(false);
    }
  };
  const prepareSummaryPrint = () => {
    if ((receipt.post_close_adjustments || []).length + 1 > PRINT_LIMITS.maxPagesPerPacket) {
      setError(`ชุดสรุปและใบปรับปรุงเกิน ${PRINT_LIMITS.maxPagesPerPacket} หน้า ไม่สามารถพิมพ์ทั้งชุดได้`);
      return;
    }
    const receiptSnapshot = structuredClone({ ...receipt, lines: draftLines });
    setPrintJob({
      mode: 'summary',
      receiptId: receipt.id,
      receiptSnapshot,
      linesSnapshot: structuredClone(draftLines),
      documents: [],
      objectUrls: []
    });
  };
  const prepareDetailPrint = async () => {
    const receiptId = receipt.id;
    const token = ++printTokenRef.current;
    printAbortRef.current?.abort();
    const controller = new AbortController();
    printAbortRef.current = controller;
    const receiptSnapshot = structuredClone({ ...receipt, lines: draftLines });
    const objectUrls = [];
    const budget = createPrintBudget();
    setDetailPrintLoading(true);
    setDetailPrintProgress('กำลังเตรียมเอกสาร');
    setError('');
    try {
      addToPrintBudget(budget, { pages: 1, fileName: 'หน้าสารบัญ' });
      for (const note of receiptSnapshot.post_close_adjustments || []) {
        addToPrintBudget(budget, { pages: 1, fileName: `ใบปรับปรุง #${note.id}` });
      }
      const entries = selectReceiptEvidenceEntries(receiptSnapshot);
      const loaded = [];
      for (let index = 0; index < entries.length; index += 1) {
        assertNotAborted(controller.signal);
        setDetailPrintProgress(`เตรียม ${index + 1}/${entries.length}`);
        loaded.push(await loadPrintableEvidenceEntry(entries[index], { budget, objectUrls, signal: controller.signal }));
      }
      if (token !== printTokenRef.current || activeReceiptIdRef.current !== receiptId) {
        throw new DOMException('เอกสารถูกเปลี่ยนระหว่างเตรียมพิมพ์', 'AbortError');
      }
      const failedCount = loaded.filter((item) => item.status === 'error').length;
      if (failedCount > 0) setMessage(`มี ${failedCount} ไฟล์ที่เปิดเพื่อพิมพ์ไม่สำเร็จ ระบบระบุไว้ในหน้าสารบัญแล้ว`);
      setPrintJob({ mode: 'detail', receiptId, receiptSnapshot, linesSnapshot: receiptSnapshot.lines, documents: loaded, objectUrls });
    } catch (err) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      if (err.name !== 'AbortError') setError(err.message || 'เตรียมเอกสารรายละเอียดไม่สำเร็จ');
    } finally {
      if (token === printTokenRef.current) {
        setDetailPrintLoading(false);
        setDetailPrintProgress('');
        printAbortRef.current = null;
      }
    }
  };

  return (
    <div className={`detail-panel receipt-review-panel ${imageSaving ? 'is-saving-image' : ''}`} ref={detailPanelRef}>
      <header className="receipt-image-header">
        <div>
          <small>บริษัท โซลาว จำกัด • GENERAL CASHFLOW</small>
          <h2>บันทึกการกระทบยอดรับเงินประจำวัน</h2>
          <p>{receipt.branch_name} • {formatThaiDate(receipt.receipt_date)} • {receipt.bill_count || 0} บิล</p>
        </div>
        <dl>
          <div><dt>สถานะ</dt><dd>{receipt.status_label}</dd></div>
          <div><dt>ยอดขาย POS</dt><dd>{money(receipt.gross_sales_expected)}</dd></div>
          <div><dt>แคชเชียร์กรอก</dt><dd>{money(cashierEnteredTotal)}</dd></div>
        </dl>
      </header>
      {!compactHeader && <div className="detail-head">
        <div><h2>{receipt.branch_name}</h2><p>{receipt.receipt_date} • {receipt.bill_count} บิล</p></div>
        <div className="detail-status-stack"><span className={statusClass(receipt.status)}>{receipt.status_label}</span>{Boolean(receipt.historical_evidence_warning) && <span className="historical-evidence-warning"><AlertTriangle size={15} />หลักฐานย้อนหลังไม่ตรง</span>}</div>
      </div>}
      {!compactHeader && <div className="summary-grid">
        <div>
          <span>รวมที่แคชเชียร์กรอก</span>
          <strong>{money(cashierEnteredTotal)}</strong>
          <small>POS + เงินทอน {money(cashierExpectedWithChange)}</small>
        </div>
        <div>
          <span>ผลต่างแคชเชียร์</span>
          <strong className={Math.abs(cashierSubmittedVariance) < 0.01 ? 'amount-ok' : 'amount-bad'}>
            {cashierSubmittedVariance > 0 ? '+' : ''}{money(cashierSubmittedVariance)}
          </strong>
          <small>เทียบกับ POS คาดไว้ + เงินทอน</small>
        </div>
        <div>
          <span>เงินสดที่กรอก</span>
          <strong>{money(cashierCashTotal)}</strong>
          <small>อ้างอิงยอดที่แคชเชียร์กรอก</small>
        </div>
        <div>
          <span>รายการอื่นๆ นับได้</span>
          <strong>+{money(miscTotal)}</strong>
          <small>แคชเชียร์เพิ่มเอง</small>
        </div>
        <div>
          <span>เงินทอนตอนเช้า</span>
          <strong>{money(receipt.morning_change_amount)}</strong>
          <small>รวมกับ POS คาดไว้เพื่อคำนวณผลต่าง</small>
        </div>
        <div>
          <span>ไม่ใช่เงินสดที่กรอก</span>
          <strong>{money(cashierNonCashTotal)}</strong>
          <small>รวมช่องทางที่แคชเชียร์กรอก</small>
        </div>
      </div>}

      <ClosedReceiptSummary receipt={receipt} />
      {postCloseNotice && <div className="post-close-saved" role="status"><CheckCircle2 size={18} /><strong>บันทึกแล้ว</strong><span>{postCloseNotice.channelLabel} {postCloseNotice.delta > 0 ? '+' : ''}{money(postCloseNotice.delta)}</span><button type="button" aria-label="ปิดข้อความบันทึกสำเร็จ" onClick={() => setPostCloseNotice(null)}><X size={16} /></button></div>}
      <ReconciliationMatrix
        user={user}
        lines={draftLines}
        attachments={receipt.attachments || []}
        statementTransactions={receipt.statement_transactions || []}
        miscItems={receipt.misc_items || []}
        receiptDate={receipt.receipt_date}
        grossSalesExpected={receipt.gross_sales_expected}
        miscTotal={miscTotal}
        morningChangeAmount={receipt.morning_change_amount}
        onLineChange={updateLine}
        onChanged={onChanged}
        onSaveCashierLine={saveCashierLine}
        onAdjustClosed={setPostCloseLine}
        adjustingLineId={postCloseLine?.id}
        renderPostCloseEditor={(line) => <PostCloseAdjustmentEditor key={`${receipt.id}-${line.id}`} receipt={receipt} line={line}
          onClose={() => setPostCloseLine(null)} onChanged={async (next, notice) => {
            if (Number(next.id) !== Number(activeReceiptIdRef.current)) return;
            await onChanged(next);
            if (Number(next.id) === Number(activeReceiptIdRef.current)) setPostCloseNotice(notice);
          }} />}
        busy={busy}
      />
      <PostCloseAdjustmentHistory receipt={receipt} />

      {['CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status) && (
        <div className={`receipt-check-complete ${receipt.status === 'CHECKED_VARIANCE' ? 'has-variance' : 'is-complete'}`} role="status">
          {receipt.status === 'CHECKED_VARIANCE' ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
          <div>
            <strong>ตรวจยอดทั้งหมดแล้ว</strong>
            <span>{receipt.status === 'CHECKED_VARIANCE' ? 'มีส่วนต่างที่บันทึกเหตุผลแล้ว' : 'ยอดครบทุกช่องทาง'}</span>
          </div>
          <b>ขั้นตอนถัดไป: ปิดเอกสาร</b>
        </div>
      )}

      {(can(user, 'submit') || can(user, 'check') || can(user, 'close') || receipt.status === 'CLOSED') && <div className="receipt-workflow-actions">
        {can(user, 'submit') && ['DRAFT', 'NEEDS_CORRECTION'].includes(receipt.status) && (
          <Button icon={Save} busy={busy} onClick={submit}>ส่งยอดแคชเชียร์</Button>
        )}
        {can(user, 'check') && receipt.status !== 'CLOSED' && <>
          <Button
            icon={ClipboardCheck}
            busy={busy}
            disabled={!['SUBMITTED', 'CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status) || (['CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status) && !reviewChanged)}
            onClick={check}
          >
            {receipt.status === 'SUBMITTED' ? 'ยืนยันตรวจยอดทั้งหมด' : reviewChanged ? 'ยืนยันการแก้ไข' : 'ตรวจยอดแล้ว'}
          </Button>
          <Button icon={RotateCcw} variant="warning" busy={busy} disabled={receipt.status === 'CLOSED'} onClick={correction}>ส่งกลับแก้ไข</Button>
        </>}
        {can(user, 'close') && receipt.status !== 'CLOSED' && (
          <Button icon={CheckCircle2} busy={busy} disabled={!['CHECKED_OK', 'CHECKED_VARIANCE'].includes(receipt.status)} onClick={close}>ปิดเอกสาร</Button>
        )}
        {receipt.status === 'CLOSED' && <>
          <Button icon={Printer} variant="secondary" disabled={detailPrintLoading} onClick={prepareSummaryPrint}>พิมพ์สรุป</Button>
          <Button icon={FileText} busy={detailPrintLoading} onClick={prepareDetailPrint}>{detailPrintLoading ? detailPrintProgress : 'พิมพ์รายละเอียด'}</Button>
          <Button icon={Download} variant="secondary" busy={imageSaving} onClick={saveReceiptImage}>{imageSaving ? 'กำลังบันทึกรูป' : 'บันทึกเป็นรูปภาพ'}</Button>
        </>}
      </div>}
      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}
      <div className="history-grid">
        <section><h3>Statement imports</h3>{(receipt.statement_imports || []).map((item) => <div className="mini-row" key={item.id}><span>{item.channel_label || '-'} • {item.receiving_account_label || '-'}</span><strong>{money(item.total_amount)}</strong></div>)}{(receipt.statement_imports || []).length === 0 && <p className="muted">ยังไม่มี statement</p>}</section>
        <section><h3>Audit trail</h3>{(receipt.audit_logs || []).slice(0, 6).map((item) => <div className="mini-row" key={item.id}><span>{item.action}</span><small>{item.actor_name || item.actor_role || '-'}</small></div>)}</section>
      </div>
      {printJob && createPortal(
        printJob.mode === 'detail'
          ? <ReceiptEvidencePrintSheet receipt={printJob.receiptSnapshot} documents={printJob.documents} />
          : <ReceiptPrintSheet receipt={printJob.receiptSnapshot} lines={printJob.linesSnapshot} mode={printJob.mode} />,
        document.body
      )}
    </div>
  );
};

const SettingsView = ({ branches, channels, accounts, onReload }) => {
  const [branchForm, setBranchForm] = useState({ code: '', name: '', clickhouse_branch_id: '' });
  const [channelDrafts, setChannelDrafts] = useState({});
  const [accountForm, setAccountForm] = useState({
    branch_id: '',
    label: '',
    bank_name: '',
    account_number: '',
    account_name: '',
    account_alias: '',
    account_type: '',
    payment_channel_ids: []
  });
  const [accountDrafts, setAccountDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const drafts = {};
    channels.forEach((channel) => {
      drafts[channel.id] = {
        ...channel,
        mappingsText: (channel.mappings || []).join('\n')
      };
    });
    setChannelDrafts(drafts);
  }, [channels]);

  useEffect(() => {
    const drafts = {};
    accounts.forEach((account) => {
      drafts[account.id] = { ...account, payment_channel_ids: account.channel_ids || [] };
    });
    setAccountDrafts(drafts);
  }, [accounts]);

  const saveBranch = async () => {
    setError('');
    try {
      await api.createBranch(branchForm);
      setBranchForm({ code: '', name: '', clickhouse_branch_id: '' });
      setMessage('บันทึกสาขาแล้ว');
      onReload();
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    }
  };

  const saveChannel = async (channelId) => {
    setError('');
    const draft = channelDrafts[channelId];
    try {
      await api.updatePaymentChannel(channelId, {
        label: draft.label,
        provider: draft.provider,
        account_number: draft.account_number,
        sort_order: draft.sort_order,
        is_active: draft.is_active,
        mappings: draft.mappingsText.split('\n').map((line) => line.trim()).filter(Boolean)
      });
      setMessage('บันทึกช่องทางแล้ว');
      onReload();
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    }
  };

  const saveAccount = async (accountId = null) => {
    setError('');
    const payload = accountId ? accountDrafts[accountId] : accountForm;
    try {
      if (accountId) await api.updateReceivingAccount(accountId, payload);
      else {
        await api.createReceivingAccount(payload);
        setAccountForm({
          branch_id: '',
          label: '',
          bank_name: '',
          account_number: '',
          account_name: '',
          account_alias: '',
          account_type: '',
          payment_channel_ids: []
        });
      }
      setMessage('บันทึกบัญชีรับเงินแล้ว');
      onReload();
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    }
  };

  const toggleAccountChannel = (account, channelId) => {
    const selected = new Set(account.payment_channel_ids || []);
    if (selected.has(channelId)) selected.delete(channelId);
    else selected.add(channelId);
    return { ...account, payment_channel_ids: [...selected] };
  };

  return (
    <section className="settings-view">
      <div className="settings-section">
        <h2>สาขา</h2>
        <div className="settings-grid">
          {branches.map((branch) => (
            <div className="setting-row" key={branch.id}>
              <strong>{branch.name}</strong>
              <span>{branch.clickhouse_branch_id || 'ไม่มี ClickHouse ID'}</span>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <input placeholder="Code" value={branchForm.code} onChange={(event) => setBranchForm({ ...branchForm, code: event.target.value })} />
          <input placeholder="ชื่อสาขา" value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })} />
          <input placeholder="ClickHouse branch id" value={branchForm.clickhouse_branch_id} onChange={(event) => setBranchForm({ ...branchForm, clickhouse_branch_id: event.target.value })} />
          <Button icon={Save} onClick={saveBranch}>บันทึก</Button>
        </div>
      </div>

      <div className="settings-section">
        <h2>บัญชีรับเงินจริง</h2>
        <p className="muted">บัญชีหนึ่งผูกได้หลายช่องทาง ระบบจะให้เลือกบัญชีนี้ก่อนอัปโหลด statement</p>
        <div className="account-editor">
          {accounts.map((account) => {
            const draft = accountDrafts[account.id] || account;
            return (
              <div className="account-row" key={account.id}>
                <input placeholder="ชื่อบัญชี เช่น กสิกร ••••3108" value={draft.label || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, label: event.target.value } })} />
                <select value={draft.branch_id || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, branch_id: event.target.value } })}>
                  <option value="">ทุกสาขา</option>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
                <input placeholder="ธนาคาร" value={draft.bank_name || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, bank_name: event.target.value } })} />
                <input placeholder="เลขบัญชี" value={draft.account_number || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, account_number: event.target.value } })} />
                <input placeholder="ชื่อบัญชี" value={draft.account_name || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, account_name: event.target.value } })} />
                <input placeholder="ชื่อย่อบัญชี" value={draft.account_alias || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, account_alias: event.target.value } })} />
                <input placeholder="ประเภทบัญชี" value={draft.account_type || ''} onChange={(event) => setAccountDrafts({ ...accountDrafts, [account.id]: { ...draft, account_type: event.target.value } })} />
                <div className="account-channel-checks">
                  {channels.filter((channel) => channel.code !== 'CASH' && channel.code !== 'OTHER_UNKNOWN').map((channel) => (
                    <label key={channel.id}><input type="checkbox" checked={(draft.payment_channel_ids || []).includes(channel.id)} onChange={() => setAccountDrafts({ ...accountDrafts, [account.id]: toggleAccountChannel(draft, channel.id) })} /> {channel.label}</label>
                  ))}
                </div>
                <Button icon={Save} variant="secondary" onClick={() => saveAccount(account.id)}>บันทึก</Button>
              </div>
            );
          })}
        </div>
        <div className="account-create-form">
          <input placeholder="ชื่อบัญชีรับเงิน" value={accountForm.label} onChange={(event) => setAccountForm({ ...accountForm, label: event.target.value })} />
          <select value={accountForm.branch_id || ''} onChange={(event) => setAccountForm({ ...accountForm, branch_id: event.target.value })}>
            <option value="">ทุกสาขา</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          <input placeholder="ธนาคาร" value={accountForm.bank_name} onChange={(event) => setAccountForm({ ...accountForm, bank_name: event.target.value })} />
          <input placeholder="เลขบัญชี" value={accountForm.account_number} onChange={(event) => setAccountForm({ ...accountForm, account_number: event.target.value })} />
          <input placeholder="ชื่อบัญชี" value={accountForm.account_name} onChange={(event) => setAccountForm({ ...accountForm, account_name: event.target.value })} />
          <input placeholder="ชื่อย่อบัญชี" value={accountForm.account_alias} onChange={(event) => setAccountForm({ ...accountForm, account_alias: event.target.value })} />
          <input placeholder="ประเภทบัญชี" value={accountForm.account_type} onChange={(event) => setAccountForm({ ...accountForm, account_type: event.target.value })} />
          <div className="account-channel-checks">
            {channels.filter((channel) => channel.code !== 'CASH' && channel.code !== 'OTHER_UNKNOWN').map((channel) => (
              <label key={channel.id}><input type="checkbox" checked={accountForm.payment_channel_ids.includes(channel.id)} onChange={() => setAccountForm(toggleAccountChannel(accountForm, channel.id))} /> {channel.label}</label>
            ))}
          </div>
          <Button icon={Save} onClick={() => saveAccount()}>เพิ่มบัญชี</Button>
        </div>
      </div>

      <div className="settings-section">
        <h2>ช่องทางรับเงิน</h2>
        <div className="channel-editor">
          {channels.map((channel) => {
            const draft = channelDrafts[channel.id] || channel;
            return (
              <div className="channel-row" key={channel.id}>
                <input placeholder="ชื่อช่องทาง" value={draft.label || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, label: event.target.value } })} />
                <input placeholder="ผู้ให้บริการ" value={draft.provider || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, provider: event.target.value } })} />
                <input placeholder="เลขบัญชี" value={draft.account_number || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, account_number: event.target.value } })} />
                <textarea placeholder="คำอธิบายที่ตรงกับ ClickHouse (บรรทัดละ 1 รายการ)" value={draft.mappingsText || ''} onChange={(event) => setChannelDrafts({ ...channelDrafts, [channel.id]: { ...draft, mappingsText: event.target.value } })} />
                <Button icon={Save} variant="secondary" onClick={() => saveChannel(channel.id)}>บันทึก</Button>
              </div>
            );
          })}
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}
    </section>
  );
};

const INBOX_PROVIDER_LABELS = {
  KRUNGSRIBIZ_MUNGMEE: 'Krungsri Biz Mung-Mee',
  KRUNGTHAI_BUSINESS: 'Krungthai Business',
  SCB_BUSINESS_ANYWHERE: 'SCB Business Anywhere',
  GRAB_DAILY: 'Grab',
  KPLUSSHOP: 'K SHOP'
};

const INBOX_STATUS_LABELS = {
  PENDING_REVIEW: 'รอตรวจ',
  PROCESSED: 'นำเข้าแล้ว',
  FAILED: 'อ่านไม่สำเร็จ'
};

const BankInboxView = () => {
  const [imports, setImports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [providerFilter, setProviderFilter] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);

  const closeViewer = () => {
    if (viewer?.url) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  };

  useEffect(() => () => {
    if (viewer?.url) URL.revokeObjectURL(viewer.url);
  }, [viewer?.url]);

  const loadTransactions = async (item) => {
    if (!item) {
      setTransactions([]);
      return;
    }
    setTransactions([]);
    try {
      setTransactions(await api.inboxImportTransactions(item.id));
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    }
  };

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const rows = await api.inboxImports();
      setImports(rows);
      const refreshed = selected ? rows.find((row) => row.id === selected.id) : rows[0];
      setSelected(refreshed || null);
      await loadTransactions(refreshed || null);
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectImport = async (item) => {
    setSelected(item);
    setError('');
    await loadTransactions(item);
  };

  const changeProviderFilter = (provider) => {
    setProviderFilter(provider);
    if (provider === 'ALL' || selected?.provider === provider) return;
    const next = imports.find((item) => item.provider === provider) || null;
    setSelected(next);
    setError('');
    loadTransactions(next);
  };

  const providerFilters = useMemo(
    () => [...new Set(imports.map((item) => item.provider).filter(Boolean))],
    [imports]
  );
  const visibleImports = useMemo(
    () => imports.filter((item) => providerFilter === 'ALL' || item.provider === providerFilter),
    [imports, providerFilter]
  );
  const importedTransactionCount = imports.reduce((sum, item) => sum + Number(item.transaction_count || 0), 0);
  const importedTotal = imports.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  const openFile = async () => {
    if (!selected) return;
    setOpening(true);
    setError('');
    try {
      const file = await api.inboxImportFile(selected.id);
      setViewer({
        url: URL.createObjectURL(file.blob),
        name: file.fileName || selected.original_name,
        mimeType: file.blob.type || 'application/octet-stream'
      });
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="workspace inbox-workspace">
      <header className="inbox-workspace-head">
        <div>
          <h2>ไฟล์นำเข้าจากอีเมล</h2>
          <p>เลือกแหล่งข้อมูล แล้วเปิดไฟล์ต้นฉบับหรือดูรายการเงินที่ระบบอ่านได้ทันที</p>
        </div>
        <Button icon={RefreshCw} variant="secondary" busy={busy} onClick={load}>รีเฟรช</Button>
      </header>
      {error && <div className="error-box">{error}</div>}
      <div className="inbox-summary" aria-label="สรุปไฟล์นำเข้า">
        <div><span>ไฟล์ทั้งหมด</span><strong>{imports.length}</strong></div>
        <div><span>รายการที่อ่านได้</span><strong>{importedTransactionCount}</strong></div>
        <div><span>ยอดเงินในไฟล์</span><strong>{money(importedTotal)}</strong></div>
      </div>
      <div className="inbox-provider-filters" aria-label="กรองแหล่งไฟล์">
        <button type="button" className={`filter-chip ${providerFilter === 'ALL' ? 'active' : ''}`} onClick={() => changeProviderFilter('ALL')}>ทั้งหมด <b>{imports.length}</b></button>
        {providerFilters.map((provider) => {
          const count = imports.filter((item) => item.provider === provider).length;
          return <button type="button" key={provider} className={`filter-chip ${providerFilter === provider ? 'active' : ''}`} onClick={() => changeProviderFilter(provider)}>{INBOX_PROVIDER_LABELS[provider] || provider} <b>{count}</b></button>;
        })}
      </div>
      <div className="inbox-layout">
        <div className="inbox-import-list">
          {imports.length === 0 && <div className="empty-state">ยังไม่มีไฟล์นำเข้าจากอีเมล</div>}
          {imports.length > 0 && visibleImports.length === 0 && <div className="empty-state">ไม่พบไฟล์จากแหล่งที่เลือก</div>}
          {visibleImports.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`inbox-import-row ${selected?.id === item.id ? 'active' : ''}`}
              onClick={() => selectImport(item)}
            >
              <span className="inbox-import-provider">{INBOX_PROVIDER_LABELS[item.provider] || item.provider}</span>
              <strong>{item.original_name}</strong>
              <small>{item.source_date || '-'} • {Number(item.transaction_count || 0)} รายการ • {money(item.total_amount)}</small>
              <span className={`status inbox-status-${String(item.status || '').toLowerCase().replaceAll('_', '-')}`}>{INBOX_STATUS_LABELS[item.status] || item.status}</span>
            </button>
          ))}
        </div>
        <div className="inbox-detail-panel">
          {!selected && <div className="empty-state">เลือกไฟล์ด้านซ้ายเพื่อดูรายละเอียด</div>}
          {selected && (
            <>
              <div className="inbox-detail-head">
                <div>
                  <span>{INBOX_PROVIDER_LABELS[selected.provider] || selected.provider}</span>
                  <h3>{selected.original_name}</h3>
                  <small>{selected.source_date || '-'} • ยอดรวม {money(selected.total_amount)}</small>
                </div>
                <Button icon={FileText} variant="secondary" busy={opening} disabled={!selected.file_available} onClick={openFile}>เปิดไฟล์</Button>
              </div>
              <div className="inbox-transaction-table" role="table" aria-label="รายการจากไฟล์นำเข้า">
                <div className="inbox-transaction-row inbox-transaction-head" role="row">
                  <span>วันที่</span><span>รายละเอียด</span><span>อ้างอิง</span><strong>เงินเข้า</strong>
                </div>
                {transactions.length === 0 && <div className="empty-state">ไฟล์นี้ไม่มีรายการที่อ่านได้ หรือยังรอการแปลงไฟล์</div>}
                {transactions.map((row) => (
                  <div className="inbox-transaction-row" role="row" key={row.id}>
                    <span>{row.transaction_date || '-'}</span>
                    <span>{row.description || '-'}</span>
                    <span>{row.reference_no || '-'}</span>
                    <strong>{money(row.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {viewer && (
        <div className="attachment-viewer-backdrop" role="presentation" onMouseDown={closeViewer}>
          <div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={viewer.name} onMouseDown={(event) => event.stopPropagation()}>
            <header><strong>{viewer.name}</strong><button type="button" aria-label="ปิด" onClick={closeViewer}><X size={18} /></button></header>
            {viewer.mimeType.includes('pdf') || viewer.mimeType.startsWith('image/')
              ? <iframe title={viewer.name} src={viewer.url} />
              : <a className="btn btn-primary" href={viewer.url} download={viewer.name}>ดาวน์โหลดไฟล์</a>}
          </div>
        </div>
      )}
    </section>
  );
};

const SEVERITY_STYLE = {
  critical: { label: 'ต้องทำก่อน', className: 'brief-critical' },
  warning: { label: 'ควรดูวันนี้', className: 'brief-warning' },
  info: { label: 'ไว้ดูเมื่อว่าง', className: 'brief-info' }
};

const MorningBriefView = () => {
  const [brief, setBrief] = useState(null);
  const [date, setDate] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true); else setBusy(true);
    setError('');
    try {
      setBrief(refresh ? await api.refreshMorningBrief({ date }) : await api.morningBrief({ date }));
    } catch (err) {
      if (!err.authExpired) setError(err.message);
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [date]);

  const grouped = useMemo(() => {
    const findings = brief?.findings || [];
    return ['critical', 'warning', 'info']
      .map((severity) => ({ severity, items: findings.filter((finding) => finding.severity === severity) }))
      .filter((group) => group.items.length > 0);
  }, [brief]);

  return (
    <section className="panel morning-brief">
      <header className="panel-header">
        <h2><Sunrise size={18} /> สรุปงานค้าง</h2>
        <div className="brief-controls">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button variant="ghost" icon={RefreshCw} busy={refreshing} onClick={() => load({ refresh: true })}>
            {refreshing ? 'กำลังสร้างใหม่...' : 'สร้างใหม่'}
          </Button>
        </div>
      </header>

      {error && <div className="global-error">{error}</div>}
      {busy && <p className="muted">กำลังโหลด...</p>}

      {!busy && brief && (
        <>
          <div className="brief-meta">
            <span>{brief.source === 'ai' ? `เรียบเรียงโดย AI (${brief.model || '-'})` : 'สรุปจากข้อมูลตรง (AI ปิดอยู่หรือเรียกไม่สำเร็จ)'}</span>
            <span>พบ {brief.finding_count} รายการ · แสดง {brief.shown_count}</span>
            {brief.cached && <span>บันทึกไว้เมื่อ {new Date(brief.generated_at).toLocaleString('th-TH')}</span>}
          </div>
          {brief.error && (
            <div className="brief-fallback-note">
              <AlertTriangle size={14} /> AI เรียกไม่สำเร็จ ({brief.error}) จึงแสดงสรุปจากข้อมูลตรงแทน
            </div>
          )}

          {brief.brief?.top_actions?.length > 0 && (
            <div className="brief-actions">
              <h3>ทำก่อน</h3>
              <ol>{brief.brief.top_actions.map((action, index) => <li key={index}>{action}</li>)}</ol>
            </div>
          )}

          {grouped.length === 0 && <p className="muted">ไม่พบงานค้างของวันนี้</p>}

          {grouped.map((group) => (
            <div key={group.severity} className={`brief-group ${SEVERITY_STYLE[group.severity].className}`}>
              <h3>{SEVERITY_STYLE[group.severity].label}</h3>
              <ul>
                {group.items.map((finding, index) => (
                  <li key={`${finding.kind}-${index}`}>
                    <strong>{finding.title}</strong>
                    {finding.detail && <span className="brief-detail">{finding.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {brief.source === 'ai' && brief.text && (
            <details className="brief-raw">
              <summary>ข้อความเต็มจาก AI</summary>
              <pre>{brief.text}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
};

const ReportView = ({ branches }) => {
  const [filters, setFilters] = useState({ from: today(), to: today(), branch_id: '' });
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setReport(await api.reconciliation(filters));
    } catch (err) {
      if (err.authExpired) return;
      setError(err.message);
    }
  };

  return (
    <section className="workspace">
      <div className="toolbar">
        <Field label="จาก">
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </Field>
        <Field label="ถึง">
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </Field>
        <Field label="สาขา">
          <select value={filters.branch_id} onChange={(event) => setFilters({ ...filters, branch_id: event.target.value })}>
            <option value="">ทุกสาขา</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        <Button icon={Search} onClick={load}>ดูรายงาน</Button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {report && (
        <>
          <div className="metric-strip">
            <div><span>Expected</span><strong>{money(report.summary.gross_sales_expected)}</strong></div>
            <div><span>แคชเชียร์</span><strong>{money(report.summary.cashier_total)}</strong></div>
            <div><span>ตรวจพบ</span><strong>{money(report.summary.verified_total)}</strong></div>
            <div><span>ส่วนต่าง</span><strong>{money(report.summary.variance_total)}</strong></div>
          </div>
          <div className="report-table">
            {report.rows.map((row) => (
              <div className="report-row" key={`${row.receipt_date}-${row.branch_name}`}>
                <span>{row.receipt_date}</span>
                <strong>{row.branch_name}</strong>
                <span>{row.status}</span>
                <span>{money(row.gross_sales_expected)}</span>
                <span>{money(row.variance_total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

const AgentHealthView = () => {
  const [health, setHealth] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState({});
  const load = async () => {
    setError('');
    try {
      const [nextHealth, nextDecisions] = await Promise.all([
        api.agentHealth(), api.decisions({ limit: 80 })
      ]);
      setHealth(nextHealth); setDecisions(nextDecisions);
    } catch (err) { if (!err.authExpired) setError(err.message); }
  };
  useEffect(() => { load(); }, []);
  const answerFollowup = async (row) => {
    const answer = String(answers[row.id] || '').trim();
    if (!answer) return;
    await api.answerDecisionFollowup(row.id, answer);
    setAnswers((current) => ({ ...current, [row.id]: '' }));
    await load();
  };
  const recent = health?.last_7_days || {};
  return <section className="workspace agent-health-view">
    <div className="toolbar"><div><h2>Agent Health</h2><p>Shadow AI สังเกตการณ์เท่านั้น ไม่เขียนยอดหรือปิดรอบ</p></div><Button variant="ghost" icon={RefreshCw} onClick={load}>โหลดใหม่</Button></div>
    {error && <div className="error-box">{error}</div>}
    <div className="metric-strip">
      <div><span>โหมด</span><strong>{health?.shadow_mode ? 'Shadow' : '-'}</strong></div>
      <div><span>ตัดสินใจ 7 วัน</span><strong>{Number(recent.completed || 0) + Number(recent.failed || 0)}</strong></div>
      <div><span>เห็นตรงกับคน</span><strong>{Number(recent.agreed || 0)}</strong></div>
      <div><span>เห็นต่าง</span><strong>{Number(recent.disagreed || 0)}</strong></div>
      <div><span>ยกเลิกก่อนทำ</span><strong>{Number(health?.decisions?.cancelled || 0)}</strong></div>
    </div>
    <div className="agent-guardrail"><CheckCircle2 size={18} /><span><strong>AI ไม่มีสิทธิ์เปลี่ยนข้อมูลธุรกิจ</strong> การทำงานยังดำเนินต่อได้เมื่อ OpenAI ล่มหรือไม่ได้ตั้ง key</span></div>
    <div className="panel"><header className="panel-header"><h2>การตัดสินใจล่าสุด</h2><span>{decisions.length} รายการ</span></header>
      <div className="agent-decision-list">{decisions.map((row) => { const state = row.status === 'cancelled' ? 'cancelled' : (row.comparison_status || row.shadow_status || row.status); return <article key={row.id}>
        <div><strong>{row.action_key}</strong><small>{new Date(row.created_at).toLocaleString('th-TH')} · {row.reason_code || 'ยังไม่ให้เหตุผล'}</small></div>
        <span className={`agent-state ${state}`}>{state === 'cancelled' ? 'ยกเลิกก่อนทำ' : state}</span>
        <p>{row.status === 'cancelled' ? 'ผู้ใช้ยกเลิกก่อนบันทึกรายการ ข้อมูลธุรกิจไม่ถูกเปลี่ยน' : (row.reason_text || row.rationale || 'รอผล Shadow')}</p>
        {row.followup_status === 'open' && <div className="agent-followup"><strong>{row.followup_question}</strong><textarea rows="2" value={answers[row.id] || ''} onChange={(event) => setAnswers((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="อธิบายหลักฐานหรือบริบทที่ AI ยังไม่เห็น" /><Button onClick={() => answerFollowup(row)}>ส่งคำตอบ</Button></div>}
      </article>; })}</div>
    </div>
  </section>;
};

const App = () => {
  const [user, setUser] = useState(() => {
    try {
      if (!hasAuthToken()) {
        clearAuthSession();
        return null;
      }
      const storedUser = JSON.parse(localStorage.getItem('cashflow_user') || 'null');
      if (isCashierLaunchRequested() && storedUser?.role !== 'cashier') {
        clearAuthSession();
        return null;
      }
      return storedUser;
    } catch {
      clearAuthSession();
      return null;
    }
  });
  const [view, setView] = useState('dashboard');
  const [branches, setBranches] = useState([]);
  const [channels, setChannels] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(savedDashboardFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cashierHasUnsavedDraft, setCashierHasUnsavedDraft] = useState(false);
  const [reviewNoteHasUnsavedDraft, setReviewNoteHasUnsavedDraft] = useState(false);
  const receiptLoadSequence = useRef(0);
  const dashboardFiltersRef = useRef(filters);
  dashboardFiltersRef.current = filters;

  const loadSettings = async () => {
    const [branchRows, channelRows, accountRows] = await Promise.all([api.branches(), api.paymentChannels(), api.receivingAccounts()]);
    setBranches(branchRows);
    setChannels(channelRows);
    setAccounts(accountRows);
  };

  const loadReceipts = async () => {
    const requestedFilters = { ...dashboardFiltersRef.current };
    const requestId = ++receiptLoadSequence.current;
    if (!requestedFilters.date || !requestedFilters.branch_id) {
      setReceipts([]);
      setSelected(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      let rows = await api.receipts(requestedFilters);
      if (requestId !== receiptLoadSequence.current || !dashboardFiltersEqual(requestedFilters, dashboardFiltersRef.current)) return;
      let nextSelected = null;
      if (rows.length === 0 && can(user, 'create')) {
        nextSelected = await api.createFromClickHouse({ date: requestedFilters.date, branch_id: requestedFilters.branch_id });
        if (requestId !== receiptLoadSequence.current || !dashboardFiltersEqual(requestedFilters, dashboardFiltersRef.current)) return;
        rows = await api.receipts(requestedFilters);
      } else if (rows.length > 0) {
        nextSelected = await api.receipt(rows[0].id);
      }
      if (requestId !== receiptLoadSequence.current || !dashboardFiltersEqual(requestedFilters, dashboardFiltersRef.current)) return;
      setSelected(nextSelected);
      setReceipts(rows);
    } catch (err) {
      if (requestId !== receiptLoadSequence.current) return;
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      if (requestId === receiptLoadSequence.current) setBusy(false);
    }
  };

  const selectReceipt = async (receiptOrId) => {
    const requestedFilters = { ...dashboardFiltersRef.current };
    if (typeof receiptOrId === 'object' && receiptOrId?.id && !receiptMatchesDashboardFilters(receiptOrId, requestedFilters)) return;
    const requestId = ++receiptLoadSequence.current;
    setBusy(true);
    setError('');
    try {
      const next = typeof receiptOrId === 'object' && receiptOrId?.id
        ? receiptOrId
        : await api.receipt(receiptOrId);
      if (
        requestId !== receiptLoadSequence.current ||
        !dashboardFiltersEqual(requestedFilters, dashboardFiltersRef.current) ||
        !receiptMatchesDashboardFilters(next, requestedFilters)
      ) return;
      // Action responses already contain the new receipt. Render them first so
      // status stamps update immediately, then refresh the compact list.
      setSelected(next);
      const rows = await api.receipts(requestedFilters);
      if (requestId === receiptLoadSequence.current && dashboardFiltersEqual(requestedFilters, dashboardFiltersRef.current)) {
        setReceipts(rows);
      }
    } catch (err) {
      if (requestId !== receiptLoadSequence.current) return;
      if (err.authExpired) return;
      setError(err.message);
    } finally {
      if (requestId === receiptLoadSequence.current) setBusy(false);
    }
  };

  const confirmDiscardReviewNote = () =>
    !reviewNoteHasUnsavedDraft || window.confirm(UNSAVED_REVIEW_NOTE_MESSAGE);

  const changeDashboardFilters = (nextFilters) => {
    if (dashboardFiltersEqual(nextFilters, dashboardFiltersRef.current)) return;
    if (!confirmDiscardReviewNote()) return;
    receiptLoadSequence.current += 1;
    setReviewNoteHasUnsavedDraft(false);
    setSelected(null);
    setFilters(nextFilters);
  };

  const changeView = (nextView) => {
    if (nextView === view) return;
    if (!confirmDiscardReviewNote()) return;
    receiptLoadSequence.current += 1;
    setReviewNoteHasUnsavedDraft(false);
    setBusy(false);
    setView(nextView);
  };

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setBranches([]);
      setChannels([]);
      setAccounts([]);
      setReceipts([]);
      setSelected(null);
      setError('');
      setBusy(false);
      setReviewNoteHasUnsavedDraft(false);
      receiptLoadSequence.current += 1;
      setView('dashboard');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    if (!user) return;
    setView('dashboard');
    loadSettings()
      .then(async () => {
        if (user.role === 'cashier') return;
        const saved = savedDashboardFilters();
        if (saved.branch_id && saved.date) return;
        const latestReceipts = await api.receipts({});
        const latest = latestReceipts[0];
        if (latest) {
          setFilters({ date: latest.receipt_date, branch_id: String(latest.branch_id), status: '' });
        }
      })
      .catch((err) => {
        if (err.authExpired) return;
        setError(err.message);
      });
  }, [user]);

  useEffect(() => {
    if (!user || user.role === 'cashier' || !filters.branch_id || !filters.date) return;
    localStorage.setItem(DASHBOARD_FILTERS_KEY, JSON.stringify({
      branch_id: filters.branch_id,
      date: filters.date
    }));
  }, [user, filters.branch_id, filters.date]);

  useEffect(() => {
    if (!user || user.role === 'cashier') return;
    loadReceipts();
  }, [user, filters.date, filters.status, filters.branch_id]);

  useEffect(() => {
    if (!reviewNoteHasUnsavedDraft) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [reviewNoteHasUnsavedDraft]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  const logout = () => {
    if (cashierHasUnsavedDraft && !window.confirm(UNSAVED_CASHIER_MESSAGE)) return;
    if (!confirmDiscardReviewNote()) return;
    clearAuthSession();
    setUser(null);
    setCashierHasUnsavedDraft(false);
    setReviewNoteHasUnsavedDraft(false);
    receiptLoadSequence.current += 1;
  };

  return (
    <main className={`app-shell ${user.role === 'cashier' ? 'app-shell-locked' : ''}`}>
      {user.role !== 'cashier' && (
        <header className="topbar">
          <div className="brand-row compact">
            <div className="brand-mark"><Banknote size={22} /></div>
            <div>
              <h1>General Cashflow</h1>
              <p>{user.full_name || user.username} • {user.role}</p>
            </div>
          </div>
          <nav>
            <button className={view === 'dashboard' ? 'active' : ''} onClick={() => changeView('dashboard')}>
              <ClipboardCheck size={16} /> งานรับเงิน
            </button>
            {can(user, 'report') && (
              <button className={view === 'report' ? 'active' : ''} onClick={() => changeView('report')}>
                <FileSpreadsheet size={16} /> รายงาน
              </button>
            )}
            {can(user, 'inbox') && (
              <button className={view === 'brief' ? 'active' : ''} onClick={() => changeView('brief')}>
                <Sunrise size={16} /> สรุปงานค้าง
              </button>
            )}
            {can(user, 'inbox') && (
              <button className={view === 'inbox' ? 'active' : ''} onClick={() => changeView('inbox')}>
                <FileText size={16} /> ไฟล์อีเมล
              </button>
            )}
            {can(user, 'settings') && (
              <button className={view === 'settings' ? 'active' : ''} onClick={() => changeView('settings')}>
                <Settings size={16} /> ตั้งค่า
              </button>
            )}
            {can(user, 'agents') && (
              <button className={view === 'agents' ? 'active' : ''} onClick={() => changeView('agents')}>
                <Bot size={16} /> Agent Health
              </button>
            )}
            <button onClick={logout}><LogOut size={16} /> ออก</button>
          </nav>
        </header>
      )}
      {error && <div className="global-error">{error}</div>}
      {view === 'dashboard' && user.role === 'cashier' && (
        <CashierWorkspace branches={branches} onDirtyChange={setCashierHasUnsavedDraft} onLogout={logout} />
      )}
      {view === 'dashboard' && user.role !== 'cashier' && (
        <Dashboard
          user={user}
          branches={branches}
          receipts={receipts}
          selected={selected}
          filters={filters}
          onFiltersChange={changeDashboardFilters}
          onLoad={loadReceipts}
          onSelect={selectReceipt}
          onReviewNoteDirtyChange={setReviewNoteHasUnsavedDraft}
          busy={busy}
        />
      )}
      {view === 'settings' && can(user, 'settings') && <SettingsView branches={branches} channels={channels} accounts={accounts} onReload={loadSettings} />}
      {view === 'report' && can(user, 'report') && <ReportView branches={branches} />}
      {view === 'brief' && can(user, 'inbox') && <MorningBriefView />}
      {view === 'inbox' && can(user, 'inbox') && <BankInboxView />}
      {view === 'agents' && can(user, 'agents') && <AgentHealthView />}
    </main>
  );
};

export default App;
