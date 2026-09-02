const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const money = (value) => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const thaiDate = (value) => {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', { dateStyle: 'long', timeZone: 'Asia/Bangkok' })
      .format(new Date(`${value}T12:00:00+07:00`));
  } catch {
    return value;
  }
};

const thaiDateTime = (timestampMs) => {
  if (!Number(timestampMs)) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
    timeZone: 'Asia/Bangkok'
  }).format(new Date(Number(timestampMs)));
};

const image = (id, label) => id
  ? `<figure><img src="/api/admin/items/${Number(id)}/image" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`
  : '';

const generatedDocument = (transaction) => {
  if (!transaction.generated_document_type) return image(transaction.bill_id, `บิล #${transaction.bill_id}`);
  let document = {};
  try {
    document = JSON.parse(transaction.generated_document_json || '{}');
  } catch {
    document = {};
  }
  if (transaction.generated_document_type === 'batch_payment_line') {
    return `<div class="generated"><strong>รายการจากใบสรุปรอบจ่าย</strong><dl>
      <dt>แถวที่</dt><dd>${escapeHtml(document.line_no || '-')}</dd>
      <dt>ร้านค้า</dt><dd>${escapeHtml(document.supplier_name || transaction.vendor_name || '-')}</dd>
      <dt>บัญชี</dt><dd>${escapeHtml(document.payee_name || '-')}</dd>
      <dt>ธนาคาร</dt><dd>${escapeHtml(document.bank_name || '-')}</dd>
      <dt>เลขบัญชี</dt><dd>${escapeHtml(document.account_no || '-')}</dd>
      <dt>จำนวนเงิน</dt><dd>${money(document.amount || transaction.bill_total_value)} บาท</dd>
    </dl></div>`;
  }
  return `<div class="generated"><strong>ใบแทนใบเสร็จรับเงิน</strong><dl>
    <dt>เลขที่</dt><dd>${escapeHtml(document.document_no || transaction.doc_ref || '-')}</dd>
    <dt>ผู้จ่าย</dt><dd>${escapeHtml(document.payer_name || 'บริษัท โซลาว จำกัด')}</dd>
    <dt>ผู้รับเงิน</dt><dd>${escapeHtml(document.payee_name || transaction.vendor_name || '-')}</dd>
    <dt>รายการ</dt><dd>${escapeHtml(document.description || transaction.bill_purpose || '-')}</dd>
    <dt>จำนวนเงิน</dt><dd>${money(document.amount || transaction.bill_total_value)} บาท</dd>
  </dl></div>`;
};

const cashEvidence = (transaction) => {
  const cash = transaction.cash_payment || {};
  return `<div class="cash-evidence"><span class="cash-mark">เงินสด</span><strong>หลักฐานการชำระเงินสด</strong><dl>
    <dt>ผู้จ่าย</dt><dd>บริษัท โซลาว จำกัด</dd>
    <dt>ผู้รับเงิน</dt><dd>${escapeHtml(cash.recipient_name || transaction.vendor_name || '-')}</dd>
    <dt>จำนวนเงิน</dt><dd>${money(cash.amount || transaction.cash_amount_value)} บาท</dd>
    <dt>วันที่รอบ</dt><dd>${escapeHtml(thaiDate(cash.business_date || ''))}</dd>
    <dt>ยืนยันเมื่อ</dt><dd>${escapeHtml(cash.confirmed_at ? new Date(cash.confirmed_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '-')}</dd>
    <dt>หมายเหตุ</dt><dd>${escapeHtml(cash.note || '-')}</dd>
  </dl></div>`;
};

