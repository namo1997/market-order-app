import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import AdmZip from 'adm-zip';
import { config } from '../src/config.js';
import { refreshKrungsriCombinedEvidence } from '../src/krungsriEvidence.js';

// Run explicitly against the isolated local preview database and API, not in the unit test suite.
const base = 'http://127.0.0.1:8100/api';
const db = await mysql.createConnection({ host: '127.0.0.1', port: 3317,
  user: 'cashflow_preview', password: 'cashflow-preview', database: 'general_cashflow_preview', dateStrings: true });
const marker = `EVIDENCE_${crypto.randomBytes(4).toString('hex')}`;
const date = '2026-08-08';
let branchId;
let importId;
try {
  assert.ok(config.gmailInboxToken, 'Set a local Gmail import token before running the preview');
  const [channels] = await db.query("SELECT id FROM payment_channels WHERE code='QR_KRUNGSRI'");
  const channelId = channels[0].id;
  const [branch] = await db.query('INSERT INTO branches (code,name,clickhouse_branch_id) VALUES (?,?,?)',
    [marker, `ทดสอบหลักฐานกรุงศรี ${marker} (ข้อมูลจำลอง)`, marker]);
  branchId = branch.insertId;
  await db.query('INSERT INTO bank_merchant_mappings (provider,merchant_id,branch_id,payment_channel_id) VALUES (?,?,?,?)',
    ['KRUNGSRIBIZ_MUNGMEE', marker, branchId, channelId]);
  const [receipt] = await db.query("INSERT INTO daily_receipts (branch_id,receipt_date,status,gross_sales_expected,bill_count) VALUES (?,?,'SUBMITTED',11308,8)", [branchId, date]);
  const receiptId = receipt.insertId;
  const [line] = await db.query('INSERT INTO daily_receipt_lines (receipt_id,payment_channel_id,cashier_amount) VALUES (?,?,11308)', [receiptId, channelId]);
  const lineId = line.insertId;
  await db.query('INSERT INTO receipt_line_reconciliations (receipt_line_id) VALUES (?)', [lineId]);
  const zip = new AdmZip();
  const header = 'Merchant ID|Transaction ID|Transaction amount|Service Fee|Net Transaction amount|QR type|Transaction paid time';
  const csvRow = (id, amount, fee = 0) => `${marker}|${marker}-${id}|${amount}|${fee}|${(amount - fee).toFixed(2)}|Static|${date} 19:29:40`;
  zip.addFile('ALIPAY_20260808.csv', Buffer.from([header, csvRow(1,939,16.9),csvRow(2,1081,19.46)].join('\n')));
  zip.addFile('PROMPTPAY_20260808.csv', Buffer.from([header,...[1000,2000,3000,1000,1000,1288].map((amount,index)=>csvRow(index+3,amount))].join('\n')));
  zip.addFile('SUMMARY_20260808.csv', Buffer.from('PAYMENT CHANNEL|TOTAL NBR|TOTAL TRANSACTION AMOUNT\nALL|8|11308'));
  const archive = zip.toBuffer();
  const upload = async () => {
    const form = new FormData();
    form.append('message_id', marker);
    form.append('source_date', date);
    form.append('file', new Blob([archive], {type:'application/zip'}), `${marker}.zip`);
    const response = await fetch(`${base}/inbox-imports/krungsri`, {method:'POST',headers:{Authorization:`Bearer ${config.gmailInboxToken}`},body:form});
    const body = await response.json();
    assert.ok(response.ok, JSON.stringify(body));
    return body;
  };
  const first = await upload();
  importId = first.data.id;
  const [linked] = await db.query('SELECT drl.statement_amount,rlr.evidence_attachment_id,a.original_name,a.document_data FROM daily_receipt_lines drl JOIN receipt_line_reconciliations rlr ON rlr.receipt_line_id=drl.id JOIN attachments a ON a.id=rlr.evidence_attachment_id WHERE drl.id=?',[lineId]);
  assert.equal(Number(linked[0].statement_amount),11308);
  assert.match(linked[0].original_name,/รวมหลักฐาน/);
  assert.match(linked[0].document_data.toString(),/2,020\.00 \+ 9,288\.00 = 11,308\.00 บาท/);
  assert.match(linked[0].document_data.toString(),/11,271\.64 บาท/);
  assert.equal((await upload()).duplicate,true);
  const [originals] = await db.query("SELECT id FROM attachments WHERE receipt_id=? AND original_name LIKE 'QR กรุงศรี - %.csv'",[receiptId]);
  assert.equal(originals.length,2);
  await db.query("UPDATE daily_receipts SET status='CLOSED',closed_at=NOW() WHERE id=?",[receiptId]);
  await db.query('UPDATE receipt_line_reconciliations SET evidence_attachment_id=? WHERE receipt_line_id=?',[originals[0].id,lineId]);
  const state = async () => {
    const [receipts] = await db.query('SELECT * FROM daily_receipts WHERE id=?',[receiptId]);
    const [lines] = await db.query('SELECT * FROM daily_receipt_lines WHERE id=?',[lineId]);
    const [reconciliations] = await db.query('SELECT * FROM receipt_line_reconciliations WHERE receipt_line_id=?',[lineId]);
    const { evidence_attachment_id, updated_at, ...financial } = reconciliations[0];
    return {receipts,lines,financial};
  };
  const before = await state();
  await db.beginTransaction();
  const repaired = await refreshKrungsriCombinedEvidence(db,{receiptLineId:lineId,uploadRoot:'/nonexistent-preview-upload-root'});
  assert.equal(repaired.attachmentId,linked[0].evidence_attachment_id);
  assert.equal(repaired.changed,true);
  const again = await refreshKrungsriCombinedEvidence(db,{receiptLineId:lineId,uploadRoot:'/nonexistent-preview-upload-root'});
  assert.equal(again.changed,false);
  assert.deepEqual(await state(),before);
  await db.commit();
  const login = await (await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'recorder',password:'recorder123'})})).json();
  const file = await fetch(`${base}/attachments/${repaired.attachmentId}/file?variant=document`,{headers:{Authorization:`Bearer ${login.data.token}`}});
  assert.equal(file.status,200);
  assert.match(file.headers.get('content-type'),/text\/html/);
  assert.match(await file.text(),/11,308\.00 บาท/);
  const [logs] = await db.query("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='daily_receipt' AND entity_id=? AND action='combine_krungsri_evidence'",[receiptId]);
  assert.equal(logs[0].count,2);
  console.log(JSON.stringify({result:'PASS',branchId,branchName:`ทดสอบหลักฐานกรุงศรี ${marker} (ข้อมูลจำลอง)`,receiptId,lineId,...repaired}));
} finally {
  await db.rollback();
  if (!process.argv.includes('--keep-preview-fixture')) {
    if (branchId) {
      await db.query('DELETE FROM daily_receipts WHERE branch_id=?',[branchId]);
      await db.query('DELETE FROM branches WHERE id=?',[branchId]);
    }
    if (importId) await db.query('DELETE FROM bank_inbox_imports WHERE id=?',[importId]);
  }
  await db.end();
}
