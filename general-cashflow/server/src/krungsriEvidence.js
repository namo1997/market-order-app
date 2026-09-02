import crypto from 'node:crypto';
import path from 'node:path';
import { logAudit } from './db.js';
import { roundMoney, sumMoney } from './domain/money.js';

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const money = (value) => value === null ? '-' : Number(value).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const rawObject = (value) => typeof value === 'string' ? JSON.parse(value) : (value || {});
const bankMoney = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  if (!Number.isFinite(parsed)) throw new Error('ยอดเงินในหลักฐานกรุงศรีไม่ใช่ตัวเลข');
  return roundMoney(parsed);
};
const optionalSum = (rows, key) => rows.every((row) => row[key] !== null)
  ? sumMoney(rows.map((row) => row[key])) : null;

export const createKrungsriCombinedEvidence = ({ receipt, rows }) => {
  const seen = new Set();
  const transactions = [];
  for (const row of rows) {
    // Only rows actually linked to this receipt belong in its evidence packet.
    if (Number(row.receipt_line_id) !== Number(receipt.line_id)
      || String(row.transaction_date).slice(0, 10) !== receipt.receipt_date
      || /^summary[_-]/i.test(path.basename(row.source_file_name || ''))) continue;
    if (seen.has(String(row.statement_transaction_id))) continue;
    seen.add(String(row.statement_transaction_id));
    const raw = rawObject(row.raw_payload);
    const amount = bankMoney(row.amount);
    if (amount === null) throw new Error('ไม่พบยอดรายการในหลักฐานกรุงศรี');
    transactions.push({
      ...row, raw, amount,
      fee: bankMoney(raw['Service Fee']),
      net: bankMoney(raw['Net Transaction amount']),
      time: String(raw['Transaction paid time'] || row.transaction_date),
      reference: String(raw['Transaction ID'] || row.reference_no || '')
    });
  }
  if (!transactions.length) return null;
  transactions.sort((a, b) => String(a.source_file_name).localeCompare(String(b.source_file_name))
    || Number(a.inbox_import_id) - Number(b.inbox_import_id)
    || a.time.localeCompare(b.time) || a.reference.localeCompare(b.reference));
  const sources = new Map();
  for (const row of transactions) {
    const key = `${row.inbox_import_id}:${row.source_file_name}`;
    const group = sources.get(key) || { name: row.source_file_name, archive: row.archive_name, rows: [] };
    group.rows.push(row);
    sources.set(key, group);
  }
  const groups = [...sources.values()].map((group) => ({
    ...group, amount: sumMoney(group.rows.map((row) => row.amount)),
    fee: optionalSum(group.rows, 'fee'), net: optionalSum(group.rows, 'net')
  }));
  const total = sumMoney(transactions.map((row) => row.amount));
  const fee = optionalSum(transactions, 'fee');
  const net = optionalSum(transactions, 'net');
  const summaryRows = groups.map((group) => `<tr><th scope="row">${escapeHtml(group.name)}</th><td class="number">${group.rows.length}</td><td class="number">${money(group.amount)}</td><td class="number">${money(group.fee)}</td><td class="number">${money(group.net)}</td></tr>`).join('');
  const details = groups.map((group, index) => `<section class="source"><h2>${index + 1}. ${escapeHtml(group.name)}</h2><p class="source-meta">${group.rows.length} รายการ · ${escapeHtml(group.archive)}</p><div class="table-wrap"><table class="transactions"><thead><tr><th>วันเวลารายการ</th><th>เลขที่รายการ / รหัสร้านค้า</th><th class="number">ยอดรายการ</th><th class="number">ค่าธรรมเนียม</th><th class="number">ยอดสุทธิ</th></tr></thead><tbody>${group.rows.map((row) => `<tr><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.reference)}<small>${escapeHtml(row.raw['Merchant ID'] || '')}</small></td><td class="number">${money(row.amount)}</td><td class="number">${money(row.fee)}</td><td class="number">${money(row.net)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">รวม ${group.rows.length} รายการ</th><td class="number">${money(group.amount)}</td><td class="number">${money(group.fee)}</td><td class="number">${money(group.net)}</td></tr></tfoot></table></div></section>`).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QR กรุงศรี ${escapeHtml(receipt.receipt_date)} ${escapeHtml(receipt.branch_name)}</title><style>
*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#202a32;background:#fff;margin:0;line-height:1.55;letter-spacing:0}main{max-width:1180px;margin:auto;padding:28px}header{border-bottom:2px solid #263a34;padding-bottom:18px}h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:0;overflow-wrap:anywhere}p{margin:4px 0;color:#515c65}.total{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:20px 0}.total div{border-left:3px solid #597469;padding-left:12px}.total span,.total strong{display:block}.total span{font-size:13px}.total strong{font-size:25px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px 12px;border-bottom:1px solid #dce1e4;text-align:left;vertical-align:top}th{font-weight:600}thead{background:#f2f5f4}tfoot{background:#f2f5f4;font-weight:700}.number{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tbody th{overflow-wrap:anywhere}td small{display:block;color:#68727a;font-size:12px}.source{margin-top:28px}.source-meta{font-size:12px;margin:4px 0 10px;overflow-wrap:anywhere}.formula{font-variant-numeric:tabular-nums;font-size:14px;margin:12px 0}.note{font-size:12px;border-top:1px solid #dce1e4;padding-top:16px;margin-top:24px}.transactions{min-width:620px}@media(max-width:640px){main{padding:16px}.total{grid-template-columns:1fr}.summary{min-width:570px}}@media print{@page{size:A4;margin:12mm}main{max-width:none;padding:0}.table-wrap{overflow:visible}.summary,.transactions{min-width:0}table{font-size:10px}th,td{padding:6px}tr{break-inside:avoid}thead{display:table-header-group}.total strong{font-size:21px}.source h2{break-after:avoid}body{color:#000}}
</style></head><body><main><header><h1>QR กรุงศรี · หลักฐานรวม</h1><p>${escapeHtml(receipt.branch_name)} · ${escapeHtml(receipt.receipt_date)}</p><p>เอกสารรับเงิน #${escapeHtml(receipt.receipt_id)} · ${groups.length} ไฟล์ · ${transactions.length} รายการ</p></header><section class="total" aria-label="ยอดรวมหลักฐาน"><div><span>ยอดรายการรวม (ก่อนค่าธรรมเนียม)</span><strong>${money(total)} บาท</strong></div><div><span>ค่าธรรมเนียมตามรายงาน</span><strong>${money(fee)}${fee === null ? '' : ' บาท'}</strong></div><div><span>ยอดสุทธิตามรายงาน</span><strong>${money(net)}${net === null ? '' : ' บาท'}</strong></div></section><div class="table-wrap"><table class="summary" aria-label="สรุปทุกไฟล์"><thead><tr><th>ไฟล์ต้นทาง</th><th class="number">รายการ</th><th class="number">ยอดรายการ</th><th class="number">ค่าธรรมเนียม</th><th class="number">ยอดสุทธิ</th></tr></thead><tbody>${summaryRows}</tbody><tfoot><tr><th>รวมทั้งหมด</th><td class="number">${transactions.length}</td><td class="number">${money(total)}</td><td class="number">${money(fee)}</td><td class="number">${money(net)}</td></tr></tfoot></table></div><p class="formula">${groups.map((group) => money(group.amount)).join(' + ')} = ${money(total)} บาท</p>${details}<p class="note">สรุปจากรายการรายงาน Krungsri Biz Mung-Mee ที่ผูกกับเอกสารรับเงินนี้ ไม่รวมไฟล์ SUMMARY ที่เป็นยอดซ้ำ ไฟล์ต้นทางยังเก็บอยู่ในระบบ เครื่องหมาย - หมายถึงรายงานไม่ได้ระบุค่า ยอดสุทธิในรายงานยังไม่ใช่การยืนยันจาก statement บัญชีธนาคาร</p></main></body></html>`;
  return {
    fileName: `QR กรุงศรี - รวมหลักฐาน-${receipt.receipt_date}-${receipt.line_id}.html`,
    fileData: Buffer.from(html, 'utf8'), mimeType: 'text/html; charset=utf-8',
    total, fee, net, rowCount: transactions.length, fileCount: groups.length,
    sourceTransactionIds: transactions.map((row) => row.statement_transaction_id)
  };
};

