import { Link } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { PageShell, EmptyState, StatusBadge, formatCurrency, formatDate } from './shared';

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    return diff;
  } catch {
    return null;
  }
};

export const GeneralPurchaseAwaiting = () => {
  const { requests } = useGeneralPurchase();
  const list = requests.filter((r) => r.status === 'awaiting_receipt');

  return (
    <PageShell
      current="/general-purchase/awaiting"
      stepperKey="awaiting"
      title="รอรับสินค้า / บริการ"
      subtitle="คลัง/ผู้รับ ติดตาม PO ที่ส่งให้ผู้ขายแล้ว"
      role="คลัง / ผู้รับ"
    >
      {list.length === 0 ? (
        <EmptyState title="ไม่มีรายการที่รอรับ" hint="เมื่อฝ่ายจัดซื้อออก PO จะมาแสดงที่นี่" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((req) => {
            const total = req.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
            const remain = daysUntil(req.expectedDate);
            const overdue = remain !== null && remain < 0;
            return (
              <div key={req.id} className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-slate-900">{req.number}</span>
                      <StatusBadge status={req.status} />
                    </div>
                    <div className="text-sm text-slate-500">PO: <strong>{req.poNumber}</strong></div>
                    <div className="text-xs text-slate-400">ออก PO {formatDate(req.issuedAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">ยอด</div>
                    <div className="text-xl font-bold text-slate-900">{formatCurrency(total)}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
                  <div><span className="text-slate-500">ผู้ขาย:</span> <strong>{req.header?.vendorName}</strong></div>
                  <div><span className="text-slate-500">สาขา/แผนก:</span> {req.header?.branch} / {req.header?.department}</div>
                  <div><span className="text-slate-500">วัตถุประสงค์:</span> {req.header?.purpose}</div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-xs font-bold text-slate-600">รายการที่สั่ง</div>
                  <ul className="space-y-1 text-sm">
                    {req.items.map((item) => (
                      <li key={item.id} className="flex justify-between">
                        <span className="truncate text-slate-700">{item.name}</span>
                        <span className="text-slate-500">{item.quantity || '-'} {item.unit}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div
                    className={`rounded-2xl px-3 py-2 text-xs font-bold ${
                      overdue
                        ? 'bg-rose-100 text-rose-800'
                        : remain !== null
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {req.expectedDate
                      ? overdue
                        ? `เลยกำหนด ${Math.abs(remain)} วัน (${req.expectedDate})`
                        : remain === 0
                          ? `ครบกำหนดวันนี้ (${req.expectedDate})`
                          : `อีก ${remain} วันถึงกำหนด (${req.expectedDate})`
                      : 'ยังไม่กำหนดวันรับ'}
                  </div>
                  <Link to="/general-purchase/receive">
                    <Button size="sm">ไปหน้ารับสินค้า →</Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
};
