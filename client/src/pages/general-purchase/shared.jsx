import { Link, useNavigate } from 'react-router-dom';
import { STATUS_META, useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';

export const formatCurrency = (value) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

export const formatDate = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const COLOR_MAP = {
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  sky: 'bg-sky-100 text-sky-800 border-sky-200',
  indigo: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200',
};

export const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || { label: status, color: 'amber' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${COLOR_MAP[meta.color]}`}>
      {meta.label}
    </span>
  );
};

const STEP_LIST = [
  { key: 'pr', label: 'PR' },
  { key: 'review', label: 'ตรวจสอบ' },
  { key: 'po', label: 'PO' },
  { key: 'awaiting', label: 'รอรับ' },
  { key: 'received', label: 'รับ+ลงราคา' },
];

export const Stepper = ({ current }) => {
  const currentIdx = STEP_LIST.findIndex((s) => s.key === current);
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-1.5 text-xs sm:min-w-0 sm:gap-2">
        {STEP_LIST.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <li key={step.key} className="flex items-center gap-1.5 sm:gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 bg-white text-slate-500'
                }`}
              >
                {idx + 1}
              </span>
              <span className={`whitespace-nowrap font-semibold ${active ? 'text-blue-700' : done ? 'text-emerald-700' : 'text-slate-500'}`}>
                {step.label}
              </span>
              {idx < STEP_LIST.length - 1 && <span className="text-slate-300">›</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const NAV_LINKS = [
  { to: '/general-purchase/hub', label: 'หน้าหลัก', icon: '🏠' },
  { to: '/general-purchase', label: 'สร้าง PR', icon: '📝' },
  { to: '/general-purchase/review', label: 'ตรวจสอบ', icon: '✅' },
  { to: '/general-purchase/po', label: 'ออก PO', icon: '📄' },
  { to: '/general-purchase/awaiting', label: 'รอรับ', icon: '📦' },
  { to: '/general-purchase/receive', label: 'รับ+ลงราคา', icon: '💰' },
];

export const TopNav = ({ current }) => {
  const { access, canCreate, canApprove } = useGeneralPurchase();
  const isEmployeeHead = access?.user?.mode === 'employee_head';
  const employeeHeadLinks = [
    '/general-purchase/hub',
    ...(canCreate ? ['/general-purchase'] : []),
    ...(canApprove ? ['/general-purchase/review'] : []),
  ];
  const links = isEmployeeHead
    ? NAV_LINKS.filter((link) => employeeHeadLinks.includes(link.to))
    : canCreate
      ? NAV_LINKS
      : NAV_LINKS.filter((link) => link.to !== '/general-purchase');
  return (
    <nav className="rounded-3xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      <div
        className="hidden gap-1 lg:grid"
        style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
      >
        {links.map((link) => {
        const active = current === link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition-all ${
              active
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="text-base">{link.icon}</span>
            {link.label}
          </Link>
        );
      })}
      </div>

      <div className="grid grid-cols-3 gap-1.5 lg:hidden">
        {links.map((link) => {
        const active = current === link.to;
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`flex min-h-[58px] flex-col items-center justify-center rounded-2xl px-1.5 py-2 text-[11px] font-bold leading-tight transition-all ${
              active
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="text-base leading-none">{link.icon}</span>
            <span className="mt-1 text-center">{link.label}</span>
          </Link>
        );
      })}
      </div>
    </nav>
  );
};

export const PageShell = ({ current, stepperKey, title, subtitle, role, children, headerRight }) => {
  const navigate = useNavigate();
  const { access, clearAccess, isReadonly } = useGeneralPurchase();
  const exit = () => {
    clearAccess();
    navigate('/login');
  };
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-100 via-slate-50 to-white p-3 sm:p-6 font-sarabun">
      <div className="mx-auto max-w-6xl space-y-4 pb-6">
        <div className="sticky top-2 z-20 space-y-2 sm:top-4">
          <TopNav current={current} />
          <div className="flex justify-end lg:hidden">
            <button
              type="button"
              onClick={exit}
              className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 shadow-sm hover:bg-rose-50"
            >
              {isReadonly ? 'ออกจากโหมดดูข้อมูล' : 'ออกจากระบบ PR/PO'}
            </button>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
            </div>
            <div className="flex flex-col items-start gap-2 lg:items-end">
              {role && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="font-bold">ฝ่าย: {role}</div>
                  <div>{access?.user?.fullName || 'ข้อมูลจาก backend แยกจากระบบสต๊อก'}</div>
                </div>
              )}
              {headerRight}
              <button
                type="button"
                onClick={exit}
                className="hidden rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100 lg:inline-flex"
              >
                {isReadonly ? 'ออกจากโหมดดูข้อมูล' : 'ออกจากระบบ PR/PO'}
              </button>
            </div>
          </div>
          {stepperKey && <div className="mt-4"><Stepper current={stepperKey} /></div>}
        </div>
        {children}
      </div>
    </div>
  );
};

const DOC_TITLE = {
  pr: 'ใบขอซื้อทั่วไป (Purchase Requisition)',
  po: 'ใบสั่งซื้อทั่วไป (Purchase Order)',
  receive: 'ใบรับของ/บริการ และสรุปราคาจริง',
};

export const buildGeneralPoNumber = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `GPO-${yyyy}${mm}${dd}-001`;
};

const fmt = (value) => formatCurrency(value || 0);

const paymentMethodLabel = (value) => ({
  transfer: 'โอนเงิน',
  cash: 'เงินสด',
  credit: 'เครดิต/ตั้งหนี้',
  reimburse: 'เบิกคืน',
}[value] || value || '-');

const vatTypeLabel = (value) => ({
  none: 'ไม่มี VAT',
  vat_included: 'ราคารวม VAT 7%',
  vat_excluded: 'ราคาไม่รวม VAT 7%',
}[value] || value || '-');

export const OfficialPurchaseDocument = ({ request, type = 'pr', poDraft = {}, receiveRows = null, receiveNote = '', taxInvoiceNo = '' }) => {
  const rows = receiveRows || request.items || [];
  const docNo = type === 'po'
    ? (poDraft.poNumber || request.poNumber || '-')
    : type === 'receive'
      ? `RCV-${request.poNumber || request.number || request.id}`
      : request.number;
  const refNo = type === 'po' ? request.number : request.poNumber || '-';
  const docDate = type === 'po'
    ? (poDraft.poDate || request.poDate || '-')
    : type === 'receive'
      ? formatDate(request.receivedAt || new Date().toISOString())
      : formatDate(request.createdAt || request.header?.requestDate);
  const total = rows.reduce((sum, row) => sum + Number(row.actualPrice ?? row.actual_price ?? row.totalPrice ?? row.estimatedPrice ?? 0), 0);
  const vendorName = poDraft.vendorName || request.header?.vendorName || '-';
  const vendorTaxId = poDraft.vendorTaxId || request.header?.vendorTaxId || '-';
  const paymentDueDate = poDraft.paymentDueDate || request.header?.paymentDueDate || '-';
  const paymentMethod = poDraft.paymentMethod || request.header?.paymentMethod || '';
  const vatType = poDraft.vatType || request.header?.vatType || 'none';
  const withholdingTaxRate = Number(poDraft.withholdingTaxRate ?? request.header?.withholdingTaxRate ?? 0);
  const estimatedVatAmount = vatType === 'vat_excluded'
    ? total * 0.07
    : vatType === 'vat_included'
      ? total - total / 1.07
      : 0;
  const vatAmount = Number(poDraft.vatAmount ?? estimatedVatAmount);
  const withholdingTaxAmount = Number(poDraft.withholdingTaxAmount ?? (total * (withholdingTaxRate / 100)));
  const payableAmount = Number(poDraft.payableAmount ?? (total + (vatType === 'vat_excluded' ? vatAmount : 0) - withholdingTaxAmount));

  return (
    <section className="print-document hidden bg-white text-slate-900">
      <div className="border-2 border-slate-900 p-4">
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <div className="text-xl font-black tracking-wide">SOLAO</div>
            <div className="text-xs">ระบบเอกสารสั่งซื้อทั่วไป (ไม่เข้าสต๊อก)</div>
            <div className="text-xs">เอกสารนี้ใช้สำหรับการจัดซื้อ/รับของทั่วไป และส่งต่อฝ่ายบัญชี</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-black">{DOC_TITLE[type] || DOC_TITLE.pr}</div>
            <div className="mt-1 text-sm font-bold">เลขที่เอกสาร: {docNo}</div>
            <div className="text-xs">อ้างอิง: {refNo}</div>
            <div className="text-xs">วันที่: {docDate}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div><strong>ผู้ขอซื้อ:</strong> {request.requestedBy || '-'}</div>
          <div><strong>{type === 'pr' ? 'เลขที่ PO:' : 'ผู้ขาย/ผู้รับเงิน:'}</strong> {type === 'pr' ? (request.poNumber || '-') : vendorName}</div>
          <div><strong>สาขา:</strong> {request.header?.branch || '-'}</div>
          <div><strong>แผนก:</strong> {request.header?.department || '-'}</div>
          <div><strong>ประเภทค่าใช้จ่าย:</strong> {request.header?.expenseType || '-'}</div>
          <div><strong>กำหนดรับ:</strong> {poDraft.expectedDate || request.expectedDate || '-'}</div>
          <div className="col-span-2"><strong>วัตถุประสงค์:</strong> {request.header?.purpose || '-'}</div>
          {type === 'po' && (
            <>
              <div><strong>เลขผู้เสียภาษี:</strong> {vendorTaxId}</div>
              <div><strong>กำหนดชำระ:</strong> {paymentDueDate}</div>
              <div><strong>VAT:</strong> {vatTypeLabel(vatType)}</div>
              <div><strong>วิธีจ่าย:</strong> {paymentMethodLabel(paymentMethod)}</div>
            </>
          )}
          {type === 'receive' && (
            <>
              <div><strong>เลขใบเสร็จ/ใบกำกับ:</strong> {taxInvoiceNo || request.taxInvoiceNo || request.header?.taxInvoiceNo || '-'}</div>
              <div><strong>หมายเหตุรับของ:</strong> {receiveNote || request.receivedNote || '-'}</div>
            </>
          )}
        </div>

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-900 px-2 py-1 text-center">ลำดับ</th>
              <th className="border border-slate-900 px-2 py-1 text-left">รูป</th>
              <th className="border border-slate-900 px-2 py-1 text-left">รายการ</th>
              <th className="border border-slate-900 px-2 py-1 text-right">จำนวนขอซื้อ</th>
              {type === 'receive' && <th className="border border-slate-900 px-2 py-1 text-right">รับจริง</th>}
              <th className="border border-slate-900 px-2 py-1 text-center">หน่วย</th>
              <th className="border border-slate-900 px-2 py-1 text-right">จำนวนเงิน</th>
              <th className="border border-slate-900 px-2 py-1 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.id || index}>
                <td className="border border-slate-900 px-2 py-1 text-center">{index + 1}</td>
                <td className="border border-slate-900 px-2 py-1 text-center">
                  {item.imageDataUrl ? <img src={item.imageDataUrl} alt={item.name || 'item'} className="mx-auto h-10 w-10 object-cover" /> : '-'}
                </td>
                <td className="border border-slate-900 px-2 py-1">{item.name || item.item_name || '-'}</td>
                <td className="border border-slate-900 px-2 py-1 text-right">{item.quantity ?? item.requestedQuantity ?? '-'}</td>
                {type === 'receive' && <td className="border border-slate-900 px-2 py-1 text-right">{item.actualQuantity ?? '-'}</td>}
                <td className="border border-slate-900 px-2 py-1 text-center">{item.unit || '-'}</td>
                <td className="border border-slate-900 px-2 py-1 text-right">{fmt(item.actualPrice ?? item.totalPrice ?? item.estimatedPrice)}</td>
                <td className="border border-slate-900 px-2 py-1">{item.note || ''}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={type === 'receive' ? 6 : 5} className="border border-slate-900 px-2 py-1 text-right font-bold">รวมทั้งสิ้น</td>
              <td className="border border-slate-900 px-2 py-1 text-right font-bold">{fmt(total)}</td>
              <td className="border border-slate-900 px-2 py-1" />
            </tr>
            {type === 'po' && (
              <>
                <tr>
                  <td colSpan={type === 'receive' ? 6 : 5} className="border border-slate-900 px-2 py-1 text-right font-bold">VAT</td>
                  <td className="border border-slate-900 px-2 py-1 text-right font-bold">{fmt(vatAmount)}</td>
                  <td className="border border-slate-900 px-2 py-1" />
                </tr>
                <tr>
                  <td colSpan={type === 'receive' ? 6 : 5} className="border border-slate-900 px-2 py-1 text-right font-bold">หัก ณ ที่จ่าย {withholdingTaxRate}%</td>
                  <td className="border border-slate-900 px-2 py-1 text-right font-bold">{fmt(withholdingTaxAmount)}</td>
                  <td className="border border-slate-900 px-2 py-1" />
                </tr>
                <tr>
                  <td colSpan={type === 'receive' ? 6 : 5} className="border border-slate-900 px-2 py-1 text-right font-bold">ยอดจ่ายสุทธิ</td>
                  <td className="border border-slate-900 px-2 py-1 text-right font-bold">{fmt(payableAmount)}</td>
                  <td className="border border-slate-900 px-2 py-1" />
                </tr>
              </>
            )}
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
          <div className="border border-slate-900 p-3">
            <div className="h-12" />
            <div className="border-t border-slate-900 pt-1">ผู้ขอซื้อ</div>
            <div>วันที่ ____ / ____ / ____</div>
          </div>
          <div className="border border-slate-900 p-3">
            <div className="h-12" />
            <div className="border-t border-slate-900 pt-1">ผู้ตรวจสอบ/อนุมัติ</div>
            <div>วันที่ ____ / ____ / ____</div>
          </div>
          <div className="border border-slate-900 p-3">
            <div className="h-12" />
            <div className="border-t border-slate-900 pt-1">ฝ่ายบัญชี/ผู้รับเอกสาร</div>
            <div>วันที่ ____ / ____ / ____</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export const EmptyState = ({ title, hint }) => (
  <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
    <div className="text-base font-semibold text-slate-700">{title}</div>
    {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
  </div>
);
