import crypto from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import readXlsxFile from 'read-excel-file/node';
import { roundMoney } from './money.js';

const CREDIT_AMOUNT_KEYS = ['credit', 'deposit', 'paid', 'เงินเข้า', 'ยอดฝาก', 'ฝาก'];
const GENERIC_AMOUNT_KEYS = ['amount', 'ยอดเงิน', 'จำนวนเงิน'];
const DATE_KEYS = ['date', 'transaction_date', 'datetime', 'วันที่', 'วันเวลา'];
const DESCRIPTION_KEYS = ['description', 'memo', 'detail', 'details', 'payment card type', 'qr type', 'payment channel', 'transaction', 'รายการ', 'คำอธิบาย'];
const REFERENCE_KEYS = ['reference', 'ref', 'transaction_id', 'เลขที่อ้างอิง', 'อ้างอิง'];
const CHANNEL_KEYS = ['channel', 'ช่องทาง'];
const ACCOUNT_KEYS = ['account', 'promptpay', 'biller', 'บัญชี', 'พร้อมเพย์'];

const HEADER_KEYS = [
  ...CREDIT_AMOUNT_KEYS,
  ...GENERIC_AMOUNT_KEYS,
  ...DATE_KEYS,
  ...DESCRIPTION_KEYS,
  ...REFERENCE_KEYS,
  ...CHANNEL_KEYS,
  ...ACCOUNT_KEYS
];

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const csvDelimiter = (buffer) => {
  const firstLine = buffer.toString('utf8').split(/\r?\n/, 1)[0] || '';
  return firstLine.split('|').length > firstLine.split(',').length ? '|' : ',';
};

const findValue = (row, candidates) => {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const normalized = normalizeHeader(candidate);
    const found = entries.find(([key]) => normalizeHeader(key) === normalized);
    if (found) return found[1];
  }
  for (const candidate of candidates) {
    const normalized = normalizeHeader(candidate);
    const found = entries.find(([key]) => normalizeHeader(key).includes(normalized));
    if (found) return found[1];
  }
  return '';
};

const hasValue = (value) => String(value ?? '').trim() !== '';

const parseAmount = (value) => {
  const text = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  return roundMoney(Number(text || 0));
};

const parseIncomingAmount = (row) => {
  const creditValue = findValue(row, CREDIT_AMOUNT_KEYS);
  if (hasValue(creditValue)) return parseAmount(creditValue);

  const genericValue = findValue(row, GENERIC_AMOUNT_KEYS);
  if (hasValue(genericValue)) return parseAmount(genericValue);

  return 0;
};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const ymd = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }
  const dmy = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const shortDmy = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2})(?:\D|$)/);
  if (shortDmy) {
    return `20${shortDmy[3]}-${shortDmy[2].padStart(2, '0')}-${shortDmy[1].padStart(2, '0')}`;
  }
  return raw.slice(0, 10) || null;
};

const headerScore = (row) =>
  row.reduce((score, cell) => {
    const normalizedCell = normalizeHeader(cell);
    const matched = HEADER_KEYS.some((key) => {
      const normalizedKey = normalizeHeader(key);
      return normalizedCell === normalizedKey || normalizedCell.includes(normalizedKey);
    });
    return matched ? score + 1 : score;
  }, 0);

const rowsToObjects = (rows) => {
  const bestHeader = rows.reduce((best, row, index) => {
    const score = headerScore(row);
    return score > best.score ? { index, score } : best;
  }, { index: -1, score: 0 });
  const headerIndex = bestHeader.score >= 2 ? bestHeader.index : -1;
  if (headerIndex === -1) return [];

  const headers = rows[headerIndex] || [];
  const body = rows.slice(headerIndex + 1);
  return body.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || `column_${index + 1}`)] = row[index] ?? '';
    });
    return record;
  });
};

