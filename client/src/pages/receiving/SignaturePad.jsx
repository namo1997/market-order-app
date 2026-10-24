import { useEffect, useRef, useState } from 'react';
import { GlassBar, PrimaryAction, IconButton, StatusPill } from '../../design';
import { receivingDocumentsAPI as api } from '../../api/receiving-documents';

import { ReceivingIllustration } from './ReceivingIllustration';
import { ReceivingDialog } from './ReceivingDialog';

// Width stays 760 (same resolution as before); height follows the rendered box, clamped to 120–1200.
export function fitCanvasAspect(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return;
  const height = Math.min(1200, Math.max(120, Math.round(element.width * rect.height / rect.width)));
  if (element.height !== height) element.height = height;
}

export function SignaturePad({ label, saved, savedImage, documentId, role, readOnly = false, onSave, onInkChange, disabled = false, busy = false, backAction, moreAction, onReview, reviewLabel = 'ตรวจรับ', reviewFirst = false, inline = false, showActions = true, showHint = true, saveError = '', optional = false }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [message, setMessage] = useState('');
  const [redrawing, setRedrawing] = useState(false);
  // Inline pads never take ink: a finger that starts on the page can only scroll.
  // Drawing happens in the focused signing sheet that the receiver opens on purpose.
  const [signing, setSigning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
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
  useEffect(() => { onInkChange?.(ink || redrawing); }, [ink, redrawing, onInkChange]);
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
    // The backing store is 760 wide; give it the on-screen aspect before the first stroke so the
    // saved PNG keeps the shape that was drawn (a portrait sheet used to save a squashed signature).
    if (!ink) fitCanvasAspect(canvas.current);
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
    canvas.current?.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height);
    setInk(false);
    setMessage('');
  };
  const save = async () => {
    if (!ink) return;
    const result = await onSave(canvas.current.toDataURL('image/png'));
    if (result) { clear(); setRedrawing(false); setSigning(false); setMessage(''); }
    else if (inline) setMessage('บันทึกลายเซ็นไม่สำเร็จ ลองกดบันทึกเซ็นอีกครั้ง');
  };
  const openSheet = () => { clear(); setSigning(true); };
  const cancelSheet = () => { clear(); setSigning(false); setDiscarding(false); };
  // Back and "ยกเลิก" are the same action: with ink on the canvas ask once, otherwise just close the sheet.
  // The question belongs to the sheet; it never reaches the editor/shell leave guard.
  const requestCancel = () => { if (busy) return; if (ink) setDiscarding(true); else cancelSheet(); };
  const redraw = () => { clear(); setRedrawing(true); };
  const reviewAction = !inline && (reviewFirst || showingSaved);
  const Controls = inline ? 'div' : GlassBar;
  const clearAction = <IconButton icon="delete" label="ล้างเส้น" disabled={disabled} onClick={clear} />;
  const surface = <canvas ref={canvas} width="760" height="240" aria-label={`ช่องลง${label}`} role="img" aria-disabled={disabled}
    onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />;
  const sheetActions = <div className="rc-sign-actions">
    <button type="button" className="rc-sign-cancel" disabled={busy} onClick={requestCancel}>ยกเลิก</button>
    <IconButton icon="delete" label="ล้างเส้น" disabled={disabled || busy} onClick={clear} />
    <PrimaryAction busy={busy} busyLabel="กำลังบันทึก…" icon="signature" disabled={disabled || !ink} onClick={save}>บันทึกเซ็น</PrimaryAction>
  </div>;
  return <div className="rc-signature rc-stack">
    <div className="rc-section-heading"><h2>{label}</h2>{!(optional && !saved && !ink && !busy) && <StatusPill status={showingSaved ? 'ok' : 'review'}>{busy ? 'กำลังบันทึกเซ็น…' : showingSaved ? 'เซ็นแล้ว' : ink ? 'กำลังเขียน · ยังไม่บันทึก' : saved ? 'เซ็นใหม่ยังไม่บันทึก' : 'รอเซ็น'}</StatusPill>}</div>
    {showHint && !inline && !saved && !ink && <ReceivingIllustration state="sign" compact />}
    {showingSaved ? <div className="rc-stack">
      {image && failedImage !== imageKey ? <img key={imageKey} className="rc-saved-signature" src={image} alt={`ลายเซ็น${label}ที่บันทึกแล้ว`}
        onError={() => setFailedImage(imageKey)} /> : <p className="rc-muted" role="status">{remote.error ? 'โหลดลายเซ็นไม่สำเร็จ' : image ? 'แสดงภาพลายเซ็นไม่ได้' : 'กำลังโหลดลายเซ็น…'}</p>}
      {(remote.error || (image && failedImage === imageKey)) && <button type="button" className="rc-text-action" disabled={disabled} onClick={() => setImageAttempt(value => value + 1)}>ลองโหลดใหม่</button>}
      {!readOnly && <button type="button" className="rc-text-action" disabled={disabled} onClick={redraw}>เซ็นใหม่</button>}
    </div> : readOnly ? <p>ไม่มีลายเซ็นที่บันทึก</p> : inline
      ? <button type="button" className="rc-sign-open" data-role={role} disabled={disabled} onClick={openSheet}>แตะเพื่อเซ็น</button>
      : surface}
    {inline && signing && !showingSaved && <ReceivingDialog title={`เซ็นชื่อ · ${label}`} className="rc-sign-sheet rc-image-fullscreen rc-back-dismiss" backDismiss busy={busy} onClose={requestCancel} actions={sheetActions}>
      {surface}
      <p role="status">{busy ? 'กำลังบันทึกเซ็น…' : ink ? 'มีเส้นที่ยังไม่บันทึก' : 'ยังไม่มีเส้นลายเซ็น'}</p>
      {message && <p role="alert" className="rc-muted">{saveError ? `${saveError} · ${message}` : message}</p>}
    </ReceivingDialog>}
    {inline && signing && discarding && !showingSaved && <ReceivingDialog title="ทิ้งลายเซ็นนี้?" className="rc-sign-discard rc-back-dismiss" busy={busy} onClose={() => setDiscarding(false)}
      actions={<><PrimaryAction icon="signature" disabled={busy} onClick={() => setDiscarding(false)}>เซ็นต่อ</PrimaryAction>
        <button type="button" className="ra-secondary-action" disabled={busy} onClick={cancelSheet}>ทิ้งลายเซ็น</button></>}>
      <p>เส้นที่เซ็นไว้ยังไม่ได้บันทึก หากทิ้ง ต้องเซ็นใหม่</p>
    </ReceivingDialog>}
    {message && !signing && <p className="rc-muted" role="status">{message}</p>}
    {!inline && !saved && !ink && <p className="rc-muted">เซ็นในกรอบ แล้วบันทึกลายเซ็น</p>}
    {showActions && !readOnly && !inline && <Controls className={inline ? 'rc-row' : ''}>
      {inline ? !showingSaved && clearAction : backAction}
      {!inline && (ink ? clearAction : moreAction)}
      {(!inline || !showingSaved) && <PrimaryAction busy={busy} busyLabel="กำลังบันทึก…" icon={reviewAction ? reviewFirst ? 'list' : 'check' : 'signature'} disabled={disabled || (reviewAction ? !onReview : !ink)}
        onClick={reviewAction ? onReview : save}>{reviewAction ? reviewLabel : 'บันทึกเซ็น'}</PrimaryAction>}
    </Controls>}
  </div>;
}
