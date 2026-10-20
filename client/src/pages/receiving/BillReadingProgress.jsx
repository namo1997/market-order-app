import { useEffect, useState } from 'react';
import { BillImage } from './BillImage';
import { ReceivingIllustration } from './ReceivingIllustration';
import { readingProgress } from './reading-progress';
import './bill-reading.css';

export function BillReadingProgress({ documentId, page, startedAt, preparing = false, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const progress = readingProgress(elapsed);
  return <section className="rc-reading" aria-label="สถานะอ่านบิล">
    <div className="rc-reading-photo" aria-hidden="true">
      <BillImage documentId={documentId} page={page} alt="ภาพบิลหน้าแรกที่กำลังอ่าน" />
      <span className="rc-reading-scan" />
    </div>
    <div role="status" aria-busy="true"><h2>{preparing ? 'กำลังเตรียมรูปบิล…' : progress.label}</h2></div>
    <p className="rc-muted"><span aria-live="off">ผ่านไป {progress.elapsed}</span> · ปกติ 20–60 วินาที</p>
    <p className="rc-muted">หากนานกว่าปกติ ยังรอผลต่อได้</p>
    {!preparing && <ReceivingIllustration state="reading-bill" supporting compact title="กำลังตรวจภาพบิล" description="อ่านเสร็จแล้วจะเปิดรายการให้ตรวจ" />}
    <button type="button" className="rc-text-action" onClick={onCancel}>ยกเลิก</button>
    <p className="rc-muted">ยกเลิกการรอเพื่อกลับดูบิล งานที่ส่งแล้วจะอ่านต่อ และแสดงผลในหน้านี้เมื่อเสร็จ</p>
  </section>;
}
