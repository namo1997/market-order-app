import { useEffect, useState } from 'react';
import { formatApDate, formatApReference } from './apLedgerUi.js';
export const RECEIVING_LABELS = { LINKED: 'ตรงกับ LBC', REVIEW: 'รอตรวจ', NO_LBC: 'ไม่มีใน LBC', VOID: 'ยกเลิก / ปลดลิงก์', REFERENCE: 'ใบวางบิลอ้างอิง' };
const defaultRequest = async (path, options) => (await import('./api.js')).request(path, options);
const amount = satang => satang == null ? 'ยังไม่ทราบ' : `${new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100)} บาท`;
export function ReceivingRows({ documents = [] }) {
  return <ul className="ap-receiving-list">{documents.map(doc => <li key={doc.documentId}>
    <div className="ap-supplier-heading"><strong>{doc.supplierName}</strong><span className="ap-reference">ใบรับของ #{doc.documentId}</span></div>
    <p>{doc.branch} / {doc.docRef || 'ยังไม่มีเลขบิล'} / วันบิล {formatApDate(doc.docDate)}</p>
    <p className="ap-pending">{RECEIVING_LABELS[doc.matchStatus] || 'รอตรวจ'}{doc.reviewRequired && doc.matchStatus === 'LINKED' ? ' · มีประเด็นรอตรวจ' : ''}</p>
    <p>มูลค่ารับของ {amount(doc.amountSatang)} / ยอดบิล {amount(doc.billTotalSatang)}</p>
    <details><summary>รายละเอียดใบรับของ #{doc.documentId}</summary><p>{doc.reason}</p><p>วันรับ {formatApDate(doc.receiptDate)} / กำหนดจ่ายตามรอบ {doc.dueDate ? formatApDate(doc.dueDate) : 'ไม่ใช้กับใบวางบิล'}</p><p>{doc.periodStatus}</p>{doc.linkedSourceKey && <p>ผูกกับ {formatApReference(doc.linkedSourceKey)}</p>}</details>
    {doc.sourceUrl && <a className="ap-receiving-link" href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">เปิดเอกสารรับของ #{doc.documentId}</a>}
  </li>)}{!documents.length && <li className="ap-empty">ยังไม่มีใบรับของในเดือนและสาขาที่เลือก</li>}</ul>;
}
export default function ApReceiving({ month, branch, preview = false, request = defaultRequest }) {
  const [data, setData] = useState(null), [status, setStatus] = useState('loading'), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0), [message, setMessage] = useState(''), [page, setPage] = useState(0);
  useEffect(() => {
    let current = true;
    setData(null); setStatus('loading'); setPage(0);
    if (preview) { setStatus('preview'); return () => { current = false; }; }
    request(`/ap/receiving/documents?${new URLSearchParams({ month, branch })}`).then(result => { if (current) { setData(result); setStatus('ready'); } }).catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [month, branch, preview, request, retry]);
  const sync = async () => {
    setBusy(true); setMessage('กำลังดึงใบรับของ…');
    try {
      const result = await request('/ap/receiving/sync', { method: 'POST', body: JSON.stringify({}) });
      setMessage(`ดึงสำเร็จ อ่าน ${result.seen} ใบ ปรับปรุง ${result.changed} ใบ`);
      setRetry(n => n + 1);
    } catch (error) {
      setMessage(error?.code === 'RECEIVING_SYNC_RUNNING' ? 'กำลังดึงข้อมูลอยู่ กรุณาลองใหม่ภายหลัง' : 'ดึงใบรับของไม่สำเร็จ ลองใหม่ได้ ข้อมูลบัญชีเดิมยังอยู่');
    } finally { setBusy(false); }
  };
  return <section className="ap-panel ap-receiving" aria-labelledby="ap-receiving-heading">
    <div className="ap-panel-title"><div><h2 id="ap-receiving-heading">หลักฐานซื้อ · ใบรับของ</h2><p>ตรวจเทียบสมุดรับจ่ายก่อนลงบัญชี ไม่สร้างยอดจ่ายเงิน</p></div><button className="ap-receiving-sync" disabled={preview || status !== 'ready' || !data?.configured || !data?.schemaReady || busy} onClick={sync}>{busy ? 'กำลังดึง…' : 'ดึงใบรับของ'}</button></div>
    <p role="status" aria-live="polite">{message || (status === 'loading' ? 'กำลังอ่านใบรับของ…' : status === 'preview' ? 'ตัวอย่างอ่านอย่างเดียว ปิดการดึงใบรับของ' : status === 'error' ? 'อ่านใบรับของไม่ได้' : !data?.configured ? 'ปิดการดึงใบรับของ: ยังไม่ได้ตั้งค่าการเชื่อมต่อ' : !data?.schemaReady ? 'ยังไม่ได้เตรียมตารางใบรับของ' : 'แสดงตามวันรับของ เดือนบัญชียังรอตรวจ')}</p>
    {status === 'error' && <button className="ap-receiving-sync" onClick={() => setRetry(n => n + 1)}>ลองอ่านใหม่</button>}
    {data?.latestRun?.status === 'FAILED' && <p className="ap-pending">การดึงครั้งล่าสุดไม่สำเร็จ แสดงหลักฐานจากครั้งที่บันทึกสำเร็จ</p>}
    {status === 'ready' && data.schemaReady && <details className="ap-details"><summary>ใบรับของในเดือนที่เลือก {data.documents.length} ใบ</summary><ReceivingRows documents={data.documents.slice(page * 25, page * 25 + 25)}/>{data.documents.length > 25 && <div className="ap-pagination"><span>หน้า {page + 1} / {Math.ceil(data.documents.length / 25)}</span><button className="ap-receiving-sync" disabled={!page} onClick={() => setPage(n => n - 1)}>ก่อนหน้า</button><button className="ap-receiving-sync" disabled={(page + 1) * 25 >= data.documents.length} onClick={() => setPage(n => n + 1)}>ถัดไป</button></div>}</details>}
  </section>;
}
