import { useEffect, useRef, useState } from 'react';
import { GlassBar, PrimaryAction, IconButton, StatusPill } from '../../design';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

import { ReceivingIllustration } from './ReceivingIllustration';

export function SignaturePad({ label, saved, savedImage, documentId, role, readOnly = false, onSave, onInkChange, disabled = false, busy = false, backAction, moreAction, onReview, reviewLabel = 'ตรวจรับ', reviewFirst = false, inline = false, showActions = true, showHint = true }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [message, setMessage] = useState('');
  const [redrawing, setRedrawing] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [failedImage, setFailedImage] = useState('');
  const [remoteImage, setRemoteImage] = useState({});
  const showingSaved = saved && !redrawing;
  const requestKey = `${documentId}:${role}:${imageAttempt}`;
  const remote = remoteImage.key === requestKey ? remoteImage : {};
  const image = savedImage || remote.url;
  const imageKey = `${image}:${imageAttempt}`;
  useEffect(() => {
    if (!saved || savedImage) return;
    let active = true;
    let url;
    api.signatureImage(documentId, role).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setRemoteImage({ key: requestKey, url });
    }).catch(() => { if (active) setRemoteImage({ key: requestKey, error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [saved, savedImage, documentId, role, requestKey]);
  useEffect(() => { onInkChange?.(ink); }, [ink, onInkChange]);
  useEffect(() => () => onInkChange?.(false), [onInkChange]);
  const point = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.current.width / rect.width,
      (event.clientY - rect.top) * canvas.current.height / rect.height];
  };
  const start = (event) => {
    if (disabled || readOnly) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    canvas.current.setPointerCapture(event.pointerId);
    drawing.current = event.pointerId;
    const context = canvas.current.getContext('2d');
    const [x, y] = point(event);
    context.strokeStyle = '#1E3168';
    context.fillStyle = '#1E3168';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(x, y, 1.5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
    setInk(true);
    setMessage('');
  };
  const move = (event) => {
    if (drawing.current !== event.pointerId) return;
    const context = canvas.current.getContext('2d');
    context.lineTo(...point(event));
    context.stroke();
  };
  const stop = () => { drawing.current = false; };
  const clear = () => {
    canvas.current?.getContext('2d').clearRect(0, 0, 760, 240);
    setInk(false);
    setMessage('');
  };
  const save = async () => {
    if (!ink) return;
    const result = await onSave(canvas.current.toDataURL('image/png'));
    if (result) { clear(); setRedrawing(false); setMessage('บันทึกลายเซ็นแล้ว'); }
  };
  const redraw = () => { clear(); setRedrawing(true); };
  const reviewAction = !inline && (reviewFirst || showingSaved);
  const Controls = inline ? 'div' : GlassBar;
  const clearAction = <IconButton icon="delete" label="ล้างเส้น" disabled={disabled} onClick={clear} />;
  return <div className="rc-signature rc-stack">
    <div className="rc-section-heading"><h2>{label}</h2><StatusPill status={showingSaved ? 'ok' : 'review'}>{showingSaved ? 'เซ็นแล้ว' : saved ? 'เซ็นใหม่ยังไม่บันทึก' : 'รอเซ็น'}</StatusPill></div>
    {showHint && !inline && !saved && !ink && <ReceivingIllustration state="sign" compact />}
    {showingSaved ? <div className="rc-stack">
      {image && failedImage !== imageKey ? <img key={imageKey} className="rc-saved-signature" src={image} alt={`ลายเซ็น${label}ที่บันทึกแล้ว`}
        onError={() => setFailedImage(imageKey)} /> : <p className="rc-muted" role="status">{remote.error ? 'โหลดลายเซ็นไม่สำเร็จ' : image ? 'แสดงภาพลายเซ็นไม่ได้' : 'กำลังโหลดลายเซ็น…'}</p>}
      {(remote.error || (image && failedImage === imageKey)) && <button type="button" className="rc-text-action" disabled={disabled} onClick={() => setImageAttempt(value => value + 1)}>ลองโหลดใหม่</button>}
      {!readOnly && <button type="button" className="rc-text-action" disabled={disabled} onClick={redraw}>ล้างแล้วเซ็นใหม่</button>}
    </div> : <canvas ref={canvas} width="760" height="240" aria-label={`ช่องลง${label}`} role="img" aria-disabled={disabled}
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />}
    {message && <p className="rc-muted" role="status">{message}</p>}
    {!inline && !saved && !ink && <p className="rc-muted">เซ็นในกรอบ แล้วบันทึกลายเซ็น</p>}
    {showActions && <Controls className={inline ? 'rc-row' : ''}>
      {inline ? !showingSaved && clearAction : backAction}
      {!inline && (ink ? clearAction : moreAction)}
      {(!inline || !showingSaved) && <PrimaryAction busy={busy} busyLabel="กำลังบันทึก…" icon={reviewAction ? reviewFirst ? 'list' : 'check' : 'signature'} disabled={disabled || (reviewAction ? !onReview : !ink)}
        onClick={reviewAction ? onReview : save}>{reviewAction ? reviewLabel : 'บันทึกเซ็น'}</PrimaryAction>}
    </Controls>}
  </div>;
}