const extractStatementMetadata = (rows) => {
  const accountNumber = rows
    .map((row) => row.map((cell) => String(cell || '').trim()))
    .find((row) => row.some((cell) => /เลขที่บัญชีเงินฝาก|account\s*(?:number|no\.?)/i.test(cell)))
    ?.map((cell) => cell.match(/\b\d{3}-\d-\d{5}-\d\b/)?.[0] || '')
    .find(Boolean);

  return {
    accountNumber: String(accountNumber || '').replace(/\D/g, '')
  };
};

const parseThaiStatementDate = (value) => {
  const match = String(value || '').match(/(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `20${match[3]}-${match[2]}-${match[1]}`;
};

export const kasikornPdfIncomingAmount = (text) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const thaiQrAmount = normalized.match(
    /Thai\s+QR\s+Payment\s+(\d{1,3}(?:,\d{3})*\.\d{2})/i
  );
  if (thaiQrAmount) return parseAmount(thaiQrAmount[1]);

  // Kasikorn's PDF text layer may place "WeChat" after the amount even
  // though the rendered statement reads "Alipay/WeChat". Capture the first
  // amount after Alipay/ so the following account balance is never mistaken
  // for the deposit amount.
  const alipayWeChatAmount = normalized.match(
    /Alipay\s*\/(?:\s*WeChat)?\s+(\d{1,3}(?:,\d{3})*\.\d{2})/i
  );
  if (alipayWeChatAmount) return parseAmount(alipayWeChatAmount[1]);

  // At a page boundary pdf-parse can append the next page's carried balance
  // before the deposit value. The rendered KBank row still places the actual
  // incoming amount immediately after "รับโอนเงิน".
  const incomingTransferAmount = normalized.match(
    /รับโอนเงิน\s+(\d{1,3}(?:,\d{3})*\.\d{2})/
  );
  if (incomingTransferAmount) return parseAmount(incomingTransferAmount[1]);

  // KBank card settlements use the same "รับเงินจากการขาย" wording as
  // merchant QR, but the rendered row identifies them as full payment /
  // instalment / reward-point sales. Capture the amount after that phrase so
  // a carried balance injected at a PDF page boundary is never selected.
  const cardSettlementAmount = normalized.match(
    /รับเงินจากการขาย\s+เต็มจำนวน\s*\/\s*ผ่อนชำระ\s*\/\s*คะแนนสะสม\s+(\d{1,3}(?:,\d{3})*\.\d{2})/
  );
  if (cardSettlementAmount) return parseAmount(cardSettlementAmount[1]);

  const amounts = [...normalized.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g)]
    .map((match) => match[0]);
  return amounts.length >= 2 ? parseAmount(amounts[amounts.length - 1]) : 0;
};

const parseKasikornPdfRows = async (buffer, password = '') => {
  const parser = new PDFParse({ data: buffer, password: password || undefined });
  const result = await parser.getText();
  await parser.destroy();

  const accountMatch = result.text.match(/\b\d{3}-\d-\d{5}-\d\b/);
  const chunks = result.text
    .replace(/\r/g, '\n')
    .split(/(?=\b\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}\b)/g);

  return chunks
    .map((chunk, index) => {
      const dateTime = chunk.match(/\b(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\b/);
      if (!dateTime) return null;
      const text = chunk.replace(/\s+/g, ' ').trim();
      if (!/(รับเงินจากการขาย|รับโอนเงิน)/.test(text)) return null;
      const amount = kasikornPdfIncomingAmount(text);
      if (amount <= 0) return null;

      return {
        'วันที่': parseThaiStatementDate(dateTime[1]),
        'เวลา': dateTime[2],
        'รายการ': text,
        'ช่องทาง': text.includes('EDC/K SHOP/MYQR')
          ? 'EDC/K SHOP/MYQR'
          : /Alipay|WeChat/i.test(text)
            ? 'ALIPAY_WECHAT'
          : text.includes('แกร็บ') || text.toUpperCase().includes('GRAB')
            ? 'GRAB'
            : '',
        'เลขที่อ้างอิง': accountMatch?.[0] || `pdf-row-${index + 1}`,
        'ยอดฝาก': amount
      };
    })
    .filter(Boolean);
};

