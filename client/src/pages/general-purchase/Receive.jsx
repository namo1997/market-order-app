import { useMemo, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { PageShell, EmptyState, StatusBadge, OfficialPurchaseDocument, formatCurrency, formatDate } from './shared';

const ReceiveCard = ({ request, onReceive, canCreate }) => {
  const [taxInvoiceNo, setTaxInvoiceNo] = useState(request.header?.taxInvoiceNo || '');
  const [receiveNote, setReceiveNote] = useState('');
  const [printReceive, setPrintReceive] = useState(false);
  const [rows, setRows] = useState(() =>
    request.items.map((item) => ({
      id: item.id,
      name: item.name,
      requestedQuantity: item.quantity,
      unit: item.unit,
      estimatedPrice: item.totalPrice,
      actualQuantity: String(item.quantity || ''),
      actualPrice: String(item.totalPrice || ''),
    }))
  );

  const totalEstimate = useMemo(
    () => request.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0),
    [request.items]
  );
  const totalActual = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.actualPrice) || 0), 0),
    [rows]
  );
  const diff = totalActual - totalEstimate;

  const updateRow = (id, field, value) =>
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, [field]: value } : r)));

  const copyEstimateToActual = () => {
    setRows((cur) =>
      cur.map((r) => ({
        ...r,
        actualQuantity: String(r.requestedQuantity || ''),
        actualPrice: String(r.estimatedPrice || ''),
      }))
    );
  };

  const printDocument = () => {
    setPrintReceive(true);
    setTimeout(() => {
      window.print();
      setPrintReceive(false);
    }, 50);
  };

  const handleSubmit = () => {
    const payload = {
      taxInvoiceNo: taxInvoiceNo.trim(),
      note: receiveNote.trim(),
      items: rows.map((r) => ({
        id: r.id,
        actualQuantity: Number(r.actualQuantity) || 0,
        actualPrice: Number(r.actualPrice) || 0,
      })),
    };
    onReceive(request.id, payload);
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-slate-900">{request.number}</span>
            <StatusBadge status={request.status} />
          </div>
          <div className="mt-1 text-sm text-slate-500">
            PO: <strong>{request.poNumber}</strong>
          </div>
          <div className="text-sm text-slate-500">
            ผู้ขาย: <strong className="break-words">{request.header?.vendorName}</strong>
          </div>
          <div className="text-xs text-slate-500">กำหนดรับ {request.expectedDate || '-'}</div>
        </div>
        {canCreate && (
          <Button size="sm" variant="secondary" onClick={copyEstimateToActual}>
            ใส่จำนวน/ราคาตามที่สั่ง
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="เลขใบกำกับภาษี / ใบเสร็จ" value={taxInvoiceNo} disabled={!canCreate} onChange={(e) => setTaxInvoiceNo(e.target.value)} placeholder="ถ้ามี" />
        <Input label="หมายเหตุการรับ" value={receiveNote} disabled={!canCreate} onChange={(e) => setReceiveNote(e.target.value)} placeholder="เช่น ของครบ / ขาดบางรายการ" />
      </div>

      {/* Mobile: stacked cards */}
      <div className="mt-4 space-y-3 lg:hidden">
        {rows.map((row) => (
          <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold text-slate-900">{row.name}</div>
                <div className="text-xs text-slate-500">
                  สั่ง {row.requestedQuantity || '-'} {row.unit}
                  {' · ประมาณ '}
                  {formatCurrency(row.estimatedPrice)}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Input
                label="รับจริง"
                type="number"
                value={row.actualQuantity}
                disabled={!canCreate}
                onChange={(e) => updateRow(row.id, 'actualQuantity', e.target.value)}
                placeholder="0"
              />
              <Input
                label="ราคาจริง (รวม)"
                type="number"
                value={row.actualPrice}
                disabled={!canCreate}
                onChange={(e) => updateRow(row.id, 'actualPrice', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-4 hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-xs font-bold text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">รายการ</th>
              <th className="px-3 py-2 text-right">สั่ง</th>
              <th className="px-3 py-2 text-left">หน่วย</th>
              <th className="px-3 py-2 text-right">ราคาประมาณ</th>
              <th className="px-3 py-2 text-right">รับจริง</th>
              <th className="px-3 py-2 text-right">ราคาจริง (รวม)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200 align-top">
                <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                <td className="px-3 py-2 text-right text-slate-700">{row.requestedQuantity || '-'}</td>
                <td className="px-3 py-2 text-slate-700">{row.unit || '-'}</td>
                <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(row.estimatedPrice)}</td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    value={row.actualQuantity}
                    disabled={!canCreate}
                    onChange={(e) => updateRow(row.id, 'actualQuantity', e.target.value)}
                    placeholder="0"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    value={row.actualPrice}
                    disabled={!canCreate}
                    onChange={(e) => updateRow(row.id, 'actualPrice', e.target.value)}
                    placeholder="0.00"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {printReceive && (
        <OfficialPurchaseDocument
          request={request}
          type="receive"
          receiveRows={rows.map((row) => ({
            id: row.id,
            name: row.name,
            quantity: row.requestedQuantity,
            actualQuantity: row.actualQuantity,
            unit: row.unit,
            estimatedPrice: row.estimatedPrice,
            actualPrice: row.actualPrice,
          }))}
          receiveNote={receiveNote}
          taxInvoiceNo={taxInvoiceNo}
        />
      )}

      <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-slate-900 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-2 text-xs sm:gap-3 sm:text-sm">
          <div>
            <div className="text-slate-300">ยอดประมาณ</div>
            <div className="font-bold">{formatCurrency(totalEstimate)}</div>
          </div>
          <div>
            <div className="text-slate-300">ยอดจริง</div>
            <div className="text-base font-bold sm:text-lg">{formatCurrency(totalActual)}</div>
          </div>
          <div>
            <div className="text-slate-300">ส่วนต่าง</div>
            <div className={`font-bold ${diff > 0 ? 'text-rose-300' : diff < 0 ? 'text-emerald-300' : ''}`}>
              {diff === 0 ? '0' : (diff > 0 ? '+' : '') + formatCurrency(diff)}
            </div>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button variant="secondary" size="sm" fullWidth onClick={printDocument}>พิมพ์ใบรับ</Button>
          {canCreate && <Button size="sm" fullWidth onClick={handleSubmit}>บันทึก/ปิด</Button>}
        </div>
      </div>
    </div>
  );
};

const CompletedRow = ({ request }) => {
  const total = request.items.reduce(
    (s, it) => s + (Number(it.actualPrice ?? it.totalPrice) || 0),
    0
  );
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-3 font-semibold text-slate-900">{request.number}</td>
      <td className="py-2 pr-3 text-slate-700">{request.poNumber || '-'}</td>
      <td className="py-2 pr-3 text-slate-700">{request.header?.vendorName}</td>
      <td className="py-2 pr-3 text-slate-700">{formatDate(request.receivedAt)}</td>
      <td className="py-2 pr-3 text-right font-semibold">{formatCurrency(total)}</td>
    </tr>
  );
};

export const GeneralPurchaseReceive = () => {
  const { requests, receiveAndPrice, canCreate } = useGeneralPurchase();
  const pending = requests.filter((r) => r.status === 'awaiting_receipt');
  const done = requests
    .filter((r) => r.status === 'received')
    .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

  return (
    <PageShell
      current="/general-purchase/receive"
      stepperKey="received"
      title="รับสินค้า + ลงราคาจริง"
      subtitle="ผู้รับลงจำนวนรับจริงและราคาตามบิล เมื่อบันทึกแล้วเอกสารจะปิด"
      role="ผู้รับ / บัญชี"
    >
      {pending.length === 0 ? (
        <EmptyState title="ไม่มีรายการรอลงราคา" hint="เมื่อมีของถึง คลังจะมีรายการที่นี่" />
      ) : (
        <div className="space-y-4">
          {pending.map((req) => (
            <ReceiveCard key={req.id} request={req} onReceive={receiveAndPrice} canCreate={canCreate} />
          ))}
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">เอกสารที่ปิดแล้ว ({done.length})</h2>

        {/* Mobile cards */}
        <div className="mt-3 space-y-2 sm:hidden">
          {done.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500">ยังไม่มีเอกสารที่ปิด</div>
          ) : (
            done.map((r) => {
              const total = r.items.reduce((s, it) => s + (Number(it.actualPrice ?? it.totalPrice) || 0), 0);
              return (
                <div key={r.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">{r.number}</div>
                      <div className="text-xs text-slate-500">PO: {r.poNumber || '-'}</div>
                      <div className="truncate text-xs text-slate-600">{r.header?.vendorName}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900">{formatCurrency(total)}</div>
                      <div className="text-[10px] text-slate-500">{formatDate(r.receivedAt)}</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold text-slate-600">
                <th className="py-2 pr-3">PR</th>
                <th className="py-2 pr-3">PO</th>
                <th className="py-2 pr-3">ผู้ขาย</th>
                <th className="py-2 pr-3">วันรับ</th>
                <th className="py-2 pr-3 text-right">ยอดจริง</th>
              </tr>
            </thead>
            <tbody>
              {done.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">ยังไม่มีเอกสารที่ปิด</td>
                </tr>
              ) : (
                done.map((r) => <CompletedRow key={r.id} request={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
};