const reportStyles = `
  @page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#172033;font:12px system-ui,-apple-system,"Noto Sans Thai",sans-serif}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:8px;padding:10px;background:#172033}.toolbar a,.toolbar button{border:1px solid #d0d5dd;border-radius:5px;background:#fff;color:#172033;padding:8px 13px;text-decoration:none;font:700 12px inherit;cursor:pointer}.toolbar button{background:#2563eb;color:#fff;border-color:#2563eb}
  .sheet{position:relative;width:210mm;height:297mm;margin:8mm auto;padding:15mm 14mm 13mm;background:#fff;overflow:hidden;page-break-after:always}.sheet:last-child{page-break-after:auto}
  header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #172033;padding-bottom:7mm}h1{font-size:22px;margin:2mm 0 0;letter-spacing:0}h2{font-size:14px;margin:0 0 4mm}small,.muted{color:#667085}.status{padding:2mm 3mm;border:1px solid #86efac;background:#f0fdf4;color:#067647;font-weight:800;border-radius:3px}
  .identity{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin:7mm 0}.identity div,.control{border:1px solid #d0d5dd;padding:4mm}.identity span,.facts span{display:block;color:#667085;font-size:10px;margin-bottom:1mm}.identity strong{font-size:14px}
  .balance{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #98a2b3;margin:7mm 0}.balance div{padding:3.5mm 3mm;border-right:1px solid #d0d5dd}.balance div:last-child{border:0}.balance span{display:block;color:#667085;font-size:9px}.balance strong{display:block;font-size:15px;margin-top:2mm}.ok{color:#067647}.bad{color:#b42318}.income{color:#175cd3}
  .bill-summary{margin-top:7mm}.bill-summary h2{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3mm}.bill-summary h2 span{font-size:10px;color:#667085;font-weight:500}.bill-list-head,.bill-list li,.bill-total{display:grid;grid-template-columns:8mm minmax(0,1fr) 27mm 27mm;align-items:center;gap:3mm;padding-left:4mm;padding-right:4mm}.bill-list-head{padding-top:2mm;padding-bottom:2mm;border:1px solid #98a2b3;border-bottom:0;background:#f8fafc;color:#667085;font-size:9px;font-weight:700}.bill-list-head span:nth-last-child(-n+2){text-align:right}.bill-list{margin:0;padding:0;border:1px solid #d0d5dd;list-style:none}.bill-list li{padding-top:2.3mm;padding-bottom:2.3mm;border-bottom:1px solid #e4e7ec}.bill-list li:last-child{border-bottom:0}.bill-list b{color:#667085;text-align:center}.bill-list div{min-width:0}.bill-list strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bill-list small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bill-list .bill-amount,.bill-list .slip-amount{text-align:right;font-size:12px;color:#172033}.bill-total{padding-top:3mm;padding-bottom:3mm;border:1px solid #98a2b3;border-top:0;font-weight:800}.bill-total .total-label{grid-column:1 / 3}.bill-total .total-value{text-align:right;white-space:nowrap}.incoming-summary{margin-top:5mm}.incoming-summary h2{display:flex;justify-content:space-between;margin-bottom:2mm}.incoming-summary h2 span{font-size:10px;color:#667085;font-weight:500}.incoming-list{margin:0;padding:0;list-style:none;border:1px solid #bfdbfe}.incoming-list li{display:grid;grid-template-columns:8mm minmax(0,1fr) 30mm;gap:3mm;padding:2mm 4mm;border-bottom:1px solid #dbeafe}.incoming-list li:last-child{border:0}.incoming-list b{color:#667085;text-align:center}.incoming-list strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.incoming-list .incoming-amount{text-align:right;color:#175cd3}.incoming-total{display:flex;justify-content:space-between;padding:2.5mm 4mm;border:1px solid #93c5fd;border-top:0;font-weight:800;color:#175cd3}.control{margin-top:6mm;line-height:1.8}.signatures{width:62mm;margin:14mm auto 0;text-align:center}.signatures div{padding-top:9mm;border-top:1px solid #667085}
  .evidence-sheet{padding-top:10mm}.transaction-card{height:258mm;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);gap:2mm;padding-bottom:4mm;overflow:hidden}.txn-head{display:flex;align-items:flex-start;justify-content:space-between;gap:4mm}.txn-head h1{font-size:15px;line-height:1.2;margin:.5mm 0 0;max-width:150mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.txn-head small{font-size:9px}.txn-head .status{padding:1mm 2mm;font-size:9px;white-space:nowrap}
  .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1mm}.facts div{border:1px solid #d0d5dd;padding:1.1mm 1.5mm;min-width:0}.facts strong{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.facts span{font-size:7px;margin:0}.meta-line{display:grid;grid-template-columns:1.05fr 1.05fr 1fr 1.4fr;gap:1mm;padding:1.2mm 1.5mm;border:1px solid #d0d5dd;background:#f8fafc;color:#475467;font-size:7.5px}.meta-line span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta-line b{color:#172033}.documents{display:grid;grid-template-columns:1fr 1fr;gap:2mm;min-height:0}.documents.grouped{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}.documents.single{grid-template-columns:1fr}.documents figure{margin:0;border:1px solid #d0d5dd;padding:1mm;display:grid;grid-template-rows:minmax(0,1fr) auto;overflow:hidden}.documents img{width:100%;height:100%;min-height:0;object-fit:contain}.documents figcaption{text-align:center;color:#667085;padding-top:.4mm;font-size:7px}
  .generated{border:1px solid #d0d5dd;padding:3mm;overflow:hidden}.generated>strong{display:block;text-align:center;font-size:12px;margin-bottom:2mm}.generated dl,.cash-evidence dl{display:grid;grid-template-columns:24mm 1fr;gap:2mm;margin:0;font-size:9px}.generated dd,.cash-evidence dd{margin:0;font-weight:700;overflow-wrap:anywhere}.cash-evidence{border:2px solid #86b7a8;background:#f0fdf8;padding:8mm;overflow:hidden}.cash-evidence>strong{display:block;font-size:15px;margin:4mm 0 7mm}.cash-mark{display:inline-block;background:#126b58;color:#fff;padding:2mm 3mm;border-radius:3px;font-weight:800}.attachments{position:absolute;right:2mm;bottom:2mm;display:flex;gap:1mm;padding:1mm;background:#fffffff2;border:1px solid #d0d5dd}.attachments figure{width:13mm;height:17mm}.attachments img{width:100%;height:12mm;object-fit:contain}.attachments figcaption{font-size:6px}.transaction-card{position:relative}.sheet footer{position:absolute;left:14mm;right:14mm;bottom:7mm;display:flex;justify-content:space-between;border-top:1px solid #d0d5dd;padding-top:2mm;color:#667085;font-size:9px}
  @media print{body{background:#fff}.toolbar{display:none}.sheet{margin:0}}
`;

