import { cents, decimal, sum, monthRange, supplierLedger, trialBalance, validateJournal } from './domain.js';
import { ACCOUNTS } from './schema.js';
const total = rows => sum(rows.map(r => cents(r.amount)));
export function buildApReport(bundle, { month, branch = '' }) {
  const { from, to } = monthRange(month);
  const meta = bundle.metadata;
  if (branch && !meta.branches.some(b => b.code === branch)) throw Object.assign(new Error('INVALID_BRANCH'), { statusCode: 422 });
  const selected = r => !branch || r.branch === branch;
  const sources = bundle.sources.filter(selected), statements = bundle.statements.filter(selected);
  const journals = bundle.journals.filter(selected);
  journals.forEach(validateJournal);
  const expenses = new Set(ACCOUNTS.filter(a => a[2] === 'EXPENSE').map(a => a[0]));
  const cost = j => sum(j.lines.filter(l => expenses.has(l.account)).map(l => cents(l.dr) - cents(l.cr)));
  const periodControls = meta.branches.filter(b => !branch || b.code === branch).map(b => {
    const row = bundle.periodControls?.find(c => c.branch === b.code);
    const openingComplete = row?.openingComplete === true;
    return { branch: b.code, openingComplete, purchasesComplete: row?.purchasesComplete === true,
      paymentsComplete: row?.paymentsComplete === true, openingDate: row?.document?.openingDate || null,
      openingImportId: row?.document?.openingImportId || null, openingFingerprint: row?.document?.openingFingerprint || null,
      openingAgingBasis: row?.document?.openingAgingBasis || null,
      missingSuppliers: openingComplete ? [] : row?.document?.openingMissing || bundle.suppliers.filter(s => s.branch === b.code) };
  });
  const ledger = periodControls.flatMap(c => supplierLedger({ journals, suppliers: bundle.suppliers, from, to, branch: c.branch, complete: c.openingComplete })
    .map(s => ({ ...s, openingConfirmed: c.openingComplete || !c.missingSuppliers.some(m => m.key === s.key),
      missingOpening: c.missingSuppliers.some(m => m.key === s.key),
      purchases: c.purchasesComplete ? s.purchases : null,
      provisional: !c.purchasesComplete || !c.paymentsComplete,
      agingBasis: c.openingAgingBasis, openingDate: c.openingDate })));
  const pnlMap = new Map(meta.pnl.items.filter(selected).map(i => [i.key, i]));
  const cases = sources.map(s => {
    const pnl = pnlMap.get(s.nativeKey), js = journals.filter(j => j.sourceKey === s.key);
    const ap = sum(js.map(cost)), old = pnl && !pnl.excluded ? cents(pnl.amount) : 0;
    let reason = s.status === 'CREDIT_PAYMENT' ? 'จ่ายเจ้าหนี้ ไม่ใช่หลักฐานรับของ; ยังไม่มีบิลรับรู้ต้นทุน' : s.status === 'PASS_THROUGH' ? 'เงินผ่านพี่เก้ง ไม่ใช่ต้นทุนร้าน' :
      s.status === 'PAID_PURCHASE' ? 'รับรู้ชั่วคราวตามหลักฐานจ่าย; ยังไม่ยืนยันวันรับของ' : s.status === 'OPEN_ROUND' ? 'รอบ LINE ยังไม่ปิด' :
      s.status === 'PNL_EXCLUDED' ? 'ไม่นับตามการตัดรายการ P&L เดิม' : 'ประเภท/ซัพไม่ชัด ต้องตรวจต้นฉบับ';
    if (s.period !== month) reason += `; P&L เดิมย้ายรับรู้ไปเดือน ${s.period}`;
    if (s.pnlExcluded && s.status !== 'PNL_EXCLUDED') reason += '; P&L เดิมตัดรายการนี้';
    return { sourceKey: s.key, branch: s.branch, date: s.date, supplierName: s.supplierName, amount: s.amount, status: s.status,
      pnl: decimal(old), journalCost: decimal(ap), difference: decimal(ap - old), purchasePeriod: s.purchasePeriod || null,
      bankStatus: 'ยังไม่มีหลักฐานจ่ายออกที่ผูกซัพ', threeWayStatus: 'รอใบสั่ง/ใบรับของ/บิล', reason,
      flags: [...s.flags, ...js.flatMap(j => j.flags)] };
  });
  for (const [key, p] of pnlMap) if (!sources.some(s => s.nativeKey === key)) cases.push({ sourceKey: key, branch: p.branch, date: p.date, supplierName: '',
    amount: p.amount, status: 'PNL_PERIOD_ONLY', pnl: p.excluded ? '0.00' : p.amount, journalCost: '0.00',
    difference: decimal(p.excluded ? 0 : -cents(p.amount)), reason: 'P&L ย้ายเดือนรับรู้จากวันจ่ายเดือนอื่น; ไม่มีเอกสารรับของ' });
  const branchRows = meta.branches.filter(b => !branch || b.code === branch).map(b => {
    const bs = sources.filter(s => s.branch === b.code), bj = journals.filter(j => j.branch === b.code), bp = meta.pnl.items.filter(p => p.branch === b.code && !p.excluded);
    const pnlLbc = total(bp), journalCost = sum(bj.map(cost));
    return { ...b, observed: decimal(total(bs)), paidPurchase: decimal(total(bs.filter(s => s.status === 'PAID_PURCHASE'))),
      supplierPaid: decimal(total(bs.filter(s => s.status === 'CREDIT_PAYMENT'))), passThrough: decimal(total(bs.filter(s => s.status === 'PASS_THROUGH'))),
      review: decimal(total(bs.filter(s => !['PAID_PURCHASE', 'CREDIT_PAYMENT', 'PASS_THROUGH'].includes(s.status)))),
      purchases: null, closing: periodControls.find(c => c.branch === b.code)?.openingComplete ? decimal(sum(ledger.filter(s => s.branch === b.code).map(s => cents(s.closing)))) : null,
      pnlLbc: decimal(pnlLbc), provisionalCost: decimal(journalCost), difference: decimal(journalCost - pnlLbc),
      pnlSnapshotExpenseScope: meta.pnl.branches.find(p => p.branch === b.code)?.amount || '0.00' };
  });
  const tb = trialBalance(journals, { from, to, branch });
  const debit = sum(tb.map(r => cents(r.dr))), credit = sum(tb.map(r => cents(r.cr)));
  return { month, branch, fingerprint: bundle.fingerprint, capturedAt: meta.capturedAt, readOnly: true, provisional: true,
    limitations: [...meta.limitations.filter(l => !l.startsWith('ไม่มียอดเจ้าหนี้ยกมา') || periodControls.some(c => !c.openingComplete)),
      ...(periodControls.some(c => c.openingComplete) ? ['ยอดคงค้างคำนวณจากยอดยกมาและรายการที่มี; ใบรับของ/รายการจ่ายยังไม่รับรองว่าครบ', 'อายุยอดยกมาเริ่มนับจากวันที่ยกมา เป็นค่าประมาณ ไม่ใช่อายุเกินกำหนดของบิลเดิม'] : [])],
    branches: meta.branches, branchRows, ledger, journals, trialBalance: tb,
    balance: { dr: decimal(debit), cr: decimal(credit), difference: decimal(debit - credit) },
    accounts: [...ACCOUNTS.map(([code, name, kind]) => ({ code, name, kind })), ...meta.accounts],
    sources, reconciliation: { cases, statements,
      lbc: decimal(total(sources)), journalCost: decimal(sum(journals.map(cost))), pnlLbc: decimal(total([...pnlMap.values()].filter(p => !p.excluded))),
      pnlSnapshotExpenseScope: decimal(sum(meta.pnl.branches.filter(selected).map(p => cents(p.amount)))),
      pnlAdditionalCompany: { manual: meta.pnl.manualTotal, recurring: meta.pnl.recurringTotal, socialSecurity: meta.pnl.socialSecurityTotal },
      statementTotal: decimal(total(statements)), outgoingTotal: decimal(total(statements.filter(s => s.direction === 'outgoing'))),
      incomingTotal: decimal(total(statements.filter(s => s.direction === 'incoming'))), unknownTotal: decimal(total(statements.filter(s => s.direction === 'unknown'))),
      matchedTotal: '0.00', matchedCount: 0,
      bankConclusion: 'ไม่มีรายการจ่ายออกที่ยืนยันซัพ จึงไม่หักเจ้าหนี้จาก statement; ยอดตรงกันอย่างเดียวไม่ใช่หลักฐานจับคู่',
      pnlScope: 'P&L ตาม builder เดิม เฉพาะ LBC + manual + recurring + SSO ใน snapshot; ไม่รวม HRMS/ค่าธรรมเนียมรับเงิน' },
    controls: { openingComplete: periodControls.length > 0 && periodControls.every(c => c.openingComplete),
      purchasesComplete: periodControls.length > 0 && periodControls.every(c => c.purchasesComplete),
      paymentsComplete: periodControls.length > 0 && periodControls.every(c => c.paymentsComplete),
      missingSuppliers: periodControls.flatMap(c => c.missingSuppliers), byBranch: periodControls, duplicates: meta.duplicateCount } };
}

