import { useRef, useState } from 'react';
import { ReceivingIcon } from './ReceivingIcon';

export function SignaturePad({ label, saved, onSave }) {
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
  return <div className="rc-signature">
    <div className="rc-section-heading"><h3><ReceivingIcon name="signature" />{label}</h3>
      {saved && <span className="rc-status confirmed">มีลายเซ็นแล้ว</span>}</div>
    <p className="rc-muted">ใช้นิ้วหรือปากกาเซ็นในช่อง แล้วกดบันทึก</p>
    <canvas ref={canvas} width="760" height="240" aria-label={`ช่องลง${label}`} role="img"
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} />
    <div className="rc-row"><button type="button" onClick={clear}>ล้างเส้น</button>
      <button type="button" className="rc-secondary" disabled={!ink} onClick={save}>บันทึก{label}</button></div>
    <p className="rc-muted" role="status">{message || (saved ? 'เซ็นใหม่ได้หากต้องการแทนลายเซ็นเดิม' : 'ยังไม่ได้บันทึกลายเซ็น')}</p>
  </div>;
}