// Call inside the caller's transaction; only the evidence link and BLOB change.
export const refreshKrungsriCombinedEvidence = async (connection, { receiptLineId, uploadRoot }) => {
  const [receipts] = await connection.query(
    `SELECT dr.id AS receipt_id, dr.receipt_date, b.name AS branch_name, drl.id AS line_id,
            rlr.evidence_attachment_id
     FROM daily_receipt_lines drl JOIN daily_receipts dr ON dr.id = drl.receipt_id
     JOIN branches b ON b.id = dr.branch_id JOIN payment_channels pc ON pc.id = drl.payment_channel_id
     JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id = drl.id
     WHERE drl.id = ? AND pc.code = 'QR_KRUNGSRI' FOR UPDATE`, [receiptLineId]
  );
  const receipt = receipts[0];
  if (!receipt) return null;
  // The legacy importer prefixes a SHA-256 hash before storing it in CHAR(64).
  // Match that persisted truncated key without rewriting financial transactions.
  const [rows] = await connection.query(
    `SELECT st.id AS statement_transaction_id, st.receipt_line_id, st.transaction_date, bit.amount,
            st.reference_no, bit.raw_payload, bit.source_file_name, bi.id AS inbox_import_id,
            bi.original_name AS archive_name
     FROM statement_transactions st
     JOIN bank_inbox_transactions bit ON st.unique_hash = LEFT(CONCAT('inbox-', bit.inbox_import_id, '-', bit.unique_hash), 64)
     JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
     WHERE st.receipt_line_id = ? AND st.receipt_id = ? AND st.transaction_date = ?
       AND bit.receipt_line_id = st.receipt_line_id AND bit.transaction_date = st.transaction_date
       AND bi.provider = 'KRUNGSRIBIZ_MUNGMEE'
       AND st.match_status IN ('classified', 'matched_auto', 'matched_manual')
     ORDER BY bi.id, bit.source_file_name, st.id`,
    [receiptLineId, receipt.receipt_id, receipt.receipt_date]
  );
  const document = createKrungsriCombinedEvidence({ receipt, rows });
  if (!document) return null;
  const [existing] = await connection.query(
    'SELECT id, file_data, document_data FROM attachments WHERE receipt_id = ? AND original_name = ? ORDER BY id LIMIT 1',
    [receipt.receipt_id, document.fileName]
  );
  const prior = existing[0];
  const sameContent = prior && Buffer.from(prior.file_data || '').equals(document.fileData)
    && Buffer.from(prior.document_data || '').equals(document.fileData);
  let attachmentId = prior?.id;
  if (!sameContent) {
    const storedPath = path.join(uploadRoot, '.evidence', `${crypto.createHash('sha256').update(document.fileName).digest('hex')}.html`);
    const values = [storedPath, storedPath, document.mimeType, document.mimeType,
      document.fileData.length, document.fileData.length, document.fileData, document.fileData];
    if (prior) {
      await connection.query(
        `UPDATE attachments SET stored_path = ?, document_path = ?, mime_type = ?, document_mime_type = ?,
         size_bytes = ?, document_size_bytes = ?, file_data = ?, document_data = ?, document_status = 'ready', document_error = NULL WHERE id = ?`,
        [...values, attachmentId]
      );
    } else {
      const [insert] = await connection.query(
        `INSERT INTO attachments (receipt_id, original_name, attachment_type, stored_path, document_path, mime_type,
         document_mime_type, size_bytes, document_size_bytes, file_data, document_data, document_status)
         VALUES (?, ?, 'statement', ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
        [receipt.receipt_id, document.fileName, ...values]
      );
      attachmentId = insert.insertId;
    }
  }
  const linkChanged = Number(receipt.evidence_attachment_id) !== Number(attachmentId);
  if (linkChanged) await connection.query(
    'UPDATE receipt_line_reconciliations SET evidence_attachment_id = ? WHERE receipt_line_id = ?',
    [attachmentId, receiptLineId]
  );
  if (!sameContent || linkChanged) await logAudit({
    connection, entityType: 'daily_receipt', entityId: receipt.receipt_id, action: 'combine_krungsri_evidence',
    beforePayload: { evidence_attachment_id: receipt.evidence_attachment_id },
    afterPayload: { receipt_line_id: receiptLineId, evidence_attachment_id: attachmentId,
      source_statement_transaction_ids: document.sourceTransactionIds,
      file_count: document.fileCount, row_count: document.rowCount, report_total: document.total,
      report_fee: document.fee, report_net: document.net },
    note: 'รวมหลักฐานกรุงศรี โดยไม่เปลี่ยนยอดเงินหรือสถานะเอกสาร'
  });
  return { attachmentId, changed: !sameContent || linkChanged, total: document.total,
    fee: document.fee, net: document.net, rowCount: document.rowCount, fileCount: document.fileCount };
};

export const repairKrungsriCombinedEvidence = async (pool, uploadRoot) => {
  const connection = await pool.getConnection();
  const result = { updated: 0, unchanged: 0, failed: 0 };
  try {
    const [lines] = await connection.query(
      `SELECT DISTINCT bit.receipt_line_id
       FROM bank_inbox_transactions bit JOIN bank_inbox_imports bi ON bi.id = bit.inbox_import_id
       JOIN daily_receipt_lines drl ON drl.id = bit.receipt_line_id
       JOIN payment_channels pc ON pc.id = drl.payment_channel_id
       WHERE bi.provider = 'KRUNGSRIBIZ_MUNGMEE' AND pc.code = 'QR_KRUNGSRI'
       ORDER BY bit.receipt_line_id`
    );
    for (const line of lines) {
      try {
        await connection.beginTransaction();
        const evidence = await refreshKrungsriCombinedEvidence(connection, {
          receiptLineId: line.receipt_line_id, uploadRoot
        });
        await connection.commit();
        result[evidence?.changed ? 'updated' : 'unchanged'] += 1;
      } catch (error) {
        await connection.rollback();
        result.failed += 1;
        console.error('Unable to combine Krungsri evidence', line.receipt_line_id, error.message);
      }
    }
    return result;
  } finally {
    connection.release();
  }
};