const parseScbHistoricalPdfRows = async (buffer, password = '') => {
  const parser = new PDFParse({ data: buffer, password: password || undefined });
  const result = await parser.getText();
  await parser.destroy();
  return String(result.text || '').split(/\r?\n/)
    .map((line, index) => {
      const match = line.trim().match(/^([A-Z0-9]+)\s+([A-Z]+)\s+([\d,]+\.\d{2})\s+[\d,]+\.\d{2}\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+(.+)$/);
      if (!match) return null;
      const [, code, channel, credit, rawDate, time, description] = match;
      const [day, month, year] = rawDate.split('/');
      return {
        'วันที่': `${year}-${month}-${day}`,
        'เวลา': time,
        'รายการ': `${description.trim()} | ${channel}`,
        'ช่องทาง': channel,
        'เลขที่อ้างอิง': `${code}-${index + 1}`,
        'ยอดฝาก': credit
      };
    })
    .filter(Boolean);
};

export const parseScbMonthlyCardPdf = async ({ buffer, password = '' }) => {
  const parser = new PDFParse({ data: buffer, password: password || undefined });
  const result = await parser.getText();
  await parser.destroy();
  const text = String(result.text || '');
  const accountNumber = String(text.match(/\b(\d{3}-\d{6}-\d)\b/)?.[1] || '').replace(/\D/g, '');
  // SCB's PDF text layer places End before Start even though the rendered
  // header shows Start on the left and End on the right.
  const rangeMatch = text.match(/วันที่:\s*(\d{2}\/\d{2}\/\d{4})\s*Date\s*(\d{2}\/\d{2}\/\d{4})/i);
  const normalizeDate = (value) => {
    const [day, month, year] = String(value || '').split('/');
    return day && month && year ? `${year}-${month}-${day}` : '';
  };
  const rows = (await parseScbHistoricalPdfRows(buffer, password))
    .filter((row) => /CREDIT CARD DIVISION|\bEDC\b/i.test(String(row['รายการ'] || '')))
    .map((row, index) => {
      const transactionDate = String(row['วันที่'] || '');
      const description = String(row['รายการ'] || '').trim();
      const amount = parseAmount(row['ยอดฝาก']);
      return {
        transactionDate,
        description,
        referenceNo: `SCB-EDC-${transactionDate}-${index + 1}`,
        amount,
        uniqueHash: crypto.createHash('sha256')
          .update(`${accountNumber}|${transactionDate}|${amount}|${description}`)
          .digest('hex'),
        rawPayload: row
      };
    })
    .filter((row) => row.transactionDate && row.amount > 0);

  return {
    accountNumber,
    from: normalizeDate(rangeMatch?.[2]),
    to: normalizeDate(rangeMatch?.[1]),
    rows
  };
};

export const parseKrungthaiHistoricalTextRows = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line, index) => {
    const normalized = line.replace(/\s+/g, ' ').trim();
    const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})\s+(.+)$/);
    if (!match || !/\b(?:single\s+credit|credit\s+to)\b/i.test(normalized)) return null;
    const [, day, month, year, time, description] = match;
    const amounts = [...description.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g)].map((item) => item[0]);
    if (amounts.length === 0) return null;
    const creditAmount = amounts[amounts.length - 1];
    if (parseAmount(creditAmount) <= 0) return null;
    return {
      'Krungthai Transaction Date': `${year}-${month}-${day}`,
      'Time': time,
      'Description': description,
      'Reference No.': `krungthai-credit-${year}${month}${day}-${time.replace(':', '')}-${index + 1}`,
      'Krungthai Credit Amount': creditAmount,
      'Channel': 'Krungthai Business'
    };
  })
  .filter(Boolean);

const parseKrungthaiHistoricalPdfRows = async (buffer, password = '') => {
  const parser = new PDFParse({ data: buffer, password: password || undefined });
  const result = await parser.getText();
  await parser.destroy();
  return parseKrungthaiHistoricalTextRows(result.text);
};

