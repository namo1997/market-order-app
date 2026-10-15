import { useEffect, useRef, useState } from 'react';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { compressImage, MAX_PAGES, MAX_TOTAL_BYTES } from './image-utils';
import { errorText } from './receiving-utils';
import { Icon, EmptyState, StatusPill } from '../../design';

import { ReceivingIllustration } from './ReceivingIllustration';

function SavedImage({ documentId, page }) {
  const [state, setState] = useState({ url: '', error: false });
  useEffect(() => {
    let active = true;
    let url;
    api.image(documentId, page.id).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setState({ url, error: false });
    }).catch(() => { if (active) setState({ url: '', error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [documentId, page.id]);
  return <div className="rc-photo">
    {state.url ? <a href={state.url} target="_blank" rel="noreferrer" aria-label={`เปิดรูปหน้า ${page.page_no}`}><img src={state.url} alt={`บิลหน้า ${page.page_no}`} /></a>
      : <p role="status">{state.error ? 'โหลดรูปไม่สำเร็จ' : 'กำลังโหลดรูป…'}</p>}
    <span>หน้า {page.page_no}</span>
  </div>;
}

export function ImagePages({ doc, pending, setPending, busy, setProcessing, renderActions, inputRef, showHint = true }) {
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
  return <>
    <section className="rc-stack">
      <div className="rc-section-heading"><h2>รูปบิล</h2><span className="rc-muted">{doc.images.length + pending.length}/10 หน้า</span></div>
      <input ref={inputRef} className="rc-file" type="file" tabIndex={-1} aria-label="รูปบิล" accept="image/*" capture="environment" multiple disabled={busy || processing || !draft} onChange={select} />
      {showHint && !error && !doc.images.length && !pending.length && (draft ? <ReceivingIllustration state="capture-bill" eager /> : <EmptyState title="ไม่มีรูปบิล" icon="receipt" />)}
      <div className="rc-photos">
        {doc.images.map((page) => <SavedImage key={page.id} documentId={doc.id} page={page} />)}
        {pending.map((page, index) => <div key={page.key} className="rc-photo">
          <img src={page.dataUrl} alt={`รูปที่เลือก ${index + 1}`} />
          <span>{page.pageNo ? `หน้า ${page.pageNo}` : `รูปใหม่ ${index + 1}`}</span>
          <StatusPill status="review">{page.state === 'failed' ? 'ส่งซ้ำ' : 'รอส่ง'}</StatusPill>
          <label className="rc-photo-edit"><Icon name="edit" /><span className="rc-sr-only">จัดรูป {index + 1}</span>
            <select value="" disabled={busy || processing || !!page.pageNo} onChange={(event) => {
              const action = event.target.value;
              if (action === 'delete') setPending((current) => current.filter((item) => item.key !== page.key));
              if (action === 'up') move(index, -1);
              if (action === 'down') move(index, 1);
            }}><option value="">จัดรูป</option><option value="up" disabled={index === 0 || !!pending[index - 1]?.pageNo}>เลื่อนก่อน</option>
              <option value="down" disabled={index === pending.length - 1 || !!pending[index + 1]?.pageNo}>เลื่อนหลัง</option><option value="delete">ลบรูป</option></select>
          </label>
        </div>)}
      </div>
      {error && <ReceivingIllustration state="error" description={error} compact />}
    </section>
    {renderActions?.({ choose: () => inputRef.current.click(), processing })}
  </>;
}
