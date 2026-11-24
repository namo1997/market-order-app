import { createPortal } from 'react-dom';
import './scan.css';
import { groupScannedStickers, scanToneStyle } from './scanResultUtils';

export const ScanResultCard = ({ result, className = '' }) => {
  if (!result) return null;
  const style = scanToneStyle(result.tone);
  return (
    <div className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 shadow-lg ${style.card} ${className}`}>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white ${style.ring}`}
        aria-hidden="true"
      >
        {style.icon}
      </span>
      <div className="min-w-0">
        <p className={`truncate text-lg font-bold leading-tight ${style.title}`}>{result.title}</p>
        {result.detail && <p className="mt-0.5 text-base font-semibold text-gray-700">{result.detail}</p>}
      </div>
    </div>
  );
};

// แถบผลสแกนลอยบนสุดของจอ (เห็นได้แม้เลื่อนหน้าหรือคีย์บอร์ดเปิด) หายเองหลัง 2.5 วิ (ผิดพลาด 4.5 วิ)
export const ScanToast = ({ result }) => {
  if (!result) return null;
  const motion = result.tone === 'ok' ? 'scan-toast' : result.tone === 'error' ? 'scan-toast--shake' : 'scan-toast--sticky';
  // portal ไป body: ถ้าอยู่ใต้การ์ดที่มี transform/animation, position fixed จะไม่อิงทั้งจอและโดนเนื้อหาทับ
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex justify-center px-3">
      <div key={result.id} role="status" aria-live="assertive" className={`w-full max-w-md ${motion}`}>
        <ScanResultCard result={result} />
      </div>
    </div>,
    document.body
  );
};

// แสงวาบเต็มจอสั้น ๆ ตามสีผล (ใช้ในหน้ากล้อง)
export const ScanFlash = ({ result }) => {
  if (!result) return null;
  return (
    <div
      key={result.id}
      className={`pointer-events-none absolute inset-0 scan-flash ${scanToneStyle(result.tone).flash}`}
      aria-hidden="true"
    />
  );
};

export const ScannedSummary = ({ events, limit = 6, dark = false }) => {
  const groups = groupScannedStickers(events);
  if (groups.length === 0) return null;
  const shown = groups.slice(0, limit);
  const hidden = groups.length - shown.length;
  const latestAt = groups[0].lastAt;
  return (
    <div className={dark ? 'text-white' : 'text-gray-900'}>
      <p className={`text-sm font-semibold ${dark ? 'text-white/80' : 'text-gray-500'}`}>
        สแกนแล้ว {events.length} ดวง
      </p>
      <ul className={`mt-1 divide-y ${dark ? 'divide-white/15' : 'divide-gray-200'}`}>
        {shown.map((group) => (
          <li
            key={`${group.product_id}-${group.lastAt === latestAt ? latestAt : 'old'}`}
            className={`flex items-center justify-between gap-3 rounded-md px-1 py-1.5 ${group.lastAt === latestAt && !dark ? 'scan-row-new' : ''}`}
          >
            <span className="min-w-0 truncate text-base">{group.name}</span>
            <span className="shrink-0 text-base font-bold tabular-nums">
              {group.quantity} {group.unit}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className={`text-sm ${dark ? 'text-white/70' : 'text-gray-500'}`}>อีก {hidden} รายการ</p>
      )}
    </div>
  );
};
