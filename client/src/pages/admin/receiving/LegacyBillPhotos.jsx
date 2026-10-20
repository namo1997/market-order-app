import { useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../../api/receiving-documents';
export function LegacyBillPhotos() {
  const version = useRef(0);
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <details className="ra-legacy-photos"><summary>ดูรูปบิลเดิม</summary><p>รูปจากเมนูรับสินค้าเดิม · สาขาของบัญชีผู้ใช้ที่เข้าสู่ระบบ</p>
    <form onSubmit={async event => { event.preventDefault(); const requested = ++version.current; setBusy(true); setError(''); setPhotos(null); setSelected(null);
      try { const result = await api.legacyBillPhotos(date); if (requested === version.current) setPhotos(result); }
      catch { if (requested === version.current) setError('โหลดรูปบิลเดิมไม่สำเร็จ กรุณาลองใหม่'); }
      finally { if (requested === version.current) setBusy(false); }
    }}><label>วันที่รับสินค้า<input type="date" required value={date} onChange={event => { version.current++; setBusy(false); setError(''); setDate(event.target.value); setPhotos(null); }} /></label><button type="submit" disabled={busy || !date}>ดูรูปบิลเดิมตามวันที่</button></form>
    {busy && <p role="status">กำลังโหลดรูปบิลเดิม…</p>}{error && <p role="alert">{error}</p>}
    {photos?.length === 0 && <p>ไม่มีรูปบิลเดิมในวันที่เลือก</p>}
    {photos?.map(photo => <a key={photo.id} href={`#legacy-bill-${photo.id}`} onClick={() => setSelected(photo.id)}>ดูรูปบิลเดิม #{photo.id} · {photo.product_name || 'บิลรับสินค้า'}</a>)}
    {photos?.filter(photo => photo.id === selected).map(photo => <figure id={`legacy-bill-${photo.id}`} key={photo.id}><img src={photo.image_data_url} alt={`รูปบิลเดิม #${photo.id}`} /><figcaption>{photo.product_name || 'บิลรับสินค้าเดิม'}</figcaption></figure>)}
  </details>;
}