const parsed = v => typeof v === 'string' ? JSON.parse(v) : v;
export async function loadApBundle(connection, month) {
  const { from } = monthRange(month);
  await connection.beginTransaction();
  try {
    const [[batch]] = await connection.query('SELECT * FROM ap_batches WHERE month_start=? ORDER BY id DESC LIMIT 1', [from]);
    if (!batch) throw Object.assign(new Error('AP_NOT_IMPORTED'), { statusCode: 503 });
    const [rows] = await connection.query('SELECT document FROM ap_sources WHERE batch_id=? ORDER BY source_key', [batch.id]);
    const meta = parsed(batch.metadata);
    const documents = rows.map(r => parsed(r.document));
    // Journals are reloaded from the persisted double-entry tables, never reconstructed from a UI total.
    const [heads] = await connection.query('SELECT j.* FROM ap_journals j JOIN ap_sources s ON s.source_key=j.source_key WHERE s.batch_id=? ORDER BY j.journal_key', [batch.id]);
    const [lines] = await connection.query('SELECT l.* FROM ap_journal_lines l JOIN ap_journals j ON j.journal_key=l.journal_key JOIN ap_sources s ON s.source_key=j.source_key WHERE s.batch_id=? ORDER BY l.journal_key,l.line_no', [batch.id]);
    const [suppliers] = await connection.query('SELECT supplier_key AS `key`, branch_code AS branch, name, reference FROM ap_suppliers ORDER BY supplier_key');
    const [controls] = await connection.query('SELECT * FROM ap_period_controls WHERE batch_id=? ORDER BY branch_code', [batch.id]);
    const journals = heads.map(j => ({ key: j.journal_key, sourceKey: j.source_key, date: j.business_date, branch: j.branch_code,
      type: j.journal_type, dueDate: j.due_date, reverses: j.reverses_key, description: j.description, flags: parsed(j.flags),
      lines: lines.filter(l => l.journal_key === j.journal_key).map(l => ({ account: l.account_code, supplier: l.supplier_key, dr: l.debit, cr: l.credit })) }));
    await connection.commit();
    return { fingerprint: batch.fingerprint, metadata: meta, sources: documents.filter(s => s.sourceType === 'LBC'),
      statements: documents.filter(s => s.sourceType === 'STATEMENT'),
      suppliers: suppliers.filter(s => controls.some(c => c.branch_code === s.branch &&
        (!parsed(c.document).supplierKeys || parsed(c.document).supplierKeys.includes(s.key)))), journals,
      periodControls: controls.map(c => ({ branch: c.branch_code, openingComplete: Boolean(Number(c.opening_complete)),
        purchasesComplete: Boolean(Number(c.purchases_complete)), paymentsComplete: Boolean(Number(c.payments_complete)), document: parsed(c.document) })) };
  } catch (error) { await connection.rollback(); throw error; }
}
