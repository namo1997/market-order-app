import { useRef, useState } from 'react';
import { GlassBar, PrimaryAction, IconButton, StatusPill } from '../../design';

export function SignaturePad({ label, saved, onSave, disabled = false, busy = false, backAction, moreAction, onReview, canReview = true, inline = false, showActions = true }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [message, setMessage] = useState('');
  const point = (event) => {
    const rect = canvas.current.getBoundingClientRect();
    return [(event.clientX - rect.left) * canvas.current.width / rect.width,
      (event.clientY - rect.top) * canvas.current.height / rect.height];
  };
  const start = (event) => {
    if (disabled) return;
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
    canvas.current.getContext('2d').clearRect(0, 0, 760, 240);
    setInk(false);
    setMessage('');
  };
  const save = async () => {
    if (!ink) return;
    const result = await onSave(canvas.current.toDataURL('image/png'));
    if (result) { clear(); setMessage('บันทึกลายเซ็นแล้ว'); }
  };
  const Controls = inline ? 'div' : GlassBar;
  const clearAction = <IconButton icon="delete" label="ล้างเส้น" disabled={disabled} onClick={clear} />;
  return <div className="rc-signature rc-stack">
    <div className="rc-section-heading"><h2>{label}</h2><StatusPill status={saved ? 'ok' : 'review'}>{saved ? 'เซ็นแล้ว' : 'รอเซ็น'}</StatusPill></div>
    <canvas ref={canvas} width="760" height="240" aria-label={`ช่องลง${label}`} role="img" aria-disabled={disabled}
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
    {message && <p className="rc-muted" role="status">{message}</p>}
    {showActions && <Controls className={inline ? 'rc-row' : ''}>
      {inline ? clearAction : backAction}
      {!inline && (ink ? clearAction : moreAction)}
      <PrimaryAction busy={busy} icon={ink || !saved ? 'signature' : 'check'} disabled={disabled || (!ink && (!saved || !canReview || !onReview))}
        onClick={ink ? save : onReview}>{ink || inline ? 'บันทึกเซ็น' : 'ตรวจรับ'}</PrimaryAction>
    </Controls>}
  </div>;
}
