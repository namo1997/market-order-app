import { useEffect, useState } from 'react';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { StatusBadge, formatCurrency } from './shared';

// Summary lists never contain images or editable item rows. Load one document
// only after opening it, so approval/printing/receiving always uses full detail.
export const RequestDetails = ({ request, children, initiallyOpen = false }) => {
  const { loadDetail } = useGeneralPurchase();
  const [open, setOpen] = useState(initiallyOpen);
  const [detail, setDetail] = useState(request.summary ? null : request);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(''); setDetail(null);
    loadDetail(request.id).then((record) => { if (alive) setDetail(record); })
      .catch((failure) => { if (alive) setError(failure.response?.data?.message || 'โหลดรายละเอียดไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [open, request.id, loadDetail, attempt]);
  return <section data-request-id={request.id} className="space-y-2">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><strong>{request.number || `เอกสาร ${request.id}`}</strong> {request.status && <StatusBadge status={request.status} />}
          <p className="text-sm text-slate-600">{request.header?.vendorName} · {request.header?.branch} / {request.header?.department}</p>
          <p className="text-sm text-slate-600">{request.itemSummary || request.header?.purpose || ''}</p>
        </div>
        <div className="text-right"><p>{request.itemEstimatedTotal != null || !request.summary ? formatCurrency(request.itemEstimatedTotal ?? (request.items || []).reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0)) : '—'}</p>
          <button type="button" className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'ปิดรายละเอียด' : 'เปิดรายละเอียด'}
          </button>
        </div>
      </div>
    </div>
    {open && (error ? <div role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>ลองใหม่</button></div>
      : detail ? children(detail) : <p role="status">กำลังโหลดรายละเอียด...</p>)}
  </section>;
};
