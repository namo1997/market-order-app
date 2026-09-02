const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export const GOOGLE_SHEETS_STATUS_LABELS = Object.freeze({
  DRAFT: 'ร่าง / ยังไม่กรอก',
  SUBMITTED: 'ส่งยอดแล้ว',
  NEEDS_CORRECTION: 'ต้องแก้ไข',
  CHECKED_OK: 'ตรวจแล้ว',
  CHECKED_VARIANCE: 'ตรวจแล้ว มีส่วนต่าง',
  CLOSED: 'ปิดยอดแล้ว'
});

export const googleSheetsStatusLabel = (status) =>
  GOOGLE_SHEETS_STATUS_LABELS[String(status || '').trim()] || 'ยังไม่สร้าง';

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const cashPlusChangeForSheets = ({
  status,
  cashCashierAmount
} = {}) => {
  const normalizedStatus = String(status || '').trim();
  const cash = Number(cashCashierAmount || 0);
  // The cashier CASH amount already includes the morning change carried in the
  // drawer. Adding morning_change_amount here would count that float twice.
  if (!normalizedStatus || (normalizedStatus === 'DRAFT' && cash === 0)) return '';
  return roundCurrency(cash);
};

export const morningChangeForSheets = ({ status, morningChangeAmount } = {}) => {
  const normalizedStatus = String(status || '').trim();
  const change = Number(morningChangeAmount || 0);
  if (!normalizedStatus || (normalizedStatus === 'DRAFT' && change === 0)) return '';
  return roundCurrency(change);
};

export const positiveAmountForSheets = (value) => {
  const amount = Number(value || 0);
  return amount > 0 ? roundCurrency(amount) : '';
};

const CASHIER_SUBMITTED_STATUSES = new Set([
  'SUBMITTED',
  'NEEDS_CORRECTION',
  'CHECKED_OK',
  'CHECKED_VARIANCE',
  'CLOSED'
]);

export const closedAmountOrCashierForSheets = ({
  hasClosedAmount,
  closedAmount,
  cashierAmount,
  status
} = {}) => {
  if (hasClosedAmount) return roundCurrency(closedAmount);
  if (!CASHIER_SUBMITTED_STATUSES.has(String(status || '').trim())) return '';
  return roundCurrency(cashierAmount);
};

const formatNoteAmount = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const CASHIER_MISC_CATEGORIES = Object.freeze({
  foodStaff: 'ค่าอาหารรถตู้/พนักงาน (รายการที่ไม่ตรงหมวดอื่น)',
  houseJum: 'บ้านพี่จุ๋ม',
  housePen: 'บ้านพี่เพ็ญ',
  grandma: 'บ้านคุณย่า',
  creditJumPen: 'เครดิตพี่จุ๋ม/พี่เพ็ญ',
  member: 'สมาชิก / แลกแต้ม / รีวิว'
});

const cashierMiscCategory = (label) => {
  const normalized = String(label || '').toLowerCase().replace(/\s+/g, '');
  const isJum = /(?:พี่|เจ๊)?จุ๋ม/.test(normalized);
  const isPen = /(?:พี่)?เพ็ญ/.test(normalized);

  if (normalized.includes('เครดิต') && (isJum || isPen)) return 'creditJumPen';
  if (isJum && (normalized.includes('บ้าน') || normalized.includes('ลงบิล'))) return 'houseJum';
  if (isPen && (normalized.includes('บ้าน') || normalized.includes('ลงบิล'))) return 'housePen';
  if (normalized.includes('คุณย่า') || normalized.includes('บ้านย่า')) return 'grandma';
  if (/(สมาชิก|แลกแต้ม|รีวิว)/.test(normalized)) return 'member';
  return 'foodStaff';
};

const cashierMiscCategoryResult = (items, emptyAmount) => Object.fromEntries(
  Object.entries(CASHIER_MISC_CATEGORIES).map(([key, title]) => {
    const categoryItems = items.filter((item) => cashierMiscCategory(item.label) === key);
    return [key, {
      amount: categoryItems.length === 0
        ? emptyAmount
        : roundCurrency(categoryItems.reduce((sum, item) => sum + item.amount, 0)),
      note: categoryItems.length === 0
        ? ''
        : [title, ...categoryItems.map((item) => `- ${item.label}: ${formatNoteAmount(item.amount)}`)].join('\n')
    }];
  })
);

export const cashierMiscForSheets = ({ items, status } = {}) => {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label || '').trim(),
      amount: Number(item?.amount)
    }))
    .filter((item) => item.label && Number.isFinite(item.amount));

  if (normalizedItems.length === 0) {
    const emptyAmount = CASHIER_SUBMITTED_STATUSES.has(String(status || '').trim()) ? 0 : '';
    return {
      amount: emptyAmount,
      note: '',
      categories: cashierMiscCategoryResult([], emptyAmount)
    };
  }

  return {
    amount: roundCurrency(normalizedItems.reduce((sum, item) => sum + item.amount, 0)),
    note: [
      'รายการอื่น ๆ ที่แคชเชียร์เพิ่ม',
      ...normalizedItems.map((item) => `- ${item.label}: ${formatNoteAmount(item.amount)}`)
    ].join('\n'),
    categories: cashierMiscCategoryResult(normalizedItems, 0)
  };
};

const parseJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

export const grabAmountsForSheets = ({
  reportPayload,
  cashierAmount,
  status,
  hasBankStatement = false,
  bankStatementAmount
} = {}) => {
  const hasActualBankAmount = Boolean(hasBankStatement) && finiteNonNegative(bankStatementAmount);
  const actualBankAmount = hasActualBankAmount ? roundCurrency(bankStatementAmount) : '';
  const report = parseJsonObject(reportPayload);
  if (report) {
    const gross = Number(report.gross_amount);
    const sales = Number(report.cashier_amount);
    const net = Number(report.net_amount);
    const validZeroReport = gross === 0 && sales === 0 && net === 0;
    const validPositiveReport = gross > 0 && sales > 0 && net > 0;
    const components = [
      report.commission_and_tax_amount || 0,
      report.additional_commission_amount || 0,
      report.marketing_fee_amount || 0,
      report.merchant_delivery_discount_amount || 0,
      report.income_adjustment_amount || 0
    ];
    if (
      (validZeroReport || validPositiveReport) &&
      finiteNonNegative(gross) && finiteNonNegative(sales) && finiteNonNegative(net) &&
      components.every((value) => Number.isFinite(Number(value)))
    ) {
      return {
        source: hasActualBankAmount ? 'BANK_STATEMENT' : 'GRAB_REPORT',
        salesAmount: roundCurrency(sales),
        fee20Amount: roundCurrency(
          Number(report.commission_and_tax_amount || 0) +
          Number(report.additional_commission_amount || 0)
        ),
        adsPromotionAmount: roundCurrency(
          Number(report.marketing_fee_amount || 0) +
          Number(report.merchant_delivery_discount_amount || 0)
        ),
        // The shared Kanklong Kasikorn statement is the final authority for
        // money received from both Grab stores. The Grab report remains the
        // source for sales, fees, and promotions.
        bankAmount: hasActualBankAmount ? actualBankAmount : roundCurrency(net)
      };
    }
  }

  if (CASHIER_SUBMITTED_STATUSES.has(String(status || '').trim())) {
    return {
      source: hasActualBankAmount ? 'BANK_STATEMENT' : 'CASHIER',
      salesAmount: roundCurrency(cashierAmount),
      fee20Amount: '',
      adsPromotionAmount: '',
      bankAmount: actualBankAmount
    };
  }
  if (hasActualBankAmount) {
    return {
      source: 'BANK_STATEMENT',
      salesAmount: '',
      fee20Amount: '',
      adsPromotionAmount: '',
      bankAmount: actualBankAmount
    };
  }
  return {
    source: '',
    salesAmount: '',
    fee20Amount: '',
    adsPromotionAmount: '',
    bankAmount: ''
  };
};

export const parseMonthRange = (value) => {
  const normalized = String(value || '').trim();
  const match = normalized.match(MONTH_PATTERN);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12) {
    const error = new Error('month must be YYYY-MM.');
    error.statusCode = 400;
    throw error;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    month: normalized,
    from: `${normalized}-01`,
    to: `${normalized}-${String(lastDay).padStart(2, '0')}`,
    days: Array.from({ length: lastDay }, (_, index) =>
      `${normalized}-${String(index + 1).padStart(2, '0')}`
    )
  };
};

const parseIsoDateUtc = (value, field) => {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const error = new Error(`${field} must be YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    const error = new Error(`${field} must be a valid date.`);
    error.statusCode = 400;
    throw error;
  }
  return { normalized, date };
};

export const buildDateRange = (fromValue, toValue, maxDays = 366) => {
  const from = parseIsoDateUtc(fromValue, 'from');
  const to = parseIsoDateUtc(toValue, 'to');
  if (from.date > to.date) {
    const error = new Error('from must be on or before to.');
    error.statusCode = 400;
    throw error;
  }

  const dates = [];
  for (let cursor = from.date; cursor <= to.date; cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > maxDays) {
      const error = new Error(`Date range cannot exceed ${maxDays} days.`);
      error.statusCode = 400;
      throw error;
    }
  }
  return dates;
};

export const decideBackfillAction = (status) => {
  const normalized = String(status || '').trim();
  if (!normalized) return 'create';
  if (normalized === 'DRAFT' || normalized === 'NEEDS_CORRECTION') return 'update';
  if (normalized === 'CLOSED') return 'skip_closed';
  return 'skip_status';
};