export const renderDayReport = (report, { groupName = '', autoPrint = true } = {}) => {
  const closing = report.closing || {};
  const summary = closing.summary || {};
  const transactions = report.transactions || [];
  const reimbursements = report.reimbursements || [];
  const incomingTransfers = report.incoming_transfers || [];
  const billTotal = Number(summary.confirmed_bill_amount || 0);
  const slipTotal = Number(summary.confirmed_slip_amount || 0);
  const cashTotal = Number(summary.confirmed_cash_amount || 0);
  const paymentTotal = Number(summary.confirmed_payment_amount ?? (slipTotal + cashTotal));
  const difference = billTotal - paymentTotal;
  const incomingTotal = incomingTransfers.reduce((sum, row) => sum + Number(row.slip_amount_value || 0), 0);
  const detailCount = transactions.length + reimbursements.length + incomingTransfers.length;
  const detailPages = detailCount;
  const totalPages = 1 + detailPages;
  const title = groupName || report.source_id;
  const billSummaryRows = transactions.map((row, index) => {
    const cash = row.payment_method === 'cash';
    const paid = cash ? Number(row.cash_payment?.amount || row.cash_amount_value || 0) : Number(row.slip_amount_value || 0);
    return `<li><b>${index + 1}</b><div><strong>${escapeHtml(row.vendor_name || row.supplier_name || row.bill_purpose || `บิล #${row.bill_id}`)}</strong><small>${escapeHtml(row.bill_purpose || row.doc_ref || `บิล #${row.bill_id}`)} · ${cash ? 'เงินสด' : 'โอน'}</small></div><strong class="bill-amount">${money(row.bill_total_value)}</strong><strong class="slip-amount">${money(paid)}</strong></li>`;
  }).join('');
  const incomingSummaryRows = incomingTransfers.map((row, index) => `<li><b>${index + 1}</b><strong>${escapeHtml(row.bill_purpose || row.vendor_name || row.ai_summary || `เงินรับเข้า #${row.item_id}`)}</strong><strong class="incoming-amount">${money(row.slip_amount_value)}</strong></li>`).join('');

  const transactionCards = transactions.map((row, index) => {
    const isCash = row.payment_method === 'cash';
    const paidAmount = isCash ? Number(row.cash_payment?.amount || row.cash_amount_value || 0) : Number(row.slip_amount_value || 0);
    const differenceValue = Number(row.bill_total_value || 0) - paidAmount;
    const attachments = (row.attachments || []).map((attachment) => image(attachment.id, `เอกสารหน้า ${attachment.page_no || '-'}`)).join('');
    const billMembers = row.bill_members?.length ? row.bill_members : [row];
    const slipMembers = row.slip_members?.length ? row.slip_members : [];
    const billDocuments = billMembers.map((member) => generatedDocument(member)).join('');
    const paymentDocuments = isCash
      ? cashEvidence(row)
      : slipMembers.map((member) => image(member.slip_id, `สลิป #${member.slip_id}`)).join('');
    const billMeta = billMembers.map((member) => `#${member.bill_id} ${thaiDateTime(member.bill_timestamp_ms)}`).join(', ');
    const slipMeta = slipMembers.map((member) => `#${member.slip_id} ${thaiDateTime(member.slip_timestamp_ms)}`).join(', ');
    return `<article class="transaction-card"><div class="txn-head"><div><small>ธุรกรรม ${index + 1} / ${detailCount}</small><h1>${escapeHtml(row.vendor_name || row.supplier_name || row.bill_purpose || `ธุรกรรม #${row.match_id || row.cash_payment_id}`)}</h1></div><span class="status">${isCash ? 'จ่ายเงินสด' : 'ยืนยันแล้ว'}</span></div>
      <div class="facts"><div><span>ยอดบิล</span><strong>${money(row.bill_total_value)}</strong></div><div><span>${isCash ? 'ยอดเงินสด' : 'ยอดโอน'}</span><strong>${money(paidAmount)}</strong></div><div><span>ผลต่าง</span><strong class="${Math.abs(differenceValue) < 0.01 ? 'ok' : 'bad'}">${money(differenceValue)}</strong></div><div><span>กลุ่ม LINE</span><strong>${escapeHtml(title)}</strong></div></div>
      <div class="meta-line"><span><b>บิล</b> ${escapeHtml(billMeta)}</span><span><b>${isCash ? 'เงินสด' : 'โอน'}</b> ${escapeHtml(isCash ? row.cash_payment?.recipient_name || '-' : slipMeta)}</span><span><b>เอกสาร</b> ${billMembers.length} บิล / ${isCash ? 'เงินสด' : `${slipMembers.length} สลิป`}</span><span><b>รายการ</b> ${escapeHtml(row.bill_purpose || row.vendor_name || '-')}</span></div>
      <div class="documents ${row.is_group ? 'grouped' : ''}">${billDocuments}${paymentDocuments}</div>${attachments ? `<div class="attachments">${attachments}</div>` : ''}</article>`;
  });

  const reimbursementCards = reimbursements.map((row, index) => {
    const evidence = row.reimbursement_evidence_mode === 'receipt_substitute'
      ? 'ใบแทนใบเสร็จ'
      : row.reimbursement_evidence_mode === 'existing_receipt' ? 'บิล/ใบเสร็จเดิม' : 'บันทึกเหตุผล';
    return `<article class="transaction-card"><div class="txn-head"><div><small>ธุรกรรม ${transactions.length + index + 1} / ${detailCount}</small><h1>คืนเงินสำรองจ่าย</h1></div><span class="status">ตรวจหลักฐานแล้ว</span></div>
      <div class="facts"><div><span>ยอดสำรองจ่าย</span><strong>${money(row.advance_amount)}</strong></div><div><span>ยอดคืนเงิน</span><strong>${money(row.reimbursement_amount)}</strong></div><div><span>ผลต่าง</span><strong class="ok">${money(Number(row.advance_amount || 0) - Number(row.reimbursement_amount || 0))}</strong></div><div><span>หลักฐาน</span><strong>${escapeHtml(evidence)}</strong></div></div>
      <div class="meta-line"><span><b>สำรอง</b> ${escapeHtml(thaiDateTime(row.advance_timestamp_ms))} · ${escapeHtml(row.advance_sender || '-')}</span><span><b>คืนเงิน</b> ${escapeHtml(thaiDateTime(row.reimbursement_timestamp_ms))} · ${escapeHtml(row.reimbursement_sender || '-')}</span><span><b>หลักฐาน</b> ${escapeHtml(evidence)}</span><span><b>รายการ</b> ${escapeHtml(row.bill_purpose || row.reimbursement_review_note || '-')}</span></div>
      <div class="documents">${image(row.advance_id, `หลักฐานสำรองจ่าย #${row.advance_id}`)}${image(row.reimbursement_id, `หลักฐานคืนเงิน #${row.reimbursement_id}`)}</div></article>`;
  });

  const incomingCards = incomingTransfers.map((row, index) => `<article class="transaction-card"><div class="txn-head"><div><small>ธุรกรรม ${transactions.length + reimbursements.length + index + 1} / ${detailCount}</small><h1>${escapeHtml(row.bill_purpose || row.vendor_name || `เงินรับเข้า #${row.item_id}`)}</h1></div><span class="status">เงินรับเข้า</span></div>
      <div class="facts"><div><span>ยอดรับเข้า</span><strong class="income">${money(row.slip_amount_value)}</strong></div><div><span>ผู้ส่งใน LINE</span><strong>${escapeHtml(row.sender_name || '-')}</strong></div><div><span>เวลา LINE</span><strong>${escapeHtml(thaiDateTime(row.event_timestamp_ms))}</strong></div><div><span>กลุ่ม LINE</span><strong>${escapeHtml(title)}</strong></div></div>
      <div class="meta-line"><span><b>รูป</b> #${Number(row.item_id)}</span><span><b>ประเภท</b> เงินโอนเข้า</span><span><b>จำนวน</b> ${money(row.slip_amount_value)} บาท</span><span><b>สรุป</b> ${escapeHtml(row.ai_summary || '-')}</span></div>
      <div class="documents single">${image(row.item_id, `หลักฐานเงินรับเข้า #${row.item_id}`)}</div></article>`);

  const detailCards = [...transactionCards, ...reimbursementCards, ...incomingCards];
  const transactionPages = Array.from({ length: detailPages }, (_, pageIndex) => {
    const cards = detailCards.slice(pageIndex, pageIndex + 1).join('');
    return `<section class="sheet evidence-sheet">${cards}<footer>Bill Capture · ${escapeHtml(report.business_date)} · ${escapeHtml(title)}<span>หน้า ${pageIndex + 2} / ${totalPages}</span></footer></section>`;
  }).join('');

  const printScript = autoPrint
    ? `<script>Promise.race([Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))),new Promise(r=>setTimeout(r,4000))]).then(()=>window.print())<\/script>`
    : '';

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>สรุปรอบ ${escapeHtml(report.business_date)} ${escapeHtml(title)}</title><style>${reportStyles}</style></head><body>
    <nav class="toolbar"><a href="/admin?date=${encodeURIComponent(report.business_date)}&group=${encodeURIComponent(report.source_id)}">กลับหน้ารอบ</a><button type="button" onclick="window.print()">พิมพ์ / บันทึก PDF</button></nav>
    <section class="sheet"><header><div><small>ใบสรุปกระทบยอดประจำวัน</small><h1>${escapeHtml(title)}</h1></div><span class="status">ปิดรอบแล้ว</span></header>
      <div class="identity"><div><span>วันที่ทำรายการ</span><strong>${escapeHtml(thaiDate(report.business_date))}</strong></div><div><span>ปิดรอบเมื่อ</span><strong>${escapeHtml(new Date(closing.closed_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }))}</strong></div></div>
      <div class="balance"><div><span>ยอดค่าใช้จ่าย</span><strong>${money(billTotal)}</strong></div><div><span>ยอดโอนจ่าย</span><strong>${money(slipTotal)}</strong></div><div><span>ยอดเงินสด</span><strong>${money(cashTotal)}</strong></div><div><span>ยอดรับเข้า</span><strong class="income">${money(incomingTotal)}</strong></div><div><span>ผลต่างฝั่งจ่าย</span><strong class="${Math.abs(difference) < 0.01 ? 'ok' : 'bad'}">${money(difference)}</strong></div></div>
      <section class="bill-summary"><h2>รายการบิลที่ยืนยันแล้ว <span>${transactions.length} รายการ</span></h2><div class="bill-list-head"><span>ลำดับ</span><span>รายการ</span><span>บิล</span><span>ชำระ</span></div><ol class="bill-list">${billSummaryRows}</ol><div class="bill-total"><span class="total-label">รวม</span><span class="total-value">${money(billTotal)}</span><span class="total-value">${money(paymentTotal)}</span></div></section>
      ${incomingTransfers.length ? `<section class="incoming-summary"><h2>รายการรับเงินเข้า <span>${incomingTransfers.length} รายการ</span></h2><ol class="incoming-list">${incomingSummaryRows}</ol><div class="incoming-total"><span>รวมรับเข้า</span><strong>${money(incomingTotal)} บาท</strong></div></section>` : ''}
      <div class="control"><strong>การควบคุมเอกสาร</strong><br>ยอดค่าใช้จ่ายเทียบกับยอดโอนจ่ายและยอดเงินสดที่ยืนยันแล้ว ณ เวลาปิดรอบ เงินรับเข้าแสดงแยกและไม่นำมาหักกลบกับค่าใช้จ่าย รายการคืนเงินสำรองจ่ายไม่นับเป็นค่าใช้จ่ายซ้ำ</div>
      <div class="signatures"><div>ผู้ตรวจสอบ</div></div><footer>Bill Capture · ${escapeHtml(report.business_date)} · ${escapeHtml(title)}<span>หน้า 1 / ${totalPages}</span></footer>
    </section>${transactionPages}${printScript}</body></html>`;
};
