// จัดลำดับและเรียบเรียง "งานค้างเมื่อวาน" ให้ผู้ตรวจสอบอ่านตอนเช้า
//
// ไฟล์นี้ตั้งใจให้บริสุทธิ์: ไม่แตะ DB ไม่แตะ network รับ facts ที่ดึงมาแล้ว
// แล้วคืนลำดับความสำคัญกับข้อความ เพื่อให้เทสต์ได้โดยไม่ต้องมีฐานข้อมูลจริง
//
// สำคัญ: ทุกอย่างในไฟล์นี้ต้องทำงานได้แม้ปิด AI ข้อความ fallback ที่ได้ต้องใช้งานได้จริง
// ไม่ใช่ข้อความ error — ผู้ตรวจสอบต้องได้สรุปตอนเช้าเสมอ ไม่ว่า OpenAI จะล่มหรือไม่

import { roundMoney } from './money.js';
import { CASHIER_VARIANCE_CONFIRM_THRESHOLD } from './receipts.js';

export const SEVERITY_ORDER = ['critical', 'warning', 'info'];

const severityRank = (severity) => {
  const index = SEVERITY_ORDER.indexOf(String(severity));
  return index === -1 ? SEVERITY_ORDER.length : index;
};

export const formatThb = (value) => {
  const amount = roundMoney(Number(value || 0));
  return `${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
};

export const daysBetween = (fromDate, toDate) => {
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
};

// ธนาคารตัวไหน "ปกติส่งมาทุกวัน" เดาจากประวัติจริง ไม่ hardcode ชื่อ provider
// เพราะรายชื่อ feed เปลี่ยนได้ตามที่ตั้ง Apps Script เพิ่ม
export const detectMissingFeeds = ({ history = [], targetDate, lookbackDays = 14, minDaysSeen = 7 } = {}) => {
  const seenByProvider = new Map();
  for (const row of history) {
    const provider = String(row?.provider || '').trim();
    const date = String(row?.source_date || '').slice(0, 10);
    if (!provider || !date) continue;
    if (!seenByProvider.has(provider)) seenByProvider.set(provider, new Set());
    seenByProvider.get(provider).add(date);
  }

  const missing = [];
  for (const [provider, dates] of seenByProvider) {
    // นับเฉพาะวันในช่วง lookback ที่ไม่ใช่วันเป้าหมาย เพื่อวัดว่า "ปกติมาบ่อยแค่ไหน"
    const priorDays = [...dates].filter((date) => {
      const age = daysBetween(date, targetDate);
      return age > 0 && age <= lookbackDays;
    }).length;
    if (priorDays >= minDaysSeen && !dates.has(String(targetDate).slice(0, 10))) {
      missing.push({ provider, seenDaysInLookback: priorDays, lookbackDays });
    }
  }
  return missing.sort((left, right) => right.seenDaysInLookback - left.seenDaysInLookback);
};

// แปลง facts ดิบเป็นรายการปัญหาที่จัดลำดับแล้ว
// ลำดับนี้เป็น deterministic ทั้งหมด — AI ใช้เรียบเรียงถ้อยคำ ไม่ใช่ใช้ตัดสินว่าอะไรสำคัญกว่า
export const rankFindings = (facts = {}) => {
  const findings = [];
  const today = facts.date;

  for (const receipt of facts.pendingReceipts || []) {
    const overdue = Number(receipt.daysOverdue || 0);
    findings.push({
      kind: 'pending_receipt',
      severity: overdue >= 3 ? 'critical' : 'warning',
      branchCode: receipt.branchCode,
      receiptId: receipt.receiptId,
      receiptDate: receipt.receiptDate,
      title: `${receipt.branchName} วันที่ ${receipt.receiptDate} ยังเป็น ${receipt.statusLabel}`,
      detail: overdue > 0 ? `ค้างมา ${overdue} วัน` : 'ค้างจากเมื่อวาน',
      sortKey: -overdue
    });
  }

  for (const variance of facts.cashierVariances || []) {
    const amount = roundMoney(variance.variance);
    findings.push({
      kind: 'cashier_variance',
      severity: Math.abs(amount) >= CASHIER_VARIANCE_CONFIRM_THRESHOLD * 5 ? 'critical' : 'warning',
      branchCode: variance.branchCode,
      receiptId: variance.receiptId,
      receiptDate: variance.receiptDate,
      title: `${variance.branchName} วันที่ ${variance.receiptDate} ยอดแคชเชียร์${amount < 0 ? 'ขาด' : 'เกิน'} ${formatThb(Math.abs(amount))}`,
      detail: variance.acknowledged
        ? 'แคชเชียร์ยืนยันส่งทั้งที่รู้ว่าต่าง'
        : 'ยังไม่มีการยืนยันส่วนต่าง',
      sortKey: -Math.abs(amount)
    });
  }

  for (const issue of facts.settlementIssues || []) {
    // settlement_source = 'NONE' แปลว่ายังไม่มีหลักฐานอ้างอิง ตัวเลข variance ตอนนั้น
    // เป็นแค่ 0 ลบยอดแคชเชียร์ ซึ่งไม่ได้หมายความว่าเงินหาย ห้ามรายงานเป็นจำนวนเงินเด็ดขาด
    const hasEvidence = Boolean(issue.hasEvidence);
    const isException = issue.settlementStatus === 'EXCEPTION';
    const refVariance = Number(issue.cashierRefVariance || 0);
    const netVariance = Number(issue.settlementVariance || 0);

    const detail = hasEvidence
      ? [
        Math.abs(refVariance) >= 0.01 ? `ต่างจากยอดก่อนหัก ${formatThb(refVariance)}` : '',
        Math.abs(netVariance) >= 0.01 ? `เงินเข้าต่างจากที่ควรได้ ${formatThb(netVariance)}` : '',
        issue.exceptionNote || ''
      ].filter(Boolean).join(' · ') || 'มีหลักฐานแล้วแต่ยังไม่ปิดรายการ'
      : `ยังไม่มีหลักฐานอ้างอิง ค้างมา ${issue.daysWaiting} วัน`;

    findings.push({
      kind: 'settlement',
      severity: isException ? 'warning' : 'info',
      branchCode: issue.branchCode,
      receiptId: issue.receiptId,
      receiptDate: issue.receiptDate,
      title: hasEvidence
        ? `${issue.branchName} ${issue.channelLabel} วันที่ ${issue.receiptDate} ยัง ${issue.settlementStatus}`
        : `${issue.branchName} ${issue.channelLabel} วันที่ ${issue.receiptDate} ยังไม่ได้ตรวจ`,
      detail,
      // ไม่มีหลักฐาน = เรียงตามความเก่า มีหลักฐาน = เรียงตามขนาดส่วนต่าง
      sortKey: hasEvidence ? -Math.abs(netVariance) : -Number(issue.daysWaiting || 0)
    });
  }

  for (const feed of facts.bankFeeds?.failed || []) {
    findings.push({
      kind: 'feed_failed',
      severity: 'critical',
      title: `นำเข้าไฟล์ ${feed.provider} ล้มเหลว`,
      detail: feed.errorMessage || 'ไม่ทราบสาเหตุ',
      sortKey: -1000
    });
  }

  for (const feed of facts.bankFeeds?.missing || []) {
    findings.push({
      kind: 'feed_missing',
      severity: 'warning',
      title: `ไฟล์ ${feed.provider} ของวันที่ ${today} ยังไม่เข้า`,
      detail: `ปกติเข้าทุกวัน (เห็น ${feed.seenDaysInLookback}/${feed.lookbackDays} วันที่ผ่านมา)`,
      sortKey: -feed.seenDaysInLookback
    });
  }

  const orphan = facts.orphanTransactions;
  if (orphan && Number(orphan.count || 0) > 0) {
    findings.push({
      kind: 'orphan_transactions',
      severity: 'info',
      title: `เงินเข้าที่ยังไม่มีเจ้าของ ${orphan.count} รายการ รวม ${formatThb(orphan.totalAmount)}`,
      detail: orphan.oldestDate ? `เก่าสุดคือวันที่ ${orphan.oldestDate}` : '',
      sortKey: -Number(orphan.count || 0)
    });
  }

  return findings.sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) return bySeverity;
    return Number(left.sortKey || 0) - Number(right.sortKey || 0);
  });
};

// ยุบรายการซ้ำแบบเดียวกันให้เหลือไม่กี่บรรทัด
//
// ทำไมต้องมี: ฐานข้อมูลจริงมีงานค้างสะสมได้เป็นสิบๆ ใบ ถ้าพ่นออกมาทั้งหมด
// มันจะไม่ใช่ "สรุปตอนเช้า" อีกต่อไป และผู้ตรวจสอบจะเลิกอ่าน
// เก็บตัวที่สำคัญที่สุดไว้ ที่เหลือรวบเป็นบรรทัดเดียวโดยไม่ทิ้งข้อมูลว่ามีอยู่
export const condenseFindings = (findings = [], keepPerKind = 3) => {
  const byKind = new Map();
  for (const finding of findings) {
    if (!byKind.has(finding.kind)) byKind.set(finding.kind, []);
    byKind.get(finding.kind).push(finding);
  }

  const kept = [];
  for (const [kind, group] of byKind) {
    kept.push(...group.slice(0, keepPerKind));
    const rest = group.slice(keepPerKind);
    if (rest.length === 0) continue;

    const dates = rest.map((finding) => finding.receiptDate).filter(Boolean).sort();
    const range = dates.length > 0
      ? dates[0] === dates.at(-1) ? `วันที่ ${dates[0]}` : `วันที่ ${dates[0]} ถึง ${dates.at(-1)}`
      : '';
    kept.push({
      kind,
      severity: rest[0].severity,
      rollup: true,
      count: rest.length,
      title: `${kindLabel(kind)} อีก ${rest.length} รายการ${range ? ` (${range})` : ''}`,
      detail: 'ดูรายการเต็มในหน้าเอกสารรับเงิน',
      sortKey: Number.MAX_SAFE_INTEGER
    });
  }

  return kept.sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) return bySeverity;
    return Number(left.sortKey || 0) - Number(right.sortKey || 0);
  });
};

const kindLabel = (kind) => ({
  pending_receipt: 'เอกสารค้าง',
  cashier_variance: 'เอกสารที่ยอดแคชเชียร์ต่าง',
  settlement: 'ช่องทางที่ยังไม่ปิดรายการ',
  feed_missing: 'ไฟล์ธนาคารที่ยังไม่เข้า',
  feed_failed: 'ไฟล์ที่นำเข้าไม่สำเร็จ'
}[kind] || 'รายการ');

// ข้อความสำรองเมื่อ AI ปิดอยู่หรือเรียกไม่สำเร็จ
// อ่านรู้เรื่องพอที่จะใช้แทนได้จริง ไม่ได้เป็นแค่ placeholder
export const renderFallbackBrief = (facts = {}, findings = condenseFindings(rankFindings(facts))) => {
  if (findings.length === 0) {
    return `สรุปงานวันที่ ${facts.date}\n\nไม่พบงานค้าง เอกสารทุกสาขาเดินครบและไฟล์ธนาคารเข้าครบ`;
  }

  const lines = [`สรุปงานวันที่ ${facts.date}`, ''];
  for (const group of SEVERITY_ORDER) {
    const inGroup = findings.filter((finding) => finding.severity === group);
    if (inGroup.length === 0) continue;
    const heading = group === 'critical' ? 'ต้องทำก่อน' : group === 'warning' ? 'ควรดูวันนี้' : 'ไว้ดูเมื่อว่าง';
    lines.push(`${heading}:`);
    for (const finding of inGroup) {
      lines.push(`- ${finding.title}${finding.detail ? ` — ${finding.detail}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
};

// ย่อ facts ให้เหลือเท่าที่โมเดลต้องใช้ ไม่ส่งเลขบัญชีหรือชื่อผู้ใช้ออกไป
export const factsForPrompt = (facts = {}, findings = condenseFindings(rankFindings(facts))) => ({
  date: facts.date,
  branches: facts.branches || [],
  findings: findings.map((finding) => ({
    kind: finding.kind,
    severity: finding.severity,
    branch: finding.branchCode || null,
    receipt_date: finding.receiptDate || null,
    title: finding.title,
    detail: finding.detail
  }))
});
