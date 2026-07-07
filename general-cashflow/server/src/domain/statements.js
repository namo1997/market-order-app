import crypto from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { roundMoney } from './money.js';

const AMOUNT_KEYS = ['amount', 'credit', 'deposit', 'paid', 'ยอดเงิน', 'เงินเข้า', 'จำนวนเงิน'];
const DATE_KEYS = ['date', 'transaction_date', 'datetime', 'วันที่', 'วันเวลา'];
const DESCRIPTION_KEYS = ['description', 'memo', 'detail', 'details', 'รายการ', 'คำอธิบาย'];
const REFERENCE_KEYS = ['reference', 'ref', 'transaction_id', 'เลขที่อ้างอิง', 'อ้างอิง'];

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const findValue = (row, candidates) => {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const normalized = normalizeHeader(candidate);
    const found = entries.find(([key]) => normalizeHeader(key) === normalized || normalizeHeader(key).includes(normalized));
    if (found) return found[1];
  }
  return '';
};

const parseAmount = (value) => {
  const text = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  return roundMoney(Number(text || 0));
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
  return raw.slice(0, 10) || null;
};

const rowsToObjects = (rows) => {
  const [headers = [], ...body] = rows;
  return body.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || `column_${index + 1}`)] = row[index] ?? '';
    });
    return record;
  });
};

export const parseStatementBuffer = async ({ buffer, originalName, mimeType }) => {
  const lowerName = String(originalName || '').toLowerCase();
  let rows;

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || mimeType?.includes('spreadsheet')) {
    rows = rowsToObjects(await readXlsxFile(buffer));
  } else {
    rows = parseCsv(buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true
    });
  }

  return rows
    .map((row, index) => {
      const amount = parseAmount(findValue(row, AMOUNT_KEYS));
      const description = String(findValue(row, DESCRIPTION_KEYS) || '').trim();
      const referenceNo = String(findValue(row, REFERENCE_KEYS) || '').trim();
      const transactionDate = parseDate(findValue(row, DATE_KEYS));
      const uniqueHash = crypto
        .createHash('sha256')
        .update(`${transactionDate || ''}|${amount}|${description}|${referenceNo}`)
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
    .filter((row) => row.amount !== 0 || row.description || row.referenceNo);
};
