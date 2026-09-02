import { parse as parseCsv } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { roundMoney } from './money.js';

const MONTHS = new Map([
  ['Jan', '01'], ['Feb', '02'], ['Mar', '03'], ['Apr', '04'],
  ['May', '05'], ['Jun', '06'], ['Jul', '07'], ['Aug', '08'],
  ['Sep', '09'], ['Oct', '10'], ['Nov', '11'], ['Dec', '12']
]);

const parseGrabDate = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})/);
  if (!match || !MONTHS.has(match[2])) return null;
  return `${match[3]}-${MONTHS.get(match[2])}-${match[1].padStart(2, '0')}`;
};

const amount = (value) => roundMoney(Number(String(value ?? '').replace(/,/g, '')) || 0);

export const parseGrabTransactionReport = (buffer) => {
  const rows = parseCsv(buffer.toString('utf8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true
  });
  const groups = new Map();

  for (const row of rows) {
    const storeId = String(row['รหัสร้านค้า'] || '').trim();
    const storeName = String(row['ชื่อร้าน'] || '').trim();
    const salesDate = parseGrabDate(row['วันที่สร้าง']);
    const transferDate = parseGrabDate(row['วันที่โอน']);
    const netAmount = amount(row['ทั้งหมด']);
    if (!storeId || !salesDate || !transferDate || !Number.isFinite(netAmount)) continue;

    const key = `${storeId}|${salesDate}|${transferDate}`;
    const group = groups.get(key) || {
      storeId,
      storeName,
      merchantId: String(row['Merchant ID'] || '').trim(),
      salesDate,
      transferDate,
      transactionCount: 0,
      grossAmount: 0,
      netAmount: 0
    };
    group.transactionCount += 1;
    group.grossAmount = roundMoney(group.grossAmount + amount(row['ยอด']));
    group.netAmount = roundMoney(group.netAmount + netAmount);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    feeAmount: roundMoney(group.grossAmount - group.netAmount)
  }));
};

export const findGrabSettlement = ({ groups, storeId, receiptDate }) => {
  const matches = groups.filter((group) => group.storeId === storeId && group.salesDate === receiptDate);
  return matches.length === 1 ? matches[0] : null;
};