export const detectStatementProfile = (rows) => {
  const headers = Object.keys(rows?.[0] || {}).map(normalizeHeader);
  const has = (text) => headers.some((header) => header === text || header.includes(text));
  if (has('krungthai_transaction_date') && has('krungthai_credit_amount')) {
    return { code: 'KRUNGTHAI_BUSINESS_HISTORICAL', label: 'Krungthai Business Historical Statement' };
  }
  if (has('deposit') && has('withdrawal') && has('transaction') && has('channel')) {
    return { code: 'KASIKORN_RECENT_TRANSACTION', label: 'KBank Recent Transaction CSV' };
  }
  if (has('ฝากเงิน') && has('ถอนเงิน') && has('รายการ') && has('ช่องทาง')) {
    return { code: 'KASIKORN_DEPOSIT_STATEMENT', label: 'KBank Deposit Statement CSV' };
  }
  if (has('merchant_id') && has('transaction_amount') && has('transaction_paid_time')) {
    return { code: 'KRUNGSRI_BIZ_MUNG_MEE', label: 'Krungsri Biz Mung-Mee report' };
  }
  if (has('account_number') && has('tr_code') && has('deposit') && has('channel')) {
    return { code: 'SCB_HISTORICAL_STATEMENT', label: 'SCB Historical Statement CSV' };
  }
  if ((has('credit') || has('incoming')) && (has('transaction_date') || has('date'))) {
    return { code: 'SCB_INCOMING_REPORT', label: 'SCB Incoming Transaction Report' };
  }
  return { code: 'GENERIC_STATEMENT', label: 'Generic statement' };
};

export const parseStatementFile = async ({ buffer, originalName, mimeType, password = '' }) => {
  const lowerName = String(originalName || '').toLowerCase();
  let rows;
  let metadata = {};

  if (lowerName.endsWith('.pdf') || mimeType?.includes('pdf')) {
    rows = await parseKasikornPdfRows(buffer, password);
    if (rows.length === 0) rows = await parseScbHistoricalPdfRows(buffer, password);
    if (rows.length === 0) rows = await parseKrungthaiHistoricalPdfRows(buffer, password);
  } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || mimeType?.includes('spreadsheet')) {
    rows = rowsToObjects(await readXlsxFile(buffer));
  } else {
    const rawRows = parseCsv(buffer.toString('utf8'), {
      delimiter: csvDelimiter(buffer),
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: true
    });
    metadata = extractStatementMetadata(rawRows);
    rows = rowsToObjects(rawRows);
  }

  const profile = detectStatementProfile(rows);
  return {
    profile,
    metadata,
    rows: rows
    .map((row, index) => {
      const isKrungsriMungMee = profile.code === 'KRUNGSRI_BIZ_MUNG_MEE';
      const amount = isKrungsriMungMee
        ? parseAmount(findValue(row, ['transaction amount']))
        : parseIncomingAmount(row);
      const transactionText = String(findValue(row,
        isKrungsriMungMee ? ['payment card type', 'qr type', 'payment channel'] : DESCRIPTION_KEYS
      ) || '').trim();
      const detailText = String(findValue(row, ['รายละเอียด', 'details', 'detail']) || '').trim();
      const channelText = String(findValue(row, CHANNEL_KEYS) || '').trim();
      const accountText = String(findValue(row, ACCOUNT_KEYS) || '').trim();
      const description = [...new Set([transactionText, detailText, channelText].filter(Boolean))].join(' | ');
      const referenceNo = String(findValue(row,
        isKrungsriMungMee ? ['transaction id'] : REFERENCE_KEYS
      ) || accountText || '').trim();
      const rawDate = isKrungsriMungMee ? findValue(row, ['transaction paid time']) : findValue(row, DATE_KEYS);
      const transactionDate = parseDate(rawDate);
      const uniqueHash = crypto
        .createHash('sha256')
        .update(`${String(rawDate || '').trim()}|${amount}|${description}|${referenceNo}`)
        .digest('hex');

      return {
        rowIndex: index + 1,
        transactionDate,
        description,
        referenceNo,
        amount,
        uniqueHash,
        rawPayload: row
      };
    })
    .filter((row) => row.amount > 0)
  };
};

export const parseStatementBuffer = async (input) => (await parseStatementFile(input)).rows;
