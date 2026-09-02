import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  condenseFindings,
  daysBetween,
  detectMissingFeeds,
  factsForPrompt,
  formatThb,
  rankFindings,
  renderFallbackBrief
} from '../src/domain/morningBrief.js';

const baseFacts = {
  date: '2026-08-16',
  branches: [{ code: 'KK', name: 'สาขาคันคลอง' }, { code: 'SK', name: 'สาขาสันกำแพง' }]
};

test('daysBetween counts whole days across a month boundary', () => {
  assert.equal(daysBetween('2026-07-31', '2026-08-03'), 3);
  assert.equal(daysBetween('2026-08-16', '2026-08-16'), 0);
});

test('formatThb keeps two decimals for Thai baht', () => {
  assert.match(formatThb(1234.5), /1,234\.50 บาท/);
});

test('a receipt stuck for three days is critical, one day is only a warning', () => {
  const findings = rankFindings({
    ...baseFacts,
    pendingReceipts: [
      {
        receiptId: 1, receiptDate: '2026-08-15', status: 'SUBMITTED', statusLabel: 'รอตรวจ',
        branchCode: 'SK', branchName: 'สาขาสันกำแพง', daysOverdue: 1
      },
      {
        receiptId: 2, receiptDate: '2026-08-13', status: 'SUBMITTED', statusLabel: 'รอตรวจ',
        branchCode: 'KK', branchName: 'สาขาคันคลอง', daysOverdue: 3
      }
    ]
  });

  assert.equal(findings.length, 2);
  // ค้างนานสุดต้องมาก่อนเสมอ
  assert.equal(findings[0].severity, 'critical');
  assert.equal(findings[0].receiptId, 2);
  assert.equal(findings[1].severity, 'warning');
});

test('cashier variance wording follows the sign and the amount drives severity', () => {
  const findings = rankFindings({
    ...baseFacts,
    cashierVariances: [
      { receiptId: 3, receiptDate: '2026-08-16', branchCode: 'KK', branchName: 'สาขาคันคลอง', variance: -640, acknowledged: false }
    ]
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].title, /ขาด/);
  assert.match(findings[0].title, /640\.00 บาท/);
  assert.equal(findings[0].severity, 'critical');
  assert.match(findings[0].detail, /ยังไม่มีการยืนยัน/);
});

test('a small overage stays a warning and records the cashier acknowledgement', () => {
  const findings = rankFindings({
    ...baseFacts,
    cashierVariances: [
      { receiptId: 4, receiptDate: '2026-08-16', branchCode: 'SK', branchName: 'สาขาสันกำแพง', variance: 120, acknowledged: true }
    ]
  });

  assert.equal(findings[0].severity, 'warning');
  assert.match(findings[0].title, /เกิน/);
  assert.match(findings[0].detail, /ยืนยันส่ง/);
});

test('failed bank imports outrank everything else', () => {
  const findings = rankFindings({
    ...baseFacts,
    pendingReceipts: [
      {
        receiptId: 5, receiptDate: '2026-08-15', status: 'DRAFT', statusLabel: 'ยังไม่ส่ง',
        branchCode: 'KK', branchName: 'สาขาคันคลอง', daysOverdue: 1
      }
    ],
    bankFeeds: { failed: [{ provider: 'krungsri', errorMessage: 'ZIP password incorrect' }], missing: [] }
  });

  assert.equal(findings[0].kind, 'feed_failed');
  assert.equal(findings[0].severity, 'critical');
  assert.match(findings[0].detail, /ZIP password/);
});

test('orphan incoming money is reported but stays low priority', () => {
  const findings = rankFindings({
    ...baseFacts,
    orphanTransactions: { count: 4, totalAmount: 8920, oldestDate: '2026-08-11' }
  });

  assert.equal(findings[0].kind, 'orphan_transactions');
  assert.equal(findings[0].severity, 'info');
  assert.match(findings[0].title, /4 รายการ/);
  assert.match(findings[0].detail, /2026-08-11/);
});

test('detectMissingFeeds only flags providers that normally arrive daily', () => {
  const history = [];
  for (let day = 1; day <= 13; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    history.push({ provider: 'krungsri', source_date: date });
    // kbank-monthly มาเดือนละครั้ง จึงไม่ควรถูกเตือนว่า "หายไป"
    if (day === 1) history.push({ provider: 'kbank-monthly', source_date: date });
  }

  const missing = detectMissingFeeds({ history, targetDate: '2026-08-16' });

  assert.equal(missing.length, 1);
  assert.equal(missing[0].provider, 'krungsri');
});

test('detectMissingFeeds stays quiet when the feed did arrive', () => {
  const history = [];
  for (let day = 1; day <= 16; day += 1) {
    history.push({ provider: 'krungsri', source_date: `2026-08-${String(day).padStart(2, '0')}` });
  }

  assert.deepEqual(detectMissingFeeds({ history, targetDate: '2026-08-16' }), []);
});

test('the fallback brief is usable prose when there is nothing to do', () => {
  const text = renderFallbackBrief({ ...baseFacts });
  assert.match(text, /ไม่พบงานค้าง/);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
});

