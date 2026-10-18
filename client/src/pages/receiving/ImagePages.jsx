import { useEffect, useRef, useState } from 'react';
import { captureImage } from './image-capture';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';
import { compressImage, MAX_PAGES, MAX_TOTAL_BYTES } from './image-utils';
import { errorText } from './receiving-utils';
import { QUALITY_MESSAGES } from './image-quality';
import './image-quality.css';
import { Icon, EmptyState, StatusPill, PrimaryAction, Sheet } from '../../design';

import { BillViewer } from './BillViewer';
import { ReceivingIllustration } from './ReceivingIllustration';

function SavedImage({ documentId, page, onOpen }) {
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
    {state.url ? <button type="button" className="rc-image-open rc-text-action" aria-label={`เปิดรูปหน้า ${page.page_no}`} onClick={onOpen}><img src={state.url} alt={`บิลหน้า ${page.page_no}`} /></button>
      : <p role="status">{state.error ? 'โหลดรูปไม่สำเร็จ' : 'กำลังโหลดรูป…'}</p>}
    <span>หน้า {page.page_no}</span>
  </div>;
}

function OriginalPreview({ page, alt }) {
  const image = useRef(null);
  useEffect(() => {
    if (!(page.originalBlob instanceof Blob)) return;
    const next = URL.createObjectURL(page.originalBlob);
    image.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [page.originalBlob]);
  return <img ref={image} src={page.dataUrl} alt={alt} />;
}
function QualityBadge({ quality }) {
  return <StatusPill status={quality?.warnings.length ? 'review' : quality ? 'ok' : 'review'}>
    {quality?.warnings.length ? '⚠ ไม่ชัด' : quality ? '✓ ชัด' : 'ยังไม่ตรวจ'}
  </StatusPill>;
}

export function ImagePages({ doc, pending, setPending, busy, setProcessing, renderActions, inputRef, showHint = true, blind = false, showBlindHint = true }) {
  const [error, setError] = useState('');
  const [activePage, setActivePage] = useState(0);
  const [viewerPage, setViewerPage] = useState(null);
  const [processing, updateProcessing] = useState(false);
  const lock = useRef(false);
  const retakeInput = useRef(null);
  const replaceKey = useRef(null);
  const [reviewKey, setReviewKey] = useState('');
  // Local-only inspection survives the upload handoff while this view stays mounted.
  const qualityByPage = useRef(new Map());
  useEffect(() => { pending.forEach(page => { if (page.pageNo) qualityByPage.current.set(`${doc.id}:${page.pageNo}`, page.quality); }); }, [pending, doc.id]);
  const draft = doc.status === 'draft';
  const select = async (getFiles, replacing = null) => {
    if (lock.current || busy || !draft) return;
    lock.current = true; updateProcessing(true); setProcessing(true); setError('');
    try {
      const selected = await getFiles();
      const files = replacing ? selected.slice(0, 1) : selected;
      if (!files.length) return;
      if (files.length + pending.length + doc.images.length - (replacing ? 1 : 0) > MAX_PAGES) {
        throw new Error('เพิ่มได้ไม่เกิน 10 หน้าต่อเอกสาร');
      }
      const pages = [];
      for (const file of files) {
        // Scanner and fallback photos share quality inspection and conservative enhancement.
        const image = await compressImage(file);
        pages.push({ key: crypto.randomUUID(), ...image, name: file.name, state: 'ready' });
      }
      // รูปบน server ไม่มี size ใน contract จึงจำกัดเฉพาะชุดใหม่ และเตือนเมื่อ OCR ถึงเพดาน
      if ([...pending.filter(page => page.key !== replacing), ...pages].reduce((sum, page) => sum + page.blob.size, 0) > MAX_TOTAL_BYTES) {
        throw new Error('รูปชุดนี้รวมเกิน 15 MB กรุณาเลือกให้น้อยลงหรือถ่ายรูปใหม่');
      }
      setPending((current) => {
        if (!replacing) return [...current, ...pages];
        // Assigned page numbers may already have reached the server; never replace them.
        if (!current.some(page => page.key === replacing && !page.pageNo)) return current;
        return current.map(page => page.key === replacing ? pages[0] : page);
      });
      const firstWarning = pages.find(page => page.quality?.warnings.length);
      setReviewKey(firstWarning?.key || '');
      setActivePage(replacing ? Math.max(0, allPages.findIndex(page => page.pending?.key === replacing)) : doc.images.length + pending.length);
    } catch (failure) { setError(failure.response ? errorText(failure) : failure.message); }
    finally { replaceKey.current = null; lock.current = false; updateProcessing(false); setProcessing(false); }
  };
  const allPages = [...doc.images.map(page => ({ saved: page })), ...pending.map(page => ({ pending: page }))];
  const preview = allPages[Math.min(activePage, allPages.length - 1)];
  const reviewPage = pending.find(page => page.key === reviewKey);
  const warned = pending.filter(page => page.quality?.warnings.length);
  const savedWarned = doc.images.filter(page => !pending.some(item => item.pageNo === page.page_no) && qualityByPage.current.get(`${doc.id}:${page.page_no}`)?.warnings.length).length;
  const accept = () => {
    setPending(current => current.map(page => page.key === reviewKey ? { ...page, qualityAccepted: true } : page));
    setReviewKey(warned.find(page => page.key !== reviewKey && !page.qualityAccepted)?.key || '');
  };
  const retake = () => {
    replaceKey.current = reviewKey;
    retakeInput.current.click();
  };
  const move = (index, delta) => setPending((current) => {
    const result = [...current];
    if (result[index].pageNo || result[index + delta]?.pageNo || !result[index + delta]) return current;
    [result[index], result[index + delta]] = [result[index + delta], result[index]];
    return result;
  });
  return <>
    <section className="rc-stack">
      {blind && showBlindHint && <p>ภาพบิลถูกปิดไว้จนกว่าจะนับครบ</p>}
      <div className="rc-section-heading"><h2>รูปบิล</h2><span className="rc-muted">{doc.images.length + pending.length}/10 หน้า</span></div>
      <input ref={inputRef} className="rc-file" type="file" tabIndex={-1} aria-label="รูปบิล" accept="image/*" capture="environment" multiple disabled={busy || processing || !draft} onClick={captureImage ? (event) => {
        event.preventDefault();
        select(async () => { const file = await captureImage(); return file ? [file] : []; });
      } : undefined} onChange={(event) => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        return select(async () => files);
      }} />
      {showHint && !error && !doc.images.length && !pending.length && (draft ? <ReceivingIllustration state="capture-bill" eager /> : <EmptyState title="ไม่มีรูปบิล" icon="receipt" />)}
      {!blind && preview && <div className="rc-bill-preview">{preview.saved ? <SavedImage documentId={doc.id} page={preview.saved} onOpen={() => setViewerPage(activePage)} /> : <button type="button" className="rc-image-open rc-text-action" aria-label={`เปิดรูปหน้า ${activePage + 1}`} onClick={() => setViewerPage(activePage)}><OriginalPreview key={preview.pending.key} page={preview.pending} alt={`บิลหน้าที่เลือก ${activePage + 1}`} /></button>}</div>}
      {!!(warned.length + savedWarned) && <p className="rc-quality-summary" role="status">⚠ มีคำเตือนภาพ {warned.length + savedWarned} หน้า — ถ่ายใหม่หรือใช้ภาพนี้เพื่ออ่านบิลต่อได้</p>}
      {!blind && preview?.pending && <div className="rc-quality-details">
        <QualityBadge quality={preview.pending.quality} />
        {preview.pending.quality?.warnings.map(code => <p key={code}>{QUALITY_MESSAGES[code]}</p>)}
        {!preview.pending.quality && <p>ตรวจคุณภาพไม่ได้ กรุณาดูความชัดด้วยตนเอง</p>}
        {preview.pending.enhanced && <small>แสดงต้นฉบับ · ปรับแสงอ่อนๆ ในภาพที่ส่งอ่าน</small>}
        {!!preview.pending.quality?.warnings.length && draft && !preview.pending.pageNo && <button type="button" className="rc-text-action" disabled={busy || processing}
          onClick={() => setReviewKey(preview.pending.key)}>ตรวจภาพหน้านี้</button>}
      </div>}
      {!!pending.length && <div className="rc-section-heading"><StatusPill status="review">รอส่ง {pending.length} หน้า</StatusPill></div>}
      {!blind && allPages.length > 0 && <div className="rc-photos">
        {doc.images.map((page, index) => <div key={page.id} className="rc-page-thumbnail" data-selected={activePage === index}><SavedImage documentId={doc.id} page={page} onOpen={() => setViewerPage(index)} /><QualityBadge quality={qualityByPage.current.get(`${doc.id}:${page.page_no}`)} /><button type="button" className="rc-text-action" onClick={() => setActivePage(index)}>ดูหน้า {page.page_no}</button></div>)}
        {pending.map((page, index) => <div key={page.key} className="rc-photo" data-selected={activePage === doc.images.length + index}>
          <img src={page.dataUrl} alt={`รูปที่เลือก ${index + 1}`} />
          <button type="button" className="rc-text-action" onClick={() => setActivePage(doc.images.length + index)}>{page.pageNo ? `หน้า ${page.pageNo}` : `รูปใหม่ ${index + 1}`}</button>
          <QualityBadge quality={page.quality} />
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
        {draft && <button type="button" className="rc-text-action rc-add-page" disabled={busy || processing || allPages.length >= MAX_PAGES} onClick={() => inputRef.current.click()}><Icon name="plus" />เพิ่มหน้า</button>}
      </div>}
      {error && <ReceivingIllustration state="error" description={error} compact />}
    </section>
    {!blind && viewerPage !== null && <BillViewer documentId={doc.id} pages={[...doc.images, ...pending]} initialPage={viewerPage} onClose={() => setViewerPage(null)} />}
    {renderActions?.({ choose: () => inputRef.current.click(), processing })}
    {!blind && reviewPage && <Sheet open title="ตรวจความชัดของภาพ" onDismiss={() => setReviewKey('')} className="rc-quality-sheet"
      actions={<><PrimaryAction icon="camera" disabled={busy || processing || !!reviewPage.pageNo} onClick={retake}>ถ่ายใหม่</PrimaryAction>
        <button type="button" className="rc-text-action" disabled={busy || processing} onClick={accept}>ใช้ภาพนี้</button></>}>
      <input ref={retakeInput} className="rc-file" type="file" tabIndex={-1} aria-label="ถ่ายบิลใหม่แทนหน้าเดิม" accept="image/*" capture="environment"
        disabled={busy || processing || !draft} onClick={captureImage ? event => {
          event.preventDefault();
          return select(async () => { const file = await captureImage(); return file ? [file] : []; }, replaceKey.current);
        } : undefined} onChange={event => {
          const files = Array.from(event.target.files || []); event.target.value = '';
          return select(async () => files, replaceKey.current);
        }} />
      <div className="rc-bill-preview"><OriginalPreview key={reviewPage.key} page={reviewPage} alt="ต้นฉบับภาพที่มีคำเตือน" /></div>
      <div role="status">{reviewPage.quality?.warnings.map(code => <p key={code}>{QUALITY_MESSAGES[code]}</p>)}</div>
      {error && <p role="alert">{error}</p>}
      <p className="rc-muted">ยังใช้ภาพนี้อ่านบิลได้ กรุณาตรวจตัวเลขหลังอ่าน</p>
    </Sheet>}
  </>;
}
