import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { useGeneralPurchase, STATUS_META } from '../../contexts/GeneralPurchaseContext';
import { PageShell, StatusBadge, formatCurrency, formatDate } from './shared';

const CARDS = [
  {
    key: 'pending_review',
    to: '/general-purchase/review',
    title: 'ตรวจสอบ',
    desc: 'หัวหน้างาน/ผู้บริหาร อนุมัติ/ปฏิเสธ PR',
    actor: 'หัวหน้า / ผู้บริหาร',
    accent: 'amber',
  },
  {
    key: 'approved',
    to: '/general-purchase/po',
    title: 'ออก PO',
    desc: 'ฝ่ายจัดซื้อ ออกเลข PO จาก PR ที่อนุมัติแล้ว',
    actor: 'ฝ่ายจัดซื้อ',
    accent: 'sky',
  },
  {
    key: 'awaiting_receipt',
    to: '/general-purchase/awaiting',
    title: 'รอรับสินค้า',
    desc: 'คลัง/ผู้รับ ติดตามว่าของถึงหรือยัง',
    actor: 'คลัง / ผู้รับ',
    accent: 'indigo',
  },
  {
    key: 'received',
    to: '/general-purchase/receive',
    title: 'รับเสร็จ + ใส่ราคาจริง',
    desc: 'ผู้รับ ลงจำนวนรับจริงและราคาตามบิล',
    actor: 'ผู้รับ / บัญชี',
    accent: 'emerald',
  },
];

const ACCENT = {
  amber: 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
  sky: 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100',
  indigo: 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100',
  emerald: 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100',
};

const formatItemSummary = (items = []) => {
  const rows = (Array.isArray(items) ? items : []).filter((item) => item?.name);
  if (rows.length === 0) return 'ไม่พบรายการสินค้า';
  const text = rows.slice(0, 2).map((item) => {
    const qty = Number(item.quantity || 0);
    const qtyText = qty > 0 ? ` ${qty.toLocaleString('th-TH')}` : '';
    const unitText = item.unit ? ` ${item.unit}` : '';
    return `${item.name}${qtyText}${unitText}`;
  }).join(', ');
  return rows.length > 2 ? `${text} และอีก ${rows.length - 2} รายการ` : text;
};