const previousDate = (value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const statementTime = (row) => String(row?.rawPayload?.['เวลา'] || row?.time || '99:99');

const positiveMoney = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

// KBank posts both Grab stores to the shared Kanklong account on the day after
// sale. Infer the store order only after at least three two-store dates agree
// with exact Grab-report net amounts. This makes the fallback auditable instead
// of assuming that an early/late transfer always belongs to a particular store.
export const assignKasikornGrabStatementRows = ({ rows, evidenceByDate, month, branchOrder = ['KK', 'SK'] } = {}) => {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.transactionDate) continue;
    const items = groups.get(row.transactionDate) || [];
    items.push(row);
    groups.set(row.transactionDate, items);
  }
  for (const items of groups.values()) {
    items.sort((left, right) => statementTime(left).localeCompare(statementTime(right)));
  }

  const evidenceFor = (date) => {
    const value = evidenceByDate instanceof Map ? evidenceByDate.get(date) : evidenceByDate?.[date];
    return Array.isArray(value) ? value : [];
  };
  const sequenceVotes = new Map();
  for (const [settlementDate, items] of groups) {
    if (items.length !== branchOrder.length) continue;
    const evidence = evidenceFor(previousDate(settlementDate));
    const matchedSequence = items.map((row) => {
      const matches = evidence.filter((item) =>
        positiveMoney(item.reportNetAmount) && roundMoney(item.reportNetAmount) === roundMoney(row.amount));
      return matches.length === 1 ? matches[0].branchCode : null;
    });
    if (matchedSequence.some((value) => !value) || new Set(matchedSequence).size !== branchOrder.length) continue;
    const key = matchedSequence.join('|');
    sequenceVotes.set(key, (sequenceVotes.get(key) || 0) + 1);
  }
  const rankedSequences = [...sequenceVotes.entries()].sort((left, right) => right[1] - left[1]);
  const verifiedSequence = rankedSequences[0]?.[1] >= 3 && rankedSequences[0]?.[1] > (rankedSequences[1]?.[1] || 0)
    ? rankedSequences[0][0].split('|')
    : null;
  const sequenceSupport = verifiedSequence ? rankedSequences[0][1] : 0;

  const assignments = [];
  const pending = [];
  for (const [settlementDate, items] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const saleDate = previousDate(settlementDate);
    if (!String(saleDate).startsWith(`${month}-`)) {
      items.forEach((row) => pending.push({ row, saleDate, settlementDate, reason: 'SALE_DATE_OUTSIDE_MONTH' }));
      continue;
    }

    const evidence = evidenceFor(saleDate);
    const evidenceByBranch = new Map(evidence.map((item) => [item.branchCode, item]));
    const unassignedRows = new Set(items);
    const unassignedBranches = new Set(branchOrder.filter((code) => evidenceByBranch.has(code)));
    const assign = (row, branchCode, reason) => {
      const branchEvidence = evidenceByBranch.get(branchCode);
      assignments.push({ row, saleDate, settlementDate, branchCode, reason, evidence: branchEvidence });
      unassignedRows.delete(row);
      unassignedBranches.delete(branchCode);
    };

    // Exact statement amount to Grab-report net is the strongest branch proof.
    for (const branchCode of [...unassignedBranches]) {
      const branchEvidence = evidenceByBranch.get(branchCode);
      if (!positiveMoney(branchEvidence?.reportNetAmount)) continue;
      const rowMatches = [...unassignedRows].filter((row) =>
        roundMoney(row.amount) === roundMoney(branchEvidence.reportNetAmount));
      const competingBranches = [...unassignedBranches].filter((otherCode) =>
        otherCode !== branchCode &&
        positiveMoney(evidenceByBranch.get(otherCode)?.reportNetAmount) &&
        roundMoney(evidenceByBranch.get(otherCode).reportNetAmount) === roundMoney(branchEvidence.reportNetAmount));
      if (rowMatches.length === 1 && competingBranches.length === 0) {
        assign(rowMatches[0], branchCode, 'EXACT_GRAB_REPORT_NET');
      }
    }

    if (unassignedRows.size === 1 && unassignedBranches.size === 1) {
      assign([...unassignedRows][0], [...unassignedBranches][0], 'REMAINING_BRANCH_AFTER_EXACT_MATCH');
    } else if (unassignedRows.size === 1 && unassignedBranches.size > 1) {
      const activeBranches = [...unassignedBranches].filter((code) => evidenceByBranch.get(code)?.hasSalesActivity);
      if (activeBranches.length === 1) {
        assign([...unassignedRows][0], activeBranches[0], 'ONLY_ACTIVE_BRANCH');
      }
    } else if (verifiedSequence && unassignedRows.size === unassignedBranches.size && unassignedRows.size > 0) {
      const remainingRows = [...unassignedRows].sort((left, right) => statementTime(left).localeCompare(statementTime(right)));
      const remainingSequence = verifiedSequence.filter((code) => unassignedBranches.has(code));
      if (remainingRows.length === remainingSequence.length) {
        remainingRows.forEach((row, index) => assign(row, remainingSequence[index], 'VERIFIED_SETTLEMENT_ORDER'));
      }
    }

    for (const row of unassignedRows) {
      pending.push({ row, saleDate, settlementDate, reason: 'BRANCH_NOT_PROVEN' });
    }
    // A dated full statement plus another branch's deposit proves zero only
    // when the missing branch also has no sales activity for that sale date.
    if (items.length > 0) {
      for (const branchCode of unassignedBranches) {
        const branchEvidence = evidenceByBranch.get(branchCode);
        if (branchEvidence && !branchEvidence.hasSalesActivity) {
          assignments.push({
            row: null,
            amount: 0,
            saleDate,
            settlementDate,
            branchCode,
            reason: 'NO_DEPOSIT_AND_ZERO_SALES',
            evidence: branchEvidence
          });
        }
      }
    }
  }

  return { assignments, pending, verifiedSequence, sequenceSupport };
};

