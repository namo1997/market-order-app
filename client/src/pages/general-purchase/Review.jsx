import { useState } from 'react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { PageShell, EmptyState, StatusBadge, OfficialPurchaseDocument, formatCurrency, formatDate } from './shared';

const RequestCard = ({ request, onApprove, onReject, canCreate }) => {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState(null);
  const [printPr, setPrintPr] = useState(false);
  const total = request.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
  const printDocument = () => {
    setPrintPr(true);
    setTimeout(() => {
      window.print();
      setPrintPr(false);
    }, 50);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-900">{request.number}</span>
            <StatusBadge status={request.status} />
          </div>
          <div className="text-sm text-slate-500">
            ผู้ขอ: <strong>{request.requestedBy}</strong> · สาขา <strong>{request.header?.branch}</strong> · แผนก <strong>{request.header?.department}</strong>
          </div>
          <div className="text-xs text-slate-400">ส่งเมื่อ {formatDate(request.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">ยอดประมาณ</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(total)}</div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
        <div><span className="text-slate-500">ประเภทค่าใช้จ่าย:</span> {request.header?.expenseType || '-'}</div>
        <div><span className="text-slate-500">วัตถุประสงค์:</span> {request.header?.purpose}</div>
      </div>

      {/* Mobile: list */}
      <div className="mt-3 space-y-2 sm:hidden">
        {request.items.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-start gap-2">
              {item.imageDataUrl && <img src={item.imageDataUrl} alt={item.name} className="h-12 w-12 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800">{item.name}</div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-slate-600">
                  <span>{item.quantity || '-'} {item.unit}</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(item.totalPrice)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-3 hidden overflow-hidden rounded-2xl border border-slate-200 sm:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs font-bold text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">รายการ</th>
              <th className="px-3 py-2 text-right">จำนวน</th>
              <th className="px-3 py-2 text-left">หน่วย</th>
              <th className="px-3 py-2 text-right">ราคารวม</th>
            </tr>
          </thead>
          <tbody>
            {request.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-200">
                <td className="px-3 py-2 font-semibold text-slate-800">
                  <div className="flex items-center gap-2">
                    {item.imageDataUrl && <img src={item.imageDataUrl} alt={item.name} className="h-10 w-10 rounded-lg object-cover" />}
                    <span>{item.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{item.quantity || '-'}</td>
                <td className="px-3 py-2">{item.unit || '-'}</td>
                <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'approve' && (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3">
          <Input label="หมายเหตุการอนุมัติ (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ผ่าน / ขอใบเสร็จด้วย" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode(null)}>ยกเลิก</Button>
            <Button size="sm" onClick={() => onApprove(request.id, note)}>ยืนยันอนุมัติ</Button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3">
          <Input label="เหตุผลที่ไม่อนุมัติ" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ยอดเกินงบประมาณ" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode(null)}>ยกเลิก</Button>
            <Button variant="danger" size="sm" disabled={!reason.trim()} onClick={() => onReject(request.id, reason)}>
              ยืนยันไม่อนุมัติ
            </Button>
          </div>
        </div>
      )}

      {printPr && <OfficialPurchaseDocument request={request} type="pr" />}

      {!mode && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:flex sm:justify-end">
          <Button variant="secondary" size="sm" fullWidth onClick={printDocument}>พิมพ์ PR</Button>
          {canCreate && (
            <>
              <Button variant="danger" size="sm" fullWidth onClick={() => setMode('reject')}>ไม่อนุมัติ</Button>
              <Button size="sm" fullWidth onClick={() => setMode('approve')}>อนุมัติ</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const GeneralPurchaseReview = () => {
  const { requests, approveRequest, rejectRequest, canApprove } = useGeneralPurchase();
  const pending = requests.filter((r) => r.status === 'pending_review');

  return (
    <PageShell
      current="/general-purchase/review"
      stepperKey="review"
      title="ตรวจสอบ PR"
      subtitle="หัวหน้างาน/ผู้บริหารจากระบบพนักงาน ตรวจสอบและอนุมัติเพื่อส่งต่อให้ฝ่ายจัดซื้อ"
      role="หัวหน้างาน / ผู้บริหาร"
    >
      {pending.length === 0 ? (
        <EmptyState title="ไม่มี PR ที่รอตรวจสอบ" hint="เมื่อมี PR ใหม่จะมาแสดงที่นี่อัตโนมัติ" />
      ) : (
        <div className="space-y-4">
          {pending.map((req) => (
            <RequestCard key={req.id} request={req} onApprove={approveRequest} onReject={rejectRequest} canCreate={canApprove} />
          ))}
        </div>
      )}
    </PageShell>
  );
};
