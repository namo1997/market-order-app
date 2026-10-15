import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { compressImage, MAX_PAGES, MAX_TOTAL_BYTES } from './image-utils';
import { errorText } from './receiving-utils';
import { ReceivingIcon } from './ReceivingIcon';

function SavedImage({ documentId, page }) {
  const [state, setState] = useState({ url: '', error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let url;
    api.image(documentId, page.id).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setState({ url, error: false });
    }).catch(() => { if (active) setState({ url: '', error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [documentId, page.id, attempt]);
  return <div className="rc-photo">
    {state.url ? <a href={state.url} target="_blank" rel="noreferrer" aria-label={`เปิดรูปหน้า ${page.page_no}`}><img src={state.url} alt={`บิลหน้า ${page.page_no}`} /></a>
      : <p role="status">{state.error ? 'โหลดรูปไม่สำเร็จ' : 'กำลังโหลดรูป…'}</p>}
    <span>หน้า {page.page_no} · ส่งแล้ว</span>
    {state.error && <button type="button" onClick={() => setAttempt(attempt + 1)}>โหลดรูปใหม่</button>}
  </div>;
}

export function ImagePages({ doc, pending, setPending, busy, onUpload, setProcessing }) {
  const [error, setError] = useState('');
  const [processing, updateProcessing] = useState(false);
  const lock = useRef(false);
  const draft = doc.status === 'draft';
  const select = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (lock.current || !files.length) return;
    if (files.length + pending.length + doc.images.length > MAX_PAGES) {
      setError('เพิ่มได้ไม่เกิน 10 หน้าต่อเอกสาร'); return;
    }
    lock.current = true; updateProcessing(true); setProcessing(true); setError('');
    try {
      const pages = [];
      for (const file of files) {
        const image = await compressImage(file);
        pages.push({ key: crypto.randomUUID(), ...image, name: file.name, state: 'ready' });
      }
      // รูปบน server ไม่มี size ใน contract จึงจำกัดเฉพาะชุดใหม่ และเตือนเมื่อ OCR ถึงเพดาน
      if ([...pending, ...pages].reduce((sum, page) => sum + page.blob.size, 0) > MAX_TOTAL_BYTES) {
        throw new Error('รูปชุดนี้รวมเกิน 15 MB กรุณาเลือกให้น้อยลงหรือถ่ายรูปใหม่');
      }
      setPending((current) => [...current, ...pages]);
    } catch (failure) { setError(failure.response ? errorText(failure) : failure.message); }
    finally { lock.current = false; updateProcessing(false); setProcessing(false); }
  };
  const move = (index, delta) => setPending((current) => {
    const result = [...current];
    if (result[index].pageNo || result[index + delta]?.pageNo || !result[index + delta]) return current;
    [result[index], result[index + delta]] = [result[index + delta], result[index]];
    return result;
  });
  return <section className="rc-panel">
    <div className="rc-section-heading"><h2><ReceivingIcon name="camera" />รูปบิล / หลักฐาน</h2><span>{doc.images.length + pending.length}/10 หน้า</span></div>
    {draft && <>
      <label className={`rc-upload ${busy || processing ? 'rc-disabled' : ''}`}>
        <ReceivingIcon name="camera" /><strong>{processing ? 'กำลังย่อรูป…' : 'ถ่ายรูปหรือเลือกรูปบิล'}</strong>
        <span>JPG, PNG, WebP · ย่อเหลือไม่เกิน 3 MB / หน้า</span>
        <input type="file" accept="image/*" capture="environment" multiple disabled={busy || processing} onChange={select} />
      </label>
      <p className="rc-muted">เรียงและลบหน้าก่อนส่งได้ หน้าที่เริ่มส่งแล้วจะล็อกไว้เพื่อลองซ้ำด้วยเลขหน้าเดิม รูปที่เลือกค้างอยู่ในหน้านี้เท่านั้น</p>
    </>}
    <div className="rc-photos">
      {doc.images.map((page) => <SavedImage key={page.id} documentId={doc.id} page={page} />)}
      {pending.map((page, index) => <div key={page.key} className="rc-photo">
        <img src={page.dataUrl} alt={`รูปที่เลือก ${index + 1}`} />
        <span>{page.pageNo ? `หน้า ${page.pageNo}` : `รูปใหม่ ${index + 1}`} · {page.state === 'failed' ? 'รอส่งซ้ำ' : 'รอส่ง'}</span>
        <div className="rc-photo-actions">
          <button type="button" disabled={busy || processing || !!page.pageNo || index === 0 || !!pending[index - 1]?.pageNo} onClick={() => move(index, -1)} aria-label={`เลื่อนรูป ${index + 1} ขึ้น`}>↑</button>
          <button type="button" disabled={busy || processing || !!page.pageNo || index === pending.length - 1} onClick={() => move(index, 1)} aria-label={`เลื่อนรูป ${index + 1} ลง`}>↓</button>
          <button type="button" disabled={busy || processing || !!page.pageNo} onClick={() => setPending((current) => current.filter((item) => item.key !== page.key))}>ลบ</button>
        </div>
      </div>)}
    </div>
    {error && <p className="rc-error" role="alert">{error}</p>}
    {draft && pending.length > 0 && <button type="button" className="rc-secondary rc-wide" disabled={busy || processing} onClick={onUpload}>ส่งรูปที่ค้าง {pending.length} หน้า / ลองใหม่</button>}
  </section>;
}