const moneyFromText = (text, labels) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}[\\s:]*?(?:THB\\s*)?([\\d,]+\\.\\d{2})`, 'i'));
    if (match) return amount(match[1]);
  }
  return null;
};

const grabSummaryFromText = (text) => {
  const summaryMatch = text.match(/ยอดรายการ\s+VAT[\s\S]{0,700}?(?=คําสั่งซื้อจาก|คำสั่งซื้อจาก)/i);
  if (!summaryMatch) return null;

  const block = summaryMatch[0];
  const firstAmountIndex = block.search(/-?[\d,]+\.\d{2}/);
  if (firstAmountIndex < 0) return null;

  const header = block.slice(0, firstAmountIndex);
  const values = (block.slice(firstAmountIndex).match(/-?[\d,]+\.\d{2}/g) || []).map(amount);
  const columns = [
    ['grossAmount', /ยอดรายการ/i],
    ['vatAmount', /VAT/i],
    ['merchantServiceAmount', /บริการของร.{0,3}าน/i],
    ['merchantPromotionSignedAmount', /โปรโมชันร.{0,3}าน/i],
    ['commissionAndTaxSignedAmount', /คอมมิชชันและภาษีทั้งหมด/i],
    ['additionalCommissionSignedAmount', /คอมมิชชันเพิ่มเติม/i],
    ['marketingFeeSignedAmount', /ธรรมเนียมการตลาด/i],
    ['merchantDeliveryDiscountSignedAmount', /วนลดค.{0,3}าจัดส.{0,3}งโดยร.{0,3}าน/i],
    ['incomeAdjustmentAmount', /การปรับรายได/i],
    ['netAmount', /รายรับท.{0,4}งหมด/i],
    ['outstandingAmount', /างช.{0,3}าระ\s+Grab/i]
  ].filter(([, pattern]) => pattern.test(header));

  if (values.length < columns.length) return null;
  return Object.fromEntries(columns.map(([key], index) => [key, values[index]]));
};

const grabStoreFromText = (text) => {
  if (/ส.{0,12}Hello solao|ฮัลโหล.{0,12}โซลาว/i.test(text)) return 'c30f837b-0067-41ce-9d19-767cca330e94';
  if (/โซลาวบ.{0,12}เจ.{0,4}|บ้านเจ/i.test(text)) return 'ff32e3d6-5cea-4517-b543-4d7db1e528c6';
  return null;
};

export const parseGrabDailyReportText = (sourceText, originalName = '') => {
  const text = String(sourceText || '').replace(/\s+/g, ' ').trim();
  const dateMatch = `${originalName} ${text}`.match(/(20\d{2})(\d{2})(\d{2})/);
  const salesDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  const reportName = String(originalName || '').toUpperCase();
  const storeId = reportName.startsWith('THGFIST000009LX')
    ? 'c30f837b-0067-41ce-9d19-767cca330e94'
    : reportName.startsWith('3-C6CELAM2TCAUVX')
      ? 'ff32e3d6-5cea-4517-b543-4d7db1e528c6'
      : grabStoreFromText(text);
  const summary = grabSummaryFromText(text);
  const salesTable = text.match(/ยอดรายการ\s+VAT[\s\S]{0,280}?([\d,]+\.\d{2})/i);
  const grossAmount = summary?.grossAmount ?? (salesTable
    ? amount(salesTable[1])
    : moneyFromText(text, ['ยอดขายทั้งหมด', 'ยอดขายรวม', 'ยอดขายขั้นต้น', 'Gross Sales', 'Gross sales']));
  const merchantPromotionAmount = Math.abs(Number(summary?.merchantPromotionSignedAmount || 0));
  const vatAmount = Number(summary?.vatAmount || 0);
  const merchantServiceAmount = Number(summary?.merchantServiceAmount || 0);
  const cashierAmount = grossAmount === null
    ? null
    : roundMoney(grossAmount + vatAmount + merchantServiceAmount - merchantPromotionAmount);
  const summaryNet = text.match(/รายรับท.{0,12}หมด[\s\S]{0,160}?THB\s*([\d,]+\.\d{2})/i);
  const netAmount = summary?.netAmount ?? (summaryNet
    ? amount(summaryNet[1])
    : moneyFromText(text, ['รายรับท.{0,12}หมด', 'Total income', 'Total Income', 'ยอดรับสุทธิ', 'ยอดสุทธิ']));
  if (!salesDate || grossAmount === null || netAmount === null) {
    const error = new Error('อ่านรายงาน Grab ไม่ครบ: ต้องพบวันที่ขาย ยอดขาย และยอดสุทธิ');
    error.statusCode = 422;
    throw error;
  }
  return {
    storeId,
    salesDate,
    grossAmount,
    vatAmount,
    merchantServiceAmount,
    merchantPromotionAmount,
    cashierAmount,
    netAmount,
    commissionAndTaxAmount: Math.abs(Number(summary?.commissionAndTaxSignedAmount || 0)),
    additionalCommissionAmount: Math.abs(Number(summary?.additionalCommissionSignedAmount || 0)),
    marketingFeeAmount: Math.abs(Number(summary?.marketingFeeSignedAmount || 0)),
    merchantDeliveryDiscountAmount: Math.abs(Number(summary?.merchantDeliveryDiscountSignedAmount || 0)),
    incomeAdjustmentAmount: Number(summary?.incomeAdjustmentAmount || 0),
    outstandingAmount: Number(summary?.outstandingAmount || 0),
    feeAmount: roundMoney(cashierAmount - netAmount),
    text
  };
};

export const parseGrabDailyReport = async (buffer, originalName = '') => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return parseGrabDailyReportText(result.text, originalName);
};
