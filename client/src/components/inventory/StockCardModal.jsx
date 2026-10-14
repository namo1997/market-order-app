import { useEffect, useState, useRef } from 'react';
import { inventoryAPI } from '../../api/inventory';

// ─── helpers ──────────────────────────────────────────────────────────────────

const formatNumber = (num) =>
  Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const formatDateTime = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const parseRecipeSaleBillRef = (referenceId) => {
  const ref   = String(referenceId || '');
  const match = ref.match(
    /^recipe-sale-bill:(\d{4}-\d{2}-\d{2}):(\d{14}):branch\d+:dept\d+:product\d+:doc(.+)$/
  );
  if (!match) return null;
  return { dateTime14: match[2] };
};

const formatThaiFromDateTime14 = (dt14) => {
  if (!/^\d{14}$/.test(String(dt14 || ''))) return '-';
  const y = +dt14.slice(0, 4), mo = +dt14.slice(4, 6) - 1;
  const d = +dt14.slice(6, 8), hh = +dt14.slice(8, 10);
  const mm = +dt14.slice(10, 12);
  return new Date(y, mo, d, hh, mm).toLocaleString('th-TH', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
};

const formatCardDateTime = (item) => {
  const refType = String(item?.reference_type || '');
  const refId   = String(item?.reference_id   || '');
  if (refType === 'recipe_sale') {
    const b = parseRecipeSaleBillRef(refId);
    if (b?.dateTime14) return formatThaiFromDateTime14(b.dateTime14);
    const m = refId.match(/^recipe-sale:(\d{4}-\d{2}-\d{2}):/);
    if (m?.[1]) {
      const day = new Date(`${m[1]}T00:00:00`);
      if (!Number.isNaN(day.getTime()))
        return day.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }) + ' (รวมวัน)';
    }
  }
  return formatDateTime(item?.effective_at || item?.created_at);
};

const TYPE_LABEL = {
  receive:                  'รับเข้า',
  sale:                     'ขาย',
  recipe_sale:              'ขาย POS',
  adjustment:               'ปรับปรุง',
  transfer_in:              'โอนเข้า',
  transfer_out:             'โอนออก',
  initial:                  'ยอดเริ่มต้น',
  production_transform_in:  'แปรรูป↑',
  production_transform_out: 'แปรรูป↓',
};
const TYPE_COLOR = {
  receive:                  'bg-green-100 text-green-700',
  sale:                     'bg-red-100 text-red-700',
  recipe_sale:              'bg-red-100 text-red-700',
  adjustment:               'bg-blue-100 text-blue-700',
  transfer_in:              'bg-purple-100 text-purple-700',
  transfer_out:             'bg-orange-100 text-orange-700',
  initial:                  'bg-gray-100 text-gray-600',
  production_transform_in:  'bg-teal-100 text-teal-700',
  production_transform_out: 'bg-amber-100 text-amber-700',
};

const getTransferRouteText = (item) => {
  const type = String(item?.transaction_type || '');
  if (type !== 'transfer_in' && type !== 'transfer_out') return null;

  const branch = String(item?.counterparty_branch_name || '').trim();
  const department = String(item?.counterparty_department_name || '').trim();
  const location = [branch, department].filter(Boolean).join(' / ');
  if (!location) return null;

  return type === 'transfer_out' ? `โอนไป: ${location}` : `โอนมาจาก: ${location}`;
};

// ─── StockCardModal ────────────────────────────────────────────────────────────

export const StockCardModal = ({ productId, departmentId, onClose }) => {
  const today = new Date().toISOString().split('T')[0];
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ startDate: '', endDate: today });
  const backdropRef           = useRef(null);

  // โหลดข้อมูล
  useEffect(() => {
    if (!productId || !departmentId) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    inventoryAPI.getStockCard(productId, departmentId, filters)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, departmentId, filters]);

  // Escape key
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // ล็อก body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const product      = data?.product;
  const transactions = data?.transactions ?? [];
  const balance      = data?.current_balance;

  return (
    /* ── Backdrop ── */
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      {/* ── Sheet (full-width bottom sheet, ไม่ต้อง scroll ซ้าย-ขวา) ── */}
      <div className="relative w-full max-h-[92dvh] flex flex-col bg-white rounded-t-2xl shadow-2xl overflow-hidden">

        {/* drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-gray-300" />
        </div>

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-4 pt-1 pb-3 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-0.5">
              บัตรคุมสต็อก
            </p>
            {product ? (
              <>
                <h2 className="text-base font-bold text-gray-900 leading-tight truncate">
                  {product.product_name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {product.department_name} · {product.branch_name}
                </p>
              </>
            ) : (
              <div className="h-5 w-40 bg-gray-100 rounded animate-pulse mt-1" />
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl text-gray-400 active:bg-gray-100"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* ── Info strip: ยอดคงเหลือ + date filter ── */}
        <div className="mx-4 mb-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 shrink-0">
          {/* ยอดคงเหลือ */}
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-xs text-gray-500">ยอดคงเหลือ</span>
            {loading && !product ? (
              <div className="h-8 w-16 bg-gray-200 rounded animate-pulse" />
            ) : (
              <>
                <span className={`text-3xl font-bold tabular-nums leading-none ${
                  Number(balance) <= 0 ? 'text-red-500' :
                  Number(balance) <= 5 ? 'text-orange-500' : 'text-green-600'
                }`}>
                  {formatNumber(balance)}
                </span>
                <span className="text-sm text-gray-500">{product?.unit_abbr}</span>
              </>
            )}
          </div>

          {/* Date filter — stack บน mobile */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">ตั้งแต่วันที่</p>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white"
              />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">ถึงวันที่</p>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white"
              />
            </div>
          </div>
        </div>

        {/* ── Body: card list (แทนตาราง) ── */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {loading ? (
            /* Skeleton */
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : !product ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              ไม่พบข้อมูลสินค้า
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-1">
              <span className="text-2xl">📭</span>
              <span className="text-gray-400 text-sm">ไม่พบประวัติการเคลื่อนไหว</span>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-2">{transactions.length} รายการ</p>
              <div className="space-y-2">
                {transactions.map((item) => {
                  const neg = Number(item.quantity) < 0;
                  const typeColor = TYPE_COLOR[item.transaction_type] || 'bg-gray-100 text-gray-600';
                  const transferRouteText = getTransferRouteText(item);
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-gray-100 bg-white px-4 py-3 flex items-center gap-3"
                    >
                      {/* ซ้าย: วันเวลา + ประเภท */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${typeColor}`}>
                            {TYPE_LABEL[item.transaction_type] || item.transaction_type}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {formatCardDateTime(item)}
                          {item.created_by_name ? ` · ${item.created_by_name}` : ''}
                        </p>
                        {(item.notes || transferRouteText) ? (
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {[item.notes, transferRouteText].filter(Boolean).join(' • ')}
                          </p>
                        ) : null}
                      </div>

                      {/* ขวา: จำนวน + ยอดก่อน→หลัง */}
                      <div className="text-right shrink-0">
                        {/* จำนวนที่เปลี่ยน */}
                        <p className={`text-base font-bold tabular-nums leading-none ${neg ? 'text-red-500' : 'text-green-600'}`}>
                          {neg ? '' : '+'}{formatNumber(item.quantity)}
                        </p>
                        {/* ยอดก่อน → ยอดหลัง */}
                        <p className="text-xs text-gray-400 tabular-nums mt-1">
                          {formatNumber(item.balance_before)}
                          <span className="mx-1 text-gray-300">→</span>
                          <span className="font-semibold text-gray-700">
                            {formatNumber(item.balance_after)}
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