test('the fallback brief groups findings by urgency', () => {
  const facts = {
    ...baseFacts,
    pendingReceipts: [
      {
        receiptId: 6, receiptDate: '2026-08-12', status: 'SUBMITTED', statusLabel: 'รอตรวจ',
        branchCode: 'KK', branchName: 'สาขาคันคลอง', daysOverdue: 4
      }
    ],
    orphanTransactions: { count: 2, totalAmount: 500, oldestDate: '2026-08-15' }
  };
  const text = renderFallbackBrief(facts);

  assert.match(text, /ต้องทำก่อน:/);
  assert.match(text, /ไว้ดูเมื่อว่าง:/);
  assert.ok(text.indexOf('ต้องทำก่อน:') < text.indexOf('ไว้ดูเมื่อว่าง:'));
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
});

test('factsForPrompt does not leak account numbers or user names to the model', () => {
  const payload = factsForPrompt({
    ...baseFacts,
    settlementIssues: [
      {
        receiptId: 7, receiptDate: '2026-08-14', branchCode: 'KK', branchName: 'สาขาคันคลอง',
        channelCode: 'GRAB', channelLabel: 'GRAB food', settlementStatus: 'EXCEPTION',
        hasEvidence: true, daysWaiting: 2,
        cashierRefVariance: 0, settlementVariance: -340, exceptionNote: 'รอรอบโอน'
      }
    ]
  });

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /account_number|receiving_account|password/i);
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].branch, 'KK');
  assert.match(serialized, /340\.00 บาท/);
});

// กันบั๊กที่เจอจากข้อมูลจริง: แถวที่ settlement_source = 'NONE' มี settlement_variance_amount
// เป็น 0 ลบยอดแคชเชียร์ ซึ่งเป็นค่าตั้งต้นของทุกช่องทางที่ยังไม่ถูกตรวจ ไม่ใช่เงินที่หายไป
test('a channel with no evidence never reports a variance amount', () => {
  const findings = rankFindings({
    ...baseFacts,
    settlementIssues: [
      {
        receiptId: 8, receiptDate: '2026-08-01', branchCode: 'SK', branchName: 'สาขาสันกำแพง',
        channelCode: 'CREDIT_CARD_KBANK', channelLabel: 'บัตรเครดิตกสิกร',
        settlementStatus: 'READY_FOR_STATEMENT',
        hasEvidence: false, daysWaiting: 10,
        cashierRefVariance: 0, settlementVariance: -63601.8
      }
    ]
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].title, /ยังไม่ได้ตรวจ/);
  assert.match(findings[0].detail, /ยังไม่มีหลักฐานอ้างอิง ค้างมา 10 วัน/);
  // ตัวเลขที่ไม่มีความหมายต้องไม่โผล่ที่ไหนเลย
  assert.doesNotMatch(`${findings[0].title} ${findings[0].detail}`, /63,601/);
});

test('a channel with evidence does report the real variance', () => {
  const findings = rankFindings({
    ...baseFacts,
    settlementIssues: [
      {
        receiptId: 9, receiptDate: '2026-08-05', branchCode: 'SK', branchName: 'สาขาสันกำแพง',
        channelCode: 'QR_KPLUS', channelLabel: 'QR กสิกร', settlementStatus: 'EXCEPTION',
        hasEvidence: true, daysWaiting: 6,
        cashierRefVariance: -278, settlementVariance: 0
      }
    ]
  });

  assert.match(findings[0].detail, /ต่างจากยอดก่อนหัก.*278\.00 บาท/);
  assert.equal(findings[0].severity, 'warning');
});

test('condenseFindings keeps the top items and rolls the rest into one line', () => {
  const pendingReceipts = Array.from({ length: 12 }, (_, index) => ({
    receiptId: 200 + index,
    receiptDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
    status: 'SUBMITTED',
    statusLabel: 'รอตรวจ',
    branchCode: 'KK',
    branchName: 'สาขาคันคลอง',
    daysOverdue: 12 - index
  }));

  const all = rankFindings({ ...baseFacts, pendingReceipts });
  const condensed = condenseFindings(all);

  assert.equal(all.length, 12);
  assert.equal(condensed.length, 4);
  const rollup = condensed.at(-1);
  assert.equal(rollup.rollup, true);
  assert.equal(rollup.count, 9);
  assert.match(rollup.title, /เอกสารค้าง อีก 9 รายการ/);
  // ต้องบอกช่วงวันที่ที่ถูกยุบไป ไม่ให้ข้อมูลหายเงียบ
  assert.match(rollup.title, /2026-08-04 ถึง 2026-08-12/);
});

test('condenseFindings rolls up each kind separately', () => {
  const facts = {
    ...baseFacts,
    pendingReceipts: Array.from({ length: 5 }, (_, index) => ({
      receiptId: index, receiptDate: `2026-08-0${index + 1}`, status: 'SUBMITTED',
      statusLabel: 'รอตรวจ', branchCode: 'KK', branchName: 'สาขาคันคลอง', daysOverdue: 5 - index
    })),
    bankFeeds: {
      failed: [],
      missing: Array.from({ length: 5 }, (_, index) => ({
        provider: `feed-${index}`, seenDaysInLookback: 10 - index, lookbackDays: 14
      }))
    }
  };

  const condensed = condenseFindings(rankFindings(facts));
  const rollups = condensed.filter((finding) => finding.rollup);

  assert.equal(rollups.length, 2);
  assert.ok(rollups.some((finding) => finding.kind === 'pending_receipt'));
  assert.ok(rollups.some((finding) => finding.kind === 'feed_missing'));
});