const getRequestItemTitle = (request) => {
  const items = Array.isArray(request?.items) ? request.items : [];
  const names = items
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);

  if (names.length === 0) return request?.header?.purpose || '-';
  if (names.length === 1) return names[0];
  return `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
};

export const GeneralPurchaseHub = () => {
  const { requests, stats, resetAll, loading, error, canCreate, isReadonly } = useGeneralPurchase();
  const [params, setParams] = useSearchParams();
  const showCreatedToast = params.get('created') === '1';

  useEffect(() => {
    if (!showCreatedToast) return undefined;
    const t = setTimeout(() => {
      const nextParams = new URLSearchParams(params);
      nextParams.delete('created');
      setParams(nextParams, { replace: true });
    }, 4000);
    return () => clearTimeout(t);
  }, [params, setParams, showCreatedToast]);

  const sortedRequests = [...requests].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return (
    <PageShell
      current="/general-purchase/hub"
      title="ภาพรวมเอกสารสั่งซื้อทั่วไป"
      role="ทุกฝ่าย"
      headerRight={
        <Button type="button" variant="secondary" size="sm" onClick={resetAll}>
          โหลดข้อมูลใหม่
        </Button>
      }
    >
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {loading && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          กำลังโหลดข้อมูล...
        </div>
      )}

      {showCreatedToast && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ส่ง PR เข้าระบบเรียบร้อย — ดูได้ในช่อง "รอตรวจสอบ"
        </div>
      )}

      {isReadonly && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          PIN 1997: ออก PO / รับสินค้า / ใส่ราคาได้ · สร้าง PR หรืออนุมัติต้องเข้าจากแอพผู้บริหาร
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">ขั้นตอนงาน</div>
        <div className="flex flex-wrap gap-2">
        {canCreate && (
          <Link
            to="/general-purchase"
            className="inline-flex min-w-[170px] flex-1 items-center justify-between gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-blue-900 transition hover:bg-blue-100 sm:flex-none"
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">เริ่มต้น</div>
              <div className="text-sm font-bold leading-tight">+ สร้าง PR ใหม่</div>
              <div className="text-[11px] leading-tight opacity-80">ผู้ขอซื้อกรอกข้อมูลและส่งให้ฝ่ายตรวจสอบ</div>
            </div>
            <span className="rounded-full bg-blue-200 px-2 py-0.5 text-xs font-bold">PR</span>
          </Link>
        )}
        {CARDS.map((card) => (
          <Link
            key={card.key}
            to={card.to}
            className={`inline-flex min-w-[170px] flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2 transition sm:flex-none ${ACCENT[card.accent]}`}
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{card.actor}</div>
              <div className="text-sm font-bold leading-tight">{card.title}</div>
              <div className="text-[11px] leading-tight opacity-80">{card.desc}</div>
            </div>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">{stats[card.key] || 0}</span>
          </Link>
        ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">เอกสารทั้งหมด ({requests.length})</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <span key={key} className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                {meta.label}: <strong>{stats[key] || 0}</strong>
              </span>
            ))}
          </div>
        </div>

        {/* Mobile: stacked cards */}
        <div className="mt-4 space-y-2 lg:hidden">
          {sortedRequests.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">
              {canCreate ? 'ยังไม่มีเอกสาร — เริ่มจาก "สร้าง PR ใหม่"' : 'ยังไม่มีเอกสารให้ดู'}
            </div>
          ) : (
            sortedRequests.map((req) => {
              const total = req.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
              const lastEvent = req.timeline?.[req.timeline.length - 1];
              return (
                <div key={req.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{req.number}</span>
                        <StatusBadge status={req.status} />
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        <strong>{req.requestedBy}</strong> · {req.header?.branch} / {req.header?.department}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-800">
                        รายการ: {formatItemSummary(req.items)}
                      </div>
                      <div className="text-xs text-slate-500">ผู้ขาย: {req.header?.vendorName}</div>
                      <div className="truncate text-xs text-slate-500">{req.header?.purpose}</div>
                      {req.poNumber && <div className="text-[11px] text-slate-500">PO: {req.poNumber}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900">{formatCurrency(total)}</div>
                      <div className="text-[10px] text-slate-500">{formatDate(lastEvent?.at || req.createdAt)}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop: table */}
        <div className="mt-4 hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold text-slate-600">
                <th className="py-2 pr-3">เลขที่</th>
                <th className="py-2 pr-3">ผู้ขอ / สาขา</th>
                <th className="py-2 pr-3">รายการที่ขอซื้อ</th>
                <th className="py-2 pr-3">วัตถุประสงค์</th>
                <th className="py-2 pr-3">รายการที่สั่ง</th>
                <th className="py-2 pr-3 text-right">ยอดประมาณ</th>
                <th className="py-2 pr-3">สถานะ</th>
                <th className="py-2 pr-3">อัปเดตล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {sortedRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    {canCreate ? 'ยังไม่มีเอกสาร — เริ่มจาก "สร้าง PR ใหม่"' : 'ยังไม่มีเอกสารให้ดู'}
                  </td>
                </tr>
              ) : (
                sortedRequests.map((req) => {
                  const total = req.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
                  const lastEvent = req.timeline?.[req.timeline.length - 1];
                  return (
                    <tr key={req.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 font-semibold text-slate-900">{req.number}</td>
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-slate-800">{req.requestedBy}</div>
                        <div className="text-xs text-slate-500">{req.header?.branch} / {req.header?.department}</div>
                      </td>
                      <td className="py-2 pr-3 font-semibold text-slate-800">{getRequestItemTitle(req)}</td>
                      <td className="py-2 pr-3 text-slate-600">{req.header?.purpose}</td>
                      <td className="py-2 pr-3 font-semibold text-slate-800">{formatItemSummary(req.items)}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-slate-900">{formatCurrency(total)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={req.status} />
                        {req.poNumber && <div className="mt-1 text-xs text-slate-500">PO: {req.poNumber}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{formatDate(lastEvent?.at || req.createdAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
};
