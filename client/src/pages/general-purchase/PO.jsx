import { useState } from 'react';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { PageShell, EmptyState, StatusBadge, OfficialPurchaseDocument, buildGeneralPoNumber, formatCurrency, formatDate } from './shared';

const calculateVat = (subtotal, vatType) => {
  const amount = Number(subtotal) || 0;
  if (vatType === 'vat_excluded') return amount * 0.07;
  if (vatType === 'vat_included') return amount - amount / 1.07;
  return 0;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const nextPoNumber = (existing) => {
  const today = todayStr().replace(/-/g, '');
  const used = existing
    .map((r) => r.poNumber)
    .filter(Boolean)
    .map((s) => Number(String(s).split('-').pop()))
    .filter((n) => Number.isFinite(n));
  const next = String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
  return `GPO-${today}-${next}`;
};

const RequestCard = ({ request, defaultPo, onIssue, canCreate }) => {
  const [poNumber, setPoNumber] = useState(defaultPo);
  const [poDate, setPoDate] = useState(todayStr());
  const [expectedDate, setExpectedDate] = useState('');
  const [vendorName, setVendorName] = useState(request.header?.vendorName || '');
  const [vendorTaxId, setVendorTaxId] = useState(request.header?.vendorTaxId || '');
  const [documentDate, setDocumentDate] = useState(request.header?.documentDate || todayStr());
  const [paymentDueDate, setPaymentDueDate] = useState(request.header?.paymentDueDate || '');
  const [paymentMethod, setPaymentMethod] = useState(request.header?.paymentMethod || 'transfer');
  const [vatType, setVatType] = useState(request.header?.vatType || 'none');
  const [withholdingTaxRate, setWithholdingTaxRate] = useState(String(request.header?.withholdingTaxRate || 0));
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [printType, setPrintType] = useState(null);
  const total = request.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0);
  const vatAmount = calculateVat(total, vatType);
  const withholdingTaxAmount = total * ((Number(withholdingTaxRate) || 0) / 100);
  const grandTotal = total + (vatType === 'vat_excluded' ? vatAmount : 0);
  const payableAmount = grandTotal - withholdingTaxAmount;
  const printDocument = (type) => {
    setPrintType(type);
    setTimeout(() => {
      window.print();
      setPrintType(null);
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
            ผู้ขอ: <strong>{request.requestedBy}</strong> · {request.header?.branch} / {request.header?.department}
          </div>
          <div className="text-xs text-slate-400">
            อนุมัติเมื่อ {formatDate(request.approvedAt)}
            {request.approvalNote ? ` — ${request.approvalNote}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">ยอดประมาณ</div>
          <div className="text-2xl font-bold text-slate-900">{formatCurrency(total)}</div>
          <div className="text-xs text-slate-500">ประเภท: {request.header?.expenseType || '-'}</div>
        </div>
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
                <td className="px-3 py-2 text-right">{formatCurrency(item.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {printType === 'pr' && <OfficialPurchaseDocument request={request} type="pr" />}
      {printType === 'po' && (
        <OfficialPurchaseDocument
          request={request}
          type="po"
          poDraft={{
            poNumber: poNumber || buildGeneralPoNumber(),
            poDate,
            expectedDate,
            vendorName,
            vendorTaxId,
            documentDate,
            paymentDueDate,
            paymentMethod,
            vatType,
            withholdingTaxRate,
            vatAmount,
            withholdingTaxAmount,
            payableAmount
          }}
        />
      )}

      {open && canCreate ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="เลขที่ PO" required value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            <Input label="วันที่ออก PO" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            <Input label="กำหนดรับ" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="ผู้ขาย / ผู้รับเงิน" required value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="ชื่อร้าน / บริษัท / บุคคล" />
            <Input label="เลขผู้เสียภาษี" value={vendorTaxId} onChange={(e) => setVendorTaxId(e.target.value)} placeholder="ถ้ามี" />
            <Input label="วันที่เอกสารผู้ขาย" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
            <Input label="กำหนดชำระ" type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
            <label className="block text-sm font-medium text-gray-700">
              VAT
              <select
                value={vatType}
                onChange={(e) => setVatType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">ไม่มี VAT</option>
                <option value="vat_included">ราคารวม VAT 7%</option>
                <option value="vat_excluded">ราคาไม่รวม VAT 7%</option>
              </select>
            </label>
            <Input label="หัก ณ ที่จ่าย (%)" type="number" value={withholdingTaxRate} onChange={(e) => setWithholdingTaxRate(e.target.value)} placeholder="0 / 1 / 3 / 5" />
            <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
              วิธีจ่าย
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="transfer">โอนเงิน</option>
                <option value="cash">เงินสด</option>
                <option value="credit">เครดิต/ตั้งหนี้</option>
                <option value="reimburse">เบิกคืน</option>
              </select>
            </label>
          </div>
          <div className="mt-4 rounded-2xl bg-white p-4 text-sm text-slate-700">
            <div className="flex justify-between"><span>ยอดก่อนภาษี</span><strong>{formatCurrency(total)}</strong></div>
            <div className="flex justify-between"><span>VAT</span><strong>{formatCurrency(vatAmount)}</strong></div>
            <div className="flex justify-between"><span>หัก ณ ที่จ่าย</span><strong>{formatCurrency(withholdingTaxAmount)}</strong></div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base text-slate-900"><span>ยอดจ่ายสุทธิ</span><strong>{formatCurrency(payableAmount)}</strong></div>
          </div>
          <div className="mt-3">
            <Input label="หมายเหตุ" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น โอนล่วงหน้า 30%" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="secondary" size="sm" fullWidth onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button
              size="sm"
              fullWidth
              disabled={!poNumber.trim() || !vendorName.trim()}
              onClick={() => onIssue(request.id, {
                poNumber: poNumber.trim(),
                poDate,
                expectedDate,
                vendorName: vendorName.trim(),
                vendorTaxId: vendorTaxId.trim(),
                documentDate,
                paymentDueDate,
                paymentMethod,
                vatType,
                withholdingTaxRate,
                note
              })}
            >
              ออก PO ส่ง "รอรับ"
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button variant="secondary" size="sm" fullWidth onClick={() => printDocument('pr')}>พิมพ์ PR</Button>
          {canCreate && <Button size="sm" fullWidth onClick={() => setOpen(true)}>ออก PO</Button>}
        </div>
      )}
    </div>
  );
};

export const GeneralPurchasePO = () => {
  const { requests, issuePO, canOperate } = useGeneralPurchase();
  const approved = requests.filter((r) => r.status === 'approved');
  const defaultPo = nextPoNumber(requests);

  return (
    <PageShell
      current="/general-purchase/po"
      stepperKey="po"
      title="ออก PO จาก PR ที่อนุมัติแล้ว"
      subtitle="ฝ่ายจัดซื้อสร้างใบสั่งซื้อจริงและส่งต่อให้คลังเตรียมรับสินค้า"
      role="ฝ่ายจัดซื้อ"
    >
      {approved.length === 0 ? (
        <EmptyState title="ไม่มี PR ที่รอออก PO" hint="ขออนุมัติจากผู้บริหารก่อน" />
      ) : (
        <div className="space-y-4">
          {approved.map((req) => (
            <RequestCard key={req.id} request={req} defaultPo={defaultPo} onIssue={issuePO} canCreate={canOperate} />
          ))}
        </div>
      )}
    </PageShell>
  );
};
