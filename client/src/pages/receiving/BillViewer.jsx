import { useEffect, useRef, useState } from 'react';
import { ReceivingDialog } from './ReceivingDialog';
import { BillImage } from './BillImage';
import { billViewerHistory } from './bill-viewer-history';
import './bill-reading.css';

const clamp = value => Math.max(1, Math.min(4, value));

export function BillViewer({ documentId, pages, initialPage = 0, onClose }) {
  const [zoom, setZoom] = useState(1);
  const pan = useRef(null);
  const initial = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const navigation = useRef(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    let active = true;
    let handle;
    // StrictMode rehearses effects; create history only for the surviving mount.
    Promise.resolve().then(() => {
      if (active) { handle = billViewerHistory(window, () => closeCallback.current()); navigation.current = handle; }
    });
    initial.current?.scrollIntoView?.({ block: 'start' });
    return () => { active = false; handle?.dispose(); };
  }, []);
  const down = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    pinch.current = points.length === 2 ? { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), zoom } : null;
  };
  const move = event => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (!pinch.current) pinch.current = { distance: Math.max(1, distance), zoom };
      else setZoom(Math.round(clamp(pinch.current.zoom * distance / pinch.current.distance) * 100) / 100);
    } else if (points.length === 1) {
      pan.current.scrollLeft -= event.clientX - previous.x;
      pan.current.scrollTop -= event.clientY - previous.y;
    }
  };
  const up = event => { pointers.current.delete(event.pointerId); pinch.current = null; };
  return <ReceivingDialog className="rc-image-fullscreen" title={`บิล ${pages.length} หน้า`} onClose={() => navigation.current?.close()}>
    <div className="rc-image-controls" role="group" aria-label="ซูมรูปบิล">
      <button type="button" className="rc-text-action" disabled={zoom <= 1} onClick={() => setZoom(value => clamp(value - .5))}>ย่อ</button>
      <span role="status">{Math.round(zoom * 100)}%</span>
      <button type="button" className="rc-text-action" disabled={zoom >= 4} onClick={() => setZoom(value => clamp(value + .5))}>ขยาย</button>
    </div>
    <p className="rc-muted rc-viewer-hint">จีบเพื่อซูม · ลากเพื่อเลื่อนดูทุกหน้า</p>
    <div ref={pan} className="rc-image-pan" tabIndex={0} aria-label="รูปบิลทุกหน้า เลื่อนเพื่อดูหน้าถัดไป"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      {pages.map((page, index) => <figure key={page.id || page.key || index} ref={index === initialPage ? initial : undefined} className="rc-viewer-page">
        <figcaption>หน้า {page.page_no || index + 1} / {pages.length}</figcaption>
        <BillImage documentId={documentId} page={page} alt={`บิลหน้า ${page.page_no || index + 1} ขยาย`} draggable={false} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />
      </figure>)}
    </div>
  </ReceivingDialog>;
}
