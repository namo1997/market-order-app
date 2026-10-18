import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { receivingDocumentsAPI as api } from '../../../api/receiving-documents';
import { ledgerNumber, ledgerDate, statusLabels, relatedFollowups } from './receiving-ledger';
const actions = { create: 'สร้างใบรับ', upload_image: 'เพิ่มรูปบิล', ocr: 'อ่านบิลด้วย AI', update: 'แก้ไขใบรับ', sign: 'ลงลายเซ็น', confirm: 'ยืนยันรับสินค้า', void: 'ยกเลิกใบรับ' };
function ProtectedImage({ documentId, image, signature, alt }) {
  const [state, setState] = useState({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, url;
    setState({});
    const request = signature ? api.signatureImage(documentId, signature) : api.image(documentId, image.id);
    request.then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob); setState({ url });
    }).catch(() => { if (active) setState({ error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [documentId, image?.id, signature, retry]);
  return state.url ? <a href={state.url} target="_blank" rel="noreferrer" aria-label={`เปิด${alt}ขนาดเต็ม`}><img src={state.url} alt={alt} className={signature ? 'ra-signature' : 'ra-bill'} /></a>
    : state.error ? <p role="alert">โหลด{alt}ไม่สำเร็จ <button onClick={() => setRetry(value => value + 1)}>ลองโหลดรูปใหม่</button></p> : <p role="status">กำลังโหลด{alt}…</p>;
}
export function ReceivingDocumentView({ doc, followups, followupError }) {
  const related = relatedFollowups(doc, followups?.items);
  return <>
    <Link to="/admin/receiving">← กลับทะเบียนใบรับสินค้า</Link>
    <div className="ra-document-heading"><div><h2>ใบรับสินค้า #{doc.id}</h2><p>{doc.supplier_name_text || 'ไม่ระบุร้าน'} · {doc.doc_ref || 'ไม่ระบุเลขบิล'}</p></div><span className={`ra-status ra-${doc.status}`}>{statusLabels[doc.status]}</span></div>
    {doc.blind && <p role="status">รอนับของจริงครบทั้งใบ จึงเปิดตัวเลขบิล รูป และลายเซ็นได้</p>}
    <dl className="ra-document-meta"><div><dt>วันที่รับ</dt><dd>{ledgerDate(doc.delivery_date)}</dd></div><div><dt>สาขา</dt><dd>{doc.branch_name}</dd></div><div><dt>ขอบเขต</dt><dd>{doc.scope === 'branch' ? 'ทั้งสาขา' : doc.department_name}</dd></div><div><dt>ผู้รับ</dt><dd>{doc.receiver_name || '—'}</dd></div></dl>
    <div className="ra-detail-grid"><section className="ra-panel"><h3>รายการรับสินค้า</h3><p className="ra-note">นับได้คือจำนวนที่บันทึกจากการตรวจนับ · “—” หมายถึงไม่มีข้อมูล · จำนวนสั่งอ้างอิงใบสั่งที่ผูกไว้ในปัจจุบัน</p>
      <div className="ra-table-scroll" tabIndex={0} aria-label="รายการรับสินค้า เลื่อนซ้ายขวาได้"><table><caption>จำนวนและยอดเงินตามใบรับ</caption><thead><tr><th>รายการ / แผนก</th><th>หน่วย</th><th className="ra-number">นับได้</th><th className="ra-number">รับ</th><th className="ra-number">บิล</th><th className="ra-number">สั่ง</th><th className="ra-number">ราคา (บาท)</th><th className="ra-number">ยอด (บาท)</th></tr></thead><tbody>
        {doc.lines.map(line => <tr key={line.id}><td>{line.product_name || <span className="receiving-bill-text">{line.bill_text || 'ไม่ระบุสินค้า'}</span>}{line.product_name && line.bill_text && <small className="receiving-bill-text">ในบิล: {line.bill_text}</small>}<small>{line.department_name}</small></td><td>{line.unit_text || '—'}</td><td className="ra-number">{ledgerNumber(line.counted_quantity)}</td><td className="ra-number">{ledgerNumber(line.quantity_received)}</td><td className="ra-number">{ledgerNumber(line.quantity_billed)}</td><td className="ra-number">{ledgerNumber(line.quantity_ordered)}</td><td className="ra-number">{ledgerNumber(line.unit_price)}</td><td className="ra-number">{ledgerNumber(line.amount)}</td></tr>)}
        {!doc.lines.length && <tr><td colSpan={8}>ยังไม่มีรายการ</td></tr>}
      </tbody></table></div>
      <dl className="ra-totals">{[['ยอดก่อนส่วนลด', doc.subtotal], ['ส่วนลด', doc.discount], ['ภาษีมูลค่าเพิ่ม', doc.vat], ['ยอดรวม', doc.total]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{ledgerNumber(value, ' บาท')}</dd></div>)}</dl>
      {doc.void_reason && <p className="ra-problem">เหตุผลยกเลิก: {doc.void_reason}</p>}
      <h3>ลายเซ็น</h3><div className="ra-signatures">{['receiver', 'courier'].map(role => <div key={role}><h4>{role === 'receiver' ? 'ผู้รับสินค้า' : 'ผู้ส่งสินค้า'}</h4><p>{role === 'receiver' ? doc.receiver_name : doc.courier_name || '—'}</p>{doc.blind ? <p>รอนับของครบก่อนเปิดลายเซ็น</p> : doc[`has_${role}_signature`] ? <ProtectedImage documentId={doc.id} signature={role} alt={role === 'receiver' ? 'ลายเซ็นผู้รับ' : 'ลายเซ็นผู้ส่ง'} /> : <p>ยังไม่มีลายเซ็น</p>}</div>)}</div>
      <h3>ประวัติเอกสาร</h3><ol className="ra-audits">{doc.audits.map(audit => <li key={audit.id}><strong>{actions[audit.action] || 'กิจกรรมเอกสาร'}</strong> · {audit.actor_name || 'ระบบ'}<small>{ledgerDate(audit.created_at, true)}</small></li>)}</ol>{!doc.audits.length && <p>ยังไม่มีประวัติที่บันทึกไว้</p>}
      <h3>เรื่องตามของที่เกี่ยวข้อง</h3>{followupError ? <p role="alert">โหลดเรื่องตามของไม่สำเร็จ <Link to="/admin/receiving/issues">เปิดปัญหารับของ</Link></p> : !followups ? <p role="status">กำลังโหลดเรื่องตามของ…</p> : <>{related.map(item => <p key={item.id}><Link to={`/admin/receiving/issues?followup_id=${item.id}`}>เรื่อง #{item.id} · {item.supplier_name}</Link></p>)}<p className="ra-note">เชื่อมโยงจากรายการสั่งเดียวกันในเรื่องที่ยังค้างและอยู่ในสิทธิ์ของผู้ใช้ (แสดงได้สูงสุด 200 เรื่องล่าสุด)</p>{!related.length && <p>ไม่พบเรื่องค้างที่อ้างอิงรายการสั่งเดียวกัน</p>}</>}
    </section><aside className="ra-panel"><h3>รูปบิล · {doc.images.length} หน้า</h3>{doc.blind ? <p>รอนับของครบก่อนเปิดรูปบิล</p> : doc.images.map(image => <figure key={image.id}><ProtectedImage documentId={doc.id} image={image} alt={`บิลหน้า ${image.page_no}`} /><figcaption>หน้า {image.page_no} · กดรูปเพื่อดูขนาดเต็ม</figcaption></figure>)}{!doc.images.length && <p>ยังไม่มีรูปบิล</p>}</aside></div>
  </>;
}
